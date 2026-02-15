/// <reference lib="dom" />
import * as path from 'path';
import * as fs from 'fs-extra';
import { exec, ChildProcess } from 'child_process';
import puppeteer, { Browser } from 'puppeteer';
import { logger } from './logger';
import * as net from 'net';
import kill from 'tree-kill';
import { 
  captureWebsiteScreenshots, 
  loadScreenshotManifest, 
  getAllScreenshotManifests,
  ScreenshotResult,
  ScreenshotManifest,
  ScreenshotOptions
} from './screenshotService';

export interface VisualCheckResult {
  success: boolean;
  screenshotPaths: string[];
  errors: string[];
  brokenLinks: string[];
}

export interface PreviewInstance {
  folderPath: string;
  port: number;
  url: string;
  process: ChildProcess;
  browser: Browser | null;
  startTime: number;
  timeoutTimer: NodeJS.Timeout;
  logs: string[];
  status: 'starting' | 'running' | 'error' | 'stopped';
  error?: string;
}

/**
 * Utility for running multiple client apps and performing visual/link checks
 */
export class VisualTester {
  private instances: Map<string, PreviewInstance> = new Map();
  private basePort = 8081;
  private maxInstances = 50;

  /**
   * Finds an available port starting from basePort
   */
  private async findAvailablePort(): Promise<number> {
    const isPortAvailable = (port: number): Promise<boolean> => {
      return new Promise((resolve) => {
        const server = net.createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
          server.close();
          resolve(true);
        });
        server.listen(port);
      });
    };

    const reservedPorts = [3000, 5173, 8080];
    let port = this.basePort;
    // Also avoid ports already in use by our instances
    const activePorts = new Set(Array.from(this.instances.values()).map(i => i.port));

    while (port < this.basePort + this.maxInstances * 4) {
      if (!reservedPorts.includes(port) && !activePorts.has(port) && await isPortAvailable(port)) {
        return port;
      }
      port++;
    }
    throw new Error('No available ports found for preview');
  }

  /**
   * Checks if a preview instance process is actually alive
   */
  private isProcessAlive(instance: PreviewInstance): boolean {
    if (!instance.process || !instance.process.pid) {
      return false;
    }
    
    // Check if the status indicates it's still running
    if (instance.status !== 'running' && instance.status !== 'starting') {
      return false;
    }
    
    // Try to check if process is still alive by sending signal 0
    try {
      process.kill(instance.process.pid, 0);
      return true;
    } catch (e) {
      // Process is not alive
      return false;
    }
  }

  /**
   * Starts the client application for a specific folder
   * In production (Cloudways), uses the production domain URL instead of starting a preview server
   * @param folderPath - Path to the client project folder
   * @param forceLocal - When true, always start a local dev server (used for screenshots to capture local changes)
   */
  async startApp(folderPath: string, forceLocal: boolean = false): Promise<string> {
    // In production, use static URL instead of starting a preview server
    // UNLESS forceLocal is true (needed for accurate before/after screenshot comparison)
    const isProduction = process.env.NODE_ENV === 'production';
    
    if (isProduction && !forceLocal) {
      const slug = path.basename(folderPath);
      
      // Check for custom domain in client.json
      const clientJsonPath = path.join(folderPath, 'src', '_data', 'client.json');
      if (await fs.pathExists(clientJsonPath)) {
        try {
          const clientData = await fs.readJson(clientJsonPath);
          if (clientData.domain && clientData.domain !== 'www.website.com') {
            let domain = clientData.domain.trim();
            if (!domain.startsWith('http')) {
              domain = `https://${domain}`;
            }
            logger.info(`Using production domain for screenshots: ${domain}`);
            return domain;
          }
        } catch (err) {
          logger.warn(`Could not read client.json for ${slug}: ${err}`);
        }
      }
      
      // Fallback to Cloudways static URL
      const cloudwaysUrl = `https://phpstack-1518311-6128748.cloudwaysapps.com/client-websites/${slug}/`;
      logger.info(`Using Cloudways static URL for screenshots: ${cloudwaysUrl}`);
      return cloudwaysUrl;
    }
    
    // Local mode: start local preview server
    // Check if already running
    const existing = this.instances.get(folderPath);
    if (existing) {
      // ISSUE 1 FIX: Verify the process is actually still alive before returning cached URL
      if (this.isProcessAlive(existing)) {
        logger.info(`Preview already running for ${folderPath} at ${existing.url}`);
        // Refresh timeout
        this.resetTimeout(folderPath);
        return existing.url;
      } else {
        // Process is dead but instance still in map - clean it up
        logger.warn(`Stale preview instance found for ${folderPath} (status: ${existing.status}, error: ${existing.error || 'none'}). Cleaning up and restarting.`);
        // Log the last few lines from the dead process for debugging (ISSUE 4 FIX)
        if (existing.logs.length > 0) {
          const lastLogs = existing.logs.slice(-10).join('\n');
          logger.debug(`Last logs from dead process:\n${lastLogs}`);
        }
        this.instances.delete(folderPath);
        clearTimeout(existing.timeoutTimer);
      }
    }

    const port = await this.findAvailablePort();
    
    // Determine start command - favor npm start if package.json exists
    let command = `npx eleventy --serve --port ${port}`;
    const packageJsonPath = path.join(folderPath, 'package.json');
    
    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = await fs.readJson(packageJsonPath);
        if (pkg.scripts?.start) {
          // If using npm start, we need to pass the port somehow.
          // Most of these apps use environment variables or specific flags.
          // For simplicity, we'll try to use the port flag if it's eleventy-based
          // or just hope npm start respects a PORT env var.
          command = `npm start -- --port=${port}`;
          process.env.PORT = port.toString();
        }
      } catch (e) {
        logger.warn(`Could not read package.json in ${folderPath}, using default command`);
      }
    }

    logger.info(`Starting app in ${folderPath} on port ${port} with command: ${command}`);
    
    const instance: PreviewInstance = {
      folderPath,
      port,
      url: `http://localhost:${port}`,
      process: null as any, // Will be set below
      browser: null,
      startTime: Date.now(),
      timeoutTimer: null as any, // Will be set below
      logs: [`Starting with command: ${command}`],
      status: 'starting'
    };
    
    this.instances.set(folderPath, instance);

    return new Promise((resolve, reject) => {
      // Get npm global bin path and add to PATH for globally installed tools
      // Priority: NPM_GLOBAL_BIN env var > npm_config_prefix > platform default
      let npmGlobalBin = process.env.NPM_GLOBAL_BIN;
      if (!npmGlobalBin) {
        npmGlobalBin = process.env.npm_config_prefix 
          ? `${process.env.npm_config_prefix}/bin`
          : (process.platform === 'win32' 
            ? `${process.env.APPDATA}\\npm` 
            : '/usr/local/bin');
      }
      const enhancedPath = `${npmGlobalBin}:${process.env.PATH}`;
      
      // ISSUE 22 FIX: Wrap process spawn in try-catch to ensure port/instance cleanup on early failure
      let appProcess: ChildProcess;
      try {
        appProcess = exec(command, { 
          cwd: folderPath,
          env: { ...process.env, PORT: port.toString(), PATH: enhancedPath }
        });
      } catch (spawnError: any) {
        // Early failure during exec() call - clean up instance to release the port
        logger.error(`Failed to spawn process for ${folderPath}: ${spawnError.message}`);
        this.instances.delete(folderPath);
        reject(new Error(`Failed to spawn process: ${spawnError.message}`));
        return;
      }
      
      instance.process = appProcess;
      instance.timeoutTimer = setTimeout(() => this.stopApp(folderPath), 30 * 60 * 1000);

      let resolved = false;

      const addLog = (data: string) => {
        const lines = data.split('\n').filter(l => l.trim());
        instance.logs.push(...lines);
        if (instance.logs.length > 500) instance.logs = instance.logs.slice(-500);
        
        if (!resolved && (
            data.includes(`http://localhost:${port}`) || 
            data.includes('Serving') || 
            data.includes('Server running') ||
            data.includes('Local:'))) {
          
          resolved = true;
          instance.status = 'running';
          resolve(instance.url);
        }
      };

      appProcess.stdout?.on('data', (data) => {
        addLog(data.toString());
      });

      appProcess.stderr?.on('data', (data) => {
        addLog(data.toString());
      });

      appProcess.on('error', (err) => {
        logger.error(`Failed to start app in ${folderPath}: ${err.message}`);
        instance.status = 'error';
        instance.error = err.message;
        instance.logs.push(`ERROR: ${err.message}`);
        // ISSUE 22 FIX: Clean up instance immediately on spawn error to release port
        clearTimeout(instance.timeoutTimer);
        this.instances.delete(folderPath);
        if (!resolved) {
          resolved = true;
          reject(err);
        }
      });

      appProcess.on('exit', (code, signal) => {
        if (code !== 0 && code !== null) {
          // ISSUE 4 FIX: Log more details about why the app failed to start
          const recentLogs = instance.logs.slice(-20).join('\n');
          logger.warn(`App process for ${folderPath} exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`);
          logger.debug(`App process logs before exit:\n${recentLogs}`);
          instance.status = 'error';
          instance.error = `Exited with code ${code}${signal ? ` (signal: ${signal})` : ''}`;
          instance.logs.push(`PROCESS EXITED WITH CODE ${code}${signal ? ` (signal: ${signal})` : ''}`);
          
          // ISSUE 5 FIX: Clean up the instance from the map when process dies unexpectedly
          // This prevents stale instances from causing issues on next startApp call
          // We keep the instance for a short time so logs can still be retrieved, then clean up
          setTimeout(() => {
            const currentInstance = this.instances.get(folderPath);
            // Only delete if it's the same instance (hasn't been replaced by a new one)
            if (currentInstance === instance && currentInstance.status === 'error') {
              logger.debug(`Cleaning up stale instance for ${folderPath} after exit`);
              this.instances.delete(folderPath);
            }
          }, 5000); // Keep for 5 seconds so logs can be retrieved
        } else {
          instance.status = 'stopped';
          instance.logs.push(`Process exited normally`);
        }
      });

      // Timeout if it doesn't start in 60 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          appProcess.kill();
          instance.status = 'error';
          instance.error = 'Timeout waiting for app to start';
          instance.logs.push('ERROR: Timeout waiting for app to start');
          // ISSUE 22 FIX: Clean up instance on startup timeout to release port
          clearTimeout(instance.timeoutTimer);
          this.instances.delete(folderPath);
          reject(new Error(`Timeout waiting for app to start in ${folderPath}`));
        }
      }, 60000);
    });
  }

  /**
   * Runs a manual command in the project folder
   */
  async runCommand(folderPath: string, command: string): Promise<{ success: boolean, output: string }> {
    logger.info(`Running manual command in ${folderPath}: ${command}`);
    
    return new Promise((resolve) => {
      exec(command, { cwd: folderPath }, (error, stdout, stderr) => {
        const output = stdout + stderr;
        if (error) {
          logger.error(`Command failed: ${command} - ${error.message}`);
          resolve({ success: false, output });
        } else {
          resolve({ success: true, output });
        }
      });
    });
  }

  /**
   * Resets the 30-minute timeout for an instance
   */
  private resetTimeout(folderPath: string) {
    const instance = this.instances.get(folderPath);
    if (instance) {
      clearTimeout(instance.timeoutTimer);
      instance.timeoutTimer = setTimeout(() => this.stopApp(folderPath), 30 * 60 * 1000);
      logger.debug(`Reset timeout for preview: ${folderPath}`);
    }
  }

  /**
   * Stops a specific client application
   * In production, this is a no-op since we use static URLs instead of preview servers
   */
  async stopApp(folderPath: string) {
    const instance = this.instances.get(folderPath);
    if (!instance) {
      // No preview server running (likely using production URL)
      logger.debug(`No preview instance to stop for ${folderPath} (may be using production URL)`);
      return;
    }
    
    logger.info(`Stopping preview for ${folderPath} on port ${instance.port}`);
    clearTimeout(instance.timeoutTimer);
    
    if (instance.browser) {
      try {
        await instance.browser.close();
      } catch (e) {
        logger.warn(`Error closing browser for ${folderPath}: ${e}`);
      }
      instance.browser = null;
    }
    
    // ISSUE 5 FIX: Always clean up the instance from the map, even if kill fails
    // This prevents stale instances from blocking future startApp calls
    const cleanup = () => {
      instance.status = 'stopped';
      this.instances.delete(folderPath);
    };
    
    if (instance.process && instance.process.pid) {
      return new Promise<void>((resolve) => {
        // Check if process is still alive before trying to kill
        let processAlive = true;
        try {
          process.kill(instance.process.pid!, 0);
        } catch (e) {
          processAlive = false;
        }
        
        if (!processAlive) {
          // Process already dead, just clean up
          logger.debug(`Process for ${folderPath} already terminated, cleaning up instance`);
          cleanup();
          resolve();
          return;
        }
        
        kill(instance.process.pid!, 'SIGTERM', (err) => {
          if (err) {
            // ISSUE 5 FIX: Don't just log the error - still clean up the instance
            logger.warn(`Error killing process tree for ${folderPath}: ${err.message}. Process may already be dead.`);
            // Try fallback kill but don't fail if it doesn't work
            try {
              instance.process.kill('SIGKILL');
            } catch (killErr) {
              logger.debug(`Fallback kill also failed for ${folderPath}: ${killErr}`);
            }
          }
          // Always clean up the instance regardless of kill success
          cleanup();
          resolve();
        });
      });
    } else {
      // No PID available, try simple kill and clean up
      try {
        instance.process?.kill('SIGTERM');
      } catch (e) {
        logger.debug(`Error killing process without PID for ${folderPath}: ${e}`);
      }
      cleanup();
    }
  }

  /**
   * Stops all active previews
   */
  async stopAll() {
    const folders = Array.from(this.instances.keys());
    for (const folder of folders) {
      await this.stopApp(folder);
    }
  }

  /**
   * Gets status of all active previews
   */
  getStatus() {
    return Array.from(this.instances.values()).map(i => ({
      folderPath: i.folderPath,
      clientName: path.basename(i.folderPath),
      port: i.port,
      url: i.url,
      status: i.status,
      error: i.error,
      logs: i.logs,
      uptime: Math.round((Date.now() - i.startTime) / 1000),
      expiresIn: 1800 - Math.round((Date.now() - (i.startTime + ((i.timeoutTimer as any)?._idleStart || 0))) / 1000) // Rough estimate
    }));
  }

  /**
   * Takes screenshots of the app (simple single-page mode for backward compatibility)
   */
  async takeScreenshots(url: string, taskId: string, prefix: string, iteration: number = 0): Promise<string[]> {
    // Find instance for this URL to reuse browser if possible
    const instance = Array.from(this.instances.values()).find(i => i.url === url);
    
    let browser: Browser | null = null;
    let shouldCloseBrowser = false;
    
    try {
      browser = instance?.browser || null;
      
      if (!browser) {
        const launchOptions: any = { 
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          protocolTimeout: 60000 
        };

        const manualPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (manualPath) {
          launchOptions.executablePath = manualPath;
          logger.info(`Using manual Chrome path: ${manualPath}`);
        }

        browser = await puppeteer.launch(launchOptions);
        if (instance) {
          instance.browser = browser;
        } else {
          // No instance (production mode), so we own this browser and must close it
          shouldCloseBrowser = true;
        }
      }

      const page = await browser.newPage();
      await page.setViewport({ width: 1280, height: 1000 });
      
      logger.info(`Taking screenshot for task ${taskId} at ${url} (Iteration ${iteration})`);
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

      const screenshotsDir = path.join(process.cwd(), 'public', 'screenshots', taskId, `run_${iteration}`);
      await fs.ensureDir(screenshotsDir);

      const filePath = path.join(screenshotsDir, `${prefix}_full.png`);
      await page.screenshot({ path: filePath, fullPage: true });
      
      await page.close();
      
      // Close browser if we created it (not reusing from instance)
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }
      
      // Return relative path for frontend access
      return [`/screenshots/${taskId}/run_${iteration}/${prefix}_full.png`];
    } catch (error: any) {
      logger.error(`Error taking screenshot: ${error.message}`);
      // Clean up browser on error if we own it
      if (shouldCloseBrowser && browser) {
        try {
          await browser.close();
        } catch (closeError) {
          logger.debug(`Error closing browser after screenshot failure: ${closeError}`);
        }
      }
      return [];
    }
  }

  /**
   * Takes comprehensive site screenshots (multi-page, multi-section)
   * Uses the enhanced screenshot service for full site coverage.
   * 
   * @param url - The base URL of the site to screenshot
   * @param taskId - The task ID for organizing screenshots
   * @param prefix - 'before' or 'after' to distinguish capture timing
   * @param iteration - The iteration number for multiple runs
   * @param options - Optional configuration for screenshot capture
   * @returns Screenshot result with manifest and paths, or null if capture failed
   */
  async takeSiteScreenshots(
    url: string,
    taskId: string,
    prefix: 'before' | 'after',
    iteration: number = 0,
    options: ScreenshotOptions = {},
    clientFolder?: string
  ): Promise<ScreenshotResult | null> {
    try {
      logger.info(`Taking comprehensive site screenshots for task ${taskId} at ${url} (${prefix}, iteration ${iteration})`);
      
      const result = await captureWebsiteScreenshots(url, taskId, prefix, iteration, {
        maxPages: options.maxPages || 20,
        concurrency: options.concurrency || 2,
        captureSections: options.captureSections !== false,
        ...options
      }, clientFolder);
      
      // ISSUE 2 FIX: Check if screenshots were actually captured successfully
      if (!result.success) {
        logger.error(`Site screenshot capture FAILED for task ${taskId}: ${result.error || 'No pages captured successfully'}`);
        // Return the result with failure info so callers can inspect it, but log clearly
        return result;
      }
      
      logger.info(`Site screenshots complete: ${result.manifest.totalPages} pages (${result.failedPages} failed), ${result.manifest.totalSections} sections`);
      return result;
    } catch (error: any) {
      logger.error(`Error taking site screenshots: ${error.message}`);
      return null;
    }
  }

  /**
   * Gets the screenshot manifest for a task.
   * 
   * @param taskId - The task ID
   * @param prefix - 'before' or 'after'
   * @param iteration - The iteration number
   * @returns The manifest or null if not found
   */
  async getScreenshotManifest(
    taskId: string,
    prefix: 'before' | 'after',
    iteration: number = 0
  ): Promise<ScreenshotManifest | null> {
    return loadScreenshotManifest(taskId, prefix, iteration);
  }

  /**
   * Gets all screenshot manifests for a task (before and after, all iterations).
   * 
   * @param taskId - The task ID
   * @returns Object with before and after manifests keyed by iteration
   */
  async getAllScreenshotManifests(taskId: string): Promise<{
    before: Record<number, ScreenshotManifest>;
    after: Record<number, ScreenshotManifest>;
  }> {
    return getAllScreenshotManifests(taskId);
  }

  /**
   * Checks for broken links and console errors
   */
  async performHealthCheck(url: string): Promise<{ errors: string[], brokenLinks: string[] }> {
    const errors: string[] = [];
    const brokenLinks: string[] = [];
    
    // Find instance for this URL to reuse browser if possible
    const instance = Array.from(this.instances.values()).find(i => i.url === url);

    let browser: Browser | null = null;
    let shouldCloseBrowser = false;

    try {
      browser = instance?.browser || null;

      if (!browser) {
        const launchOptions: any = { 
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox'],
          protocolTimeout: 60000 
        };

        const manualPath = process.env.PUPPETEER_EXECUTABLE_PATH;
        if (manualPath) {
          launchOptions.executablePath = manualPath;
          logger.info(`Using manual Chrome path: ${manualPath}`);
        }

        browser = await puppeteer.launch(launchOptions);
        if (instance) {
          instance.browser = browser;
        } else {
          // No instance (production mode), so we own this browser and must close it
          shouldCloseBrowser = true;
        }
      }
      
      const page = await browser.newPage();
      
      // Capture console errors
      page.on('pageerror', (err) => {
        const message = err instanceof Error ? err.message : String(err);
        errors.push(`Page Error: ${message}`);
      });
      
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          errors.push(`Console Error: ${msg.text()}`);
        }
      });

      await page.goto(url, { waitUntil: 'networkidle2' });

      // Find all links
      const links = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a'));
        return anchors
          .map(a => (a as HTMLAnchorElement).href)
          .filter(href => href.startsWith(window.location.origin));
      });

      logger.info(`Checking ${links.length} internal links for broken connections`);
      
      // Simple status check for each link
      for (const link of Array.from(new Set(links))) {
        try {
          const response = await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 10000 });
          if (response && response.status() >= 400) {
            brokenLinks.push(`${link} (Status: ${response.status()})`);
          }
        } catch (e: any) {
          brokenLinks.push(`${link} (Error: ${e.message})`);
        }
      }

      await page.close();
      
      // Close browser if we created it (not reusing from instance)
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }
    } catch (error: any) {
      errors.push(`Health check failed: ${error.message}`);
      // Clean up browser on error if we own it
      if (shouldCloseBrowser && browser) {
        try {
          await browser.close();
        } catch (closeError) {
          logger.debug(`Error closing browser after health check failure: ${closeError}`);
        }
      }
    }
    
    return { errors, brokenLinks };
  }
}

export const visualTester = new VisualTester();




