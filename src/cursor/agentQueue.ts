import * as fs from 'fs-extra';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { logger } from '../utils/logger';
import { ClickUpTask } from '../clickup/apiClient';
import { config } from '../config/config';

export interface TaskMetadata {
  id: string;
  taskId: string;
  client: string;
  clientFolder: string;
  createdAt: string;
  priority: string;
  branch?: string;
}

export interface QueueStatus {
  task?: {
    file: string;
    id: string;
    taskId: string;
  };
  state: 'queued' | 'running' | 'done' | 'failed' | 'stale';
  percent: number;
  step: string;
  lastUpdate: string;
  notes: string[];
  errors: string[];
}

export interface QueueOverview {
  queued: Array<{ taskId: string; file: string; createdAt: string; clientFolder: string; waitTime: number }>;
  running: Array<{ taskId: string; file: string; startedAt: string; clientFolder: string; runTime: number; isStale: boolean }>;
  done: Array<{ taskId: string; file: string; completedAt: string }>;
  failed: Array<{ taskId: string; file: string; failedAt: string; error?: string }>;
  currentStatus: QueueStatus | null;
  healthCheck: {
    isHealthy: boolean;
    issues: string[];
    lastActivity: string | null;
  };
}

export class AgentQueue {
  private baseDir: string;
  private queueDir: string;
  private runningDir: string;
  private doneDir: string;
  private failedDir: string;
  private statusDir: string;
  private tmpDir: string;

  constructor(workspaceRoot: string) {
    this.baseDir = path.join(workspaceRoot, '.cursor');
    this.queueDir = path.join(this.baseDir, 'queue');
    this.runningDir = path.join(this.baseDir, 'running');
    this.doneDir = path.join(this.baseDir, 'done');
    this.failedDir = path.join(this.baseDir, 'failed');
    this.statusDir = path.join(this.baseDir, 'status');
    this.tmpDir = path.join(this.statusDir, 'tmp');
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.queueDir);
    await fs.ensureDir(this.runningDir);
    await fs.ensureDir(this.doneDir);
    await fs.ensureDir(this.failedDir);
    await fs.ensureDir(this.statusDir);
    await fs.ensureDir(this.tmpDir);
    
    // Check for any tasks already in running directory during startup
    const runningFiles = await fs.readdir(this.runningDir);
    if (runningFiles.length > 0) {
      logger.info(`STARTUP: Found ${runningFiles.length} tasks already in the RUNNING directory. Attempting cleanup...`);
      for (const file of runningFiles) {
        const taskIdMatch = file.match(/_([a-zA-Z0-9-]+)\.md$/);
        if (taskIdMatch) {
          const taskId = taskIdMatch[1];
          const statusPath = path.join(this.statusDir, 'current.json');
          if (await fs.pathExists(statusPath)) {
            const status = await fs.readJson(statusPath);
            if (status.state === 'DONE' || status.state === 'FAILED' || status.state === 'done' || status.state === 'failed') {
              logger.info(`Cleaning up finished task ${taskId} from running directory.`);
              await this.completeTask(status.state.toUpperCase() === 'DONE', status.error || undefined, taskId);
            }
          }
        }
      }
    }

    // Same-filesystem check
    await this.checkFilesystem();
    
