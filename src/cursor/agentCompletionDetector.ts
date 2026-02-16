import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { 
  loadTaskState,
  saveTaskState,
  WorkflowState 
} from '../state/stateManager';

/**
 * Polling state for a single task
 */
interface PollingState {
  startTime: number;
  lastCheckTime: number;
  cancelled: boolean;
}

// Store active polling states by task ID
const activePolling = new Map<string, PollingState>();

/**
 * CRITICAL: Process the next task in the queue after one completes.
 * This is the missing link that enables sequential queue processing.
 * 
 * FIX 3.2: Now uses launchAgentForTask (shared with triggerCursorAgent) so that
 * queued tasks get the same pre-trigger treatment: status reset, demo guard,
 * directory setup, pending feedback, IN_PROGRESS state update, and completion
 * detection — instead of calling triggerAgent directly and skipping those steps.
 * 
 * @param depth - Internal recursion depth counter to prevent infinite loops
 */
export async function processNextQueuedTask(depth: number = 0): Promise<void> {
  // Safeguard against infinite recursion (max 5 consecutive failed tasks)
  const MAX_RECURSION_DEPTH = 5;
  if (depth >= MAX_RECURSION_DEPTH) {
    logger.error(`processNextQueuedTask: Max recursion depth (${MAX_RECURSION_DEPTH}) reached. Stopping to prevent infinite loop.`);
    return;
  }

  try {
    const { agentQueue } = await import('./agentQueue');
    
    // Check if there are tasks waiting in queue
    const overview = await agentQueue.getQueueOverview();
    
    if (overview.queued.length === 0) {
      logger.info('Queue is empty - no more tasks to process');
      return;
    }
    
    if (overview.running.length > 0) {
      logger.info(`Another task is already running (${overview.running[0].taskId}) - queue will process naturally`);
      return;
    }
    
    logger.info(`Found ${overview.queued.length} task(s) waiting in queue. Claiming next task...`);
    
    // Claim the next task
    const claimed = await agentQueue.claimNextTask();
    
    if (!claimed) {
      logger.warn('Failed to claim next task from queue despite tasks being available');
      return;
    }
    
    logger.info(`Claimed task ${claimed.metadata.taskId} from queue. Starting agent...`);
    
    // We need to get the task info from the task state
    const { loadTaskInfo } = await import('../state/stateManager');
    const taskInfo = await loadTaskInfo(claimed.metadata.clientFolder, claimed.metadata.taskId);
    
    if (!taskInfo?.task) {
      logger.error(`Cannot find task info for claimed task ${claimed.metadata.taskId}. Moving to failed.`);
      await agentQueue.completeTask(false, 'Task info not found during queue processing', claimed.metadata.taskId);
      // Try to process the next one with incremented depth
      await processNextQueuedTask(depth + 1);
      return;
    }
    
    // FIX 3.2: Delegate to the shared launchAgentForTask which handles
    // status reset, demo guard, directory setup, pending feedback,
    // IN_PROGRESS state update, agent trigger, and completion detection.
    const { launchAgentForTask } = await import('./workspaceManager');
    await launchAgentForTask(
      claimed.metadata.clientFolder,
      taskInfo.task,
      claimed.metadata.branch || 'main'
    );
    
    logger.info(`Successfully started processing queued task ${claimed.metadata.taskId}`);
    
  } catch (error: any) {
    logger.error(`Error processing next queued task: ${error.message}`);
    // Don't throw - we don't want to break the completion flow of the previous task
  }
}

/**
 * Checks the authoritative status file: workspaceRoot/.cursor/status/${taskId}.json
 * This is the single source of truth written by taskStatusManager.
 */
