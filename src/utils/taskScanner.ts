import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from './logger';
import { loadTaskState, loadTaskInfo, TaskState, TaskInfo } from '../state/stateManager';

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

  try {
    // Check both githubCloneAllDir and githubCloneAllDir/client-websites
    const searchDirs = [
      githubCloneAllDir,
      path.join(githubCloneAllDir, 'client-websites')
    ].filter(dir => fs.existsSync(dir));

    for (const searchDir of searchDirs) {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const clientFolder = path.join(searchDir, entry.name);
        const workflowDir = path.join(clientFolder, '.clickup-workflow');

      if (!fs.existsSync(workflowDir)) {
        continue;
      }

      try {
        const taskDirs = await fs.readdir(workflowDir, { withFileTypes: true });

        for (const taskDir of taskDirs) {
          if (!taskDir.isDirectory()) {
            continue;
          }

          const taskId = taskDir.name;
          const taskState = await loadTaskState(clientFolder, taskId);
          const taskInfo = await loadTaskInfo(clientFolder, taskId);

          if (taskState) {
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
            });
          }
        }
        } catch (error: any) {
          logger.warn(`Error scanning workflow directory ${workflowDir}: ${error.message}`);
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
    const searchDirs = [
      githubCloneAllDir,
      path.join(githubCloneAllDir, 'client-websites')
    ].filter(dir => fs.existsSync(dir));

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
 * Deletes a task by ID by removing its directory in .clickup-workflow
 */
export async function deleteTaskById(taskId: string): Promise<boolean> {
  const { clientFolder } = await findTaskById(taskId);
  
  if (!clientFolder) {
    logger.warn(`Task ${taskId} not found for deletion`);
    return false;
  }

  const taskDir = path.join(clientFolder, '.clickup-workflow', taskId);
  
  try {
    if (fs.existsSync(taskDir)) {
      await fs.remove(taskDir);
      logger.info(`Deleted task ${taskId} from ${clientFolder}`);
      return true;
    }
    return false;
  } catch (error: any) {
    logger.error(`Error deleting task ${taskId}: ${error.message}`);
    throw error;
  }
}

/**
 * Deletes all tasks by removing all .clickup-workflow directories
 */
export async function deleteAllTasks(): Promise<{
  deletedCount: number;
  errors: string[];
}> {
  let deletedCount = 0;
  const errors: string[] = [];
  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');

  if (!fs.existsSync(githubCloneAllDir)) {
    logger.warn(`Github clone all directory does not exist: ${githubCloneAllDir}`);
    return { deletedCount: 0, errors: [] };
  }

  try {
    // Check both githubCloneAllDir and githubCloneAllDir/client-websites
    const searchDirs = [
      githubCloneAllDir,
      path.join(githubCloneAllDir, 'client-websites')
    ].filter(dir => fs.existsSync(dir));

    for (const searchDir of searchDirs) {
      const entries = await fs.readdir(searchDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const clientFolder = path.join(searchDir, entry.name);
        const workflowDir = path.join(clientFolder, '.clickup-workflow');

        if (!fs.existsSync(workflowDir)) {
          continue;
        }

        try {
          // Count tasks before deletion
          const taskDirs = await fs.readdir(workflowDir, { withFileTypes: true });
          const taskCount = taskDirs.filter(dir => dir.isDirectory()).length;
          
          // Delete the entire workflow directory
          await fs.remove(workflowDir);
          deletedCount += taskCount;
          logger.info(`Deleted ${taskCount} task(s) from ${clientFolder}`);
        } catch (error: any) {
          const errorMsg = `Error deleting tasks from ${clientFolder}: ${error.message}`;
          logger.error(errorMsg);
          errors.push(errorMsg);
        }
      }
    }
  } catch (error: any) {
    const errorMsg = `Error scanning github clone all directory: ${error.message}`;
    logger.error(errorMsg);
    errors.push(errorMsg);
  }

  logger.info(`Total tasks deleted: ${deletedCount}`);
  return { deletedCount, errors };
}

