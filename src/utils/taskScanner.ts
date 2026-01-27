import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from './logger';
import { loadTaskState, loadTaskInfo, TaskState, TaskInfo } from '../state/stateManager';
import { agentQueue } from '../cursor/agentQueue';
import { taskCleanupService } from '../cursor/taskCleanupService';
import { cancelCompletionDetection } from '../cursor/agentCompletionDetector';

export interface TaskListItem {
  taskId: string;
  taskName: string;
  clientName?: string;
  clientFolder: string;
  state: string;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
  clickUpUrl?: string;
  description?: string;
  currentStep?: string;
  metadata?: Record<string, any>;
}

/**
 * Scans all client folders and finds all tasks
 */
export async function findAllTasks(): Promise<TaskListItem[]> {
  const tasks: TaskListItem[] = [];
  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');

  if (!fs.existsSync(githubCloneAllDir)) {
    logger.warn(`Github clone all directory does not exist: ${githubCloneAllDir}`);
    return tasks;
  }

  // No longer fetching global agent status from repo root
  // let agentStatus = null;
  // try {
  //   agentStatus = await agentQueue.getStatus();
  // } catch (error) {
  //   logger.warn(`Could not fetch agent status: ${error}`);
  // }

  try {
    const isAlreadyInClientWebsites = githubCloneAllDir.endsWith('client-websites') || 
                                     githubCloneAllDir.endsWith('client-websites' + path.sep);
    
    const searchDirs = Array.from(new Set([
      githubCloneAllDir,
      ...(isAlreadyInClientWebsites ? [] : [path.join(githubCloneAllDir, 'client-websites')])
    ])).filter(dir => fs.existsSync(dir));

    for (const searchDir of searchDirs) {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const clientFolder = path.join(searchDir, entry.name);
        const workflowDir = path.join(clientFolder, '.clickup-workflow');
        
        if (!(await fs.pathExists(workflowDir))) continue;

        const taskDirs = await fs.readdir(workflowDir, { withFileTypes: true });

        for (const taskDir of taskDirs) {
          if (!taskDir.isDirectory()) continue;

          const taskId = taskDir.name;
          const taskState = await loadTaskState(clientFolder, taskId);
          const taskInfo = await loadTaskInfo(clientFolder, taskId);

          if (taskState) {
            // Check for local agent status in client folder
            let currentStep = taskState.currentStep;
            
            try {
              const localStatusPath = path.join(clientFolder, '.cursor', 'status', 'current.json');
              if (await fs.pathExists(localStatusPath)) {
                const localStatus = await fs.readJson(localStatusPath);
                if (localStatus && localStatus.task && localStatus.task.taskId === taskId) {
                  currentStep = localStatus.step;
                }
              }
            } catch (err) {
              // Ignore errors reading local status
            }

            if (!currentStep && (taskState.state === 'in_progress' || taskState.state === 'pending')) {
              if (await agentQueue.isTaskQueued(taskId)) {
                currentStep = 'Waiting in queue';
              } else if (await agentQueue.isTaskRunning(taskId)) {
                currentStep = 'Starting agent...';
              }
            }

            // For demo tasks, enrich with demo step number from demo status
            let metadata = taskState.metadata;
            if (taskId.startsWith('demo-') && !taskId.match(/demo-.+-step\d+$/)) {
              try {
                const { getDemoStatus } = await import('../handlers/demoHandler');
                const clientSlug = taskId.replace(/^demo-/, '');
                const demoStatus = await getDemoStatus(clientSlug);
                if (demoStatus && demoStatus.currentStep) {
                  metadata = { ...metadata, demoStep: demoStatus.currentStep };
                }
              } catch (err) {
                // Ignore errors fetching demo status
              }
            }

            tasks.push({
              taskId,
              taskName: taskInfo?.task?.name || taskId,
              clientName: taskInfo?.clientName,
              clientFolder,
              state: taskState.state,
              branchName: taskState.branchName,
              createdAt: taskState.createdAt,
              updatedAt: taskState.updatedAt,
              clickUpUrl: taskInfo?.task?.url,
              description: taskInfo?.task?.description,
              currentStep: currentStep,
              metadata: metadata,
            });
          }
        }
      }
    }
  } catch (error: any) {
    logger.error(`Error scanning github clone all directory: ${error.message}`);
  }

  // Sort by updatedAt descending (most recent first)
  tasks.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  return tasks;
}

/**
 * Finds a task by ID across all client folders
 */
export async function findTaskById(taskId: string): Promise<{
  taskState: TaskState | null;
  taskInfo: TaskInfo | null;
  clientFolder: string | null;
}> {
  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');

  if (!fs.existsSync(githubCloneAllDir)) {
    logger.warn(`Github clone all directory does not exist: ${githubCloneAllDir}`);
    return { taskState: null, taskInfo: null, clientFolder: null };
  }

  try {
    // Check both githubCloneAllDir and githubCloneAllDir/client-websites
    const isAlreadyInClientWebsites = githubCloneAllDir.endsWith('client-websites') || 
                                     githubCloneAllDir.endsWith('client-websites' + path.sep);
    
    const searchDirs = Array.from(new Set([
      githubCloneAllDir,
      ...(isAlreadyInClientWebsites ? [] : [path.join(githubCloneAllDir, 'client-websites')])
    ])).filter(dir => fs.existsSync(dir));


    for (const searchDir of searchDirs) {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const clientFolder = path.join(searchDir, entry.name);
        const taskState = await loadTaskState(clientFolder, taskId);
        const taskInfo = await loadTaskInfo(clientFolder, taskId);

        if (taskState) {
          return { taskState, taskInfo, clientFolder };
        }
      }
    }
  } catch (error: any) {
    logger.error(`Error finding task ${taskId}: ${error.message}`);
  }

  return { taskState: null, taskInfo: null, clientFolder: null };
}

