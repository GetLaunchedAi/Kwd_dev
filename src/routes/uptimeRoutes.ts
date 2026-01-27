import { Router, Request, Response } from 'express';
import { getUptimeSummary } from '../uptime/uptimeStore';
import { resolveSiteUrl } from '../uptime/domainResolver';
import { logger } from '../utils/logger';

const router = Router();

/**
 * GET /api/uptime/:siteSlug
 */
router.get('/:siteSlug', async (req, res) => {
  const { siteSlug } = req.params;
  
  try {
    const url = await resolveSiteUrl(siteSlug);
    const summary: any = getUptimeSummary(siteSlug);
    
    if (!url) {
      summary.status = 'UNCONFIGURED';
    }
    
    res.json(summary);
  } catch (err: any) {
    logger.error(`Error fetching uptime summary for ${siteSlug}:`, err);
    res.status(500).json({ error: 'Failed to fetch uptime summary' });
  }
});

export default router;




