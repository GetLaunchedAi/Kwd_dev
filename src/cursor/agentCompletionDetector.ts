import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { 
  getCurrentCommitHash, 
  getBaselineState, 
  hasUncommittedChanges,
  GitBaselineState 
} from '../git/repoManager';
import { 
  saveTaskState, 
  loadTaskState,
  TaskState,
  WorkflowState 
} from '../state/stateManager';

/**
 * Tracks stability state for git status checking
 */
interface StabilityTracker {
  lastChangeTime: number | null;
  lastStatus: boolean;
}

/**
 * Polling state for a single task
 */
interface PollingState {
  baselineState: GitBaselineState;
  startTime: number;
  lastCheckTime: number;
  stabilityTracker: StabilityTracker;
  cancelled: boolean;
}

// Store active polling states by task ID
const activePolling = new Map<string, PollingState>();

/**
 * Checks if git commits have changed from baseline
 */
async function checkGitCommits(
  clientFolder: string,
  baselineState: GitBaselineState
): Promise<boolean> {
  try {
    const currentCommitHash = await getCurrentCommitHash(clientFolder);
    
    // If baseline had no commits, any commit means completion
    if (!baselineState.commitHash && currentCommitHash) {
      logger.debug(`Git commit detected: new commit ${currentCommitHash} (baseline had no commits)`);
      return true;
    }
    
    // If both exist and are different, completion detected
    if (baselineState.commitHash && currentCommitHash && 
        baselineState.commitHash !== currentCommitHash) {
      logger.debug(`Git commit detected: changed from ${baselineState.commitHash} to ${currentCommitHash}`);
      return true;
    }
    
    return false;
  } catch (error: any) {
    logger.error(`Error checking git commits: ${error.message}`);
    return false;
  }
}

/**
 * Checks if CURSOR_TASK.md file has been deleted or renamed
 */
async function checkTaskFileStatus(clientFolder: string): Promise<boolean> {
  try {
    const taskFilePath = path.join(clientFolder, 'CURSOR_TASK.md');
    const exists = await fs.pathExists(taskFilePath);
    
    if (!exists) {
      logger.debug(`Task file deleted: CURSOR_TASK.md no longer exists`);
      return true;
    }
    
    return false;
  } catch (error: any) {
    logger.error(`Error checking task file status: ${error.message}`);
    return false;
  }
}

/**
 * Checks for completion marker file
 */
async function checkCompletionMarker(
  clientFolder: string,
  markerFile?: string
): Promise<boolean> {
  if (!markerFile) {
    return false;
  }
  
  try {
    const markerPath = path.join(clientFolder, markerFile);
    const exists = await fs.pathExists(markerPath);
    
    if (exists) {
      logger.debug(`Completion marker found: ${markerFile}`);
      return true;
    }
    
    return false;
  } catch (error: any) {
    logger.error(`Error checking completion marker: ${error.message}`);
    return false;
  }
}

/**
 * Monitors git status for uncommitted changes that stabilize
 * Returns true if changes exist but haven't changed for stabilityPeriod
 */
async function checkGitStatusStability(
  clientFolder: string,
  stabilityPeriod: number,
  tracker: StabilityTracker
): Promise<boolean> {
  try {
    const hasChanges = await hasUncommittedChanges(clientFolder);
    const now = Date.now();
    
    // If there are changes now
    if (hasChanges) {
      // If this is the first time we see changes, record the time
      if (!tracker.lastChangeTime) {
        tracker.lastChangeTime = now;
        tracker.lastStatus = hasChanges;
        logger.debug(`Uncommitted changes detected, starting stability timer`);
        return false;
      }
      
      // If changes have been stable for the required period
      if (tracker.lastChangeTime && (now - tracker.lastChangeTime) >= stabilityPeriod) {
        logger.debug(`Git status stable: uncommitted changes present for ${stabilityPeriod}ms`);
        return true;
      }
      
      tracker.lastStatus = hasChanges;
      return false;
    } else {
      // No changes now - reset tracker if we had changes before
      if (tracker.lastStatus) {
        logger.debug(`Uncommitted changes cleared`);
      }
      tracker.lastChangeTime = null;
      tracker.lastStatus = false;
      return false;
    }
  } catch (error: any) {
    logger.error(`Error checking git status stability: ${error.message}`);
    return false;
  }
}

