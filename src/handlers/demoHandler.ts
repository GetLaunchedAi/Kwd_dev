import { logger } from '../utils/logger';
import * as path from 'path';
import * as fs from 'fs-extra';
import simpleGit from 'simple-git';
import { triggerCursorAgent } from '../cursor/workspaceManager';
import { isGitConfigured, getGitUserConfig } from '../git/repoManager';
import { validateGitSetup, areGitSettingsConfigured } from '../git/gitValidator';
import { exec, spawn, ChildProcess } from 'child_process';
import { visualTester } from '../utils/visualTesting';
import { config } from '../config/config';
import { taskStatusManager } from '../cursor/taskStatusManager';
import { imageRetrieverService } from '../utils/imageRetrieverService';
import { formatLogEntry, formatTimestamp } from '../utils/logFormatter';

/**
 * DemoStatus interface - Comprehensive type definition for demo status objects.
 * This is the single source of truth for all demo status data including Netlify deployment fields.
 */
export interface DemoStatus {
  /** Current state of the demo creation/deployment process */
  state: 
    | 'starting' 
    | 'cloning' 
    | 'installing' 
    | 'organizing' 
    | 'prompting' 
    | 'triggering' 
    | 'running' 
    | 'awaiting_approval'
    | 'completed' 
    | 'failed'
    | 'publishing'      // GitHub publish in progress
    | 'deploying'       // Netlify deployment in progress
    | 'published'       // Successfully published to GitHub + Netlify
    | 'deploy_failed';  // GitHub succeeded, Netlify failed (partial success)
  
  /** Human-readable status message */
  message: string;
  
  /** Array of log entries with timestamps */
  logs: string[];
  
  /** Current step number (1-4 for multi-step demos) */
  currentStep: number;
  
  /** Total number of steps in the demo workflow */
  totalSteps: number;
  
  /** Task ID for TaskStatusManager sync */
  taskId: string;
  
  /** ISO timestamp of last status update */
  updatedAt?: string;
  
  // === Netlify Deployment Fields ===
  
  /** Netlify site ID (e.g., "abc123-456") */
  netlifySiteId?: string;
  
  /** Public URL of the deployed site (e.g., "https://my-demo.netlify.app") */
  netlifySiteUrl?: string;
  
  /** Netlify admin dashboard URL for this site */
  netlifyAdminUrl?: string;
  
  /** Current Netlify deploy state */
  netlifyDeployState?: 'pending' | 'building' | 'ready' | 'error' | 'cancelled';
  
  /** Error message if Netlify deployment failed */
  netlifyError?: string;
  
  /** Netlify deploy ID for tracking specific deployments */
  netlifyDeployId?: string;
  
  /** Timestamp when Netlify deployment started */
  netlifyDeployStartedAt?: string;
  
  // === GitHub Publish Fields ===
  
  /** GitHub repository URL */
  githubRepoUrl?: string;
  
  /** GitHub repository full name (org/repo) */
  githubRepoFullName?: string;
  
  // === Internal Cache Fields ===
  
  /** Cache timestamp (internal use only) */
  _cacheTime?: number;
}

/**
 * Template mapping: templateId -> repoUrl
 * In production, these should be your pre-built Eleventy/site templates.
 * URLs are stored as SSH format (git@github.com:owner/repo.git) for production use.
 * They will be converted to HTTPS if useSSH is disabled in config.
 */
const TEMPLATE_MAP: Record<string, string> = {
  'modern': 'git@github.com:11ty/eleventy-base-blog.git',
  'trade': 'git@github.com:11ty/eleventy-base-blog.git',
  'default-template': 'git@github.com:11ty/eleventy-base-blog.git',
  'default-template-id': 'git@github.com:11ty/eleventy-base-blog.git',
  'template-basic': 'git@github.com:11ty/eleventy-base-blog.git',
  'template-default': 'git@github.com:11ty/eleventy-base-blog.git',
  'template123': 'git@github.com:11ty/eleventy-base-blog.git',
  'basic-template': 'git@github.com:11ty/eleventy-base-blog.git',
};

/**
 * Converts a GitHub URL between HTTPS and SSH formats.
 * HTTPS: https://github.com/owner/repo or https://github.com/owner/repo.git or https://github.com/owner/repo/
 * SSH: git@github.com:owner/repo.git
 */
function convertGitHubUrl(url: string, toSSH: boolean): string {
  // Normalize: trim whitespace and remove trailing slashes
  const normalizedUrl = url.trim().replace(/\/+$/, '');
  
  if (toSSH) {
    // Convert HTTPS to SSH (case-insensitive for github.com)
    const httpsMatch = normalizedUrl.match(/^https?:\/\/github\.com\/([^\/]+)\/([^\/\.]+)(\.git)?$/i);
    if (httpsMatch) {
      return `git@github.com:${httpsMatch[1]}/${httpsMatch[2]}.git`;
    }
    // Already SSH or unknown format, return as-is
    return url;
  } else {
    // Convert SSH to HTTPS (case-insensitive for github.com)
    const sshMatch = normalizedUrl.match(/^git@github\.com:([^\/]+)\/([^\/\.]+)(\.git)?$/i);
    if (sshMatch) {
      return `https://github.com/${sshMatch[1]}/${sshMatch[2]}`;
    }
    // Already HTTPS or unknown format, return as-is
    return url;
  }
}

/**
 * Gets the appropriate clone URL based on config.git.useSSH setting.
 * If useSSH is true (production), returns SSH URL format.
 * If useSSH is false (development), returns HTTPS URL format.
 */
function getCloneUrl(url: string): string {
  const useSSH = config.git.useSSH ?? false;
  return convertGitHubUrl(url, useSSH);
}

/**
 * Reserved slugs that cannot be used for client websites
 */
const RESERVED_SLUGS = new Set([
  'api', 'admin', 'public', 'static', 'assets', 'logs', 'temp-uploads', 
  'node_modules', 'config', 'src', 'dist', 'tests', 'state', 'docs',
  'scripts', 'github-clone-all', 'ImageRetriever', 'client-websites'
]);

const LOGS_DIR = path.join(process.cwd(), 'logs');
const ACTIVE_DEMOS_FILE = path.join(LOGS_DIR, 'active-demos.json');

/**
 * Centralized demo status management with single source of truth
 * Primary storage: demo.status.json in each demo directory
 * Cache: In-memory LRU cache for performance (read-through cache)
 * Audit log: active-demos.json (append-only, for historical tracking)
 * 
 * Race condition protection:
 * - Uses per-file locks to serialize write operations
 * - Atomic merge writes ensure concurrent updates are merged, not overwritten
 */
class DemoStatusManager {
  private cache: Map<string, any> = new Map();
  private statusDir: string;
  private readonly MAX_CACHE_SIZE = 100; // Maximum number of demos to cache
  private readonly CACHE_TTL_MS = 5000; // Cache entries valid for 5 seconds
  
  // Per-file write locks to prevent race conditions
  // Each lock is a promise that resolves when the current write completes
  private writeLocks: Map<string, Promise<void>> = new Map();
  
  // Version tracking for optimistic concurrency control
  private versions: Map<string, number> = new Map();

  constructor() {
    this.statusDir = path.join(process.cwd(), 'client-websites');
  }

