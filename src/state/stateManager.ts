import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ClickUpTask } from '../clickup/apiClient';
import { config } from '../config/config';
import { taskLockManager } from '../utils/taskLock';

export enum WorkflowState {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  TESTING = 'testing',
  AWAITING_APPROVAL = 'awaiting_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface Revision {
  iteration: number;
  timestamp: string;
  feedback: string;
}

export interface AgentFeedback {
  id: string;
  timestamp: string;
  feedback: string;
  state: string; // The workflow state when feedback was submitted
  applyOnNextRun: boolean; // Whether to apply this feedback on next agent run
  applied?: boolean; // Whether this feedback has been applied
  appliedAt?: string;
}

/**
 * Checkpoint representing the state after a successful step completion
 */
export interface StepCheckpoint {
  stepNumber: number;
  stepName: string;
  timestamp: string;
  gitCommitHash: string;
  gitBranch: string;
  artifactPaths: string[]; // Screenshots, diffs, etc.
  contextSnapshot?: Record<string, any>; // demo.context.json snapshot
}

/**
 * Information about a failed step for recovery purposes
 */
export interface FailedStepInfo {
  stepNumber: number;
  stepName: string;
  errorCategory: string;
  errorMessage: string;
  timestamp: string;
  retryCount: number;
  lastCheckpointHash?: string; // Git commit hash to rollback to
}

export interface TaskState {
  taskId: string;
  state: WorkflowState;
  clientFolder: string;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  currentStep?: string;
  command?: string;
  metadata?: Record<string, any>;
  baseCommitHash?: string;
  agentCompletion?: {
    detectionStartedAt?: string;
    lastCheckedAt?: string;
    completionDetectedAt?: string;
  };
  revisions?: Revision[];
  lastRejectionAt?: string;
  lastRejectionFeedback?: string;
  agentFeedback?: AgentFeedback[];
  // Error recovery checkpoint fields
  checkpoints?: StepCheckpoint[];
  lastCheckpoint?: StepCheckpoint;
  failedStep?: FailedStepInfo;
  // Retry lock to prevent concurrent retry attempts
  retryLock?: {
    lockedAt: string;
    lockedBy: string; // 'retry' | 'skip' | 'rollback'
    lockToken?: string; // Unique token to verify lock ownership
  };
}

export interface TaskInfo {
  task: ClickUpTask;
  taskId: string;
  clientName?: string;
  clientFolder?: string;
  model?: string;
  // ISSUE 6 FIX: Optional notification email for local tasks (no ClickUp assignees)
  // This allows local task creators to receive failure/approval notifications
  notificationEmail?: string;
}

/**
 * Gets the state directory path for a task
 */
function getStateDir(clientFolder: string, taskId: string): string {
  return path.join(clientFolder, '.clickup-workflow', taskId);
}

/**
 * Gets the state file path
 */
function getStateFilePath(clientFolder: string, taskId: string): string {
  return path.join(getStateDir(clientFolder, taskId), 'state.json');
}

/**
 * Gets the task info file path
 */
function getTaskInfoFilePath(clientFolder: string, taskId: string): string {
  return path.join(getStateDir(clientFolder, taskId), 'task-info.json');
}

/**
 * Creates state directory if it doesn't exist
 */
async function ensureStateDir(clientFolder: string, taskId: string): Promise<string> {
  const stateDir = getStateDir(clientFolder, taskId);
  await fs.ensureDir(stateDir);
  return stateDir;
}

/**
 * Updates task state using a callback function for complex logic.
 * This ensures the entire read-modify-write cycle is atomic for the task.
 */
