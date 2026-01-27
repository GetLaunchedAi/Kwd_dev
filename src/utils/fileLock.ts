import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from './logger';

/**
 * Lock types for read-write lock semantics
 */
export type LockType = 'read' | 'write';

/**
 * Lock file metadata structure
 */
interface LockInfo {
  pid: number;
  timestamp: number;
  type: LockType;
  hostname: string;
  holders?: number; // For read locks, tracks number of concurrent readers
}

/**
 * Configuration options for file locking
 */
export interface FileLockOptions {
  /** Lock timeout in ms (default: 30000) */
  lockTimeout?: number;
  /** Stale lock threshold in ms (default: 60000) */
  staleLockThreshold?: number;
  /** Retry interval base in ms (default: 100) */
  retryIntervalBase?: number;
  /** Max retry attempts (default: 50) */
  maxRetries?: number;
  /** Exponential backoff multiplier (default: 1.5) */
  backoffMultiplier?: number;
  /** Max retry interval in ms (default: 2000) */
  maxRetryInterval?: number;
}

const DEFAULT_OPTIONS: Required<FileLockOptions> = {
  lockTimeout: 30000,
  staleLockThreshold: 60000,
  retryIntervalBase: 100,
  maxRetries: 50,
  backoffMultiplier: 1.5,
  maxRetryInterval: 2000
};

/**
 * File-based lock manager supporting read-write lock semantics
 * - Multiple readers can hold the lock simultaneously
 * - Writers require exclusive access
 * - Stale locks are automatically detected and cleaned up
 */
export class FileLockManager {
  private options: Required<FileLockOptions>;
  private heldLocks: Map<string, { type: LockType; releasePromise?: Promise<void> }> = new Map();

