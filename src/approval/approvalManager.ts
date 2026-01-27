import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { WorkflowState, updateWorkflowState } from '../state/stateManager';
import { ChangeSummary } from './changeSummarizer';
import { TestResult } from '../testing/testRunner';
import * as fs from 'fs-extra';
import * as path from 'path';

export interface ApprovalRequest {
  token: string;
  taskId: string;
  clientFolder: string;
  branchName: string;
  changeSummary: ChangeSummary;
  testResult: TestResult;
  createdAt: Date;
  expiresAt: Date;
  assigneeEmail?: string;
}

/**
 * Persistent approval storage with atomic writes
 * Storage location: state/approvals/
 * 
 * FIX: Added mutex pattern to prevent race condition in concurrent initialization
 */
class ApprovalStorage {
  private storageDir: string;
  private tmpDir: string;
  private cache: Map<string, ApprovalRequest> = new Map();
  private initialized: boolean = false;
  // FIX: Promise to track in-flight initialization, preventing race conditions
  private initializationPromise: Promise<void> | null = null;

  constructor() {
    this.storageDir = path.join(process.cwd(), 'state', 'approvals');
    this.tmpDir = path.join(this.storageDir, 'tmp');
  }

  /**
   * Initialize storage and load existing approvals from disk
   * FIX: Uses a mutex pattern - if initialization is in progress, all callers
   * wait for the same promise rather than starting duplicate initializations
   */
  async initialize(): Promise<void> {
    // Fast path: already initialized
    if (this.initialized) return;
    
    // FIX: If initialization is already in progress, wait for it
    if (this.initializationPromise) {
      await this.initializationPromise;
      return;
    }
    
    // Start initialization and store the promise so concurrent calls can wait
    this.initializationPromise = this._initializeInternal();
    
    try {
      await this.initializationPromise;
    } finally {
      // Clear the promise reference after completion (success or failure)
      // This allows retry if initialization failed
      if (!this.initialized) {
        this.initializationPromise = null;
      }
    }
  }

  /**
   * Internal initialization logic
   */
  private async _initializeInternal(): Promise<void> {
    await fs.ensureDir(this.storageDir);
    await fs.ensureDir(this.tmpDir);

    // Load all existing approval files from disk
    try {
      const files = await fs.readdir(this.storageDir);
      const jsonFiles = files.filter(f => f.endsWith('.json') && !f.startsWith('.'));

      for (const file of jsonFiles) {
        try {
          const filePath = path.join(this.storageDir, file);
          const data = await fs.readJson(filePath);
          
          // Deserialize dates
          data.createdAt = new Date(data.createdAt);
          data.expiresAt = new Date(data.expiresAt);

          // Check if expired
          if (new Date() > data.expiresAt) {
            logger.info(`Removing expired approval: ${file}`);
            await fs.remove(filePath);
            continue;
          }

          this.cache.set(data.token, data);
          logger.debug(`Loaded approval request: ${data.token.substring(0, 8)}... for task ${data.taskId}`);
        } catch (error: any) {
          logger.warn(`Failed to load approval file ${file}: ${error.message}`);
        }
      }

      logger.info(`Loaded ${this.cache.size} active approval requests from disk`);
    } catch (error: any) {
      logger.error(`Failed to initialize approval storage: ${error.message}`);
    }

    this.initialized = true;
  }

  /**
   * Save approval request with atomic write (tmp file + rename)
   */
  async save(request: ApprovalRequest): Promise<void> {
    await this.initialize();

    const fileName = `${request.token}.json`;
    const filePath = path.join(this.storageDir, fileName);
    const tmpPath = path.join(this.tmpDir, `${request.token}-${Date.now()}.json`);

    try {
      // Write to temp file first
      await fs.writeJson(tmpPath, request, { spaces: 2 });

      // Atomic rename
      await fs.rename(tmpPath, filePath);

      // Update cache
      this.cache.set(request.token, request);

      logger.debug(`Persisted approval request: ${request.token.substring(0, 8)}...`);
    } catch (error: any) {
      logger.error(`Failed to save approval request: ${error.message}`);
      // Clean up temp file if it exists
      await fs.remove(tmpPath).catch(() => {});
      throw error;
    }
  }

  /**
   * Get approval request by token
   */
  async get(token: string): Promise<ApprovalRequest | null> {
    await this.initialize();

    // Check cache first
    const cached = this.cache.get(token);
    if (cached) {
      // Verify not expired
      if (new Date() > cached.expiresAt) {
        await this.delete(token);
        return null;
      }
      return cached;
    }

    // Fallback: check disk (in case cache was cleared but file exists)
    const filePath = path.join(this.storageDir, `${token}.json`);
    if (await fs.pathExists(filePath)) {
      try {
        const data = await fs.readJson(filePath);
        data.createdAt = new Date(data.createdAt);
        data.expiresAt = new Date(data.expiresAt);

        if (new Date() > data.expiresAt) {
          await this.delete(token);
          return null;
        }

        this.cache.set(token, data);
        return data;
      } catch (error: any) {
        logger.error(`Failed to read approval file ${token}: ${error.message}`);
        return null;
      }
    }

    return null;
  }

