import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { taskLockManager } from '../utils/taskLock';

export type TaskState = 'STARTING' | 'RUNNING' | 'DONE' | 'FAILED';

export interface TaskStatus {
  taskId: string;
  state: TaskState;
  percent: number;
  step: string;
  notes: string;
  startedAt: string;
  lastHeartbeat: string;
  pid?: number;
  command?: string;
  exitCode: number | null;
  error: string | null;
}

export class TaskStatusManager {
  private baseDir: string;
  private statusDir: string;
  private logsDir: string;
  private tmpDir: string;

  constructor(workspaceRoot: string = process.cwd()) {
    this.baseDir = path.join(workspaceRoot, '.cursor');
    this.statusDir = path.join(this.baseDir, 'status');
    this.logsDir = path.join(workspaceRoot, 'logs', 'tasks');
    this.tmpDir = path.join(this.statusDir, 'tmp');
  }

  /**
   * Gets the path to the events.ndjson file for a task.
   */
  public getEventsFilePath(taskId: string, overrideRoot?: string): string {
    const logsDir = overrideRoot ? path.join(overrideRoot, 'logs', 'tasks') : this.logsDir;
    return path.join(logsDir, taskId, 'events.ndjson');
  }

  /**
   * Gets the total number of lines/events in the events file.
   */
  public async getEventCount(taskId: string, overrideRoot?: string): Promise<number> {
    const logPath = this.getEventsFilePath(taskId, overrideRoot);
    if (!(await fs.pathExists(logPath))) {
      return 0;
    }
    
    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    return lines[0] === '' ? 0 : lines.length;
  }

  /**
   * Gets events starting from a specific line number.
   * Returns events with their line numbers for resume capability.
   */
  public async getEventsFrom(taskId: string, fromLine: number = 0, overrideRoot?: string): Promise<{ events: any[]; totalLines: number }> {
    const logPath = this.getEventsFilePath(taskId, overrideRoot);
    if (!(await fs.pathExists(logPath))) {
      return { events: [], totalLines: 0 };
    }

    const content = await fs.readFile(logPath, 'utf8');
    if (!content.trim()) {
      return { events: [], totalLines: 0 };
    }
    
    const lines = content.trim().split('\n');
    const totalLines = lines.length;
    
    const events = lines.slice(fromLine).map((line, idx) => {
      try {
        const parsed = JSON.parse(line);
        return { lineNumber: fromLine + idx, ...parsed };
      } catch (e) {
        return { lineNumber: fromLine + idx, timestamp: new Date().toISOString(), line, parseError: true };
      }
    });
    
    return { events, totalLines };
  }

  public async initialize(): Promise<void> {
    await fs.ensureDir(this.statusDir);
    await fs.ensureDir(this.logsDir);
    await fs.ensureDir(this.tmpDir);
  }

  public async getStatus(taskId: string, overrideRoot?: string): Promise<TaskStatus | null> {
    const statusDir = overrideRoot ? path.join(overrideRoot, '.cursor', 'status') : this.statusDir;
    const statusPath = path.join(statusDir, 'current.json');
    if (await fs.pathExists(statusPath)) {
      try {
        return await fs.readJson(statusPath);
      } catch (error) {
        logger.error(`Error reading status for task ${taskId}: ${error}`);
        return null;
      }
    }
    return null;
  }

  /**
   * Resets the status for a task by deleting its current.json file.
   * This is used to ensure a clean slate when starting a new agent run for the same workspace.
   */
  public async resetStatus(taskId: string, overrideRoot?: string): Promise<void> {
    const statusDir = overrideRoot ? path.join(overrideRoot, '.cursor', 'status') : this.statusDir;
    const statusPath = path.join(statusDir, 'current.json');
    
    if (await fs.pathExists(statusPath)) {
      try {
        await fs.remove(statusPath);
        logger.info(`Reset status for task ${taskId} at ${statusPath}`);
      } catch (error) {
        logger.error(`Failed to reset status for task ${taskId}: ${error}`);
      }
    }
  }

  /**
   * Resets all status files in the workspace.
   */
  public async resetAllStatuses(): Promise<void> {
    try {
      if (await fs.pathExists(this.statusDir)) {
        const files = await fs.readdir(this.statusDir);
        for (const file of files) {
          if (file.endsWith('.json')) {
            await fs.remove(path.join(this.statusDir, file));
          }
        }
        logger.info(`Reset all task statuses in ${this.statusDir}`);
      }
    } catch (error) {
      logger.error(`Failed to reset all statuses: ${error}`);
      throw error;
    }
  }

