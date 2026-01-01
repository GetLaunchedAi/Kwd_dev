import * as fs from 'fs-extra';
import * as path from 'path';
import { detectTestFramework, runTests } from '../src/testing/testRunner';
import { logger } from '../src/utils/logger';

async function testRunnerVerification() {
  const testDir = path.join(process.cwd(), 'test-data', 'test-runner-test');
  await fs.ensureDir(testDir);

  // 1. Test Node.js Detection
  logger.info('--- Testing Node.js Test Detection ---');
  await fs.writeJson(path.join(testDir, 'package.json'), {
    scripts: {
      test: 'echo "Running tests..." && exit 0'
    }
  });
  
  const command = await detectTestFramework(testDir);
  logger.info(`Detected command: ${command}`);
  if (command === 'npm test') {
    logger.info('SUCCESS: npm test detected.');
  } else {
    logger.error(`FAILURE: Expected npm test, got ${command}`);
  }

  // 2. Test Execution
  logger.info('--- Testing Test Execution ---');
  const result = await runTests(testDir);
  logger.info(`Test Result Success: ${result.success}`);
  logger.info(`Test Result Output: ${result.output}`);
  
  if (result.success && result.output.includes('Running tests...')) {
    logger.info('SUCCESS: Test executed and output captured.');
  } else {
    logger.error('FAILURE: Test execution or output capture failed.');
  }

  // 3. Test Failure Execution
  logger.info('--- Testing Failed Test Execution ---');
  await fs.writeJson(path.join(testDir, 'package.json'), {
    scripts: {
      test: 'echo "Failing tests..." && exit 1'
    }
  });
  
  const failResult = await runTests(testDir);
  logger.info(`Test Result Success: ${failResult.success}`);
  logger.info(`Test Result Exit Code: ${failResult.exitCode}`);
  
  if (!failResult.success && failResult.exitCode === 1) {
    logger.info('SUCCESS: Failed test handled correctly.');
  } else {
    logger.error('FAILURE: Failed test handling failed.');
  }

  logger.info('Test completed.');
  process.exit(0);
}

testRunnerVerification().catch(err => {
  console.error(err);
  process.exit(1);
});


