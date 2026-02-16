import express, { Request, Response } from 'express';
import * as path from 'path';
import * as fs from 'fs-extra';
import { config } from './config/config';
import { logger } from './utils/logger';
import { processWebhookEvent } from './clickup/webhookHandler';
import { processTask } from './workflow/workflowOrchestrator';
import { continueWorkflowAfterAgent } from './workflow/workflowOrchestrator';
import { completeWorkflowAfterApproval } from './workflow/workflowOrchestrator';
import { approveRequest, rejectRequest, getApprovalRequest } from './approval/approvalManager';
import { findAllTasks, findTaskById } from './utils/taskScanner';
import { findAllClients } from './utils/clientScanner';
import { generateChangeSummary } from './approval/changeSummarizer';
import { loadTaskState, WorkflowState, TaskInfo } from './state/stateManager';
import { ClickUpTask } from './clickup/apiClient';
import { getAuthorizationUrl, exchangeCodeForToken, generateState, getAccessToken, storeOAuthState, verifyOAuthState } from './clickup/oauthService';
import { importTask, previewTaskImport } from './handlers/taskImportHandler';
import { createDemo, getDemoStatus, isSlugAvailable, demoStatusManager, DemoStatus } from './handlers/demoHandler';
import { getSystemPrompts, saveSystemPrompts, getPromptBackups, restorePromptBackup, initSystemPromptsDirectories } from './handlers/systemPromptsHandler';
import { taskStatusManager } from './cursor/taskStatusManager';
import { webhookStateManager } from './state/webhookState';
import { writeJsonAtomic } from './storage/jsonStore';
import { loadConfig } from './config/config';
import { validateModel, validateModelFields } from './utils/modelValidator';
import multer from 'multer';

// Reporting and Monitoring Routers
import reportRoutes from './routes/reportRoutes';
import shareRoutes from './routes/shareRoutes';
import scheduleRoutes from './routes/scheduleRoutes';
import uptimeRoutes from './routes/uptimeRoutes';

const app = express();

// Trust proxy when running behind reverse proxy (Apache/Nginx on Cloudways)
// This ensures req.ip returns actual client IP, req.secure works correctly for HTTPS detection
if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}

// In-memory cache for failed imports (persists during server runtime)
interface FailedImport {
  taskId: string;
  taskName: string;
  clickUpUrl?: string;
  error: string;
  timestamp: string;
  suggestions?: string[];
}

const failedImportsCache: Map<string, FailedImport> = new Map();

// Config update mutex to prevent race conditions during concurrent settings updates
let configUpdateLock: Promise<void> = Promise.resolve();

/**
 * Acquires a lock for config updates, ensuring sequential processing.
 * This prevents race conditions when multiple concurrent settings updates occur.
 */
async function acquireConfigLock<T>(operation: () => Promise<T>): Promise<T> {
  // Chain this operation after any pending config updates
  const previousLock = configUpdateLock;
  let releaseLock: () => void;
  
  // Create new lock that will resolve when this operation completes
  configUpdateLock = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  
  try {
    // Wait for any previous update to complete
    await previousLock;
    // Execute this operation
    return await operation();
  } finally {
    // Release lock for next operation
    releaseLock!();
  }
}

// SSE Connection Management for proper cleanup
interface SSEConnection {
  id: string;
  taskId: string;
  intervals: NodeJS.Timeout[];
  timeouts: NodeJS.Timeout[];
  res: Response;
  closed: boolean;
  lastActivity: number;
}

const activeSSEConnections: Map<string, SSEConnection> = new Map();
let sseConnectionCounter = 0;
const SSE_HEARTBEAT_INTERVAL = 30000; // 30 seconds
const SSE_CONNECTION_TIMEOUT = 300000; // 5 minutes of inactivity

// SSE Helper: Create safe send function with liveness check
function createSafeSendEvent(conn: SSEConnection) {
  return (data: any | string, eventData?: any) => {
    if (conn.closed) {
      logger.debug(`SSE ${conn.id}: Attempted send after close`);
      return false;
    }
    
    try {
      if (typeof data === 'string' && eventData !== undefined) {
        // Named event format: sendEvent('eventType', data)
        conn.res.write(`event: ${data}\ndata: ${JSON.stringify(eventData)}\n\n`);
      } else {
        // Simple data format: sendEvent({ type: 'status', ... })
        conn.res.write(`data: ${JSON.stringify(data)}\n\n`);
      }
      conn.lastActivity = Date.now();
      return true;
    } catch (err: any) {
      logger.debug(`SSE ${conn.id}: Send failed - ${err.message}`);
      cleanupSSEConnection(conn.id);
      return false;
    }
  };
}

// SSE Helper: Clean up a connection and all its intervals
function cleanupSSEConnection(connId: string) {
  const conn = activeSSEConnections.get(connId);
  if (!conn) return;
  
  conn.closed = true;
  
  // Clear all intervals
  conn.intervals.forEach(interval => {
    try { clearInterval(interval); } catch {}
  });
  
  // Clear all timeouts
  conn.timeouts.forEach(timeout => {
    try { clearTimeout(timeout); } catch {}
  });
  
  // End response if still open
  try {
    if (!conn.res.writableEnded) {
      conn.res.end();
    }
  } catch {}
  
  activeSSEConnections.delete(connId);
  logger.debug(`SSE ${connId}: Connection cleaned up (${activeSSEConnections.size} active)`);
}

// SSE Helper: Register an interval for cleanup tracking
function registerSSEInterval(connId: string, interval: NodeJS.Timeout) {
  const conn = activeSSEConnections.get(connId);
  if (conn) {
    conn.intervals.push(interval);
  }
}

// SSE Helper: Register a timeout for cleanup tracking
function registerSSETimeout(connId: string, timeout: NodeJS.Timeout) {
  const conn = activeSSEConnections.get(connId);
  if (conn) {
    conn.timeouts.push(timeout);
  }
}

// Global heartbeat for all SSE connections (detect stale connections)
const globalHeartbeatInterval = setInterval(() => {
  const now = Date.now();
  for (const [connId, conn] of activeSSEConnections) {
    // Check for stale connections
    if (now - conn.lastActivity > SSE_CONNECTION_TIMEOUT) {
      logger.debug(`SSE ${connId}: Connection timed out due to inactivity`);
      cleanupSSEConnection(connId);
      continue;
    }
    
    // Send heartbeat
    try {
      if (!conn.closed && !conn.res.writableEnded) {
        conn.res.write(`:heartbeat\n\n`);
      }
    } catch {
      cleanupSSEConnection(connId);
    }
  }
}, SSE_HEARTBEAT_INTERVAL);

// Helper function to track failed import
function trackFailedImport(taskId: string, taskName: string, error: string, clickUpUrl?: string, suggestions?: string[]) {
  failedImportsCache.set(taskId, {
    taskId,
    taskName,
    clickUpUrl,
    error,
    timestamp: new Date().toISOString(),
    suggestions,
  });
}

// Middleware
app.use(express.json());

// Multer configuration for demo creation
const uploadDir = path.join(process.cwd(), 'temp-uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req: any, file: any, cb: any) => {
    cb(null, 'temp-uploads/');
  },
  filename: (req: any, file: any, cb: any) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ 
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50MB limit per file for folder uploads
  }
});


// Serve static files from public directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));
app.use('/screenshots', express.static(path.join(publicDir, 'screenshots')));

// Serve client-websites static files (production demos)
// This serves the built /public/ folder from each demo directory
// with path rewriting for absolute asset URLs in HTML files
const clientWebsitesDir = path.join(process.cwd(), 'client-websites');

/**
 * Rewrites absolute paths in HTML content to include the demo base path.
 * Transforms paths like /images/... to /client-websites/{slug}/images/...
 * 
 * This handles:
 * - src="/..." attributes (images, scripts)
 * - href="/..." attributes (stylesheets, links)
 * - srcset="/..." attributes (responsive images)
 * - url(/...) in inline styles
 * - content="/..." in meta tags
 * 
 * Excludes:
 * - External URLs (http://, https://, //)
 * - Data URIs (data:)
 * - Already-prefixed paths (/client-websites/)
 * - API paths (/api/)
 * - Auth paths (/auth/)
 */
function rewriteHtmlPaths(html: string, basePath: string): string {
  // Patterns to match absolute paths that need rewriting
  // Using negative lookahead to exclude already-prefixed and external paths
  
  // Match src="/...", href="/...", content="/...", poster="/...", data-src="/...", data-srcset="/..."
  // NOTE: srcset is handled separately below due to its multi-URL format
  // Captures: (attribute)="/path"
  const attrPattern = /((?:src|href|content|poster|data-src)\s*=\s*["'])\/(?!\/|client-websites\/|api\/|auth\/|screenshots\/)([^"']*["'])/gi;
  
  // Match url(/...) in inline styles
  const urlPattern = /(url\s*\(\s*["']?)\/(?!\/|client-websites\/|api\/|auth\/|data:)([^"')\s]+["']?\s*\))/gi;
  
  // Rewrite attribute paths (excluding srcset)
  let rewritten = html.replace(attrPattern, (match, prefix, pathAndQuote) => {
    return `${prefix}${basePath}/${pathAndQuote}`;
  });
  
  // Rewrite url() paths in inline styles
  rewritten = rewritten.replace(urlPattern, (match, prefix, pathAndParen) => {
    return `${prefix}${basePath}/${pathAndParen}`;
  });
  
  // Handle srcset separately - it can have multiple URLs with width/density descriptors
  // e.g., srcset="/images/small.jpg 400w, /images/large.jpg 800w"
  // Need to rewrite each URL individually while preserving descriptors
  rewritten = rewritten.replace(
    /(srcset\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, srcsetValue, suffix) => {
      // Split by comma to handle each URL+descriptor pair
      const rewrittenSrcset = srcsetValue
        .split(',')
        .map((entry: string) => {
          const trimmed = entry.trim();
          // Only rewrite if starts with / and not // (protocol-relative) or already prefixed
          // Also check it's not http:// or https://
          if (trimmed.startsWith('/') && 
              !trimmed.startsWith('//') && 
              !trimmed.startsWith('/client-websites/') &&
              !trimmed.startsWith('/api/') &&
              !trimmed.startsWith('/auth/')) {
            return `${basePath}${trimmed}`;
          }
          return trimmed;
        })
        .join(', ');
      return `${prefix}${rewrittenSrcset}${suffix}`;
    }
  );
  
  // Also handle data-srcset (lazy loading)
  rewritten = rewritten.replace(
    /(data-srcset\s*=\s*["'])([^"']+)(["'])/gi,
    (match, prefix, srcsetValue, suffix) => {
      const rewrittenSrcset = srcsetValue
        .split(',')
        .map((entry: string) => {
          const trimmed = entry.trim();
          if (trimmed.startsWith('/') && 
              !trimmed.startsWith('//') && 
              !trimmed.startsWith('/client-websites/') &&
              !trimmed.startsWith('/api/') &&
              !trimmed.startsWith('/auth/')) {
            return `${basePath}${trimmed}`;
          }
          return trimmed;
        })
        .join(', ');
      return `${prefix}${rewrittenSrcset}${suffix}`;
    }
  );
  
  return rewritten;
}

/**
 * Rewrites absolute paths in CSS content to include the demo base path.
 * Transforms url(/...) references to url(/client-websites/{slug}/...)
 * 
 * This handles:
 * - url(/...) for backgrounds, fonts, etc.
 * - url("/...") and url('/...') quoted variants
 * - @import "/..."; statements
 * 
 * Excludes:
 * - External URLs (http://, https://, //)
 * - Data URIs (data:)
 * - Already-prefixed paths (/client-websites/)
 */
function rewriteCssPaths(css: string, basePath: string): string {
  // Match url(/...) patterns (with or without quotes)
  // Captures url( followed by optional quote, then absolute path
  const urlPattern = /(url\s*\(\s*)(["']?)\/(?!\/|client-websites\/|data:)([^"')\s]+)(["']?\s*\))/gi;
  
  let rewritten = css.replace(urlPattern, (match, prefix, openQuote, urlPath, suffix) => {
    return `${prefix}${openQuote}${basePath}/${urlPath}${suffix}`;
  });
  
  // Match @import "/..." statements
  const importPattern = /(@import\s+)(["'])\/(?!\/|client-websites\/)([^"']+)(["'])/gi;
  
  rewritten = rewritten.replace(importPattern, (match, importKeyword, openQuote, importPath, closeQuote) => {
    return `${importKeyword}${openQuote}${basePath}/${importPath}${closeQuote}`;
  });
  
  return rewritten;
}

app.use('/client-websites', async (req: Request, res: Response, next) => {
  // Extract slug from path: /client-websites/apex-plumbing/...
  const pathParts = req.path.split('/').filter(Boolean);
  if (pathParts.length === 0) {
    return res.status(404).send('Not Found');
  }
  
  // Normalize slug to lowercase for case-insensitive matching
  // This allows /client-websites/Apex-Plumbing/ to work the same as /client-websites/apex-plumbing/
  const slug = pathParts[0].toLowerCase();
  
  // Security: validate slug format (only lowercase letters, numbers, and hyphens)
  const slugRegex = /^[a-z0-9-]+$/;
  if (!slugRegex.test(slug)) {
    return res.status(400).send('Invalid slug format');
  }
  
  const demoPublicDir = path.join(clientWebsitesDir, slug, 'public');
  
  // Security: ensure path is within client-websites directory (prevent traversal)
  const resolvedDemoDir = path.resolve(demoPublicDir);
  const resolvedBaseDir = path.resolve(clientWebsitesDir);
  if (!resolvedDemoDir.startsWith(resolvedBaseDir)) {
    return res.status(403).send('Forbidden');
  }
  
  // Check if public folder exists (built demo)
  if (!fs.existsSync(demoPublicDir)) {
    return res.status(404).send(`Demo '${slug}' not found or not built yet. Run 'npm run build' in the demo directory.`);
  }
  
  // Determine the relative path within the public folder
  let relativePath = pathParts.slice(1).join('/') || 'index.html';
  let filePath = path.join(demoPublicDir, relativePath);
  
  // Security: ensure file path is within the public directory
  let resolvedFilePath = path.resolve(filePath);
  if (!resolvedFilePath.startsWith(resolvedDemoDir)) {
    return res.status(403).send('Forbidden');
  }
  
  // Handle clean URLs and SPA routing - find the actual file
  let actualFilePath = resolvedFilePath;
  
  // Check if path exists and whether it's a file or directory
  const pathExists = fs.existsSync(actualFilePath);
  const isDirectory = pathExists && fs.statSync(actualFilePath).isDirectory();
  const isFile = pathExists && fs.statSync(actualFilePath).isFile();
  
  if (!isFile) {
    // If it's a directory, look for index.html inside it
    if (isDirectory) {
      const indexPath = path.join(resolvedFilePath, 'index.html');
      if (fs.existsSync(indexPath) && indexPath.startsWith(resolvedDemoDir)) {
        actualFilePath = indexPath;
      } else {
        return next();
      }
    } else if (!path.extname(relativePath)) {
      // No file extension - try .html extension first, then directory/index.html
      const htmlPath = resolvedFilePath + '.html';
      if (fs.existsSync(htmlPath) && htmlPath.startsWith(resolvedDemoDir)) {
        actualFilePath = htmlPath;
      } else {
        // Try index.html in a directory with that name
        const indexPath = path.join(resolvedFilePath, 'index.html');
        if (fs.existsSync(indexPath) && indexPath.startsWith(resolvedDemoDir)) {
          actualFilePath = indexPath;
        } else {
          return next();
        }
      }
    } else {
      return next();
    }
  }
  
  // Set no-cache headers to ensure users always see latest version
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // Determine file type for path rewriting
  const ext = path.extname(actualFilePath).toLowerCase();
  const isHtml = ext === '.html' || ext === '.htm';
  const isCss = ext === '.css';
  const basePath = `/client-websites/${slug}`;
  
  if (isHtml) {
    // Read HTML file, rewrite paths, then send
    try {
      const htmlContent = await fs.promises.readFile(actualFilePath, 'utf-8');
      const rewrittenHtml = rewriteHtmlPaths(htmlContent, basePath);
      
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(rewrittenHtml);
    } catch (readError: any) {
      logger.error(`Error reading HTML file ${actualFilePath}: ${readError.message}`);
      return next();
    }
  } else if (isCss) {
    // Read CSS file, rewrite paths, then send
    try {
      const cssContent = await fs.promises.readFile(actualFilePath, 'utf-8');
      const rewrittenCss = rewriteCssPaths(cssContent, basePath);
      
      res.setHeader('Content-Type', 'text/css; charset=utf-8');
      res.send(rewrittenCss);
    } catch (readError: any) {
      logger.error(`Error reading CSS file ${actualFilePath}: ${readError.message}`);
      return next();
    }
  } else {
    // For non-HTML/CSS files (images, JS, fonts, etc.), serve directly
    res.sendFile(actualFilePath, (err) => {
      if (err) {
        next();
      }
    });
  }
});

// Health check endpoint - comprehensive check of all external services
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const { performFullHealthCheck } = await import('./utils/healthCheck');
    const healthResult = await performFullHealthCheck();
    
    // Return 200 for healthy/degraded, 503 for unhealthy
    const statusCode = healthResult.overall === 'unhealthy' ? 503 : 200;
    
    // Map health check status to frontend-expected status format
    // Frontend expects: 'connected', 'disconnected', 'expired', 'offline'
    const clickupService = healthResult.services.clickup;
    let clickupStatus: string;
    switch (clickupService.status) {
      case 'healthy':
        clickupStatus = 'connected';
        break;
      case 'degraded':
        clickupStatus = 'expired';
        break;
      case 'unavailable':
      case 'not_configured':
      default:
        clickupStatus = 'disconnected';
        break;
    }
    
    // Build user object from details if available
    const clickupUser = clickupService.details ? {
      username: clickupService.details.username || clickupService.details.email,
      email: clickupService.details.email,
      id: clickupService.details.userId
    } : undefined;
    
    res.status(statusCode).json({
      status: healthResult.overall,
      timestamp: healthResult.timestamp,
      services: healthResult.services,
      // Backwards-compatible format for frontend connection status display
      clickup: {
        status: clickupStatus,
        user: clickupUser,
        message: clickupService.message
      }
    });
  } catch (error: any) {
    logger.error(`Health check error: ${error.message}`);
    res.status(500).json({ status: 'error', error: 'Health check failed', clickup: { status: 'offline' } });
  }
});