  public async updateStatus(taskId: string, updates: Partial<TaskStatus>, overrideRoot?: string): Promise<TaskStatus> {
    return await taskLockManager.runExclusive(taskId, async () => {
      // If overrideRoot is specified, only create directories if the root already exists
      // This prevents creating .cursor/status before the repo is cloned
      if (overrideRoot && !(await fs.pathExists(overrideRoot))) {
        logger.debug(`Skipping status update for ${taskId}: overrideRoot ${overrideRoot} does not exist yet`);
        return {
          taskId,
          state: 'STARTING',
          percent: 0,
          step: 'Waiting for directory',
          notes: '',
          startedAt: new Date().toISOString(),
          lastHeartbeat: new Date().toISOString(),
          exitCode: null,
          error: null
        };
      }
      
      const statusDir = overrideRoot ? path.join(overrideRoot, '.cursor', 'status') : this.statusDir;
      const tmpDir = overrideRoot ? path.join(statusDir, 'tmp') : this.tmpDir;
      
      // Ensure directories exist
      await fs.ensureDir(statusDir);
      await fs.ensureDir(tmpDir);

      const statusPath = path.join(statusDir, 'current.json');
      const tmpPath = path.join(tmpDir, `current.${Math.random().toString(36).slice(2, 10)}.json`);

      let currentStatus: TaskStatus = {
        taskId,
        state: 'STARTING',
        percent: 0,
        step: 'Initializing',
        notes: '',
        startedAt: new Date().toISOString(),
        lastHeartbeat: new Date().toISOString(),
        exitCode: null,
        error: null
      };

      if (await fs.pathExists(statusPath)) {
        try {
          currentStatus = await fs.readJson(statusPath);
        } catch (error) {
          logger.warn(`Could not read existing status for ${taskId}, using defaults`);
        }
      }

      // Special handling for demo step tasks: 
      // If the existing file has a more specific taskId (e.g. demo-X-step2)
      // and we are trying to update it with a base taskId (e.g. demo-X),
      // we should preserve the more specific taskId.
      let finalTaskId = taskId;
      if (currentStatus.taskId && currentStatus.taskId.startsWith(taskId) && currentStatus.taskId !== taskId) {
        if (currentStatus.taskId.includes('-step')) {
          // logger.debug(`Preserving step-specific taskId ${currentStatus.taskId} over base taskId ${taskId}`);
          finalTaskId = currentStatus.taskId;
        }
      }

      const updatedStatus: TaskStatus = {
        ...currentStatus,
        ...updates,
        taskId: finalTaskId, // Ensure taskId is preserved if it's step-specific
        lastHeartbeat: new Date().toISOString()
      };

      await fs.writeJson(tmpPath, updatedStatus, { spaces: 2 });
      
      // Atomic write pattern: write temp → rename
      let renameAttempts = 0;
      while (renameAttempts < 5) {
        try {
          await fs.rename(tmpPath, statusPath);
          break;
        } catch (error: any) {
          if ((error.code === 'EPERM' || error.code === 'EBUSY') && renameAttempts < 4) {
            renameAttempts++;
            await new Promise(resolve => setTimeout(resolve, 50));
            continue;
          }
          throw error;
        }
      }

      return updatedStatus;
    });
  }

  public async appendLog(taskId: string, event: any, overrideRoot?: string): Promise<void> {
    const logsDir = overrideRoot ? path.join(overrideRoot, 'logs', 'tasks') : this.logsDir;
    const taskLogsDir = path.join(logsDir, taskId);
    await fs.ensureDir(taskLogsDir);
    const logPath = path.join(taskLogsDir, `events.ndjson`);
    const logEntry = typeof event === 'string' 
      ? JSON.stringify({ timestamp: new Date().toISOString(), line: event }) + '\n'
      : JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n';
    
    await fs.appendFile(logPath, logEntry, 'utf8');
    
    // Also update heartbeat on any output
    await this.updateStatus(taskId, {}, overrideRoot);
  }

  public async appendStderr(taskId: string, line: string, overrideRoot?: string): Promise<void> {
    const logsDir = overrideRoot ? path.join(overrideRoot, 'logs', 'tasks') : this.logsDir;
    const taskLogsDir = path.join(logsDir, taskId);
    await fs.ensureDir(taskLogsDir);
    const stderrPath = path.join(taskLogsDir, `stderr.log`);
    await fs.appendFile(stderrPath, `${new Date().toISOString()} ${line}\n`, 'utf8');
    
    // Also update heartbeat on any output
    await this.updateStatus(taskId, {}, overrideRoot);
  }

  public async getLogs(taskId: string, tail: number = 200, overrideRoot?: string): Promise<any[]> {
    const logsDir = overrideRoot ? path.join(overrideRoot, 'logs', 'tasks') : this.logsDir;
    const taskLogsDir = path.join(logsDir, taskId);
    const logPath = path.join(taskLogsDir, `events.ndjson`);
    if (!(await fs.pathExists(logPath))) {
      return [];
    }

    const content = await fs.readFile(logPath, 'utf8');
    const lines = content.trim().split('\n');
    const lastLines = lines.slice(-tail);
    
    return lastLines.map(line => {
      try {
        return JSON.parse(line);
      } catch (e) {
        return { timestamp: new Date().toISOString(), line };
      }
    });
  }
}

export const taskStatusManager = new TaskStatusManager();



