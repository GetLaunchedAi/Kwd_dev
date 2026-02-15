import { Router, Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs-extra';
import { ShareLinkManager } from '../reports/shareLinkManager';
import { logger } from '../utils/logger';

const router = Router();
const shareManager = ShareLinkManager.getInstance();

/**
 * POST /api/reports/share
 * Creates a new share link.
 */
router.post('/api/reports/share', async (req: Request, res: Response) => {
  try {
    const { siteSlug, runId, reportType, expiresInDays, publicView } = req.body;
    
    if (!siteSlug || !runId || !reportType) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const shareLink = await shareManager.createShareLink(
      siteSlug,
      runId,
      reportType,
      expiresInDays,
      publicView
    );

    // Protocol and host should be determined from the request or config
    const protocol = req.protocol;
    const host = req.get('host');
    const shareUrl = `${protocol}://${host}/r/${shareLink.token}`;

    res.json({
      shareUrl,
      token: shareLink.token,
      expiresAt: shareLink.expiresAt
    });
  } catch (error: any) {
    logger.error(`Error creating share link: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /r/:token
 * Public endpoint to serve the report viewer.
 */
router.get('/r/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const shareLink = await shareManager.getShareLink(token);

    if (!shareLink) {
      return res.status(404).send('Report not found or link expired');
    }

    // Serve the viewer HTML
    const viewerPath = path.join(process.cwd(), 'public', 'report-viewer.html');
    res.sendFile(viewerPath);
  } catch (error: any) {
    logger.error(`Error serving share link: ${error.message}`);
    res.status(500).send('Internal server error');
  }
});

/**
 * GET /api/reports/share/data/:token
 * Public endpoint to retrieve report data for a token.
 */
router.get('/api/reports/share/data/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const shareLink = await shareManager.getShareLink(token);

    if (!shareLink) {
      return res.status(404).json({ error: 'Link expired or invalid' });
    }

    // Construct path to artifacts
    // Pattern: state/reports/runs/<siteSlug>/<runId>/
    const runDir = path.join(
      process.cwd(), 
      'state', 
      'reports', 
      'runs', 
      shareLink.siteSlug, 
      shareLink.runId
    );

    if (!await fs.pathExists(runDir)) {
      await shareManager.deleteShareLink(token);
      return res.status(404).json({ error: 'Report artifacts not found' });
    }

    const summaryPath = path.join(runDir, 'summary.json');
    const metaPath = path.join(runDir, 'meta.json');

    const summary = await fs.readJson(summaryPath).catch(() => ({}));
    const meta = await fs.readJson(metaPath).catch(() => ({}));

    // For performance reports, include lighthouse HTML if it exists
    let performanceHtml = null;
    if (shareLink.reportType === 'performance') {
      const lighthousePath = path.join(runDir, 'performance', 'lighthouse.report.html');
      if (await fs.pathExists(lighthousePath)) {
        performanceHtml = `/api/reports/share/artifact/${token}/performance/lighthouse.report.html`;
      }
    }

    res.json({
      siteSlug: shareLink.siteSlug,
      reportType: shareLink.reportType,
      runId: shareLink.runId,
      summary,
      meta,
      performanceHtml,
      expiresAt: shareLink.expiresAt
    });
  } catch (error: any) {
    logger.error(`Error fetching share data: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /api/reports/share/artifact/:token/*
 * Public endpoint to serve specific artifacts.
 */
router.get('/api/reports/share/artifact/:token/*', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const artifactPath = req.params[0]; // The '*' part
    
    const shareLink = await shareManager.getShareLink(token);
    if (!shareLink) {
      return res.status(404).send('Unauthorized');
    }

    // Path validation to prevent traversal
    const safeArtifactPath = path.normalize(artifactPath).replace(/^(\.\.[\/\\])+/, '');
    
    const fullPath = path.join(
      process.cwd(), 
      'state', 
      'reports', 
      'runs', 
      shareLink.siteSlug, 
      shareLink.runId,
      safeArtifactPath
    );

    if (await fs.pathExists(fullPath)) {
      res.sendFile(fullPath);
    } else {
      res.status(404).send('Artifact not found');
    }
  } catch (error: any) {
    logger.error(`Error serving artifact: ${error.message}`);
    res.status(500).send('Internal server error');
  }
});

export default router;





