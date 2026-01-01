import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { sanitizeBranchName } from '../utils/taskParser';

/**
 * Creates a feature branch for the task
 */
export async function createFeatureBranch(
  folderPath: string,
  taskId: string,
  taskName: string
): Promise<string> {
  logger.info(`Creating feature branch for task ${taskId}`);
  
  const git: SimpleGit = simpleGit(folderPath);
  const branchName = `clickup/${taskId}-${sanitizeBranchName(taskName)}`;
  
  try {
    // Ensure we're on the default branch first
    await git.checkout(config.git.defaultBranch);
    
    // Create and checkout new branch
    await git.checkoutLocalBranch(branchName);
    
    logger.info(`Created and checked out branch: ${branchName}`);
    return branchName;
  } catch (error: any) {
    logger.error(`Error creating branch: ${error.message}`);
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
 * Gets git diff between two branches/commits
 */
export async function getDiff(
  folderPath: string,
  from: string,
  to: string = 'HEAD'
): Promise<string> {
  const git: SimpleGit = simpleGit(folderPath);
  
  try {
    const diff = await git.diff([from, to]);
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