async function checkStatusFile(clientFolder: string, taskId: string): Promise<{ isComplete: boolean; success: boolean; error?: string }> {
  try {
    // Single authoritative path: client folder status file
    const statusPath = path.join(clientFolder, '.cursor', 'status', 'current.json');
    
    // If file doesn't exist yet, task is still starting/running
    if (!(await fs.pathExists(statusPath))) {
      logger.debug(`Status file not found yet for task ${taskId}: ${statusPath}`);
      return { isComplete: false, success: false };
    }

    const status = await fs.readJson(statusPath);
    logger.debug(`Status file content for task ${taskId}:`, status);
    
    // VERIFICATION: Ensure this status file belongs to the CURRENT task ID we are polling for.
    // Check both root-level taskId AND nested task.taskId (for step-based workflows).
    // The nested task.taskId contains the full step suffix (e.g., "demo-sunny-side-baker-step4")
    // while root taskId may only have the base ID (e.g., "demo-sunny-side-baker").
    const statusTaskId = status.task?.taskId || status.taskId;
    if (statusTaskId !== taskId) {
      logger.debug(`Status file taskId (${statusTaskId}) does not match current taskId (${taskId}). Treating as not yet started.`);
      return { isComplete: false, success: false };
    }

    // Check for stale heartbeat (agent hung/crashed without updating status)
    if (status.lastHeartbeat && (status.state === 'RUNNING' || status.state === 'running')) {
      const heartbeatAge = Date.now() - new Date(status.lastHeartbeat).getTime();
      
      // Multi-step demo tasks get a longer heartbeat allowance (10 minutes as per plan)
      const isDemoTask = taskId.startsWith('demo-');
      const maxHeartbeatAge = isDemoTask ? 600000 : 120000; // 10 mins for demo, 2 mins for normal
      
      if (heartbeatAge > maxHeartbeatAge) {
        logger.warn(`Task ${taskId} has stale heartbeat (${Math.round(heartbeatAge / 1000)}s old). Max age is ${Math.round(maxHeartbeatAge / 1000)}s.`);
        
        // Log where to find logs
        const logsDir = path.join(clientFolder, 'logs', 'tasks', taskId);
        logger.warn(`Checking logs for clues in: ${logsDir}`);
        return { 
          isComplete: true, 
          success: false, 
          error: `Agent process appears to be hung (no heartbeat for ${Math.round(heartbeatAge / 1000)} seconds). Check logs at ${logsDir}` 
        };
      }
    }

    // Check completion states
    if (status.state === 'done' || status.state === 'DONE' || status.state === 'completed' || status.state === 'COMPLETED') {
      logger.info(`Task ${taskId} completion detected: state=${status.state} in ${statusPath}`);
      return { isComplete: true, success: true };
    } else if (status.state === 'failed' || status.state === 'FAILED') {
      // Extract detailed error information including credit/model errors
      let errorMsg = status.errors?.[0] || status.error || 'Unknown error from agent';
      
      // Check for credit limit errors and ensure they're properly reported
      if (status.creditError || /usage.?limit|credit|quota/i.test(errorMsg)) {
        errorMsg = status.userMessage || 'AI credits exhausted. Please wait for credits to reset or upgrade your plan.';
        logger.error(`Task ${taskId} failed due to CREDIT LIMIT: ${errorMsg}`);
      } else if (status.modelError) {
        errorMsg = status.userMessage || `Model "${status.failedModel || 'selected'}" is unavailable`;
        logger.error(`Task ${taskId} failed due to MODEL ERROR: ${errorMsg}`);
      } else {
        logger.info(`Task ${taskId} failure detected: state=${status.state} in ${statusPath}`);
      }
      
      return { isComplete: true, success: false, error: errorMsg };
    }

    // Task is still running
    logger.debug(`Task ${taskId} still running: state=${status.state}, step=${status.step || 'unknown'}`);
    return { isComplete: false, success: false };
    
  } catch (error: any) {
    // Log parse errors but continue polling - might be in middle of atomic write
    logger.debug(`Error reading status file for task ${taskId}: ${error.message}`);
    return { isComplete: false, success: false };
  }
}

/**
 * Main detection function that checks all completion indicators
 */
