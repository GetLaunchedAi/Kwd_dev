import { clickUpApiClient } from '../src/clickup/apiClient';
import { findClientFolder } from '../src/git/repoManager';
import { ensureDevBranch, branchExists } from '../src/git/branchManager';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import * as path from 'path';

async function testTrackBWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Track B Audit with Task ${taskId} ---`);

  try {
    // 1. Fetch task
    const task = await clickUpApiClient.getTask(taskId);
    logger.info(`Fetched task: ${task.name}`);

    // 2. Find client folder (should be jacks-roofing-llc)
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    if (!folderInfo || !folderInfo.isValid) {
      throw new Error(`Client folder not found for ${clientName}`);
    }
    const clientFolder = folderInfo.path;
    logger.info(`Target folder: ${clientFolder}`);

    // 3. Test branch creation
    logger.info('Testing dev branch ensure...');
    const branchName = await ensureDevBranch(clientFolder);
    logger.info(`Ensured branch: ${branchName}`);

    const exists = await branchExists(clientFolder, branchName);
    if (exists) {
      logger.info('SUCCESS: Feature branch created and exists.');
    } else {
      logger.error('FAILURE: Feature branch not found.');
    }

    // 4. Test branch name
    const expectedBranch = config.git.devBranch || 'main';
    if (branchName === expectedBranch) {
      logger.info(`SUCCESS: Branch name is correct: ${branchName}`);
    } else {
      logger.error(`FAILURE: Branch name is incorrect: ${branchName} (expected ${expectedBranch})`);
    }

  } catch (error: any) {
    logger.error(`Error in Track B audit: ${error.message}`);
  }
}

testTrackBWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});

