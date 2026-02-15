import { DateTime } from 'luxon';
import { Schedule } from '../reports/contracts';

const TIMEZONE = 'America/Detroit';

/**
 * Computes the next run time for a given schedule.
 * Handles:
 * - America/Detroit timezone
 * - DST transitions
 * - Monthly clamping and restoration (e.g., Jan 31 -> Feb 28 -> Mar 31)
 * 
 * @param schedule The schedule object
 * @param baseTime The time to calculate from (defaults to now)
 */
export function computeNextRunAt(schedule: Schedule, baseTime: string | Date = new Date()): string {
  const zone = TIMEZONE;
  const now = typeof baseTime === 'string' ? DateTime.fromISO(baseTime).setZone(zone) : DateTime.fromJSDate(baseTime).setZone(zone);
  const start = DateTime.fromISO(schedule.startDate).setZone(zone);
  
  // The target hour/minute from schedule
  const targetHour = schedule.hour;
  const targetMinute = schedule.minute;

  if (schedule.cadence === 'biweekly') {
    // Bi-weekly is simpler: every 14 days from start date
    let next = start.set({ hour: targetHour, minute: targetMinute, second: 0, millisecond: 0 });
    
    // Increment by 2 weeks until we are after 'now'
    while (next.toMillis() <= now.toMillis()) {
      next = next.plus({ weeks: 2 });
    }
    return next.toISO() || next.toJSDate().toISOString();
  } else {
    // Monthly: add N months to start date
    let monthsToAdd = 0;
    let next = start.set({ hour: targetHour, minute: targetMinute, second: 0, millisecond: 0 });

    // Find the first occurrence after 'now'
    while (next.toMillis() <= now.toMillis()) {
      monthsToAdd++;
      next = start.plus({ months: monthsToAdd }).set({ hour: targetHour, minute: targetMinute, second: 0, millisecond: 0 });
    }
    
    return next.toISO() || next.toJSDate().toISOString();
  }
}

/**
 * Checks if a schedule is overdue for a run.
 */
export function isOverdue(nextRunAt: string): boolean {
  if (!nextRunAt) return false;
  const now = DateTime.now().toMillis();
  const next = DateTime.fromISO(nextRunAt).toMillis();
  return next <= now;
}

/**
 * Gets the current time in Detroit as a JS Date.
 */
export function getDetroitNow(): Date {
  return DateTime.now().setZone(TIMEZONE).toJSDate();
}

/**
 * Gets the current time in Detroit as an ISO string.
 */
export function getDetroitNowISO(): string {
  return DateTime.now().setZone(TIMEZONE).toISO() || new Date().toISOString();
}

/**
 * Normalize a domain string to a full URL.
 */
export function normalizeDomainToUrl(domain: string): string {
  let normalized = domain.trim();
  if (!normalized) return '';

  // If it starts with http:// or https://, leave it mostly alone
  if (!/^https?:\/\//i.test(normalized)) {
    normalized = `https://${normalized}`;
  }

  try {
    const url = new URL(normalized);
    // Ensure it has at least a hostname
    if (!url.hostname) return normalized;
    return url.toString();
  } catch (e) {
    // If URL parsing fails, return as is (Track 4 will handle validation)
    return normalized;
  }
}





