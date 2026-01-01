import { extractClientName } from '../utils/taskParser';
import { mapTaskToClient } from '../utils/clientMappingManager';
import { findClientFolder, pullLatestChanges } from '../git/repoManager';
import { createFeatureBranch, pushBranch, getDiff } from '../git/branchManager';
import { prepareWorkspace, openCursorWorkspace, triggerCursorAgent } from '../cursor/workspaceManager';
import { triggerAgent } from '../cursor/agentTrigger';
import { startCompletionDetection } from '../cursor/agentCompletionDetector';
import { detectTestFramework, runTests, saveTestResults } from '../testing/testRunner';
import { generateChangeSummary } from '../approval/changeSummarizer';
import { createApprovalRequest } from '../approval/approvalManager';
import { sendApprovalEmail, sendFailureEmail } from '../approval/emailService';
import { sendSlackNotification, sendSlackFailureNotification } from '../approval/slackService';
import { 
  WorkflowState, 
  updateWorkflowState, 
  saveTaskInfo,
  saveTaskState 
} from '../state/stateManager';
import { ClickUpTask, clickUpApiClient } from '../clickup/apiClient';
import { logger } from '../utils/logger';
import { config } from '../config/config';

/**
 * Main workflow orchestrator - processes a ClickUp task through the entire workflow
 */
export async function processTask(task: ClickUpTask): Promise<void> {
  const taskId = task.id;
  let clientFolder = '';
  logger.info(`Starting workflow for task: ${taskId} - ${task.name}`);

  try {
    // Step 1: Extract client name from task
    const extractionResult = await extractClientName(task.name, taskId);
    if (!extractionResult.clientName) {
      const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
        ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
        : '';
      throw new Error(`Could not extract client name from task: ${task.name}.${suggestionsMsg}`);
    }
    
    const clientName = extractionResult.clientName;
    logger.info(`Extracted client name: ${clientName} (confidence: ${extractionResult.confidence}, validated: ${extractionResult.validated})`);

    // Step 2: Find client folder
    const clientFolderInfo = await findClientFolder(clientName);
    if (!clientFolderInfo || !clientFolderInfo.isValid) {
      const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
        ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
        : '';
      throw new Error(`Client folder not found or invalid: ${clientName}.${suggestionsMsg}`);
    }
    clientFolder = clientFolderInfo.path;
    logger.info(`Found client folder: ${clientFolder}`);

    // Auto-save successful mapping for future use (if not already manually mapped)
    if (extractionResult.validated && extractionResult.confidence !== 'high') {
      try {
        await mapTaskToClient(taskId, clientName);
      } catch (error: any) {
        logger.warn(`Could not save mapping for task ${taskId}: ${error.message}`);
      }
    }

    // Step 3: Initialize state
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS);
    await saveTaskInfo(clientFolder, taskId, {
      task,
      taskId,
      clientName,
      clientFolder,
    });

    // Step 4: Pull latest changes
    await pullLatestChanges(clientFolder);

    // Step 5: Create feature branch
    const branchName = await createFeatureBranch(clientFolder, taskId, task.name);
    await saveTaskState(clientFolder, taskId, { branchName });

    // Step 6: Detect test framework
    const testCommand = await detectTestFramework(clientFolder);

    // Step 7: Prepare workspace and generate prompt
    await prepareWorkspace(clientFolder, task, branchName, testCommand || undefined);

    // Step 8: Open Cursor workspace
    if (config.cursor.autoOpen) {
      await openCursorWorkspace(clientFolder);
    }

    // Step 9: Trigger Cursor agent
    const promptPath = `${clientFolder}/CURSOR_TASK.md`;
    await triggerAgent(clientFolder, promptPath, task);
    await triggerCursorAgent(clientFolder, task);

    logger.info(`Workflow initiated for task ${taskId}. Agent is processing changes...`);
    
    // Step 10: Start agent completion detection (if enabled)
    if (config.cursor.agentCompletionDetection?.enabled) {
      logger.info(`Starting automatic completion detection for task ${taskId}`);
      try {
        await startCompletionDetection(clientFolder, taskId, branchName);
        logger.info(`Completion detection started. Workflow will continue automatically when agent finishes.`);
      } catch (detectionError: any) {
        logger.error(`Error starting completion detection: ${detectionError.message}`);
        logger.warn(`Workflow will continue, but manual trigger may be required via /workflow/continue/:taskId`);
        // Don't throw - allow workflow to continue, detection might not be critical
      }
    } else {
      logger.info(`Agent completion detection is disabled. Use /workflow/continue/${taskId} to manually continue workflow.`);
    }

  } catch (error: any) {
    logger.error(`Error processing task ${taskId}: ${error.message}`);
    // Try to update state to error
    try {
      if (clientFolder) {
        await updateWorkflowState(
          clientFolder,
          taskId,
          WorkflowState.ERROR,
          { error: error.message }
        );
      } else {
        // Fallback: try to extract it again if not already found
        const extractionResult = await extractClientName(task.name, taskId);
        if (extractionResult.clientName) {
          const clientFolderInfo = await findClientFolder(extractionResult.clientName);
          if (clientFolderInfo) {
            await updateWorkflowState(
              clientFolderInfo.path,
              taskId,
              WorkflowState.ERROR,
              { error: error.message }
            );
          }
        }
      }
    } catch (stateError) {
      // Ignore state update errors
    }
    throw error;
  }
}

