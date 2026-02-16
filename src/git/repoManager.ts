import * as fs from 'fs-extra';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { safeGit } from './branchManager';

export interface ClientFolderInfo {
  path: string;
  name: string;
  isValid: boolean;
}

export interface GitBaselineState {
  commitHash: string | null;
  branchName: string;
  timestamp: string;
}

interface SearchFolder {
  name: string;
  fullPath: string;
}

/**
 * Checks if Git user.name and user.email are configured globally
 */
export async function isGitConfigured(): Promise<boolean> {
  const git: SimpleGit = simpleGit();
  try {
    const gitConfig = await git.listConfig();
    return !!(gitConfig.all['user.name'] && gitConfig.all['user.email']);
  } catch (error: any) {
    logger.error(`Git config check failed: ${error.message}`);
    return false;
  }
}

/**
 * Gets the configured git user from settings, with fallback defaults
 */
export function getGitUserConfig(): { name: string; email: string } {
  return {
    name: config.git.userName || 'KWD Dev Bot',
    email: config.git.userEmail || 'bot@kwd.dev'
  };
}

/**
 * Applies git user config to a repository (local scope)
 */
export async function applyGitUserConfig(folderPath: string): Promise<void> {
  const git: SimpleGit = simpleGit(folderPath);
  const { name, email } = getGitUserConfig();
  
  try {
    await git.addConfig('user.name', name, false, 'local');
    await git.addConfig('user.email', email, false, 'local');
    logger.info(`Applied git user config: ${name} <${email}> to ${folderPath}`);
  } catch (error: any) {
    logger.error(`Failed to apply git user config: ${error.message}`);
    throw error;
  }
}

/**
 * Checks if Git is installed and working by running git --version
 */
export async function checkGitInstallation(): Promise<{ installed: boolean; version?: string; error?: string }> {
  const git: SimpleGit = simpleGit();
  try {
    const version = await git.version();
    return {
      installed: true,
      version: version.major + '.' + version.minor + '.' + version.patch
    };
  } catch (error: any) {
    logger.error(`Git installation check failed: ${error.message}`);
    return {
      installed: false,
      error: error.message
    };
  }
}

/**
 * Checks git status in a specific directory (defaults to current project root)
 */