  /**
   * Evicts oldest entries if cache exceeds MAX_CACHE_SIZE.
   * Uses LRU-like eviction based on _cacheTime (oldest entries removed first).
   */
  private evictOldestEntries(): void {
    if (this.cache.size <= this.MAX_CACHE_SIZE) return;

    // Convert to array and sort by cache time (oldest first)
    const entries = Array.from(this.cache.entries())
      .sort((a, b) => (a[1]._cacheTime || 0) - (b[1]._cacheTime || 0));

    // Remove oldest entries until we're under the limit
    const toRemove = this.cache.size - this.MAX_CACHE_SIZE;
    for (let i = 0; i < toRemove; i++) {
      this.cache.delete(entries[i][0]);
    }
    
    logger.debug(`Cache eviction: removed ${toRemove} oldest entries, size now ${this.cache.size}`);
  }

  /**
   * Gets the status file path for a demo
   */
  private getStatusPath(clientSlug: string): string {
    return path.join(this.statusDir, clientSlug, 'demo.status.json');
  }

  /**
   * Gets the temp status path for atomic writes
   */
  private getTempStatusPath(clientSlug: string): string {
    // Include a random suffix to prevent collisions if multiple writes happen
    const suffix = Math.random().toString(36).substring(7);
    return path.join(this.statusDir, clientSlug, `.demo.status.tmp.${suffix}.json`);
  }
  
  /**
   * Gets the lock file path for a demo (used for cross-process locking if needed)
   */
  private getLockPath(clientSlug: string): string {
    return path.join(this.statusDir, clientSlug, '.demo.status.lock');
  }

  /**
   * Acquires a write lock for the given clientSlug.
   * Returns a release function that must be called when done.
   * This ensures writes are serialized per-file to prevent race conditions.
   */
  private async acquireWriteLock(clientSlug: string): Promise<() => void> {
    // Wait for any existing write to complete
    const existingLock = this.writeLocks.get(clientSlug);
    if (existingLock) {
      await existingLock.catch(() => {}); // Ignore errors from previous writes
    }
    
    // Create a new lock promise
    let release: () => void;
    const lockPromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    
    this.writeLocks.set(clientSlug, lockPromise);
    
    return release!;
  }

  /**
   * Read status from disk (single source of truth)
   */
  async read(clientSlug: string): Promise<any | null> {
    // Check cache first
    const cached = this.cache.get(clientSlug);
    if (cached && (Date.now() - cached._cacheTime) < this.CACHE_TTL_MS) {
      return { ...cached }; // Return a copy to prevent mutation
    }

    // Read from disk
    const statusPath = this.getStatusPath(clientSlug);
    if (await fs.pathExists(statusPath)) {
      try {
        const status = await fs.readJson(statusPath);
        status._cacheTime = Date.now();
        status._version = this.versions.get(clientSlug) || 0;
        this.cache.set(clientSlug, status);
        return { ...status }; // Return a copy to prevent mutation
      } catch (error: any) {
        logger.error(`Failed to read demo status for ${clientSlug}: ${error.message}`);
        return null;
      }
    }

    // Check active-demos.json as fallback (for demos in early stages)
    if (await fs.pathExists(ACTIVE_DEMOS_FILE)) {
      try {
        const activeDemos = await fs.readJson(ACTIVE_DEMOS_FILE);
        if (activeDemos[clientSlug]) {
          const status = { ...activeDemos[clientSlug] };
          status._cacheTime = Date.now();
          status._version = this.versions.get(clientSlug) || 0;
          this.cache.set(clientSlug, status);
          return status;
        }
      } catch (error: any) {
        logger.error(`Failed to read from active-demos.json: ${error.message}`);
      }
    }

    return null;
  }

  /**
   * Write status with atomic operation and lock protection.
   * Uses a merge strategy to preserve fields not explicitly being updated.
   * 
   * @param clientSlug - The demo identifier
   * @param status - The status fields to write/update
   * @param mergeMode - If 'merge' (default), merges with existing status. If 'replace', replaces entirely.
   */
  async write(clientSlug: string, status: any, mergeMode: 'merge' | 'replace' = 'merge'): Promise<void> {
    // Acquire lock to prevent concurrent writes
    const releaseLock = await this.acquireWriteLock(clientSlug);
    
    try {
      await this._writeInternal(clientSlug, status, mergeMode);
    } finally {
      // Always release the lock
      releaseLock();
    }
  }

  /**
   * Internal write implementation without lock acquisition.
   * Used by atomicUpdate() which already holds the lock.
   * 
   * @param clientSlug - The demo identifier
   * @param status - The status fields to write/update
   * @param mergeMode - If 'merge' (default), merges with existing status. If 'replace', replaces entirely.
   */
  private async _writeInternal(clientSlug: string, status: any, mergeMode: 'merge' | 'replace' = 'merge'): Promise<void> {
    const demoDir = path.join(this.statusDir, clientSlug);
    const statusPath = this.getStatusPath(clientSlug);
    const tmpPath = this.getTempStatusPath(clientSlug);

    // Ensure directory exists if demo is already created
    const dirExists = await fs.pathExists(demoDir);

    // Read existing status from disk (not cache) to get latest state
    let existing: any = {};
    if (dirExists && await fs.pathExists(statusPath)) {
      try {
        existing = await fs.readJson(statusPath);
      } catch (e) {
        // Ignore read errors - start fresh
        existing = {};
      }
    }

    // Merge strategy: new status overrides existing, but preserve unspecified fields
    let finalStatus: any;
    if (mergeMode === 'merge') {
      finalStatus = {
        ...existing,
        ...status,
        // Special handling for logs - always merge, never replace
        logs: Array.isArray(status.logs) 
          ? status.logs 
          : [...(existing.logs || []), ...(status.logs || [])]
      };
    } else {
      // Replace mode - use status as-is but preserve logs
      finalStatus = {
        ...status,
        logs: status.logs || existing.logs || []
      };
    }

    finalStatus.updatedAt = new Date().toISOString();
    
    // Increment version for optimistic concurrency tracking
    const currentVersion = this.versions.get(clientSlug) || 0;
    const newVersion = currentVersion + 1;
    this.versions.set(clientSlug, newVersion);
    finalStatus._version = newVersion;

    // Update cache immediately for consistency
    finalStatus._cacheTime = Date.now();
    this.cache.set(clientSlug, { ...finalStatus });
    
    // Evict oldest entries if cache is too large
    this.evictOldestEntries();

    // Write to disk if directory exists (atomic)
    // CRITICAL: We only write the status file if the directory exists and we are not in the early 'starting' phase.
    // This ensures that for new demos, git clone is the first operation to create files in the directory.
    if (dirExists && finalStatus.state !== 'starting') {
      try {
        // Write to temp file first
        await fs.writeJson(tmpPath, finalStatus, { spaces: 2 });
        // Atomic rename
        await fs.rename(tmpPath, statusPath);
      } catch (error: any) {
        logger.error(`Failed to write demo status for ${clientSlug}: ${error.message}`);
        // Clean up temp file
        await fs.remove(tmpPath).catch(() => {});
        throw error;
      }
    }

    // Update audit log (append-only, best effort)
    try {
      await this.appendToAuditLog(clientSlug, finalStatus);
    } catch (error: any) {
      logger.warn(`Failed to update audit log: ${error.message}`);
      // Don't fail the whole operation
    }

    // Sync with TaskStatusManager (best effort)
    try {
      const taskId = finalStatus.taskId || `demo-${clientSlug}`;
      const statusRoot = dirExists ? demoDir : undefined;

      await taskStatusManager.updateStatus(taskId, {
        state: finalStatus.state.toUpperCase() as any,
        step: finalStatus.message,
        notes: finalStatus.message,
        percent: Math.min(100, Math.floor(((finalStatus.currentStep - 1) / (finalStatus.totalSteps || 4)) * 100))
      }, statusRoot);
    } catch (error: any) {
      logger.warn(`Failed to sync with TaskStatusManager: ${error.message}`);
      // Don't fail the whole operation
    }
  }
  