/**
 * Main detection function that checks all completion indicators
 */
async function detectAgentCompletion(
  clientFolder: string,
  taskId: string,
  baselineState: GitBaselineState
): Promise<boolean> {
  const detectionConfig = config.cursor.agentCompletionDetection;
  
  if (!detectionConfig || !detectionConfig.enabled) {
    logger.warn('Agent completion detection is disabled');
    return false;
  }
  
  logger.debug(`Checking agent completion for task ${taskId}`);
  
  // Check git commits if enabled
  if (detectionConfig.checkGitCommits) {
    const commitsChanged = await checkGitCommits(clientFolder, baselineState);
    if (commitsChanged) {
      logger.info(`Agent completion detected via git commits for task ${taskId}`);
      return true;
    }
  }
  
  // Check task file deletion if enabled
  if (detectionConfig.checkTaskFileDeletion) {
    const taskFileDeleted = await checkTaskFileStatus(clientFolder);
    if (taskFileDeleted) {
      logger.info(`Agent completion detected via task file deletion for task ${taskId}`);
      return true;
    }
  }
  
  // Check completion marker if configured
  if (detectionConfig.completionMarkerFile) {
    const markerExists = await checkCompletionMarker(
      clientFolder,
      detectionConfig.completionMarkerFile
    );
    if (markerExists) {
      logger.info(`Agent completion detected via completion marker for task ${taskId}`);
      return true;
    }
  }
  
  return false;
}

/**
 * Starts async polling loop for agent completion detection
 */
export async function startCompletionDetection(
  clientFolder: string,
  taskId: string,
  branchName: string
): Promise<void> {
  const detectionConfig = config.cursor.agentCompletionDetection;
  
  if (!detectionConfig || !detectionConfig.enabled) {
    logger.info(`Agent completion detection is disabled for task ${taskId}`);
    return;
  }
  
  logger.info(`Starting agent completion detection for task ${taskId}`);
  
  try {
    // Capture baseline state
    const baselineState = await getBaselineState(clientFolder, branchName);
    
    // Save baseline state to task state
    await saveTaskState(clientFolder, taskId, {
      agentCompletion: {
        baselineCommitHash: baselineState.commitHash || undefined,
        baselineBranch: baselineState.branchName,
        detectionStartedAt: new Date().toISOString(),
      },
    });
    
    // Initialize polling state
    const pollingState: PollingState = {
      baselineState,
      startTime: Date.now(),
      lastCheckTime: Date.now(),
      stabilityTracker: {
        lastChangeTime: null,
        lastStatus: false,
      },
      cancelled: false,
    };
    
    activePolling.set(taskId, pollingState);
    
    // Start polling loop (non-blocking)
    pollForCompletion(clientFolder, taskId, branchName, pollingState).catch(error => {
      logger.error(`Error in completion detection polling for task ${taskId}: ${error.message}`);
      // Update state to error
      updateWorkflowStateOnError(clientFolder, taskId, error);
    });
    
  } catch (error: any) {
    logger.error(`Error starting completion detection for task ${taskId}: ${error.message}`);
    throw error;
  }
}

/**
 * Main polling loop
 */
