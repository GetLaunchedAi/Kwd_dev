import { randomBytes } from 'crypto';
import { logger } from '../utils/logger';
import { WorkflowState, updateWorkflowState } from '../state/stateManager';
import { ChangeSummary } from './changeSummarizer';
import { TestResult } from '../testing/testRunner';

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

// In-memory storage for approval requests (in production, use a database)
const approvalRequests = new Map<string, ApprovalRequest>();

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

  approvalRequests.set(token, request);
  logger.info(`Created approval request for task ${taskId} with token ${token.substring(0, 8)}...`);

  // Update state to awaiting approval
  await updateWorkflowState(clientFolder, taskId, WorkflowState.AWAITING_APPROVAL, {
    approvalToken: token,
  });

  return request;
}

/**
 * Gets an approval request by token
 */
export function getApprovalRequest(token: string): ApprovalRequest | null {
  const request = approvalRequests.get(token);
  
  if (!request) {
    return null;
  }

  // Check if expired
  if (new Date() > request.expiresAt) {
    approvalRequests.delete(token);
    logger.warn(`Approval request expired for token ${token.substring(0, 8)}...`);
    return null;
  }

  return request;
}

/**
 * Processes approval
 */
export async function approveRequest(token: string, reason?: string): Promise<boolean> {
  const request = getApprovalRequest(token);
  
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

  // Remove from pending requests
  approvalRequests.delete(token);

  return true;
}

/**
 * Processes rejection
 */
export async function rejectRequest(token: string, reason?: string): Promise<boolean> {
  const request = getApprovalRequest(token);
  
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

  // Remove from pending requests
  approvalRequests.delete(token);

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