  /**
   * Atomic update: reads current status, applies updates via callback, and writes back.
   * This is the safest way to update status when you need to modify based on current state.
   * 
   * The entire read-modify-write cycle is protected by a single lock to prevent race conditions.
   * 
   * @param clientSlug - The demo identifier
   * @param updateFn - Function that receives current status and returns the updated status
   */
  async atomicUpdate(clientSlug: string, updateFn: (current: any) => any): Promise<void> {
    // Acquire lock to ensure no concurrent modifications
    const releaseLock = await this.acquireWriteLock(clientSlug);
    
    try {
      // Clear cache to ensure we read from disk
      this.cache.delete(clientSlug);
      
      // Read current status
      const current = await this.read(clientSlug) || {
        state: 'unknown',
        message: '',
        logs: [],
        currentStep: 1,
        totalSteps: 4,
        taskId: `demo-${clientSlug}`
      };
      
      // Apply updates
      const updated = updateFn(current);
      
      // Write the updated status using internal method (no lock acquisition)
      // This ensures the entire read-modify-write is atomic
      await this._writeInternal(clientSlug, updated, 'replace');
    } finally {
      // Always release the lock after the entire operation completes
      releaseLock();
    }
  }

  /**
   * Append to audit log (active-demos.json)
   * This is append-only for historical tracking, not a source of truth
   */
  private async appendToAuditLog(clientSlug: string, status: any): Promise<void> {
    await fs.ensureDir(LOGS_DIR);
    
    let activeDemos: Record<string, any> = {};
    if (await fs.pathExists(ACTIVE_DEMOS_FILE)) {
      try {
        activeDemos = await fs.readJson(ACTIVE_DEMOS_FILE);
      } catch (e) {
        // If file is corrupted, start fresh
        activeDemos = {};
      }
    }

    activeDemos[clientSlug] = {
      ...status,
      _lastAuditUpdate: new Date().toISOString()
    };

    await fs.writeJson(ACTIVE_DEMOS_FILE, activeDemos, { spaces: 2 });
  }

  /**
   * Add a log entry to the status
   */
  async addLog(clientSlug: string, logEntry: string): Promise<void> {
    const status = await this.read(clientSlug) || {
      state: 'unknown',
      message: '',
      logs: [],
      currentStep: 1,
      totalSteps: 4
    };

    const timestamp = new Date().toLocaleTimeString();
    status.logs = status.logs || [];
    status.logs.push(`[${timestamp}] ${logEntry}`);

    await this.write(clientSlug, status);
  }

  /**
   * Clear cache for a specific demo (force reload from disk)
   */
  clearCache(clientSlug: string): void {
    this.cache.delete(clientSlug);
  }
}

// Singleton instance - exported for use in other modules (e.g., publish endpoints)
export const demoStatusManager = new DemoStatusManager();

/**
 * Normalizes a string into a URL-safe slug
 */
function normalizeSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '') // Remove non-word characters (except spaces and hyphens)
    .replace(/[\s_]+/g, '-')  // Replace spaces and underscores with hyphens
    .replace(/^-+|-+$/g, ''); // Trim hyphens from start and end
}

/**
 * Checks if a slug is reserved or already in use
 */
export async function isSlugAvailable(slug: string): Promise<{ available: boolean; reason?: string }> {
  const normalized = normalizeSlug(slug);
  
  // Validate that the normalized slug is not empty and contains valid characters
  if (!normalized || normalized.length === 0) {
    return { available: false, reason: 'Invalid slug format. Slug must contain valid characters.' };
  }
  
  // Validate slug pattern (only lowercase letters, numbers, and hyphens)
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(normalized)) {
    return { available: false, reason: 'Invalid slug format. Use only lowercase letters, numbers, and hyphens.' };
  }
  
  if (RESERVED_SLUGS.has(normalized)) {
    return { available: false, reason: 'This name is reserved for system use.' };
  }

  const demoDir = path.join(process.cwd(), 'client-websites', normalized);
  if (await fs.pathExists(demoDir)) {
    return { available: false, reason: 'A project with this name already exists.' };
  }

  // Check if demo is in active creation
  const status = await demoStatusManager.read(normalized);
  if (status && isDemoInActiveCreation(status)) {
    return { available: false, reason: 'This project is currently being created.' };
  }

  return { available: true };
}

/**
 * Updates the demo status (single source of truth)
 */
async function updateStatus(clientSlug: string, state: string, message: string, logLine?: string) {
  // Read current status
  const currentStatus = await demoStatusManager.read(clientSlug);
  
  const status = {
    state,
    message,
    logs: currentStatus?.logs || [],
    updatedAt: new Date().toISOString(),
    currentStep: currentStatus?.currentStep || 1,
    totalSteps: currentStatus?.totalSteps || 4,
    taskId: currentStatus?.taskId || `demo-${clientSlug}`
  };

  // Add log entry if provided
  if (logLine) {
    const timestamp = new Date().toLocaleTimeString();
    status.logs.push(`[${timestamp}] ${logLine}`);
  }

  // Write status (handles all syncing internally)
  await demoStatusManager.write(clientSlug, status);
  
  logger.info(`Demo status updated for ${clientSlug}: ${state} - ${message}`);
}

/**
 * Finds the most likely images directory in the template
 */
async function findImagesDir(demoDir: string): Promise<string> {
  const possibleDirs = [
    'src/assets/images',
    'src/images',
    'public/images',
    'public/assets/images',
    'assets/images',
    'images',
    'src/img',
    'public/img',
    'img'
  ];

  for (const dir of possibleDirs) {
    if (await fs.pathExists(path.join(demoDir, dir))) {
      return dir;
    }
  }

  // Default to src/assets/images if nothing found
  return 'src/assets/images';
}

/**
 * Checks if a demo is currently in an active creation state
 */
export function isDemoInActiveCreation(status: any): boolean {
  if (!status || !status.state) return false;
  
  const activeStates = ['cloning', 'installing', 'organizing', 'prompting', 'triggering'];
  if (!activeStates.includes(status.state)) return false;

  // Check for stale state (older than 30 minutes)
  if (status.updatedAt) {
    const updatedAt = new Date(status.updatedAt).getTime();
    const now = Date.now();
    const staleTime = 30 * 60 * 1000; // 30 minutes
    if (now - updatedAt > staleTime) {
      logger.warn(`Demo creation state "${status.state}" is stale (last update: ${status.updatedAt}).`);
      return false;
    }
  }

  return true;
}

