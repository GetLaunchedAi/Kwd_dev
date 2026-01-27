import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';

// ISSUE 23 FIX: Constants for orphaned temp file cleanup
const TEMP_FILE_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const TEMP_FILE_PATTERN = /\.tmp\.\d+\.\d+$/; // Matches .tmp.{pid}.{timestamp}

/**
 * Reads a JSON file safely. SYNC version.
 * If the file doesn't exist or is invalid, returns the defaultValue 
 * and optionally backs up the corrupt file.
 */
export function readJsonSafe<T>(
  filePath: string,
  defaultValue: T,
  validateFn?: (data: any) => data is T
): T {
  try {
    if (!fs.existsSync(filePath)) {
      return defaultValue;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    if (!content.trim()) {
      return defaultValue;
    }

    const data = JSON.parse(content);

    if (validateFn && !validateFn(data)) {
      throw new Error('Schema validation failed');
    }

    return data as T;
  } catch (error) {
    logger.warn(`Failed to read JSON at ${filePath}: ${error}. Backing up and returning default.`);
    backupCorruptFileSync(filePath);
    return defaultValue;
  }
}

/**
 * Reads a JSON file safely. ASYNC version.
 */
export async function readJsonSafeAsync<T>(
  filePath: string,
  defaultValue: T,
  validateFn?: (data: any) => data is T
): Promise<T> {
  try {
    if (!(await fs.pathExists(filePath))) {
      return defaultValue;
    }

    const content = await fs.readFile(filePath, 'utf-8');
    if (!content.trim()) {
      return defaultValue;
    }

    const data = JSON.parse(content);

    if (validateFn && !validateFn(data)) {
      throw new Error('Schema validation failed');
    }

    return data as T;
  } catch (error) {
    logger.warn(`Failed to read JSON async at ${filePath}: ${error}. Backing up and returning default.`);
    backupCorruptFileSync(filePath);
    return defaultValue;
  }
}

/**
 * Writes JSON to a file atomically. ASYNC version.
 * 1) Write to temp file
 * 2) fsync (best effort)
 * 3) Rename to target
 */
export async function writeJsonAtomic<T>(filePath: string, data: T): Promise<void> {
  const dir = path.dirname(filePath);
  await fs.ensureDir(dir);

  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  
  try {
    const content = JSON.stringify(data, null, 2);
    await fs.writeFile(tempPath, content, 'utf-8');

    const fd = await fs.open(tempPath, 'r+');
    try {
      await fs.fsync(fd);
    } finally {
      await fs.close(fd);
    }

    await fs.rename(tempPath, filePath);
  } catch (error) {
    logger.error(`Failed to write JSON atomically to ${filePath}: ${error}`);
    if (await fs.pathExists(tempPath)) {
      await fs.remove(tempPath).catch(() => {});
    }
    throw error;
  }
}

/**
 * Writes JSON to a file atomically. SYNC version.
 */
export function writeJsonAtomicSync<T>(filePath: string, data: T): void {
  const dir = path.dirname(filePath);
  fs.ensureDirSync(dir);

  const tempPath = `${filePath}.tmp.${process.pid}.${Date.now()}`;
  
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(tempPath, content, 'utf-8');

    const fd = fs.openSync(tempPath, 'r+');
    try {
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }

    fs.renameSync(tempPath, filePath);
  } catch (error) {
    logger.error(`Failed to write JSON atomically sync to ${filePath}: ${error}`);
    if (fs.existsSync(tempPath)) {
      fs.removeSync(tempPath);
    }
    throw error;
  }
}

function backupCorruptFileSync(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      const backupPath = `${filePath}.corrupt.${Date.now()}`;
      fs.copySync(filePath, backupPath);
      logger.info(`Corrupt file backed up to ${backupPath}`);
    }
  } catch (backupError) {
    logger.error(`Failed to backup corrupt file ${filePath}: ${backupError}`);
  }
}

/**
 * ISSUE 23 FIX: Cleans up orphaned temp files from atomic write operations.
 * Should be called on server startup and optionally periodically during runtime.
 * 
 * @param directory - Directory to scan for orphaned temp files
 * @param maxAgeMs - Maximum age in milliseconds before a temp file is considered orphaned (default: 1 hour)
 * @returns Number of files cleaned up
 */
