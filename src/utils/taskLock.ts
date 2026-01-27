import { logger } from './logger';

type TaskLockCallback<T> = () => Promise<T>;

/**
 * Queue entry for waiting callers
 */
interface QueueEntry {
  resolve: () => void;
  reject: (error: Error) => void;
  enqueuedAt: number;
}

/**
 * Lock metadata for tracking acquisition time
 */
interface LockMetadata {
  acquiredAt: number;
  taskId: string;
}

// Configuration for lock timeouts
const LOCK_TIMEOUT_MS = 60000; // 60 seconds max wait time in queue
const LOCK_HOLD_TIMEOUT_MS = 120000; // 120 seconds max hold time (detect stuck operations)
const STALE_LOCK_CHECK_INTERVAL_MS = 30000; // Check for stale locks every 30 seconds

/**
 * A simple in-memory lock to serialize operations per task.
 * Uses a queue-based approach to prevent race conditions between
 * checking if a lock exists and acquiring it.
 * 
 * FIX: Added timeout mechanism to prevent infinite blocking if:
 * - A lock holder hangs indefinitely
 * - A caller waits too long in the queue
 */
export class TaskLockManager {
  // Map of taskId -> queue of waiting callers
  private queues: Map<string, QueueEntry[]> = new Map();
  // Set of currently held locks with metadata
  private heldLocks: Map<string, LockMetadata> = new Map();
  // Interval for checking stale locks
  private staleLockCheckInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start periodic stale lock checker
    this.startStaleLockChecker();
  }

  /**
   * Starts periodic checking for stale locks that have been held too long
   */
  private startStaleLockChecker(): void {
    if (this.staleLockCheckInterval) return;
    
    this.staleLockCheckInterval = setInterval(() => {
      this.cleanupStaleLocks();
    }, STALE_LOCK_CHECK_INTERVAL_MS);
    
    // Don't prevent process exit
    this.staleLockCheckInterval.unref();
  }

  /**
   * Stops the stale lock checker (for graceful shutdown)
   */
  public stopStaleLockChecker(): void {
    if (this.staleLockCheckInterval) {
      clearInterval(this.staleLockCheckInterval);
      this.staleLockCheckInterval = null;
    }
  }

  /**
   * FIX: Cleans up locks that have been held longer than LOCK_HOLD_TIMEOUT_MS
   * This prevents deadlocks from stuck operations
   */
  private cleanupStaleLocks(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [taskId, metadata] of this.heldLocks.entries()) {
      const holdTime = now - metadata.acquiredAt;
      if (holdTime > LOCK_HOLD_TIMEOUT_MS) {
        logger.warn(`TaskLock: Force-releasing stale lock for ${taskId} (held for ${Math.round(holdTime / 1000)}s)`);
        this.forceReleaseLock(taskId);
        cleanedCount++;
      }
    }
    
    // Also clean up expired queue entries
    for (const [taskId, queue] of this.queues.entries()) {
      const expiredCount = queue.filter(entry => {
        const waitTime = now - entry.enqueuedAt;
        if (waitTime > LOCK_TIMEOUT_MS) {
          entry.reject(new Error(`Lock acquisition timeout for ${taskId} after ${Math.round(waitTime / 1000)}s`));
          return true;
        }
        return false;
      }).length;
      
      if (expiredCount > 0) {
        // Remove expired entries from queue
        const remaining = queue.filter(entry => now - entry.enqueuedAt <= LOCK_TIMEOUT_MS);
        if (remaining.length === 0) {
          this.queues.delete(taskId);
        } else {
          this.queues.set(taskId, remaining);
        }
        logger.warn(`TaskLock: Rejected ${expiredCount} timed-out waiter(s) for ${taskId}`);
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`TaskLock: Cleaned up ${cleanedCount} stale lock(s)`);
    }
  }

  /**
   * Force-releases a lock without proper handoff (for stale lock cleanup)
   */
  private forceReleaseLock(taskId: string): void {
    this.heldLocks.delete(taskId);
    
    const queue = this.queues.get(taskId);
    if (queue && queue.length > 0) {
      // Give lock to next waiter
      const nextEntry = queue.shift()!;
      if (queue.length === 0) {
        this.queues.delete(taskId);
      }
      
      this.heldLocks.set(taskId, {
        acquiredAt: Date.now(),
        taskId
      });
      nextEntry.resolve();
    } else {
      this.queues.delete(taskId);
    }
  }

  /**
   * Runs an async function within a lock for a specific task
   * @param taskId Unique identifier for the task/resource
   * @param fn The async function to run
   * @param timeoutMs Optional custom timeout for this operation
   */
  public async runExclusive<T>(taskId: string, fn: TaskLockCallback<T>, timeoutMs?: number): Promise<T> {
    // FIX: Use synchronous queue insertion to prevent race condition
    // between checking if lock exists and setting it
    await this.acquireLock(taskId, timeoutMs);

    try {
      // Run the actual function
      const result = await fn();
      return result;
    } catch (error) {
      logger.error(`Error in exclusive task operation for ${taskId}: ${error}`);
      throw error;
    } finally {
      // Release the lock and notify next waiter
      this.releaseLock(taskId);
    }
  }

  /**
   * Acquires the lock for a task, waiting if necessary.
   * This method is race-condition-safe because the decision to wait
   * or proceed is made synchronously before any await.
   * 
   * FIX: Added timeout parameter to prevent infinite waiting
   */
  private acquireLock(taskId: string, timeoutMs: number = LOCK_TIMEOUT_MS): Promise<void> {
    // If lock is not held, acquire it immediately (synchronous path)
    if (!this.heldLocks.has(taskId)) {
      this.heldLocks.set(taskId, {
        acquiredAt: Date.now(),
        taskId
      });
      return Promise.resolve();
    }

    // Lock is held, we need to wait in queue with timeout
    return new Promise<void>((resolve, reject) => {
      // Get or create the queue for this task
      let queue = this.queues.get(taskId);
      if (!queue) {
        queue = [];
        this.queues.set(taskId, queue);
      }
      
      const entry: QueueEntry = {
        resolve: () => {
          // Update lock metadata when we acquire it
          this.heldLocks.set(taskId, {
            acquiredAt: Date.now(),
            taskId
          });
          resolve();
        },
        reject,
        enqueuedAt: Date.now()
      };
      
      // Add ourselves to the queue
      queue.push(entry);
      
      // FIX: Set a timeout to reject if we wait too long
      setTimeout(() => {
        // Check if we're still in the queue (haven't been resolved)
        const currentQueue = this.queues.get(taskId);
        if (currentQueue) {
          const index = currentQueue.indexOf(entry);
          if (index !== -1) {
            // Remove ourselves from the queue
            currentQueue.splice(index, 1);
            if (currentQueue.length === 0) {
              this.queues.delete(taskId);
            }
            reject(new Error(`Lock acquisition timeout for ${taskId} after ${timeoutMs}ms`));
          }
        }
      }, timeoutMs);
    });
  }

  /**
   * Releases the lock and notifies the next waiter in queue.
   */
  private releaseLock(taskId: string): void {
    const queue = this.queues.get(taskId);
    
    if (queue && queue.length > 0) {
      // There are waiters - give lock to the next one
      const nextEntry = queue.shift()!;
      
      // Clean up empty queue
      if (queue.length === 0) {
        this.queues.delete(taskId);
      }
      
      // The next waiter now holds the lock
      // Resolve their promise to let them proceed (resolve updates heldLocks)
      nextEntry.resolve();
    } else {
      // No waiters - release the lock entirely
      this.heldLocks.delete(taskId);
      this.queues.delete(taskId);
    }
  }

  /**
   * Gets current lock statistics (useful for debugging)
   */
  public getStats(): { heldLocks: number; queuedWaiters: number } {
    let queuedWaiters = 0;
    for (const queue of this.queues.values()) {
      queuedWaiters += queue.length;
    }
    return {
      heldLocks: this.heldLocks.size,
      queuedWaiters
    };
  }
}

export const taskLockManager = new TaskLockManager();




