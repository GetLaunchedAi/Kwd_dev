import { clickUpApiClient } from '../src/clickup/apiClient';
import { findClientFolder } from '../src/git/repoManager';
import { triggerAgent } from '../src/cursor/agentTrigger';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import * as path from 'path';

async function testAgentTriggeringWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Agent Trigger Audit with Task ${taskId} ---`);

  try {
    const task = await clickUpApiClient.getTask(taskId);
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    const clientFolder = folderInfo!.path;
    const taskFilePath = path.join(clientFolder, 'CURSOR_TASK.md');

    logger.info('Testing agent trigger (file method)...');
    config.cursor.agentTriggerMethod = 'file';
    await triggerAgent(clientFolder, taskFilePath, task);
    
    logger.info('SUCCESS: Agent triggered via file method.');

    logger.info('Testing agent trigger (cli method - speculative)...');
    config.cursor.agentTriggerMethod = 'cli';
    // This will attempt keyboard automation if on Windows
    await triggerAgent(clientFolder, taskFilePath, task);
    logger.info('SUCCESS: Agent trigger call completed.');

  } catch (error: any) {
    logger.error(`Error in Agent Trigger audit: ${error.message}`);
  }
}

testAgentTriggeringWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});