// Basic health check endpoint (kept for simplicity)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Webhook control endpoints
app.get('/api/webhook/status', async (req: Request, res: Response) => {
  try {
    const state = webhookStateManager.getState();
    res.json(state);
  } catch (error: any) {
    logger.error(`Error getting webhook status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Git status endpoint
app.get('/api/git/status', async (req: Request, res: Response) => {
  try {
    const { folder } = req.query;
    const { checkGitStatus } = await import('./git/repoManager');
    const result = await checkGitStatus(folder as string | undefined);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json(result);
    }
  } catch (error: any) {
    logger.error(`Error checking git status: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post('/api/webhook/toggle', async (req: Request, res: Response) => {
  try {
    const newState = await webhookStateManager.toggle('dashboard');
    // Include both 'enabled' (original) and 'state' (for test compatibility)
    res.json({ 
      enabled: newState,
      state: newState,
      message: `Webhook ${newState ? 'enabled' : 'disabled'}`
    });
  } catch (error: any) {
    logger.error(`Error toggling webhook: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webhook/enable', async (req: Request, res: Response) => {
  try {
    await webhookStateManager.enable('dashboard');
    res.json({ 
      enabled: true,
      message: 'Webhook enabled'
    });
  } catch (error: any) {
    logger.error(`Error enabling webhook: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/webhook/disable', async (req: Request, res: Response) => {
  try {
    await webhookStateManager.disable('dashboard');
    res.json({ 
      enabled: false, 
      message: 'Webhook disabled'
    });
  } catch (error: any) {
    logger.error(`Error disabling webhook: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Test GitHub Repository URL endpoint
app.post('/api/git/test-repo', async (req: Request, res: Response) => {
  try {
    const { url, githubRepoUrl } = req.body;
    const repoUrlParam = url || githubRepoUrl;
    if (!repoUrlParam) {
      return res.status(400).json({ success: false, error: 'URL or githubRepoUrl is required' });
    }

    let repoUrl = repoUrlParam.trim();
    // Normalize URL for testing
    if (repoUrl.startsWith('git@github.com:')) {
      repoUrl = 'https://github.com/' + repoUrl.split(':')[1].replace('.git', '');
    } else if (!repoUrl.startsWith('http')) {
      repoUrl = 'https://' + repoUrl.replace(/^(www\.)?/, '');
    }

    logger.info(`Testing repository accessibility: ${repoUrl}`);

    const axios = (await import('axios')).default;
    const { getAccessToken } = await import('./clickup/oauthService');
    const token = await getAccessToken(); // This might be ClickUp token, we need GitHub token if private

    try {
      // GitHub requires a User-Agent header for all requests, otherwise it returns 403
      // Using GET instead of HEAD as some servers/proxies handle them differently
      const response = await axios.get(repoUrl, {
        timeout: 5000,
        headers: {
          'User-Agent': 'KWD-Dev-App/1.0.0'
        },
        validateStatus: (status) => status < 400
      });
      
      // Clean up trailing slashes before splitting to get the correct name
      const repoName = repoUrl.replace(/\/$/, '').split('/').pop() || 'Repository';
      return res.json({ success: true, repoName });
    } catch (error: any) {
      // If public check fails, it might be private or invalid
      logger.warn(`Public check failed for ${repoUrl}: ${error.message}`);
      
      // We could try with GitHub token here if we have one configured
      // For now, if public check fails, we report it as inaccessible
      res.status(404).json({ 
        success: false, 
        error: 'Repository not found or is private. Only public repositories are supported for demo creation currently.' 
      });
    }
  } catch (error: any) {
    logger.error(`Error testing repo: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// OAuth endpoints
app.get('/auth/clickup', async (req: Request, res: Response) => {
  try {
    const state = generateState();
    storeOAuthState(state); // Store state for CSRF verification
    const authUrl = getAuthorizationUrl(state);
    
    // Use 302 redirect explicitly for test compatibility
    res.redirect(302, authUrl);
  } catch (error: any) {
    logger.error(`Error initiating OAuth flow: ${error.message}`);
    // Return 500 status (not 200) when OAuth initiation fails
    res.status(500).send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body>
          <h1>Error</h1>
          <p>${error.message}</p>
          <p>Make sure CLICKUP_CLIENT_ID and CLICKUP_REDIRECT_URI are set in your .env file.</p>
        </body>
      </html>
    `);
  }
});

app.get('/auth/clickup/callback', async (req: Request, res: Response) => {
  try {
    const { code, error, state } = req.query;

    // Check for error parameter first (takes precedence over code)
    if (error) {
      logger.error(`OAuth error: ${error}`);
      return res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p><a href="/auth/clickup">Try again</a></p>
          </body>
        </html>
      `);
    }

    // Verify OAuth state to prevent CSRF attacks
    if (state && typeof state === 'string') {
      if (!verifyOAuthState(state)) {
        logger.warn('OAuth callback received with invalid or expired state');
        return res.status(400).send(`
          <html>
            <head><title>Invalid State</title></head>
            <body>
              <h1>Authorization Failed</h1>
              <p>Invalid or expired OAuth state. This may be a CSRF attack or your session expired.</p>
              <p><a href="/auth/clickup">Try again</a></p>
            </body>
          </html>
        `);
      }
    }

    if (!code || typeof code !== 'string') {
      logger.warn('OAuth callback accessed without authorization code');
      return res.status(400).send(`
        <html>
          <head><title>Authorization Required</title></head>
          <body>
            <h1>Authorization Required</h1>
            <p>This endpoint requires an authorization code from ClickUp's OAuth flow.</p>
            <p>To authorize this application, please start at: <a href="/auth/clickup">/auth/clickup</a></p>
            <p><strong>Note:</strong> This endpoint cannot be tested directly in a browser without completing the OAuth flow.</p>
          </body>
        </html>
      `);
    }

    logger.info('Received authorization code, exchanging for token...');
    const tokenResponse = await exchangeCodeForToken(code);

    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
            .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="success">
            <h1>✅ Authorization Successful!</h1>
            <p>Your ClickUp app has been authorized successfully.</p>
            <p>The access token has been saved and will be used for API calls.</p>
            <p>You can now close this window.</p>
            <a href="/" class="button">Go to Dashboard</a>
          </div>
        </body>
      </html>
    `);

    logger.info('OAuth flow completed successfully');
  } catch (error: any) {
    logger.error(`Error in OAuth callback: ${error.message}`);
    // Return 400 for invalid/expired authorization codes (client error, not server error)
    const isInvalidCode = error.response?.status === 400 || error.response?.status === 401 || 
                          error.message?.includes('invalid') || error.message?.includes('expired');
    const statusCode = isInvalidCode ? 400 : 500;
    res.status(statusCode).send(`
      <html>
        <head><title>Authorization Error</title></head>
        <body>
          <h1>Authorization Error</h1>
          <p>${error.message}</p>
          <p><a href="/auth/clickup">Try again</a></p>
        </body>
      </html>
    `);
  }
});

// ClickUp webhook endpoint
app.post('/webhook/clickup', async (req: Request, res: Response) => {
  try {
    logger.info('Received ClickUp webhook');
    
    // Check if webhook is enabled
    if (!webhookStateManager.isEnabled()) {
      logger.info('Webhook is disabled, ignoring event');
      return res.status(200).json({ message: 'Webhook is currently disabled' });
    }
    
    const processedEvent = await processWebhookEvent(req);
    
    if (!processedEvent) {
      logger.debug('Webhook event not processed (not matching trigger criteria)');
      return res.status(200).json({ message: 'Event received but not processed' });
    }

    // Process task asynchronously
    processTask(processedEvent.task).catch((error: any) => {
      logger.error(`Error processing task ${processedEvent.taskId}: ${error.message}`);
    });

    // Respond immediately to ClickUp
    res.status(200).json({ message: 'Webhook received and processing started' });
  } catch (error: any) {
    logger.error(`Error handling webhook: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Demo Creation Endpoints
app.get('/api/demo/check-slug', async (req: Request, res: Response) => {
  try {
    const { slug } = req.query;
    if (!slug || typeof slug !== 'string') {
      return res.status(400).json({ available: false, error: 'Slug is required' });
    }
    const result = await isSlugAvailable(slug);
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ available: false, error: error.message });
  }
});

app.post('/api/demo/create', upload.fields([
  { name: 'logo', maxCount: 1 },
  { name: 'heroImage', maxCount: 1 }
]), async (req: Request, res: Response) => {
  try {
    const { businessName, clientSlug, templateId, githubRepoUrl, primaryColor, aiModel, step1Model, step2Model, step3Model, step4Model } = req.body;

    // Early validation
    if (!businessName || !primaryColor || (!templateId && !githubRepoUrl)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: businessName, primaryColor, and either templateId or githubRepoUrl are required.' 
      });
    }

    // Validate Hex Color
    const hexRegex = /^#?([a-fA-F0-9]{6}|[a-fA-F0-9]{3})$/;
    if (!hexRegex.test(primaryColor)) {
      return res.status(400).json({ success: false, error: 'Invalid hex color format. Please provide a valid hex color code (e.g., #123ABC).' });
    }

    // Validate Slug Pattern (only if provided)
    if (clientSlug) {
      const slugRegex = /^[a-z0-9-]+$/;
      if (!slugRegex.test(clientSlug)) {
        return res.status(400).json({ success: false, error: 'Invalid slug pattern. Slug must contain only lowercase letters, numbers, and hyphens.' });
      }

      // Double check availability (race condition prevention)
      const availability = await isSlugAvailable(clientSlug);
      if (!availability.available) {
        return res.status(400).json({ success: false, error: availability.reason || 'Slug is not available.' });
      }
    }

    // Validate AI model fields if provided (shared utility)
    const modelFieldsCheck = validateModelFields({ aiModel, step1Model, step2Model, step3Model, step4Model });
    if (!modelFieldsCheck.valid) {
      return res.status(400).json({ success: false, error: modelFieldsCheck.error });
    }

    const { generateUniqueSlug, createDemo } = await import('./handlers/demoHandler');
    
    // Determine the final slug immediately so we can return it
    const finalSlug = await generateUniqueSlug(businessName, clientSlug);
    
    // Start demo creation logic in the background
    // This includes cloning, dependency installation, and triggering the agent
    createDemo({ ...req.body, clientSlug: finalSlug }, (req as any).files).catch(async (error: any) => {
      logger.error(`Background demo creation failed for ${finalSlug}: ${error.message}`);
      
      // FIX: Clean up slug reservation if createDemo fails before writing its own cleanup
      // This handles errors that occur before the try block in createDemo (e.g., validation errors)
      try {
        const { demoStatusManager } = await import('./handlers/demoHandler');
        const demoDir = path.join(process.cwd(), 'client-websites', finalSlug);
        const dirExists = await fs.pathExists(demoDir);
        
        // Only clean up if the directory was never created (pre-clone failure)
        if (!dirExists) {
          logger.info(`Cleaning up slug reservation for ${finalSlug} after early failure`);
          demoStatusManager.clearCache(finalSlug);
          
          // Also update status to 'failed' for polling clients
          const activeDemosPath = path.join(process.cwd(), 'logs', 'active-demos.json');
          if (await fs.pathExists(activeDemosPath)) {
            const activeDemos = await fs.readJson(activeDemosPath);
            if (activeDemos[finalSlug]) {
              activeDemos[finalSlug] = {
                ...activeDemos[finalSlug],
                state: 'failed',
                message: error.message,
                updatedAt: new Date().toISOString()
              };
              await fs.writeJson(activeDemosPath, activeDemos, { spaces: 2 });
            }
          }
        }
      } catch (cleanupErr: any) {
        logger.warn(`Failed to cleanup after demo creation error: ${cleanupErr.message}`);
      }
    });
    
    // Return immediately with the slug so the frontend can start polling
    res.json({
      success: true,
      clientSlug: finalSlug,
      status: 'starting',
      message: 'Demo creation initiated in the background.'
    });
  } catch (error: any) {
    logger.error(`Error in demo creation API: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/demo/status/:clientSlug', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const status = await getDemoStatus(clientSlug);
    
    if (!status) {
      return res.status(404).json({ success: false, error: 'Demo status not found for this slug.' });
    }
    
    res.json(status);
  } catch (error: any) {
    logger.error(`Error fetching demo status: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get merged demo details (status + context + task state)
app.get('/api/demos/:clientSlug', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
    
    // Check if demo directory exists
    if (!await fs.pathExists(demoDir)) {
      return res.status(404).json({ success: false, error: 'Demo not found for this slug.' });
    }
    
    // 1. Get demo status (step progress, logs)
    const status = await getDemoStatus(clientSlug);
    
    // 2. Get task state for base demo
    const baseTaskId = `demo-${clientSlug}`;
    const { taskState, taskInfo } = await findTaskById(baseTaskId);
    
    // 3. Load demo context (business info)
    const contextPath = path.join(demoDir, 'demo.context.json');
    let context = null;
    if (await fs.pathExists(contextPath)) {
      try {
        context = await fs.readJson(contextPath);
      } catch (e) {
        logger.warn(`Could not read demo context for ${clientSlug}: ${e}`);
      }
    }
    
    // 4. Load all step task states for comprehensive progress info
    const stepStates: Record<string, any> = {};
    const stepTaskIds = [baseTaskId, `${baseTaskId}-step2`, `${baseTaskId}-step3`, `${baseTaskId}-step4`];
    
    for (const stepTaskId of stepTaskIds) {
      const { taskState: stepState } = await findTaskById(stepTaskId);
      if (stepState) {
        stepStates[stepTaskId] = stepState;
      }
    }
    
    res.json({
      success: true,
      clientSlug,
      status,
      context,
      taskState,
      taskInfo,
      stepStates,
      demoDir
    });
  } catch (error: any) {
    logger.error(`Error fetching demo details for ${req.params.clientSlug}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Reject demo - hard delete: stop preview, kill tasks, delete folder
app.post('/api/demos/:clientSlug/reject', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
    
    logger.info(`Demo rejection requested for: ${clientSlug}`);
    
    // Validate demo exists
    if (!await fs.pathExists(demoDir)) {
      // Idempotency: if demo doesn't exist, return success (already deleted)
      logger.info(`Demo ${clientSlug} already deleted or does not exist`);
      return res.json({ 
        success: true, 
        message: 'Demo already deleted or does not exist.',
        alreadyDeleted: true 
      });
    }
    
    const { visualTester } = await import('./utils/visualTesting');
    const { agentQueue } = await import('./cursor/agentQueue');
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const { cancelCompletionDetection, cancelAllDemoPolling } = await import('./cursor/agentCompletionDetector');
    const { killRunningTask } = await import('./cursor/runner');
    
    // 1. Stop preview app (release file locks)
    try {
      await visualTester.stopApp(demoDir);
      logger.info(`Stopped preview app for ${clientSlug}`);
    } catch (e: any) {
      logger.warn(`Could not stop preview for ${clientSlug}: ${e.message}`);
    }
    
    // 2. Kill all related tasks in the queue (base + all steps + revisions)
    const baseTaskId = `demo-${clientSlug}`;
    const taskPatterns = [
      baseTaskId,
      `${baseTaskId}-step2`,
      `${baseTaskId}-step3`,
      `${baseTaskId}-step4`
    ];
    
    // Also find any revision tasks
    try {
      const contextPath = path.join(demoDir, 'demo.context.json');
      if (await fs.pathExists(contextPath)) {
        const context = await fs.readJson(contextPath);
        const revisionCount = context.revisionCount || 0;
        for (let i = 1; i <= revisionCount; i++) {
          taskPatterns.push(`${baseTaskId}-rev${String(i).padStart(2, '0')}`);
        }
      }
    } catch (e) {
      // Ignore context read errors
    }
    
    // CRITICAL: Kill all running cursor-agent processes for this demo FIRST
    // This prevents orphaned processes from continuing to run after deletion
    for (const taskId of taskPatterns) {
      if (killRunningTask(taskId)) {
        logger.info(`Killed running cursor-agent process for ${taskId}`);
      }
    }
    
    // CRITICAL: Cancel all completion detection polling for this demo
    // This prevents the polling loop from recreating task state after deletion
    cancelAllDemoPolling(baseTaskId);
    
    for (const taskId of taskPatterns) {
      // Cancel individual task polling as well (for revision tasks)
      cancelCompletionDetection(taskId);
      
      try {
        // Force complete as failed to remove from queue
        await agentQueue.completeTask(false, 'Demo rejected by user', taskId);
      } catch (e: any) {
        logger.debug(`Task ${taskId} not in queue: ${e.message}`);
      }
      
      // Clean up all task artifacts
      try {
        await taskCleanupService.deleteTaskArtifacts(taskId, demoDir);
      } catch (e: any) {
        logger.debug(`Cleanup for ${taskId}: ${e.message}`);
      }
    }
    
    // 3. Delete the demo folder with Windows-safe retries
    let deleted = false;
    let attempts = 0;
    const maxAttempts = 5;
    
    while (!deleted && attempts < maxAttempts) {
      try {
        await fs.remove(demoDir);
        deleted = true;
        logger.info(`Successfully deleted demo folder: ${demoDir}`);
      } catch (removeError: any) {
        attempts++;
        logger.warn(`Failed to remove ${demoDir} (attempt ${attempts}/${maxAttempts}): ${removeError.message}`);
        
        if (attempts < maxAttempts) {
          // Wait with exponential backoff
          await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
        }
      }
    }
    
    if (!deleted) {
      logger.error(`Could not delete demo folder after ${maxAttempts} attempts: ${demoDir}`);
      return res.status(500).json({
        success: false,
        error: `Could not delete demo folder. Files may be locked. Please close any open files or terminals in "${clientSlug}" and try again.`
      });
    }
    
    // 4. Clear from active-demos.json audit log (best effort)
    try {
      const activeDemosPath = path.join(process.cwd(), 'logs', 'active-demos.json');
      if (await fs.pathExists(activeDemosPath)) {
        const activeDemos = await fs.readJson(activeDemosPath);
        if (activeDemos[clientSlug]) {
          delete activeDemos[clientSlug];
          await fs.writeJson(activeDemosPath, activeDemos, { spaces: 2 });
        }
      }
    } catch (e: any) {
      logger.warn(`Could not clean active-demos.json: ${e.message}`);
    }
    
    logger.info(`Demo ${clientSlug} rejected and fully deleted`);
    res.json({ 
      success: true, 
      message: `Demo "${clientSlug}" has been rejected and deleted.`,
      clientSlug 
    });
  } catch (error: any) {
    logger.error(`Error rejecting demo ${req.params.clientSlug}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Request changes on a demo - creates a revision task with feedback
app.post('/api/demos/:clientSlug/request-changes', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const { feedback } = req.body;
    const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
    
    logger.info(`Demo change request for: ${clientSlug}`);
    
    // Validate demo exists
    if (!await fs.pathExists(demoDir)) {
      return res.status(404).json({ success: false, error: 'Demo not found.' });
    }
    
    // Validate feedback
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 10) {
      return res.status(400).json({ 
        success: false, 
        error: 'Feedback is required and must be at least 10 characters.' 
      });
    }
    
    const trimmedFeedback = feedback.trim();
    
    // Idempotency: Check for duplicate recent requests (same feedback within 30 seconds)
    const contextPath = path.join(demoDir, 'demo.context.json');
    let context: any = {};
    if (await fs.pathExists(contextPath)) {
      context = await fs.readJson(contextPath);
    }
    
    const lastRequest = context.lastChangeRequest;
    if (lastRequest) {
      const timeSinceLastRequest = Date.now() - new Date(lastRequest.timestamp).getTime();
      const feedbackHash = Buffer.from(trimmedFeedback).toString('base64').substring(0, 20);
      
      if (timeSinceLastRequest < 30000 && lastRequest.feedbackHash === feedbackHash) {
        logger.warn(`Duplicate change request detected for ${clientSlug}`);
        return res.json({
          success: true,
          message: 'Change request already submitted.',
          duplicate: true,
          revisionTaskId: lastRequest.revisionTaskId
        });
      }
    }
    
    // Load demo status
    const status = await getDemoStatus(clientSlug);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Demo status not found.' });
    }
    
    // Check if a task is currently running
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const baseTaskId = `demo-${clientSlug}`;
    const currentStep = status.currentStep || 1;
    const currentTaskId = currentStep === 1 ? baseTaskId : `${baseTaskId}-step${currentStep}`;
    
    const isRunning = await taskCleanupService.isTaskRunning(currentTaskId, demoDir);
    if (isRunning) {
      return res.status(409).json({
        success: false,
        error: 'Cannot request changes while the agent is running. Please wait for it to finish or kill the task first.'
      });
    }
    
    // Generate new revision taskId
    const revisionCount = (context.revisionCount || 0) + 1;
    const revisionTaskId = `${baseTaskId}-rev${String(revisionCount).padStart(2, '0')}`;
    
    // Update context with revision metadata
    context.revisionCount = revisionCount;
    context.lastChangeRequest = {
      timestamp: new Date().toISOString(),
      feedback: trimmedFeedback,
      feedbackHash: Buffer.from(trimmedFeedback).toString('base64').substring(0, 20),
      revisionTaskId,
      requestedAtStep: currentStep
    };
    context.revisions = context.revisions || [];
    context.revisions.push({
      revisionNumber: revisionCount,
      taskId: revisionTaskId,
      feedback: trimmedFeedback,
      requestedAt: new Date().toISOString(),
      stepAtRequest: currentStep
    });
    
    await fs.writeJson(contextPath, context, { spaces: 2 });
    
    // Patch the prompt with feedback
    const { patchPromptWithFeedback } = await import('./cursor/workspaceManager');
    await patchPromptWithFeedback(demoDir, revisionTaskId, trimmedFeedback, revisionCount);
    
    // Update demo status to revision_queued
    const statusPath = path.join(demoDir, 'demo.status.json');
    const currentStatus = await fs.pathExists(statusPath) ? await fs.readJson(statusPath) : {};
    const updatedStatus = {
      ...currentStatus,
      state: 'revision_queued',
      message: `Revision ${revisionCount} queued with feedback`,
      revisionTaskId,
      revisionFeedback: trimmedFeedback,
      updatedAt: new Date().toISOString(),
      logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] Change request submitted: "${trimmedFeedback.substring(0, 50)}..."`]
    };
    await fs.writeJson(statusPath, updatedStatus, { spaces: 2 });
    
    // Create mock task for the revision
    const mockTask: any = {
      id: revisionTaskId,
      name: `Demo Revision ${revisionCount}: ${context.businessName || clientSlug}`,
      description: `Revision based on feedback: ${trimmedFeedback}`,
      custom_fields: [
        { name: 'Client Name', value: context.businessName || clientSlug }
      ]
    };
    
    // Initialize task state for the revision
    const { saveTaskState, saveTaskInfo, WorkflowState } = await import('./state/stateManager');
    const parentState = await import('./state/stateManager').then(m => m.loadTaskState(demoDir, baseTaskId));
    
    await saveTaskState(demoDir, revisionTaskId, {
      state: WorkflowState.IN_PROGRESS,
      branchName: parentState?.branchName || config.git.defaultBranch || 'main',
      baseCommitHash: parentState?.baseCommitHash
    });
    
    await saveTaskInfo(demoDir, revisionTaskId, {
      task: mockTask,
      taskId: baseTaskId, // Parent task ID for reference
      clientName: context.businessName || clientSlug,
      clientFolder: demoDir
    });
    
    // Trigger the agent
    const { triggerCursorAgent } = await import('./cursor/workspaceManager');
    const revisionModel = context.aiModel || config.cursor.defaultModel;
    
    await triggerCursorAgent(demoDir, mockTask, { model: revisionModel });
    
    // Update status to revision_running
    updatedStatus.state = 'revision_running';
    updatedStatus.message = `Revision ${revisionCount} in progress`;
    updatedStatus.updatedAt = new Date().toISOString();
    await fs.writeJson(statusPath, updatedStatus, { spaces: 2 });
    
    logger.info(`Demo ${clientSlug} revision ${revisionCount} triggered with feedback`);
    
    res.json({
      success: true,
      message: `Revision ${revisionCount} has been queued with your feedback.`,
      revisionTaskId,
      revisionNumber: revisionCount,
      clientSlug
    });
  } catch (error: any) {
    logger.error(`Error requesting changes for demo ${req.params.clientSlug}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Build demo - generates static files in public/ folder for production serving
app.post('/api/demos/:slug/build', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    const { force } = req.body;
    
    logger.info(`Build requested for demo: ${slug}`);
    
    const { buildDemo } = await import('./handlers/demoHandler');
    const result = await buildDemo(slug, force === true);
    
    if (result.success) {
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (error: any) {
    logger.error(`Error building demo ${req.params.slug}: ${error.message}`);
    res.status(500).json({ success: false, slug: req.params.slug, error: error.message });
  }
});

// Get demo build status - checks if public/ folder exists
app.get('/api/demos/:slug/build-status', async (req: Request, res: Response) => {
  try {
    const { slug } = req.params;
    
    const { checkDemoBuildStatus } = await import('./handlers/demoHandler');
    const status = await checkDemoBuildStatus(slug);
    
    res.json({ success: true, slug, ...status });
  } catch (error: any) {
    logger.error(`Error checking build status for demo ${req.params.slug}: ${error.message}`);
    res.status(500).json({ success: false, slug: req.params.slug, error: error.message });
  }
});

// Publish demo to GitHub organization (and optionally deploy to Netlify)
app.post('/api/demos/:clientSlug/publish', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const { deployToNetlify: shouldDeployNetlify } = req.body; // Optional: deploy to Netlify after GitHub
    const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
    
    logger.info(`Demo publish requested for: ${clientSlug}${shouldDeployNetlify ? ' (with Netlify deployment)' : ''}`);
    
    // Validate demo exists
    if (!await fs.pathExists(demoDir)) {
      return res.status(404).json({ success: false, error: 'Demo not found.' });
    }
    
    // Load demo status using demoStatusManager (single source of truth)
    const status = await demoStatusManager.read(clientSlug);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Demo status not found.' });
    }
    
    // Check if already published
    if (status.state === 'published') {
      return res.json({
        success: true,
        message: 'Demo is already published.',
        githubRepoUrl: status.githubRepoUrl,
        githubRepoFullName: status.githubRepoFullName,
        netlifySiteUrl: status.netlifySiteUrl,
        netlifyAdminUrl: status.netlifyAdminUrl,
        alreadyPublished: true
      });
    }
    
    // Update status to publishing using demoStatusManager
    await demoStatusManager.write(clientSlug, {
      ...status,
      state: 'publishing',
      message: 'Publishing to GitHub...',
      logs: [...(status.logs || []), `[${new Date().toLocaleTimeString()}] Publishing to GitHub organization...`]
    });
    
    // Import and call the GitHub publisher
    const { publishDemoToGitHubOrg } = await import('./git/githubPublisher');
    
    const githubResult = await publishDemoToGitHubOrg(clientSlug, async (progress) => {
      // Update status with progress using demoStatusManager
      const currentStatus = await demoStatusManager.read(clientSlug);
      await demoStatusManager.write(clientSlug, {
        ...currentStatus,
        message: progress.message,
        logs: [...(currentStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ${progress.message}`]
      });
    });
    
    if (!githubResult.success) {
      // GitHub publish failed
      await demoStatusManager.write(clientSlug, {
        ...status,
        state: 'failed',
        message: githubResult.error || 'GitHub publishing failed',
        githubRepoUrl: githubResult.repoUrl,
        githubRepoFullName: githubResult.repoFullName,
        logs: [...(status.logs || []), `[${new Date().toLocaleTimeString()}] ✗ GitHub publishing failed: ${githubResult.error}`]
      });
      
      logger.error(`Demo ${clientSlug} GitHub publish failed: ${githubResult.error}`);
      
      return res.status(500).json({
        success: false,
        error: githubResult.error,
        githubRepoUrl: githubResult.repoUrl,
        githubRepoFullName: githubResult.repoFullName
      });
    }
    
    // GitHub succeeded - update status with GitHub info
    const currentStatus = await demoStatusManager.read(clientSlug);
    await demoStatusManager.write(clientSlug, {
      ...currentStatus,
      githubRepoUrl: githubResult.repoUrl,
      githubRepoFullName: githubResult.repoFullName,
      message: `Published to GitHub: ${githubResult.repoUrl}`,
      logs: [...(currentStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✓ Published to GitHub: ${githubResult.repoUrl}`]
    });
    
    logger.info(`Demo ${clientSlug} published to GitHub: ${githubResult.repoUrl}`);
    
    // Check if Netlify deployment is requested and configured
    const netlifyConfigured = config.netlify?.apiToken && config.netlify?.accountSlug;
    
    if (shouldDeployNetlify && netlifyConfigured && githubResult.repoUrl) {
      // Deploy to Netlify
      logger.info(`Starting Netlify deployment for ${clientSlug}`);
      
      // Read once to avoid race condition
      let baseStatus = await demoStatusManager.read(clientSlug);
      await demoStatusManager.write(clientSlug, {
        ...baseStatus,
        state: 'deploying',
        message: 'Deploying to Netlify...',
        logs: [...(baseStatus?.logs || []), `[${new Date().toLocaleTimeString()}] Starting Netlify deployment...`]
      });
      
      const { deployToNetlify } = await import('./deployment/netlifyPublisher');
      
      // Track all pending write promises to ensure they complete before final status
      // DemoStatusManager now has built-in locking, so we just need to track completion
      const pendingWrites: Promise<void>[] = [];
      
      const netlifyResult = await deployToNetlify(clientSlug, githubResult.repoUrl, (progress) => {
        // Use atomicUpdate for safe concurrent writes - the manager handles locking internally
        const writePromise = demoStatusManager.atomicUpdate(clientSlug, (current) => ({
          ...current,
          message: progress.message,
          logs: [...(current?.logs || []), `[${new Date().toLocaleTimeString()}] Netlify: ${progress.message}`]
        })).catch((err: any) => {
          // Log but don't fail deployment due to status write errors
          logger.warn(`Failed to write Netlify progress: ${err.message}`);
        });
        pendingWrites.push(writePromise);
      });
      
      // Wait for ALL pending progress writes to complete before final status update
      // This ensures no writes are in-flight when we read the status for final update
      await Promise.all(pendingWrites);
      
      if (netlifyResult.success) {
        // Full success: GitHub + Netlify
        // Read once to avoid race condition
        baseStatus = await demoStatusManager.read(clientSlug);
        const finalStatus: Partial<DemoStatus> = {
          ...baseStatus,
          state: 'published',
          message: `Published to GitHub and deployed to Netlify`,
          netlifySiteId: netlifyResult.siteId,
          netlifySiteUrl: netlifyResult.siteUrl,
          netlifyAdminUrl: netlifyResult.adminUrl,
          netlifyDeployId: netlifyResult.deployId,
          netlifyDeployState: 'ready',
          logs: [...(baseStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✓ Deployed to Netlify: ${netlifyResult.siteUrl}`]
        };
        await demoStatusManager.write(clientSlug, finalStatus as any);
        
        logger.info(`Demo ${clientSlug} fully published: GitHub + Netlify`);
        
        return res.json({
          success: true,
          message: `Published to GitHub and deployed to Netlify`,
          githubRepoUrl: githubResult.repoUrl,
          githubRepoFullName: githubResult.repoFullName,
          netlifySiteUrl: netlifyResult.siteUrl,
          netlifyAdminUrl: netlifyResult.adminUrl,
          netlifySiteId: netlifyResult.siteId
        });
      } else {
        // Partial success: GitHub succeeded, Netlify failed
        // Read once to avoid race condition
        baseStatus = await demoStatusManager.read(clientSlug);
        const deployFailedStatus: Partial<DemoStatus> = {
          ...baseStatus,
          state: 'deploy_failed',
          message: `GitHub published but Netlify deployment failed`,
          netlifySiteId: netlifyResult.siteId,
          netlifyAdminUrl: netlifyResult.adminUrl,
          netlifyError: netlifyResult.error,
          netlifyDeployState: netlifyResult.deployState || 'error',
          logs: [...(baseStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✗ Netlify deployment failed: ${netlifyResult.error}`]
        };
        await demoStatusManager.write(clientSlug, deployFailedStatus as any);
        
        logger.warn(`Demo ${clientSlug} GitHub succeeded but Netlify failed: ${netlifyResult.error}`);
        
        return res.status(207).json({ // 207 Multi-Status for partial success
          success: true, // GitHub succeeded
          partialSuccess: true,
          message: `Published to GitHub but Netlify deployment failed. You can retry Netlify deployment.`,
          githubRepoUrl: githubResult.repoUrl,
          githubRepoFullName: githubResult.repoFullName,
          netlifyError: netlifyResult.error,
          netlifyErrorCode: netlifyResult.errorCode,
          netlifySiteId: netlifyResult.siteId // May exist if site was created
        });
      }
    } else {
      // GitHub only (no Netlify)
      // Read once to avoid race condition
      const ghOnlyStatus = await demoStatusManager.read(clientSlug);
      const publishedStatus: Partial<DemoStatus> = {
        ...ghOnlyStatus,
        state: 'published',
        message: `Published to GitHub: ${githubResult.repoUrl}`,
        logs: [...(ghOnlyStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✓ GitHub publish complete`]
      };
      await demoStatusManager.write(clientSlug, publishedStatus as any);
      
      return res.json({
        success: true,
        message: `Demo published successfully to GitHub`,
        githubRepoUrl: githubResult.repoUrl,
        githubRepoFullName: githubResult.repoFullName,
        netlifySkipped: !shouldDeployNetlify ? 'Not requested' : 'Not configured'
      });
    }
  } catch (error: any) {
    logger.error(`Error publishing demo ${req.params.clientSlug}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Retry Netlify deployment for a demo that has GitHub published but Netlify failed
app.post('/api/demos/:clientSlug/retry-netlify', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    
    logger.info(`Netlify retry requested for: ${clientSlug}`);
    
    // Load demo status
    const status = await demoStatusManager.read(clientSlug);
    if (!status) {
      return res.status(404).json({ success: false, error: 'Demo status not found.' });
    }
    
    // Validate demo is in a retryable state
    if (status.state !== 'deploy_failed' && status.state !== 'published') {
      return res.status(400).json({ 
        success: false, 
        error: `Cannot retry Netlify deployment from state: ${status.state}. Demo must be published to GitHub first.`
      });
    }
    
    // Validate GitHub repo URL exists
    if (!status.githubRepoUrl) {
      return res.status(400).json({ 
        success: false, 
        error: 'No GitHub repository URL found. Publish to GitHub first.'
      });
    }
    
    // Validate Netlify is configured
    if (!config.netlify?.apiToken || !config.netlify?.accountSlug) {
      return res.status(400).json({ 
        success: false, 
        error: 'Netlify is not configured. Set NETLIFY_API_TOKEN and account slug in Settings.'
      });
    }
    
    // Update status to deploying
    await demoStatusManager.write(clientSlug, {
      ...status,
      state: 'deploying',
      message: 'Retrying Netlify deployment...',
      netlifyError: undefined, // Clear previous error
      logs: [...(status.logs || []), `[${new Date().toLocaleTimeString()}] Retrying Netlify deployment...`]
    });
    
    const { deployToNetlify, retryNetlifyDeploy } = await import('./deployment/netlifyPublisher');
    
    let netlifyResult;
    
    // Track pending writes for proper synchronization
    // DemoStatusManager now has built-in locking, so we just need to track completion
    const pendingWrites: Promise<void>[] = [];
    
    // Safe progress callback with error handling using atomicUpdate
    const safeProgressCallback = (progress: any) => {
      const writePromise = demoStatusManager.atomicUpdate(clientSlug, (current) => ({
        ...current,
        message: progress.message,
        logs: [...(current?.logs || []), `[${new Date().toLocaleTimeString()}] Netlify: ${progress.message}`]
      })).catch((err: any) => {
        // Log but don't fail deployment due to status write errors
        logger.warn(`Failed to write Netlify retry progress: ${err.message}`);
      });
      pendingWrites.push(writePromise);
    };
    
    if (status.netlifySiteId) {
      // Site exists, just retry the deploy
      netlifyResult = await retryNetlifyDeploy(clientSlug, status.netlifySiteId, safeProgressCallback);
    } else {
      // No site exists, do full deployment
      netlifyResult = await deployToNetlify(clientSlug, status.githubRepoUrl, safeProgressCallback);
    }
    
    // Wait for all pending progress writes to complete before final status update
    await Promise.all(pendingWrites);
    
    if (netlifyResult.success) {
      // Read once to avoid race condition
      const currentStatus = await demoStatusManager.read(clientSlug);
      const finalStatus: Partial<DemoStatus> = {
        ...currentStatus,
        state: 'published',
        message: `Successfully deployed to Netlify`,
        netlifySiteId: netlifyResult.siteId,
        netlifySiteUrl: netlifyResult.siteUrl,
        netlifyAdminUrl: netlifyResult.adminUrl,
        netlifyDeployId: netlifyResult.deployId,
        netlifyDeployState: 'ready',
        netlifyError: undefined,
        logs: [...(currentStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✓ Deployed to Netlify: ${netlifyResult.siteUrl}`]
      };
      await demoStatusManager.write(clientSlug, finalStatus as any);
      
      logger.info(`Demo ${clientSlug} Netlify retry succeeded: ${netlifyResult.siteUrl}`);
      
      return res.json({
        success: true,
        message: `Successfully deployed to Netlify`,
        netlifySiteUrl: netlifyResult.siteUrl,
        netlifyAdminUrl: netlifyResult.adminUrl,
        netlifySiteId: netlifyResult.siteId
      });
    } else {
      // Read once to avoid race condition
      const currentStatus = await demoStatusManager.read(clientSlug);
      const failedStatus: Partial<DemoStatus> = {
        ...currentStatus,
        state: 'deploy_failed',
        message: `Netlify deployment failed`,
        netlifyError: netlifyResult.error,
        netlifySiteId: netlifyResult.siteId, // Preserve siteId for retry if site was created
        netlifyAdminUrl: netlifyResult.adminUrl, // Preserve admin URL for debugging
        netlifyDeployState: netlifyResult.deployState || 'error',
        logs: [...(currentStatus?.logs || []), `[${new Date().toLocaleTimeString()}] ✗ Netlify retry failed: ${netlifyResult.error}`]
      };
      await demoStatusManager.write(clientSlug, failedStatus as any);
      
      logger.error(`Demo ${clientSlug} Netlify retry failed: ${netlifyResult.error}`);
      
      return res.status(500).json({
        success: false,
        error: netlifyResult.error,
        errorCode: netlifyResult.errorCode
      });
    }
  } catch (error: any) {
    logger.error(`Error retrying Netlify deployment for ${req.params.clientSlug}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// Demo Error Recovery Endpoints
// ============================================

/**
 * POST /api/demos/:clientSlug/retry-step
 * Retries a failed demo step with rollback
 */
app.post('/api/demos/:clientSlug/retry-step', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const { action } = req.body; // 'retry' | 'skip'

    if (!action || !['retry', 'skip'].includes(action)) {
      return res.status(400).json({ 
        success: false, 
        error: 'Invalid action. Must be "retry" or "skip"' 
      });
    }

    const clientFolder = path.join(process.cwd(), 'client-websites', clientSlug);
    const taskId = `demo-${clientSlug}`;

    // Validate demo folder exists
    if (!(await fs.pathExists(clientFolder))) {
      return res.status(404).json({
        success: false,
        error: 'Demo not found'
      });
    }

    // Import continueAfterError
    const { continueAfterError } = await import('./workflow/workflowOrchestrator');

    // FIX: Skip pre-validation check since continueAfterError already validates state
    // This avoids TOCTOU race condition where state changes between our check and the actual operation
    // The continueAfterError function has proper locking and will return appropriate error if not in failed state

    logger.info(`Retry step requested for demo ${clientSlug}: action=${action}`);

    // Execute recovery (validates state internally with proper locking)
    const result = await continueAfterError(clientFolder, taskId, action);

    if (result.success) {
      res.json({
        success: true,
        message: result.message,
        nextStep: result.nextStep
      });
    } else {
      res.status(400).json({
        success: false,
        error: result.error || result.message
      });
    }

  } catch (error: any) {
    logger.error(`Error retrying demo step for ${req.params.clientSlug}: ${error.message}`);
    const { toUserFriendlyError } = await import('./utils/userErrors');
    res.status(500).json({
      success: false,
      error: toUserFriendlyError(error, 'demo-retry')
    });
  }
});

/**
 * GET /api/demos/:clientSlug/recovery-options
 * Gets available recovery options for a failed demo
 */
app.get('/api/demos/:clientSlug/recovery-options', async (req: Request, res: Response) => {
  try {
    const { clientSlug } = req.params;
    const clientFolder = path.join(process.cwd(), 'client-websites', clientSlug);
    const taskId = `demo-${clientSlug}`;

    // Validate demo folder exists
    if (!(await fs.pathExists(clientFolder))) {
      return res.status(404).json({
        success: false,
        error: 'Demo not found'
      });
    }

    // Import checkpoint and recovery services
    const { getRecoveryOptionsResponse } = await import('./state/checkpointService');
    const { getRollbackPreview } = await import('./workflow/workflowOrchestrator');
    const { loadTaskState } = await import('./state/stateManager');

    const state = await loadTaskState(clientFolder, taskId);
    if (!state?.failedStep) {
      return res.status(404).json({
        success: false,
        error: 'No failed step found'
      });
    }

    // Get total steps from demo status
    let totalSteps = 4;
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      totalSteps = status.totalSteps || 4;
    }

    // Get recovery options
    const recoveryOptions = await getRecoveryOptionsResponse(clientFolder, taskId, totalSteps);
    
    if (!recoveryOptions) {
      return res.status(404).json({
        success: false,
        error: 'No recovery options available'
      });
    }

    // Get rollback preview
    const previewResult = await getRollbackPreview(clientFolder, taskId);

    res.json({
      success: true,
      failedStep: recoveryOptions.failedStep,
      checkpoint: recoveryOptions.checkpoint ? {
        stepNumber: recoveryOptions.checkpoint.stepNumber,
        stepName: recoveryOptions.checkpoint.stepName,
        timestamp: recoveryOptions.checkpoint.timestamp,
        gitCommitHash: recoveryOptions.checkpoint.gitCommitHash.substring(0, 7)
      } : null,
      preview: previewResult.preview,
      options: recoveryOptions.options,
      retryCount: recoveryOptions.retryCount,
      maxRetries: recoveryOptions.maxRetries,
      canRetry: recoveryOptions.canRetry,
      canSkip: recoveryOptions.canSkip,
      estimatedCreditResetTime: recoveryOptions.estimatedCreditResetTime
    });

  } catch (error: any) {
    logger.error(`Error getting recovery options for ${req.params.clientSlug}: ${error.message}`);
    const { toUserFriendlyError } = await import('./utils/userErrors');
    res.status(500).json({
      success: false,
      error: toUserFriendlyError(error, 'demo-recovery-options')
    });
  }
});

// Test Netlify API connection
app.get('/api/netlify/test', async (req: Request, res: Response) => {
  try {
    const { testNetlifyConnection, validateNetlifyConfig } = await import('./deployment/netlifyPublisher');
    
    // First validate config
    const validation = validateNetlifyConfig();
    if (!validation.valid) {
      return res.json({
        success: false,
        configured: false,
        errors: validation.errors,
        warnings: validation.warnings
      });
    }
    
    // Test the actual connection
    const result = await testNetlifyConnection();
    
    // If test succeeded, update the verification timestamp in config
    if (result.success) {
      try {
        await acquireConfigLock(async () => {
          const configPath = path.join(process.cwd(), 'config', 'config.json');
          const currentConfig = await fs.readJson(configPath);
          currentConfig.netlify = currentConfig.netlify || {};
          currentConfig.netlify.connectionVerifiedAt = new Date().toISOString();
          await writeJsonAtomic(configPath, currentConfig);
          
          // Update in-memory config
          if (config.netlify) {
            config.netlify.connectionVerifiedAt = currentConfig.netlify.connectionVerifiedAt;
          }
        });
        logger.info('Netlify connection test succeeded, verification timestamp updated');
      } catch (err: any) {
        logger.warn(`Failed to save Netlify verification timestamp: ${err.message}`);
        // Don't fail the test response due to timestamp save failure
      }
    }
    
    res.json({
      success: result.success,
      configured: true,
      accountName: result.accountName,
      error: result.error,
      warnings: validation.warnings,
      connectionVerifiedAt: result.success ? new Date().toISOString() : (config.netlify?.connectionVerifiedAt || null),
      oauthConfigured: config.netlify?.oauthConfigured ?? false,
      oauthWarning: !config.netlify?.oauthConfigured 
        ? 'Netlify GitHub OAuth may not be configured. Install the Netlify GitHub App: https://github.com/apps/netlify/installations/new'
        : undefined
    });
  } catch (error: any) {
    logger.error(`Error testing Netlify connection: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get active demos audit log
app.get('/api/demo/active-demos', async (req: Request, res: Response) => {
  try {
    const LOGS_DIR = path.join(process.cwd(), 'logs');
    const ACTIVE_DEMOS_FILE = path.join(LOGS_DIR, 'active-demos.json');
    
    if (await fs.pathExists(ACTIVE_DEMOS_FILE)) {
      const activeDemos = await fs.readJson(ACTIVE_DEMOS_FILE);
      // Convert object to array for easier consumption
      const demosArray = Object.entries(activeDemos).map(([clientSlug, data]) => ({
        clientSlug,
        ...(data as any)
      }));
      return res.json(demosArray);
    }
    
    res.json([]);
  } catch (error: any) {
    logger.error(`Error fetching active demos: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Approval endpoint
app.get('/approve/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const reason = req.query.reason as string | undefined;

    const request = await getApprovalRequest(token);
    if (!request) {
      return res.status(404).send('Approval request not found or expired');
    }

    const approved = await approveRequest(token, reason);
    if (!approved) {
      return res.status(400).send('Failed to approve request');
    }

    // Complete workflow (push to GitHub)
    await completeWorkflowAfterApproval(request.clientFolder, request.taskId);

    res.send(`
      <html>
        <head><title>Approval Successful</title></head>
        <body>
          <h1>✅ Changes Approved</h1>
          <p>Task ${request.taskId} has been approved and pushed to GitHub.</p>
          <p>Branch: ${request.branchName}</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error(`Error processing approval: ${error.message}`);
    res.status(500).send('Error processing approval');
  }
});

// Rejection endpoint
app.get('/reject/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const reason = req.query.reason as string | undefined;

    const request = await getApprovalRequest(token);
    if (!request) {
      return res.status(404).send('Approval request not found or expired');
    }

    const rejected = await rejectRequest(token, reason);
    if (!rejected) {
      return res.status(400).send('Failed to reject request');
    }

    // FIX: Retrigger the agent if feedback (reason) is provided
    if (reason) {
      const { handleTaskRejectionWithFeedback } = await import('./workflow/workflowOrchestrator');
      // request is already available from getApprovalRequest(token) called earlier in the handler
      handleTaskRejectionWithFeedback(request.clientFolder, request.taskId, reason).catch(err => {
        logger.error(`Async rejection retrigger error for ${request.taskId}: ${err.message}`);
      });
    }

    res.send(`
      <html>
        <head><title>Rejection Successful</title></head>
        <body>
          <h1>❌ Changes Rejected & Agent Retriggered</h1>
          <p>Task ${request.taskId} has been rejected.</p>
          ${reason ? `<p><strong>Feedback:</strong> ${reason}</p><p>The agent is currently rerunning with your feedback.</p>` : '<p>You can update the task in ClickUp and retry manually.</p>'}
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error(`Error processing rejection: ${error.message}`);
    res.status(500).send('Error processing rejection');
  }
});

// Manual workflow continuation endpoint (for testing/debugging)
app.post('/workflow/continue/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientFolder } = req.body;

    if (!clientFolder) {
      return res.status(400).json({ error: 'clientFolder is required' });
    }

    await continueWorkflowAfterAgent(clientFolder, taskId);
    res.json({ message: `Workflow continued for task ${taskId}` });
  } catch (error: any) {
    logger.error(`Error continuing workflow: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Create local task endpoint - delegates to taskCreateHandler
app.post('/api/tasks/create', async (req: Request, res: Response) => {
  try {
    const { createTask } = await import('./handlers/taskCreateHandler');
    const result = await createTask(req.body);

    if (!result.success) {
      return res.status(result.statusCode || 400).json({ error: result.error });
    }

    // Remove internal-only field before sending response
    const { statusCode: _sc, ...responseBody } = result;
    res.json(responseBody);
  } catch (error: any) {
    logger.error(`Error creating local task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Manual task import endpoint - imports a ClickUp task by ID
app.post('/api/tasks/import', async (req: Request, res: Response) => {
  try {
    const { taskId, triggerWorkflow, clientName, model } = req.body;
    
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    // Validate model if provided (shared utility)
    const modelCheck = validateModel(model);
    if (!modelCheck.valid) {
      return res.status(400).json({ error: modelCheck.error, availableModels: modelCheck.availableModels });
    }

    const result = await importTask({
      taskId,
      providedClientName: clientName,
      triggerWorkflow,
      model
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 400).json({
        error: result.error,
        suggestions: result.suggestions
      });
    }

    res.json(result);
  } catch (error: any) {
    logger.error(`Error importing task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Task import preview endpoint
app.get('/api/tasks/import/preview/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientName } = req.query;

    const preview = await previewTaskImport(taskId, clientName as string | undefined);
    res.json(preview);
  } catch (error: any) {
    logger.error(`Error previewing task import: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Legacy Manual task import endpoint (keeping for backward compatibility if needed)
app.post('/api/tasks/import/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { triggerWorkflow, clientName: providedClientName, model } = req.body;
    
    // Validate model if provided
    if (model && typeof model === 'string') {
      const availableModels = config.cursor.availableModels || [];
      if (!availableModels.includes(model)) {
        return res.status(400).json({ 
          error: `Invalid model: ${model}`,
          availableModels
        });
      }
    }
    
    const result = await importTask({
      taskId,
      providedClientName,
      triggerWorkflow,
      model
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 400).json({
        error: result.error,
        suggestions: result.suggestions
      });
    }

    res.json(result);
  } catch (error: any) {
    logger.error(`Error importing task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// ============== System Prompts API ==============

// Get all system prompts
app.get('/api/system-prompts', getSystemPrompts);

// Save system prompts
app.post('/api/system-prompts', saveSystemPrompts);

// Get prompt backups list
app.get('/api/system-prompts/backups', getPromptBackups);

// Restore prompts from backup
app.post('/api/system-prompts/restore/:filename', restorePromptBackup);

// Get settings (no authentication required for reading)
app.get('/api/settings', async (req: Request, res: Response) => {
  try {
    const configPath = path.join(process.cwd(), 'config', 'config.json');
    const configData = await fs.readJson(configPath);
    
    // Check if SMTP is properly configured
    const { isSmtpConfigured } = await import('./approval/emailService');
    const smtpConfigured = isSmtpConfigured();
    
    // Check Netlify configuration
    const netlifyTokenConfigured = !!(
      (configData.netlify?.apiToken && !configData.netlify.apiToken.startsWith('env:')) || 
      process.env.NETLIFY_API_TOKEN
    );
    
    res.json({
      sessionDuration: configData.auth?.sessionDuration || 3,
      enableEmailNotifications: configData.approval?.enableEmailNotifications ?? true,
      smtpConfigured, // Let the UI know if SMTP is actually configured
      gitUserName: configData.git?.userName || '',
      gitUserEmail: configData.git?.userEmail || '',
      githubOrg: configData.git?.githubOrg || '',
      githubTokenConfigured: !!(configData.git?.githubToken && !configData.git.githubToken.startsWith('env:') || process.env.GITHUB_TOKEN),
      defaultModel: configData.cursor?.defaultModel || 'sonnet-4.5',
      availableModels: configData.cursor?.availableModels || [
        'sonnet-4.5',
        'opus-4.5',
        'gpt-5.1',
        'gemini-3-pro',
        'gemini-3-flash',
        'grok',
        'auto'
      ],
      // Netlify deployment settings
      netlifyTokenConfigured,
      netlifyAccountSlug: configData.netlify?.accountSlug || '',
      netlifyBuildCommand: configData.netlify?.buildCommand || '',
      netlifyPublishDir: configData.netlify?.publishDir || 'public',
      netlifyOauthConfigured: configData.netlify?.oauthConfigured ?? false,
      netlifyConnectionVerifiedAt: configData.netlify?.connectionVerifiedAt || null
    });
  } catch (error: any) {
    logger.error(`Error fetching settings: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update settings (no authentication required)
// Uses a mutex lock to prevent race conditions during concurrent updates
app.post('/api/settings', async (req: Request, res: Response) => {
  try {
    // Use config lock to ensure sequential processing of concurrent updates
    await acquireConfigLock(async () => {
      const { 
        sessionDuration, enableEmailNotifications, gitUserName, gitUserEmail, githubOrg, 
        defaultModel, availableModels,
        // Netlify settings
        netlifyAccountSlug, netlifyBuildCommand, netlifyPublishDir, netlifyOauthConfigured
      } = req.body;
      const configPath = path.join(process.cwd(), 'config', 'config.json');
      const currentConfig = await fs.readJson(configPath);

    // Update fields with validation
    if (typeof sessionDuration === 'number' && !isNaN(sessionDuration) && sessionDuration > 0) {
      currentConfig.auth = currentConfig.auth || {};
      currentConfig.auth.sessionDuration = sessionDuration;
    }
    
    if (typeof enableEmailNotifications === 'boolean') {
      currentConfig.approval = currentConfig.approval || {};
      currentConfig.approval.enableEmailNotifications = enableEmailNotifications;
    }

    // Update git user configuration
    currentConfig.git = currentConfig.git || {};
    if (typeof gitUserName === 'string') {
      currentConfig.git.userName = gitUserName.trim();
    }
    if (typeof gitUserEmail === 'string') {
      currentConfig.git.userEmail = gitUserEmail.trim();
    }
    if (typeof githubOrg === 'string') {
      // Validate GitHub org format (alphanumeric + hyphens, no spaces)
      const trimmed = githubOrg.trim();
      if (trimmed === '' || /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(trimmed)) {
        currentConfig.git.githubOrg = trimmed;
      }
    }

    // Update AI model configuration
    if (typeof defaultModel === 'string' && defaultModel.trim()) {
      currentConfig.cursor = currentConfig.cursor || {};
      currentConfig.cursor.defaultModel = defaultModel.trim();
    }

    if (Array.isArray(availableModels)) {
      currentConfig.cursor = currentConfig.cursor || {};
      // Filter to only valid non-empty strings
      currentConfig.cursor.availableModels = availableModels.filter(
        (m: any) => typeof m === 'string' && m.trim()
      ).map((m: string) => m.trim());
      
      // Ensure at least one model remains
      if (currentConfig.cursor.availableModels.length === 0) {
        currentConfig.cursor.availableModels = ['sonnet-4.5'];
      }
    }

    // Update Netlify configuration
    currentConfig.netlify = currentConfig.netlify || {};
    if (typeof netlifyAccountSlug === 'string') {
      // Validate Netlify account slug format (alphanumeric + hyphens)
      const trimmed = netlifyAccountSlug.trim();
      if (trimmed === '' || /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(trimmed)) {
        currentConfig.netlify.accountSlug = trimmed;
      }
    }
    if (typeof netlifyBuildCommand === 'string') {
      currentConfig.netlify.buildCommand = netlifyBuildCommand.trim();
    }
    if (typeof netlifyPublishDir === 'string') {
      currentConfig.netlify.publishDir = netlifyPublishDir.trim() || 'public';
    }
    if (typeof netlifyOauthConfigured === 'boolean') {
      currentConfig.netlify.oauthConfigured = netlifyOauthConfigured;
    }

      // Save back to file atomically
      await writeJsonAtomic(configPath, currentConfig);
      
      // Refresh global config object in memory (inside lock to prevent race)
      const refreshedConfig = loadConfig();
      Object.assign(config, refreshedConfig);
      
      logger.info('System settings updated and configuration reloaded');
    }); // End of acquireConfigLock
    
    res.json({ success: true, message: 'Settings saved successfully' });
  } catch (error: any) {
    logger.error(`Error saving settings: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Known Cursor-supported AI models (curated list)
// This serves as the source of truth for model autocomplete and validation
// Updated 2026-01-11 based on cursor-agent available models
const CURSOR_KNOWN_MODELS = [
  // Auto/default
  'auto',
  'composer-1',
  // Claude/Anthropic models
  'opus-4.5',
  'opus-4.5-thinking',
  'opus-4.1',
  'sonnet-4.5',
  'sonnet-4.5-thinking',
  // GPT models
  'gpt-5.2',
  'gpt-5.2-high',
  'gpt-5.1',
  'gpt-5.1-high',
  'gpt-5.1-codex',
  'gpt-5.1-codex-high',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-max-high',
  // Google models
  'gemini-3-pro',
  'gemini-3-flash',
  // Other models
  'grok'
];

// Get available AI models
app.get('/api/models', async (req: Request, res: Response) => {
  try {
    res.json({
      defaultModel: config.cursor.defaultModel || 'sonnet-4.5',
      availableModels: config.cursor.availableModels || CURSOR_KNOWN_MODELS.slice(0, 6),
      knownModels: CURSOR_KNOWN_MODELS,
      defaultModels: CURSOR_KNOWN_MODELS.slice(0, 6)
    });
  } catch (error: any) {
    logger.error(`Error fetching available models: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get default system prompt (Role section from task template)
app.get('/api/default-system-prompt', async (req: Request, res: Response) => {
  try {
    const templatePath = path.join(__dirname, 'cursor', 'task_template.md');
    let roleContent = '';

    if (await fs.pathExists(templatePath)) {
      const template = await fs.readFile(templatePath, 'utf-8');
      // Extract the Role section content (between "## Role" and the next "## " heading)
      const roleMatch = template.match(/## Role\n([\s\S]*?)(?=\n## )/);
      if (roleMatch) {
        roleContent = roleMatch[1].trim();
      }
    }

    if (!roleContent) {
      // Fallback default
      roleContent = 'You are a senior front-end + UX-minded full-stack engineer. Implement the requested website design/functional change with minimal, safe diffs, following existing patterns and standards. Do a careful self-review, manually verify the change works, commit (no push), update status, then exit.';
    }

    res.json({ systemPrompt: roleContent });
  } catch (error: any) {
    logger.error(`Error fetching default system prompt: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get known Cursor models (for autocomplete and validation)
app.get('/api/cursor/known-models', async (req: Request, res: Response) => {
  try {
    // Read any locally cached models
    const cacheFile = path.join(process.cwd(), 'config', 'cursor-models-cache.json');
    let cachedModels: string[] = [];
    let cacheTimestamp: string | null = null;
    
    if (await fs.pathExists(cacheFile)) {
      try {
        const cache = await fs.readJson(cacheFile);
        cachedModels = cache.models || [];
        cacheTimestamp = cache.updatedAt || null;
      } catch (e) {
        logger.warn('Could not read models cache, using defaults');
      }
    }
    
    // Merge cached models with known models (deduplicated)
    const allModels = [...new Set([...CURSOR_KNOWN_MODELS, ...cachedModels])].sort();
    
    res.json({
      models: allModels,
      knownModels: CURSOR_KNOWN_MODELS,
      cachedModels,
      cacheTimestamp,
      source: cachedModels.length > 0 ? 'cache+defaults' : 'defaults'
    });
  } catch (error: any) {
    logger.error(`Error fetching known models: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Refresh/update the known models cache
app.post('/api/cursor/refresh-models', async (req: Request, res: Response) => {
  try {
    const { customModels } = req.body;
    const cacheFile = path.join(process.cwd(), 'config', 'cursor-models-cache.json');
    
    // Start with known models
    let models = [...CURSOR_KNOWN_MODELS];
    
    // Add any custom models from the request (validated)
    if (Array.isArray(customModels)) {
      const validCustomModels = customModels
        .filter((m: any) => typeof m === 'string' && m.trim().length > 0)
        .map((m: string) => m.trim());
      models = [...new Set([...models, ...validCustomModels])];
    }
    
    // Save to cache
    await fs.ensureDir(path.dirname(cacheFile));
    await fs.writeJson(cacheFile, {
      models: models.sort(),
      knownModels: CURSOR_KNOWN_MODELS,
      updatedAt: new Date().toISOString()
    }, { spaces: 2 });
    
    logger.info(`Models cache updated with ${models.length} models`);
    
    res.json({
      success: true,
      models: models.sort(),
      count: models.length,
      updatedAt: new Date().toISOString()
    });
  } catch (error: any) {
    logger.error(`Error refreshing models: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Validate a model name
app.get('/api/cursor/validate-model/:modelName', async (req: Request, res: Response) => {
  try {
    const { modelName } = req.params;
    const trimmed = modelName.trim();
    
    // Check against known models (case-insensitive)
    const isKnown = CURSOR_KNOWN_MODELS.some(m => m.toLowerCase() === trimmed.toLowerCase());
    
    // Check if it matches a common pattern
    const isValidPattern = /^[a-zA-Z0-9][\w\-\.]*[a-zA-Z0-9]$/.test(trimmed) && trimmed.length >= 2 && trimmed.length <= 50;
    
    // Find suggestions if not an exact match
    const suggestions = isKnown ? [] : CURSOR_KNOWN_MODELS.filter(m => 
      m.toLowerCase().includes(trimmed.toLowerCase()) || 
      trimmed.toLowerCase().includes(m.toLowerCase().split('-')[0])
    ).slice(0, 5);
    
    res.json({
      model: trimmed,
      isKnown,
      isValidPattern,
      isValid: isKnown || isValidPattern,
      suggestions,
      warning: !isKnown && isValidPattern ? 'This model is not in our known list. It may not be available in Cursor.' : null
    });
  } catch (error: any) {
    logger.error(`Error validating model: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Web Dashboard API Endpoints

// Get all tasks
// Preview Management API
app.get('/api/previews', async (req: Request, res: Response) => {
  try {
    const { visualTester } = await import('./utils/visualTesting');
    res.json(visualTester.getStatus());
  } catch (error: any) {
    logger.error(`Error fetching preview status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/previews/start', async (req: Request, res: Response) => {
  try {
    const { clientFolder, skipBuild } = req.body;
    if (!clientFolder) {
      return res.status(400).json({ error: 'clientFolder is required' });
    }

    // Trigger build BEFORE starting preview (ensures fresh content)
    // Can be skipped with skipBuild=true for faster restarts
    let buildResult = null;
    if (!skipBuild) {
      try {
        logger.info(`Building ${clientFolder} before starting preview...`);
        const { buildDemo } = await import('./handlers/demoHandler');
        buildResult = await buildDemo(clientFolder, true);
        
        if (!buildResult.success) {
          logger.warn(`Build failed for ${clientFolder}: ${buildResult.error}. Continuing with preview anyway.`);
        } else {
          logger.info(`Build completed for ${clientFolder}`);
        }
      } catch (buildError: any) {
        logger.warn(`Build error for ${clientFolder}: ${buildError.message}. Continuing with preview anyway.`);
      }
    }

    const { visualTester } = await import('./utils/visualTesting');
    const url = await visualTester.startApp(clientFolder);
    res.json({ 
      success: true, 
      url,
      built: buildResult?.success ?? null,
      buildError: buildResult?.success === false ? buildResult.error : null
    });
  } catch (error: any) {
    logger.error(`Error starting preview: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/previews/stop', async (req: Request, res: Response) => {
  try {
    const { clientFolder } = req.body;
    if (!clientFolder) {
      return res.status(400).json({ error: 'clientFolder is required' });
    }

    const { visualTester } = await import('./utils/visualTesting');
    await visualTester.stopApp(clientFolder);
    res.json({ success: true, message: 'Preview stopped' });
  } catch (error: any) {
    logger.error(`Error stopping preview: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/previews/command', async (req: Request, res: Response) => {
  try {
    const { clientFolder, command } = req.body;
    if (!clientFolder || !command) {
      return res.status(400).json({ error: 'clientFolder and command are required' });
    }

    const { visualTester } = await import('./utils/visualTesting');
    const result = await visualTester.runCommand(clientFolder, command);
    res.json(result);
  } catch (error: any) {
    logger.error(`Error running command in preview: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/previews/:clientName', async (req: Request, res: Response) => {
    try {
    const { clientName } = req.params;
    const { visualTester } = await import('./utils/visualTesting');
    const previews = visualTester.getStatus();
    const preview = previews.find(p => p.clientName === clientName);
    
    if (!preview) {
      return res.status(404).json({ error: 'Preview not found' });
    }
    
    res.json(preview);
  } catch (error: any) {
    logger.error(`Error fetching preview status for ${req.params.clientName}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Screenshots API - Get all screenshot manifests for a task
app.get('/api/tasks/:taskId/screenshots', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { iteration } = req.query;
    
    const { getAllScreenshotManifests, loadScreenshotManifest } = await import('./utils/screenshotService');
    
    // If specific iteration requested, return just that
    if (iteration !== undefined) {
      const iterNum = parseInt(iteration as string, 10);
      const beforeManifest = await loadScreenshotManifest(taskId, 'before', iterNum);
      const afterManifest = await loadScreenshotManifest(taskId, 'after', iterNum);
      
      return res.json({
        taskId,
        iteration: iterNum,
        before: beforeManifest,
        after: afterManifest
      });
    }
    
    // Return all manifests for the task
    const manifests = await getAllScreenshotManifests(taskId);
    
    // Also check for legacy single-image screenshots
    const legacyDir = path.join(process.cwd(), 'public', 'screenshots', taskId);
    let legacyScreenshots: { before?: string; after?: string } = {};
    
    if (await fs.pathExists(legacyDir)) {
      // Check for run_X directories (old format)
      const entries = await fs.readdir(legacyDir);
      
      // Sort run_X entries numerically to find the highest run number
      const runEntries = entries
        .filter(e => e.startsWith('run_'))
        .map(e => {
          const match = e.match(/^run_(\d+)$/);
          return match ? { name: e, num: parseInt(match[1], 10) } : null;
        })
        .filter((e): e is { name: string; num: number } => e !== null)
        .sort((a, b) => b.num - a.num); // Sort descending (highest first)
      
      // Use the highest run number for "after" screenshots
      if (runEntries.length > 0) {
        const highestRun = runEntries[0];
        const highestRunDir = path.join(legacyDir, highestRun.name);
        const afterPath = path.join(highestRunDir, 'after_full.png');
        
        if (await fs.pathExists(afterPath)) {
          legacyScreenshots.after = `/screenshots/${taskId}/${highestRun.name}/after_full.png`;
        }
        
        // For "before", use run_0 if it exists (the initial state)
        const run0Entry = runEntries.find(e => e.num === 0);
        if (run0Entry) {
          const run0Dir = path.join(legacyDir, run0Entry.name);
          const beforePath = path.join(run0Dir, 'before_full.png');
          if (await fs.pathExists(beforePath)) {
            legacyScreenshots.before = `/screenshots/${taskId}/${run0Entry.name}/before_full.png`;
          }
        }
      }
    }
    
    res.json({
      taskId,
      manifests,
      legacyScreenshots,
      hasManifests: Object.keys(manifests.before).length > 0 || Object.keys(manifests.after).length > 0,
      hasLegacy: !!legacyScreenshots.before || !!legacyScreenshots.after
    });
  } catch (error: any) {
    logger.error(`Error fetching screenshots for task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Reporting and Monitoring Routes
app.use(reportRoutes);
app.use(shareRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/uptime', uptimeRoutes);

// Clients API
app.get('/api/clients', async (req: Request, res: Response) => {
  try {
    const clients = await findAllClients();
    res.json(clients);
  } catch (error: any) {
    logger.error(`Error fetching clients: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/clients/:clientName/tasks', async (req: Request, res: Response) => {
  try {
    const { clientName } = req.params;
    const allTasks = await findAllTasks();
    const clientTasks = allTasks.filter(task => 
      task.clientName === clientName || 
      path.basename(task.clientFolder) === clientName
    );
    res.json(clientTasks);
  } catch (error: any) {
    logger.error(`Error fetching tasks for client ${req.params.clientName}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete a client folder
app.delete('/api/clients/:clientFolder', async (req: Request, res: Response) => {
  try {
    const { clientFolder } = req.params;
    const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
    
    // Construct the full path - clientFolder might be a full path or just a name
    let fullPath = clientFolder;
    if (!path.isAbsolute(clientFolder)) {
      // Try to find the client folder
      const possiblePaths = [
        path.join(githubCloneAllDir, clientFolder),
        path.join(githubCloneAllDir, 'client-websites', clientFolder),
        clientFolder
      ];
      
      for (const p of possiblePaths) {
        if (await fs.pathExists(p)) {
          fullPath = p;
          break;
        }
      }
    }
    
    // Security check: ensure path is within the allowed directory
    const resolvedPath = path.resolve(fullPath);
    const resolvedBaseDir = path.resolve(githubCloneAllDir);
    
    if (!resolvedPath.startsWith(resolvedBaseDir)) {
      return res.status(403).json({ 
        success: false, 
        error: 'Cannot delete folders outside the client-websites directory' 
      });
    }
    
    if (!await fs.pathExists(resolvedPath)) {
      return res.status(404).json({ success: false, error: 'Client folder not found' });
    }
    
    // Delete the folder
    await fs.remove(resolvedPath);
    logger.info(`Deleted client folder: ${resolvedPath}`);
    
    res.json({ success: true, message: `Successfully deleted ${path.basename(resolvedPath)}` });
  } catch (error: any) {
    logger.error(`Error deleting client: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Add a new client (GitHub clone or create empty)
app.post('/api/clients', async (req: Request, res: Response) => {
  try {
    const { type, repoUrl, folderName, token } = req.body;
    const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
    
    if (type === 'github') {
      if (!repoUrl) {
        return res.status(400).json({ success: false, error: 'Repository URL is required' });
      }
      
      // Parse the repo URL
      let repoPath = repoUrl;
      if (repoUrl.includes('github.com')) {
        // Extract owner/repo from full URL
        const match = repoUrl.match(/github\.com[\/:]([^\/]+)\/([^\/\s.]+)/);
        if (match) {
          repoPath = `${match[1]}/${match[2]}`;
        }
      }
      
      const parts = repoPath.split('/');
      if (parts.length < 2) {
        return res.status(400).json({ success: false, error: 'Invalid repository URL format' });
      }
      
      const repoName = parts[parts.length - 1].replace(/\.git$/, '');
      const targetName = folderName || repoName;
      const targetPath = path.join(githubCloneAllDir, targetName);
      
      // Check if folder already exists
      if (await fs.pathExists(targetPath)) {
        return res.status(400).json({ 
          success: false, 
          error: `A client folder named "${targetName}" already exists` 
        });
      }
      
      // Build clone URL based on config.git.useSSH setting
      const useSSH = config.git.useSSH ?? false;
      let cloneUrl: string;
      
      if (useSSH) {
        // SSH URL format: git@github.com:owner/repo.git
        cloneUrl = `git@github.com:${repoPath}.git`;
        logger.info(`Using SSH clone URL: ${cloneUrl}`);
      } else {
        // HTTPS URL format with optional token
        cloneUrl = `https://github.com/${repoPath}.git`;
        if (token) {
          cloneUrl = `https://${token}@github.com/${repoPath}.git`;
        }
        logger.info(`Using HTTPS clone URL`);
      }
      
      // Clone the repository
      const { execSync } = await import('child_process');
      
      try {
        execSync(`git clone "${cloneUrl}" "${targetPath}"`, {
          stdio: 'pipe',
          timeout: 120000 // 2 minutes
        });
      } catch (cloneError: any) {
        logger.error(`Git clone failed: ${cloneError.message}`);
        // Clean up partial clone if it exists
        if (await fs.pathExists(targetPath)) {
          await fs.remove(targetPath);
        }
        const sshHint = useSSH ? ' If using SSH, ensure your SSH key is added to GitHub.' : '';
        return res.status(500).json({ 
          success: false, 
          error: `Failed to clone repository.${sshHint} Check the URL and token (for private repos).`
        });
      }
      
      logger.info(`Cloned repository to: ${targetPath}`);
      res.json({ success: true, clientName: targetName, path: targetPath });
      
    } else {
      return res.status(400).json({ success: false, error: 'Invalid type. Use "github" or upload files.' });
    }
  } catch (error: any) {
    logger.error(`Error adding client: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Upload client files
app.post('/api/clients/upload', upload.array('files', 1000), async (req: Request, res: Response) => {
  try {
    const { folderName } = req.body;
    const files = req.files as Express.Multer.File[];
    
    if (!folderName) {
      return res.status(400).json({ success: false, error: 'Folder name is required' });
    }
    
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: 'No files uploaded' });
    }
    
    const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
    const targetPath = path.join(githubCloneAllDir, folderName);
    
    // Check if folder already exists
    if (await fs.pathExists(targetPath)) {
      return res.status(400).json({ 
        success: false, 
        error: `A client folder named "${folderName}" already exists` 
      });
    }
    
    // Create target directory
    await fs.ensureDir(targetPath);
    
    // Get the paths from the request body
    const paths: string[] = [];
    for (const key of Object.keys(req.body)) {
      if (key.startsWith('paths[')) {
        const index = parseInt(key.match(/\d+/)?.[0] || '0');
        paths[index] = req.body[key];
      }
    }
    
    // Move files to target directory
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let relativePath = paths[i] || file.originalname;
      
      // Remove the root folder from the path if it exists (from webkitRelativePath)
      const pathParts = relativePath.split('/');
      if (pathParts.length > 1) {
        relativePath = pathParts.slice(1).join('/');
      }
      
      const filePath = path.join(targetPath, relativePath);
      await fs.ensureDir(path.dirname(filePath));
      await fs.move(file.path, filePath, { overwrite: true });
    }
    
    logger.info(`Uploaded ${files.length} files to: ${targetPath}`);
    res.json({ success: true, clientName: folderName, path: targetPath, fileCount: files.length });
    
  } catch (error: any) {
    logger.error(`Error uploading client files: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await findAllTasks();
    res.json(tasks);
  } catch (error: any) {
    logger.error(`Error fetching tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete all tasks
app.delete('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { deleteAllTasks } = await import('./utils/taskScanner');
    const result = await deleteAllTasks();
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error(`Error deleting all tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete a single task
app.delete('/api/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { deleteTaskById } = await import('./utils/taskScanner');
    const deleted = await deleteTaskById(taskId);
    
    if (deleted) {
      res.json({ success: true, message: `Task ${taskId} deleted successfully` });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (error: any) {
    logger.error(`Error deleting task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Kill a task - forcefully stop and remove from all queues
app.post('/api/tasks/:taskId/kill', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    logger.info(`Kill request received for task: ${taskId}`);

    const { agentQueue } = await import('./cursor/agentQueue');
    const { findTaskById } = await import('./utils/taskScanner');
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const { updateWorkflowState, WorkflowState } = await import('./state/stateManager');
    const { cancelCompletionDetection, cancelAllDemoPolling } = await import('./cursor/agentCompletionDetector');
    const { killRunningTask } = await import('./cursor/runner');

    // CRITICAL: Kill the actual running cursor-agent process FIRST
    // This prevents orphaned processes from continuing to run
    const processKilled = killRunningTask(taskId);
    if (processKilled) {
      logger.info(`Killed running cursor-agent process for task ${taskId}`);
    }

    // CRITICAL: Cancel any active completion detection polling
    // This prevents the polling loop from recreating task state after kill
    cancelCompletionDetection(taskId);
    
    // For demo tasks, also cancel all step polling loops
    if (taskId.startsWith('demo-')) {
      cancelAllDemoPolling(taskId);
    }

    // Find the task first
    const { taskState, clientFolder } = await findTaskById(taskId);

    // Remove from agent queue (queue/running/done/failed directories)
    let removedFromQueue = false;
    try {
      // Force complete as failed to remove from queue
      await agentQueue.completeTask(false, 'Task killed by user', taskId);
      removedFromQueue = true;
    } catch (queueErr: any) {
      logger.debug(`Task ${taskId} not in queue or already removed: ${queueErr.message}`);
    }

    // Clean up all task artifacts using taskCleanupService
    try {
      await taskCleanupService.deleteTaskArtifacts(taskId, clientFolder || undefined);
    } catch (cleanupErr: any) {
      logger.debug(`Cleanup for ${taskId}: ${cleanupErr.message}`);
    }

    // Update workflow state to cancelled/error
    if (clientFolder) {
      try {
        await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
          error: 'Task killed by user'
        });
      } catch (stateErr: any) {
        logger.debug(`State update for ${taskId}: ${stateErr.message}`);
      }
    }

    // For demos, also clear demo status
    if (taskId.startsWith('demo-')) {
      const clientSlug = taskId.replace(/^demo-/, '').replace(/-step\d+$/, '');
      const statusPath = path.join(process.cwd(), 'client-websites', clientSlug, 'demo.status.json');
      if (await fs.pathExists(statusPath)) {
        try {
          const status = await fs.readJson(statusPath);
          status.state = 'killed';
          status.message = 'Demo killed by user';
          status.updatedAt = new Date().toISOString();
          await fs.writeJson(statusPath, status, { spaces: 2 });
        } catch (e) {
          logger.debug(`Could not update demo status: ${e}`);
        }
      }
    }

    logger.info(`Task ${taskId} killed successfully`);
    res.json({ 
      success: true, 
      message: `Task ${taskId} killed and removed from queue`,
      removedFromQueue
    });
  } catch (error: any) {
    logger.error(`Error killing task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Trigger Cursor Agent for a task
app.post('/api/tasks/:taskId/trigger-agent', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { model } = req.body;
    logger.info(`Manual trigger request for Cursor agent: task ${taskId}${model ? ` with model ${model}` : ''}`);

    // Validate model if provided (shared utility)
    const modelCheck = validateModel(model);
    if (!modelCheck.valid) {
      return res.status(400).json({
        error: modelCheck.error,
        message: `Available models: ${(modelCheck.availableModels || []).join(', ')}`,
        availableModels: modelCheck.availableModels,
      });
    }

    const { findTaskById } = await import('./utils/taskScanner');
    const { taskState, taskInfo, clientFolder } = await findTaskById(taskId);


    if (!taskState || !taskInfo || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { triggerCursorAgent } = await import('./cursor/workspaceManager');
    
    // Trigger the agent - this handles state, opening, and automation centrally
    await triggerCursorAgent(clientFolder, taskInfo.task, { model: model || undefined });

    res.json({ success: true, message: 'Cursor agent triggered successfully' });
  } catch (error: any) {
    // Phase 4.2: Use centralized error categorization
    const { categorizeError } = await import('./utils/errorCategorizer');
    const categorized = categorizeError(error);

    const statusCodeMap: Record<string, number> = {
      credit_limit: 402,
      model_error: 422,
      auth_error: 401,
    };
    const statusCode = statusCodeMap[categorized.errorCategory] || 500;

    logger.error(`Error triggering agent for task ${req.params.taskId} [${categorized.errorCategory}]: ${error.message}`);

    res.status(statusCode).json({
      success: false,
      ...categorized,
      // Provide extra context for model errors
      ...(categorized.modelError ? { availableModels: config.cursor.availableModels } : {}),
      // Provide retry hint for credit errors
      ...(categorized.creditError ? { retryable: true, retryAfterMinutes: 60 } : {}),
    });
  }
});

// Approve task directly (for demos without email tokens)
app.post('/api/tasks/:taskId/approve', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { publish } = req.body; // Track C: handle publish flag

    const { findTaskById } = await import('./utils/taskScanner');
    let { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    // For demos, the workflow state might be stored under a step-specific taskId (e.g., demo-slug-step4)
    // Try to find the client folder via demo directory if base task not found
    const isDemoTask = taskId.startsWith('demo-');
    
    if (isDemoTask && !clientFolder) {
      const clientSlug = taskId.replace(/^demo-/, '');
      const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
      if (await fs.pathExists(demoDir)) {
        clientFolder = demoDir;
      }
    }

    if (!clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Guard: Only allow approval in specific states
    const { WorkflowState, updateWorkflowState, loadTaskState } = await import('./state/stateManager');
    const allowedStates: string[] = [
      WorkflowState.AWAITING_APPROVAL,
      WorkflowState.TESTING
    ];

    // For demos, check demo.status.json state (which reflects final step state)
    // instead of base taskState (which might not be updated for step-based workflows)
    let effectiveState = taskState?.state;
    if (isDemoTask) {
      const { getDemoStatus } = await import('./handlers/demoHandler');
      const clientSlug = clientFolder.split(/[/\\]/).pop() || '';
      const demoStatus = await getDemoStatus(clientSlug);
      if (demoStatus?.state) {
        effectiveState = demoStatus.state;
        logger.debug(`Demo ${taskId} using demo.status.json state: ${effectiveState}`);
      }
      
      // Also try to load the step-specific task state if base state is not approvable
      if (!allowedStates.includes(effectiveState as string)) {
        const currentStep = demoStatus?.currentStep || 4;
        const stepTaskId = currentStep === 1 ? taskId : `${taskId}-step${currentStep}`;
        const stepState = await loadTaskState(clientFolder, stepTaskId);
        if (stepState && allowedStates.includes(stepState.state)) {
          effectiveState = stepState.state;
          taskState = stepState;
          logger.debug(`Demo ${taskId} using step ${currentStep} state: ${effectiveState}`);
        }
      }
    }

    if (!allowedStates.includes(effectiveState as string)) {
      return res.status(409).json({ 
        error: `Cannot approve task in current state: ${effectiveState}. Approval is only allowed for tasks awaiting approval or in testing.` 
      });
    }

    // Check if task is running (agent still active)
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const isRunning = await taskCleanupService.isTaskRunning(taskId, clientFolder);

    if (isRunning) {
      return res.status(409).json({ 
        error: 'Cannot approve task while it is running. Please wait for the agent to finish.' 
      });
    }
    
    if (isDemoTask) {
      // Get current step from status
      const { getDemoStatus, advanceDemoStep } = await import('./handlers/demoHandler');
      const clientSlug = clientFolder.split(/[/\\]/).pop() || '';
      const status = await getDemoStatus(clientSlug);
      
      if (status && status.currentStep < (status.totalSteps || 4)) {
        // Advance to next step
        await advanceDemoStep(clientSlug);
        logger.info(`Demo ${taskId} approved - advancing to next step`);
        
        return res.json({ 
          success: true, 
          message: 'Step approved. Advancing to next step.',
          taskId,
          nextStep: (status.currentStep || 1) + 1
        });
      } else {
        // Final step - publish if requested, otherwise set to awaiting_publish
        const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);
        const statusPath = path.join(demoDir, 'demo.status.json');
        
        // Track C: If publish flag is true, trigger publish flow
        if (publish === true) {
          logger.info(`Demo ${taskId} final approval with publish=true - triggering publish`);
          
          const { publishDemoToGitHubOrg } = await import('./git/githubPublisher');
          
          // Update status to publishing
          if (await fs.pathExists(statusPath)) {
            const currentStatus = await fs.readJson(statusPath);
            await fs.writeJson(statusPath, {
              ...currentStatus,
              state: 'publishing',
              message: 'Publishing to GitHub...',
              updatedAt: new Date().toISOString(),
              logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] Final step approved. Publishing to GitHub...`]
            }, { spaces: 2 });
          }
          
          const result = await publishDemoToGitHubOrg(clientSlug, (progress) => {
            logger.info(`Publish progress [${clientSlug}]: ${progress.stage} - ${progress.message}`);
          });
          
          if (result.success) {
            // Update status to published
            if (await fs.pathExists(statusPath)) {
              const currentStatus = await fs.readJson(statusPath);
              await fs.writeJson(statusPath, {
                ...currentStatus,
                state: 'published',
                message: `Published successfully to ${result.repoUrl}`,
                repoUrl: result.repoUrl,
                repoFullName: result.repoFullName,
                publishedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] ✓ Published to ${result.repoUrl}`]
              }, { spaces: 2 });
            }
            
            await updateWorkflowState(clientFolder, taskId, WorkflowState.APPROVED, {
              published: true,
              repoUrl: result.repoUrl
            });
            
            logger.info(`Demo ${taskId} published successfully to ${result.repoUrl}`);
            
            return res.json({ 
              success: true, 
              message: `Demo published successfully to ${result.repoUrl}`,
              taskId,
              completed: true,
              repoUrl: result.repoUrl,
              repoFullName: result.repoFullName
            });
          } else {
            // Publish failed - update status
            if (await fs.pathExists(statusPath)) {
              const currentStatus = await fs.readJson(statusPath);
              await fs.writeJson(statusPath, {
                ...currentStatus,
                state: 'publish_failed',
                message: result.error || 'Publishing failed',
                repoUrl: result.repoUrl,
                repoFullName: result.repoFullName,
                updatedAt: new Date().toISOString(),
                logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] ✗ Publishing failed: ${result.error}`]
              }, { spaces: 2 });
            }
            
            return res.status(500).json({
              success: false,
              error: result.error || 'Publishing failed',
              repoUrl: result.repoUrl,
              repoFullName: result.repoFullName
            });
          }
        }
        
        // No publish flag - set to awaiting_publish
        if (await fs.pathExists(statusPath)) {
          const currentStatus = await fs.readJson(statusPath);
          const updatedStatus = {
            ...currentStatus,
            state: 'awaiting_publish',
            message: 'Demo approved! Ready to publish to GitHub.',
            updatedAt: new Date().toISOString(),
            logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] Final step approved. Ready for publishing.`]
          };
          await fs.writeJson(statusPath, updatedStatus, { spaces: 2 });
        }
        
        // Update workflow state to awaiting approval (for publish)
        await updateWorkflowState(clientFolder, taskId, WorkflowState.AWAITING_APPROVAL, {
          awaitingPublish: true
        });
        
        logger.info(`Demo ${taskId} fully approved - awaiting publish`);
        
        return res.json({ 
          success: true, 
          message: 'Demo approved! Ready to publish to GitHub.',
          taskId,
          awaitingPublish: true,
          nextAction: 'publish'
        });
      }
    }

    // For non-demo tasks, use standard approval flow
    await updateWorkflowState(clientFolder, taskId, WorkflowState.APPROVED);
    
    // Complete workflow (push to GitHub if configured)
    try {
      await completeWorkflowAfterApproval(clientFolder, taskId);
    } catch (approvalError: any) {
      logger.warn(`Post-approval workflow failed for ${taskId}: ${approvalError.message}`);
      // Don't fail the request - state is already updated
    }

    logger.info(`Task ${taskId} approved via dashboard`);
    res.json({ 
      success: true, 
      message: 'Task approved successfully.',
      taskId 
    });
  } catch (error: any) {
    logger.error(`Error approving task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Reject task with feedback
app.post('/api/tasks/:taskId/reject', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { feedback } = req.body;

    // Validate feedback
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 3) {
      return res.status(400).json({ 
        error: 'Valid feedback is required (minimum 3 characters)' 
      });
    }

    const trimmedFeedback = feedback.trim();

    const { findTaskById } = await import('./utils/taskScanner');
    const { taskState, clientFolder } = await findTaskById(taskId);

    if (!taskState || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Guard: Only allow rejection in specific states
    const { WorkflowState } = await import('./state/stateManager');
    const allowedStates: string[] = [
      WorkflowState.AWAITING_APPROVAL,
      WorkflowState.TESTING,
      WorkflowState.REJECTED // Allow updating feedback if already rejected
    ];

    if (!allowedStates.includes(taskState.state)) {
      return res.status(409).json({ 
        error: `Cannot reject task in current state: ${taskState.state}. Rejection is only allowed for tasks awaiting approval or in testing.` 
      });
    }

    // Check if task is running
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const isRunning = await taskCleanupService.isTaskRunning(taskId, clientFolder);

    if (isRunning) {
      return res.status(409).json({ 
        error: 'Cannot reject task while it is running. Please wait for the agent to finish or cancel the task first.' 
      });
    }

    const { handleTaskRejectionWithFeedback } = await import('./workflow/workflowOrchestrator');
    
    // This will update state, patch prompt, and trigger rerun asynchronously
    handleTaskRejectionWithFeedback(clientFolder, taskId, trimmedFeedback).catch(err => {
      logger.error(`Async rejection error for ${taskId}: ${err.message}`);
    });

    res.json({ 
      success: true, 
      message: 'Task rejection received. Agent rerun has been triggered with your feedback.',
      taskId 
    });
  } catch (error: any) {
    logger.error(`Error rejecting task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Submit agent feedback for a task (can be submitted at any time)
app.post('/api/tasks/:taskId/feedback', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { feedback } = req.body;

    // Validate feedback
    if (!feedback || typeof feedback !== 'string' || feedback.trim().length < 3) {
      return res.status(400).json({ 
        error: 'Valid feedback is required (minimum 3 characters)' 
      });
    }

    const trimmedFeedback = feedback.trim();

    const { findTaskById } = await import('./utils/taskScanner');
    const { taskState, clientFolder } = await findTaskById(taskId);

    if (!taskState || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Save the feedback to task state (always apply on next run)
    const { saveAgentFeedback, WorkflowState } = await import('./state/stateManager');
    const updatedState = await saveAgentFeedback(clientFolder, taskId, trimmedFeedback, true);

    // Always trigger a rerun when feedback is submitted
    // Check if task is currently running
    const { taskCleanupService } = await import('./cursor/taskCleanupService');
    const isRunning = await taskCleanupService.isTaskRunning(taskId, clientFolder);

    if (isRunning) {
      return res.json({ 
        success: true, 
        message: 'Feedback saved. Cannot trigger rerun while agent is running.',
        feedbackSaved: true,
        rerunTriggered: false,
        taskId,
        feedbackCount: updatedState.agentFeedback?.length || 0
      });
    }

    // Check if we're in a state where rerun makes sense
    const rerunnableStates = [
      WorkflowState.PENDING,
      WorkflowState.COMPLETED,
      WorkflowState.REJECTED,
      WorkflowState.AWAITING_APPROVAL,
      WorkflowState.ERROR
    ];

    if (rerunnableStates.includes(taskState.state as WorkflowState)) {
      // Trigger rerun with feedback
      const { handleTaskRejectionWithFeedback } = await import('./workflow/workflowOrchestrator');
      handleTaskRejectionWithFeedback(clientFolder, taskId, trimmedFeedback).catch(err => {
        logger.error(`Async feedback rerun error for ${taskId}: ${err.message}`);
      });

      return res.json({ 
        success: true, 
        message: 'Feedback saved and agent rerun triggered.',
        feedbackSaved: true,
        rerunTriggered: true,
        taskId,
        feedbackCount: updatedState.agentFeedback?.length || 0
      });
    }

    // Task is in a non-rerunnable state (e.g., IN_PROGRESS but not detected as running)
    res.json({ 
      success: true, 
      message: 'Feedback saved and will be applied on next run.',
      feedbackSaved: true,
      rerunTriggered: false,
      taskId,
      feedbackCount: updatedState.agentFeedback?.length || 0
    });
  } catch (error: any) {
    logger.error(`Error saving feedback for task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get agent feedback history for a task
app.get('/api/tasks/:taskId/feedback', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;

    const { findTaskById } = await import('./utils/taskScanner');
    const { taskState, clientFolder } = await findTaskById(taskId);

    if (!taskState || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const feedback = taskState.agentFeedback || [];
    
    res.json({ 
      success: true,
      taskId,
      feedback,
      pendingCount: feedback.filter(f => f.applyOnNextRun && !f.applied).length,
      totalCount: feedback.length
    });
  } catch (error: any) {
    logger.error(`Error getting feedback for task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get all incomplete tasks from ClickUp
app.get('/api/tasks/incomplete', async (req: Request, res: Response) => {
  try {
    const { clickUpApiClient } = await import('./clickup/apiClient');
    const tasks = await clickUpApiClient.getAllIncompleteTasks();
    res.json(tasks);
  } catch (error: any) {
    logger.error(`Error fetching incomplete tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Bulk import incomplete tasks
app.post('/api/tasks/import-incomplete', async (req: Request, res: Response) => {
  try {
    const { filterOptions } = req.body; // Optional: filter options for task fetching
    const { clickUpApiClient } = await import('./clickup/apiClient');
    const { extractClientName } = await import('./utils/taskParser');
    const { findClientFolder } = await import('./git/repoManager');
    const { updateWorkflowState, saveTaskInfo, WorkflowState } = await import('./state/stateManager');
    const { findTaskById } = await import('./utils/taskScanner');
    const { getClientMapping } = await import('./utils/clientMappingManager');

    logger.info('Bulk importing incomplete tasks from ClickUp' + (filterOptions ? ' with filters' : ''));
    const tasks = await clickUpApiClient.getAllIncompleteTasks(filterOptions);
    
    const results = {
      total: tasks.length,
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ taskId: string; taskName: string; clickUpUrl?: string; error: string }>,
    };

    for (const task of tasks) {
      try {
        // Check if task already exists
        const existing = await findTaskById(task.id);
        if (existing.taskState && existing.clientFolder) {
          results.skipped++;
          continue;
        }

        // Extract client name and find folder
        const extractionResult = await extractClientName(task.name, task.id, task);
        let clientName: string | null = extractionResult.clientName;
        
        // If extraction failed, try manual mapping as fallback
        if (!clientName) {
          const manualMapping = await getClientMapping(task.id);
          if (manualMapping) {
            clientName = manualMapping;
            logger.debug(`Using manual mapping for task ${task.id}: ${clientName}`);
          }
        }

        if (!clientName) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Could not extract client name${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolderInfo = await findClientFolder(clientName);
        if (!clientFolderInfo) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Client folder not found: ${clientName}${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolder = clientFolderInfo.path;

        // Initialize task state and info
        await updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING);
        await saveTaskInfo(clientFolder, task.id, {
          task,
          taskId: task.id,
          clientName,
          clientFolder,
        });

        results.imported++;
      } catch (error: any) {
        logger.error(`Error importing task ${task.id}: ${error.message}`);
        const errorMsg = error.message;
        results.errors.push({
          taskId: task.id,
          taskName: task.name || 'Unknown',
          clickUpUrl: task.url,
          error: errorMsg,
        });
        trackFailedImport(task.id, task.name || 'Unknown', errorMsg, task.url);
      }
    }

    logger.info(`Bulk import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`);
    res.json(results);
  } catch (error: any) {
    logger.error(`Error bulk importing tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Retry importing failed tasks
app.post('/api/tasks/retry-import', async (req: Request, res: Response) => {
  try {
    const { taskIds } = req.body; // Array of task IDs to retry

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds array is required' });
    }

    const { clickUpApiClient } = await import('./clickup/apiClient');
    const { extractClientName } = await import('./utils/taskParser');
    const { findClientFolder } = await import('./git/repoManager');
    const { updateWorkflowState, saveTaskInfo, WorkflowState } = await import('./state/stateManager');
    const { findTaskById } = await import('./utils/taskScanner');
    const { getClientMapping } = await import('./utils/clientMappingManager');

    logger.info(`Retrying import for ${taskIds.length} tasks`);
    
    const results = {
      total: taskIds.length,
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ taskId: string; taskName: string; clickUpUrl?: string; error: string }>,
    };

    for (const taskId of taskIds) {
      try {
        // Fetch task from ClickUp
        const task = await clickUpApiClient.getTask(taskId);

        // Check if task already exists
        const existing = await findTaskById(task.id);
        if (existing.taskState && existing.clientFolder) {
          results.skipped++;
          continue;
        }

        // Extract client name and find folder
        const extractionResult = await extractClientName(task.name, task.id, task);
        let clientName: string | null = extractionResult.clientName;
        
        // If extraction failed, try manual mapping as fallback
        if (!clientName) {
          const manualMapping = await getClientMapping(task.id);
          if (manualMapping) {
            clientName = manualMapping;
            logger.debug(`Using manual mapping for task ${task.id}: ${clientName}`);
          }
        }

        if (!clientName) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Could not extract client name${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolderInfo = await findClientFolder(clientName);
        if (!clientFolderInfo) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Client folder not found: ${clientName}${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolder = clientFolderInfo.path;

        // Initialize task state and info
        await updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING);
        await saveTaskInfo(clientFolder, task.id, {
          task,
          taskId: task.id,
          clientName,
          clientFolder,
        });

        results.imported++;
      } catch (error: any) {
        logger.error(`Error importing task ${taskId}: ${error.message}`);
        const errorMsg = error.message;
        results.errors.push({
          taskId: taskId,
          taskName: 'Unknown',
          error: errorMsg,
        });
        trackFailedImport(taskId, 'Unknown', errorMsg);
      }
    }

    logger.info(`Retry import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`);
    res.json(results);
  } catch (error: any) {
    logger.error(`Error retrying imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get failed imports history
app.get('/api/tasks/failed-imports', async (req: Request, res: Response) => {
  try {
    const failedImports = Array.from(failedImportsCache.values());
    
    // Sort by timestamp descending (most recent first)
    failedImports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    res.json({
      total: failedImports.length,
      failures: failedImports,
    });
  } catch (error: any) {
    logger.error(`Error retrieving failed imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear failed imports cache
app.delete('/api/tasks/failed-imports', async (req: Request, res: Response) => {
  try {
    const count = failedImportsCache.size;
    failedImportsCache.clear();
    logger.info(`Cleared ${count} failed import entries`);
    res.json({ 
      message: `Cleared ${count} failed import entries`,
      cleared: count,
    });
  } catch (error: any) {
    logger.error(`Error clearing failed imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Cursor Agent Queue status endpoint
app.get('/api/cursor/status', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const status = await agentQueue.getStatus();
    
    if (!status) {
      return res.json({ state: 'idle' });
    }
    
    res.json(status);
  } catch (error: any) {
    logger.error(`Error fetching agent status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get comprehensive queue overview
app.get('/api/cursor/queue/overview', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const overview = await agentQueue.getQueueOverview();
    res.json({ success: true, ...overview });
  } catch (error: any) {
    logger.error(`Error fetching queue overview: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Queue health check endpoint
app.get('/api/cursor/queue/health', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const health = await agentQueue.performHealthCheck();
    
    // If health check recovered any tasks, try to process the next queued task
    if (health.recovered > 0) {
      try {
        const { processNextQueuedTask } = await import('./cursor/agentCompletionDetector');
        await processNextQueuedTask();
        logger.info('Triggered queue processing after health check recovery');
      } catch (queueErr: any) {
        logger.warn(`Could not trigger queue processing after health check: ${queueErr.message}`);
      }
    }
    
    res.json({ success: true, ...health });
  } catch (error: any) {
    logger.error(`Error performing queue health check: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Force unstick running tasks
app.post('/api/cursor/queue/unstick', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.body;
    const { agentQueue } = await import('./cursor/agentQueue');
    const result = await agentQueue.forceUnstickRunning(taskId);
    
    // After unsticking, try to process the next queued task
    if (result.unstuck.length > 0) {
      try {
        const { processNextQueuedTask } = await import('./cursor/agentCompletionDetector');
        await processNextQueuedTask();
        logger.info('Triggered queue processing after unsticking task(s)');
      } catch (queueErr: any) {
        logger.warn(`Could not trigger queue processing after unstick: ${queueErr.message}`);
      }
    }
    
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error(`Error unsticking queue: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear Cursor Agent Queue (just queued tasks)
app.delete('/api/cursor/queue', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const result = await agentQueue.clearQueue();
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error(`Error clearing agent queue: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear ALL queues (nuclear option)
app.delete('/api/cursor/queue/all', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const result = await agentQueue.clearAllQueues();
    res.json({ success: true, message: 'All queues cleared', ...result });
  } catch (error: any) {
    logger.error(`Error clearing all queues: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Legacy GET endpoint for browser testing - now returns overview
app.get('/api/cursor/queue', async (req: Request, res: Response) => {
  try {
    const { agentQueue } = await import('./cursor/agentQueue');
    const overview = await agentQueue.getQueueOverview();
    res.json({ success: true, ...overview });
  } catch (error: any) {
    logger.error(`Error fetching queue: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Reset all task statuses
app.post('/api/cursor/reset', async (req: Request, res: Response) => {
  try {
    await taskStatusManager.resetAllStatuses();
    res.json({ success: true, message: 'All task statuses reset successfully' });
  } catch (error: any) {
    logger.error(`Error resetting task statuses: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get screenshot capture status
app.get('/api/tasks/:taskId/screenshot-status', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { taskState, clientFolder } = await findTaskById(taskId);
    
    if (!taskState) {
      return res.json({ capturing: false });
    }
    
    // Clamp progress to 0-100 and sanitize phase
    const rawProgress = taskState?.metadata?.screenshotProgress || 0;
    const progress = Math.min(100, Math.max(0, typeof rawProgress === 'number' ? rawProgress : 0));
    const phase = ['before', 'after'].includes(taskState?.metadata?.screenshotPhase) 
      ? taskState?.metadata?.screenshotPhase || 'before'
      : 'before';
    
    res.json({
      capturing: Boolean(taskState?.metadata?.capturingScreenshots),
      phase,
      progress
    });
  } catch (error: any) {
    logger.error(`Error getting screenshot status for task ${req.params.taskId}: ${error.message}`);
    res.json({ capturing: false, phase: 'before', progress: 0 });
  }
});

// Retry screenshot capture
app.post('/api/tasks/:taskId/retry-screenshots', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { taskState, taskInfo, clientFolder } = await findTaskById(taskId);
    
    if (!taskState || !taskInfo || !clientFolder) {
      return res.status(404).json({ success: false, error: 'Task not found' });
    }
    
    // Check if screenshots are already being captured (race condition prevention)
    if (taskState.metadata?.capturingScreenshots) {
      return res.status(409).json({ 
        success: false, 
        error: 'Screenshot capture is already in progress' 
      });
    }
    
    // Start screenshot capture in background
    (async () => {
      const { VisualTester } = await import('./utils/visualTesting');
      const { updateWorkflowState, loadTaskState } = await import('./state/stateManager');
      let visualTester: any = null;
      let appStarted = false;
      
      try {
        visualTester = new VisualTester();
        
        // Clear error state and set capturing flag
        await updateWorkflowState(clientFolder, taskId, taskState.state, {
          screenshotCaptureSuccess: undefined,
          screenshotError: undefined
        });
        
        // Start app and capture screenshots (forceLocal to build from current source)
        const url = await visualTester.startApp(clientFolder, true);
        appStarted = true;
        
        // Warmup
        logger.info(`Waiting for app warmup before retry screenshots...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Health check
        try {
          const healthCheck = await visualTester.performHealthCheck(url);
          if (healthCheck.errors.length > 0) {
            logger.warn(`App health check found ${healthCheck.errors.length} issues, but continuing with screenshots`);
          }
        } catch (healthError: any) {
          logger.warn(`Health check failed: ${healthError.message}, but continuing with screenshots`);
        }
        
        // Re-fetch current state to avoid stale state issues
        const currentState = await loadTaskState(clientFolder, taskId);
        const isBeforePhase = !currentState?.metadata?.initialScreenshots;
        const phase = isBeforePhase ? 'before' : 'after';
        
        const screenshotResult = await visualTester.takeSiteScreenshots(url, taskId, phase, 0, {
          maxPages: config.screenshots?.maxPages ?? 20,
          captureSections: config.screenshots?.captureSections ?? true
        }, clientFolder);
        
        // Check if capture was actually successful
        if (!screenshotResult || !screenshotResult.success) {
          throw new Error(screenshotResult?.error || 'Screenshot capture failed');
        }
        
        // Update state with success (use current state, not stale one)
        const finalState = await loadTaskState(clientFolder, taskId);
        await updateWorkflowState(clientFolder, taskId, finalState?.state || taskState.state, {
          screenshotCaptureSuccess: true,
          [isBeforePhase ? 'initialScreenshots' : 'afterScreenshots']: screenshotResult ? [`/screenshots/${taskId}/${phase}_0/home/__fullpage.png`] : [],
          screenshotManifest: screenshotResult?.manifestPath
        });
        
        logger.info(`Screenshot retry successful for task ${taskId}`);
      } catch (err: any) {
        logger.error(`Screenshot retry failed for ${taskId}: ${err.message}`);
        
        // Get current state for error update
        const currentState = await loadTaskState(clientFolder, taskId).catch(() => null);
        await updateWorkflowState(clientFolder, taskId, currentState?.state || taskState.state, {
          screenshotCaptureSuccess: false,
          screenshotError: err.message || 'Unknown error during screenshot capture'
        });
      } finally {
        // Ensure app is stopped if it was started
        if (appStarted && visualTester) {
          try {
            await visualTester.stopApp();
          } catch (stopErr: any) {
            logger.warn(`Failed to stop app after retry: ${stopErr.message}`);
          }
        }
      }
    })().catch(err => {
      logger.error(`Screenshot retry background task failed: ${err.message}`);
    });
    
    res.json({ success: true, message: 'Screenshot capture restarted' });
  } catch (error: any) {
    logger.error(`Error retrying screenshots for task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Get task details
app.get('/api/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { refresh } = req.query;
    let { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    if (!taskState || !taskInfo) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Inject real-time agent step if task is currently running or queued
    try {
      // FIX: Use clientFolder as overrideRoot so we read the runner's status from
      // {clientFolder}/.cursor/status/current.json instead of the server's own .cursor/status/
      const taskStatus = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
      if (taskStatus && (taskStatus.state === 'RUNNING' || taskStatus.state === 'STARTING')) {
        taskState.currentStep = taskStatus.step;
        if (taskStatus.command) {
          taskState.command = taskStatus.command;
        }
      } else {
        const { agentQueue } = await import('./cursor/agentQueue');
        const agentStatus = await agentQueue.getStatus();
        
        if (agentStatus && agentStatus.task && agentStatus.task.taskId === taskId) {
          // If it's the active task in current.json, use its step
          taskState.currentStep = agentStatus.step;
          // Check if there's a command in the task-specific status too
          if (taskStatus && taskStatus.command) {
            taskState.command = taskStatus.command;
          }
        } else if (taskState.state === 'in_progress' || taskState.state === 'pending') {
          // If not active but in_progress/pending, check if it's in queue or running dir
          if (await agentQueue.isTaskQueued(taskId)) {
            taskState.currentStep = 'Waiting in queue';
          } else if (await agentQueue.isTaskRunning(taskId)) {
            taskState.currentStep = 'Starting agent...';
          }
        }
      }
    } catch (error) {
      logger.warn(`Could not fetch agent status for task ${taskId}: ${error}`);
    }

    // Skip ClickUp refresh for local tasks (they don't exist in ClickUp)
    const isLocalTask = taskId.startsWith('local-');
    if (refresh === 'true' && clientFolder && !isLocalTask) {
      try {
        const { clickUpApiClient } = await import('./clickup/apiClient');
        const updatedTask = await clickUpApiClient.getTask(taskId);
        
        // Update taskInfo with new data from ClickUp
        taskInfo.task = updatedTask;
        const { saveTaskInfo } = await import('./state/stateManager');
        await saveTaskInfo(clientFolder, taskId, taskInfo);
        
        logger.info(`Refreshed task details from ClickUp for task ${taskId}`);
      } catch (refreshError: any) {
        logger.error(`Error refreshing task ${taskId} from ClickUp: ${refreshError.message}`);
        // Continue with existing data if refresh fails
      }
    }

    res.json({
      taskState,
      taskInfo,
      clientFolder,
      systemPrompt: await (async () => {
        if (!clientFolder) return null;
        try {
          const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
          if (await fs.pathExists(promptPath)) {
            return await fs.readFile(promptPath, 'utf-8');
          }
        } catch (e) {
          logger.warn(`Could not read system prompt for task ${taskId}: ${e}`);
        }
        return null;
      })()
    });
  } catch (error: any) {
    logger.error(`Error fetching task details: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update task description
app.patch('/api/tasks/:taskId/description', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { description } = req.body;

    if (description === undefined) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    if (!taskState || !taskInfo || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update local task info
    taskInfo.task.description = description;
    const { saveTaskInfo } = await import('./state/stateManager');
    await saveTaskInfo(clientFolder, taskId, taskInfo);

    // Update ClickUp task (skip for local tasks)
    const isLocalTask = taskId.startsWith('local-');
    if (!isLocalTask) {
      try {
        const { clickUpApiClient } = await import('./clickup/apiClient');
        await clickUpApiClient.updateTaskDescription(taskId, description);
        logger.info(`Updated ClickUp description for task ${taskId}`);
      } catch (clickupError: any) {
        logger.warn(`Could not update ClickUp description for task ${taskId}: ${clickupError.message}`);
        // Don't fail the whole request if ClickUp update fails, as local state is updated
      }
    }

    // Update CURSOR_TASK.md if task is in progress
    const { WorkflowState } = await import('./state/stateManager');
    if (taskState.state === WorkflowState.IN_PROGRESS || taskState.state === WorkflowState.PENDING) {
      try {
        const { generatePromptFile } = await import('./cursor/promptGenerator');
        const { detectTestFramework } = await import('./testing/testRunner');
        const testCommand = await detectTestFramework(clientFolder);
        // For local tasks, use clientName from taskInfo; for ClickUp tasks, try custom_fields
        const client = taskInfo.clientName || 
                       taskInfo.task.custom_fields?.find((f: any) => f.name === 'Client Name')?.value || 
                       'Unknown';
        await generatePromptFile(clientFolder, client, taskInfo.task, taskState.branchName, testCommand || undefined);
        logger.info(`Updated CURSOR_TASK.md for task ${taskId} with new description`);
      } catch (promptError: any) {
        logger.warn(`Could not update CURSOR_TASK.md for task ${taskId}: ${promptError.message}`);
      }
    }

    logger.info(`Updated description for task ${taskId}`);
    res.json({ success: true, description });
  } catch (error: any) {
    logger.error(`Error updating task description: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update system prompt (CURSOR_TASK.md)
app.patch('/api/tasks/:taskId/system-prompt', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { systemPrompt } = req.body;

    if (systemPrompt === undefined) {
      return res.status(400).json({ error: 'System prompt content is required' });
    }

    const { clientFolder } = await findTaskById(taskId);

    if (!clientFolder) {
      return res.status(404).json({ error: 'Task not found or client folder missing' });
    }

    const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
    await fs.writeFile(promptPath, systemPrompt, 'utf-8');

    logger.info(`Updated system prompt for task ${taskId} at ${promptPath}`);
    res.json({ success: true, systemPrompt });
  } catch (error: any) {
    logger.error(`Error updating system prompt: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get task diff
app.get('/api/tasks/:taskId/diff', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { taskState, clientFolder } = await findTaskById(taskId);

    if (!taskState || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!taskState.branchName) {
      return res.json({ 
        noBranch: true,
        filesModified: 0,
        filesAdded: 0,
        filesDeleted: 0,
        linesAdded: 0,
        linesRemoved: 0,
        fileList: [],
        diffPreview: '',
        fullDiff: ''
      });
    }

    // Edge Case: If task is in a terminal state, check for saved summary artifact
    const terminalStates = [
      WorkflowState.AWAITING_APPROVAL,
      WorkflowState.APPROVED,
      WorkflowState.COMPLETED
    ];

    if (terminalStates.includes(taskState.state as WorkflowState)) {
      try {
        const iteration = taskState.revisions?.length || 0;
        const artifactPath = path.join(process.cwd(), '.cursor', 'artifacts', taskId, `run_${iteration}`, 'summary.json');
        
        if (await fs.pathExists(artifactPath)) {
          logger.debug(`Returning saved summary artifact for task ${taskId} (Iteration ${iteration})`);
          const savedSummary = await fs.readJson(artifactPath);
          return res.json(savedSummary);
        }
      } catch (artifactError) {
        logger.warn(`Could not load saved summary for task ${taskId}: ${artifactError}`);
        // Fall back to live diff
      }
    }

    // Default: Generate live summary
    const changeSummary = await generateChangeSummary(clientFolder, taskState.branchName, taskState.baseCommitHash);
    res.json(changeSummary);
  } catch (error: any) {
    logger.error(`Error fetching task diff: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Client mapping management endpoints

// Map a task to a client name
app.post('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientName } = req.body;

    if (!clientName || typeof clientName !== 'string') {
      return res.status(400).json({ error: 'clientName is required' });
    }

    const { mapTaskToClient } = await import('./utils/clientMappingManager');
    await mapTaskToClient(taskId, clientName);

    res.json({ 
      success: true,
      message: `Task ${taskId} mapped to client: ${clientName}`
    });
  } catch (error: any) {
    logger.error(`Error mapping task to client: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get client mapping for a task
app.get('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { getClientMapping } = await import('./utils/clientMappingManager');
    const clientName = await getClientMapping(taskId);

    if (!clientName) {
      return res.status(404).json({ error: 'No mapping found for this task' });
    }

    res.json({ taskId, clientName });
  } catch (error: any) {
    logger.error(`Error getting task mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Remove a task mapping
app.delete('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { removeTaskMapping } = await import('./utils/clientMappingManager');
    await removeTaskMapping(taskId);

    res.json({ 
      success: true,
      message: `Mapping removed for task: ${taskId}`
    });
  } catch (error: any) {
    logger.error(`Error removing task mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Remove a task mapping (GET endpoint for browser testing)
app.get('/api/mappings/task/:taskId/delete', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { removeTaskMapping } = await import('./utils/clientMappingManager');
    await removeTaskMapping(taskId);

    res.json({ 
      success: true,
      message: `Mapping removed for task: ${taskId}`
    });
  } catch (error: any) {
    logger.error(`Error removing task mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Add a pattern mapping
app.post('/api/mappings/pattern', async (req: Request, res: Response) => {
  try {
    const { pattern, clientName } = req.body;

    if (!pattern || typeof pattern !== 'string') {
      return res.status(400).json({ error: 'pattern is required' });
    }
    if (!clientName || typeof clientName !== 'string') {
      return res.status(400).json({ error: 'clientName is required' });
    }

    // Validate regex pattern
    try {
      new RegExp(pattern);
    } catch (regexError: any) {
      return res.status(400).json({ error: `Invalid regex pattern: ${regexError.message}` });
    }

    const { addPatternMapping } = await import('./utils/clientMappingManager');
    await addPatternMapping(pattern, clientName);

    res.json({ 
      success: true,
      message: `Pattern mapping added: ${pattern} -> ${clientName}`
    });
  } catch (error: any) {
    logger.error(`Error adding pattern mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Remove a pattern mapping
app.delete('/api/mappings/pattern', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.body;

    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required in request body' });
    }

    const { removePatternMapping } = await import('./utils/clientMappingManager');
    await removePatternMapping(pattern);

    res.json({ 
      success: true,
      message: `Pattern mapping removed: ${pattern}`
    });
  } catch (error: any) {
    logger.error(`Error removing pattern mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get all mappings
app.get('/api/mappings', async (req: Request, res: Response) => {
  try {
    const { loadMappings } = await import('./utils/clientMappingManager');
    const mappings = await loadMappings();

    res.json(mappings);
  } catch (error: any) {
    logger.error(`Error loading mappings: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Task Status and Logs API

// Get task status
app.get('/api/tasks/:taskId/status', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { findTaskById } = await import('./utils/taskScanner');
    const { clientFolder } = await findTaskById(taskId);
    
    const status = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
    
    if (!status) {
      // If not found in task-scoped status, fall back to agentQueue status if applicable
      const { agentQueue } = await import('./cursor/agentQueue');
      const queueStatus = await agentQueue.getStatus();
      if (queueStatus && queueStatus.task && queueStatus.task.taskId === taskId) {
        return res.json({
          taskId,
          state: queueStatus.state.toUpperCase(),
          percent: queueStatus.percent,
          step: queueStatus.step,
          notes: queueStatus.notes.join('\n'),
          lastUpdate: queueStatus.lastUpdate
        });
      }
      return res.status(404).json({ error: 'Status not found for task' });
    }
    
    res.json(status);
  } catch (error: any) {
    logger.error(`Error fetching task status: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get task logs
app.get('/api/tasks/:taskId/logs', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const tail = parseInt(req.query.tail as string) || 200;
    
    const { findTaskById } = await import('./utils/taskScanner');
    const { clientFolder } = await findTaskById(taskId);
    
    const logs = await taskStatusManager.getLogs(taskId, tail, clientFolder || undefined);
    res.json(logs);
  } catch (error: any) {
    logger.error(`Error fetching task logs: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Optional: SSE for real-time events
app.get('/api/tasks/:taskId/events', async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const connId = `sse-events-${++sseConnectionCounter}`;
  
  try {
    const { findTaskById } = await import('./utils/taskScanner');
    const { clientFolder } = await findTaskById(taskId);
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Register connection for tracking
    const conn: SSEConnection = {
      id: connId,
      taskId,
      intervals: [],
      timeouts: [],
      res,
      closed: false,
      lastActivity: Date.now()
    };
    activeSSEConnections.set(connId, conn);
    logger.debug(`SSE ${connId}: Connection opened for task ${taskId} (${activeSSEConnections.size} active)`);

    const sendEvent = createSafeSendEvent(conn);

    // Clean up on client disconnect
    req.on('close', () => cleanupSSEConnection(connId));
    req.on('error', () => cleanupSSEConnection(connId));

    // Initial status
    const status = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
    if (status) {
      sendEvent({ type: 'status', ...status });
    }

    // Poll status file every second with error handling
    const interval = setInterval(async () => {
      if (conn.closed) {
        clearInterval(interval);
        return;
      }

      try {
        const currentStatus = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
        if (currentStatus) {
          if (!sendEvent({ type: 'status', ...currentStatus })) {
            return; // Connection closed during send
          }
          
          if (currentStatus.state === 'DONE' || currentStatus.state === 'FAILED') {
            // Send final status and clean up after short delay
            const completeTimeout = setTimeout(() => {
              cleanupSSEConnection(connId);
            }, 1000);
            registerSSETimeout(connId, completeTimeout);
          }
        }
      } catch (pollError: any) {
        logger.debug(`SSE ${connId}: Poll error - ${pollError.message}`);
        // Don't clean up on transient errors, just log
      }
    }, 1000);
    
    registerSSEInterval(connId, interval);
    
  } catch (error: any) {
    logger.error(`SSE ${connId}: Setup error for task ${taskId} - ${error.message}`);
    cleanupSSEConnection(connId);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    }
  }
});

// SSE endpoint for streaming events.ndjson with live updates
app.get('/api/tasks/:taskId/events/stream', async (req: Request, res: Response) => {
  const { taskId } = req.params;
  const fromLine = parseInt(req.query.from as string) || 0;
  const connId = `sse-stream-${++sseConnectionCounter}`;
  
  try {
    const { findTaskById } = await import('./utils/taskScanner');
    const { clientFolder } = await findTaskById(taskId);
    
    // Set up SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    // Register connection for tracking
    const conn: SSEConnection = {
      id: connId,
      taskId,
      intervals: [],
      timeouts: [],
      res,
      closed: false,
      lastActivity: Date.now()
    };
    activeSSEConnections.set(connId, conn);
    logger.debug(`SSE ${connId}: Stream connection opened for task ${taskId} (${activeSSEConnections.size} active)`);

    const sendEvent = createSafeSendEvent(conn);

    // Clean up on client disconnect
    req.on('close', () => cleanupSSEConnection(connId));
    req.on('error', () => cleanupSSEConnection(connId));

    let lastLineCount = fromLine;

    // Send initial connection event
    sendEvent('connected', { taskId, fromLine });

    // Get events file path
    const eventsPath = taskStatusManager.getEventsFilePath(taskId, clientFolder || undefined);
    
    // Send existing events
    const { events, totalLines } = await taskStatusManager.getEventsFrom(taskId, fromLine, clientFolder || undefined);
    
    if (events.length > 0) {
      sendEvent('batch', { events, totalLines });
      lastLineCount = totalLines;
    } else {
      sendEvent('batch', { events: [], totalLines: 0 });
    }

    // Watch for new events using file polling (more reliable than fs.watch on Windows)
    const pollInterval = setInterval(async () => {
      if (conn.closed) {
        clearInterval(pollInterval);
        return;
      }

      try {
        const { events: newEvents, totalLines: newTotal } = await taskStatusManager.getEventsFrom(
          taskId, 
          lastLineCount, 
          clientFolder || undefined
        );

        if (newEvents.length > 0) {
          if (!sendEvent('batch', { events: newEvents, totalLines: newTotal })) {
            return; // Connection closed during send
          }
          lastLineCount = newTotal;
        }

        // Also send current task status for UI updates
        const status = await taskStatusManager.getStatus(taskId, clientFolder || undefined);
        if (status) {
          if (!sendEvent('status', status)) {
            return; // Connection closed during send
          }
          
          // If task is done or failed, send complete event after a short delay
          if (status.state === 'DONE' || status.state === 'FAILED') {
            const completeTimeout = setTimeout(() => {
              if (!conn.closed) {
                sendEvent('complete', { state: status.state, exitCode: status.exitCode });
                // Clean up after sending complete
                const cleanupTimeout = setTimeout(() => {
                  cleanupSSEConnection(connId);
                }, 500);
                registerSSETimeout(connId, cleanupTimeout);
              }
            }, 1000);
            registerSSETimeout(connId, completeTimeout);
          }
        }
      } catch (pollError: any) {
        logger.debug(`SSE ${connId}: Poll error - ${pollError.message}`);
        // Don't clean up on transient errors
      }
    }, 500);
    
    registerSSEInterval(connId, pollInterval);

  } catch (error: any) {
    logger.error(`SSE ${connId}: Setup error for task ${taskId} - ${error.message}`);
    cleanupSSEConnection(connId);
    if (!res.headersSent) {
      res.status(500).json({ error: error.message });
    } else {
      try {
        res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
        res.end();
      } catch {}
    }
  }
});

// Serve task attachments from client folders
app.get('/api/tasks/:taskId/attachments/:filename', async (req: Request, res: Response) => {
  try {
    const { taskId, filename } = req.params;
    const { findTaskById } = await import('./utils/taskScanner');
    const { clientFolder } = await findTaskById(taskId);

    if (!clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const attachmentPath = path.join(clientFolder, '.cursor', 'attachments', taskId, filename);
    
    if (await fs.pathExists(attachmentPath)) {
      res.sendFile(attachmentPath);
    } else {
      res.status(404).json({ error: 'Attachment not found locally' });
    }
  } catch (error: any) {
    logger.error(`Error serving attachment: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT =
  Number(process.env.PORT) ||
  Number(config?.server?.port) ||
  3000;
app.listen(PORT, '0.0.0.0', async () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`ClickUp webhook endpoint: http://localhost:${PORT}/webhook/clickup`);
  logger.info(`Health check: http://localhost:${PORT}/health`);

  // Initialize persistent approval storage
  try {
    const { initializeApprovalStorage, cleanupExpiredApprovals } = await import('./approval/approvalManager');
    await initializeApprovalStorage();
    logger.info('Approval storage initialized');
    
    // Clean up expired approvals on startup
    const cleaned = await cleanupExpiredApprovals();
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired approval requests`);
    }
  } catch (error: any) {
    logger.error(`Error initializing approval storage: ${error.message}`);
  }

  // ISSUE 23 FIX: Clean up orphaned temp files from atomic writes on startup
  try {
    const { initTempFileCleanup } = await import('./storage/jsonStore');
    // Clean state directory on startup, with periodic cleanup every 30 minutes
    await initTempFileCleanup('./state', 30 * 60 * 1000);
  } catch (error: any) {
    logger.error(`Error initializing temp file cleanup: ${error.message}`);
  }

  // Initialize system prompts directories (backups, audit logs)
  try {
    await initSystemPromptsDirectories();
  } catch (error: any) {
    logger.error(`Error initializing system prompts directories: ${error.message}`);
  }

  // Resume active completion detections
  try {
    const { resumeActiveDetections } = await import('./cursor/agentCompletionDetector');
    await resumeActiveDetections();
  } catch (error: any) {
    logger.error(`Error resuming active detections: ${error.message}`);
  }

  // Start Reporting and Monitoring services
  try {
    const { scheduleService } = await import('./reports/scheduleService');
    const { uptimeMonitor } = await import('./uptime/uptimeMonitor');
    const { retentionService } = await import('./reports/retentionService');

    scheduleService.start();
    uptimeMonitor.start();
    retentionService.start();

    logger.info('Reporting, Uptime, and Retention services started');
  } catch (error: any) {
    logger.error(`Error starting reporting services: ${error.message}`);
  }
});

// Graceful shutdown helper
let isShuttingDown = false;
async function gracefulShutdown(signal: string) {
  // FIX: Prevent double shutdown from multiple signals
  if (isShuttingDown) {
    logger.debug(`Shutdown already in progress, ignoring ${signal}`);
    return;
  }
  isShuttingDown = true;
  
  logger.info(`${signal} received, shutting down gracefully...`);
  
  // Clean up SSE connections and heartbeat interval
  logger.info(`Cleaning up ${activeSSEConnections.size} active SSE connections...`);
  clearInterval(globalHeartbeatInterval);
  for (const connId of activeSSEConnections.keys()) {
    cleanupSSEConnection(connId);
  }
  
  // Stop reporting and monitoring services
  try {
    const { scheduleService } = await import('./reports/scheduleService');
    const { uptimeMonitor } = await import('./uptime/uptimeMonitor');
    const { retentionService } = await import('./reports/retentionService');
    
    scheduleService.stop?.();
    uptimeMonitor.stop?.();
    retentionService.stop?.();
    logger.info('Reporting services stopped');
  } catch (error: any) {
    logger.warn(`Error stopping reporting services: ${error.message}`);
  }
  
  // Stop workflow lock cleanup interval
  try {
    const { stopWorkflowLockCleanup } = await import('./workflow/workflowOrchestrator');
    stopWorkflowLockCleanup();
    logger.info('Workflow lock cleanup stopped');
  } catch (error: any) {
    logger.warn(`Error stopping workflow lock cleanup: ${error.message}`);
  }
  
  // Clean up visual tester
  try {
    const { visualTester } = await import('./utils/visualTesting');
    await visualTester.stopAll();
  } catch (error: any) {
    logger.warn(`Error stopping visual tester: ${error.message}`);
  }
  
  process.exit(0);
}

// Graceful shutdown handlers for various signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// FIX: Handle uncaught exceptions to prevent orphaned intervals/connections
process.on('uncaughtException', async (error) => {
  logger.error(`Uncaught exception: ${error.message}`, { stack: error.stack });
  await gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: any) => {
  logger.error(`Unhandled rejection: ${reason?.message || reason}`, { stack: reason?.stack });
  // Don't shutdown for unhandled rejections, just log - they may be recoverable
});
