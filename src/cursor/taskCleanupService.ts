import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

/**
 * TaskCleanupService - Handles complete cleanup of task artifacts
 * 
 * Ensures all task-related files are removed when a task is deleted:
 * - .cursor/status/{taskId}.json (authoritative status)
 * - .cursor/status/current.json (only if it belongs to this task)
 * - .cursor/queue/*_{taskId}.md
 * - .cursor/running/*_{taskId}.md
 * - .cursor/done/*_{taskId}.md
 * - .cursor/failed/*_{taskId}.md
 * - .cursor/logs/{taskId}.ndjson
 * - .cursor/logs/{taskId}.stderr.log
 * - logs/tasks/{taskId}/ directory (all runner logs)
 * - client-folder/.clickup-workflow/{taskId}/ (task state/info)
 * - client-folder/CURSOR_TASK.md (prompt file)
 * - public/screenshots/{taskId}/ directory (task screenshots)
 */
export class TaskCleanupService {
  private workspaceRoot: string;
  private cursorBaseDir: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.workspaceRoot = workspaceRoot;
    this.cursorBaseDir = path.join(workspaceRoot, '.cursor');
  }

  /**
   * Validates that a path is within allowed boundaries (prevent path traversal)
   */
  private validatePath(targetPath: string, allowedRoot: string): boolean {
    const normalizedTarget = path.normalize(path.resolve(targetPath));
    const normalizedRoot = path.normalize(path.resolve(allowedRoot));
    return normalizedTarget.startsWith(normalizedRoot);
  }

  /**
   * Safely removes a file, ignoring ENOENT errors (idempotent)
   */
  private async safeRemoveFile(filePath: string, description: string): Promise<boolean> {
    try {
      if (await fs.pathExists(filePath)) {
        await fs.remove(filePath);
        logger.info(`[CLEANUP] Removed ${description}: ${filePath}`);
        return true;
      } else {
        logger.debug(`[CLEANUP] ${description} does not exist (already removed): ${filePath}`);
        return false;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // File was already deleted (race condition or concurrent cleanup)
        logger.debug(`[CLEANUP] ${description} already removed: ${filePath}`);
        return false;
      }
      logger.error(`[CLEANUP] Error removing ${description} at ${filePath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Safely removes a directory, ignoring ENOENT errors (idempotent)
   */
  private async safeRemoveDirectory(dirPath: string, description: string): Promise<boolean> {
    try {
      if (await fs.pathExists(dirPath)) {
        await fs.remove(dirPath);
        logger.info(`[CLEANUP] Removed ${description} directory: ${dirPath}`);
        return true;
      } else {
        logger.debug(`[CLEANUP] ${description} directory does not exist (already removed): ${dirPath}`);
        return false;
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        logger.debug(`[CLEANUP] ${description} directory already removed: ${dirPath}`);
        return false;
      }
      logger.error(`[CLEANUP] Error removing ${description} directory at ${dirPath}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Removes task files from queue directories (.cursor/queue, running, done, failed)
   */
  private async cleanupQueueFiles(taskId: string): Promise<void> {
    const queueDirs = ['queue', 'running', 'done', 'failed'];
    const pattern = new RegExp(`^\\d{4}_${taskId}\\.md$`);

    for (const dirName of queueDirs) {
      const dirPath = path.join(this.cursorBaseDir, dirName);
      
      // Validate path
      if (!this.validatePath(dirPath, this.cursorBaseDir)) {
        logger.error(`[CLEANUP] Path validation failed for ${dirPath}`);
        continue;
      }

      try {
        if (await fs.pathExists(dirPath)) {
          const files = await fs.readdir(dirPath);
          
          for (const file of files) {
            if (pattern.test(file)) {
              const filePath = path.join(dirPath, file);
              await this.safeRemoveFile(filePath, `${dirName} file`);
            }
          }
        }
      } catch (error: any) {
        logger.error(`[CLEANUP] Error scanning ${dirName} directory: ${error.message}`);
      }
    }
  }

  /**
   * Removes task status file (.cursor/status/{taskId}.json)
   */
  private async cleanupStatusFile(taskId: string, clientFolder?: string): Promise<void> {
    // 1. Check workspace root (canonical)
    const workspaceStatusPath = path.join(this.cursorBaseDir, 'status', 'current.json');
    if (this.validatePath(workspaceStatusPath, this.cursorBaseDir)) {
      try {
        if (await fs.pathExists(workspaceStatusPath)) {
          const status = await fs.readJson(workspaceStatusPath);
          if (status.task?.taskId === taskId || status.taskId === taskId) {
            await this.safeRemoveFile(workspaceStatusPath, 'workspace status file');
          }
        }
      } catch (e) {}
    }

    // 2. Check client folder (if provided and different)
    if (clientFolder) {
      const clientStatusPath = path.join(clientFolder, '.cursor', 'status', 'current.json');
      if (this.validatePath(clientStatusPath, clientFolder) && 
          path.resolve(clientStatusPath) !== path.resolve(workspaceStatusPath)) {
        try {
          if (await fs.pathExists(clientStatusPath)) {
            const status = await fs.readJson(clientStatusPath);
            if (status.task?.taskId === taskId || status.taskId === taskId) {
              await this.safeRemoveFile(clientStatusPath, 'client status file');
            }
          }
        } catch (e) {}
      }
    }
  }

  /**
   * Cleans up current.json ONLY if it references this specific taskId
   */
  private async cleanupCurrentJson(taskId: string, clientFolder?: string): Promise<void> {
    const statusDirs = [
      { path: path.join(this.cursorBaseDir, 'status'), root: this.cursorBaseDir }
    ];
    
    if (clientFolder) {
      statusDirs.push({ path: path.join(clientFolder, '.cursor', 'status'), root: clientFolder });
    }

    for (const dirInfo of statusDirs) {
      const currentPath = path.join(dirInfo.path, 'current.json');
      
      if (!this.validatePath(currentPath, dirInfo.root)) {
        continue;
      }

      try {
        if (await fs.pathExists(currentPath)) {
          const currentStatus = await fs.readJson(currentPath);
          
          // Only delete if this task is referenced in current.json
          if (currentStatus.task && currentStatus.task.taskId === taskId) {
            await this.safeRemoveFile(currentPath, `current.json in ${dirInfo.path} (task matched)`);
          }
        }
      } catch (error: any) {
        // Only log error if it's not "file not found"
        if (error.code !== 'ENOENT') {
          logger.debug(`[CLEANUP] Could not process current.json in ${dirInfo.path}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Removes task log files
   */
  private async cleanupCursorLogs(taskId: string, clientFolder?: string): Promise<void> {
    // 1. Workspace root logs
    const workspaceLogsDir = path.join(this.workspaceRoot, 'logs', 'tasks', taskId);
    if (this.validatePath(workspaceLogsDir, this.workspaceRoot)) {
      await this.safeRemoveDirectory(workspaceLogsDir, 'workspace log directory');
    }

    // 2. Client folder logs (if provided and different)
    if (clientFolder) {
      const clientLogsDir = path.join(clientFolder, 'logs', 'tasks', taskId);
      if (this.validatePath(clientLogsDir, clientFolder) && 
          path.resolve(clientLogsDir) !== path.resolve(workspaceLogsDir)) {
        await this.safeRemoveDirectory(clientLogsDir, 'client log directory');
      }
    }

    // 3. Legacy cleanup in .cursor/logs
    const legacyLogsDir = path.join(this.cursorBaseDir, 'logs');
    if (await fs.pathExists(legacyLogsDir)) {
      const logFiles = [
        path.join(legacyLogsDir, `${taskId}.ndjson`),
        path.join(legacyLogsDir, `${taskId}.stderr.log`)
      ];
      for (const logFile of logFiles) {
        if (this.validatePath(logFile, this.cursorBaseDir)) {
          await this.safeRemoveFile(logFile, 'legacy log file');
        }
      }
    }
  }

  /**
   * Removes task runner logs from logs/tasks/{taskId}/
   */
  private async cleanupRunnerLogs(taskId: string, clientFolder?: string): Promise<void> {
    // This is now redundant with cleanupCursorLogs but kept for completeness
    await this.cleanupCursorLogs(taskId, clientFolder);
  }

  /**
   * Removes task artifacts from .cursor/artifacts/{taskId}/
   */
  private async cleanupArtifacts(taskId: string, clientFolder?: string): Promise<void> {
    // 1. Workspace root artifacts
    const workspaceArtifactsDir = path.join(this.cursorBaseDir, 'artifacts', taskId);
    if (this.validatePath(workspaceArtifactsDir, this.cursorBaseDir)) {
      await this.safeRemoveDirectory(workspaceArtifactsDir, 'workspace artifacts');
    }

    // 2. Client folder artifacts (if provided and different)
    if (clientFolder) {
      const clientArtifactsDir = path.join(clientFolder, '.cursor', 'artifacts', taskId);
      if (this.validatePath(clientArtifactsDir, clientFolder) && 
          path.resolve(clientArtifactsDir) !== path.resolve(workspaceArtifactsDir)) {
        await this.safeRemoveDirectory(clientArtifactsDir, 'client artifacts');
      }
    }
  }

  /**
   * Removes task state/info from client folder (.clickup-workflow/{taskId}/)
   */
  private async cleanupClientWorkflow(clientFolder: string, taskId: string): Promise<void> {
    if (!clientFolder) {
      logger.debug(`[CLEANUP] No client folder provided, skipping workflow cleanup`);
      return;
    }

    const taskWorkflowDir = path.join(clientFolder, '.clickup-workflow', taskId);
    
    // Validate path - must be within client folder
    if (!this.validatePath(taskWorkflowDir, clientFolder)) {
      logger.error(`[CLEANUP] Path validation failed for workflow directory: ${taskWorkflowDir}`);
      return;
    }

    await this.safeRemoveDirectory(taskWorkflowDir, 'client workflow');
  }

  /**
   * Removes the CURSOR_TASK.md file from the client folder
   */
  private async cleanupPromptFile(clientFolder: string): Promise<void> {
    if (!clientFolder) return;
    
    const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
    
    // Validate path - must be within client folder
    if (!this.validatePath(promptPath, clientFolder)) {
      logger.error(`[CLEANUP] Path validation failed for prompt file: ${promptPath}`);
      return;
    }

    await this.safeRemoveFile(promptPath, 'CURSOR_TASK.md prompt file');
  }

  /**
   * Removes screenshots for a task from public/screenshots/{taskId}/
   */
  private async cleanupScreenshots(taskId: string): Promise<void> {
    const screenshotsDir = path.join(this.workspaceRoot, 'public', 'screenshots', taskId);
    
    if (!this.validatePath(screenshotsDir, this.workspaceRoot)) {
      logger.error(`[CLEANUP] Path validation failed for screenshots directory: ${screenshotsDir}`);
      return;
    }

    await this.safeRemoveDirectory(screenshotsDir, 'task screenshots');
  }

  /**
   * Removes any tmp files left in .cursor/status/tmp/ for this task
   */
  private async cleanupTmpFiles(taskId: string, clientFolder?: string): Promise<void> {
    const statusDirs = [
      { path: path.join(this.cursorBaseDir, 'status'), root: this.cursorBaseDir }
    ];
    
    if (clientFolder) {
      statusDirs.push({ path: path.join(clientFolder, '.cursor', 'status'), root: clientFolder });
    }

    for (const dirInfo of statusDirs) {
      const tmpDir = path.join(dirInfo.path, 'tmp');
      
      if (!this.validatePath(tmpDir, dirInfo.root)) {
        continue;
      }

      try {
        if (await fs.pathExists(tmpDir)) {
          const files = await fs.readdir(tmpDir);
          const pattern = new RegExp(`^current\\..*\\.json$`);
          
          for (const file of files) {
            if (pattern.test(file)) {
              const filePath = path.join(tmpDir, file);
              // For current.tmp files, we can't easily check taskId without reading each one
              // but we can at least remove them if they match the pattern
              await this.safeRemoveFile(filePath, `tmp file in ${dirInfo.path}`);
            }
          }
        }
      } catch (error: any) {
        if (error.code !== 'ENOENT') {
          logger.debug(`[CLEANUP] Error scanning tmp directory in ${dirInfo.path}: ${error.message}`);
        }
      }
    }
  }

  /**
   * Deletes all artifacts for a specific task
   * 
   * @param taskId - The task ID to clean up
   * @param clientFolder - Optional client folder path (if known)
   * @returns Promise<void>
   * 
   * This operation is idempotent - calling it multiple times is safe.
   */
  public async deleteTaskArtifacts(taskId: string, clientFolder?: string): Promise<void> {
    logger.info(`[CLEANUP] Starting comprehensive cleanup for task ${taskId}`);
    
    try {
      // 1. Clean up queue/running/done/failed files (always in workspace root)
      await this.cleanupQueueFiles(taskId);

      // 2. Clean up status files (check both workspace root and client folder)
      await this.cleanupStatusFile(taskId, clientFolder);
      await this.cleanupCurrentJson(taskId, clientFolder);

      // 3. Clean up log files (check both workspace root and client folder)
      await this.cleanupCursorLogs(taskId, clientFolder);

      // 4. Clean up task artifacts (check both workspace root and client folder)
      await this.cleanupArtifacts(taskId, clientFolder);

      // 5. Clean up tmp files (check both workspace root and client folder)
      await this.cleanupTmpFiles(taskId, clientFolder);

      // 6. Clean up client workflow directory (.clickup-workflow/{taskId}/)
      if (clientFolder) {
        await this.cleanupClientWorkflow(clientFolder, taskId);
        await this.cleanupPromptFile(clientFolder);
      }

      // 7. Clean up screenshots (public/screenshots/{taskId}/)
      await this.cleanupScreenshots(taskId);

      logger.info(`[CLEANUP] ✓ Comprehensive cleanup complete for task ${taskId}`);
    } catch (error: any) {
      logger.error(`[CLEANUP] ✗ Cleanup failed for task ${taskId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Checks if a task is currently running (has a file in .cursor/running/
   * or has a RUNNING state in its status file)
   * 
   * @param taskId - The task ID to check
   * @param clientFolder - Optional client folder path
   * @returns Promise<boolean> - True if task is running
   */
  public async isTaskRunning(taskId: string, clientFolder?: string): Promise<boolean> {
    // 1. Check for file in .cursor/running/ (workspace root)
    const runningDir = path.join(this.cursorBaseDir, 'running');
    const pattern = new RegExp(`^\\d{4}_${taskId}\\.md$`);

    try {
      if (await fs.pathExists(runningDir)) {
        const files = await fs.readdir(runningDir);
        if (files.some(file => pattern.test(file))) {
          return true;
        }
      }
    } catch (error: any) {
      logger.error(`[CLEANUP] Error checking running directory: ${error.message}`);
    }

    // 2. Check status file for RUNNING state
    const statusDirs = [path.join(this.cursorBaseDir, 'status')];
    if (clientFolder) {
      statusDirs.push(path.join(clientFolder, '.cursor', 'status'));
    }

    for (const statusDir of statusDirs) {
      const statusPath = path.join(statusDir, 'current.json');
      try {
        if (await fs.pathExists(statusPath)) {
          const status = await fs.readJson(statusPath);
          // Check if this status file belongs to the task we're interested in
          if (status.task?.taskId === taskId || status.taskId === taskId) {
            if (status.state === 'RUNNING' || status.state === 'running') {
            // Also check heartbeat to ensure it's not a stale "RUNNING" state
            if (status.lastHeartbeat) {
              const heartbeatAge = Date.now() - new Date(status.lastHeartbeat).getTime();
              const maxHeartbeatAge = 120000; // 2 minutes
              if (heartbeatAge < maxHeartbeatAge) {
                return true;
              }
            } else {
              // No heartbeat but state is RUNNING? Assume it might be starting
              return true;
            }
          }
        }
      }
    } catch (error: any) {
        // Ignore parse errors here
      }
    }

    return false;
  }
}

export const taskCleanupService = new TaskCleanupService();

