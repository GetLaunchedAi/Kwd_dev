import * as fs from 'fs-extra';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

export interface ClickUpConfig {
  apiToken?: string;
  clientId?: string;
  clientSecret?: string;
  redirectUri?: string;
  accessToken?: string;
  webhookSecret: string;
  triggerStatus: string;
  completionStatuses?: string[];
  filters?: {
    excludeStatuses?: string[];
    includeOnlyStatuses?: string[] | null;
  };
}

export interface GitConfig {
  clientWebsitesDir: string;
  githubCloneAllDir?: string;
  githubToken: string;
  githubOrg?: string;
  defaultBranch: string;
  devBranch?: string;
  folderMapping?: Record<string, string>;
  userName?: string;
  userEmail?: string;
  useSSH?: boolean; // Use SSH URLs for git clone (recommended for production servers)
}

export interface CursorConfig {
  cliPath: string;
  autoOpen: boolean;
  agentMode: boolean;
  agentTriggerMethod: string;
  triggerMode?: 'queue' | 'ui';
  queue?: {
    ttlMinutes: number;
    maxTasksPerWorkspace: number;
  };
  mcpServerUrl?: string;
  timeoutMs?: number;
  apiKey?: string;
  useWsl?: boolean;
  wslDistribution?: string;
  agentCompletionDetection?: {
    enabled: boolean;
    pollInterval: number; // milliseconds (default: 30000 = 30 seconds)
    maxWaitTime: number; // milliseconds (default: 3600000 = 1 hour)
  };
  defaultModel?: string;
  availableModels?: string[];
}

export interface TestingConfig {
  timeout: number;
}

export interface ServerConfig {
  port: number;
}

export interface EmailConfig {
  smtp: {
    host: string;
    port: number;
    secure: boolean;
    auth: {
      user: string;
      pass: string;
    };
  };
  from: string;
  approvalUrl: string;
}

export interface SlackConfig {
  webhookUrl: string;
}

export interface ApprovalConfig {
  method: 'email' | 'slack';
  enableEmailNotifications?: boolean;
  email: EmailConfig;
  slack: SlackConfig;
}

export interface AuthConfig {
  sessionDuration: number;
  username: string;
  password: string;
}

export interface ScreenshotsConfig {
  fullSiteCapture?: boolean;
  maxPages?: number;
  captureSections?: boolean;
  maxIterationsToKeep?: number;
}

export interface BuildConfig {
  baseTimeoutMs: number;      // Base timeout for builds (default: 120000 = 2 minutes)
  activityTimeoutMs: number;  // Timeout reset when output received (default: 60000 = 1 minute)
  maxRetries: number;         // Max retry attempts (default: 2)
  retryDelayMs: number;       // Delay between retries (default: 3000 = 3 seconds)
}

export interface NetlifyConfig {
  apiToken?: string;          // Netlify Personal Access Token (from env:NETLIFY_API_TOKEN)
  accountSlug?: string;       // Netlify account/team slug (from env:NETLIFY_ACCOUNT_SLUG)
  buildCommand?: string;      // Override build command (auto-detected from package.json if not set)
  publishDir?: string;        // Override publish directory (defaults to 'public' for Eleventy)
  oauthConfigured?: boolean;  // Whether Netlify GitHub OAuth is configured (set via Settings UI)
  connectionVerifiedAt?: string;  // ISO timestamp of last successful connection test
}

export interface Config {
  clickup: ClickUpConfig;
  git: GitConfig;
  cursor: CursorConfig;
  testing: TestingConfig;
  server: ServerConfig;
  approval: ApprovalConfig;
  auth: AuthConfig;
  screenshots?: ScreenshotsConfig;
  build?: BuildConfig;
  netlify?: NetlifyConfig;
}

// Environment variables that are optional (won't crash if missing)
const OPTIONAL_ENV_VARS = new Set([
  'SLACK_WEBHOOK_URL',
  'CURSOR_API_KEY',
  'SMTP_HOST',
  'SMTP_USER', 
  'SMTP_PASS',
  'EMAIL_FROM',
  'APPROVAL_EMAIL_TO',
  'GITHUB_TOKEN', // Optional for local development without GitHub
  'IMAGE_RETRIEVER_PATH', // Optional path to ImageRetriever tool
  'NETLIFY_API_TOKEN', // Optional for Netlify deployment integration
  'NETLIFY_ACCOUNT_SLUG', // Optional Netlify account/team slug
  'AUTH_USERNAME', // Optional auth username (defaults to 'admin')
  'AUTH_PASSWORD', // Optional auth password (defaults to 'admin')
]);

