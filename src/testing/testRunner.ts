import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);

export interface TestResult {
  success: boolean;
  exitCode: number;
  output: string;
  error?: string;
  testCommand: string;
  duration: number;
}

/**
 * Auto-detects test framework and returns test command
 */
export async function detectTestFramework(folderPath: string): Promise<string | null> {
  logger.debug(`Detecting test framework in: ${folderPath}`);

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
  testCommand?: string
): Promise<TestResult> {
  const startTime = Date.now();
  
  // Detect test command if not provided
  const command = testCommand || await detectTestFramework(folderPath);
  
  if (!command) {
    return {
      success: false,
      exitCode: 1,
      output: 'No test framework detected',
      error: 'No test framework detected',
      testCommand: 'none',
      duration: 0,
    };
  }

  logger.info(`Running tests with command: ${command} in ${folderPath}`);

  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: folderPath,
      timeout: config.testing.timeout,
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const duration = Date.now() - startTime;
    const output = stdout + (stderr ? `\n${stderr}` : '');
    
    logger.info(`Tests completed successfully in ${duration}ms`);
    
    return {
      success: true,
      exitCode: 0,
      output,
      testCommand: command,
      duration,
    };
  } catch (error: any) {
    const duration = Date.now() - startTime;
    const output = error.stdout || '';
    const errorOutput = error.stderr || error.message || '';
    
    logger.error(`Tests failed: ${errorOutput}`);
    
    return {
      success: false,
      exitCode: error.code || 1,
      output: output + (errorOutput ? `\n${errorOutput}` : ''),
      error: errorOutput,
      testCommand: command,
      duration,
    };
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















