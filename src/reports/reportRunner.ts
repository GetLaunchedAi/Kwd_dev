import * as fs from 'fs-extra';
import * as path from 'path';
import { exec } from 'child_process';
import { logger } from '../utils/logger';
import { ReportJob, ReportType, ReportRunMeta } from './contracts';
import { visualTester } from '../utils/visualTesting';
import { writeJsonAtomic } from '../storage/jsonStore';
import { findAllClients } from '../utils/clientScanner';
import { reportingConfig } from '../config/reporting';

export class ReportRunner {
  private runsDir: string;

  constructor(workspaceRoot: string) {
    this.runsDir = path.join(workspaceRoot, 'state', 'reports', 'runs');
  }

  async runJob(job: ReportJob): Promise<void> {
    const runId = job.jobId;
    const runDir = path.join(this.runsDir, job.siteSlug, runId, job.reportType);
    await fs.ensureDir(runDir);

    const clientFolder = await this.getClientFolder(job.siteSlug);
    if (!clientFolder) {
      throw new Error(`Client folder not found for slug: ${job.siteSlug}`);
    }

    try {
      if (job.reportType === 'performance') {
        await this.runPerformanceReport(job, clientFolder, runDir);
      } else if (job.reportType === 'security') {
        await this.runSecurityReport(job, clientFolder, runDir);
      }

      const meta: ReportRunMeta = {
        runId,
        siteSlug: job.siteSlug,
        reportType: job.reportType,
        startedAt: job.startedAt || new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        status: 'completed',
        trigger: job.dedupeKey ? 'scheduled' : 'manual'
      };
      await writeJsonAtomic(path.join(runDir, '..', 'meta.json'), meta);
    } catch (err: any) {
      logger.error(`Error running ${job.reportType} report for ${job.siteSlug}: ${err.message}`);
      throw err;
    }
  }

  private async getClientFolder(siteSlug: string): Promise<string | null> {
    const clients = await findAllClients();
    const client = clients.find(c => c.name === siteSlug);
    return client ? client.folder : null;
  }

  private async runPerformanceReport(job: ReportJob, clientFolder: string, runDir: string): Promise<void> {
    logger.info(`Starting performance report for ${job.siteSlug}`);
    
    let url: string | undefined;
    try {
      url = await visualTester.startApp(clientFolder);
      logger.info(`App started at ${url} for performance report`);

      const cmd = `npx lighthouse ${url} --output html --output json --output-path ${path.join(runDir, 'lighthouse.report')} --chrome-flags="--headless --no-sandbox"`;
      
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Lighthouse report timed out after ${reportingConfig.timeouts.lighthouse}ms`));
        }, reportingConfig.timeouts.lighthouse);

        exec(cmd, (error, stdout, stderr) => {
          clearTimeout(timeout);
          if (error) {
            logger.error(`Lighthouse failed: ${error.message}`);
            reject(error);
          } else {
            resolve();
          }
        });
      });

      // Lighthouse produced lighthouse.report.html and lighthouse.report.json
      // Rename them for consistency
      const files = await fs.readdir(runDir);
      for (const file of files) {
        if (file.startsWith('lighthouse.report') && (file.endsWith('.html') || file.endsWith('.json'))) {
          const ext = path.extname(file);
          await fs.move(path.join(runDir, file), path.join(runDir, `lighthouse${ext}`), { overwrite: true });
        }
      }

      // Generate summary.json
      const lighthouseJson = await fs.readJson(path.join(runDir, 'lighthouse.json'));
      const summary = {
        performance: lighthouseJson.categories.performance.score * 100,
        accessibility: lighthouseJson.categories.accessibility.score * 100,
        bestPractices: lighthouseJson.categories['best-practices'].score * 100,
        seo: lighthouseJson.categories.seo.score * 100,
        pwa: lighthouseJson.categories.pwa.score * 100,
      };
      await writeJsonAtomic(path.join(runDir, 'summary.json'), summary);

    } finally {
      if (url) {
        await visualTester.stopApp(clientFolder);
      }
    }
  }

  private async runSecurityReport(job: ReportJob, clientFolder: string, runDir: string): Promise<void> {
    logger.info(`Starting security report for ${job.siteSlug}`);

    const results: any = {
      dependencies: { status: 'unknown', issues: [] },
      headers: { status: 'unknown', issues: [] }
    };

    // 1. Dependency Audit
    const packageJsonPath = path.join(clientFolder, 'package.json');
    if (await fs.pathExists(packageJsonPath)) {
      try {
        const cmd = 'npm audit --json';
        const auditOutput = await new Promise<string>((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`npm audit timed out after ${reportingConfig.timeouts.securityAudit}ms`));
          }, reportingConfig.timeouts.securityAudit);

          exec(cmd, { cwd: clientFolder }, (error, stdout, stderr) => {
            clearTimeout(timeout);
            // npm audit returns non-zero if issues found, so we ignore error
            resolve(stdout || stderr);
          });
        });

        const audit = JSON.parse(auditOutput);
        results.dependencies = {
          status: audit.metadata.vulnerabilities.high > 0 || audit.metadata.vulnerabilities.critical > 0 ? 'fail' : 'pass',
          critical: audit.metadata.vulnerabilities.critical || 0,
          high: audit.metadata.vulnerabilities.high || 0,
          moderate: audit.metadata.vulnerabilities.moderate || 0,
          low: audit.metadata.vulnerabilities.low || 0,
          total: audit.metadata.vulnerabilities.total || 0
        };
        
        await writeJsonAtomic(path.join(runDir, 'raw-audit.json'), audit);
      } catch (err: any) {
        logger.warn(`npm audit failed for ${job.siteSlug}: ${err.message}`);
        results.dependencies.error = err.message;
      }
    } else {
      results.dependencies.status = 'no-package-json';
    }

    // 2. Security Headers (Check production URL if possible)
    const productionUrl = await this.getProductionUrl(clientFolder);
    if (productionUrl) {
      try {
        const axios = (await import('axios')).default;
        const response = await axios.get(productionUrl, { 
          validateStatus: () => true,
          timeout: 10000 
        });
        const headers = response.headers;

        const securityHeaders = [
          'Content-Security-Policy',
          'Strict-Transport-Security',
          'X-Frame-Options',
          'X-Content-Type-Options',
          'Referrer-Policy',
          'Permissions-Policy'
        ];

        const headerResults: any = {};
        let score = 0;
        for (const header of securityHeaders) {
          const value = headers[header.toLowerCase()];
          headerResults[header] = value || 'missing';
          if (value) score++;
        }

        results.headers = {
          status: score >= 4 ? 'pass' : 'fail',
          score,
          total: securityHeaders.length,
          details: headerResults
        };
      } catch (err: any) {
        logger.warn(`Security headers check failed for ${productionUrl}: ${err.message}`);
        results.headers.error = err.message;
      }
    }

    await writeJsonAtomic(path.join(runDir, 'public-summary.json'), results);
  }

  private async getProductionUrl(clientFolder: string): Promise<string | null> {
    const dataPath = path.join(clientFolder, 'src', '_data', 'client.json');
    if (await fs.pathExists(dataPath)) {
      try {
        const clientData = await fs.readJson(dataPath);
        if (clientData.domain) {
          let domain = clientData.domain.trim();
          if (!domain.startsWith('http')) domain = `https://${domain}`;
          return domain;
        }
      } catch (err) {}
    }
    return null;
  }
}

export const reportRunner = new ReportRunner(process.cwd());






