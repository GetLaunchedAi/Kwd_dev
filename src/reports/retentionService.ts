import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ShareLinkManager } from './shareLinkManager';
import { reportingConfig } from '../config/reporting';

export class RetentionService {
  private runsDir: string;
  private interval: NodeJS.Timeout | null = null;

  constructor(workspaceRoot: string) {
    this.runsDir = path.join(workspaceRoot, 'state', 'reports', 'runs');
  }

  /**
   * Starts the retention service loop (runs once immediately, then every 24 hours).
   */
  start(): void {
    if (this.interval) return;
    
    // Run immediately
    this.runRetention();

    // Run every 24 hours
    this.interval = setInterval(() => this.runRetention(), 24 * 60 * 60 * 1000);
    logger.info('Retention Service started (24h interval)');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  async runRetention(): Promise<void> {
    logger.info('Running retention job...');
    try {
      await this.pruneExpiredShareLinks();
      await this.pruneOldReports();
      logger.info('Retention job completed successfully.');
    } catch (err) {
      logger.error(`Retention job failed: ${err}`);
    }
  }

  private async pruneExpiredShareLinks(): Promise<void> {
    const count = await ShareLinkManager.getInstance().pruneExpiredLinks();
    if (count > 0) {
      logger.info(`Pruned ${count} expired share links.`);
    }
  }

  private async pruneOldReports(): Promise<void> {
    if (!(await fs.pathExists(this.runsDir))) return;

    const maxRuns = reportingConfig.retention.maxReportRunsPerSite;
    const sites = await fs.readdir(this.runsDir);
    for (const siteSlug of sites) {
      const sitePath = path.join(this.runsDir, siteSlug);
      if (!(await fs.stat(sitePath)).isDirectory()) continue;

      const runIds = await fs.readdir(sitePath);
      const runsWithTime: { runId: string; mtime: number }[] = [];

      for (const runId of runIds) {
        const runPath = path.join(sitePath, runId);
        if (!(await fs.stat(runPath)).isDirectory()) continue;

        const stats = await fs.stat(runPath);
        runsWithTime.push({ runId, mtime: stats.mtimeMs });
      }

      // Keep only the latest runs based on config
      if (runsWithTime.length > maxRuns) {
        runsWithTime.sort((a, b) => b.mtime - a.mtime);
        const toDelete = runsWithTime.slice(maxRuns);

        for (const run of toDelete) {
          const runPath = path.join(sitePath, run.runId);
          logger.info(`Pruning old report run: ${runPath}`);
          await fs.remove(runPath);
        }
      }
    }
  }
}

export const retentionService = new RetentionService(process.cwd());