async function detectAgentCompletion(
  clientFolder: string,
  taskId: string
): Promise<{ isComplete: boolean; success: boolean; error?: string }> {
  const detectionConfig = config.cursor.agentCompletionDetection;
  
  if (!detectionConfig || !detectionConfig.enabled) {
    logger.warn('Agent completion detection is disabled');
    return { isComplete: false, success: false };
  }
  
  logger.debug(`Checking agent completion for task ${taskId}`);

  // 1. Check process exit (if available) - this is a direct signal
  const currentProcess = (global as any).currentAgentProcess;
  if (currentProcess && currentProcess.exitCode !== null) {
    logger.info(`Agent process exited with code ${currentProcess.exitCode}`);
    
    // Check status file one last time to see if it was updated right before exit
    const status = await checkStatusFile(clientFolder, taskId);
    return { 
      isComplete: true, 
      success: status.isComplete ? status.success : (currentProcess.exitCode === 0),
      error: status.error
    };
  }

  // 2. Check authoritative status file (the primary signal)
  const status = await checkStatusFile(clientFolder, taskId);
  if (status.isComplete) {
    logger.info(`Agent completion detected via status file for task ${taskId} (success: ${status.success})`);
    return status;
  }
  
  return { isComplete: false, success: false };
}

/**
 * Starts async polling loop for agent completion detection
 */
