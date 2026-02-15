import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { Schedule, Cadence, ReportType } from './contracts';
import { readJsonSafe, writeJsonAtomic } from '../storage/jsonStore';
import { computeNextRunAt, getDetroitNowISO } from '../time/timeUtils';

const SCHEDULES_FILE = path.join(process.cwd(), 'state', 'schedules.json');

export class ScheduleManager {
  private static instance: ScheduleManager;
  private schedules: Schedule[] = [];

  private constructor() {
    this.load();
  }

  public static getInstance(): ScheduleManager {
    if (!ScheduleManager.instance) {
      ScheduleManager.instance = new ScheduleManager();
    }
    return ScheduleManager.instance;
  }

  private load(): void {
    this.schedules = readJsonSafe<Schedule[]>(SCHEDULES_FILE, []);
  }

  private async save(): Promise<void> {
    await writeJsonAtomic(SCHEDULES_FILE, this.schedules);
  }

  public getSchedules(siteSlug?: string): Schedule[] {
    if (siteSlug) {
      return this.schedules.filter(s => s.siteSlug === siteSlug);
    }
    return this.schedules;
  }

  public getScheduleById(id: string): Schedule | undefined {
    return this.schedules.find(s => s.id === id);
  }

  public async createSchedule(data: {
    siteSlug: string;
    cadence: Cadence;
    reportTypes: ReportType[];
    hour?: number;
    minute?: number;
  }): Promise<Schedule> {
    const now = getDetroitNowISO();
    const schedule: Schedule = {
      id: uuidv4(),
      siteSlug: data.siteSlug,
      cadence: data.cadence,
      reportTypes: data.reportTypes,
      hour: data.hour ?? 0,
      minute: data.minute ?? 0,
      enabled: true,
      startDate: now,
      createdAt: now,
      updatedAt: now,
      nextRunAt: '' // Will be computed below
    };

    schedule.nextRunAt = computeNextRunAt(schedule, now);
    
    this.schedules.push(schedule);
    await this.save();
    return schedule;
  }

  public async updateSchedule(id: string, updates: Partial<Pick<Schedule, 'cadence' | 'reportTypes' | 'hour' | 'minute' | 'enabled'>>): Promise<Schedule> {
    const index = this.schedules.findIndex(s => s.id === id);
    if (index === -1) {
      throw new Error(`Schedule ${id} not found`);
    }

    const now = getDetroitNowISO();
    const updated: Schedule = {
      ...this.schedules[index],
      ...updates,
      updatedAt: now
    };

    // If cadence or time changed, recompute nextRunAt
    if (updates.cadence || updates.hour !== undefined || updates.minute !== undefined) {
      updated.nextRunAt = computeNextRunAt(updated, now);
    }

    this.schedules[index] = updated;
    await this.save();
    return updated;
  }

  public async deleteSchedule(id: string): Promise<void> {
    this.schedules = this.schedules.filter(s => s.id !== id);
    await this.save();
  }

  public async markRunComplete(id: string): Promise<void> {
    const index = this.schedules.findIndex(s => s.id === id);
    if (index === -1) return;

    const now = getDetroitNowISO();
    const schedule = this.schedules[index];
    schedule.lastRunAt = now;
    schedule.nextRunAt = computeNextRunAt(schedule, now);
    schedule.updatedAt = now;

    await this.save();
  }
}





