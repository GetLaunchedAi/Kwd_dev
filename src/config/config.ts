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
  defaultBranch: string;
  folderMapping?: Record<string, string>;
}

export interface CursorConfig {
  cliPath: string;
  autoOpen: boolean;
  agentMode: boolean;
  agentTriggerMethod: string;
  mcpServerUrl?: string;
  agentCompletionDetection?: {
    enabled: boolean;
    pollInterval: number; // milliseconds (default: 30000 = 30 seconds)
    maxWaitTime: number; // milliseconds (default: 3600000 = 1 hour)
    stabilityPeriod: number; // milliseconds (default: 60000 = 1 minute)
    checkGitCommits: boolean;
    checkTaskFileDeletion: boolean;
    completionMarkerFile?: string; // optional marker file name
  };
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
  email: EmailConfig;
  slack: SlackConfig;
}

export interface Config {
  clickup: ClickUpConfig;
  git: GitConfig;
  cursor: CursorConfig;
  testing: TestingConfig;
  server: ServerConfig;
  approval: ApprovalConfig;
}

function resolveEnvValue(value: string, required: boolean = true): string {
  if (value.startsWith('env:')) {
    const envKey = value.substring(4);
    const envValue = process.env[envKey];
    if (envValue === undefined || envValue === null) {
      if (required) {
        throw new Error(`Environment variable ${envKey} is not set`);
      }
      return '';
    }
    return envValue;
  }
  return value;
}

function resolveEnvObject(obj: any): any {
  if (typeof obj === 'string') {
    return resolveEnvValue(obj);
  }
  if (Array.isArray(obj)) {
    return obj.map(resolveEnvObject);
  }
  if (obj && typeof obj === 'object') {
    const resolved: any = {};
    for (const key in obj) {
      resolved[key] = resolveEnvObject(obj[key]);
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

  // Add backwards-compatible fallback for githubCloneAllDir
  if (resolved.git && !resolved.git.githubCloneAllDir && resolved.git.clientWebsitesDir) {
    resolved.git.githubCloneAllDir = resolved.git.clientWebsitesDir;
  }

  // Validate and return
  return resolved as Config;
}

export const config = loadConfig();












