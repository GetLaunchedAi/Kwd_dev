import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import { ClickUpTask } from '../clickup/apiClient';
import { config } from '../config/config';

export enum WorkflowState {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  TESTING = 'testing',
  AWAITING_APPROVAL = 'awaiting_approval',
  APPROVED = 'approved',
  REJECTED = 'rejected',
  COMPLETED = 'completed',
  ERROR = 'error',
}

export interface Revision {
  iteration: number;
  timestamp: string;
  feedback: string;
}

export interface TaskState {
  taskId: string;
  state: WorkflowState;
  clientFolder: string;
  branchName?: string;
  createdAt: string;
  updatedAt: string;
  error?: string;
  currentStep?: string;
  command?: string;
  metadata?: Record<string, any>;
  baseCommitHash?: string;
  agentCompletion?: {
    detectionStartedAt?: string;
    lastCheckedAt?: string;
    completionDetectedAt?: string;
  };
  revisions?: Revision[];
  lastRejectionAt?: string;
  lastRejectionFeedback?: string;
}

export interface TaskInfo {
  task: ClickUpTask;
  taskId: string;
  clientName?: string;
  clientFolder?: string;
}

/**
 * Gets the state directory path for a task
 */
function getStateDir(clientFolder: string, taskId: string): string {
  return path.join(clientFolder, '.clickup-workflow', taskId);
}

/**
 * Gets the state file path
 */
function getStateFilePath(clientFolder: string, taskId: string): string {
  return path.join(getStateDir(clientFolder, taskId), 'state.json');
}

/**
 * Gets the task info file path
 */
function getTaskInfoFilePath(clientFolder: string, taskId: string): string {
  return path.join(getStateDir(clientFolder, taskId), 'task-info.json');
}

/**
 * Creates state directory if it doesn't exist
 */
async function ensureStateDir(clientFolder: string, taskId: string): Promise<string> {
  const stateDir = getStateDir(clientFolder, taskId);
  await fs.ensureDir(stateDir);
  return stateDir;
}

/**
 * Saves task state
 */
export async function saveTaskState(
  clientFolder: string,
  taskId: string,
  state: Partial<TaskState>
): Promise<TaskState> {
  await ensureStateDir(clientFolder, taskId);
  
  const stateFilePath = getStateFilePath(clientFolder, taskId);
  const existingState = await loadTaskState(clientFolder, taskId);
  
  const updatedState: TaskState = {
    ...existingState,
    ...state,
    taskId: taskId,
    clientFolder: clientFolder,
    state: state.state || existingState?.state || WorkflowState.PENDING,
    branchName: state.branchName || existingState?.branchName || config.git.devBranch || 'main',
    createdAt: existingState?.createdAt || state.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  await fs.writeJson(stateFilePath, updatedState, { spaces: 2 });
  logger.debug(`Saved task state for ${taskId}: ${updatedState.state}`);
  
  return updatedState;
}

/**
 * Loads task state
 */
export async function loadTaskState(
  clientFolder: string,
  taskId: string
): Promise<TaskState | null> {
  const stateFilePath = getStateFilePath(clientFolder, taskId);
  
  if (!fs.existsSync(stateFilePath)) {
    return null;
  }

  try {
    const state = await fs.readJson(stateFilePath) as TaskState;
    return state;
  } catch (error: any) {
    logger.error(`Error loading task state: ${error.message}`);
    return null;
  }
}

/**
 * Saves task info
 */
export async function saveTaskInfo(
  clientFolder: string,
  taskId: string,
  taskInfo: TaskInfo
): Promise<void> {
  await ensureStateDir(clientFolder, taskId);
  
  const taskInfoFilePath = getTaskInfoFilePath(clientFolder, taskId);
  await fs.writeJson(taskInfoFilePath, taskInfo, { spaces: 2 });
  logger.debug(`Saved task info for ${taskId}`);
}

/**
 * Loads task info
 */
export async function loadTaskInfo(
  clientFolder: string,
  taskId: string
): Promise<TaskInfo | null> {
  const taskInfoFilePath = getTaskInfoFilePath(clientFolder, taskId);
  
  if (!fs.existsSync(taskInfoFilePath)) {
    return null;
  }

  try {
    const taskInfo = await fs.readJson(taskInfoFilePath) as TaskInfo;
    return taskInfo;
  } catch (error: any) {
    logger.error(`Error loading task info: ${error.message}`);
    return null;
  }
}

/**
 * Rejects a task with feedback
 */
export async function rejectTask(
  clientFolder: string,
  taskId: string,
  feedback: string
): Promise<TaskState> {
  const currentState = await loadTaskState(clientFolder, taskId);
  if (!currentState) {
    throw new Error(`Task state not found for ${taskId}`);
  }

  const revisions = currentState.revisions || [];
  const nextIteration = revisions.length + 1;
  const timestamp = new Date().toISOString();

  const newRevision: Revision = {
    iteration: nextIteration,
    timestamp,
    feedback,
  };

  return await saveTaskState(clientFolder, taskId, {
    ...currentState,
    state: WorkflowState.REJECTED,
    revisions: [...revisions, newRevision],
    lastRejectionAt: timestamp,
    lastRejectionFeedback: feedback,
    updatedAt: timestamp,
  });
}


/**
 * Updates workflow state
 */
export async function updateWorkflowState(
  clientFolder: string,
  taskId: string,
  newState: WorkflowState,
  metadata?: Record<string, any>,
  currentStep?: string
): Promise<TaskState> {
  const currentState = await loadTaskState(clientFolder, taskId);
  
  return await saveTaskState(clientFolder, taskId, {
    ...currentState,
    state: newState,
    currentStep: currentStep !== undefined ? currentStep : currentState?.currentStep,
    metadata: {
      ...(currentState?.metadata || {}),
      ...(metadata || {}),
    },
  });
}












