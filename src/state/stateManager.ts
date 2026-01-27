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
}

export interface TaskInfo {
  task: ClickUpTask;
  taskId: string;
  clientName?: string;
  clientFolder?: string;
  model?: string;
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
 */
export async function loadTaskInfo(
  clientFolder: string,
  taskId: string
): Promise<TaskInfo | null> {
  const taskInfoFilePath = getTaskInfoFilePath(clientFolder, taskId);
  
  if (!fs.existsSync(taskInfoFilePath)) {
    return null;
  }

  try {
    const taskInfo = await fs.readJson(taskInfoFilePath) as TaskInfo;
    return taskInfo;
  } catch (error: any) {
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












