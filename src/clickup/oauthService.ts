import axios from 'axios';
import * as fs from 'fs-extra';
import * as path from 'path';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

const DEBUG_LOG_PATH = path.join(process.cwd(), '.cursor', 'debug.log');
function debugLog(location: string, message: string, data: any, hypothesisId: string) {
  try {
    fs.ensureDirSync(path.dirname(DEBUG_LOG_PATH));
    const logEntry = JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    }) + '\n';
    fs.appendFileSync(DEBUG_LOG_PATH, logEntry);
  } catch (e) {}
}

const TOKEN_FILE = path.join(process.cwd(), 'tokens', 'clickup-access-token.json');

// OAuth state storage for CSRF protection
// In production with multiple instances, replace with Redis
const oauthStateStore: Map<string, { createdAt: number }> = new Map();
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Stores OAuth state for CSRF verification
 */
export function storeOAuthState(state: string): void {
  // Clean up expired states
  const now = Date.now();
  for (const [key, value] of oauthStateStore.entries()) {
    if (now - value.createdAt > STATE_TTL_MS) {
      oauthStateStore.delete(key);
    }
  }
  oauthStateStore.set(state, { createdAt: now });
}

/**
 * Verifies and consumes OAuth state (returns true if valid, false otherwise)
 */
export function verifyOAuthState(state: string): boolean {
  const stateData = oauthStateStore.get(state);
  if (!stateData) {
    return false;
  }
  
  // Check if expired
  if (Date.now() - stateData.createdAt > STATE_TTL_MS) {
    oauthStateStore.delete(state);
    return false;
  }
  
  // Consume the state (one-time use)
  oauthStateStore.delete(state);
  return true;
}

export interface ClickUpTokenResponse {
  access_token: string;
  token_type: string;
  expires_in?: number;
  refresh_token?: string;
}

/**
 * Ensures tokens directory exists
 */
async function ensureTokensDir(): Promise<void> {
  const tokensDir = path.dirname(TOKEN_FILE);
  await fs.ensureDir(tokensDir);
}

/**
 * Saves access token to file
 */
export async function saveAccessToken(token: string, expiresIn?: number): Promise<void> {
  await ensureTokensDir();
  const tokenData = {
    access_token: token,
    expires_at: expiresIn ? Date.now() + (expiresIn * 1000) : null,
    saved_at: new Date().toISOString(),
  };
  await fs.writeJson(TOKEN_FILE, tokenData, { spaces: 2 });
  logger.info('Access token saved');
}

/**
 * Loads access token from file
 */
export async function loadAccessToken(): Promise<string | null> {
  if (!fs.existsSync(TOKEN_FILE)) {
    return null;
  }

  try {
    const tokenData = await fs.readJson(TOKEN_FILE);
    
    // Check if token is expired
    if (tokenData.expires_at && Date.now() >= tokenData.expires_at) {
      logger.warn('Access token has expired');
      return null;
    }

    const token = tokenData.access_token || null;
    return token;
  } catch (error: any) {
    logger.error(`Error loading access token: ${error.message}`);
    return null;
  }
}

/**
 * Gets the ClickUp authorization URL
 * Uses the OAuth 2.0 authorization endpoint with proper parameters
 */
export function getAuthorizationUrl(state?: string): string {
  const clientId = config.clickup.clientId;
  const redirectUri = config.clickup.redirectUri;
  
  if (!clientId || !redirectUri) {
    throw new Error('Client ID and Redirect URI must be configured');
  }

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
  });

  if (state) {
    params.append('state', state);
  }

  // ClickUp OAuth authorization URL (per official docs)
  return `https://app.clickup.com/api?${params.toString()}`;
}

/**
 * Exchanges authorization code for access token
 */
export async function exchangeCodeForToken(code: string): Promise<ClickUpTokenResponse> {
  const clientId = config.clickup.clientId;
  const clientSecret = config.clickup.clientSecret;
  const redirectUri = config.clickup.redirectUri;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error('Client ID, Client Secret, and Redirect URI must be configured');
  }

  try {
    logger.info('Exchanging authorization code for access token');
    const response = await axios.post('https://api.clickup.com/api/v2/oauth/token', {
      client_id: clientId,
      client_secret: clientSecret,
      code: code,
      redirect_uri: redirectUri,
    });

    const tokenData = response.data as ClickUpTokenResponse;
    logger.info('Successfully obtained access token');
    
    // Save token
    await saveAccessToken(tokenData.access_token, tokenData.expires_in);
    
    return tokenData;
  } catch (error: any) {
    logger.error(`Error exchanging code for token: ${error.message}`);
    if (error.response) {
      logger.error(`Response: ${JSON.stringify(error.response.data)}`);
    }
    throw error;
  }
}

/**
 * Generates a random state string for OAuth flow
 */
export function generateState(): string {
  return crypto.randomBytes(32).toString('hex');
}

/**
 * Gets the current access token (loads from file or returns null)
 */
export async function getAccessToken(): Promise<string | null> {
  return await loadAccessToken();
}




