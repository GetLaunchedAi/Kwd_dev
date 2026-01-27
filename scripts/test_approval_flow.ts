import * as fs from 'fs-extra';
import * as path from 'path';
import { generateChangeSummary } from '../src/approval/changeSummarizer';
import { createApprovalRequest, approveRequest, rejectRequest, getApprovalRequest } from '../src/approval/approvalManager';
import { logger } from '../src/utils/logger';
import { config } from '../src/config/config';
import simpleGit from 'simple-git';

async function testApprovalFlow() {
  const testDir = path.join(process.cwd(), 'test-data', 'approval-test');
  await fs.ensureDir(testDir);
  const git = simpleGit(testDir);

  logger.info('--- Setting up test git repo ---');
  await git.init();
  await fs.writeFile(path.join(testDir, 'README.md'), '# Test Repo');
  await git.add('.');
  await git.commit('Initial commit');
  const targetBranch = config.git.defaultBranch || 'main';
  await git.branch(['-M', targetBranch]);

  // Create a change
  await git.checkoutLocalBranch('feature/test-task');
  await fs.writeFile(path.join(testDir, 'new-file.ts'), 'console.log("hello");');
  await fs.appendFile(path.join(testDir, 'README.md'), '\nAdded new feature.');
  await git.add('.');
  await git.commit('Add new feature');

  // 1. Test Change Summary Generation
  logger.info('--- Testing Change Summary Generation ---');
  const summary = await generateChangeSummary(testDir, 'feature/test-task');
  logger.info(`Files modified: ${summary.filesModified}`);
  logger.info(`Files added: ${summary.filesAdded}`);
  logger.info(`Lines added: ${summary.linesAdded}`);
  
  if (summary.filesModified >= 1 && summary.filesAdded === 1) {
    logger.info('SUCCESS: Change summary generated correctly.');
  } else {
    logger.error('FAILURE: Change summary generation failed.');
  }

  // 2. Test Approval Request Creation
  logger.info('--- Testing Approval Request Creation ---');
  const mockTestResult = {
    success: true,
    exitCode: 0,
    output: 'Tests passed',
    testCommand: 'npm test',
    duration: 1000
  };

  const request = await createApprovalRequest(
    'task-123',
    testDir,
    'feature/test-task',
    summary,
    mockTestResult,
    'test@example.com'
  );

  logger.info(`Approval token created: ${request.token.substring(0, 8)}...`);
  if (request.token) {
    logger.info('SUCCESS: Approval request created.');
  } else {
    logger.error('FAILURE: Approval request creation failed.');
  }

  // 3. Test Approval
  logger.info('--- Testing Approval ---');
  const approved = await approveRequest(request.token, 'Looks good!');
  if (approved) {
    logger.info('SUCCESS: Approval processed.');
  } else {
    logger.error('FAILURE: Approval processing failed.');
  }

  // 4. Test Rejection
  logger.info('--- Testing Rejection ---');
  const request2 = await createApprovalRequest(
    'task-456',
    testDir,
    'feature/test-task',
    summary,
    mockTestResult,
    'test@example.com'
  );
  const rejected = await rejectRequest(request2.token, 'Needs more work.');
  if (rejected) {
    logger.info('SUCCESS: Rejection processed.');
  } else {
    logger.error('FAILURE: Rejection processing failed.');
  }

  logger.info('Test completed.');
  process.exit(0);
}

testApprovalFlow().catch(err => {
  console.error(err);
  process.exit(1);
});


