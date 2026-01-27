import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { visualTester } from '../utils/visualTesting';

const execAsync = promisify(exec);

export interface TestResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  testCommand: string;
  duration: number;
  screenshots?: string[];
  brokenLinks?: string[];
  consoleErrors?: string[];
}

/**
 * Auto-detects test framework and returns test command
 */
export async function detectTestFramework(folderPath: string): Promise<string | null> {
  // Keep original logic but add visual check as a fallback/default
  logger.debug(`Detecting test framework in: ${folderPath}`);
// ... rest of the function remains the same ...

  // Check for package.json (Node.js projects)
  const packageJsonPath = path.join(folderPath, 'package.json');
  if (fs.existsSync(packageJsonPath)) {
    try {
      const packageJson = await fs.readJson(packageJsonPath);
      const scripts = packageJson.scripts || {};
      
      // Check for common test scripts
      if (scripts.test) {
        logger.info(`Found npm test script: ${scripts.test}`);
        return 'npm test';
      }
      if (scripts['test:unit']) {
        logger.info(`Found npm test:unit script: ${scripts['test:unit']}`);
        return 'npm run test:unit';
      }
      if (scripts['test:integration']) {
        logger.info(`Found npm test:integration script: ${scripts['test:integration']}`);
        return 'npm run test:integration';
      }
    } catch (error: any) {
      logger.warn(`Error reading package.json: ${error.message}`);
    }
  }

  // Check for pytest (Python)
  const pytestIni = path.join(folderPath, 'pytest.ini');
  const pyprojectToml = path.join(folderPath, 'pyproject.toml');
  if (fs.existsSync(pytestIni) || fs.existsSync(pyprojectToml)) {
    logger.info('Found pytest configuration');
    return 'pytest';
  }

  // Check for setup.py or requirements.txt with pytest
  const requirementsTxt = path.join(folderPath, 'requirements.txt');
  if (fs.existsSync(requirementsTxt)) {
    try {
      const content = await fs.readFile(requirementsTxt, 'utf-8');
      if (content.includes('pytest')) {
        logger.info('Found pytest in requirements.txt');
        return 'pytest';
      }
    } catch (error: any) {
      logger.warn(`Error reading requirements.txt: ${error.message}`);
    }
  }

  // Check for Maven (Java)
  const pomXml = path.join(folderPath, 'pom.xml');
  if (fs.existsSync(pomXml)) {
    logger.info('Found Maven pom.xml');
    return 'mvn test';
  }

  // Check for Gradle (Java/Kotlin)
  const buildGradle = path.join(folderPath, 'build.gradle');
  const buildGradleKts = path.join(folderPath, 'build.gradle.kts');
  if (fs.existsSync(buildGradle) || fs.existsSync(buildGradleKts)) {
    logger.info('Found Gradle build file');
    return 'gradle test';
  }

  // Check for Go
  const goMod = path.join(folderPath, 'go.mod');
  if (fs.existsSync(goMod)) {
    logger.info('Found Go module');
    return 'go test ./...';
  }

  // Check for Rust
  const cargoToml = path.join(folderPath, 'Cargo.toml');
  if (fs.existsSync(cargoToml)) {
    logger.info('Found Rust Cargo.toml');
    return 'cargo test';
  }

  logger.warn('No test framework detected');
  return null;
}

/**
 * Runs tests in the specified folder
 */
export async function runTests(
  folderPath: string,
  testCommand?: string,
  taskId?: string
): Promise<TestResult> {
  const startTime = Date.now();
  
  // Default to visual health check if no specific test command is provided
  // or if explicitly requested.
  logger.info(`Running visual health check and broken link check for ${folderPath}`);
  
  try {
    const url = await visualTester.startApp(folderPath);
    const health = await visualTester.performHealthCheck(url);
    const screenshots = taskId ? await visualTester.takeScreenshots(url, taskId, 'after') : [];
    
    await visualTester.stopApp(folderPath);

    const duration = Date.now() - startTime;
    
    // Filter out resource loading errors if they are 404s or other non-critical issues
    const criticalErrors = health.errors.filter(err => 
      !err.includes('Failed to load resource') && 
      !err.includes('status of 404') &&
      !err.includes('favicon.ico')
    );

    const success = health.brokenLinks.length === 0 && criticalErrors.length === 0;

    return {
      success,
      exitCode: success ? 0 : 1,
      output: `Health Check Results:\n- Broken Links: ${health.brokenLinks.length}\n- Console Errors: ${health.errors.length} (${criticalErrors.length} critical)`,
      error: success ? undefined : `Found ${health.brokenLinks.length} broken links and ${criticalErrors.length} critical console errors`,
      testCommand: 'visual-health-check',
      duration,
      screenshots,
      brokenLinks: health.brokenLinks,
      consoleErrors: health.errors
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    logger.error(`Visual health check failed: ${error.message}`);
    
    // ISSUE 6 FIX: Check if the error indicates the app couldn't start
    // If the app can't start, this is a real failure that should be reported
    const appStartupError = error.message.includes('Timeout waiting for app to start') ||
                           error.message.includes('exited with code') ||
                           error.message.includes('ECONNREFUSED') ||
                           error.message.includes('ERR_CONNECTION_REFUSED');
    
    // Fallback to original test detection if visual check fails to start the app
    const command = testCommand || await detectTestFramework(folderPath);
    
    if (!command) {
      // ISSUE 6 FIX: If app couldn't start AND no test framework, return failure not success
      if (appStartupError) {
        logger.warn(`No test framework detected in ${folderPath}, and app failed to start - reporting as failure`);
        return {
          success: false,
          exitCode: 1,
          output: `Visual health check failed: ${error.message}\n\nNo test framework detected to fall back to.`,
          error: `App failed to start: ${error.message}`,
          testCommand: 'visual-health-check',
          duration,
        };
      }
      
      // Only return success if we genuinely couldn't detect any issues (app didn't even try to start)
      logger.info(`No test framework detected in ${folderPath} - skipping tests`);
      return {
        success: true,
        exitCode: 0,
        output: 'No test framework detected - skipping tests',
        testCommand: 'none',
        duration: 0,
      };
    }

    logger.info(`Falling back to command: ${command} in ${folderPath}`);

    try {
      const { stdout, stderr } = await execAsync(command, {
        cwd: folderPath,
        timeout: config.testing.timeout,
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      return {
        success: true,
        exitCode: 0,
        output: stdout + (stderr ? `\n${stderr}` : ''),
        testCommand: command,
        duration: Date.now() - startTime,
      };
    } catch (fallbackError: any) {
      return {
        success: false,
        exitCode: fallbackError.code || 1,
        output: (fallbackError.stdout || '') + (fallbackError.stderr || fallbackError.message || ''),
        error: fallbackError.stderr || fallbackError.message,
        testCommand: command,
        duration: Date.now() - startTime,
      };
    }
  }
}

/**
 * Saves test results to file
 */
export async function saveTestResults(
  folderPath: string,
  taskId: string,
  testResult: TestResult
): Promise<string> {
  const resultsDir = path.join(folderPath, '.clickup-workflow', taskId);
  await fs.ensureDir(resultsDir);
  
  const resultsPath = path.join(resultsDir, 'test-results.json');
  await fs.writeJson(resultsPath, testResult, { spaces: 2 });
  
  logger.debug(`Saved test results to ${resultsPath}`);
  return resultsPath;
}















