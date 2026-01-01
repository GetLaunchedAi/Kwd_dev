import { clickUpApiClient } from '../src/clickup/apiClient';
import { findClientFolder } from '../src/git/repoManager';
import { prepareWorkspace } from '../src/cursor/workspaceManager';
import { logger } from '../src/utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';

async function testWorkspacePreparationWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Workspace Preparation Audit with Task ${taskId} ---`);

  try {
    // 1. Fetch task
    const task = await clickUpApiClient.getTask(taskId);
    
    // 2. Find client folder
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    const clientFolder = folderInfo!.path;

    // 3. Prepare workspace
    const branchName = `clickup/${taskId}-something`;
    const testCommand = 'npm test';
    
    logger.info('Running prepareWorkspace...');
    const promptPath = await prepareWorkspace(clientFolder, task, branchName, testCommand);
    
    logger.info(`Prompt file created at: ${promptPath}`);
    
    if (await fs.pathExists(promptPath)) {
      logger.info('SUCCESS: CURSOR_TASK.md created.');
      const content = await fs.readFile(promptPath, 'utf-8');
      logger.info('CURSOR_TASK.md content preview:\n' + content.substring(0, 500) + '...');
    } else {
      logger.error('FAILURE: CURSOR_TASK.md not found.');
    }

  } catch (error: any) {
    logger.error(`Error in Workspace Preparation audit: ${error.message}`);
  }
}

testWorkspacePreparationWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});