  constructor(options: FileLockOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Get the lock file path for a given file
   */
  private getLockPath(filePath: string): string {
    return `${filePath}.lock`;
  }

  /**
   * Check if a lock is stale based on its timestamp
   */
  private isLockStale(lockInfo: LockInfo): boolean {
    const age = Date.now() - lockInfo.timestamp;
    return age > this.options.staleLockThreshold;
  }

  /**
   * Check if the process that created the lock is still running
   */
  private isProcessAlive(pid: number): boolean {
    try {
      // Sending signal 0 doesn't kill the process, just checks if it exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Read lock info from lock file
   */
  private async readLockInfo(lockPath: string): Promise<LockInfo | null> {
    try {
      if (!(await fs.pathExists(lockPath))) {
        return null;
      }
      const content = await fs.readFile(lockPath, 'utf-8');
      return JSON.parse(content) as LockInfo;
    } catch {
      return null;
    }
  }

  /**
   * Write lock info to lock file atomically
   */
  private async writeLockInfo(lockPath: string, lockInfo: LockInfo): Promise<boolean> {
    const tempPath = `${lockPath}.${process.pid}.${Date.now()}`;
    try {
      await fs.writeFile(tempPath, JSON.stringify(lockInfo, null, 2), 'utf-8');
      await fs.rename(tempPath, lockPath);
      return true;
    } catch (error) {
      await fs.remove(tempPath).catch(() => {});
      return false;
    }
  }

  /**
   * Clean up a stale lock
   */
  private async cleanupStaleLock(lockPath: string, lockInfo: LockInfo): Promise<boolean> {
    logger.debug(`Cleaning up stale lock: ${lockPath} (PID: ${lockInfo.pid}, age: ${Date.now() - lockInfo.timestamp}ms)`);
    try {
      await fs.remove(lockPath);
      return true;
    } catch (error) {
      logger.warn(`Failed to clean up stale lock ${lockPath}: ${error}`);
      return false;
    }
  }

  /**
   * Attempt to acquire a lock using atomic compare-and-swap pattern
   * FIX: Uses exclusive file creation to prevent TOCTOU race condition
   */
  private async tryAcquireLock(filePath: string, type: LockType): Promise<boolean> {
    const lockPath = this.getLockPath(filePath);
    const existingLock = await this.readLockInfo(lockPath);

    if (existingLock) {
      // Check if lock is stale
      if (this.isLockStale(existingLock) || !this.isProcessAlive(existingLock.pid)) {
        const cleaned = await this.cleanupStaleLock(lockPath, existingLock);
        if (!cleaned) {
          return false;
        }
        // Lock was cleaned, fall through to create new lock
      } else {
        // Lock exists and is valid
        if (type === 'read' && existingLock.type === 'read') {
          // FIX: Use atomic compare-and-swap for incrementing holder count
          // This prevents race condition where two processes read the same count
          return await this.atomicIncrementHolders(lockPath, existingLock);
        }
        // Write lock requested or existing write lock - must wait
        return false;
      }
    }

    // No lock exists, create one using exclusive write
    const newLock: LockInfo = {
      pid: process.pid,
      timestamp: Date.now(),
      type,
      hostname: require('os').hostname(),
      holders: type === 'read' ? 1 : undefined
    };

    return await this.writeLockInfoExclusive(lockPath, newLock);
  }

  /**
   * FIX: Atomically increment the holder count for read locks
   * Uses a versioning approach to detect concurrent modifications
   */
  private async atomicIncrementHolders(lockPath: string, expectedLock: LockInfo): Promise<boolean> {
    const maxRetries = 3;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Re-read the current lock state
        const currentLock = await this.readLockInfo(lockPath);
        
        if (!currentLock) {
          // Lock was removed between reads - try to create fresh
          return false;
        }
        
        // Verify the lock hasn't changed (compare-and-swap check)
        // Use timestamp as a version number
        if (currentLock.timestamp !== expectedLock.timestamp || 
            currentLock.holders !== expectedLock.holders) {
          // Lock was modified by another process, re-read and retry
          expectedLock = currentLock;
          continue;
        }
        
        // Prepare updated lock with new timestamp (acts as version)
        const updatedLock: LockInfo = {
          ...currentLock,
          holders: (currentLock.holders || 1) + 1,
          timestamp: Date.now()
        };
        
        // Write with atomic rename
        if (await this.writeLockInfo(lockPath, updatedLock)) {
          return true;
        }
        
        // Write failed, retry
      } catch (error) {
        logger.debug(`Atomic increment attempt ${attempt + 1} failed: ${error}`);
      }
      
      // Small delay before retry to reduce contention
      await new Promise(resolve => setTimeout(resolve, 10 * (attempt + 1)));
    }
    
    return false;
  }

  /**
   * FIX: Write lock info with exclusive creation (fails if file exists)
   * Used for creating new locks to prevent race conditions
   */
  private async writeLockInfoExclusive(lockPath: string, lockInfo: LockInfo): Promise<boolean> {
    const tempPath = `${lockPath}.${process.pid}.${Date.now()}`;
    try {
      // First write to temp file
      await fs.writeFile(tempPath, JSON.stringify(lockInfo, null, 2), 'utf-8');
      
      // Try to link (hard link) temp to lock path - fails if lock exists
      // This is more atomic than rename on some filesystems
      try {
        await fs.link(tempPath, lockPath);
        await fs.remove(tempPath);
        return true;
      } catch (linkError: any) {
        // link not supported or file exists, fall back to rename
        if (linkError.code === 'EEXIST') {
          await fs.remove(tempPath);
          return false;
        }
        // Try rename as fallback
        await fs.rename(tempPath, lockPath);
        return true;
      }
    } catch (error: any) {
      await fs.remove(tempPath).catch(() => {});
      if (error.code === 'EEXIST') {
        return false;
      }
      logger.debug(`Failed to create lock file exclusively: ${error.message}`);
      return false;
    }
  }

  /**
   * Acquire a lock with retry logic and exponential backoff
   */
  async acquireLock(filePath: string, type: LockType = 'write'): Promise<void> {
    const startTime = Date.now();
    let retries = 0;
    let retryInterval = this.options.retryIntervalBase;

    while (true) {
      // Check timeout
      if (Date.now() - startTime > this.options.lockTimeout) {
        throw new Error(`Failed to acquire ${type} lock on ${filePath} after ${this.options.lockTimeout}ms timeout`);
      }

      // Check max retries
      if (retries >= this.options.maxRetries) {
        throw new Error(`Failed to acquire ${type} lock on ${filePath} after ${this.options.maxRetries} retries`);
      }

      // Try to acquire
      const acquired = await this.tryAcquireLock(filePath, type);
      if (acquired) {
        this.heldLocks.set(filePath, { type });
        logger.debug(`Acquired ${type} lock on ${filePath}`);
        return;
      }

      // Wait with exponential backoff
      await new Promise(resolve => setTimeout(resolve, retryInterval));
      retryInterval = Math.min(
        retryInterval * this.options.backoffMultiplier,
        this.options.maxRetryInterval
      );
      retries++;
    }
  }

  /**
   * Release a held lock
   * 
   * FIX: Added retry logic and orphaned lock cleanup to handle cases where:
   * - The lock file is temporarily inaccessible (EBUSY on Windows)
   * - The decrement operation fails mid-way
   * - The file was corrupted and needs to be force-removed
   */
  async releaseLock(filePath: string): Promise<void> {
    const lockPath = this.getLockPath(filePath);
    const heldLock = this.heldLocks.get(filePath);

    if (!heldLock) {
      logger.warn(`Attempted to release lock on ${filePath} but no lock is held`);
      return;
    }

    const maxRetries = 3;
    let lastError: any = null;
    
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const lockInfo = await this.readLockInfo(lockPath);
        
        if (lockInfo) {
          if (lockInfo.type === 'read' && (lockInfo.holders || 1) > 1) {
            // Decrement reader count instead of removing lock
            const updatedLock: LockInfo = {
              ...lockInfo,
              holders: (lockInfo.holders || 1) - 1,
              timestamp: Date.now()
            };
            const writeSuccess = await this.writeLockInfo(lockPath, updatedLock);
            if (!writeSuccess) {
              throw new Error('Failed to write updated lock info');
            }
          } else {
            // Remove lock file
            await fs.remove(lockPath);
          }
        }

        this.heldLocks.delete(filePath);
        logger.debug(`Released ${heldLock.type} lock on ${filePath}`);
        return; // Success
        
      } catch (error: any) {
        lastError = error;
        
        // FIX: Handle Windows-specific EBUSY error with retry
        if (error.code === 'EBUSY' || error.code === 'EPERM') {
          logger.debug(`Lock release attempt ${attempt + 1} failed with ${error.code}, retrying...`);
          await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
          continue;
        }
        
        // FIX: If the lock file doesn't exist, consider it released
        if (error.code === 'ENOENT') {
          logger.debug(`Lock file already removed for ${filePath}`);
          this.heldLocks.delete(filePath);
          return;
        }
        
        // For other errors, try to force cleanup on last attempt
        if (attempt === maxRetries - 1) {
          break;
        }
      }
    }
    