/**
 * Normalizes a string into a URL-safe slug and ensures uniqueness
 */
export async function generateUniqueSlug(businessName: string, providedSlug?: string): Promise<string> {
  let clientSlug = normalizeSlug(providedSlug || businessName);
  
  // If the user didn't provide a manual slug, and it already exists or is reserved, 
  // append a unique ID to avoid blocking different clients with the same business name.
  const availability = await isSlugAvailable(clientSlug);
  
  if (!availability.available && !providedSlug) {
    const baseSlug = clientSlug;
    let attempts = 0;
    while (attempts < 5) {
      const suffix = Math.random().toString(36).substring(2, 6);
      clientSlug = `${baseSlug}-${suffix}`;
      const check = await isSlugAvailable(clientSlug);
      if (check.available) break;
      attempts++;
    }
  }

  // Reserve the slug immediately to prevent race conditions
  await demoStatusManager.write(clientSlug, {
    state: 'starting',
    message: 'Reserving slug for demo creation...',
    logs: [],
    currentStep: 1,
    totalSteps: 4,
    taskId: `demo-${clientSlug}`
  });

  return clientSlug;
}

/**
 * Handles demo creation logic: clone, organize, prompt, trigger
 * 
 * @param data - Form data including businessName, services, email, phone, address, colors, etc.
 * @param files - Uploaded files (logo, heroImage)
 */
