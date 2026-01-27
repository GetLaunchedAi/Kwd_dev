import * as path from 'path';
import { UptimePoint, UptimeSummary } from '../reports/contracts';
import { readJsonSafe, writeJsonAtomic } from '../storage/jsonStore';
import { getDetroitNowISO } from '../time/timeUtils';
import { DateTime } from 'luxon';

const UPTIME_DIR = path.join(process.cwd(), 'state', 'uptime');
const RETENTION_DAYS = 7;

export async function addUptimePoint(siteSlug: string, point: UptimePoint): Promise<void> {
  const filePath = path.join(UPTIME_DIR, `${siteSlug}.json`);
  const points = readJsonSafe<UptimePoint[]>(filePath, []);
  
  points.push(point);
  
  // Prune points older than RETENTION_DAYS
  const cutoff = DateTime.now().minus({ days: RETENTION_DAYS }).toJSDate();
  const filteredPoints = points.filter(p => new Date(p.timestamp) >= cutoff);
  
  await writeJsonAtomic(filePath, filteredPoints);
}

export function getUptimeSummary(siteSlug: string): UptimeSummary {
  const filePath = path.join(UPTIME_DIR, `${siteSlug}.json`);
  const points = readJsonSafe<UptimePoint[]>(filePath, []);
  
  const now = DateTime.now();
  const dayAgo = now.minus({ days: 1 }).toJSDate();
  const weekAgo = now.minus({ days: 7 }).toJSDate();

  const points24h = points.filter(p => new Date(p.timestamp) >= dayAgo);
  const points7d = points.filter(p => new Date(p.timestamp) >= weekAgo);

  const calculateStats = (pts: UptimePoint[]) => {
    if (pts.length === 0) return { uptime: 100, unknown: 0, avgLatency: 0 };

    const up = pts.filter(p => p.status === 'UP').length;
    const down = pts.filter(p => p.status === 'DOWN').length;
    const unknown = pts.filter(p => p.status === 'UNKNOWN').length;
    
    // Primary: UP / (UP + DOWN)
    const uptime = (up + down) > 0 ? (up / (up + down)) * 100 : 100;
    
    const latencyPoints = pts.filter(p => p.latencyMs > 0);
    const avgLatency = latencyPoints.length > 0 
      ? latencyPoints.reduce((acc, p) => acc + p.latencyMs, 0) / latencyPoints.length 
      : 0;

    return { uptime, unknown, avgLatency };
  };

  const stats24h = calculateStats(points24h);
  const stats7d = calculateStats(points7d);

  const lastDownPoint = points.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .find(p => p.status === 'DOWN');

  return {
    siteSlug,
    window24h: Math.round(stats24h.uptime * 100) / 100,
    window7d: Math.round(stats7d.uptime * 100) / 100,
    unknown24h: stats24h.unknown,
    unknown7d: stats7d.unknown,
    avgLatencyMs24h: Math.round(stats24h.avgLatency),
    avgLatencyMs7d: Math.round(stats7d.avgLatency),
    lastCheckedAt: points.length > 0 ? points[points.length - 1].timestamp : getDetroitNowISO(),
    lastDownAt: lastDownPoint?.timestamp
  };
}




