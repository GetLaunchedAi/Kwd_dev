import { runTests } from '../src/testing/testRunner';
import { findClientFolder } from '../src/git/repoManager';
import { logger } from '../src/utils/logger';

async function testRunnerWithRealTask() {
  const taskId = '86b7yt9z5';
  logger.info(`--- Starting Test Runner Audit with Task ${taskId} ---`);

  try {
    const clientName = 'jacks-roofing-llc';
    const folderInfo = await findClientFolder(clientName);
    const clientFolder = folderInfo!.path;

    logger.info('Running tests in jacks-roofing-llc...');
    const result = await runTests(clientFolder);
    
    logger.info(`Test success: ${result.success}`);
    logger.info(`Test output preview: ${result.output.substring(0, 500)}...`);
    
    logger.info('SUCCESS: Test runner audit finished.');

  } catch (error: any) {
    logger.error(`Error in Test Runner audit: ${error.message}`);
  }
}

testRunnerWithRealTask().catch(err => {
  console.error(err);
  process.exit(1);
});