export async function createDemo(data: any, files: any) {
  const businessName = data.businessName;
  const clientSlug = data.clientSlug || await generateUniqueSlug(businessName);
  
  const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
  
  logger.info(`Starting demo creation for: ${businessName} (${clientSlug})`);
  
  try {
    // 0. Validate git settings before starting (pre-flight check)
    if (!areGitSettingsConfigured()) {
      throw new Error(
        'Git configuration is incomplete. Please configure git settings in config.json ' +
        '(required: clientWebsitesDir, defaultBranch, githubToken, userName, userEmail).'
      );
    }

    // 1. Resolve template repo URL first (needed for cloning)
    let repoUrl = data.githubRepoUrl;
    
    // Resolve templateId if githubRepoUrl is missing
    if (!repoUrl && data.templateId) {
      repoUrl = TEMPLATE_MAP[data.templateId];
      if (!repoUrl) {
        throw new Error(`Invalid template selection: ${data.templateId}`);
      }
    }

    if (!repoUrl) {
      throw new Error('No template repository URL or valid templateId provided.');
    }

    // 2. Prevent collisions - check status from single source of truth
    const currentStatus = await demoStatusManager.read(clientSlug);
    const dirExists = await fs.pathExists(demoDir);

    if (isDemoInActiveCreation(currentStatus)) {
      throw new Error(`A demo for slug "${clientSlug}" is already in progress (${currentStatus.state}). Please wait for it to complete or fail before re-creating.`);
    }
    
    // 3. Clean up existing folder if it exists (BEFORE any new files are made)
    if (dirExists) {
      logger.warn(`Cleaning up existing folder for ${clientSlug} before re-creation`);
      // Stop any running preview app first to release file locks
      try {
        await visualTester.stopApp(demoDir);
      } catch (e) {
        logger.warn(`Error stopping app during cleanup: ${e}`);
      }

      // Attempt removal with multiple retries for Windows
      let removed = false;
      let attempts = 0;
      while (!removed && attempts < 3) {
        try {
          await fs.remove(demoDir);
          removed = true;
        } catch (removeError: any) {
          attempts++;
          logger.warn(`Failed to remove directory ${demoDir} (attempt ${attempts}): ${removeError.message}`);
          if (attempts < 3) {
            // Wait a bit longer each time
            await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
          } else {
            throw new Error(`Could not clean up existing demo folder. Please ensure no files or terminals are open in "${clientSlug}".`);
          }
        }
      }
    }
    
    // 4. Clone template repo as the VERY FIRST file-creating action in the new folder
    // We update status to 'cloning' but since the directory was just removed (or didn't exist),
    // this status update will NOT create a demo.status.json file in the demo folder yet.
    await updateStatus(clientSlug, 'cloning', `Cloning template for ${businessName}...`, `Target directory: ${demoDir}`);
    
    // Convert URL to appropriate format based on config.git.useSSH setting
    const cloneUrl = getCloneUrl(repoUrl);
    const useSSH = config.git.useSSH ?? false;
    logger.info(`Cloning using ${useSSH ? 'SSH' : 'HTTPS'} URL: ${cloneUrl}`);
    
    const git = simpleGit();
    try {
      // Use shallow clone for speed and to avoid large history
      await git.clone(cloneUrl, demoDir, ['--depth', '1']);
      logger.info(`Successfully cloned template from ${cloneUrl} into ${demoDir}`);
      await updateStatus(clientSlug, 'cloning', `Cloning template for ${businessName}...`, `Successfully cloned template from ${cloneUrl}`);
    } catch (cloneError: any) {
      logger.error(`Failed to clone repository ${cloneUrl}: ${cloneError.message}`);
      const sshHint = useSSH ? ' If using SSH, ensure your SSH key is added to GitHub.' : '';
      throw new Error(`Failed to clone template repository.${sshHint} Please ensure the URL is correct and the repository is accessible. Error: ${cloneError.message}`);
    }
    
    // 5. Robust Git Workflow: Reset and initialize a fresh repo
    await updateStatus(clientSlug, 'cloning', 'Initializing fresh Git repository...', 'Cleaning up template git history and initializing fresh repo...');
    await fs.remove(path.join(demoDir, '.git'));
    
    const newGit = simpleGit(demoDir);
    await newGit.init();
    
    // Ensure we are on the branch specified in config (default 'main')
    const targetBranch = config.git.defaultBranch || 'main';
    try {
      // Rename current branch to the target branch name
      // This works even before the first commit to set the default branch name
      await newGit.raw(['branch', '-M', targetBranch]);
      logger.info(`Initialized repository with branch: ${targetBranch}`);
      await updateStatus(clientSlug, 'cloning', 'Initializing fresh Git repository...', `Set repository branch to ${targetBranch}`);
    } catch (branchError: any) {
      logger.warn(`Could not set branch to ${targetBranch}: ${branchError.message}`);
    }
    
    // Apply configured git user (or fallback defaults) to prevent commit failure
    const gitUser = getGitUserConfig();
    await newGit.addConfig('user.name', gitUser.name);
    await newGit.addConfig('user.email', gitUser.email);
    
    await newGit.add('.');
    await newGit.commit('Initial commit from template');
    logger.info(`Fresh Git repository initialized for ${clientSlug}`);
    await updateStatus(clientSlug, 'cloning', 'Initializing fresh Git repository...', 'Created initial commit');

    // Capture base commit for state persistence later
    const baseCommit = await newGit.revparse(['HEAD']);

    // Validate git setup after initialization
    const taskId = `demo-${clientSlug}`;
    const gitValidation = await validateGitSetup(demoDir, taskId, true);
    if (!gitValidation.isValid) {
      throw new Error(`Git validation failed after initialization: ${gitValidation.errors.join('; ')}`);
    }
    if (gitValidation.warnings.length > 0) {
      logger.warn(`Git validation warnings for ${taskId}: ${gitValidation.warnings.join('; ')}`);
    }

    // Mock ClickUpTask for the agent - Define early so it can be used for state tracking
    const mockTask: any = {
      id: `demo-${clientSlug}`,
      name: `Demo: ${businessName}`,
      description: `Create demo site for ${businessName}`,
      custom_fields: [
        { name: 'Client Name', value: businessName }
      ]
    };

    // Push logic removed as per user request to keep demo creation local
    const pushSkippedMsg = 'Local development mode: Push to remote repository skipped.';
    await updateStatus(clientSlug, 'cloning', pushSkippedMsg, pushSkippedMsg);
    logger.info(`Demo setup for ${clientSlug} is local only.`);

    // 4. Dependency Installation (includes rebuild for cross-platform native modules like Sharp)
    await updateStatus(clientSlug, 'installing', 'Installing dependencies...', 'Running npm install && npm rebuild (this may take a minute)...');
    await new Promise<void>((resolve, reject) => {
      exec('npm install && npm rebuild', { cwd: demoDir }, (error, stdout, stderr) => {
        if (error) {
          logger.error(`npm install/rebuild failed for ${clientSlug}: ${error.message}`);
          logger.error(`stderr: ${stderr}`);
          updateStatus(clientSlug, 'failed', `Dependency installation failed: ${error.message}`, `Error: ${error.message}\n${stderr}`).catch(()=>{});
          reject(new Error(`Failed to install dependencies: ${error.message}`));
        } else {
          logger.info(`npm install && rebuild completed for ${clientSlug}`);
          updateStatus(clientSlug, 'installing', 'Installing dependencies...', 'Successfully installed dependencies.').then(() => resolve());
        }
      });
    });
    
    // 5. Detect images directory and ensure it exists
    await updateStatus(clientSlug, 'organizing', 'Processing brand assets and organizing files...', 'Detecting images directory...');
    const relativeImagesDir = await findImagesDir(demoDir);
    const imagesDir = path.join(demoDir, relativeImagesDir);
    await fs.ensureDir(imagesDir);
    logger.info(`Using images directory: ${relativeImagesDir}`);
    await updateStatus(clientSlug, 'organizing', 'Processing brand assets and organizing files...', `Using images directory: ${relativeImagesDir}`);
    
    // 6. Move uploaded files
    const assetMap: Record<string, string> = {};
    const ALLOWED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.svg'];
    const ALLOWED_MIME_TYPES = [
      'image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/svg+xml'
    ];
    
    if (files) {
      const moveFile = async (fieldname: string, targetName: string) => {
        const fileArray = files[fieldname];
        const file = Array.isArray(fileArray) ? fileArray[0] : fileArray;
        
        if (file) {
          const ext = path.extname(file.originalname).toLowerCase();
          const mimeType = file.mimetype?.toLowerCase();
          
          // Validate both extension AND MIME type for security
          if (!ALLOWED_EXTENSIONS.includes(ext)) {
            logger.warn(`Unsupported file extension for ${fieldname}: ${ext}. Skipping file.`);
            await updateStatus(clientSlug, 'organizing', 'Processing brand assets...', `Warning: Rejected file with unsupported extension ${ext}`);
            return; // Skip this file instead of processing it
          }
          
          if (mimeType && !ALLOWED_MIME_TYPES.includes(mimeType)) {
            logger.warn(`MIME type mismatch for ${fieldname}: ${mimeType} (extension: ${ext}). Skipping file.`);
            await updateStatus(clientSlug, 'organizing', 'Processing brand assets...', `Warning: Rejected file with mismatched MIME type ${mimeType}`);
            return; // Skip this file - MIME type doesn't match expected image types
          }
          const fileName = `${targetName}${ext}`;
          const targetPath = path.join(imagesDir, fileName);
          await fs.move(file.path, targetPath, { overwrite: true });
          
          // We'll provide both the path relative to the demo root and the filename
          assetMap[fieldname] = {
            path: `${relativeImagesDir}/${fileName}`,
            fileName: fileName
          } as any;
          logger.info(`Moved ${fieldname} to ${targetPath}`);
          await updateStatus(clientSlug, 'organizing', 'Processing brand assets...', `Moved ${fieldname} to ${relativeImagesDir}/${fileName}`);
        }
      };
      
      await moveFile('logo', 'logo');
      await moveFile('heroImage', 'hero');
    }
    
    // 7. Save task state and metadata
    const { saveTaskState, WorkflowState } = await import('../state/stateManager');
    await saveTaskState(demoDir, mockTask.id, {
      baseCommitHash: baseCommit,
      state: WorkflowState.IN_PROGRESS,
      branchName: targetBranch
    });

    // Get ImageRetriever path (absolute path for the agent to use)
    const imageRetrieverPath = imageRetrieverService.getImageRetrieverPath();
    
    // Determine AI model configuration
    // aiModel is the default model for all steps
    // stepXModel allows per-step overrides
    const defaultModel = data.aiModel || config.cursor.defaultModel;
    const stepModels: Record<number, string | undefined> = {
      1: data.step1Model || defaultModel,
      2: data.step2Model || defaultModel,
      3: data.step3Model || defaultModel,
      4: data.step4Model || defaultModel,
    };
    
    const context = {
      ...data,
      clientSlug,
      imagesDir: relativeImagesDir,
      assets: assetMap,
      imageRetrieverPath, // Add ImageRetriever path for agent usage
      aiModel: defaultModel,
      stepModels, // Per-step model configuration
      createdAt: new Date().toISOString()
    };
    await fs.writeJson(path.join(demoDir, 'demo.context.json'), context, { spaces: 2 });
    await updateStatus(clientSlug, 'organizing', 'Organizing files...', 'Saved demo context metadata.');
    
    // 8. Generate CURSOR_TASK.md
    await updateStatus(clientSlug, 'prompting', 'Generating customization instructions...', 'Generating CURSOR_TASK.md for Step 1 (Branding)...');
    
    const promptTemplatePath = path.join(process.cwd(), 'prompts', 'demo_step1_branding.md');
    let promptContent = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Replace placeholders - services describes what the business offers (collected from form)
    const replacements: Record<string, string> = {
      '{{taskId}}': mockTask.id,
      '{{currentStep}}': '1',
      '{{totalSteps}}': '4',
      '{{businessName}}': businessName,
      '{{clientSlug}}': clientSlug,
      '{{email}}': data.email || 'N/A',
      '{{phone}}': data.phone || 'N/A',
      '{{address}}': data.address || 'N/A',
      '{{services}}': data.services || 'N/A', // Business services/description from user input
      '{{primaryColor}}': data.primaryColor || '#000000',
      '{{secondaryColor}}': data.secondaryColor || '#ffffff',
      '{{fontFamily}}': data.fontFamily || 'sans-serif',
      '{{imagesDir}}': relativeImagesDir,
      '{{imageRetrieverPath}}': imageRetrieverPath,
      '{{workflowHistory}}': '[]' // No history for step 1
    };
    
    for (const [key, value] of Object.entries(replacements)) {
      promptContent = promptContent.split(key).join(value);
    }
    
    await fs.writeFile(path.join(demoDir, 'CURSOR_TASK.md'), promptContent, 'utf-8');
    await updateStatus(clientSlug, 'prompting', 'Generating customization instructions...', 'Successfully generated CURSOR_TASK.md');
    
    // 9. Trigger Cursor agent
    await updateStatus(clientSlug, 'triggering', 'Triggering Cursor agent to customize site...', 'Adding task to Cursor Agent Queue...');
    
    // triggerCursorAgent handles adding to queue and starting the agent
    // Pass the model for step 1 (branding)
    await triggerCursorAgent(demoDir, mockTask, { 
      model: context.stepModels[1] 
    });
    
    await updateStatus(clientSlug, 'running', 'Cursor agent is now customizing the site.', 'Cursor agent triggered and running.');
    
    return {
      success: true,
      clientSlug,
      demoPath: `client-websites/${clientSlug}`,
      status: 'running',
      message: 'Demo created and Cursor agent triggered.'
    };
    
  } catch (error: any) {
    logger.error(`Error creating demo for ${businessName}: ${error.message}`);
    
    // Try to update status if we have a slug
    if (clientSlug) {
      try {
        await updateStatus(clientSlug, 'failed', error.message);
      } catch (e) {
        // Ignore errors in status update during error handling
      }
    }
    
    throw error;
  }
}

