import * as path from 'path';
import * as fs from 'fs-extra';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';

/**
 * Creates a simpleGit instance that is guaranteed to operate inside `folderPath`.
 *
 * Validates that `folderPath` contains its own `.git` (directory or file).  Without
 * this check, simpleGit silently walks up the directory tree and may find a parent
 * repository, causing operations (diff, status, etc.) to run in the wrong context
 * and potentially hit broken submodule references.
 */
export async function safeGit(folderPath: string): Promise<SimpleGit> {
  const gitPath = path.join(folderPath, '.git');
  if (!(await fs.pathExists(gitPath))) {
    throw new Error(
      `Not a git repository: ${folderPath} (no .git found). ` +
      'Refusing to fall through to a parent repository.'
    );
  }
  return simpleGit(folderPath);
}

/**
 * Ensures a development branch exists and checks it out.
 * If it doesn't exist, it creates it from the default branch.
 */
export async function ensureDevBranch(
  folderPath: string
): Promise<string> {
  const branchName = config.git.devBranch || 'main';
  logger.info(`Ensuring branch ${branchName} exists in ${folderPath}`);
  
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    // Check if branch exists
    const branches = await git.branchLocal();
    const exists = branches.all.includes(branchName);
    
    if (exists) {
      logger.info(`Branch ${branchName} already exists, checking it out`);
      await git.checkout(branchName);
      
      // Pull latest from origin if it exists on remote
      try {
        await git.pull('origin', branchName);
      } catch (pullError: any) {
        logger.warn(`Could not pull latest for ${branchName}: ${pullError.message}`);
      }
    } else {
      logger.info(`Branch ${branchName} does not exist, creating from ${config.git.defaultBranch}`);
      
      // Ensure we're on the default branch first and it's up to date
      await git.checkout(config.git.defaultBranch);
      await git.pull('origin', config.git.defaultBranch);
      
      // Create and checkout new branch
      await git.checkoutLocalBranch(branchName);
      logger.info(`Created and checked out branch: ${branchName}`);
    }
    
    return branchName;
  } catch (error: any) {
    logger.error(`Error ensuring branch ${branchName}: ${error.message}`);
    throw error;
  }
}

/**
 * Checks if a branch exists
 */
export async function branchExists(folderPath: string, branchName: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const branches = await git.branchLocal();
    return branches.all.includes(branchName);
  } catch (error: any) {
    logger.error(`Error checking branch existence: ${error.message}`);
    return false;
  }
}

/**
 * Pushes branch to GitHub remote
 */