export async function updateTaskState(
  clientFolder: string,
  taskId: string,
  updater: (currentState: TaskState | null) => Partial<TaskState>
): Promise<TaskState> {
  return await taskLockManager.runExclusive(taskId, async () => {
    // Don't create .clickup-workflow directory until the client folder exists (i.e., after cloning)
    if (!(await fs.pathExists(clientFolder))) {
      logger.debug(`Skipping state update for ${taskId}: clientFolder ${clientFolder} does not exist yet`);
      const updates = updater(null);
      return {
        taskId,
        clientFolder,
        state: updates.state || WorkflowState.PENDING,
        branchName: updates.branchName || config.git.devBranch || 'main',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...updates
      } as TaskState;
    }
    
    await ensureStateDir(clientFolder, taskId);
    
    const stateFilePath = getStateFilePath(clientFolder, taskId);
    const existingState = await loadTaskState(clientFolder, taskId);
    
    const updates = updater(existingState);
    
    // Merge metadata if both exist
    const mergedMetadata = {
      ...(existingState?.metadata || {}),
      ...(updates.metadata || {}),
    };

    const updatedState: TaskState = {
      ...existingState,
      ...updates,
      taskId: taskId,
      clientFolder: clientFolder,
      state: updates.state || existingState?.state || WorkflowState.PENDING,
      branchName: updates.branchName || existingState?.branchName || config.git.devBranch || 'main',
      createdAt: existingState?.createdAt || updates.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
    };

    await fs.writeJson(stateFilePath, updatedState, { spaces: 2 });
    logger.debug(`Updated task state for ${taskId}: ${updatedState.state}`);
    
    return updatedState;
  });
}

/**
 * Saves task state with locking to prevent race conditions.
 * Automatically merges top-level fields and shallow-merges metadata.
 */
export async function saveTaskState(
  clientFolder: string,
  taskId: string,
  stateUpdates: Partial<TaskState>
): Promise<TaskState> {
  // Use updateTaskState with a simple merger
  return await updateTaskState(clientFolder, taskId, () => stateUpdates);
}

/**
 * Loads task state
 * 
 * FIX: Replaced TOCTOU (time-of-check-time-of-use) pattern with direct try-catch.
 * The previous implementation used fs.existsSync() followed by fs.readJson(),
 * creating a window where the file could be deleted between check and read.
 * Now we just attempt the read and handle ENOENT gracefully.
 */
export async function loadTaskState(
  clientFolder: string,
  taskId: string
): Promise<TaskState | null> {
  const stateFilePath = getStateFilePath(clientFolder, taskId);
  
  try {
    const state = await fs.readJson(stateFilePath) as TaskState;
    return state;
  } catch (error: any) {
    // FIX: Handle file-not-found as a normal case (not an error)
    // This can happen legitimately if the task was just deleted or never existed
    if (error.code === 'ENOENT') {
      return null;
    }
    // Log actual errors (corruption, permission issues, etc.)
    logger.error(`Error loading task state for ${taskId}: ${error.message}`);
    return null;
  }
}

/**
 * Saves task info
 */
export async function saveTaskInfo(
  clientFolder: string,
  taskId: string,
  taskInfo: TaskInfo
): Promise<void> {
  await ensureStateDir(clientFolder, taskId);
  
  const taskInfoFilePath = getTaskInfoFilePath(clientFolder, taskId);
  await fs.writeJson(taskInfoFilePath, taskInfo, { spaces: 2 });
  logger.debug(`Saved task info for ${taskId}`);
}

/**
 * Loads task info
 * 
 * FIX: Replaced TOCTOU pattern with direct try-catch for consistency with loadTaskState.
 */
export async function loadTaskInfo(
  clientFolder: string,
  taskId: string
): Promise<TaskInfo | null> {
  const taskInfoFilePath = getTaskInfoFilePath(clientFolder, taskId);
  
  try {
    const taskInfo = await fs.readJson(taskInfoFilePath) as TaskInfo;
    return taskInfo;
  } catch (error: any) {
    // Handle file-not-found as normal case (not an error)
    if (error.code === 'ENOENT') {
      return null;
    }
    logger.error(`Error loading task info: ${error.message}`);
    return null;
  }
}

/**
 * Saves agent feedback for a task
 */