/**
 * Estimates progress based on event analysis from agent logs.
 * Used as a fallback when taskStatus.percent is stuck at initial values.
 * 
 * Heuristic:
 * - Base: 10% (agent is working)
 * - Each edit/write tool completion: +10%
 * - Each thinking completion: +2%
 * - Max: 85% (reserve 100% for actual completion)
 * 
 * @param agentLogs - Array of log events from the agent
 * @returns Estimated progress percentage (10-85)
 */
function estimateProgressFromEvents(agentLogs: any[]): number {
  if (!agentLogs || agentLogs.length === 0) {
    return 5; // Just started, no events yet
  }
  
  // Count meaningful file modification events (edit/write completions)
  const editCount = agentLogs.filter(log => {
    if (log.type !== 'tool_call' || log.subtype !== 'completed') {
      return false;
    }
    const toolCall = log.tool_call || {};
    const toolName = Object.keys(toolCall)[0];
    // Count edit and write operations as meaningful progress
    return toolName && (
      toolName === 'editToolCall' || 
      toolName === 'edit_file' || 
      toolName === 'search_replace' ||
      toolName === 'writeToolCall' || 
      toolName === 'write'
    );
  }).length;
  
  // Count thinking completions (agent made decisions)
  const thinkingComplete = agentLogs.filter(log => 
    log.type === 'thinking' && log.subtype === 'completed'
  ).length;
  
  // Count tool starts (shows activity even before completions)
  const toolStarts = agentLogs.filter(log =>
    log.type === 'tool_call' && log.subtype === 'started'
  ).length;
  
  // Heuristic calculation:
  // - Base 10% for having any activity
  // - Each file edit/write: +10% (major progress)
  // - Each thinking completion: +2% (minor progress)
  // - Each tool start (when no edits yet): +1% (shows activity)
  let estimated = 10;
  estimated += editCount * 10;
  estimated += thinkingComplete * 2;
  
  // If no edits yet, count tool starts for some progress indication
  if (editCount === 0) {
    estimated += Math.min(toolStarts, 10); // Cap at +10% from tool starts
  }
  
  // Cap at 85% - reserve higher values for actual completion
  return Math.min(85, estimated);
}

/**
 * Gets the status of a demo creation (single source of truth)
 */
export async function getDemoStatus(clientSlug: string) {
  const status = await demoStatusManager.read(clientSlug);
  if (!status) return null;

  // If the demo is running or transitioning, merge real-time logs from TaskStatusManager
  // to provide detailed agent progress on the demo creation page.
  if (status.state === 'running' || status.state === 'triggering' || status.state === 'starting') {
    try {
      const baseTaskId = status.taskId || `demo-${clientSlug}`;
      const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
      const currentStep = status.currentStep || 1;
      
      // Collect logs from ALL steps (completed + current) for full history
      const allFormattedLogs: string[] = [];
      // Store current step's raw logs for progress estimation
      let currentStepRawLogs: any[] = [];
      
      for (let step = 1; step <= currentStep; step++) {
        const taskId = step === 1 ? baseTaskId : `${baseTaskId}-step${step}`;
        
        // Fetch logs for this step (more for current step, fewer for past steps)
        const logsToFetch = step === currentStep ? 50 : 20;
        const agentLogs = await taskStatusManager.getLogs(taskId, logsToFetch, demoDir);
        
        // Capture current step's raw logs for progress estimation
        if (step === currentStep && agentLogs) {
          currentStepRawLogs = agentLogs;
        }
        
        if (agentLogs && agentLogs.length > 0) {
          // Add step header for clarity
          if (step > 1 || currentStep > 1) {
            const stepNames = ['Branding', 'Copywriting', 'Imagery', 'Review'];
            const firstLogTime = agentLogs[0]?.timestamp 
              ? new Date(agentLogs[0].timestamp).toLocaleTimeString() 
              : new Date().toLocaleTimeString();
            allFormattedLogs.push(`[${firstLogTime}] === Step ${step}: ${stepNames[step - 1] || 'Processing'} ===`);
          }
          
          // Convert structured agent logs to user-friendly strings using logFormatter
          // This filters out streaming chunks and transforms tool calls into readable messages
          const formattedStepLogs = agentLogs.map(log => {
            const formattedMessage = formatLogEntry(log);
            
            // formatLogEntry returns null for events that should be filtered out
            if (!formattedMessage) {
              return null;
            }
            
            const time = formatTimestamp(log.timestamp);
            return `[${time}] ${formattedMessage}`;
          }).filter(Boolean) as string[];
          
          allFormattedLogs.push(...formattedStepLogs);
        }
      }
      
      // Get current step's progress from TaskStatusManager for granular progress tracking
      // Use event-based estimation as fallback when taskStatus.percent is stuck
      let currentStepProgress = 0;
      if (status.state === 'running') {
        const currentTaskId = currentStep === 1 ? baseTaskId : `${baseTaskId}-step${currentStep}`;
        const taskStatus = await taskStatusManager.getStatus(currentTaskId, demoDir);
        
        // Use taskStatus.percent if valid (not stuck at initial 5% or near completion 90%+)
        if (taskStatus && taskStatus.percent > 5 && taskStatus.percent < 90) {
          currentStepProgress = taskStatus.percent;
        } else {
          // Fallback to event-based estimation for more responsive progress
          currentStepProgress = estimateProgressFromEvents(currentStepRawLogs);
        }
      }

      // Return status with currentStepProgress even if no logs yet
      // This ensures the progress bar updates smoothly during agent execution
      return {
        ...status,
        logs: allFormattedLogs.length > 0 
          ? [...(status.logs || []), ...allFormattedLogs] 
          : (status.logs || []),
        currentStepProgress
      };
    } catch (error) {
      logger.warn(`Could not merge agent logs for demo ${clientSlug}: ${error}`);
    }
  }

  return status;
}