    await this.ensureGitIgnore();
  }

  private async checkFilesystem(): Promise<void> {
    try {
      const rootStat = await this.getStat(this.baseDir);
      const dirs = [this.queueDir, this.runningDir, this.doneDir, this.failedDir, this.statusDir];
      
      for (const dir of dirs) {
        const dirStat = await this.getStat(dir);
        if (dirStat.dev !== rootStat.dev) {
          const errorMsg = `FATAL: Queue directory ${dir} is on a different filesystem (device ${dirStat.dev}) than ${this.baseDir} (device ${rootStat.dev}). Atomic renames will fail. Please ensure all queue directories are on the same filesystem.`;
          logger.error(errorMsg);
          throw new Error(errorMsg);
        }
      }
      logger.info(`Filesystem validation passed: All queue directories are on the same filesystem (device ${rootStat.dev})`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Directories don't exist yet, which is fine (they'll be created)
        logger.debug('Filesystem check skipped - directories not yet created');
        return;
      }
      throw error;
    }
  }

  /**
   * Validates that source and destination are on the same filesystem before rename
   */
  private async validateRenameCompatibility(source: string, dest: string): Promise<void> {
    try {
      const sourceStat = await fs.stat(source);
      const destDirStat = await fs.stat(path.dirname(dest));
      
      if (sourceStat.dev !== destDirStat.dev) {
        throw new Error(`Cannot atomically rename ${source} to ${dest}: files are on different filesystems (${sourceStat.dev} vs ${destDirStat.dev}). This will cause a slow copy+delete instead of atomic rename.`);
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        // Source doesn't exist, rename will fail anyway
        return;
      }
      throw error;
    }
  }

  // Helper for testing
  private async getStat(p: string): Promise<fs.Stats> {
    return await fs.stat(p);
  }

  private async ensureGitIgnore(): Promise<void> {
    const gitignorePath = path.join(process.cwd(), '.gitignore');
    if (!(await fs.pathExists(gitignorePath))) return;

    const content = await fs.readFile(gitignorePath, 'utf8');
    const linesToAdd = [
      '.cursor/queue/',
      '.cursor/running/',
      '.cursor/done/',
      '.cursor/failed/',
      '.cursor/status/'
    ];

    let updatedContent = content;
    let modified = false;

    for (const line of linesToAdd) {
      if (!content.includes(line)) {
        updatedContent += `\n${line}`;
        modified = true;
      }
    }

    if (modified) {
      await fs.writeFile(gitignorePath, updatedContent, 'utf8');
      logger.info('Updated .gitignore with Cursor queue directories');
    }
  }

  async enqueueTask(task: ClickUpTask, clientFolder: string, branch?: string): Promise<string> {
    const maxTasks = config.cursor.queue?.maxTasksPerWorkspace || 10;
    
    // VALIDATION: Ensure we are not trying to create a task directly in the running folder
    // This enforces the queue -> running lifecycle
    if (this.runningDir.includes(this.queueDir) || this.queueDir.includes(this.runningDir)) {
      // Just a safety check for overlapping paths
    }

    // Use a lock directory to ensure atomic prefix generation
    // Reduced retries from 100 to 10 with exponential backoff
    const lockDir = path.join(this.baseDir, 'enqueue.lock');
    let lockAcquired = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        await fs.mkdir(lockDir);
        lockAcquired = true;
        break;
      } catch (error: any) {
        if ((error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EACCES') && attempts < maxAttempts - 1) {
          attempts++;
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms, etc.
          const backoff = 50 * Math.pow(2, attempts - 1);
          logger.debug(`Lock acquisition attempt ${attempts}/${maxAttempts} failed, retrying in ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        // If we've exhausted retries or hit an unexpected error, throw with context
        throw new Error(`Failed to acquire enqueue lock after ${attempts + 1} attempts: ${error.message} (code: ${error.code})`);
      }
    }

    if (!lockAcquired) {
      throw new Error(`Could not acquire lock for enqueuing task after ${maxAttempts} attempts. Another process may be holding the lock.`);
    }

    try {
      const files = await fs.readdir(this.queueDir);
      const taskFiles = files.filter(f => f.endsWith('.md'));
      
      if (taskFiles.length >= maxTasks) {
        const errorMsg = `Maximum tasks per workspace reached (${maxTasks}). Cannot enqueue more tasks.`;
        logger.error(errorMsg);
        throw new Error(errorMsg);
      }

      const lastNum = taskFiles
        .map(f => parseInt(f.split('_')[0]))
        .filter(n => !isNaN(n))
        .sort((a, b) => b - a)[0] || 0;
      
      const id = (lastNum + 1).toString().padStart(4, '0');
      const fileName = `${id}_${task.id}.md`;
      const filePath = path.join(this.queueDir, fileName);

      // REDIRECT CHECK: If somehow we got a path in runningDir, force it to queueDir
      if (filePath.includes(path.sep + 'running' + path.sep)) {
        const redirectPath = path.join(this.queueDir, fileName);
        logger.warn(`REDIRECTION: Attempted to create task in RUNNING folder. Redirecting to QUEUE: ${redirectPath}`);
        // Continue with filePath set to queueDir
      }

      const metadata: TaskMetadata = {
        id,
        taskId: task.id,
        client: task.custom_fields?.find(f => f.name === 'Client Name')?.value || 'Unknown',
        clientFolder,
        createdAt: new Date().toISOString(),
        priority: task.priority?.priority || 'normal',
        branch: branch || 'main'
      };

      const content = `---
${yaml.dump(metadata)}
---
# Instructions
${task.description || task.name}
`;

      if (Buffer.byteLength(content) > 1024 * 1024) {
        throw new Error('Task size exceeds 1MB limit');
      }

      await fs.writeFile(filePath, content, 'utf8');
      logger.info(`LIFECYCLE: Task ${task.id} initialized in QUEUE state as ${fileName}`);
      return filePath;
    } finally {
      await fs.remove(lockDir);
    }
  }

  /**
   * Prevents direct task creation in the running folder.
   * This should be called by any service attempting to create task files.
   */
  async validateTaskCreation(targetPath: string): Promise<void> {
    const normalizedPath = path.normalize(targetPath);
    const normalizedRunningDir = path.normalize(this.runningDir);
    
    if (normalizedPath.startsWith(normalizedRunningDir)) {
      const errorMsg = `DIRECT CREATION REJECTED: Tasks must start in the queue folder. Attempts to create tasks directly in the running folder are prohibited. Please use enqueueTask instead.`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
  }

  async updateStatus(status: Partial<QueueStatus>, overrideRoot?: string): Promise<void> {
    const statusDir = overrideRoot ? path.join(overrideRoot, '.cursor', 'status') : this.statusDir;
    const tmpDir = overrideRoot ? path.join(statusDir, 'tmp') : this.tmpDir;
    
    // Ensure directories exist if overriding
    if (overrideRoot) {
      await fs.ensureDir(statusDir);
      await fs.ensureDir(tmpDir);
    }

    const currentPath = path.join(statusDir, 'current.json');
    const uniqueId = Math.random().toString(36).slice(2, 10);
    const tmpPath = path.join(tmpDir, `current.${uniqueId}.json`);

    let currentStatus: QueueStatus = {
      state: 'queued',
      percent: 0,
      step: 'Initializing',
      lastUpdate: new Date().toISOString(),
      notes: [],
      errors: []
    };

    try {
      if (await fs.pathExists(currentPath)) {
        currentStatus = await fs.readJson(currentPath);
      }
    } catch (error) {
      // If reading fails (e.g. file is being written to), we'll just use the default
    }

    const updatedStatus = {
      ...currentStatus,
      ...status,
      lastUpdate: new Date().toISOString()
    };

    await fs.writeJson(tmpPath, updatedStatus, { spaces: 2 });
    
    // Retry rename on Windows (EPERM/EBUSY) with exponential backoff
    let renameAttempts = 0;
    const maxRenameAttempts = 5;
    
    while (renameAttempts < maxRenameAttempts) {
      try {
        await fs.rename(tmpPath, currentPath);
        break;
      } catch (error: any) {
        if ((error.code === 'EPERM' || error.code === 'EBUSY' || error.code === 'EEXIST') && renameAttempts < maxRenameAttempts - 1) {
          renameAttempts++;
          const backoff = 50 * Math.pow(2, renameAttempts - 1); // 50ms, 100ms, 200ms, 400ms
          logger.debug(`Status file rename attempt ${renameAttempts}/${maxRenameAttempts} failed (${error.code}), retrying in ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        // Cleanup temp file on failure
        await fs.remove(tmpPath).catch(() => {});
        throw new Error(`Failed to rename status file after ${renameAttempts + 1} attempts: ${error.message} (code: ${error.code}). This may indicate a filesystem permission issue or file lock.`);
      }
    }
  }

  async isTaskQueued(taskId: string): Promise<boolean> {
    const files = await fs.readdir(this.queueDir);
    return files.some(f => f.includes(`_${taskId}.md`));
  }

  async isTaskRunning(taskId: string): Promise<boolean> {
    const files = await fs.readdir(this.runningDir);
    return files.some(f => f.includes(`_${taskId}.md`));
  }

  async getStatus(): Promise<QueueStatus | null> {
    const currentPath = path.join(this.statusDir, 'current.json');
    if (await fs.pathExists(currentPath)) {
      const status = await fs.readJson(currentPath);
      return status;
    }
    return null;
  }

  async claimNextTask(preferredTaskId?: string): Promise<{ filePath: string; metadata: TaskMetadata } | null> {
    // Use a lock to ensure only one process can claim a task at a time
    // Reduced retries from 100 to 10 with exponential backoff
    const lockDir = path.join(this.baseDir, 'claim.lock');
    let lockAcquired = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      try {
        await fs.mkdir(lockDir);
        lockAcquired = true;
        break;
      } catch (error: any) {
        if ((error.code === 'EEXIST' || error.code === 'EPERM' || error.code === 'EACCES') && attempts < maxAttempts - 1) {
          attempts++;
          // Exponential backoff: 50ms, 100ms, 200ms, 400ms, etc.
          const backoff = 50 * Math.pow(2, attempts - 1);
          logger.debug(`Lock acquisition attempt ${attempts}/${maxAttempts} failed, retrying in ${backoff}ms`);
          await new Promise(resolve => setTimeout(resolve, backoff));
          continue;
        }
        // If we've exhausted retries or hit an unexpected error, throw with context
        throw new Error(`Failed to acquire claim lock after ${attempts + 1} attempts: ${error.message} (code: ${error.code})`);
      }
    }

    if (!lockAcquired) {
      throw new Error(`Could not acquire lock for claiming task after ${maxAttempts} attempts. Another process may be holding the lock.`);
    }

    try {
      const files = await fs.readdir(this.queueDir);
      const taskFiles = files
        .filter(f => f.endsWith('.md'))
        .sort((a, b) => a.localeCompare(b));

      if (taskFiles.length === 0) {
        return null;
      }

      // Check if something is already running
      const runningFiles = await fs.readdir(this.runningDir);
      if (runningFiles.length > 0) {
        const runningFile = runningFiles[0];
        const taskIdMatch = runningFile.match(/_([a-zA-Z0-9-]+)\.md$/);
        const taskId = taskIdMatch ? taskIdMatch[1] : null;

        if (taskId) {
          try {
            // Check if this task is actually already finished but stuck in running/
            const statusPath = path.join(this.statusDir, 'current.json');
            if (await fs.pathExists(statusPath)) {
              const status = await fs.readJson(statusPath);
              if (status.state === 'DONE' || status.state === 'FAILED' || status.state === 'done' || status.state === 'failed') {
                logger.info(`Task ${taskId} is in terminal state (${status.state}) but still in running folder. Completing it now to unblock queue.`);
                await this.completeTask(status.state.toUpperCase() === 'DONE', status.error || undefined, taskId);
                // After completing, we can continue to claim the next task
              } else {
                logger.warn(`Cannot claim new task: A task (${runningFile}) is already in progress in the running directory.`);
                return null;
              }
            } else {
              // No status file? Check TTL
              const stats = await fs.stat(path.join(this.runningDir, runningFile));
              const now = Date.now();
              const ttlMs = (config.cursor.queue?.ttlMinutes || 120) * 60 * 1000;
              if (now - stats.mtimeMs > ttlMs) {
                logger.warn(`Task ${runningFile} is stale (no status file and older than TTL). Moving to failed to unblock queue.`);
                await this.completeTask(false, 'Stale task abandoned');
              } else {
                logger.warn(`Cannot claim new task: A task (${runningFile}) is already in progress in the running directory (no status file yet).`);
                return null;
              }
            }
          } catch (error) {
            logger.error(`Error checking status of running task ${runningFile}: ${error}`);
            return null;
          }
        } else {
          logger.warn(`Cannot claim new task: A file (${runningFile}) is in the running directory but has an invalid name.`);
          return null;
        }

        // Re-read running files after potential cleanup
        const updatedRunningFiles = await fs.readdir(this.runningDir);
        if (updatedRunningFiles.length > 0) {
          return null;
        }
      }

      // Determine order of files to try claiming
      let filesToTry = taskFiles;
      if (preferredTaskId) {
        const preferredFile = taskFiles.find(f => f.includes(`_${preferredTaskId}.md`));
        if (preferredFile) {
          logger.info(`LIFECYCLE: Prioritizing preferred task ${preferredTaskId} for claiming.`);
          filesToTry = [preferredFile, ...taskFiles.filter(f => f !== preferredFile)];
        }
      }

      // Try to claim the first one, if it fails because it's gone, try the next one
      for (const nextFile of filesToTry) {
        const oldPath = path.join(this.queueDir, nextFile);
        const newPath = path.join(this.runningDir, nextFile);

        try {
          // Validate filesystem compatibility before rename
          await this.validateRenameCompatibility(oldPath, newPath);
          
          // Explicitly log the transition from queue to running
          logger.info(`LIFECYCLE: Moving task ${nextFile} from QUEUE to RUNNING`);
          
          await fs.rename(oldPath, newPath);
          
          const content = await fs.readFile(newPath, 'utf8');
          const match = content.match(/^---([\s\S]*?)---/);
          if (!match) throw new Error(`Invalid task file format: ${nextFile}`);
          
          const metadata = yaml.load(match[1]) as TaskMetadata;
          
          logger.info(`Task ${metadata.taskId} claimed from queue and is now RUNNING`);
          
          await this.updateStatus({
            task: {
              file: nextFile,
              id: metadata.id,
              taskId: metadata.taskId
            },
            state: 'running',
            percent: 0,
            step: 'Task claimed and moved to running',
            notes: [`Task transitioned from queue to running state.`, `Started processing task ${metadata.taskId}`],
            errors: []
          }, metadata.clientFolder);

          return { filePath: newPath, metadata };
        } catch (error: any) {
          if (error.code === 'ENOENT') {
            // Someone else claimed it, try the next one
            continue;
          }
          throw error;
        }
      }

      return null;
    } finally {
      await fs.remove(lockDir);
    }
  }

  async completeTask(success: boolean, error?: string, taskId?: string): Promise<void> {
    let fileName: string | undefined;
    let sourceDir: string | undefined;

    if (taskId) {
      // Look for specific taskId in running and queue
      const runningFiles = await fs.readdir(this.runningDir);
      fileName = runningFiles.find(f => f.includes(`_${taskId}.md`));
      if (fileName) {
        sourceDir = this.runningDir;
      } else {
        const queueFiles = await fs.readdir(this.queueDir);
        fileName = queueFiles.find(f => f.includes(`_${taskId}.md`));
        if (fileName) {
          sourceDir = this.queueDir;
        }
      }
    } else {
      const files = await fs.readdir(this.runningDir);
      if (files.length > 0) {
        fileName = files[0];
        sourceDir = this.runningDir;
      }
    }

    if (!fileName || !sourceDir) {
      logger.warn(`No task matching ${taskId || 'any'} found in running or queue to complete.`);
      return;
    }

    const sourcePath = path.join(sourceDir, fileName);
    const destDir = success ? this.doneDir : this.failedDir;
    const destPath = path.join(destDir, fileName);

    // Get clientFolder from metadata if possible for status update
    let clientFolder: string | undefined;
    try {
      const content = await fs.readFile(sourcePath, 'utf8');
      const match = content.match(/^---([\s\S]*?)---/);
      if (match) {
        const metadata = yaml.load(match[1]) as TaskMetadata;
        clientFolder = metadata.clientFolder;
      }
    } catch (err) {
      logger.warn(`Could not read metadata from ${sourcePath} during completion: ${err}`);
    }

    // Explicitly log the transition to terminal state
    logger.info(`LIFECYCLE: Task ${fileName} is being moved from ${path.basename(sourceDir)} to ${success ? 'DONE' : 'FAILED'}`);

    try {
      await fs.rename(sourcePath, destPath);
    } catch (renameErr: any) {
      // Handle race condition where task was already moved by another process
      if (renameErr.code === 'ENOENT') {
        logger.warn(`Task file ${fileName} was already moved (race condition handled gracefully)`);
        return;
      }
      // If destination already exists, task was already completed
      if (renameErr.code === 'EEXIST') {
        logger.warn(`Task file ${fileName} already exists in destination (duplicate completion handled gracefully)`);
        return;
      }
      throw renameErr;
    }
    
    const status = await this.getStatus();
    // Ensure notes is an array (handle case where it might be a string from TaskStatusManager)
    const existingNotes = Array.isArray(status?.notes) ? status.notes : (status?.notes ? [status.notes] : []);
    const existingErrors = Array.isArray(status?.errors) ? status.errors : (status?.errors ? [status.errors] : []);
    await this.updateStatus({
      ...status,
      state: success ? 'done' : 'failed',
      percent: 100,
      step: success ? 'Completed' : 'Failed',
      notes: [...existingNotes, `Task completed from ${path.basename(sourceDir)} and moved to terminal state.`],
      errors: error ? [...existingErrors, error] : existingErrors
    }, clientFolder);

    logger.info(`Task lifecycle completed: ${fileName} moved to ${path.basename(destDir)} folder.`);
  }

  async detectStaleTasks(ttlMinutes: number): Promise<void> {
    const files = await fs.readdir(this.runningDir);
    const now = Date.now();
    const ttlMs = ttlMinutes * 60 * 1000;

    for (const file of files) {
      const filePath = path.join(this.runningDir, file);
      const stats = await fs.stat(filePath);
      
      if (now - stats.mtimeMs > ttlMs) {
        logger.warn(`LIFECYCLE: Task ${file} has become STALE (older than ${ttlMinutes} minutes). Moving to FAILED.`);
        const destPath = path.join(this.failedDir, file);
        await fs.rename(filePath, destPath);
        
        await this.updateStatus({
          state: 'stale',
          step: 'Task marked as stale',
          notes: [`Task was automatically moved to failed because it exceeded the ${ttlMinutes} minute TTL.`],
          errors: [`Task abandoned after ${ttlMinutes} minutes`]
        });
      }
    }
  }

  async requeueTask(taskId: string): Promise<void> {
    const findInDirs = [this.failedDir, this.doneDir, this.runningDir];
    
    for (const dir of findInDirs) {
      const files = await fs.readdir(dir);
      const file = files.find(f => f.includes(`_${taskId}.md`));
      
      if (file) {
        const oldPath = path.join(dir, file);
        const newPath = path.join(this.queueDir, file);
        
        logger.info(`LIFECYCLE: Re-queueing task ${taskId} from ${path.basename(dir)} back to QUEUE`);
        
        await fs.rename(oldPath, newPath);
        
        // Reset status for the re-queued task
        await this.updateStatus({
          state: 'queued',
          percent: 0,
          step: 'Task re-queued',
          notes: [`Task was moved back to queue from ${path.basename(dir)}.`],
          errors: []
        });
        
        logger.info(`Task ${taskId} successfully re-queued.`);
        return;
      }
    }
    
    throw new Error(`Task ${taskId} not found in any directory (cannot re-queue)`);
  }

  async clearQueue(): Promise<{ cleared: number }> {
    if (!(await fs.pathExists(this.queueDir))) {
      return { cleared: 0 };
    }

    const files = await fs.readdir(this.queueDir);
    const taskFiles = files.filter(f => f.endsWith('.md'));
    
    for (const file of taskFiles) {
      const filePath = path.join(this.queueDir, file);
      // Safety check to ensure we only delete files inside the queue directory
      if (filePath.startsWith(this.queueDir)) {
        await fs.remove(filePath);
      }
    }
    
    logger.info(`LIFECYCLE: Agent queue cleared (${taskFiles.length} tasks removed from .cursor/queue/)`);
    return { cleared: taskFiles.length };
  }

  /**
   * Gets a comprehensive overview of the entire queue state.
   * This is useful for the frontend to display queue information.
   */
  async getQueueOverview(): Promise<QueueOverview> {
    await this.initialize();
    const now = Date.now();
    const ttlMs = (config.cursor.queue?.ttlMinutes || 120) * 60 * 1000;
    
    const overview: QueueOverview = {
      queued: [],
      running: [],
      done: [],
      failed: [],
      currentStatus: null,
      healthCheck: {
        isHealthy: true,
        issues: [],
        lastActivity: null
      }
    };

    // Read queued tasks
    try {
      const queuedFiles = await fs.readdir(this.queueDir);
      for (const file of queuedFiles.filter(f => f.endsWith('.md')).sort()) {
        const filePath = path.join(this.queueDir, file);
        const stats = await fs.stat(filePath);
        const metadata = await this.readTaskMetadata(filePath);
        if (metadata) {
          overview.queued.push({
            taskId: metadata.taskId,
            file,
            createdAt: metadata.createdAt || stats.birthtime.toISOString(),
            clientFolder: metadata.clientFolder,
            waitTime: now - stats.birthtimeMs
          });
        }
      }
    } catch (err) {
      // Queue directory may not exist yet
    }

    // Read running tasks
    try {
      const runningFiles = await fs.readdir(this.runningDir);
      for (const file of runningFiles.filter(f => f.endsWith('.md'))) {
        const filePath = path.join(this.runningDir, file);
        const stats = await fs.stat(filePath);
        const metadata = await this.readTaskMetadata(filePath);
        const runTime = now - stats.mtimeMs;
        const isStale = runTime > ttlMs;
        
        if (metadata) {
          overview.running.push({
            taskId: metadata.taskId,
            file,
            startedAt: stats.mtime.toISOString(),
            clientFolder: metadata.clientFolder,
            runTime,
            isStale
          });
          
          if (isStale) {
            overview.healthCheck.isHealthy = false;
            overview.healthCheck.issues.push(`Task ${metadata.taskId} is stale (running for ${Math.round(runTime / 60000)} minutes)`);
          }
        }
      }
    } catch (err) {
      // Running directory may not exist yet
    }

    // Read done tasks (last 10)
    try {
      const doneFiles = await fs.readdir(this.doneDir);
      const sortedDone = [];
      for (const file of doneFiles.filter(f => f.endsWith('.md'))) {
        const filePath = path.join(this.doneDir, file);
        const stats = await fs.stat(filePath);
        sortedDone.push({ file, mtime: stats.mtimeMs });
      }
      sortedDone.sort((a, b) => b.mtime - a.mtime);
      
      for (const { file } of sortedDone.slice(0, 10)) {
        const filePath = path.join(this.doneDir, file);
        const stats = await fs.stat(filePath);
        const metadata = await this.readTaskMetadata(filePath);
        if (metadata) {
          overview.done.push({
            taskId: metadata.taskId,
            file,
            completedAt: stats.mtime.toISOString()
          });
        }
      }
    } catch (err) {
      // Done directory may not exist yet
    }

    // Read failed tasks (last 10)
    try {
      const failedFiles = await fs.readdir(this.failedDir);
      const sortedFailed = [];
      for (const file of failedFiles.filter(f => f.endsWith('.md'))) {
        const filePath = path.join(this.failedDir, file);
        const stats = await fs.stat(filePath);
        sortedFailed.push({ file, mtime: stats.mtimeMs });
      }
      sortedFailed.sort((a, b) => b.mtime - a.mtime);
      
      for (const { file } of sortedFailed.slice(0, 10)) {
        const filePath = path.join(this.failedDir, file);
        const stats = await fs.stat(filePath);
        const metadata = await this.readTaskMetadata(filePath);
        if (metadata) {
          overview.failed.push({
            taskId: metadata.taskId,
            file,
            failedAt: stats.mtime.toISOString()
          });
        }
      }
    } catch (err) {
      // Failed directory may not exist yet
    }

    // Get current status
    overview.currentStatus = await this.getStatus();
    
    // Determine last activity
    const allTimes: number[] = [];
    if (overview.currentStatus?.lastUpdate) {
      allTimes.push(new Date(overview.currentStatus.lastUpdate).getTime());
    }
    overview.queued.forEach(t => allTimes.push(new Date(t.createdAt).getTime()));
    overview.running.forEach(t => allTimes.push(new Date(t.startedAt).getTime()));
    overview.done.forEach(t => allTimes.push(new Date(t.completedAt).getTime()));
    overview.failed.forEach(t => allTimes.push(new Date(t.failedAt).getTime()));
    
    if (allTimes.length > 0) {
      overview.healthCheck.lastActivity = new Date(Math.max(...allTimes)).toISOString();
    }

    // Check for queue issues
    if (overview.running.length > 1) {
      overview.healthCheck.isHealthy = false;
      overview.healthCheck.issues.push(`Multiple tasks (${overview.running.length}) in running state - should only be 1`);
    }
    
    if (overview.queued.length > 0 && overview.running.length === 0) {
      const oldestWait = Math.max(...overview.queued.map(t => t.waitTime));
      if (oldestWait > 5 * 60 * 1000) { // 5 minutes
        overview.healthCheck.issues.push(`Tasks waiting in queue for ${Math.round(oldestWait / 60000)} minutes with no running task`);
      }
    }

    return overview;
  }

  /**
   * Helper to read task metadata from a file
   */
  private async readTaskMetadata(filePath: string): Promise<TaskMetadata | null> {
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const match = content.match(/^---([\s\S]*?)---/);
      if (match) {
        return yaml.load(match[1]) as TaskMetadata;
      }
    } catch (err) {
      // File might be locked or corrupted
    }
    return null;
  }

  /**
   * Force-clears a stuck running task by moving it to failed.
   * This is a recovery mechanism for when tasks get stuck.
   */
  async forceUnstickRunning(taskId?: string): Promise<{ unstuck: string[]; errors: string[] }> {
    const result = { unstuck: [] as string[], errors: [] as string[] };
    
    try {
      const runningFiles = await fs.readdir(this.runningDir);
      
      for (const file of runningFiles.filter(f => f.endsWith('.md'))) {
        const metadata = await this.readTaskMetadata(path.join(this.runningDir, file));
        
        // If taskId specified, only unstick that one
        if (taskId && metadata?.taskId !== taskId) {
          continue;
        }
        
        try {
          const sourcePath = path.join(this.runningDir, file);
          const destPath = path.join(this.failedDir, file);
          
          await fs.rename(sourcePath, destPath);
          logger.info(`RECOVERY: Force-moved stuck task ${file} from running to failed`);
          result.unstuck.push(metadata?.taskId || file);
          
          // Update status
          await this.updateStatus({
            state: 'failed',
            step: 'Force-cleared by recovery',
            errors: ['Task was stuck in running state and force-cleared'],
            percent: 0
          });
        } catch (moveErr: any) {
          result.errors.push(`Failed to move ${file}: ${moveErr.message}`);
        }
      }
    } catch (err: any) {
      result.errors.push(`Error reading running directory: ${err.message}`);
    }
    
    return result;
  }

  /**
   * Performs a health check and auto-recovery of stuck tasks.
   * Should be called periodically (e.g., on server startup and every few minutes).
   */
  async performHealthCheck(): Promise<{ recovered: number; issues: string[] }> {
    const result = { recovered: 0, issues: [] as string[] };
    const ttlMs = (config.cursor.queue?.ttlMinutes || 120) * 60 * 1000;
    const now = Date.now();
    
    try {
      const runningFiles = await fs.readdir(this.runningDir);
      
      for (const file of runningFiles.filter(f => f.endsWith('.md'))) {
        const filePath = path.join(this.runningDir, file);
        const stats = await fs.stat(filePath);
        const age = now - stats.mtimeMs;
        
        // Check if task is stale
        if (age > ttlMs) {
          const metadata = await this.readTaskMetadata(filePath);
          const taskId = metadata?.taskId || file.replace('.md', '');
          
          // Check if there's a status file indicating completion
          const statusPath = path.join(this.statusDir, 'current.json');
          let shouldRecover = true;
          
          if (await fs.pathExists(statusPath)) {
            try {
              const status = await fs.readJson(statusPath);
              if (status.task?.taskId === taskId) {
                // Status exists for this task - check if it indicates completion
                if (['done', 'failed', 'DONE', 'FAILED'].includes(status.state)) {
                  // Task is actually completed, move it
                  const success = status.state.toUpperCase() === 'DONE';
                  await this.completeTask(success, status.error || 'Recovered from stale state', taskId);
                  result.recovered++;
                  logger.info(`RECOVERY: Auto-completed stale task ${taskId} (was ${status.state})`);
                  shouldRecover = false;
                } else {
                  // Check heartbeat - if no update in 10 minutes, consider it stuck
                  const lastUpdate = new Date(status.lastUpdate || status.lastHeartbeat || 0).getTime();
                  if (now - lastUpdate > 10 * 60 * 1000) {
                    result.issues.push(`Task ${taskId} has no heartbeat for ${Math.round((now - lastUpdate) / 60000)} minutes`);
                  } else {
                    // Still has recent heartbeat, don't recover
                    shouldRecover = false;
                  }
                }
              }
            } catch (err) {
              // Status file corrupted, proceed with recovery
            }
          }
          
          if (shouldRecover) {
            result.issues.push(`Task ${taskId} is stale (${Math.round(age / 60000)} minutes old)`);
          }
        }
      }
    } catch (err: any) {
      result.issues.push(`Health check error: ${err.message}`);
    }
    
    return result;
  }

  /**
   * Clears all tasks from all queues (nuclear option for recovery).
   */
  async clearAllQueues(): Promise<{ cleared: { queued: number; running: number; done: number; failed: number } }> {
    const result = { cleared: { queued: 0, running: 0, done: 0, failed: 0 } };
    
    const dirs = [
      { dir: this.queueDir, key: 'queued' as const },
      { dir: this.runningDir, key: 'running' as const },
      { dir: this.doneDir, key: 'done' as const },
      { dir: this.failedDir, key: 'failed' as const }
    ];
    
    for (const { dir, key } of dirs) {
      try {
        if (await fs.pathExists(dir)) {
          const files = await fs.readdir(dir);
          const taskFiles = files.filter(f => f.endsWith('.md'));
          for (const file of taskFiles) {
            await fs.remove(path.join(dir, file));
            result.cleared[key]++;
          }
        }
      } catch (err) {
        logger.warn(`Error clearing ${key} queue: ${err}`);
      }
    }
    
    // Also clear status file
    try {
      const statusPath = path.join(this.statusDir, 'current.json');
      if (await fs.pathExists(statusPath)) {
        await fs.remove(statusPath);
      }
    } catch (err) {
      logger.warn(`Error clearing status file: ${err}`);
    }
    
    logger.info(`RECOVERY: All queues cleared - queued: ${result.cleared.queued}, running: ${result.cleared.running}, done: ${result.cleared.done}, failed: ${result.cleared.failed}`);
    return result;
  }
}

export const agentQueue = new AgentQueue(process.cwd());