async function pollForCompletion(
  clientFolder: string,
  taskId: string,
  branchName: string,
  pollingState: PollingState
): Promise<void> {
  const detectionConfig = config.cursor.agentCompletionDetection!;
  const pollInterval = detectionConfig.pollInterval || 30000;
  const maxWaitTime = detectionConfig.maxWaitTime || 3600000;
  const stabilityPeriod = detectionConfig.stabilityPeriod || 60000;
  
  logger.info(`Polling started for task ${taskId} (interval: ${pollInterval}ms, max wait: ${maxWaitTime}ms)`);
  
  while (!pollingState.cancelled) {
    try {
      const now = Date.now();
      const elapsed = now - pollingState.startTime;
      
      // Check timeout
      if (elapsed >= maxWaitTime) {
        logger.warn(`Completion detection timeout for task ${taskId} after ${maxWaitTime}ms`);
        await handleTimeout(clientFolder, taskId);
        return;
      }
      
      // Update last check time in state
      pollingState.lastCheckTime = now;
      await saveTaskState(clientFolder, taskId, {
        agentCompletion: {
          lastCheckedAt: new Date(now).toISOString(),
        },
      });
      
      // Check completion via multiple methods
      const isComplete = await detectAgentCompletion(
        clientFolder,
        taskId,
        pollingState.baselineState
      );
      
      // Check git status stability if enabled
      if (!isComplete && detectionConfig.checkGitCommits) {
        const isStable = await checkGitStatusStability(
          clientFolder,
          stabilityPeriod,
          pollingState.stabilityTracker
        );
        if (isStable) {
          logger.info(`Agent completion detected via git stability for task ${taskId}`);
          await handleCompletion(clientFolder, taskId);
          return;
        }
      }
      
      if (isComplete) {
        await handleCompletion(clientFolder, taskId);
        return;
      }
      
      // Wait before next poll
      await sleep(pollInterval);
      
    } catch (error: any) {
      logger.error(`Error during polling for task ${taskId}: ${error.message}`);
      // Continue polling despite errors (they might be transient)
      await sleep(pollInterval);
    }
  }
  
  logger.info(`Polling cancelled for task ${taskId}`);
}

/**
 * Handles completion detection - continues workflow
 */
async function handleCompletion(
  clientFolder: string,
  taskId: string
): Promise<void> {
  logger.info(`Agent completion confirmed for task ${taskId}, continuing workflow`);
  
  try {
    // Mark polling as cancelled
    const pollingState = activePolling.get(taskId);
    if (pollingState) {
      pollingState.cancelled = true;
    }
    
    // Update task state with completion time
    await saveTaskState(clientFolder, taskId, {
      agentCompletion: {
        completionDetectedAt: new Date().toISOString(),
      },
    });
    
    // Continue workflow (use dynamic import to avoid circular dependency)
    const { continueWorkflowAfterAgent } = await import('../workflow/workflowOrchestrator');
    await continueWorkflowAfterAgent(clientFolder, taskId);
    
    // Clean up polling state
    activePolling.delete(taskId);
    
  } catch (error: any) {
    logger.error(`Error handling completion for task ${taskId}: ${error.message}`);
    await updateWorkflowStateOnError(clientFolder, taskId, error);
    throw error;
  }
}

/**
 * Handles timeout scenario
 */
async function handleTimeout(
  clientFolder: string,
  taskId: string
): Promise<void> {
  logger.error(`Completion detection timed out for task ${taskId}`);
  
  try {
    const pollingState = activePolling.get(taskId);
    if (pollingState) {
      pollingState.cancelled = true;
    }
    
    // Update workflow state to error
    const { updateWorkflowState } = await import('../state/stateManager');
    await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
      error: 'Agent completion detection timed out',
      timeout: true,
    });
    
    // Clean up polling state
    activePolling.delete(taskId);
    
  } catch (error: any) {
    logger.error(`Error handling timeout for task ${taskId}: ${error.message}`);
  }
}

/**
 * Updates workflow state on error
 */
async function updateWorkflowStateOnError(
  clientFolder: string,
  taskId: string,
  error: any
): Promise<void> {
  try {
    const { updateWorkflowState } = await import('../state/stateManager');
    await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
      error: error.message || String(error),
    });
  } catch (stateError: any) {
    logger.error(`Error updating workflow state: ${stateError.message}`);
  }
}

/**
 * Cancels active polling for a task (if needed for manual overrides)
 */
export function cancelCompletionDetection(taskId: string): void {
  const pollingState = activePolling.get(taskId);
  if (pollingState) {
    pollingState.cancelled = true;
    logger.info(`Cancelled completion detection for task ${taskId}`);
  }
  activePolling.delete(taskId);
}

/**
 * Utility function to sleep/delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