/**
 * Advances the demo to the next step after approval.
 * Generates a new CURSOR_TASK.md and triggers the agent for the next step.
 */
export async function advanceDemoStep(clientSlug: string): Promise<void> {
  const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
  
  // Read current status
  const status = await demoStatusManager.read(clientSlug);
  if (!status) {
    throw new Error(`Demo status not found for ${clientSlug}`);
  }
  
  const currentStep = status.currentStep || 1;
  const totalSteps = status.totalSteps || 4;
  const nextStep = currentStep + 1;
  
  if (nextStep > totalSteps) {
    throw new Error(`Demo ${clientSlug} is already at the final step`);
  }
  
  logger.info(`Advancing demo ${clientSlug} from step ${currentStep} to step ${nextStep}`);
  
  // Validate git setup before advancing to next step (safety check)
  const taskId = `demo-${clientSlug}-step${nextStep}`;
  const gitValidation = await validateGitSetup(demoDir, taskId, true);
  if (!gitValidation.isValid) {
    throw new Error(`Git validation failed before advancing to step ${nextStep}: ${gitValidation.errors.join('; ')}`);
  }
  if (gitValidation.warnings.length > 0) {
    logger.warn(`Git validation warnings for ${taskId}: ${gitValidation.warnings.join('; ')}`);
  }
  
  // Read demo context
  const contextPath = path.join(demoDir, 'demo.context.json');
  let context: any = {};
  if (await fs.pathExists(contextPath)) {
    context = await fs.readJson(contextPath);
  }
  
  // Step name mapping
  const stepNames = ['branding', 'copywriting', 'imagery', 'review'];
  const stepName = stepNames[nextStep - 1] || 'step';
  
  // Update status to transitioning
  await updateStatus(clientSlug, 'triggering', `Preparing Step ${nextStep}: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)}...`, `Step ${currentStep} approved. Advancing to step ${nextStep}.`);
  
  // Update status with new step number
  const newStatus = {
    ...status,
    currentStep: nextStep,
    state: 'triggering',
    message: `Starting Step ${nextStep}: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`,
    logs: status.logs || []
  };
  await demoStatusManager.write(clientSlug, newStatus);
  
  // Generate new CURSOR_TASK.md for the next step
  const promptTemplatePath = path.join(process.cwd(), 'prompts', `demo_step${nextStep}_${stepName}.md`);
  
  if (!await fs.pathExists(promptTemplatePath)) {
    logger.warn(`Prompt template not found: ${promptTemplatePath}. Using generic step prompt.`);
    // Create a generic prompt if template doesn't exist
    const genericPrompt = `# Demo Step ${nextStep}: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)}

Continue customizing the demo site for {{businessName}}.

## Context
- Business: {{businessName}}
- Email: {{email}}
- Phone: {{phone}}
- Address: {{address}}
- Services: {{services}}
- Primary Color: {{primaryColor}}

## Task
Complete step ${nextStep} (${stepName}) of the demo customization.

## Important
- Build upon the work from previous steps
- Maintain consistency with branding decisions
- Test your changes work correctly
`;
    await fs.writeFile(promptTemplatePath, genericPrompt, 'utf-8');
  }
  
  let promptContent = await fs.readFile(promptTemplatePath, 'utf-8');
  
  // Get workflow history (previous steps' summaries)
  const workflowHistory: any[] = [];
  for (let i = 1; i < nextStep; i++) {
    const historyPath = path.join(demoDir, '.cursor', 'history', `step${i}_summary.json`);
    if (await fs.pathExists(historyPath)) {
      try {
        const summary = await fs.readJson(historyPath);
        workflowHistory.push({ step: i, ...summary });
      } catch (e) {
        logger.warn(`Could not read step ${i} history: ${e}`);
      }
    }
  }
  
  // Get ImageRetriever path
  const imageRetrieverPath = imageRetrieverService.getImageRetrieverPath();
  
  // Replace placeholders
  const replacements: Record<string, string> = {
    '{{taskId}}': `demo-${clientSlug}-step${nextStep}`,
    '{{currentStep}}': String(nextStep),
    '{{totalSteps}}': String(totalSteps),
    '{{businessName}}': context.businessName || clientSlug,
    '{{clientSlug}}': clientSlug,
    '{{email}}': context.email || 'N/A',
    '{{phone}}': context.phone || 'N/A',
    '{{address}}': context.address || 'N/A',
    '{{services}}': context.services || 'N/A',
    '{{primaryColor}}': context.primaryColor || '#000000',
    '{{secondaryColor}}': context.secondaryColor || '#ffffff',
    '{{fontFamily}}': context.fontFamily || 'sans-serif',
    '{{imagesDir}}': context.imagesDir || 'src/assets/images',
    '{{imageRetrieverPath}}': imageRetrieverPath,
    '{{workflowHistory}}': JSON.stringify(workflowHistory, null, 2)
  };
  
  for (const [key, value] of Object.entries(replacements)) {
    promptContent = promptContent.split(key).join(value);
  }
  
  await fs.writeFile(path.join(demoDir, 'CURSOR_TASK.md'), promptContent, 'utf-8');
  
  // Create mock task for the new step
  const mockTask: any = {
    id: `demo-${clientSlug}-step${nextStep}`,
    name: `Demo Step ${nextStep}: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)} - ${context.businessName || clientSlug}`,
    description: `Step ${nextStep} of demo customization for ${context.businessName || clientSlug}`,
    custom_fields: [
      { name: 'Client Name', value: context.businessName || clientSlug }
    ]
  };
  
  // Get the model for this step
  const stepModel = context.stepModels?.[nextStep] || context.aiModel || config.cursor.defaultModel;
  
  // Trigger the agent
  await triggerCursorAgent(demoDir, mockTask, { model: stepModel });
  
  // Update status to running
  await updateStatus(clientSlug, 'running', `Cursor agent working on Step ${nextStep}: ${stepName.charAt(0).toUpperCase() + stepName.slice(1)}`, `Agent triggered for step ${nextStep}.`);
  
  logger.info(`Demo ${clientSlug} advanced to step ${nextStep}`);
}

/**
 * Builds a demo site by running npm run build.
 * This generates static files in the public/ folder for production serving.
 * 
 * @param slug - The demo/client folder slug
 * @param force - If true, always rebuilds even if public folder exists
 * @returns Object with success status and build info
 */
