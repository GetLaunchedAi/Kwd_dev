export type ReportType = 'performance' | 'security';
export type Cadence = 'biweekly' | 'monthly';

export interface ReportRunMeta {
  runId: string;
  siteSlug: string;
  reportType: ReportType;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt: string; // ISO date
  finishedAt?: string; // ISO date
  trigger: 'manual' | 'scheduled';
  error?: string;
}

export interface ReportJob {
  jobId: string;
  siteSlug: string;
  reportType: ReportType;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'timeout';
  startedAt?: string; // ISO date
  finishedAt?: string; // ISO date
  error?: string;
  dedupeKey?: string;
}

export interface ShareLink {
  token: string;
  siteSlug: string;
  runId: string;
  reportType: ReportType;
  expiresAt: string; // ISO date
  publicView: boolean;
  createdAt?: string; // ISO date
}

export interface Schedule {
  id: string;
  siteSlug: string;
  cadence: Cadence;
  reportTypes: ReportType[];
  hour: number; // 0-23
  minute: number; // 0-59
  enabled: boolean;
  lastRunAt?: string; // ISO date
  nextRunAt: string; // ISO date
  startDate: string; // ISO date (used as base for monthly/biweekly calculations)
  createdAt?: string; // ISO date
  updatedAt?: string; // ISO date
}

export interface UptimePoint {
  timestamp: string; // ISO date
  status: 'UP' | 'DOWN' | 'UNKNOWN';
  latencyMs: number;
  httpStatus?: number;
  finalUrl?: string;
  error?: string;
}

export interface UptimeSummary {
  window24h: number; // percentage
  window7d: number; // percentage
  unknown24h: number;
  unknown7d: number;
  avgLatencyMs24h: number;
  avgLatencyMs7d: number;
  lastCheckedAt: string;
  lastDownAt?: string;
  siteSlug: string;
}





