import { Router, Request, Response } from 'express';
import { ScheduleManager } from '../reports/scheduleManager';
import { logger } from '../utils/logger';

const router = Router();
const manager = ScheduleManager.getInstance();

// GET /api/schedules?siteSlug=...
router.get('/', (req: Request, res: Response) => {
  const { siteSlug } = req.query;
  const schedules = manager.getSchedules(siteSlug as string);
  res.json(schedules);
});

// GET /api/schedules/:id
router.get('/:id', (req: Request, res: Response) => {
  const schedule = manager.getScheduleById(req.params.id);
  if (!schedule) {
    return res.status(404).json({ error: 'Schedule not found' });
  }
  res.json(schedule);
});

// POST /api/schedules
router.post('/', async (req: Request, res: Response) => {
  try {
    const { siteSlug, cadence, reportTypes, hour, minute } = req.body;
    
    if (!siteSlug || !cadence || !reportTypes || !Array.isArray(reportTypes)) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const schedule = await manager.createSchedule({
      siteSlug,
      cadence,
      reportTypes,
      hour,
      minute
    });

    res.status(201).json(schedule);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/schedules/:id
router.patch('/:id', async (req: Request, res: Response) => {
  try {
    const updated = await manager.updateSchedule(req.params.id, req.body);
    res.json(updated);
  } catch (err: any) {
    if (err.message.includes('not found')) {
      return res.status(404).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/schedules/:id
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await manager.deleteSchedule(req.params.id);
    res.status(204).end();
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;