export async function buildDemo(slug: string, force: boolean = false): Promise<{
  success: boolean;
  slug: string;
  message: string;
  publicDir?: string;
  error?: string;
}> {
  const demoDir = path.join(process.cwd(), 'client-websites', slug);
  const publicDir = path.join(demoDir, 'public');
  const packageJsonPath = path.join(demoDir, 'package.json');
  
  logger.info(`Building demo ${slug}${force ? ' (forced)' : ''}...`);
  
  // Check if demo directory exists
  if (!await fs.pathExists(demoDir)) {
    logger.warn(`Demo directory not found: ${demoDir}`);
    return {
      success: false,
      slug,
      message: `Demo directory not found`,
      error: `No demo found at client-websites/${slug}`
    };
  }
  
  // Check if package.json exists
  if (!await fs.pathExists(packageJsonPath)) {
    logger.warn(`No package.json found for ${slug}, cannot build`);
    return {
      success: false,
      slug,
      message: 'No package.json found',
      error: 'This demo does not have a package.json. It may not be a buildable project.'
    };
  }
  
  // Read package.json to check for build script
  let pkg: any;
  try {
    pkg = await fs.readJson(packageJsonPath);
  } catch (e: any) {
    logger.error(`Failed to read package.json for ${slug}: ${e.message}`);
    return {
      success: false,
      slug,
      message: 'Failed to read package.json',
      error: e.message
    };
  }
  
  if (!pkg.scripts?.build) {
    logger.warn(`No build script found in package.json for ${slug}`);
    return {
      success: false,
      slug,
      message: 'No build script found',
      error: 'This project does not have a "build" script in package.json.'
    };
  }
  
  // Run the build with activity-based timeout and retry logic
  logger.info(`Running npm run build for ${slug}...`);
  
  const buildConfig = config.build || {
    baseTimeoutMs: 120000,
    activityTimeoutMs: 60000,
    maxRetries: 2,
    retryDelayMs: 3000
  };
  
  const runBuildWithActivityTimeout = (): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> => {
    return new Promise((resolve) => {
      let stdout = '';
      let stderr = '';
      let activityTimer: NodeJS.Timeout | null = null;
      let baseTimer: NodeJS.Timeout | null = null;
      let resolved = false;
      
      const cleanup = () => {
        if (activityTimer) clearTimeout(activityTimer);
        if (baseTimer) clearTimeout(baseTimer);
      };
      
      const finishWithResult = (result: { success: boolean; stdout: string; stderr: string; error?: string }) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        resolve(result);
      };
      
      const resetActivityTimer = () => {
        if (activityTimer) clearTimeout(activityTimer);
        activityTimer = setTimeout(() => {
          if (!resolved) {
            logger.warn(`Build for ${slug} timed out due to inactivity (${buildConfig.activityTimeoutMs}ms without output)`);
            buildProcess.kill('SIGTERM');
            setTimeout(() => {
              if (!resolved) {
                buildProcess.kill('SIGKILL');
              }
            }, 5000);
            finishWithResult({ 
              success: false, 
              stdout, 
              stderr, 
              error: `Build timed out - no output for ${buildConfig.activityTimeoutMs / 1000} seconds` 
            });
          }
        }, buildConfig.activityTimeoutMs);
      };
      
      // Set base timeout (maximum allowed time regardless of activity)
      baseTimer = setTimeout(() => {
        if (!resolved) {
          logger.warn(`Build for ${slug} exceeded maximum timeout (${buildConfig.baseTimeoutMs}ms)`);
          buildProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!resolved) {
              buildProcess.kill('SIGKILL');
            }
          }, 5000);
          finishWithResult({ 
            success: false, 
            stdout, 
            stderr, 
            error: `Build exceeded maximum timeout of ${buildConfig.baseTimeoutMs / 1000} seconds` 
          });
        }
      }, buildConfig.baseTimeoutMs);
      
      // Start the build process using spawn for streaming output
      const buildProcess: ChildProcess = spawn('npm', ['run', 'build'], {
        cwd: demoDir,
        shell: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      // Start activity timer
      resetActivityTimer();
      
      // Handle stdout - reset activity timer on each output
      buildProcess.stdout?.on('data', (data) => {
        const output = data.toString();
        stdout += output;
        logger.debug(`[${slug}] build stdout: ${output.trim()}`);
        resetActivityTimer();
      });
      
      // Handle stderr - reset activity timer on each output
      buildProcess.stderr?.on('data', (data) => {
        const output = data.toString();
        stderr += output;
        logger.debug(`[${slug}] build stderr: ${output.trim()}`);
        resetActivityTimer();
      });
      
      // Handle process completion
      buildProcess.on('close', (code) => {
        if (code === 0) {
          finishWithResult({ success: true, stdout, stderr });
        } else {
          finishWithResult({ 
            success: false, 
            stdout, 
            stderr, 
            error: `Build exited with code ${code}` 
          });
        }
      });
      
      // Handle process errors
      buildProcess.on('error', (err) => {
        finishWithResult({ 
          success: false, 
          stdout, 
          stderr, 
          error: `Build process error: ${err.message}` 
        });
      });
    });
  };
  
  // Retry logic with exponential backoff
  let lastError = '';
  for (let attempt = 0; attempt <= buildConfig.maxRetries; attempt++) {
    if (attempt > 0) {
      const delay = buildConfig.retryDelayMs * Math.pow(2, attempt - 1);
      logger.info(`Retrying build for ${slug} (attempt ${attempt + 1}/${buildConfig.maxRetries + 1}) after ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
    
    const result = await runBuildWithActivityTimeout();
    
    if (result.success) {
      // Verify public folder was created
      if (fs.existsSync(publicDir)) {
        logger.info(`Build completed successfully for ${slug}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`);
        return {
          success: true,
          slug,
          message: 'Build completed successfully',
          publicDir: `client-websites/${slug}/public`
        };
      } else {
        logger.warn(`Build completed but public folder not found for ${slug}`);
        return {
          success: false,
          slug,
          message: 'Build completed but no output',
          error: 'Build completed but the public/ folder was not created. Check your eleventy config.'
        };
      }
    }
    
    lastError = result.error || 'Unknown build error';
    logger.error(`Build attempt ${attempt + 1} failed for ${slug}: ${lastError}`);
    logger.debug(`Build stdout: ${result.stdout}`);
    logger.debug(`Build stderr: ${result.stderr}`);
  }
  
  // All retries exhausted
  return {
    success: false,
    slug,
    message: 'Build failed after all retries',
    error: lastError
  };
}

/**
 * Checks if a demo has been built (has a public/ folder with index.html).
 * 
 * @param slug - The demo/client folder slug
 * @returns Object with build status info
 */
export async function checkDemoBuildStatus(slug: string): Promise<{
  isBuilt: boolean;
  hasPackageJson: boolean;
  hasBuildScript: boolean;
  publicDir?: string;
  lastModified?: string;
}> {
  const demoDir = path.join(process.cwd(), 'client-websites', slug);
  const publicDir = path.join(demoDir, 'public');
  const indexPath = path.join(publicDir, 'index.html');
  const packageJsonPath = path.join(demoDir, 'package.json');
  
  const result: {
    isBuilt: boolean;
    hasPackageJson: boolean;
    hasBuildScript: boolean;
    publicDir?: string;
    lastModified?: string;
  } = {
    isBuilt: false,
    hasPackageJson: false,
    hasBuildScript: false
  };
  
  // Check package.json
  if (await fs.pathExists(packageJsonPath)) {
    result.hasPackageJson = true;
    try {
      const pkg = await fs.readJson(packageJsonPath);
      result.hasBuildScript = !!pkg.scripts?.build;
    } catch (e) {
      // Ignore read errors
    }
  }
  
  // Check if public folder exists with index.html
  if (await fs.pathExists(indexPath)) {
    result.isBuilt = true;
    result.publicDir = `client-websites/${slug}/public`;
    
    // Get last modified time
    try {
      const stats = await fs.stat(indexPath);
      result.lastModified = stats.mtime.toISOString();
    } catch (e) {
      // Ignore stat errors
    }
  }
  
  return result;
}