export async function startCompletionDetection(
  clientFolder: string,
  taskId: string,
  _branchName: string // Kept for compatibility, but no longer used for git checks
): Promise<void> {
  const detectionConfig = config.cursor.agentCompletionDetection;
  
  if (!detectionConfig || !detectionConfig.enabled) {
    logger.info(`Agent completion detection is disabled for task ${taskId}`);
    return;
  }
  
  // Prevent duplicate polling loops for the same task
  if (activePolling.has(taskId)) {
    logger.info(`Completion detection already active for task ${taskId}. Skipping duplicate start.`);
    return;
  }
  
  // Log the authoritative status file path once
  const authoritativeStatusPath = path.join(clientFolder, '.cursor', 'status', 'current.json');
  logger.info(`Starting agent completion detection for task ${taskId}`);
  logger.info(`Authoritative status file: ${authoritativeStatusPath}`);
  
  try {
    // Update task state that detection has started
    await saveTaskState(clientFolder, taskId, {
      agentCompletion: {
        detectionStartedAt: new Date().toISOString(),
      },
    });
    
    // Initialize polling state
    const pollingState: PollingState = {
      startTime: Date.now(),
      lastCheckTime: Date.now(),
      cancelled: false,
    };
    
    activePolling.set(taskId, pollingState);
    
    // Start polling loop (non-blocking)
    pollForCompletion(clientFolder, taskId, pollingState).catch(error => {
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
 * Main polling loop with robust error handling
 */
async function pollForCompletion(
  clientFolder: string,
  taskId: string,
  pollingState: PollingState
): Promise<void> {
  const detectionConfig = config.cursor.agentCompletionDetection!;
  const pollInterval = detectionConfig.pollInterval || 30000;
  const maxWaitTime = detectionConfig.maxWaitTime || 3600000;
  
  logger.info(`Polling started for task ${taskId} (interval: ${pollInterval}ms, max wait: ${maxWaitTime}ms)`);
  
  let consecutiveErrors = 0;
  const maxConsecutiveErrors = 5;
  
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
      
      // DEFENSIVE CHECK: Verify task still exists before updating state
      // This prevents recreating state files for deleted tasks
      const taskWorkflowDir = path.join(clientFolder, '.clickup-workflow', taskId);
      if (!(await fs.pathExists(taskWorkflowDir))) {
        logger.info(`Task ${taskId} workflow directory no longer exists - task was likely deleted. Stopping polling.`);
        activePolling.delete(taskId);
        return;
      }
      
      // Check if polling was cancelled during the async directory check (race condition guard)
      if (pollingState.cancelled) {
        logger.info(`Polling cancelled for task ${taskId} during iteration`);
        return;
      }
      
      // Update last check time in state
      pollingState.lastCheckTime = now;
      await saveTaskState(clientFolder, taskId, {
        agentCompletion: {
          lastCheckedAt: new Date(now).toISOString(),
        },
      });
      
      // Check completion via authoritative signals
      const result = await detectAgentCompletion(
        clientFolder,
        taskId
      );
      
      if (result.isComplete) {
        await handleCompletion(clientFolder, taskId, result.success, result.error);
        return;
      }
      
      // Reset error counter on successful poll
      consecutiveErrors = 0;
      
      // Wait before next poll
      await sleep(pollInterval);
      
    } catch (error: any) {
      consecutiveErrors++;
      logger.error(`Error during polling for task ${taskId} (${consecutiveErrors}/${maxConsecutiveErrors} consecutive errors): ${error.message}`);
      
      // If we've hit too many consecutive errors, fail the task
      if (consecutiveErrors >= maxConsecutiveErrors) {
        logger.error(`Task ${taskId} failed after ${maxConsecutiveErrors} consecutive polling errors. Marking as failed.`);
        
        try {
          await updateWorkflowStateOnError(clientFolder, taskId, new Error(`Polling failed after ${maxConsecutiveErrors} consecutive errors: ${error.message}`));
          
          // Complete the task in queue as failed
          const { agentQueue } = await import('./agentQueue');
          await agentQueue.completeTask(false, `Polling failed: ${error.message}`, taskId);
        } catch (cleanupError: any) {
          logger.error(`Failed to clean up after polling errors: ${cleanupError.message}`);
        }
        
        activePolling.delete(taskId);
        return;
      }
      
      // Continue polling after error (with backoff)
      const backoff = pollInterval * Math.min(consecutiveErrors, 3); // Increase backoff with errors
      await sleep(backoff);
    }
  }
  
  logger.info(`Polling cancelled for task ${taskId}`);
}

/**
 * Handles completion detection - continues workflow.
 *
 * DUAL COMPLETION DETECTION (Phase 3.5 documentation):
 * This function is called by the polling-based completion detector (safety net path).
 * The runner exit handler in agentTrigger.ts is the primary completion path.
 * The workflow orchestrator's lock prevents duplicate execution; if the runner
 * already called continueWorkflowAfterAgent, this call will be deduplicated and
 * a log message will be emitted by the orchestrator.
 */
async function handleCompletion(
  clientFolder: string,
  taskId: string,
  success: boolean = true,
  error?: string
): Promise<void> {
  logger.info(`Agent completion confirmed for task ${taskId} (success: ${success}), continuing workflow`);
  
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

    
    // FIX: Clean up the queue by moving task from running/ to done/ or failed/
    const { agentQueue } = await import('./agentQueue');
    
    
    await agentQueue.completeTask(success, error, taskId);
    
    // CRITICAL FIX: After completing a task, try to claim and start the next queued task
    await processNextQueuedTask();

    if (!success) {
      
      const { updateWorkflowState } = await import('../state/stateManager');
      await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
        error: error || 'Agent reported failure or exited with non-zero code',
      });
      activePolling.delete(taskId);
      return;
    }
    
    
    // Continue workflow (use dynamic import to avoid circular dependency)
    const { continueWorkflowAfterAgent } = await import('../workflow/workflowOrchestrator');
    await continueWorkflowAfterAgent(clientFolder, taskId);
    
    
    // Clean up polling state
    activePolling.delete(taskId);
    
  } catch (error: any) {
    logger.error(`Error handling completion for task ${taskId}: ${error.message}`);
    
    // Critical: Always clean up queue state even if workflow continuation fails
    try {
      const { agentQueue } = await import('./agentQueue');
      await agentQueue.completeTask(false, `Workflow error: ${error.message}`, taskId);
    } catch (queueError: any) {
      logger.error(`Failed to clean up queue after completion error: ${queueError.message}`);
    }
    
    // Update workflow state
    try {
      await updateWorkflowStateOnError(clientFolder, taskId, error);
    } catch (stateError: any) {
      logger.error(`Failed to update workflow state after completion error: ${stateError.message}`);
    }
    
    // FIX: Mark demo step as failed so error recovery (retry/skip) can work
    // This handles the case where agent succeeded but post-completion workflow failed
    if (taskId.startsWith('demo-')) {
      try {
        const { markStepFailed, loadTaskState } = await import('../state/stateManager');
        
        // Extract step number from taskId: "demo-xyz" is step 1, "demo-xyz-step2" is step 2, etc.
        let stepNumber = 1;
        const stepMatch = taskId.match(/-step(\d+)$/);
        if (stepMatch) {
          const parsed = parseInt(stepMatch[1], 10);
          if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
            stepNumber = parsed;
          }
        }
        
        // Get base task ID for state updates
        const baseTaskId = taskId.replace(/-step\d+$/, '');
        const stepNames = ['branding', 'copywriting', 'imagery', 'review'];
        const stepName = stepNames[stepNumber - 1] || 'unknown';
        
        // Get last checkpoint hash if available
        const state = await loadTaskState(clientFolder, baseTaskId);
        const lastCheckpointHash = state?.lastCheckpoint?.gitCommitHash;
        
        await markStepFailed(
          clientFolder,
          baseTaskId,
          stepNumber,
          stepName,
          'workflow_error',
          `Post-completion workflow failed: ${error.message}`,
          lastCheckpointHash
        );
        
        // Also update demo.status.json for frontend
        const demoStatusPath = path.join(clientFolder, 'demo.status.json');
        if (await fs.pathExists(demoStatusPath)) {
          const status = await fs.readJson(demoStatusPath);
          await fs.writeJson(demoStatusPath, {
            ...status,
            state: 'failed',
            message: `Workflow error: ${error.message}`,
            updatedAt: new Date().toISOString()
          }, { spaces: 2 });
        }
        
        logger.info(`Marked demo step ${stepNumber} as failed for error recovery: ${error.message}`);
      } catch (markErr: any) {
        logger.warn(`Could not mark demo step as failed: ${markErr.message}`);
      }
    }
    
    // Clean up polling
    activePolling.delete(taskId);
    
    // Still try to process next queued task even on error
    try {
      await processNextQueuedTask();
    } catch (nextTaskError: any) {
      logger.error(`Failed to process next queued task after error: ${nextTaskError.message}`);
    }
    
    // Don't re-throw - we've already handled the error
    // Re-throwing can cause unhandled promise rejections
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
    
    // CRITICAL: Move task from running to failed so queue can continue
    try {
      const { agentQueue } = await import('./agentQueue');
      await agentQueue.completeTask(false, 'Agent completion detection timed out', taskId);
    } catch (queueError: any) {
      logger.error(`Failed to move timed-out task to failed: ${queueError.message}`);
    }
    
    // Clean up polling state
    activePolling.delete(taskId);
    
    // Try to process next queued task
    try {
      await processNextQueuedTask();
    } catch (nextTaskError: any) {
      logger.error(`Failed to process next queued task after timeout: ${nextTaskError.message}`);
    }
    
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
 * Cancels all active polling loops for a demo and all its steps.
 * This prevents stale polling loops from triggering duplicate workflow transitions.
 */
