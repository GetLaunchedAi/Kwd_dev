import { generateChangeSummary } from '../src/approval/changeSummarizer';
import { createApprovalRequest } from '../src/approval/approvalManager';
import { findClientFolder } from '../src/git/repoManager';
import { logger } from '../src/utils/logger';

async function testApprovalFlowWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Approval Flow Audit with Task ${taskId} ---`);

  try {
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    const clientFolder = folderInfo!.path;
    const branchName = `clickup/${taskId}-something`;

    // 1. Generate summary
    logger.info('Generating change summary...');
    // Note: This might be empty if no changes were actually made by the agent yet
    const summary = await generateChangeSummary(clientFolder, branchName);
    logger.info(`Summary generated. Files modified: ${summary.filesModified}`);

    // 2. Create approval request
    logger.info('Creating approval request...');
    const mockTestResult = {
      success: true,
      exitCode: 0,
      output: 'No tests to run',
      testCommand: 'none',
      duration: 0
    };

    const request = await createApprovalRequest(
      taskId,
      clientFolder,
      branchName,
      summary,
      mockTestResult,
      'test@example.com'
    );

    logger.info(`SUCCESS: Approval request created with token: ${request.token.substring(0, 8)}...`);

  } catch (error: any) {
    logger.error(`Error in Approval Flow audit: ${error.message}`);
  }
}

testApprovalFlowWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});


