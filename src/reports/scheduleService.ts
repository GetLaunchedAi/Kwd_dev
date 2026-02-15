import { ScheduleManager } from './scheduleManager';
import { isOverdue, getDetroitNowISO } from '../time/timeUtils';
import { enqueueReportJob } from './reportQueue';
import { withFileLock } from '../storage/locks';
import { DateTime } from 'luxon';
import { reportingConfig } from '../config/reporting';

export class ScheduleService {
  private static interval: NodeJS.Timeout | null = null;
  private static isRunning = false;

  public static start(intervalMs: number = reportingConfig.scheduler.tickIntervalMs): void {
    if (this.interval) return;
    
    console.log('[ScheduleService] Starting tick loop...');
    this.interval = setInterval(() => this.tick(), intervalMs);
    // Initial tick
    this.tick();
  }

  public static stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private static async tick(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;

    try {
      await withFileLock('scheduler', async () => {
        const manager = ScheduleManager.getInstance();
        const schedules = manager.getSchedules().filter(s => s.enabled);
        const nowISO = getDetroitNowISO();

        for (const schedule of schedules) {
          if (isOverdue(schedule.nextRunAt)) {
            console.log(`[ScheduleService] Schedule ${schedule.id} is due for ${schedule.siteSlug}`);
            
            for (const reportType of schedule.reportTypes) {
              try {
                // Dedupe key logic is handled inside enqueueReportJob for 'scheduled' trigger
                await enqueueReportJob({
                  siteSlug: schedule.siteSlug,
                  reportType,
                  trigger: 'scheduled'
                });
              } catch (err) {
                console.error(`[ScheduleService] Failed to enqueue ${reportType} for ${schedule.siteSlug}`, err);
              }
            }

            // Update schedule nextRunAt
            await manager.markRunComplete(schedule.id);
          }
        }
      });
    } catch (err) {
      console.error('[ScheduleService] Error in tick loop', err);
    } finally {
      this.isRunning = false;
    }
  }
}

export const scheduleService = ScheduleService;