/**
 * Continues workflow after agent completion (tests, approval, push)
 */
export async function continueWorkflowAfterAgent(
  clientFolder: string,
  taskId: string
): Promise<void> {
  logger.info(`Continuing workflow for task ${taskId} after agent completion`);

  try {
    // Load task state and info
    const { loadTaskState, loadTaskInfo } = require('../state/stateManager');
    const state = await loadTaskState(clientFolder, taskId);
    const taskInfo = await loadTaskInfo(clientFolder, taskId);
    
    if (!state || !state.branchName) {
      throw new Error(`Task state not found or branch name missing for task ${taskId}`);
    }

    const branchName = state.branchName;
    const assigneeEmail = taskInfo?.task?.assignees?.[0]?.email;

    // Step 1: Update state to testing
    await updateWorkflowState(clientFolder, taskId, WorkflowState.TESTING);

    // Step 2: Detect and run tests
    const testCommand = await detectTestFramework(clientFolder);
    const testResult = await runTests(clientFolder, testCommand || undefined);
    await saveTestResults(clientFolder, taskId, testResult);

    // Step 3: If tests fail, notify and stop
    if (!testResult.success) {
      logger.error(`Tests failed for task ${taskId}`);
      await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
        testError: testResult.error,
      });
      
      // Send failure notifications
      if (config.approval.method === 'email') {
        await sendFailureEmail(taskId, testResult, assigneeEmail);
      } else if (config.approval.method === 'slack') {
        await sendSlackFailureNotification(taskId, testResult);
      }
      
      // Add comment to ClickUp
      try {
        const comment = `❌ Workflow failed during testing.\n\nError: ${testResult.error || 'Tests failed'}\n\nManual intervention is required.`;
        await clickUpApiClient.addComment(taskId, comment);
      } catch (commentError: any) {
        logger.warn(`Could not add failure comment to ClickUp task ${taskId}: ${commentError.message}`);
      }
      
      return;
    }

    // Step 4: Generate change summary
    const changeSummary = await generateChangeSummary(clientFolder, branchName);

    // Step 5: Create approval request and send notifications
    const { createApprovalRequest } = require('../approval/approvalManager');
    const approvalRequest = await createApprovalRequest(
      taskId,
      clientFolder,
      branchName,
      changeSummary,
      testResult,
      assigneeEmail
    );

    // Send notifications based on config
    if (config.approval.method === 'email') {
      await sendApprovalEmail(approvalRequest);
    } else if (config.approval.method === 'slack') {
      await sendSlackNotification(approvalRequest);
    }

    logger.info(`Approval request created for task ${taskId}`);

  } catch (error: any) {
    logger.error(`Error continuing workflow for task ${taskId}: ${error.message}`);
    await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Completes workflow after approval (pushes to GitHub)
 */
export async function completeWorkflowAfterApproval(
  clientFolder: string,
  taskId: string
): Promise<void> {
  logger.info(`Completing workflow for task ${taskId} after approval`);

  try {
    // Load task state
    const { loadTaskState } = require('../state/stateManager');
    const state = await loadTaskState(clientFolder, taskId);
    if (!state || !state.branchName) {
      throw new Error(`Task state not found or branch name missing for task ${taskId}`);
    }

    const branchName = state.branchName;

    // Step 1: Push branch to GitHub
    await pushBranch(clientFolder, branchName);

    // Step 2: Update state to completed
    await updateWorkflowState(clientFolder, taskId, WorkflowState.COMPLETED);

    // Step 3: Update ClickUp task
    try {
      const comment = `✅ Workflow completed successfully.\n\nBranch \`${branchName}\` has been pushed to GitHub.`;
      await clickUpApiClient.addComment(taskId, comment);
      logger.info(`Added completion comment to ClickUp task ${taskId}`);
    } catch (commentError: any) {
      logger.warn(`Could not add completion comment to ClickUp task ${taskId}: ${commentError.message}`);
    }

    logger.info(`Workflow completed for task ${taskId}. Branch ${branchName} pushed to GitHub.`);

  } catch (error: any) {
    logger.error(`Error completing workflow for task ${taskId}: ${error.message}`);
    await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
      error: error.message,
    });
    throw error;
  }
}














