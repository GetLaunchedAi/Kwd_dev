import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { ClickUpTask } from '../clickup/apiClient';
import { categorizeError } from '../utils/errorCategorizer';
import * as fse from 'fs-extra';

export interface AgentTriggerOptions {
  model?: string;
}

/**
 * FIX: Helper function to extract step number from task ID or demo status
 * Returns { stepNumber, stepName } for demo tasks, or null for non-demo tasks
 */
async function getStepInfoFromTask(clientFolder: string, taskId: string): Promise<{ stepNumber: number; stepName: string } | null> {
  if (!taskId.startsWith('demo-')) {
    return null;
  }
  
  // Parse step number from taskId: "demo-xyz" is step 1, "demo-xyz-step2" is step 2, etc.
  const stepMatch = taskId.match(/-step(\d+)$/);
  let stepNumber = 1; // Default to step 1 if no step suffix
  
  if (stepMatch) {
    const parsed = parseInt(stepMatch[1], 10);
    if (!isNaN(parsed) && parsed >= 1 && parsed <= 10) {
      stepNumber = parsed;
    }
  }
  
  // Try to get step from demo.status.json for more accuracy
  try {
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (fse.existsSync(demoStatusPath)) {
      const status = await fse.readJson(demoStatusPath);
      if (status.currentStep && typeof status.currentStep === 'number') {
        stepNumber = status.currentStep;
      }
    }
  } catch (e) {
    // Use parsed step number as fallback
  }
  
  const stepNames = ['branding', 'copywriting', 'imagery', 'review'];
  const stepName = stepNames[stepNumber - 1] || 'unknown';
  
  return { stepNumber, stepName };
}

/**
 * FIX: Helper function to update demo status on failure
 * Extracted to avoid code duplication and ensure consistent error handling
 */
async function updateDemoStatusOnFailure(clientFolder: string, taskId: string, errorMessage: string): Promise<void> {
  if (!taskId.startsWith('demo-')) {
    return;
  }
  
  try {
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (fse.existsSync(demoStatusPath)) {
      const status = await fse.readJson(demoStatusPath);
      status.state = 'failed';
      status.message = errorMessage;
      status.updatedAt = new Date().toISOString();
      await fse.writeJson(demoStatusPath, status, { spaces: 2 });
      
      // Also update active-demos.json audit log for consistency
      const activeDemosPath = path.join(process.cwd(), 'logs', 'active-demos.json');
      if (fse.existsSync(activeDemosPath)) {
        const clientSlug = path.basename(clientFolder);
        const activeDemos = await fse.readJson(activeDemosPath);
        if (activeDemos[clientSlug]) {
          activeDemos[clientSlug].state = 'failed';
          activeDemos[clientSlug].message = status.message;
          activeDemos[clientSlug].updatedAt = status.updatedAt;
          activeDemos[clientSlug]._lastAuditUpdate = new Date().toISOString();
          await fse.writeJson(activeDemosPath, activeDemos, { spaces: 2 });
        }
      }
    }
  } catch (demoStatusErr: any) {
    logger.warn(`Could not update demo status on failure: ${demoStatusErr.message}`);
  }
}

/**
 * FIX: Marks a step as failed so error recovery can work
 * This is CRITICAL for the retry/skip functionality to function properly
 */
async function markDemoStepAsFailed(
  clientFolder: string, 
  taskId: string, 
  errorCategory: string, 
  errorMessage: string
): Promise<void> {
  const stepInfo = await getStepInfoFromTask(clientFolder, taskId);
  if (!stepInfo) {
    return; // Not a demo task
  }
  
  try {
    // Get the parent taskId (for step 2+, we need the base demo ID)
    const baseTaskId = taskId.replace(/-step\d+$/, '');
    
    const { markStepFailed, loadTaskState } = await import('../state/stateManager');
    
    // Get last checkpoint hash if available
    const state = await loadTaskState(clientFolder, baseTaskId);
    const lastCheckpointHash = state?.lastCheckpoint?.gitCommitHash;
    
    await markStepFailed(
      clientFolder,
      baseTaskId, // Always use base task ID for state
      stepInfo.stepNumber,
      stepInfo.stepName,
      errorCategory,
      errorMessage,
      lastCheckpointHash
    );
    
    logger.info(`Marked step ${stepInfo.stepNumber} (${stepInfo.stepName}) as failed for ${baseTaskId}: ${errorCategory}`);
  } catch (err: any) {
    logger.error(`Failed to mark step as failed for ${taskId}: ${err.message}`);
  }
}

/**
 * Attempts to trigger Cursor agent programmatically.
 *
 * DUAL COMPLETION DETECTION (Phase 3.5 documentation):
 * There are two independent paths that can detect agent completion and call
 * continueWorkflowAfterAgent():
 *
 *   1. **Runner exit handler (PRIMARY)**: When the CursorCliRunner process exits
 *      (see runPromise below), the .then() handler calls continueWorkflowAfterAgent
 *      immediately. This is the fast, reliable path for normal execution.
 *
 *   2. **Polling-based agentCompletionDetector (SAFETY NET)**: Started by the
 *      caller (triggerCursorAgent / launchAgentForTask) after this function returns.
 *      It polls .cursor/status/current.json and heartbeat timestamps. If the runner
 *      exit handler fails (e.g. process crash without exit event), the detector
 *      catches it via stale-heartbeat detection.
 *
 * The workflow orchestrator's lock mechanism prevents duplicate execution if both
 * paths fire. When the detector's call is deduplicated, a log message is emitted
 * so operators can confirm the safety net is working as intended.
 */
