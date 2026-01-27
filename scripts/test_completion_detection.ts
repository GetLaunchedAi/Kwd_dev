import * as fs from 'fs-extra';
import * as path from 'path';
import { startCompletionDetection, cancelCompletionDetection } from '../src/cursor/agentCompletionDetector';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import simpleGit from 'simple-git';

async function testCompletionDetection() {
  const testDir = path.join(process.cwd(), 'test-data', 'completion-test');
  await fs.ensureDir(testDir);
  const git = simpleGit(testDir);

  logger.info('--- Setting up test git repo ---');
  await git.init();
  await fs.writeFile(path.join(testDir, 'README.md'), '# Test Repo');
  await git.add('.');
  await git.commit('Initial commit');
  const targetBranch = config.git.defaultBranch || 'main';
  await git.branch(['-M', targetBranch]);

  const taskId = 'test-task-123';
  const branchName = targetBranch;

  // Configure detection
  config.cursor.agentCompletionDetection = {
    enabled: true,
    pollInterval: 1000, // 1 second for testing
    maxWaitTime: 10000, // 10 seconds
    stabilityPeriod: 2000, // 2 seconds
    checkGitCommits: true,
    checkTaskFileDeletion: true,
    completionMarkerFile: '.cursor-task-complete'
  };

  // 1. Test Task File Deletion Detection
  logger.info('--- Testing Completion via Task File Deletion ---');
  const taskFile = path.join(testDir, 'CURSOR_TASK.md');
  await fs.writeFile(taskFile, 'Do something');
  
  await startCompletionDetection(testDir, taskId, branchName);
  
  logger.info('Waiting 2 seconds, then deleting task file...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await fs.remove(taskFile);
  
  logger.info('Task file deleted. Waiting for detection (should happen within 1-2s)...');
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  // 2. Test Completion Marker Detection
  logger.info('--- Testing Completion via Marker File ---');
  const taskId2 = 'test-task-marker';
  await fs.writeFile(taskFile, 'Do something else');
  await startCompletionDetection(testDir, taskId2, branchName);
  
  logger.info('Waiting 2 seconds, then creating marker file...');
  await new Promise(resolve => setTimeout(resolve, 2000));
  await fs.writeFile(path.join(testDir, '.cursor-task-complete'), 'Done');
  
  logger.info('Marker file created. Waiting for detection...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  // Clean up
  cancelCompletionDetection(taskId);
  cancelCompletionDetection(taskId2);
  logger.info('Test completed.');
  process.exit(0);
}

testCompletionDetection().catch(err => {
  console.error(err);
  process.exit(1);
});