export async function saveAgentFeedback(
  clientFolder: string,
  taskId: string,
  feedback: string,
  applyOnNextRun: boolean = true
): Promise<TaskState> {
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    if (!currentState) {
      throw new Error(`Task state not found for ${taskId}`);
    }

    const existingFeedback = currentState.agentFeedback || [];
    const timestamp = new Date().toISOString();
    const feedbackId = `fb_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;

    const newFeedback: AgentFeedback = {
      id: feedbackId,
      timestamp,
      feedback: feedback.trim(),
      state: currentState.state,
      applyOnNextRun,
      applied: false,
    };

    return {
      agentFeedback: [...existingFeedback, newFeedback],
    };
  });
}

/**
 * Marks agent feedback as applied
 */
export async function markFeedbackApplied(
  clientFolder: string,
  taskId: string,
  feedbackIds: string[]
): Promise<TaskState> {
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    if (!currentState) {
      throw new Error(`Task state not found for ${taskId}`);
    }

    const existingFeedback = currentState.agentFeedback || [];
    const appliedAt = new Date().toISOString();

    const updatedFeedback = existingFeedback.map(fb => {
      if (feedbackIds.includes(fb.id) && !fb.applied) {
        return { ...fb, applied: true, appliedAt };
      }
      return fb;
    });

    return {
      agentFeedback: updatedFeedback,
    };
  });
}

/**
 * Gets pending (unapplied) feedback that should be applied on next run
 */
export function getPendingFeedback(taskState: TaskState | null): AgentFeedback[] {
  if (!taskState?.agentFeedback) return [];
  return taskState.agentFeedback.filter(fb => fb.applyOnNextRun && !fb.applied);
}

/**
 * Rejects a task with feedback
 */
export async function rejectTask(
  clientFolder: string,
  taskId: string,
  feedback: string
): Promise<TaskState> {
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    if (!currentState) {
      throw new Error(`Task state not found for ${taskId}`);
    }

    const revisions = currentState.revisions || [];
    const nextIteration = revisions.length + 1;
    const timestamp = new Date().toISOString();

    const newRevision: Revision = {
      iteration: nextIteration,
      timestamp,
      feedback,
    };

    return {
      state: WorkflowState.REJECTED,
      revisions: [...revisions, newRevision],
      lastRejectionAt: timestamp,
      lastRejectionFeedback: feedback,
    };
  });
}


/**
 * Updates workflow state
 */
export async function updateWorkflowState(
  clientFolder: string,
  taskId: string,
  newState: WorkflowState,
  metadata?: Record<string, any>,
  currentStep?: string
): Promise<TaskState> {
  return await saveTaskState(clientFolder, taskId, {
    state: newState,
    currentStep: currentStep,
    metadata: metadata,
  });
}

// ============================================
// Checkpoint Management Functions
// ============================================

/**
 * Saves a checkpoint after a successful step completion.
 * Checkpoints enable rollback and recovery in case of future step failures.
 */
export async function saveStepCheckpoint(
  clientFolder: string,
  taskId: string,
  stepNumber: number,
  stepName: string,
  gitCommitHash: string,
  artifactPaths: string[] = [],
  contextSnapshot?: Record<string, any>
): Promise<TaskState> {
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    const checkpoint: StepCheckpoint = {
      stepNumber,
      stepName,
      timestamp: new Date().toISOString(),
      gitCommitHash,
      gitBranch: currentState?.branchName || 'main',
      artifactPaths,
      contextSnapshot
    };

    const existingCheckpoints = currentState?.checkpoints || [];
    
    // Keep only the last 10 checkpoints to avoid unbounded growth
    const updatedCheckpoints = [...existingCheckpoints, checkpoint].slice(-10);

    logger.info(`Saved checkpoint for ${taskId} step ${stepNumber} (${stepName}) at commit ${gitCommitHash}`);

    return {
      checkpoints: updatedCheckpoints,
      lastCheckpoint: checkpoint
    };
  });
}

/**
 * Gets the last valid checkpoint for a task.
 */
export async function getLastCheckpoint(
  clientFolder: string,
  taskId: string
): Promise<StepCheckpoint | null> {
  const state = await loadTaskState(clientFolder, taskId);
  return state?.lastCheckpoint || null;
}

/**
 * Gets checkpoint for a specific step number.
 */
export async function getCheckpointForStep(
  clientFolder: string,
  taskId: string,
  stepNumber: number
): Promise<StepCheckpoint | null> {
  const state = await loadTaskState(clientFolder, taskId);
  if (!state?.checkpoints) return null;
  
  // Find checkpoint for the step BEFORE the requested step (to rollback to previous state)
  const checkpoint = state.checkpoints
    .filter(cp => cp.stepNumber < stepNumber)
    .sort((a, b) => b.stepNumber - a.stepNumber)[0];
  
  return checkpoint || null;
}

/**
 * Marks a step as failed with error details for recovery purposes.
 */
export async function markStepFailed(
  clientFolder: string,
  taskId: string,
  stepNumber: number,
  stepName: string,
  errorCategory: string,
  errorMessage: string,
  lastCheckpointHash?: string
): Promise<TaskState> {
  // FIX: Validate and normalize inputs to prevent undefined/null from causing issues
  const safeStepNumber = typeof stepNumber === 'number' && stepNumber >= 1 ? stepNumber : 1;
  const safeStepName = stepName || 'unknown';
  const safeErrorCategory = errorCategory || 'unknown';
  const safeErrorMessage = errorMessage || 'An error occurred';
  
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    const existingFailedStep = currentState?.failedStep;
    // FIX: Preserve retry count if same step fails again
    // Use step-specific retry count from metadata to handle: step 2 fails → cleared → step 3 fails → step 2 fails again
    const isSameStep = existingFailedStep?.stepNumber === safeStepNumber;
    
    // Get step-specific retry history from metadata
    const stepRetryHistory = currentState?.metadata?.stepRetryHistory || {};
    const previousRetryCountForStep = stepRetryHistory[safeStepNumber] || 0;
    
    // FIX: Simplified retry count logic
    // - If same step failed again (currently in failedStep), increment its count
    // - Otherwise, use the stored retry history count (which was incremented when cleared)
    // This ensures retry count persists even if a different step failed in between
    const retryCount = isSameStep
      ? (existingFailedStep?.retryCount || 0) + 1
      : previousRetryCountForStep; // Use stored count from history (already incremented on clear)

    const failedStep: FailedStepInfo = {
      stepNumber: safeStepNumber,
      stepName: safeStepName,
      errorCategory: safeErrorCategory,
      errorMessage: safeErrorMessage,
      timestamp: new Date().toISOString(),
      retryCount,
      lastCheckpointHash: lastCheckpointHash || currentState?.lastCheckpoint?.gitCommitHash
    };

    logger.warn(`Marked step ${safeStepNumber} (${safeStepName}) as failed for ${taskId}: ${safeErrorCategory} - ${safeErrorMessage}`);

    return {
      failedStep,
      state: WorkflowState.ERROR
    };
  });
}

/**
 * Clears the failed step marker (for retry/recovery).
 * FIX: Properly preserves and increments retry count history
 */
export async function clearFailedStepMarker(
  clientFolder: string,
  taskId: string
): Promise<TaskState> {
  return await updateTaskState(clientFolder, taskId, (currentState) => {
    // FIX: Preserve per-step retry count history so markStepFailed can track retries
    // even if different steps fail between retries
    const failedStep = currentState?.failedStep;
    const stepRetryHistory = { ...(currentState?.metadata?.stepRetryHistory || {}) };
    
    // Update step-specific retry history
    // FIX: Store the INCREMENTED count (current count + 1) since we're about to retry
    // This way, if this step fails again, markStepFailed can use this value
    if (failedStep && failedStep.stepNumber) {
      const currentCount = failedStep.retryCount || 0;
      stepRetryHistory[failedStep.stepNumber] = currentCount + 1;
      logger.debug(`Updated retry history for step ${failedStep.stepNumber}: ${currentCount} -> ${currentCount + 1}`);
    }
    
    logger.info(`Cleared failed step marker for ${taskId}${failedStep ? ` (step ${failedStep.stepNumber}, retry count: ${failedStep.retryCount || 0})` : ''}`);
    return {
      failedStep: undefined,
      state: WorkflowState.IN_PROGRESS,
      metadata: {
        ...currentState?.metadata,
        stepRetryHistory,
        lastClearedStepNumber: failedStep?.stepNumber,
        lastClearedRetryCount: failedStep?.retryCount || 0,
        lastRetryTimestamp: new Date().toISOString(),
        // Store step-specific timestamp for granular tracking
        ...(failedStep?.stepNumber ? {
          [`lastRetryStep${failedStep.stepNumber}Timestamp`]: new Date().toISOString()
        } : {})
      }
    };
  });
}

/**
 * Acquires a retry lock to prevent concurrent retry attempts.
 * Returns the lock token if acquired, null if already locked.
 * 
 * FIX: Changed return type from boolean to string|null to enable lock ownership verification
 * during release. The caller MUST pass the returned token to releaseRetryLock.
 */
export async function acquireRetryLock(
  clientFolder: string,
  taskId: string,
  lockType: 'retry' | 'skip' | 'rollback'
): Promise<string | null> {
  // FIX: Use a unique lock token to detect if WE acquired the lock vs another concurrent call
  // This addresses potential race conditions where two calls read no existing lock simultaneously
  const lockToken = `${lockType}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
  const LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
  
  // FIX: Read state first to check for existing lock before attempting write
  // This prevents unnecessary file writes when lock is already held
  const currentState = await loadTaskState(clientFolder, taskId);
  const existingLock = currentState?.retryLock;
  
  if (existingLock) {
    const lockAge = Date.now() - new Date(existingLock.lockedAt).getTime();
    
    if (lockAge < LOCK_TIMEOUT_MS) {
      logger.warn(`Retry lock already held by ${existingLock.lockedBy} for ${taskId}`);
      return null; // Lock acquisition failed - no file write needed
    }
    // Lock is stale, we can take it
    logger.info(`Stale retry lock found for ${taskId}, acquiring new lock`);
  }
  
  // Now attempt to acquire the lock
  logger.info(`Acquiring ${lockType} lock for ${taskId} with token ${lockToken.substring(0, 20)}...`);
  
  await updateTaskState(clientFolder, taskId, () => ({
    retryLock: {
      lockedAt: new Date().toISOString(),
      lockedBy: lockType,
      lockToken: lockToken // Store our unique token
    }
  }));
  
  // Re-read state to verify WE actually acquired the lock
  // This handles the race condition where two calls both tried to acquire
  const state = await loadTaskState(clientFolder, taskId);
  const ourLock = state?.retryLock?.lockToken === lockToken;
  
  if (!ourLock && state?.retryLock) {
    logger.warn(`Lock acquisition race detected for ${taskId}, another process won`);
    return null;
  }
  
  return lockToken; // Return the token so caller can pass it to releaseRetryLock
}