export async function triggerAgent(
  clientFolder: string,
  taskFilePath: string,
  task: ClickUpTask,
  options?: AgentTriggerOptions
): Promise<void> {
    // ALWAYS use CLI runner for autonomous execution to ensure tasks actually run
    // instead of idling in the editor.
    const { CursorCliRunner } = await import('./runner');
    const fs = await import('fs-extra');
    
    logger.info(`Triggering autonomous execution for task ${task.id} in ${clientFolder}`);
    
    let prompt = '';
    try {
      prompt = await fs.readFile(taskFilePath, 'utf-8');
      logger.debug(`Loaded task prompt from ${taskFilePath} (${prompt.length} chars)`);
    } catch (err) {
      logger.warn(`Could not read task file at ${taskFilePath}, using task ID as fallback`);
      prompt = `Task ID: ${task.id}`;
    }

    const runner = new CursorCliRunner({
      workspacePath: clientFolder,
      taskId: task.id,
      prompt: prompt,
      timeoutMs: config.cursor.timeoutMs || 0,
      model: options?.model
    });

    // We don't await here to allow the system to continue while the agent runs
    // FIX: Wrap the entire promise chain in a try-catch to prevent unhandled rejections
    // if errors occur inside the .then() or .catch() handlers themselves
    const runPromise = (async () => {
      try {
        const result = await runner.run();
        
        if (result.exitCode === 0) {
          logger.info(`Task ${task.id} completed successfully via autonomous runner. Continuing workflow...`);
          try {
            const { continueWorkflowAfterAgent } = await import('../workflow/workflowOrchestrator');
            await continueWorkflowAfterAgent(clientFolder, task.id);
          } catch (workflowErr: any) {
            // FIX: Handle errors from workflow continuation to prevent unhandled rejection
            logger.error(`Error in workflow continuation for task ${task.id}: ${workflowErr.message}`);
            const { updateWorkflowState, WorkflowState } = await import('../state/stateManager');
            await updateWorkflowState(clientFolder, task.id, WorkflowState.ERROR, {
              error: `Workflow continuation error: ${workflowErr.message}`
            }).catch(e => logger.error(`Failed to update state: ${e.message}`));
          }
        } else {
          logger.error(`Task ${task.id} failed via autonomous runner with code ${result.exitCode}.`);
          const { updateWorkflowState, WorkflowState } = await import('../state/stateManager');
          
          // Phase 4.2: Use centralized error categorization
          const categorized = categorizeError({
            message: result.error || `Process exited with code ${result.exitCode}`,
            creditError: result.creditError,
            modelError: result.modelError,
            failedModel: result.failedModel,
          });
          const errorInfo: Record<string, any> = {
            ...categorized,
            exitCode: result.exitCode,
          };
          // Preserve explicit runner category when categorizer returns 'unknown'
          if (categorized.errorCategory === 'unknown' && result.errorCategory) {
            errorInfo.errorCategory = result.errorCategory;
          }
          const errorCategory = errorInfo.errorCategory || 'unknown';
          const userMessage = categorized.userMessage || result.error || `Agent exited with code ${result.exitCode}`;

          if (categorized.creditError) {
            logger.error(`[CREDIT EXHAUSTED] Task ${task.id} failed due to credit limit`);
          }
          
          await updateWorkflowState(clientFolder, task.id, WorkflowState.ERROR, errorInfo);
          
          // FIX: Mark the step as failed so error recovery (retry/skip) can work
          // This populates the failedStep field that continueAfterError depends on
          await markDemoStepAsFailed(clientFolder, task.id, errorCategory, userMessage);
          
          // Update demo status if this is a demo task so frontend UI reflects the failure
          await updateDemoStatusOnFailure(clientFolder, task.id, userMessage);
        }
      } catch (err: any) {
        logger.error(`Error running cursor-agent via autonomous runner: ${err.message}`);
        
        // Critical: Update workflow state to ERROR so the task doesn't get stuck
        try {
          const { updateWorkflowState, WorkflowState } = await import('../state/stateManager');
          const errorMessage = `Agent runner error: ${err.message}`;
          
          await updateWorkflowState(clientFolder, task.id, WorkflowState.ERROR, {
            error: errorMessage
          });
          
          // FIX: Mark the step as failed for error recovery to work
          await markDemoStepAsFailed(clientFolder, task.id, 'unknown', errorMessage);
          
          // Update demo status if this is a demo task
          await updateDemoStatusOnFailure(clientFolder, task.id, errorMessage);
        } catch (stateErr: any) {
          logger.error(`Failed to update state after agent error: ${stateErr.message}`);
        }
      }
    })();
    
    // FIX: Attach a final catch to ensure no unhandled rejection can escape
    runPromise.catch((finalErr: any) => {
      logger.error(`Unhandled error in agent trigger promise chain: ${finalErr.message}`);
    });
    
    return;
}

// Dead code removed (Phase 3.4):
// - verifyCursorWorkspace: never called externally; Cursor process check was informational only
// - triggerViaFile: legacy file-based trigger; system always uses CursorCliRunner
