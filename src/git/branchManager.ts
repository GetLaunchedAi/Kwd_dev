import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';

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
  const git: SimpleGit = simpleGit(folderPath);
  
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
  const git: SimpleGit = simpleGit(folderPath);
  
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
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const status = await git.status();
    return status;
  } catch (error: any) {
    logger.error(`Error getting git status: ${error.message}`);
    throw error;
  }
}