  /**
   * Delete approval request
   */
  async delete(token: string): Promise<void> {
    await this.initialize();

    this.cache.delete(token);

    const filePath = path.join(this.storageDir, `${token}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }

    logger.debug(`Deleted approval request: ${token.substring(0, 8)}...`);
  }

  /**
   * Clean up expired approvals (should be run periodically)
   */
  async cleanupExpired(): Promise<number> {
    await this.initialize();

    let cleaned = 0;
    const now = new Date();

    for (const [token, request] of this.cache.entries()) {
      if (now > request.expiresAt) {
        await this.delete(token);
        cleaned++;
      }
    }

    return cleaned;
  }
}

// Singleton instance
const approvalStorage = new ApprovalStorage();

/**
 * Generates a unique approval token
 */
export function generateApprovalToken(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Creates an approval request
 */
export async function createApprovalRequest(
  taskId: string,
  clientFolder: string,
  branchName: string,
  changeSummary: ChangeSummary,
  testResult: TestResult,
  assigneeEmail?: string
): Promise<ApprovalRequest> {
  const token = generateApprovalToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

  const request: ApprovalRequest = {
    token,
    taskId,
    clientFolder,
    branchName,
    changeSummary,
    testResult,
    createdAt: new Date(),
    expiresAt,
    assigneeEmail,
  };

  // Persist to disk with atomic write
  await approvalStorage.save(request);
  logger.info(`Created approval request for task ${taskId} with token ${token.substring(0, 8)}...`);

  // Update state to awaiting approval
  await updateWorkflowState(clientFolder, taskId, WorkflowState.AWAITING_APPROVAL, {
    approvalToken: token,
    testResult,
  });

  return request;
}

/**
 * Gets an approval request by token
 */
export async function getApprovalRequest(token: string): Promise<ApprovalRequest | null> {
  const request = await approvalStorage.get(token);
  
  if (!request) {
    return null;
  }

  // Check if expired (redundant but safe)
  if (new Date() > request.expiresAt) {
    await approvalStorage.delete(token);
    logger.warn(`Approval request expired for token ${token.substring(0, 8)}...`);
    return null;
  }

  return request;
}

/**
 * Processes approval
 */
export async function approveRequest(token: string, reason?: string): Promise<boolean> {
  const request = await getApprovalRequest(token);
  
  if (!request) {
    logger.error(`Invalid or expired approval token: ${token.substring(0, 8)}...`);
    return false;
  }

  logger.info(`Approval granted for task ${request.taskId}`);
  
  // Update state to approved
  await updateWorkflowState(
    request.clientFolder,
    request.taskId,
    WorkflowState.APPROVED,
    { approvalReason: reason }
  );

  // Remove from persistent storage
  await approvalStorage.delete(token);

  return true;
}

/**
 * Processes rejection
 */
export async function rejectRequest(token: string, reason?: string): Promise<boolean> {
  const request = await getApprovalRequest(token);
  
  if (!request) {
    logger.error(`Invalid or expired approval token: ${token.substring(0, 8)}...`);
    return false;
  }

  logger.info(`Approval rejected for task ${request.taskId}: ${reason || 'No reason provided'}`);
  
  // Update state to rejected
  await updateWorkflowState(
    request.clientFolder,
    request.taskId,
    WorkflowState.REJECTED,
    { rejectionReason: reason }
  );

  // Remove from persistent storage
  await approvalStorage.delete(token);

  return true;
}

/**
 * Gets approval URL
 */
export function getApprovalUrl(token: string): string {
  const approvalConfig = require('../config/config').config.approval;
  const baseUrl = approvalConfig.email.approvalUrl.replace('{token}', token);
  return baseUrl;
}

/**
 * Gets rejection URL
 */
export function getRejectionUrl(token: string): string {
  const approvalConfig = require('../config/config').config.approval;
  const baseUrl = approvalConfig.email.approvalUrl.replace('{token}', token);
  return baseUrl.replace('/approve/', '/reject/');
}

/**
 * Initialize approval storage (called on server startup)
 */
export async function initializeApprovalStorage(): Promise<void> {
  await approvalStorage.initialize();
}/**
 * Clean up expired approval requests (should be run periodically)
 */
export async function cleanupExpiredApprovals(): Promise<number> {
  return await approvalStorage.cleanupExpired();
}