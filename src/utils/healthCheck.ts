import { existsSync } from 'fs';
import { spawnSync } from 'child_process';
import axios from 'axios';
import { config } from '../config/config';
import { logger } from './logger';

export interface ServiceHealth {
  status: 'healthy' | 'degraded' | 'unavailable' | 'not_configured';
  message?: string;
  latencyMs?: number;
  details?: Record<string, any>;
}

export interface HealthCheckResult {
  overall: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: {
    clickup: ServiceHealth;
    github: ServiceHealth;
    cursorAgent: ServiceHealth;
  };
}

/**
 * Checks GitHub API availability and authentication
 */
export async function checkGitHubHealth(): Promise<ServiceHealth> {
  const githubToken = config.git?.githubToken;
  
  if (!githubToken) {
    return {
      status: 'not_configured',
      message: 'GitHub token not configured'
    };
  }

  const startTime = Date.now();
  
  try {
    // Check rate limit endpoint - lightweight and always available
    const response = await axios.get('https://api.github.com/rate_limit', {
      headers: {
        'Authorization': `Bearer ${githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      timeout: 10000
    });

    const latencyMs = Date.now() - startTime;
    const rateLimit = response.data.rate;
    
    // Check if we're close to rate limit
    if (rateLimit.remaining < 100) {
      const resetDate = new Date(rateLimit.reset * 1000);
      return {
        status: 'degraded',
        message: `Low API rate limit: ${rateLimit.remaining} remaining until ${resetDate.toISOString()}`,
        latencyMs,
        details: {
          remaining: rateLimit.remaining,
          limit: rateLimit.limit,
          resetAt: resetDate.toISOString()
        }
      };
    }

    return {
      status: 'healthy',
      message: `API accessible (${rateLimit.remaining}/${rateLimit.limit} requests remaining)`,
      latencyMs,
      details: {
        remaining: rateLimit.remaining,
        limit: rateLimit.limit
      }
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    if (error.response?.status === 401) {
      return {
        status: 'unavailable',
        message: 'GitHub token is invalid or expired',
        latencyMs
      };
    }
    
    if (error.response?.status === 403) {
      return {
        status: 'degraded',
        message: 'GitHub API rate limited or token lacks permissions',
        latencyMs
      };
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'ETIMEDOUT') {
      return {
        status: 'unavailable',
        message: 'Cannot reach GitHub API',
        latencyMs
      };
    }

    logger.warn(`GitHub health check failed: ${error.message}`);
    return {
      status: 'unavailable',
      message: 'GitHub API check failed',
      latencyMs
    };
  }
}

/**
 * Checks Cursor agent availability and authentication
 */
export function checkCursorAgentHealth(): ServiceHealth {
  const startTime = Date.now();
  
  // Find the cursor-agent binary
  let agentCommand: string | null = null;
  
  // Check environment variable first
  if (process.env.CURSOR_AGENT_BIN && existsSync(process.env.CURSOR_AGENT_BIN)) {
    agentCommand = process.env.CURSOR_AGENT_BIN;
  } else {
    // Check common paths
    const candidatePaths = process.platform === 'win32'
      ? [
          `${process.env.LOCALAPPDATA}\\Programs\\cursor-agent\\cursor-agent.exe`,
          `${process.env.USERPROFILE}\\.cursor\\cursor-agent.exe`,
          'C:\\Program Files\\cursor-agent\\cursor-agent.exe',
        ]
      : [
          '/usr/local/bin/cursor-agent',
          `${process.env.HOME}/.cursor/cursor-agent`,
          `${process.env.HOME}/.local/bin/cursor-agent`,
        ];
    
    for (const path of candidatePaths) {
      if (existsSync(path)) {
        agentCommand = path;
        break;
      }
    }
    
    // Try which/where command
    if (!agentCommand) {
      try {
        const whichCmd = process.platform === 'win32' ? 'where cursor-agent' : 'which cursor-agent';
        const result = spawnSync(process.platform === 'win32' ? 'cmd' : 'sh', 
          process.platform === 'win32' ? ['/c', whichCmd] : ['-c', whichCmd],
          { encoding: 'utf8', timeout: 5000 }
        );
        if (result.status === 0 && result.stdout?.trim()) {
          agentCommand = result.stdout.trim().split('\n')[0];
        }
      } catch {
        // Ignore which failures
      }
    }
  }

  if (!agentCommand) {
    return {
      status: 'not_configured',
      message: 'Cursor agent binary not found. Install via: curl https://cursor.com/install -fsS | bash',
      latencyMs: Date.now() - startTime
    };
  }

  // Verify authentication with whoami
  try {
    const result = spawnSync(agentCommand, ['whoami'], {
      timeout: 15000,
      encoding: 'utf8',
    });
    
    const latencyMs = Date.now() - startTime;

    if (result.status === 0 && result.stdout?.trim()) {
      return {
        status: 'healthy',
        message: `Authenticated as: ${result.stdout.trim()}`,
        latencyMs,
        details: {
          user: result.stdout.trim(),
          binaryPath: agentCommand
        }
      };
    } else {
      const errorMsg = result.stderr?.trim() || result.stdout?.trim() || `Exit code ${result.status}`;
      return {
        status: 'degraded',
        message: `Agent found but not authenticated: ${errorMsg}. Run 'cursor-agent login' to authenticate.`,
        latencyMs,
        details: {
          binaryPath: agentCommand
        }
      };
    }
  } catch (err: any) {
    return {
      status: 'unavailable',
      message: `Failed to verify cursor-agent: ${err.message}`,
      latencyMs: Date.now() - startTime
    };
  }
}

/**
 * Checks ClickUp API availability
 */
export async function checkClickUpHealth(): Promise<ServiceHealth> {
  const startTime = Date.now();
  
  try {
    const { getAccessToken } = await import('../clickup/oauthService');
    const accessToken = await getAccessToken();
    
    if (!accessToken) {
      return {
        status: 'not_configured',
        message: 'ClickUp not connected. Please connect via OAuth.',
        latencyMs: Date.now() - startTime
      };
    }

    const { clickUpApiClient } = await import('../clickup/apiClient');
    const user = await clickUpApiClient.getAuthenticatedUser();
    
    return {
      status: 'healthy',
      message: `Connected as: ${user.username || user.email}`,
      latencyMs: Date.now() - startTime,
      details: {
        userId: user.id,
        username: user.username,
        email: user.email
      }
    };
  } catch (error: any) {
    const latencyMs = Date.now() - startTime;
    
    if (error.message?.includes('token') || error.response?.status === 401) {
      return {
        status: 'degraded',
        message: 'ClickUp token expired or invalid. Please reconnect.',
        latencyMs
      };
    }

    logger.warn(`ClickUp health check failed: ${error.message}`);
    return {
      status: 'unavailable',
      message: 'ClickUp API check failed',
      latencyMs
    };
  }
}

/**
 * Performs a comprehensive health check of all external services
 */
export async function performFullHealthCheck(): Promise<HealthCheckResult> {
  // Run checks in parallel for speed
  const [clickup, github, cursorAgent] = await Promise.all([
    checkClickUpHealth(),
    checkGitHubHealth(),
    Promise.resolve(checkCursorAgentHealth()) // Sync function wrapped in promise
  ]);

  // Determine overall health
  const services = { clickup, github, cursorAgent };
  const statuses = Object.values(services).map(s => s.status);
  
  let overall: 'healthy' | 'degraded' | 'unhealthy';
  
  if (statuses.every(s => s === 'healthy' || s === 'not_configured')) {
    overall = 'healthy';
  } else if (statuses.some(s => s === 'unavailable')) {
    overall = 'unhealthy';
  } else {
    overall = 'degraded';
  }

  return {
    overall,
    timestamp: new Date().toISOString(),
    services
  };
}