export function cancelAllDemoPolling(baseTaskId: string): void {
  const cancelledTasks: string[] = [];
  
  for (const [taskId, pollingState] of activePolling.entries()) {
    // Cancel if it matches the base taskId or any step variant
    if (taskId === baseTaskId || taskId.startsWith(`${baseTaskId}-step`)) {
      pollingState.cancelled = true;
      cancelledTasks.push(taskId);
      activePolling.delete(taskId);
    }
  }
  
  if (cancelledTasks.length > 0) {
    logger.info(`Cancelled ${cancelledTasks.length} stale polling loop(s) for demo ${baseTaskId}: ${cancelledTasks.join(', ')}`);
  }
}

/**
 * Resumes active detections on startup
 * 
 * FIX: Added comprehensive validation before resuming polling to prevent:
 * - Starting polling for tasks whose state files were corrupted/deleted
 * - Resuming tasks that have been stale for too long
 * - Starting duplicate polling if task was already handled
 */
export async function resumeActiveDetections(): Promise<void> {
  const detectionConfig = config.cursor.agentCompletionDetection;
  if (!detectionConfig || !detectionConfig.enabled) {
    return;
  }

  const { findAllTasks } = await import('../utils/taskScanner');
  const tasks = await findAllTasks();
  
  const maxStaleAge = detectionConfig.maxWaitTime || 3600000; // Use configured maxWaitTime
  const now = Date.now();
  let resumedCount = 0;
  let skippedCount = 0;
  
  for (const task of tasks) {
    if (task.state === WorkflowState.IN_PROGRESS) {
      const state = await loadTaskState(task.clientFolder, task.taskId);
      
      // FIX: Skip if state file is missing or corrupted
      if (!state) {
        logger.warn(`Skipping resume for task ${task.taskId}: state file missing or corrupted`);
        skippedCount++;
        continue;
      }
      
      // FIX: Skip if agentCompletion tracking wasn't started
      if (!state.agentCompletion) {
        logger.debug(`Skipping resume for task ${task.taskId}: no agentCompletion tracking data`);
        skippedCount++;
        continue;
      }
      
      // FIX: Skip if completion was already detected
      if (state.agentCompletion.completionDetectedAt) {
        logger.debug(`Skipping resume for task ${task.taskId}: completion already detected`);
        skippedCount++;
        continue;
      }
      
      // FIX: Check if the detection is stale (started too long ago)
      const detectionStartTime = state.agentCompletion.detectionStartedAt 
        ? new Date(state.agentCompletion.detectionStartedAt).getTime() 
        : now;
      const detectionAge = now - detectionStartTime;
      
      if (detectionAge > maxStaleAge) {
        logger.warn(`Skipping resume for task ${task.taskId}: detection started ${Math.round(detectionAge / 1000)}s ago (exceeds ${Math.round(maxStaleAge / 1000)}s max)`);
        
        // FIX: Mark the task as timed out rather than leaving it in limbo
        try {
          const { updateWorkflowState } = await import('../state/stateManager');
          await updateWorkflowState(task.clientFolder, task.taskId, WorkflowState.ERROR, {
            error: `Detection timed out during server restart (was inactive for ${Math.round(detectionAge / 1000)}s)`,
            timeout: true,
          });
          
          const { agentQueue } = await import('./agentQueue');
          await agentQueue.completeTask(false, 'Detection timed out during server restart', task.taskId);
        } catch (err: any) {
          logger.error(`Failed to mark stale task ${task.taskId} as timed out: ${err.message}`);
        }
        
        skippedCount++;
        continue;
      }
      
      // FIX: Verify the client folder still exists
      if (!(await fs.pathExists(task.clientFolder))) {
        logger.warn(`Skipping resume for task ${task.taskId}: client folder no longer exists at ${task.clientFolder}`);
        skippedCount++;
        continue;
      }
      
      // FIX: Skip if already being polled (shouldn't happen but defensive check)
      if (activePolling.has(task.taskId)) {
        logger.debug(`Skipping resume for task ${task.taskId}: already being polled`);
        skippedCount++;
        continue;
      }
      
      logger.info(`Resuming completion detection for task ${task.taskId} (detection age: ${Math.round(detectionAge / 1000)}s)`);
      
      const pollingState: PollingState = {
        startTime: detectionStartTime,
        lastCheckTime: Date.now(),
        cancelled: false,
      };

      activePolling.set(task.taskId, pollingState);
      resumedCount++;
      
      // Start polling without awaiting, but ensure errors are properly handled
      pollForCompletion(task.clientFolder, task.taskId, pollingState).catch(async (error) => {
        logger.error(`Fatal error in completion detection for task ${task.taskId}: ${error.message}`);
        
        // Attempt to mark task as failed
        try {
          await updateWorkflowStateOnError(task.clientFolder, task.taskId, error);
          
          const { agentQueue } = await import('./agentQueue');
          await agentQueue.completeTask(false, `Detection error: ${error.message}`, task.taskId);
        } catch (cleanupError: any) {
          logger.error(`Failed to clean up after detection error: ${cleanupError.message}`);
        }
        
        activePolling.delete(task.taskId);
      });
    }
  }
  
  if (resumedCount > 0 || skippedCount > 0) {
    logger.info(`Completion detection resume complete: ${resumedCount} resumed, ${skippedCount} skipped`);
  }
}

/**
 * Utility function to sleep/delay
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

