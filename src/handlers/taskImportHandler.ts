import { logger } from '../utils/logger';
import { validateTaskImport, TaskImportInput } from '../utils/importValidator';
import { updateWorkflowState, saveTaskInfo, WorkflowState } from '../state/stateManager';
import { mapTaskToClient } from '../utils/clientMappingManager';
import { processTask } from '../workflow/workflowOrchestrator';
import { config } from '../config/config';
import { clickUpApiClient } from '../clickup/apiClient';

export interface ImportTaskOptions {
  taskId: string;
  providedClientName?: string;
  triggerWorkflow?: boolean;
}

export interface ImportTaskResult {
  success: boolean;
  taskId: string;
  taskName?: string;
  clientName?: string;
  clientFolder?: string;
  workflowStarted?: boolean;
  error?: string;
  suggestions?: string[];
  warnings?: string[];
  message?: string;
}

/**
 * Main function to import a task from ClickUp
 * Performs validation, saves task state, and optionally triggers workflow
 */
export async function importTask(options: ImportTaskOptions): Promise<ImportTaskResult> {
  const { taskId, providedClientName, triggerWorkflow = false } = options;

  try {
    logger.info(`Starting import for task ${taskId}${providedClientName ? ` with client override: ${providedClientName}` : ''}`);

    // Step 1: Fetch task from ClickUp
    let task;
    try {
      task = await clickUpApiClient.getTask(taskId);
      logger.debug(`Fetched task from ClickUp: ${task.name} (${task.id})`);
    } catch (error: any) {
      logger.error(`Failed to fetch task ${taskId} from ClickUp: ${error.message}`);
      return {
        success: false,
        taskId,
        error: `Task not found in ClickUp: ${error.message}`,
        suggestions: [
          'Verify the task ID is correct',
          'Check if the task exists in ClickUp',
          'Ensure you have permission to access this task',
        ],
      };
    }

    // Step 2: Validate task can be imported
    const validationInput: TaskImportInput = {
      taskId: task.id,
      taskName: task.name,
      providedClientName,
      fullTask: task,
    };

    const validation = await validateTaskImport(validationInput);
    
    if (!validation.valid) {
      logger.warn(`Validation failed for task ${taskId}: ${validation.error}`);
      return {
        success: false,
        taskId: task.id,
        taskName: task.name,
        error: validation.error,
        suggestions: validation.suggestions,
      };
    }

    const { clientName, clientFolder, warnings } = validation;

    if (!clientName || !clientFolder) {
      // This should never happen if validation passed, but TypeScript safety
      return {
        success: false,
        taskId: task.id,
        taskName: task.name,
        error: 'Internal error: Client name or folder missing after successful validation',
        suggestions: ['Try again or contact support'],
      };
    }

    // Step 3: Save manual mapping if client name was provided
    if (providedClientName && typeof providedClientName === 'string' && providedClientName.trim()) {
      try {
        await mapTaskToClient(task.id, clientName);
        logger.info(`Saved manual mapping: ${task.id} -> ${clientName}`);
      } catch (error: any) {
        logger.warn(`Could not save manual mapping for task ${task.id}: ${error.message}`);
        // Not a critical error, continue with import
      }
    }

    // Step 4: Initialize task state and info (makes it appear in frontend)
    await updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING);
    await saveTaskInfo(clientFolder, task.id, {
      task,
      taskId: task.id,
      clientName,
      clientFolder,
    });

    logger.info(`Task ${task.id} state initialized: ${clientName} (${clientFolder})`);

    // Step 5: Optionally trigger workflow if status matches
    let workflowStarted = false;
    let statusNote: string | undefined;

    if (triggerWorkflow) {
      if (task.status.status === config.clickup.triggerStatus) {
        logger.info(`Status matches trigger status (${config.clickup.triggerStatus}), starting workflow for task ${task.id}`);
        
        // Run workflow asynchronously (don't wait for completion)
        processTask(task).catch((error: any) => {
          logger.error(`Error processing workflow for task ${task.id}: ${error.message}`);
        });
        
        workflowStarted = true;
      } else {
        statusNote = `Task status "${task.status.status}" does not match trigger status "${config.clickup.triggerStatus}". Change status to trigger workflow automatically.`;
        logger.debug(statusNote);
      }
    }

    // Step 6: Return success result
    return {
      success: true,
      taskId: task.id,
      taskName: task.name,
      clientName,
      clientFolder,
      workflowStarted,
      warnings,
      message: workflowStarted
        ? `Task imported successfully and workflow started`
        : `Task imported successfully${statusNote ? `. ${statusNote}` : ''}`,
    };
  } catch (error: any) {
    logger.error(`Unexpected error during task import: ${error.message}`, error);
    return {
      success: false,
      taskId,
      error: `Unexpected error: ${error.message}`,
      suggestions: ['Check server logs for details', 'Try again'],
    };
  }
}

/**
 * Batch import multiple tasks
 * Returns individual results for each task
 */
export async function importTasksBatch(
  taskIds: string[],
  options?: { triggerWorkflow?: boolean }
): Promise<{
  total: number;
  imported: number;
  failed: number;
  results: ImportTaskResult[];
}> {
  logger.info(`Starting batch import for ${taskIds.length} tasks`);
  
  const results: ImportTaskResult[] = [];
  let imported = 0;
  let failed = 0;

  for (const taskId of taskIds) {
    const result = await importTask({
      taskId,
      triggerWorkflow: options?.triggerWorkflow,
    });
    
    results.push(result);
    
    if (result.success) {
      imported++;
    } else {
      failed++;
    }
  }

  logger.info(`Batch import completed: ${imported} imported, ${failed} failed`);

  return {
    total: taskIds.length,
    imported,
    failed,
    results,
  };
}

/**
 * Preview what would happen if a task were imported
 * Does not actually import, just validates and returns info
 */
export async function previewTaskImport(
  taskId: string,
  providedClientName?: string
): Promise<{
  canImport: boolean;
  taskName?: string;
  clientName?: string;
  clientFolder?: string;
  error?: string;
  suggestions?: string[];
  warnings?: string[];
  determinationMethod?: string;
}> {
  try {
    logger.debug(`Previewing import for task ${taskId}`);

    // Fetch task from ClickUp
    let task;
    try {
      task = await clickUpApiClient.getTask(taskId);
    } catch (error: any) {
      return {
        canImport: false,
        error: `Task not found in ClickUp: ${error.message}`,
        suggestions: ['Verify the task ID is correct'],
      };
    }

    // Validate without importing
    const validationInput: TaskImportInput = {
      taskId: task.id,
      taskName: task.name,
      providedClientName,
      fullTask: task,
    };

    const validation = await validateTaskImport(validationInput);

    return {
      canImport: validation.valid,
      taskName: task.name,
      clientName: validation.clientName,
      clientFolder: validation.clientFolder,
      error: validation.error,
      suggestions: validation.suggestions,
      warnings: validation.warnings,
      determinationMethod: (validation as any).determinationMethod,
    };
  } catch (error: any) {
    logger.error(`Error previewing import for task ${taskId}: ${error.message}`);
    return {
      canImport: false,
      error: `Preview error: ${error.message}`,
      suggestions: ['Try again'],
    };
  }
}








