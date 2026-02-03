import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as fs from 'fs-extra';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { ensureCleanWorkingDirectory, getCurrentCommitHash } from '../git/repoManager';
import { generatePromptFile } from './promptGenerator';
import { ClickUpTask } from '../clickup/apiClient';
import { fetchAttachments } from '../clickup/fetchAttachments';
import { getAccessToken } from '../clickup/oauthService';
import { agentQueue } from './agentQueue';
import { saveRunMetadata } from './runMetadata';
import { saveTaskState } from '../state/stateManager';
import { WorkflowState } from '../state/stateManager';
import { visualTester } from '../utils/visualTesting';

const execAsync = promisify(exec);

/**
 * Gets the ClickUp authorization token
 */
async function getClickUpToken(): Promise<string | null> {
  try {
    const oauthToken = await getAccessToken();
    if (oauthToken) return oauthToken;
    
    if (config.clickup.apiToken && config.clickup.apiToken !== 'placeholder') {
      return config.clickup.apiToken;
    }
    
    if (config.clickup.accessToken) {
      return config.clickup.accessToken;
    }
  } catch (err) {
    logger.warn(`Error getting ClickUp token: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/**
 * Helper to fetch attachments and return downloaded paths
 */
async function fetchTaskAttachments(taskId: string, clientFolder: string): Promise<string[]> {
  try {
    const clickupToken = await getClickUpToken();
    if (!clickupToken) {
      logger.warn(`No ClickUp token found, skipping attachment fetch for task ${taskId}`);
      return [];
    }

    logger.info(`Fetching attachments for task ${taskId}...`);
    const result = await fetchAttachments({
      taskId,
      clientFolder,
      clickupToken
    });
    
    if (result.downloaded.length > 0) {
      logger.info(`Downloaded ${result.downloaded.length} attachments for task ${taskId}`);
    }
    return result.downloaded;
  } catch (error) {
    logger.warn(`Failed to fetch attachments for task ${taskId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Opens Cursor workspace with the specified folder
 */
export async function openCursorWorkspace(folderPath: string): Promise<void> {
  logger.info(`Opening Cursor workspace: ${folderPath}`);
  
  try {
    const cliPath = config.cursor.cliPath || 'cursor';
    const command = `"${cliPath}" "${folderPath}"`;
    
    await execAsync(command);
    logger.info(`Successfully opened Cursor workspace`);
  } catch (error: any) {
    logger.error(`Error opening Cursor workspace: ${error.message}`);
    // Don't throw - Cursor might already be open or CLI might not be available
    logger.warn('Continuing despite Cursor open error - workspace may already be open');
  }
}

/**
 * Prepares workspace: ensures clean state, creates prompt file
 */
export async function prepareWorkspace(
  clientFolder: string,
  task: ClickUpTask,
  branchName: string,
  testCommand?: string
): Promise<string> {
  logger.info(`Preparing workspace: ${clientFolder}`);
  
  // Check if working directory is clean
  const isClean = await ensureCleanWorkingDirectory(clientFolder);
  if (!isClean) {
    logger.warn(`Working directory is not clean in ${clientFolder}`);
  }

  // Get base commit for diffing later
  const baseCommit = await getCurrentCommitHash(clientFolder) || 'HEAD';
  
  // Load current state to get iteration
  const { loadTaskState } = await import('../state/stateManager');
  const taskState = await loadTaskState(clientFolder, task.id);
  const iteration = taskState?.revisions?.length || 0;

  // Save run metadata
  await saveRunMetadata({
    taskId: task.id,
    workspacePath: clientFolder,
    baseCommit,
    startedAt: new Date().toISOString(),
    clientFolder,
    iteration
  });

  // Update task state with base commit
  await saveTaskState(clientFolder, task.id, {
    baseCommitHash: baseCommit,
    state: WorkflowState.IN_PROGRESS
  });
  
  const client = task.custom_fields?.find(f => f.name === 'Client Name')?.value || 'Unknown';
  
  // Generate prompt file - ONLY if it doesn't already exist or belongs to a different task
  const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  if (!(await shouldGeneratePrompt(promptPath, task.id))) {
    logger.info(`Preserving existing CURSOR_TASK.md for task ${task.id} at ${promptPath}`);
    return promptPath;
  }
  
  // Fetch attachments before generating prompt
  const attachments = await fetchTaskAttachments(task.id, clientFolder);
  
  return await generatePromptFile(clientFolder, client, task, branchName, testCommand, attachments);
}

/**
 * Patches an existing CURSOR_TASK.md with feedback from a rejection
 */
export async function patchPromptWithFeedback(
  clientFolder: string,
  taskId: string,
  feedback: string,
  iteration: number
): Promise<void> {
  const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  
  if (!(await fs.pathExists(promptPath))) {
    logger.warn(`Cannot patch CURSOR_TASK.md for task ${taskId}: file not found at ${promptPath}`);
    return;
  }

  try {
    let content = await fs.readFile(promptPath, 'utf-8');
    
    // REQUIREMENT: Preserve historical instructions in run folder
    const runDir = path.join(clientFolder, '.cursor', 'runs', `run_${iteration - 1}`);
    await fs.ensureDir(runDir);
    await fs.writeFile(path.join(runDir, 'CURSOR_TASK.md'), content, 'utf-8');
    logger.info(`Preserved historical instructions for task ${taskId} in run_${iteration - 1}`);

    // Add the feedback section at the end of the file
    const feedbackSection = `\n\n## User Change Requests (Iteration ${iteration})\n${feedback}\n`;
    content += feedbackSection;
    
    // Update the Status in metadata if it exists
    content = content.replace(/\*\*Status\*\*:\s*.*/i, '**Status**: in progress (revision)');
    
    await fs.writeFile(promptPath, content, 'utf-8');
    logger.info(`Patched CURSOR_TASK.md with feedback for task ${taskId} (Iteration ${iteration})`);
  } catch (error: any) {
    logger.error(`Error patching CURSOR_TASK.md for task ${taskId}: ${error.message}`);
    throw error;
  }
}

/**
 * Applies pending agent feedback to CURSOR_TASK.md before agent run
 * Returns the IDs of feedback that was applied
 */
export async function applyPendingAgentFeedback(
  clientFolder: string,
  taskId: string
): Promise<string[]> {
  const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  
  if (!(await fs.pathExists(promptPath))) {
    logger.debug(`No CURSOR_TASK.md found for task ${taskId}, skipping feedback application`);
    return [];
  }

  try {
    const { loadTaskState, getPendingFeedback, markFeedbackApplied } = await import('../state/stateManager');
    const taskState = await loadTaskState(clientFolder, taskId);
    const pendingFeedback = getPendingFeedback(taskState);

    if (pendingFeedback.length === 0) {
      logger.debug(`No pending feedback to apply for task ${taskId}`);
      return [];
    }

    let content = await fs.readFile(promptPath, 'utf-8');
    
    // Build feedback section
    const feedbackItems = pendingFeedback.map((fb, idx) => {
      const date = new Date(fb.timestamp).toLocaleString();
      return `### Feedback ${idx + 1} (${date})\n${fb.feedback}`;
    }).join('\n\n');
    
    const feedbackSection = `\n\n## User Feedback to Apply\n\nThe user has provided the following feedback. Please address each item:\n\n${feedbackItems}\n`;
    
    // Check if there's already a feedback section (to avoid duplicates)
    if (content.includes('## User Feedback to Apply')) {
      // Replace existing section
      content = content.replace(/\n\n## User Feedback to Apply[\s\S]*?(?=\n\n##|$)/, feedbackSection);
    } else {
      // Append to end
      content += feedbackSection;
    }
    
    await fs.writeFile(promptPath, content, 'utf-8');
    
    // Mark feedback as applied
    const feedbackIds = pendingFeedback.map(fb => fb.id);
    await markFeedbackApplied(clientFolder, taskId, feedbackIds);
    
    logger.info(`Applied ${pendingFeedback.length} pending feedback items for task ${taskId}`);
    return feedbackIds;
  } catch (error: any) {
    logger.error(`Error applying pending feedback for task ${taskId}: ${error.message}`);
    return [];
  }
}

export interface TriggerCursorAgentOptions {
  model?: string;
}

/**
 * Triggers Cursor agent to process the task
 */
export async function triggerCursorAgent(
  clientFolder: string,
  task: ClickUpTask,
  options?: TriggerCursorAgentOptions
): Promise<void> {
  const { triggerAgent } = await import('./agentTrigger');
  const { updateWorkflowState, WorkflowState, loadTaskState } = await import('../state/stateManager');
  const { taskStatusManager } = await import('./taskStatusManager');
  const { agentQueue } = await import('./agentQueue');
  
  logger.info(`Triggering Cursor agent for task: ${task.id}`);

  // 0. RESET: Clear any stale status file from previous runs
  try {
    await taskStatusManager.resetStatus(task.id, clientFolder);
  } catch (resetErr) {
    logger.warn(`Failed to reset status for task ${task.id}: ${resetErr}`);
  }

  // 1. Guard against triggering agent while demo is still being prepared
  try {
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      const { isDemoInActiveCreation } = await import('../handlers/demoHandler');
      
      // If the demo is in an active creation state, and we ARE NOT the one triggering it
      // (i.e. the state is not 'triggering' which is what demoHandler sets before calling us),
      // then we should block this manual/external trigger.
      if (isDemoInActiveCreation(status) && status.state !== 'triggering') {
        const errorMsg = `Cannot trigger agent for ${task.id}: Demo is currently in ${status.state} state. Please wait for template setup to complete.`;
        logger.warn(errorMsg);
        throw new Error(errorMsg);
      }
    }
  } catch (guardError: any) {
    if (guardError.message.includes('Cannot trigger agent')) {
      throw guardError;
    }
    // Ignore other errors (e.g. status file read errors) and proceed
  }

  // 2. Initial setup for status reporting
  try {
    await fs.ensureDir(path.join(clientFolder, '.cursor', 'status'));
    await fs.ensureDir(path.join(clientFolder, '.cursor', 'status', 'tmp'));
    
    await taskStatusManager.updateStatus(task.id, {
      state: 'STARTING',
      step: 'Initializing agent flow',
      percent: 5,
    }, clientFolder);
  } catch (err) {
    logger.warn(`Initial setup failed for task ${task.id}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Queueing logic
  await agentQueue.initialize();

  let branchName = 'main';
  try {
    const state = await loadTaskState(clientFolder, task.id);
    branchName = state?.branchName || 'main';
  } catch (error) {
    logger.warn(`Could not load state for task ${task.id}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const triggerMode = config.cursor.triggerMode || 'queue';
  
  if (triggerMode === 'queue') {
    try {
      const potentialRunningPath = path.join(clientFolder, '.cursor', 'running', `_${task.id}.md`);
      await agentQueue.validateTaskCreation(potentialRunningPath);

      await agentQueue.enqueueTask(task, clientFolder, branchName);
      logger.info(`Task ${task.id} enqueued in .cursor/queue/`);
      
      await taskStatusManager.updateStatus(task.id, {
        step: 'Initializing (Waiting for Queue)',
        percent: 50
      }, clientFolder);

      // Attempt to claim immediately, prioritizing this task if the agent is free
      const claimed = await agentQueue.claimNextTask(task.id);
      
      if (!claimed || claimed.metadata.taskId !== task.id) {
        const msg = claimed 
          ? `Task ${task.id} enqueued but another task (${claimed.metadata.taskId}) took precedence.`
          : `Task ${task.id} enqueued and is waiting for the agent to become available.`;
        logger.info(msg);
        
        await taskStatusManager.updateStatus(task.id, {
          state: 'STARTING',
          step: 'Queued',
          percent: 50,
          notes: msg
        }, clientFolder);
        return; 
      }
    } catch (error: any) {
      logger.error(`Task Lifecycle Error: ${error.message}`);
      await taskStatusManager.updateStatus(task.id, {
        state: 'FAILED',
        error: error.message
      }, clientFolder);
      return;
    }
  }

  // 3. Trigger the agent
  const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  
  await taskStatusManager.updateStatus(task.id, {
    step: 'Starting Agent',
    percent: 80
  }, clientFolder);

  // CRITICAL: Update workflow state to IN_PROGRESS so frontend shows correct status
  // This is the authoritative state stored in .clickup-workflow/{taskId}/state.json
  try {
    await updateWorkflowState(clientFolder, task.id, WorkflowState.IN_PROGRESS, undefined, 'Agent starting...');
    logger.info(`Updated task ${task.id} workflow state to IN_PROGRESS`);
  } catch (stateErr) {
    logger.warn(`Failed to update workflow state for task ${task.id}: ${stateErr}`);
    // Continue anyway - the agent can still run
  }

  try {
    // triggerAgent is internally non-blocking
    await triggerAgent(clientFolder, promptPath, task, { model: options?.model });
    
    // 4. Start completion detection
    if (config.cursor.agentCompletionDetection?.enabled) {
      const { startCompletionDetection } = await import('./agentCompletionDetector');
      await startCompletionDetection(clientFolder, task.id, branchName);
    }
  } catch (error: any) {
    logger.error(`Could not trigger agent: ${error.message}`);
    await taskStatusManager.updateStatus(task.id, {
      state: 'FAILED',
      error: `Agent trigger failed: ${error.message}`
    }, clientFolder);
    throw error;
  }
}

/**
 * Checks if we should generate a new prompt file or preserve the existing one.
 * Returns true if a new prompt should be generated.
 */
async function shouldGeneratePrompt(promptPath: string, taskId: string): Promise<boolean> {
  if (!(await fs.pathExists(promptPath))) {
    return true;
  }

  try {
    const content = await fs.readFile(promptPath, 'utf-8');
    // Check if the Task ID in the file matches the current taskId
    const taskIdMatch = content.match(/\*\*Task ID\*\*:\s*([a-zA-Z0-9_-]+)/i) || 
                       content.match(/Task ID:\s*([a-zA-Z0-9_-]+)/i);
    
    if (taskIdMatch && taskIdMatch[1] === taskId) {
      // It's the same task, preserve existing file (allows manual edits)
      return false;
    }
    
    logger.info(`Existing CURSOR_TASK.md belongs to a different task (${taskIdMatch ? taskIdMatch[1] : 'unknown'}). Generating new prompt for ${taskId}.`);
  } catch (error) {
    logger.warn(`Could not read existing prompt file: ${error instanceof Error ? error.message : String(error)}`);
  }

  return true;
}















