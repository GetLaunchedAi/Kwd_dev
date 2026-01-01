import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { pullLatestChanges, ensureCleanWorkingDirectory } from '../git/repoManager';
import { generatePromptFile } from './promptGenerator';
import { ClickUpTask } from '../clickup/apiClient';

const execAsync = promisify(exec);

/**
 * Opens Cursor workspace with the specified folder
 */
export async function openCursorWorkspace(folderPath: string): Promise<void> {
  logger.info(`Opening Cursor workspace: ${folderPath}`);
  
  try {
    const cliPath = config.cursor.cliPath || 'cursor';
    const command = `"${cliPath}" "${folderPath}"`;
    
    await execAsync(command);
    logger.info(`Successfully opened Cursor workspace`);
  } catch (error: any) {
    logger.error(`Error opening Cursor workspace: ${error.message}`);
    // Don't throw - Cursor might already be open or CLI might not be available
    logger.warn('Continuing despite Cursor open error - workspace may already be open');
  }
}

/**
 * Prepares workspace: pulls latest, ensures clean state, creates prompt file
 */
export async function prepareWorkspace(
  clientFolder: string,
  task: ClickUpTask,
  branchName: string,
  testCommand?: string
): Promise<string> {
  logger.info(`Preparing workspace: ${clientFolder}`);
  
  // Pull latest changes
  await pullLatestChanges(clientFolder);
  
  // Check if working directory is clean
  const isClean = await ensureCleanWorkingDirectory(clientFolder);
  if (!isClean) {
    logger.warn(`Working directory is not clean in ${clientFolder}`);
  }
  
  // Generate prompt file
  const promptPath = await generatePromptFile(clientFolder, task, branchName, testCommand);
  
  return promptPath;
}

/**
 * Triggers Cursor agent to process the task
 * Note: Actual implementation depends on Cursor's API capabilities
 */
export async function triggerCursorAgent(
  clientFolder: string,
  task: ClickUpTask
): Promise<void> {
  logger.info(`Triggering Cursor agent for task: ${task.id}`);
  
  // The CURSOR_TASK.md file should already be created
  // The actual triggering mechanism depends on Cursor's capabilities
  
  // Option 1: If Cursor has a CLI flag for agent mode
  if (config.cursor.agentMode) {
    try {
      const cliPath = config.cursor.cliPath || 'cursor';
      // This is speculative - actual implementation depends on Cursor's CLI
      const command = `"${cliPath}" --agent "${clientFolder}"`;
      await execAsync(command);
      logger.info('Triggered Cursor agent via CLI');
    } catch (error: any) {
      logger.warn(`Could not trigger agent via CLI: ${error.message}`);
      logger.info('Agent should process CURSOR_TASK.md automatically if Background Agents are enabled');
    }
  }
  
  // Option 2: Background Agents will pick up the file automatically
  // Option 3: Manual trigger - file is created and user/agent sees it when workspace opens
}