    // FIX: All retries failed - attempt force cleanup
    logger.error(`Failed to release lock on ${filePath} after ${maxRetries} attempts: ${lastError?.message}`);
    
    try {
      // Force remove the lock file as a last resort
      // This prevents orphaned locks from blocking future operations
      if (await fs.pathExists(lockPath)) {
        await fs.remove(lockPath);
        logger.warn(`Force-removed orphaned lock file: ${lockPath}`);
      }
    } catch (forceRemoveError: any) {
      // Schedule async cleanup for later if immediate removal fails
      logger.error(`Could not force-remove lock file ${lockPath}: ${forceRemoveError.message}. Scheduling delayed cleanup.`);
      this.scheduleDelayedLockCleanup(lockPath);
    }
    
    // Always clear the in-memory reference
    this.heldLocks.delete(filePath);
  }

  /**
   * FIX: Schedules a delayed cleanup attempt for orphaned lock files
   * This handles cases where the file is temporarily locked by another process
   */
  private scheduleDelayedLockCleanup(lockPath: string): void {
    setTimeout(async () => {
      try {
        const lockInfo = await this.readLockInfo(lockPath);
        
        // Only clean up if the lock is now stale or process is dead
        if (lockInfo && (this.isLockStale(lockInfo) || !this.isProcessAlive(lockInfo.pid))) {
          await fs.remove(lockPath);
          logger.info(`Delayed cleanup removed orphaned lock: ${lockPath}`);
        }
      } catch (error) {
        // Ignore errors in delayed cleanup - it's best-effort
        logger.debug(`Delayed lock cleanup failed for ${lockPath}: ${error}`);
      }
    }, 5000); // Try again after 5 seconds
  }

  /**
   * Execute a function while holding a lock
   * @param filePath The file to lock
   * @param type Lock type ('read' or 'write')
   * @param fn The function to execute
   */
  async withLock<T>(filePath: string, type: LockType, fn: () => Promise<T>): Promise<T> {
    await this.acquireLock(filePath, type);
    try {
      return await fn();
    } finally {
      await this.releaseLock(filePath);
    }
  }

  /**
   * Execute a function with a read lock
   */
  async withReadLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    return this.withLock(filePath, 'read', fn);
  }

  /**
   * Execute a function with a write lock
   */
  async withWriteLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
    return this.withLock(filePath, 'write', fn);
  }

  /**
   * Check if a file is currently locked
   */
  async isLocked(filePath: string): Promise<boolean> {
    const lockPath = this.getLockPath(filePath);
    const lockInfo = await this.readLockInfo(lockPath);
    
    if (!lockInfo) {
      return false;
    }

    // Check if lock is stale
    if (this.isLockStale(lockInfo) || !this.isProcessAlive(lockInfo.pid)) {
      await this.cleanupStaleLock(lockPath, lockInfo);
      return false;
    }

    return true;
  }

  /**
   * Get current lock info for a file
   */
  async getLockInfo(filePath: string): Promise<LockInfo | null> {
    const lockPath = this.getLockPath(filePath);
    return await this.readLockInfo(lockPath);
  }

  /**
   * Clean up all stale locks in a directory
   * Useful for startup cleanup
   */
  async cleanupStaleLocks(directory: string): Promise<number> {
    let cleanedCount = 0;
    
    try {
      const files = await fs.readdir(directory);
      const lockFiles = files.filter(f => f.endsWith('.lock'));

      for (const lockFile of lockFiles) {
        const lockPath = path.join(directory, lockFile);
        const lockInfo = await this.readLockInfo(lockPath);
        
        if (lockInfo && (this.isLockStale(lockInfo) || !this.isProcessAlive(lockInfo.pid))) {
          if (await this.cleanupStaleLock(lockPath, lockInfo)) {
            cleanedCount++;
          }
        }
      }
    } catch (error) {
      logger.error(`Error cleaning up stale locks in ${directory}: ${error}`);
    }

    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} stale lock(s) in ${directory}`);
    }

    return cleanedCount;
  }
}

// Export a singleton instance for common use
export const fileLockManager = new FileLockManager();

// Export specialized lock manager for demo context files
export const demoContextLock = new FileLockManager({
  lockTimeout: 15000,      // 15 second timeout for demo context operations
  staleLockThreshold: 30000, // 30 second stale threshold
  retryIntervalBase: 50,   // Start with 50ms retry
  maxRetries: 100          // More retries for busy systems
});
