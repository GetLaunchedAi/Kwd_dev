import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../config/config';
import { logger } from './logger';

const SESSION_FILE = path.join(process.cwd(), 'tokens', 'sessions.json');

interface Session {
  token: string;
  expiresAt: number;
}

/**
 * Ensures tokens directory exists
 */
async function ensureTokensDir(): Promise<void> {
  const tokensDir = path.dirname(SESSION_FILE);
  await fs.ensureDir(tokensDir);
}

/**
 * Creates a new session and returns the token
 */
export async function createSession(): Promise<string> {
  try {
    await ensureTokensDir();
    const token = crypto.randomBytes(32).toString('hex');
    const durationInMs = (config.auth?.sessionDuration || 3) * 60 * 60 * 1000;
    const expiresAt = Date.now() + durationInMs;
    
    let sessions: Session[] = [];
    if (await fs.pathExists(SESSION_FILE)) {
      try {
        sessions = await fs.readJson(SESSION_FILE);
      } catch (e) {
        sessions = [];
      }
    }
    
    // Add new session
    sessions.push({ token, expiresAt });
    
    // Cleanup expired sessions and limit to a reasonable number
    const now = Date.now();
    sessions = sessions.filter(s => s.expiresAt > now);
    
    // Keep only the last 100 sessions to avoid file bloating
    if (sessions.length > 100) {
      sessions = sessions.slice(-100);
    }
    
    await fs.writeJson(SESSION_FILE, sessions, { spaces: 2 });
    logger.info(`New session created, expires in ${config.auth?.sessionDuration || 3} hours`);
    
    return token;
  } catch (error: any) {
    logger.error(`Error creating session: ${error.message}`);
    throw error;
  }
}

/**
 * Validates a session token
 */
export async function validateSession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  
  try {
    if (!await fs.pathExists(SESSION_FILE)) return false;
    
    let sessions: Session[];
    try {
      sessions = await fs.readJson(SESSION_FILE);
    } catch (e) {
      return false;
    }
    
    const now = Date.now();
    const session = sessions.find(s => s.token === token);
    
    if (!session) return false;
    
    if (session.expiresAt < now) {
      logger.warn('Session token expired');
      return false;
    }
    
    return true;
  } catch (error: any) {
    logger.error(`Error validating session: ${error.message}`);
    return false;
  }
}

/**
 * Removes a session token (logout)
 */
export async function destroySession(token: string): Promise<void> {
  try {
    if (!await fs.pathExists(SESSION_FILE)) return;
    
    let sessions: Session[] = await fs.readJson(SESSION_FILE);
    sessions = sessions.filter(s => s.token !== token);
    
    await fs.writeJson(SESSION_FILE, sessions, { spaces: 2 });
    logger.info('Session destroyed');
  } catch (error: any) {
    logger.error(`Error destroying session: ${error.message}`);
  }
}