export async function cleanupOrphanedTempFiles(
  directory: string,
  maxAgeMs: number = TEMP_FILE_MAX_AGE_MS
): Promise<number> {
  let cleanedCount = 0;
  const now = Date.now();
  
  try {
    if (!(await fs.pathExists(directory))) {
      return 0;
    }
    
    const entries = await fs.readdir(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively clean subdirectories
        cleanedCount += await cleanupOrphanedTempFiles(fullPath, maxAgeMs);
      } else if (entry.isFile() && TEMP_FILE_PATTERN.test(entry.name)) {
        // Found a temp file - check its age
        try {
          const stat = await fs.stat(fullPath);
          const fileAge = now - stat.mtimeMs;
          
          if (fileAge > maxAgeMs) {
            // File is older than threshold - safe to remove
            await fs.remove(fullPath);
            cleanedCount++;
            logger.debug(`Cleaned up orphaned temp file: ${fullPath} (age: ${Math.round(fileAge / 1000)}s)`);
          }
        } catch (statError) {
          // File may have been removed by another process - ignore
          logger.debug(`Could not stat temp file ${fullPath}: ${statError}`);
        }
      }
    }
  } catch (error) {
    logger.warn(`Error during orphaned temp file cleanup in ${directory}: ${error}`);
  }
  
  return cleanedCount;
}

/**
 * ISSUE 23 FIX: Synchronous version of orphaned temp file cleanup.
 * 
 * @param directory - Directory to scan for orphaned temp files
 * @param maxAgeMs - Maximum age in milliseconds before a temp file is considered orphaned (default: 1 hour)
 * @returns Number of files cleaned up
 */
export function cleanupOrphanedTempFilesSync(
  directory: string,
  maxAgeMs: number = TEMP_FILE_MAX_AGE_MS
): number {
  let cleanedCount = 0;
  const now = Date.now();
  
  try {
    if (!fs.existsSync(directory)) {
      return 0;
    }
    
    const entries = fs.readdirSync(directory, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      
      if (entry.isDirectory()) {
        // Recursively clean subdirectories
        cleanedCount += cleanupOrphanedTempFilesSync(fullPath, maxAgeMs);
      } else if (entry.isFile() && TEMP_FILE_PATTERN.test(entry.name)) {
        // Found a temp file - check its age
        try {
          const stat = fs.statSync(fullPath);
          const fileAge = now - stat.mtimeMs;
          
          if (fileAge > maxAgeMs) {
            // File is older than threshold - safe to remove
            fs.removeSync(fullPath);
            cleanedCount++;
            logger.debug(`Cleaned up orphaned temp file: ${fullPath} (age: ${Math.round(fileAge / 1000)}s)`);
          }
        } catch (statError) {
          // File may have been removed by another process - ignore
          logger.debug(`Could not stat temp file ${fullPath}: ${statError}`);
        }
      }
    }
  } catch (error) {
    logger.warn(`Error during orphaned temp file cleanup in ${directory}: ${error}`);
  }
  
  return cleanedCount;
}

/**
 * ISSUE 23 FIX: Initializes orphaned temp file cleanup on server startup.
 * Cleans up the state directory and optionally sets up periodic cleanup.
 * 
 * @param stateDir - The state directory path (defaults to './state')
 * @param periodicIntervalMs - If provided, sets up periodic cleanup at this interval
 * @returns Cleanup result and optional interval reference
 */
export async function initTempFileCleanup(
  stateDir: string = './state',
  periodicIntervalMs?: number
): Promise<{ initialCleanup: number; intervalRef?: NodeJS.Timeout }> {
  logger.info(`Starting orphaned temp file cleanup in ${stateDir}...`);
  const initialCleanup = await cleanupOrphanedTempFiles(stateDir);
  
  if (initialCleanup > 0) {
    logger.info(`Cleaned up ${initialCleanup} orphaned temp file(s) on startup`);
  } else {
    logger.debug('No orphaned temp files found during startup cleanup');
  }
  
  let intervalRef: NodeJS.Timeout | undefined;
  
  if (periodicIntervalMs && periodicIntervalMs > 0) {
    intervalRef = setInterval(async () => {
      const cleaned = await cleanupOrphanedTempFiles(stateDir);
      if (cleaned > 0) {
        logger.info(`Periodic cleanup: removed ${cleaned} orphaned temp file(s)`);
      }
    }, periodicIntervalMs);
    
    // Don't let this interval prevent process exit
    intervalRef.unref();
    logger.debug(`Periodic temp file cleanup scheduled every ${Math.round(periodicIntervalMs / 1000)}s`);
  }
  
  return { initialCleanup, intervalRef };
}