/**
 * Releases the retry lock.
 * 
 * FIX: Added lockToken parameter to verify ownership before releasing.
 * This prevents accidentally releasing a lock acquired by another process
 * if the original operation takes longer than the lock timeout.
 * 
 * @param clientFolder - Path to the client folder
 * @param taskId - The task ID
 * @param lockToken - The token returned from acquireRetryLock. If not provided or doesn't match,
 *                    the lock will NOT be released (with a warning logged).
 */
export async function releaseRetryLock(
  clientFolder: string,
  taskId: string,
  lockToken?: string
): Promise<void> {
  await updateTaskState(clientFolder, taskId, (currentState) => {
    const existingLock = currentState?.retryLock;
    
    // FIX: Verify lock ownership before releasing
    if (!existingLock) {
      logger.debug(`No lock to release for ${taskId}`);
      return {}; // No change needed
    }
    
    // If lockToken is provided, verify it matches
    if (lockToken && existingLock.lockToken !== lockToken) {
      logger.warn(`Lock token mismatch for ${taskId}: expected ${lockToken.substring(0, 20)}..., found ${existingLock.lockToken?.substring(0, 20)}... Lock NOT released (belongs to another process).`);
      return {}; // Don't release - we don't own this lock
    }
    
    // If no lockToken provided, log a warning but still release (backwards compatibility)
    if (!lockToken) {
      logger.warn(`releaseRetryLock called without lockToken for ${taskId}. Releasing unconditionally (legacy mode).`);
    }
    
    logger.info(`Released retry lock for ${taskId}`);
    return {
      retryLock: undefined
    };
  });
}

/**
 * Gets recovery state information for a task.
 */
export async function getRecoveryState(
  clientFolder: string,
  taskId: string
): Promise<{
  failedStep: FailedStepInfo | null;
  lastCheckpoint: StepCheckpoint | null;
  checkpoints: StepCheckpoint[];
  isLocked: boolean;
  lockType?: string;
}> {
  const state = await loadTaskState(clientFolder, taskId);
  
  const isLocked = !!state?.retryLock && 
    (Date.now() - new Date(state.retryLock.lockedAt).getTime()) < 5 * 60 * 1000;
  
  return {
    failedStep: state?.failedStep || null,
    lastCheckpoint: state?.lastCheckpoint || null,
    checkpoints: state?.checkpoints || [],
    isLocked,
    lockType: isLocked ? state?.retryLock?.lockedBy : undefined
  };
}