function resolveEnvValue(value: string, required: boolean = true): string {
  if (value.startsWith('env:')) {
    const envKey = value.substring(4);
    const envValue = process.env[envKey];
    
    // Check if this env var is in the optional list
    const isOptional = OPTIONAL_ENV_VARS.has(envKey);
    
    if (envValue === undefined || envValue === null || envValue === '') {
      if (required && !isOptional) {
        throw new Error(`Environment variable ${envKey} is not set`);
      }
      return '';
    }
    return envValue;
  }
  return value;
}

function resolveEnvObject(obj: any, parentKey?: string): any {
  if (typeof obj === 'string') {
    return resolveEnvValue(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(item => resolveEnvObject(item, parentKey));
  }
  if (obj && typeof obj === 'object') {
    const resolved: any = {};
    for (const key in obj) {
      resolved[key] = resolveEnvObject(obj[key], key);
    }
    return resolved;
  }
  return obj;
}

export function loadConfig(): Config {
  const configPath = path.join(process.cwd(), 'config', 'config.json');
  const examplePath = path.join(process.cwd(), 'config', 'config.example.json');

  let configData: any;

  if (fs.existsSync(configPath)) {
    configData = fs.readJsonSync(configPath);
  } else if (fs.existsSync(examplePath)) {
    configData = fs.readJsonSync(examplePath);
    console.warn(`Using example config file. Please create config/config.json for production.`);
  } else {
    throw new Error('No configuration file found. Please create config/config.json');
  }

  // Resolve environment variables
  const resolved = resolveEnvObject(configData);

  // Set default values for agentCompletionDetection
  if (resolved.cursor && !resolved.cursor.agentCompletionDetection) {
    resolved.cursor.agentCompletionDetection = {
      enabled: true,
      pollInterval: 30000, // 30 seconds
      maxWaitTime: 3600000, // 1 hour
    };
  }

  // Add backwards-compatible fallback for githubCloneAllDir
  if (resolved.git && !resolved.git.githubCloneAllDir && resolved.git.clientWebsitesDir) {
    resolved.git.githubCloneAllDir = resolved.git.clientWebsitesDir;
  }

  // Set default value for devBranch
  if (resolved.git && !resolved.git.devBranch) {
    resolved.git.devBranch = 'main';
  }

  // Set default values for AI model selection
  if (resolved.cursor && !resolved.cursor.availableModels) {
    resolved.cursor.availableModels = [
      'sonnet-4.5',
      'opus-4.5',
      'gpt-5.1',
      'gemini-3-pro',
      'gemini-3-flash',
      'grok',
      'auto'
    ];
  }
  if (resolved.cursor && !resolved.cursor.defaultModel) {
    resolved.cursor.defaultModel = 'sonnet-4.5';
  }

  // Set default values for screenshots configuration
  if (!resolved.screenshots) {
    resolved.screenshots = {};
  }
  if (resolved.screenshots.fullSiteCapture === undefined) {
    resolved.screenshots.fullSiteCapture = true;
  }
  if (resolved.screenshots.maxPages === undefined) {
    resolved.screenshots.maxPages = 20;
  }
  if (resolved.screenshots.captureSections === undefined) {
    resolved.screenshots.captureSections = true;
  }
  if (resolved.screenshots.maxIterationsToKeep === undefined) {
    resolved.screenshots.maxIterationsToKeep = 3;
  }

  // Set default values for build configuration
  if (!resolved.build) {
    resolved.build = {};
  }
  if (resolved.build.baseTimeoutMs === undefined) {
    resolved.build.baseTimeoutMs = 120000; // 2 minutes
  }
  if (resolved.build.activityTimeoutMs === undefined) {
    resolved.build.activityTimeoutMs = 60000; // 1 minute inactivity timeout
  }
  if (resolved.build.maxRetries === undefined) {
    resolved.build.maxRetries = 2;
  }
  if (resolved.build.retryDelayMs === undefined) {
    resolved.build.retryDelayMs = 3000; // 3 seconds
  }

  // Set default values for Netlify configuration
  if (!resolved.netlify) {
    resolved.netlify = {};
  }
  // apiToken and accountSlug are resolved from env vars if set in config.json
  // publishDir defaults to 'public' for Eleventy projects
  if (resolved.netlify.publishDir === undefined) {
    resolved.netlify.publishDir = 'public';
  }
  // oauthConfigured defaults to false - user must confirm in Settings
  if (resolved.netlify.oauthConfigured === undefined) {
    resolved.netlify.oauthConfigured = false;
  }

  // Set default values for auth configuration
  if (!resolved.auth) {
    resolved.auth = {};
  }
  if (!resolved.auth.sessionDuration) {
    resolved.auth.sessionDuration = 3;
  }
  if (!resolved.auth.username) {
    resolved.auth.username = 'admin';
  }
  if (!resolved.auth.password) {
    resolved.auth.password = 'admin';
  }

  // Validate and return
  return resolved as Config;
}

export const config = loadConfig();












