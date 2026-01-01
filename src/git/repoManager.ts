import * as fs from 'fs-extra';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';

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

  // Special case: If there's a client-websites folder, also include its children
  const clientWebsitesDir = path.join(githubCloneAllDir, 'client-websites');
  if (fs.existsSync(clientWebsitesDir)) {
    const subEntries = await fs.readdir(clientWebsitesDir, { withFileTypes: true });
    const subFolders = subEntries
      .filter(entry => entry.isDirectory())
      .map(entry => ({
        name: entry.name,
        fullPath: path.join(clientWebsitesDir, entry.name)
      }));
    
    // Add subfolders to the search list
    searchFolders = [...searchFolders, ...subFolders];
  }

  // Strategy 1: Exact match (case-sensitive)
  let match = searchFolders.find(folder => folder.name === clientName);
  if (match) {
    logger.info(`Found exact match: ${match.name}`);
    return await validateGitRepo(match.fullPath);
  }

  // Strategy 2: Case-insensitive match
  match = searchFolders.find(folder => folder.name.toLowerCase() === clientName.toLowerCase());
  if (match) {
    logger.info(`Found case-insensitive match: ${match.name}`);
    return await validateGitRepo(match.fullPath);
  }

  // Strategy 3: Fuzzy match (contains or similar)
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
 * Pulls latest changes from the default branch
 */
export async function pullLatestChanges(folderPath: string): Promise<void> {
  logger.info(`Pulling latest changes from ${folderPath}`);

  const git: SimpleGit = simpleGit(folderPath);
  const defaultBranch = config.git.defaultBranch;

  try {
    const status = await git.status();
    if (status.files.length > 0) {
      logger.warn(`Uncommitted changes detected in ${folderPath}. Performing hard reset to origin/${defaultBranch}.`);
      await git.reset(['--hard', `origin/${defaultBranch}`]);
    }

    await git.checkout(defaultBranch);

    await git.pull('origin', defaultBranch);

    logger.info(`Successfully pulled latest changes from ${defaultBranch}`);
  } catch (error: any) {
    logger.error(`Error pulling latest changes: ${error.message}`);
    throw error;
  }
}

/**
 * Ensures working directory is clean (or warns if not)
 */
export async function ensureCleanWorkingDirectory(folderPath: string): Promise<boolean> {
  const git: SimpleGit = simpleGit(folderPath);
  
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
  const git: SimpleGit = simpleGit(clientFolder);
  
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
  const git: SimpleGit = simpleGit(clientFolder);
  
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
  const git: SimpleGit = simpleGit(clientFolder);
  
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
  const git: SimpleGit = simpleGit(clientFolder);
  
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