export async function checkGitStatus(folderPath: string = process.cwd()): Promise<{ success: boolean; status?: string; error?: string }> {
  const git: SimpleGit = simpleGit(folderPath);
  try {
    // Check if it's a git repo first
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      return {
        success: false,
        error: `Directory ${folderPath} is not a Git repository`
      };
    }
    const status = await git.status();
    return {
      success: true,
      status: JSON.stringify(status, null, 2)
    };
  } catch (error: any) {
    logger.error(`Git status check failed for ${folderPath}: ${error.message}`);
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Finds a client folder by name using multiple matching strategies
 */
export async function findClientFolder(clientName: string): Promise<ClientFolderInfo | null> {
  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
  
  if (!fs.existsSync(githubCloneAllDir)) {
    logger.error(`Github clone all directory does not exist: ${githubCloneAllDir}`);
    throw new Error(`Github clone all directory not found: ${githubCloneAllDir}`);
  }

  logger.info(`Searching for client folder: ${clientName} in ${githubCloneAllDir}`);

  // Get all folders in the directory
  let entries = await fs.readdir(githubCloneAllDir, { withFileTypes: true });
  let searchFolders: SearchFolder[] = entries
    .filter(entry => entry.isDirectory())
    .map(entry => ({
      name: entry.name,
      fullPath: path.join(githubCloneAllDir, entry.name)
    }));

  // Strategy 1: Exact match (case-sensitive)
  let match = searchFolders.find(folder => folder.name === clientName);
  if (match && fs.existsSync(path.join(match.fullPath, '.git'))) {
    logger.info(`Found exact match: ${match.name}`);
    return await validateGitRepo(match.fullPath);
  }

  // Strategy 2: Hyphenated match (Jacks Roofing -> jacks-roofing)
  const hyphenatedClientName = clientName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  match = searchFolders.find(folder => folder.name.toLowerCase() === hyphenatedClientName);
  if (match) {
    logger.info(`Found hyphenated match: ${match.name}`);
    return await validateGitRepo(match.fullPath);
  }

  // Strategy 3: Look inside a nested client-websites folder (only if not already in one)
  const isAlreadyInClientWebsites = githubCloneAllDir.endsWith('client-websites') || 
                                   githubCloneAllDir.endsWith('client-websites' + path.sep);
  
  if (!isAlreadyInClientWebsites) {
    const clientWebsitesDir = path.join(githubCloneAllDir, 'client-websites');
    if (fs.existsSync(clientWebsitesDir)) {
      const subEntries = await fs.readdir(clientWebsitesDir, { withFileTypes: true });
      const subFolders = subEntries
        .filter(entry => entry.isDirectory())
        .map(entry => ({
          name: entry.name,
          fullPath: path.join(clientWebsitesDir, entry.name)
        }));
      
      match = subFolders.find(folder => folder.name === clientName || folder.name.toLowerCase() === hyphenatedClientName);
      if (match) {
          logger.info(`Found match in nested client-websites: ${match.name}`);
          return await validateGitRepo(match.fullPath);
      }
    }
  }

  // Strategy 4: Fuzzy match (contains or similar)
  const fuzzyMatches = searchFolders.filter(folder => 
    folder.name.toLowerCase().includes(clientName.toLowerCase()) ||
    clientName.toLowerCase().includes(folder.name.toLowerCase())
  );

  if (fuzzyMatches.length === 1) {
    logger.info(`Found fuzzy match: ${fuzzyMatches[0].name}`);
    return await validateGitRepo(fuzzyMatches[0].fullPath);
  } else if (fuzzyMatches.length > 1) {
    logger.warn(`Multiple fuzzy matches found for ${clientName}: ${fuzzyMatches.map(f => f.name).join(', ')}`);
    // Return the first match
    return await validateGitRepo(fuzzyMatches[0].fullPath);
  }

  logger.error(`No matching folder found for client: ${clientName}`);
  return null;
}

/**
 * Validates that a folder is a valid Git repository
 */
async function validateGitRepo(folderPath: string): Promise<ClientFolderInfo | null> {
  const gitPath = path.join(folderPath, '.git');
  
  if (!fs.existsSync(gitPath)) {
    logger.warn(`Folder is not a Git repository: ${folderPath}`);
    return {
      path: folderPath,
      name: path.basename(folderPath),
      isValid: false,
    };
  }

  return {
    path: folderPath,
    name: path.basename(folderPath),
    isValid: true,
  };
}

/**
 * Pulls latest changes from the default branch.
 * Safety: If uncommitted changes exist, it will NOT perform a hard reset unless explicitely told to,
 * or if we are sure no other agent is working on this repository.
 */
export async function pullLatestChanges(folderPath: string, forceReset: boolean = false): Promise<void> {
  logger.info(`Pulling latest changes from ${folderPath} (forceReset: ${forceReset})`);

  const git: SimpleGit = simpleGit(folderPath);
  const defaultBranch = config.git.defaultBranch;

  try {
    const status = await git.status();
    if (status.files.length > 0) {
      if (forceReset) {
        logger.warn(`Uncommitted changes detected in ${folderPath}. Performing hard reset to origin/${defaultBranch} as requested.`);
        await git.reset(['--hard', `origin/${defaultBranch}`]);
      } else {
        // If not forcing reset, we check if we can just pull (if it's clean) or if we should skip
        logger.info(`Uncommitted changes detected in ${folderPath}. Skipping hard reset to preserve potential work.`);
        // We still try to checkout and pull, which might fail if there are conflicts, 
        // but that's better than wiping out work.
      }
    }

    await git.checkout(defaultBranch);
    await git.pull('origin', defaultBranch);

    logger.info(`Successfully pulled latest changes from ${defaultBranch}`);
  } catch (error: any) {
    logger.error(`Error pulling latest changes: ${error.message}`);
    // If it's a conflict error and we didn't force reset, explain why
    if (error.message.includes('overwritten by merge') && !forceReset) {
      logger.warn(`Pull failed due to local changes in ${folderPath}. This is expected if an agent is active.`);
      return; // Silently continue - we'll work with what we have
    }
    throw error;
  }
}

/**
 * Ensures working directory is clean (or warns if not)
 */
export async function ensureCleanWorkingDirectory(folderPath: string): Promise<boolean> {
  const git: SimpleGit = await safeGit(folderPath);
  
  try {
    const status = await git.status();
    return status.isClean();
  } catch (error: any) {
    logger.error(`Error checking git status: ${error.message}`);
    throw error;
  }
}

/**
 * Gets the current HEAD commit hash
 */
export async function getCurrentCommitHash(clientFolder: string): Promise<string | null> {
  const git: SimpleGit = await safeGit(clientFolder);
  
  try {
    const log = await git.log(['-1']);
    if (log.latest) {
      return log.latest.hash;
    }
    return null;
  } catch (error: any) {
    logger.error(`Error getting current commit hash: ${error.message}`);
    return null;
  }
}

/**
 * Gets the commit count on a specific branch
 */
export async function getCommitCount(clientFolder: string, branchName: string): Promise<number> {
  const git: SimpleGit = await safeGit(clientFolder);
  
  try {
    const log = await git.log([branchName]);
    return log.total;
  } catch (error: any) {
    logger.error(`Error getting commit count for branch ${branchName}: ${error.message}`);
    return 0;
  }
}

/**
 * Checks if there are uncommitted changes in the working directory
 */
export async function hasUncommittedChanges(clientFolder: string): Promise<boolean> {
  const git: SimpleGit = await safeGit(clientFolder);
  
  try {
    const status = await git.status();
    return !status.isClean();
  }
  catch (error: any) {
    logger.error(`Error checking for uncommitted changes: ${error.message}`);
    return false;
  }
}

/**
 * Captures the baseline git state (commit hash and branch) for comparison
 */
export async function getBaselineState(clientFolder: string, branchName: string): Promise<GitBaselineState> {
  const git: SimpleGit = await safeGit(clientFolder);
  
  try {
    const commitHash = await getCurrentCommitHash(clientFolder);
    const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
    
    return {
      commitHash,
      branchName: currentBranch || branchName,
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    logger.error(`Error getting baseline state: ${error.message}`);
    // Return a baseline state even if there's an error
    return {
      commitHash: null,
      branchName: branchName,
      timestamp: new Date().toISOString(),
    };
  }
}
