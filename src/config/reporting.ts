/**
 * Reporting and Monitoring Configuration
 */
export const reportingConfig = {
  // Retention settings
  retention: {
    maxReportRunsPerSite: 10,     // Keep last 10 runs per site/type
    uptimeHistoryDays: 7,         // Keep 7 days of uptime points
    shareLinkExpiryDays: 30,      // Default share link expiry
  },

  // Runner timeouts
  timeouts: {
    lighthouse: 5 * 60 * 1000,    // 5 minutes
    securityAudit: 2 * 60 * 1000, // 2 minutes
  },

  // Monitoring settings
  uptime: {
    intervalMs: 5 * 60 * 1000,    // Check every 5 minutes
    concurrency: 3,               // Max parallel checks
    userAgent: 'KWD-UptimeMonitor/1.0',
    timeoutMs: 30 * 1000,         // HTTP timeout
  },

  // Scheduling settings
  scheduler: {
    tickIntervalMs: 60 * 1000,    // Check for due jobs every minute
    timezone: 'America/Detroit',  // Reference timezone for schedules
  }
};