export async function pushBranch(
  folderPath: string,
  branchName: string,
  force: boolean = false
): Promise<void> {
  logger.info(`Pushing branch ${branchName} to GitHub`);
  
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    if (force) {
      await git.push('origin', branchName, ['--force']);
    } else {
      await git.push('origin', branchName);
    }
    
    logger.info(`Successfully pushed branch ${branchName} to GitHub`);
  } catch (error: any) {
    logger.error(`Error pushing branch: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the current branch name
 */
export async function getCurrentBranch(folderPath: string): Promise<string> {
  const git: SimpleGit = await safeGit(folderPath);
  
  try {
    const status = await git.status();
    return status.current || config.git.defaultBranch;
  } catch (error: any) {
    logger.error(`Error getting current branch: ${error.message}`);
    throw error;
  }
}

/**
 * Gets git diff between two branches/commits.
 * If 'to' is not provided, it compares 'from' against the current working directory.
 */
export async function getDiff(
  folderPath: string,
  from: string,
  to?: string
): Promise<string> {
  const git: SimpleGit = await safeGit(folderPath);
  
  try {
    const args = to ? [from, to] : [from];
    const diff = await git.diff(args);
    return diff;
  } catch (error: any) {
    logger.error(`Error getting diff: ${error.message}`);
    throw error;
  }
}

/**
 * Gets git status
 */
export async function getStatus(folderPath: string): Promise<any> {
  const git: SimpleGit = await safeGit(folderPath);
  
  try {
    const status = await git.status();
    return status;
  } catch (error: any) {
    logger.error(`Error getting git status: ${error.message}`);
    throw error;
  }
}

// ============================================
// Rollback and Recovery Functions
// ============================================

/**
 * Commit information for rollback preview
 */
export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  timestamp: string;
  author: string;
}

/**
 * Rolls back to a specific commit, discarding uncommitted changes.
 * Uses --hard reset to ensure clean state.
 * 
 * @param folderPath - Path to the git repository
 * @param commitHash - The commit hash to rollback to
 * @param preserveUntracked - If true, untracked files are kept (default: false)
 */
export async function rollbackToCommit(
  folderPath: string,
  commitHash: string,
  preserveUntracked: boolean = false
): Promise<void> {
  logger.info(`Rolling back ${folderPath} to commit ${commitHash}`);
  
  // FIX: Handle 'initial' placeholder - cannot rollback to a non-existent commit
  if (!commitHash || commitHash === 'initial') {
    throw new Error(`Cannot rollback to '${commitHash}': no valid commit hash. The repository may not have had any commits at checkpoint time.`);
  }
  
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    // Verify the commit exists
    try {
      await git.catFile(['-t', commitHash]);
    } catch (err) {
      throw new Error(`Commit ${commitHash} does not exist or is unreachable`);
    }
    
    if (!preserveUntracked) {
      // Clean untracked files
      await git.clean('fd');
    }
    
    // Hard reset to the commit
    await git.reset(['--hard', commitHash]);
    
    logger.info(`Successfully rolled back to commit ${commitHash}`);
  } catch (error: any) {
    logger.error(`Error rolling back to commit ${commitHash}: ${error.message}`);
    throw error;
  }
}

/**
 * Creates a safety tag before rollback for manual recovery.
 * This allows recovery if something goes wrong during rollback.
 * 
 * @param folderPath - Path to the git repository
 * @param tagName - Name for the safety tag
 * @param message - Tag message describing what's being preserved
 * 
 * FIX: Added handling for repos with no commits
 */
export async function createSafetyTag(
  folderPath: string,
  tagName: string,
  message: string
): Promise<string> {
  logger.info(`Creating safety tag ${tagName} in ${folderPath}`);
  
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    // FIX: Check if there are any commits first
    // Cannot create tags in repos with no commits
    try {
      await git.revparse(['HEAD']);
    } catch (revErr: any) {
      const errMsg = revErr.message?.toLowerCase() || '';
      if (errMsg.includes('unknown revision') || errMsg.includes('ambiguous argument')) {
        logger.warn(`Cannot create safety tag in ${folderPath}: repository has no commits`);
        return 'initial'; // Return placeholder instead of throwing
      }
      throw revErr;
    }
    
    // Sanitize tag name - Git tag names have restrictions
    const sanitizedTagName = tagName.replace(/[^a-zA-Z0-9._/-]/g, '-');
    
    // Create an annotated tag at current HEAD
    await git.tag(['-a', sanitizedTagName, '-m', message, 'HEAD']);
    
    // Get the commit hash that was tagged
    const hash = (await git.revparse(['HEAD'])).trim();
    
    logger.info(`Created safety tag ${sanitizedTagName} at commit ${hash}`);
    
    return hash;
  } catch (error: any) {
    // If tag already exists, try with a timestamp suffix
    if (error.message?.includes('already exists')) {
      const sanitizedTagName = tagName.replace(/[^a-zA-Z0-9._/-]/g, '-');
      const timestampTag = `${sanitizedTagName}-${Date.now()}`;
      logger.warn(`Tag ${tagName} exists, creating ${timestampTag} instead`);
      
      await git.tag(['-a', timestampTag, '-m', message, 'HEAD']);
      const hash = (await git.revparse(['HEAD'])).trim();
      
      return hash;
    }
    
    logger.error(`Error creating safety tag: ${error.message}`);
    throw error;
  }
}

/**
 * Gets list of commits since a checkpoint.
 * Useful for showing user what will be lost on rollback.
 * 
 * @param folderPath - Path to the git repository
 * @param sinceCommit - The commit hash to start from (exclusive)
 * @param maxCommits - Maximum number of commits to return (default: 50)
 */
export async function getCommitsSince(
  folderPath: string,
  sinceCommit: string,
  maxCommits: number = 50
): Promise<CommitInfo[]> {
  logger.debug(`Getting commits since ${sinceCommit} in ${folderPath}`);
  
  // FIX: Handle 'initial' placeholder proactively before attempting git operations
  // This prevents unnecessary error handling and provides clearer behavior
  if (sinceCommit === 'initial') {
    logger.debug(`Commit placeholder 'initial' detected, returning empty commit list`);
    return [];
  }
  
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    // Get log from sinceCommit to HEAD
    const log = await git.log({
      from: sinceCommit,
      to: 'HEAD',
      maxCount: maxCommits
    });
    
    return log.all.map(commit => ({
      hash: commit.hash,
      shortHash: commit.hash.substring(0, 7),
      message: commit.message,
      timestamp: commit.date,
      author: commit.author_name
    }));
  } catch (error: any) {
    logger.error(`Error getting commits since ${sinceCommit}: ${error.message}`);
    
    // FIX: Handle multiple error patterns that indicate invalid/missing commits
    // Git can return different error messages depending on the scenario
    const errorMsg = error.message.toLowerCase();
    if (errorMsg.includes('unknown revision') || 
        errorMsg.includes('bad revision') ||
        errorMsg.includes('invalid object') ||
        errorMsg.includes('not a valid object name') ||
        errorMsg.includes('ambiguous argument')) {
      logger.debug(`Commit ${sinceCommit} not found or invalid, returning empty commit list`);
      return [];
    }
    
    throw error;
  }
}

/**
 * Gets the current HEAD commit hash.
 * 
 * FIX: Returns 'initial' placeholder if no commits exist yet (new repo)
 * This is consistent with checkpoint handling and prevents crashes on fresh repos.
 */
export async function getCurrentCommitHash(folderPath: string): Promise<string> {
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const hash = (await git.revparse(['HEAD'])).trim();
    return hash;
  } catch (error: any) {
    // FIX: Handle "no commits yet" case gracefully
    // Git throws "ambiguous argument 'HEAD': unknown revision" for repos with no commits
    const errorMsg = error.message?.toLowerCase() || '';
    if (errorMsg.includes('unknown revision') || 
        errorMsg.includes('bad revision') ||
        errorMsg.includes('ambiguous argument')) {
      logger.warn(`Repository at ${folderPath} has no commits yet, returning 'initial' placeholder`);
      return 'initial';
    }
    logger.error(`Error getting current commit hash: ${error.message}`);
    throw error;
  }
}

/**
 * Checks if there are uncommitted changes in the working directory.
 */
export async function hasUncommittedChanges(folderPath: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const status = await git.status();
    return !status.isClean();
  } catch (error: any) {
    logger.error(`Error checking uncommitted changes: ${error.message}`);
    throw error;
  }
}

/**
 * Stashes any uncommitted changes before a rollback operation.
 * Returns the stash message if something was stashed, null otherwise.
 */
export async function stashChanges(
  folderPath: string,
  message: string
): Promise<string | null> {
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const status = await git.status();
    
    if (status.isClean()) {
      return null;
    }
    
    await git.stash(['push', '-m', message, '--include-untracked']);
    logger.info(`Stashed changes: ${message}`);
    
    return message;
  } catch (error: any) {
    logger.error(`Error stashing changes: ${error.message}`);
    throw error;
  }
}

/**
 * Gets files that changed between two commits.
 * Useful for showing what will be affected by rollback.
 */
export async function getChangedFiles(
  folderPath: string,
  fromCommit: string,
  toCommit: string = 'HEAD'
): Promise<string[]> {
  const git: SimpleGit = simpleGit(folderPath);
  
  // FIX: Handle 'initial' placeholder to avoid git errors
  if (fromCommit === 'initial') {
    logger.debug(`Commit placeholder 'initial' detected in getChangedFiles, returning empty list`);
    return [];
  }
  
  try {
    const diff = await git.diffSummary([fromCommit, toCommit]);
    return diff.files.map(f => f.file);
  } catch (error: any) {
    // FIX: Log the error clearly but return empty to avoid breaking rollback preview
    // Include context about what failed so issues can be diagnosed
    logger.warn(`Could not get changed files from ${fromCommit} to ${toCommit}: ${error.message}. Rollback preview will show 0 files.`);
    return [];
  }
}















