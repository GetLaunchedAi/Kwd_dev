import { spawn } from 'child_process';
import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ClickUpTask } from '../clickup/apiClient';
import * as fse from 'fs-extra';

const execAsync = promisify(exec);

export interface AgentTriggerOptions {
  model?: string;
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
 * Attempts to trigger Cursor agent programmatically
 */
export async function triggerAgent(
  clientFolder: string,
  taskFilePath: string,
  task: ClickUpTask,
  options?: AgentTriggerOptions
): Promise<void> {
    const triggerMode = config.cursor.triggerMode || 'queue';
    const method = config.cursor.agentTriggerMethod || 'file';
    
    
    // ALWAYS use CLI runner for autonomous execution to ensure tasks actually run
    // instead of idling in the editor.
    const { CursorCliRunner } = await import('./runner');
    const fs = await import('fs-extra');
    
    logger.info(`Triggering autonomous execution for task ${task.id} in ${clientFolder}`);
    logger.info(`Trigger mode: ${triggerMode}, Method: ${method}`);
    
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
          await updateWorkflowState(clientFolder, task.id, WorkflowState.ERROR, {
            error: result.error || `Process exited with code ${result.exitCode}`
          });
          
          // Update demo status if this is a demo task so frontend UI reflects the failure
          await updateDemoStatusOnFailure(clientFolder, task.id, result.error || `Agent exited with code ${result.exitCode}`);
        }
      } catch (err: any) {
        logger.error(`Error running cursor-agent via autonomous runner: ${err.message}`);
        
        // Critical: Update workflow state to ERROR so the task doesn't get stuck
        try {
          const { updateWorkflowState, WorkflowState } = await import('../state/stateManager');
          await updateWorkflowState(clientFolder, task.id, WorkflowState.ERROR, {
            error: `Agent runner error: ${err.message}`
          });
          
          // Update demo status if this is a demo task
          await updateDemoStatusOnFailure(clientFolder, task.id, `Agent error: ${err.message}`);
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

/**
 * Verifies that Cursor is open for the given workspace
 */
async function verifyCursorWorkspace(clientFolder: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execAsync('tasklist /FI "IMAGENAME eq Cursor.exe" /NH');
      if (!stdout.includes('Cursor.exe')) {
        logger.warn('Cursor process not found. It should be running to process the queue.');
      } else {
        logger.info('Cursor process verified as running.');
      }
    }
    // On other platforms, we just assume it's running or let the openCursorWorkspace handle it
  } catch (error) {
    logger.warn('Could not verify Cursor process state');
  }
}

/**
 * Creates task file - agent will pick it up automatically (file-based trigger)
 * This is the fallback/rollback method for UI mode.
 */
async function triggerViaFile(workspaceDir: string, taskFilePath: string): Promise<void> {
  logger.info(`Task file available at ${taskFilePath}`);
  
  // Load the .cursorrules template
  const templatePath = path.join(__dirname, 'cursorrules.template.md');
  let cursorRulesContent: string;
  
  try {
    cursorRulesContent = await fse.readFile(templatePath, 'utf-8');
    logger.info(`Loaded .cursorrules template from ${templatePath}`);
  } catch (error) {
    // Fallback to inline content if template file not found
    logger.warn(`Could not load .cursorrules template, using inline version`);
    cursorRulesContent = `# Single-Shot Agent Protocol

You are an automated Cursor agent. You are invoked to handle exactly one task and then exit.

## Task Initialization
- **Read Instructions**: Immediately read the \`CURSOR_TASK.md\` file in this directory (${taskFilePath}).
- Follow ALL instructions in that file carefully.

## Execution
1. Implement the requested changes
2. Test your changes if a test command is provided
3. Update .cursor/status/current.json with your progress
4. Commit changes with message format: task: [taskId] description
5. EXIT immediately when done

---
Generated: ${new Date().toISOString()}
`;
  }
  
  // Create/update .cursorrules to direct the agent to the task file
  const cursorRulesPath = path.join(workspaceDir, '.cursorrules');
  
  try {
    await fse.writeFile(cursorRulesPath, cursorRulesContent, 'utf-8');
    logger.info(`Updated .cursorrules file at ${cursorRulesPath}`);
    
  } catch (error: any) {
    logger.warn(`Could not update .cursorrules file: ${error.message}`);
  }
  
  logger.info('NOTE: Open Cursor Composer (Ctrl+I) to trigger the agent to process the task.');
}
