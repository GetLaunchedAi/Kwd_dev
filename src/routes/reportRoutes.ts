import { Router, Request, Response } from 'express';
import { reportQueue } from '../reports/reportQueue';
import { logger } from '../utils/logger';

const router = Router();

/**
 * POST /api/reports/run
 * Enqueues a new report job.
 */
router.post('/api/reports/run', async (req: Request, res: Response) => {
  try {
    const { siteSlug, reportType } = req.body;
    
    if (!siteSlug || !reportType) {
      return res.status(400).json({ error: 'Missing siteSlug or reportType' });
    }

    if (reportType !== 'performance' && reportType !== 'security') {
      return res.status(400).json({ error: 'Invalid reportType' });
    }

    const jobId = await reportQueue.enqueueJob(siteSlug, reportType, 'manual');
    res.json({ jobId });
  } catch (error: any) {
    logger.error(`Error enqueuing report job: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reports/jobs/:jobId
 * Returns the status of a specific report job.
 */
router.get('/api/reports/jobs/:jobId', async (req: Request, res: Response) => {
  try {
    const { jobId } = req.params;
    const job = await reportQueue.getJobStatus(jobId);
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json(job);
  } catch (error: any) {
    logger.error(`Error fetching job status: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reports/:siteSlug/latest
 * Returns the latest completed run for a site and report type.
 */
router.get('/api/reports/:siteSlug/latest', async (req: Request, res: Response) => {
  try {
    const { siteSlug } = req.params;
    const { type } = req.query;

    if (!type || (type !== 'performance' && type !== 'security')) {
      return res.status(400).json({ error: 'Valid report type is required' });
    }

    const job = await reportQueue.getLatestCompletedRun(siteSlug, type as 'performance' | 'security');
    
    if (!job) {
      return res.status(404).json({ error: 'No completed runs found' });
    }

    res.json(job);
  } catch (error: any) {
    logger.error(`Error fetching latest run: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;





