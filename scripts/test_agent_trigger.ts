import { triggerAgent } from '../src/cursor/agentTrigger';
import { ClickUpTask } from '../src/clickup/apiClient';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import * as fs from 'fs-extra';
import * as path from 'path';

async function testAgentTriggering() {
  const testDir = path.join(process.cwd(), 'test-data', 'test-client');
  await fs.ensureDir(testDir);
  
  const mockTask: ClickUpTask = {
    id: '86b7yt9z5',
    name: 'Test Task for Agent',
    description: 'This is a test task for agent triggering audit.',
    status: { status: 'Ready to Code', color: '#000000', type: 'open' },
    url: 'https://app.clickup.com/t/86b7yt9z5',
    assignees: [],
    folder: { id: 'folder-id', name: 'Folder Name' }
  };

  const taskFilePath = path.join(testDir, 'CURSOR_TASK.md');
  await fs.writeFile(taskFilePath, '# Test Task\n\nImplement a hello world function.');

  logger.info('--- Testing Agent Trigger (file method) ---');
  // Set config directly
  config.cursor.agentTriggerMethod = 'file';
  
  try {
    await triggerAgent(testDir, taskFilePath, mockTask);
    
    const cursorRulesPath = path.join(testDir, '.cursorrules');
    if (await fs.pathExists(cursorRulesPath)) {
      logger.info('SUCCESS: .cursorrules file created.');
      const content = await fs.readFile(cursorRulesPath, 'utf-8');
      logger.info('.cursorrules content:\n' + content);
    } else {
      logger.error('FAILURE: .cursorrules file NOT created.');
    }
  } catch (error: any) {
    logger.error('Error during triggerAgent:', error);
  }

  logger.info('--- Testing Agent Trigger (cli method - speculative) ---');
  // Set config directly
  config.cursor.agentTriggerMethod = 'cli';
  try {
    await triggerAgent(testDir, taskFilePath, mockTask);
    logger.info('Note: CLI trigger completed (check if Cursor Composer opened if on Windows UI)');
  } catch (error: any) {
    logger.info('Note: CLI trigger failed (expected in headless/non-win32 if not on Windows): ' + error.message);
  }
}

testAgentTriggering().catch(err => {
  console.error(err);
  process.exit(1);
});