/**
 * Deletes a task by ID by removing ALL task artifacts
 * 
 * Removes:
 * - .cursor/status/{taskId}.json
 * - .cursor/status/current.json (if it references this task)
 * - .cursor/queue/*_{taskId}.md
 * - .cursor/running/*_{taskId}.md
 * - .cursor/done/*_{taskId}.md
 * - .cursor/failed/*_{taskId}.md
 * - .cursor/logs/{taskId}.ndjson
 * - .cursor/logs/{taskId}.stderr.log
 * - logs/tasks/{taskId}/
 * - {clientFolder}/.clickup-workflow/{taskId}/
 * - public/screenshots/{taskId}/ (task screenshots)
 * 
 * @param taskId - The task ID to delete
 * @returns Promise<boolean> - True if task was found and deleted, false if not found
 * @throws Error if deletion fails
 */
export async function deleteTaskById(taskId: string): Promise<boolean> {
  logger.info(`[DELETE] Starting deletion of task ${taskId}`);
  
  // Find the task to get its client folder
  const { clientFolder } = await findTaskById(taskId);
  
  if (!clientFolder) {
    // Task not found in client folders, but we should still clean up orphaned artifacts
    logger.warn(`[DELETE] Task ${taskId} not found in any client folder, but will clean up orphaned artifacts`);
    
    // Cancel any stale polling for orphaned task
    cancelCompletionDetection(taskId);
    
    try {
      // Clean up any orphaned artifacts even if task is not in client folder
      await taskCleanupService.deleteTaskArtifacts(taskId);
      logger.info(`[DELETE] Cleaned up orphaned artifacts for task ${taskId}`);
      return true; // Return true because we did clean up artifacts
    } catch (error: any) {
      logger.error(`[DELETE] Error cleaning up orphaned artifacts for task ${taskId}: ${error.message}`);
      throw error;
    }
  }

  // Check if task is currently running BEFORE canceling polling
  const isRunning = await taskCleanupService.isTaskRunning(taskId, clientFolder);
  
  if (isRunning) {
    // DON'T cancel polling if task is running - we're going to throw an error
    const errorMsg = `Cannot delete task ${taskId}: Task is currently running. Please wait for the task to complete or cancel it first.`;
    logger.error(`[DELETE] ${errorMsg}`);
    throw new Error(errorMsg);
  }

  // CRITICAL: Cancel any active completion detection polling AFTER confirming task is not running
  // This prevents the polling loop from recreating task state after deletion
  cancelCompletionDetection(taskId);

  try {
    // Use the comprehensive cleanup service to remove ALL artifacts
    await taskCleanupService.deleteTaskArtifacts(taskId, clientFolder);
    
    logger.info(`[DELETE] ✓ Successfully deleted task ${taskId} and all its artifacts`);
    return true;
  } catch (error: any) {
    logger.error(`[DELETE] ✗ Error deleting task ${taskId}: ${error.message}`);
    throw error;
  }
}

/**
 * Deletes all tasks by removing all task artifacts
 * 
 * This will:
 * 1. Find all tasks across all client folders
 * 2. Delete all artifacts for each task (using TaskCleanupService)
 * 3. Return count of deleted tasks and any errors
 * 
 * @returns Promise with deletedCount and errors array
 */
export async function deleteAllTasks(): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  let deletedCount = 0;
  const errors: string[] = [];
  
  logger.info('[DELETE-ALL] Starting deletion of all tasks');

  try {
    // Get all tasks first
    const tasks = await findAllTasks();
    
    if (tasks.length === 0) {
      logger.info('[DELETE-ALL] No tasks found to delete');
      return { deletedCount: 0, errors: [] };
    }

    logger.info(`[DELETE-ALL] Found ${tasks.length} tasks to delete`);

    // Delete each task using the cleanup service
    for (const task of tasks) {
      try {
        // Check if task is running BEFORE canceling polling
        const isRunning = await taskCleanupService.isTaskRunning(task.taskId, task.clientFolder);
        
        if (isRunning) {
          // DON'T cancel polling if task is running - we're skipping this task
          const errorMsg = `Cannot delete task ${task.taskId}: Task is currently running`;
          logger.warn(`[DELETE-ALL] ${errorMsg}`);
          errors.push(errorMsg);
          continue;
        }

        // CRITICAL: Cancel any active completion detection polling AFTER confirming task is not running
        // This prevents the polling loop from recreating task state after deletion
        cancelCompletionDetection(task.taskId);

        await taskCleanupService.deleteTaskArtifacts(task.taskId, task.clientFolder);
        deletedCount++;
        logger.info(`[DELETE-ALL] Deleted task ${task.taskId}`);
      } catch (error: any) {
        const errorMsg = `Error deleting task ${task.taskId}: ${error.message}`;
        logger.error(`[DELETE-ALL] ${errorMsg}`);
        errors.push(errorMsg);
      }
    }

    logger.info(`[DELETE-ALL] ✓ Total tasks deleted: ${deletedCount}, Errors: ${errors.length}`);
  } catch (error: any) {
    const errorMsg = `Error during delete all tasks: ${error.message}`;
    logger.error(`[DELETE-ALL] ${errorMsg}`);
    errors.push(errorMsg);
  }

  return { deletedCount, errors };
}

