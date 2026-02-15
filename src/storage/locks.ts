import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

export interface LockOptions {
  staleMs?: number;
  retryIntervalMs?: number;
  maxRetries?: number;
}

/**
 * Executes a function within a file-based lock.
 * This prevents multiple processes on the same filesystem from running the same code.
 */
export async function withFileLock<T>(
  lockPath: string,
  fn: () => Promise<T>,
  options: LockOptions = {}
): Promise<T> {
  const {
    staleMs = 60000, // 1 minute default
    retryIntervalMs = 1000,
    maxRetries = 30 // Wait up to 30 seconds by default
  } = options;

  await fs.ensureDir(path.dirname(lockPath));

  let retries = 0;
  while (retries < maxRetries) {
    try {
      if (await acquireLock(lockPath, staleMs)) {
        try {
          return await fn();
        } finally {
          await releaseLock(lockPath);
        }
      }
    } catch (error) {
      logger.error(`Error during lock operation for ${lockPath}: ${error}`);
      throw error;
    }

    retries++;
    if (retries < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryIntervalMs));
    }
  }

  throw new Error(`Failed to acquire lock for ${lockPath} after ${maxRetries} retries`);
}

async function acquireLock(lockPath: string, staleMs: number): Promise<boolean> {
  try {
    // Try to create the lock file with exclusive flag
    // 'wx' means: Open for writing. Fails if the path exists.
    await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, createdAt: Date.now() }), { flag: 'wx' });
    return true;
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // Check if the existing lock is stale
      try {
        const stats = await fs.stat(lockPath);
        const now = Date.now();
        const age = now - stats.mtimeMs;

        if (age > staleMs) {
          logger.warn(`Lock file ${lockPath} is stale (age: ${age}ms). Breaking lock.`);
          await fs.remove(lockPath);
          // Try to acquire again in the next loop
          return false;
        }
      } catch (statError) {
        // If file was deleted between EEXIST and stat, just retry
      }
      return false;
    }
    throw error;
  }
}

async function releaseLock(lockPath: string): Promise<void> {
  try {
    if (await fs.pathExists(lockPath)) {
      await fs.remove(lockPath);
    }
  } catch (error) {
    logger.error(`Failed to release lock at ${lockPath}: ${error}`);
  }
}





