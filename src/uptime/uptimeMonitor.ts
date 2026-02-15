import axios from 'axios';
import { findAllClients } from '../utils/clientScanner';
import { resolveSiteUrl } from './domainResolver';
import { addUptimePoint } from './uptimeStore';
import { UptimePoint } from '../reports/contracts';
import { getDetroitNowISO } from '../time/timeUtils';
import { logger } from '../utils/logger';
import { reportingConfig } from '../config/reporting';

const { intervalMs, concurrency, userAgent, timeoutMs } = reportingConfig.uptime;

export class UptimeMonitor {
  private static interval: NodeJS.Timeout | null = null;
  private static isRunning = false;

  static async start() {
    if (this.interval) return;
    
    logger.info('Starting Uptime Monitor...');
    
    // Run immediately on start
    this.checkAllSites();
    
    this.interval = setInterval(() => {
      this.checkAllSites();
    }, intervalMs);
  }

  static stop() {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private static async checkAllSites() {
    if (this.isRunning) {
      logger.warn('Uptime check already in progress, skipping this tick.');
      return;
    }

    this.isRunning = true;
    try {
      const clients = await findAllClients();
      
      // Process in chunks to respect concurrency limit
      for (let i = 0; i < clients.length; i += concurrency) {
        const chunk = clients.slice(i, i + concurrency);
        await Promise.all(chunk.map(client => this.checkSite(client.name)));
      }
    } catch (err) {
      logger.error('Error in uptime monitor loop:', err);
    } finally {
      this.isRunning = false;
    }
  }

  private static async checkSite(siteSlug: string) {
    const url = await resolveSiteUrl(siteSlug);
    
    if (!url) {
      // UNCONFIGURED sites are skipped as per plan 4.1
      return;
    }

    const start = Date.now();
    const point: UptimePoint = {
      timestamp: getDetroitNowISO(),
      status: 'UNKNOWN',
      latencyMs: 0,
    };

    try {
      const response = await axios.get(url, {
        timeout: timeoutMs,
        headers: {
          'User-Agent': userAgent,
        },
        validateStatus: () => true, // Don't throw on error status codes
      });

      point.latencyMs = Date.now() - start;
      point.httpStatus = response.status;
      point.finalUrl = response.request?.res?.responseUrl || url;

      if (response.status >= 200 && response.status < 400) {
        point.status = 'UP';
      } else {
        point.status = 'DOWN';
        point.error = `HTTP ${response.status}`;
      }
    } catch (err: any) {
      point.latencyMs = Date.now() - start;
      point.status = 'UNKNOWN';
      point.error = err.message;
      
      // If it's a known error like 4xx/5xx that axios normally throws on, 
      // but we set validateStatus to true, so we mostly get network errors here.
      if (err.response) {
        point.status = 'DOWN';
        point.httpStatus = err.response.status;
        point.error = `HTTP ${err.response.status}: ${err.message}`;
      } else if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT') {
        point.error = 'Timeout';
      }
    }

    await addUptimePoint(siteSlug, point);
  }
}

export const uptimeMonitor = UptimeMonitor;





