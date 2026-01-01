import { startCompletionDetection, cancelCompletionDetection } from '../src/cursor/agentCompletionDetector';
import { findClientFolder } from '../src/git/repoManager';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import * as fs from 'fs-extra';
import * as path from 'path';

async function testCompletionDetectionWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Completion Detection Audit with Task ${taskId} ---`);

  try {
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    const clientFolder = folderInfo!.path;
    const branchName = `clickup/${taskId}-something`;

    config.cursor.agentCompletionDetection = {
      enabled: true,
      pollInterval: 1000,
      maxWaitTime: 5000,
      stabilityPeriod: 2000,
      checkGitCommits: true,
      checkTaskFileDeletion: true,
      completionMarkerFile: '.cursor-task-complete'
    };

    logger.info('Starting detection...');
    await startCompletionDetection(clientFolder, taskId, branchName);
    
    logger.info('Simulating completion by creating marker file...');
    await fs.writeFile(path.join(clientFolder, '.cursor-task-complete'), 'Done');
    
    logger.info('Waiting for detection (should fail because continueWorkflowAfterAgent will fail without full state, but detection itself should trigger)...');
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Cleanup
    await fs.remove(path.join(clientFolder, '.cursor-task-complete'));
    cancelCompletionDetection(taskId);
    
    logger.info('SUCCESS: Completion detection audit finished.');

  } catch (error: any) {
    logger.error(`Error in Completion Detection audit: ${error.message}`);
  }
}

testCompletionDetectionWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});


