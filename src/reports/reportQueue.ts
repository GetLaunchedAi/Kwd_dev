import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ReportJob, ReportType } from './contracts';
import { writeJsonAtomic, readJsonSafe } from '../storage/jsonStore';
import { reportRunner } from './reportRunner';

export class ReportQueue {
  private baseDir: string;
  private queueDir: string;
  private runningDir: string;
  private doneDir: string;
  private failedDir: string;
  private isProcessing = false;
  private interval: NodeJS.Timeout | null = null;

  constructor(workspaceRoot: string) {
    this.baseDir = path.join(workspaceRoot, 'state', 'report-jobs');
    this.queueDir = path.join(this.baseDir, 'queue');
    this.runningDir = path.join(this.baseDir, 'running');
    this.doneDir = path.join(this.baseDir, 'done');
    this.failedDir = path.join(this.baseDir, 'failed');
  }

  async initialize(): Promise<void> {
    await fs.ensureDir(this.queueDir);
    await fs.ensureDir(this.runningDir);
    await fs.ensureDir(this.doneDir);
    await fs.ensureDir(this.failedDir);

    // Cleanup running tasks on startup
    const runningFiles = await fs.readdir(this.runningDir);
    for (const file of runningFiles) {
      if (file.endsWith('.json')) {
        const filePath = path.join(this.runningDir, file);
        const job = readJsonSafe<ReportJob | null>(filePath, null);
        if (job) {
          logger.info(`Cleaning up interrupted job ${job.jobId} from running directory.`);
          await this.completeJob(job.jobId, 'failed', 'Server restarted during execution');
        }
      }
    }
  }

  start(): void {
    if (this.interval) return;
    this.interval = setInterval(() => this.processQueue(), 5000);
    logger.info('Report Queue Processor started');
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;

    try {
      const job = await this.claimNextJob();
      if (job) {
        logger.info(`Starting execution of job ${job.jobId}`);
        try {
          await reportRunner.runJob(job);
          await this.completeJob(job.jobId, 'completed');
        } catch (err: any) {
          logger.error(`Job ${job.jobId} failed: ${err.message}`);
          await this.completeJob(job.jobId, 'failed', err.message);
        }
      }
    } finally {
      this.isProcessing = false;
    }
  }

  async enqueueJob(siteSlug: string, reportType: ReportType, trigger: 'manual' | 'scheduled' = 'manual'): Promise<string> {
    const jobId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const dedupeKey = `${siteSlug}:${reportType}:${new Date().toISOString().split('T')[0]}`;

    // Check for existing identical job in queue or running
    if (trigger === 'scheduled') {
      const existing = await this.findJobByDedupeKey(dedupeKey);
      if (existing) {
        logger.info(`Job already exists for ${dedupeKey}, returning existing jobId ${existing.jobId}`);
        return existing.jobId;
      }
    }

    const job: ReportJob = {
      jobId: jobId,
      siteSlug,
      reportType,
      status: 'queued',
      startedAt: new Date().toISOString(),
      dedupeKey: trigger === 'scheduled' ? dedupeKey : undefined
    };

    const filePath = path.join(this.queueDir, `${jobId}.json`);
    await writeJsonAtomic(filePath, job);
    logger.info(`Enqueued ${reportType} report job for ${siteSlug} (ID: ${jobId})`);
    return jobId;
  }

  private async findJobByDedupeKey(dedupeKey: string): Promise<ReportJob | null> {
    const dirs = [this.queueDir, this.runningDir];
    for (const dir of dirs) {
      if (!(await fs.pathExists(dir))) continue;
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith('.json')) {
          const job = readJsonSafe<ReportJob | null>(path.join(dir, file), null);
          if (job && job.dedupeKey === dedupeKey) {
            return job;
          }
        }
      }
    }
    return null;
  }

  async claimNextJob(): Promise<ReportJob | null> {
    if (!(await fs.pathExists(this.queueDir))) return null;
    const files = await fs.readdir(this.queueDir);
    const jobFiles = files.filter(f => f.endsWith('.json')).sort();

    if (jobFiles.length === 0) return null;

    // Check if anything is already running (one at a time for reports to avoid overloading)
    const runningFiles = await fs.readdir(this.runningDir);
    if (runningFiles.length > 0) return null;

    const nextFile = jobFiles[0];
    const oldPath = path.join(this.queueDir, nextFile);
    const newPath = path.join(this.runningDir, nextFile);

    try {
      await fs.rename(oldPath, newPath);
      const job = readJsonSafe<ReportJob | null>(newPath, null);
      if (job) {
        job.status = 'running';
        job.startedAt = new Date().toISOString();
        await writeJsonAtomic(newPath, job);
        return job;
      }
    } catch (err) {
      logger.error(`Failed to claim job ${nextFile}: ${err}`);
    }
    return null;
  }

  async completeJob(jobId: string, status: 'completed' | 'failed' | 'timeout', error?: string): Promise<void> {
    const fileName = `${jobId}.json`;
    const sourcePath = path.join(this.runningDir, fileName);
    
    if (!(await fs.pathExists(sourcePath))) {
      logger.warn(`Job ${jobId} not found in running directory.`);
      return;
    }

    const job = readJsonSafe<ReportJob | null>(sourcePath, null);
    if (!job) return;

    job.status = status;
    job.finishedAt = new Date().toISOString();
    job.error = error;

    const destDir = status === 'completed' ? this.doneDir : this.failedDir;
    const destPath = path.join(destDir, fileName);

    await writeJsonAtomic(sourcePath, job);
    await fs.rename(sourcePath, destPath);
    logger.info(`Job ${jobId} finished with status ${status}`);
  }

  async getJobStatus(jobId: string): Promise<ReportJob | null> {
    const dirs = [this.queueDir, this.runningDir, this.doneDir, this.failedDir];
    for (const dir of dirs) {
      const filePath = path.join(dir, `${jobId}.json`);
      if (await fs.pathExists(filePath)) {
        return readJsonSafe<ReportJob | null>(filePath, null);
      }
    }
    return null;
  }

  async getLatestCompletedRun(siteSlug: string, reportType: ReportType): Promise<ReportJob | null> {
    if (!(await fs.pathExists(this.doneDir))) return null;
    const files = await fs.readdir(this.doneDir);
    const jobs: ReportJob[] = [];
    
    for (const file of files) {
      if (file.endsWith('.json')) {
        const job = readJsonSafe<ReportJob | null>(path.join(this.doneDir, file), null);
        if (job && job.siteSlug === siteSlug && job.reportType === reportType) {
          jobs.push(job);
        }
      }
    }

    return jobs.sort((a, b) => (b.finishedAt || '').localeCompare(a.finishedAt || ''))[0] || null;
  }
}

export const reportQueue = new ReportQueue(process.cwd());

export async function enqueueReportJob(data: {
  siteSlug: string;
  reportType: ReportType;
  trigger: 'manual' | 'scheduled';
}): Promise<string> {
  return await reportQueue.enqueueJob(data.siteSlug, data.reportType, data.trigger);
}




