import { extractClientName } from '../utils/taskParser';
import { mapTaskToClient } from '../utils/clientMappingManager';
import { findClientFolder } from '../git/repoManager';
import { ensureDevBranch, pushBranch, getDiff } from '../git/branchManager';
import { validateGitSetup } from '../git/gitValidator';
import { 
  prepareWorkspace, 
  openCursorWorkspace, 
  triggerCursorAgent,
  patchPromptWithFeedback
} from '../cursor/workspaceManager';
import { triggerAgent } from '../cursor/agentTrigger';
import { taskCleanupService } from '../cursor/taskCleanupService';
import { detectTestFramework, runTests, saveTestResults } from '../testing/testRunner';
import { generateChangeSummary, ChangeSummary } from '../approval/changeSummarizer';
import { createApprovalRequest } from '../approval/approvalManager';
import { sendApprovalEmail, sendFailureEmail } from '../approval/emailService';
import { sendSlackNotification, sendSlackFailureNotification } from '../approval/slackService';
import { visualTester } from '../utils/visualTesting';
import { saveArtifact, loadRunMetadata } from '../cursor/runMetadata';
import { 
  WorkflowState, 
  updateWorkflowState, 
  saveTaskInfo,
  saveTaskState,
  loadTaskState,
  loadTaskInfo,
  rejectTask,
  saveStepCheckpoint,
  markStepFailed,
  clearFailedStepMarker,
  acquireRetryLock,
  releaseRetryLock,
  getRecoveryState,
  updateTaskState
} from '../state/stateManager';
import { createCheckpoint, findRecoveryCheckpoint } from '../state/checkpointService';
import { rollbackToCheckpoint, skipFailedStep, generateRollbackPreview } from '../git/rollbackService';
import { getCurrentCommitHash } from '../git/branchManager';
import { ClickUpTask, clickUpApiClient } from '../clickup/apiClient';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { demoContextLock } from '../utils/fileLock';
import * as fs from 'fs-extra';
import * as path from 'path';

/**
 * Main workflow orchestrator - processes a ClickUp task through the entire workflow
 */
export async function processTask(task: ClickUpTask): Promise<void> {
  const taskId = task.id;
  let clientFolder = '';
  logger.info(`Starting workflow for task: ${taskId} - ${task.name}`);

  try {
    // Step 1: Extract client name from task
    const extractionResult = await extractClientName(task.name, taskId, task);
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

    // Step 2.5: Validate git setup (repository initialization and config)
    const gitValidation = await validateGitSetup(clientFolder, taskId, true);
    if (!gitValidation.isValid) {
      const errorMsg = `Git validation failed: ${gitValidation.errors.join('; ')}`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    if (gitValidation.warnings.length > 0) {
      logger.warn(`Git validation warnings for ${taskId}: ${gitValidation.warnings.join('; ')}`);
    }

    // Step 2.6: Take initial screenshots before any changes
    let appStarted = false;
    try {
      logger.info(`Taking initial screenshots for task ${taskId}`);
      await updateWorkflowState(clientFolder, taskId, WorkflowState.PENDING, undefined, 'Taking initial screenshots');
      const url = await visualTester.startApp(clientFolder);
      appStarted = true;
      
      // Wait for app to fully initialize (warmup delay)
      logger.info(`Waiting for app warmup before screenshots...`);
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second warmup
      
      // Verify app is responding (with error protection)
      try {
        const healthCheck = await visualTester.performHealthCheck(url);
        if (healthCheck.errors.length > 0) {
          logger.warn(`App health check found ${healthCheck.errors.length} issues, but continuing with screenshots`);
        }
      } catch (healthError: any) {
        logger.warn(`Health check failed: ${healthError.message}, but continuing with screenshots`);
      }
      
      // Use comprehensive site screenshots if enabled, otherwise fallback to simple mode
      const useFullScreenshots = config.screenshots?.fullSiteCapture ?? true;
      let screenshotResult;
      
      if (useFullScreenshots) {
        screenshotResult = await visualTester.takeSiteScreenshots(url, taskId, 'before', 0, {
          maxPages: config.screenshots?.maxPages ?? 20,
          captureSections: config.screenshots?.captureSections ?? true
        }, clientFolder);
      }
      
      // Fallback to simple screenshots if full capture failed or is disabled
      const screenshots = screenshotResult 
        ? [`/screenshots/${taskId}/before_0/home/__fullpage.png`]
        : await visualTester.takeScreenshots(url, taskId, 'before');
      
      // Save screenshot info to state
      await updateWorkflowState(clientFolder, taskId, WorkflowState.PENDING, {
        initialScreenshots: screenshots,
        screenshotManifest: screenshotResult?.manifestPath
      });
    } catch (screenshotError: any) {
      logger.error(`Failed to capture before screenshots: ${screenshotError.message}`);
      await updateWorkflowState(clientFolder, taskId, WorkflowState.PENDING, {
        screenshotError: screenshotError.message,
        screenshotSkipped: true
      }).catch(() => {}); // Don't fail if state update fails
    } finally {
      // Always stop the app to prevent resource leaks
      if (appStarted) {
        try {
          await visualTester.stopApp(clientFolder);
        } catch (stopError: any) {
          logger.warn(`Failed to stop app after before screenshots: ${stopError.message}`);
        }
      }
    }

    // Auto-save successful mapping for future use (if not already manually mapped)
    if (extractionResult.validated && extractionResult.confidence !== 'high') {
      try {
        await mapTaskToClient(taskId, clientName);
      } catch (error: any) {
        logger.warn(`Could not save mapping for task ${taskId}: ${error.message}`);
      }
    }

    // Step 3: Initialize state
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Preparing task');
    await saveTaskInfo(clientFolder, taskId, {
      task,
      taskId,
      clientName,
      clientFolder,
    });

    // Step 4: Ensure development branch exists
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Ensuring development branch');
    const branchName = await ensureDevBranch(clientFolder);
    await saveTaskState(clientFolder, taskId, { branchName });

    // Step 6: Detect test framework
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Detecting test framework');
    const testCommand = await detectTestFramework(clientFolder);

    // Step 7: Prepare workspace and generate prompt
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Preparing workspace');
    await prepareWorkspace(clientFolder, task, branchName, testCommand || undefined);

    // Step 8: Open Cursor workspace
    if (config.cursor.autoOpen) {
      await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Opening Cursor');
      await openCursorWorkspace(clientFolder);
    }

    // Step 9: Trigger Cursor agent
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, undefined, 'Triggering Cursor agent');
    await triggerCursorAgent(clientFolder, task);

    logger.info(`Workflow initiated for task ${taskId}. Agent is processing changes...`);

  } catch (error: any) {
    logger.error(`Error processing task ${taskId}: ${error.message}`);
    
    // Categorize the error for better reporting
    const errorInfo: Record<string, any> = { error: error.message };
    
    if (error.creditError || /usage.?limit|credit|quota/i.test(error.message)) {
      errorInfo.creditError = true;
      errorInfo.errorCategory = 'credit_limit';
      errorInfo.userMessage = 'AI credits exhausted. Please wait for credits to reset.';
    } else if (error.modelError || /model.*unavailable/i.test(error.message)) {
      errorInfo.modelError = true;
      errorInfo.errorCategory = 'model_error';
    } else if (/auth|unauthorized|not authenticated/i.test(error.message)) {
      errorInfo.errorCategory = 'auth_error';
    } else if (/ECONNREFUSED|ENOTFOUND|network/i.test(error.message)) {
      errorInfo.errorCategory = 'network_error';
    }
    
    // Try to update state to error
    try {
      if (clientFolder) {
        await updateWorkflowState(
          clientFolder,
          taskId,
          WorkflowState.ERROR,
          errorInfo
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
              errorInfo
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

// ISSUE 3 FIX: Track in-flight workflow continuations to prevent duplicates
const workflowContinuationLocks = new Map<string, { timestamp: number; promise: Promise<void> }>();
const WORKFLOW_LOCK_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes max lock time
const WORKFLOW_LOCK_CLEANUP_INTERVAL_MS = 60 * 1000; // Cleanup every minute

// FIX: Periodic cleanup of stale workflow locks to prevent memory leaks
// This handles cases where the finally block doesn't execute (process crash, unhandled rejection)
let workflowLockCleanupInterval: NodeJS.Timeout | null = null;

function startWorkflowLockCleanup(): void {
  if (workflowLockCleanupInterval) return;
  
  workflowLockCleanupInterval = setInterval(() => {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [lockKey, lockData] of workflowContinuationLocks.entries()) {
      const lockAge = now - lockData.timestamp;
      if (lockAge > WORKFLOW_LOCK_TIMEOUT_MS) {
        workflowContinuationLocks.delete(lockKey);
        cleanedCount++;
        logger.debug(`Cleaned up stale workflow lock: ${lockKey} (age: ${Math.round(lockAge / 1000)}s)`);
      }
    }
    
    if (cleanedCount > 0) {
      logger.info(`Cleaned up ${cleanedCount} stale workflow continuation lock(s)`);
    }
  }, WORKFLOW_LOCK_CLEANUP_INTERVAL_MS);
  
  // Don't prevent process exit
  workflowLockCleanupInterval.unref();
}

// Export for graceful shutdown
export function stopWorkflowLockCleanup(): void {
  if (workflowLockCleanupInterval) {
    clearInterval(workflowLockCleanupInterval);
    workflowLockCleanupInterval = null;
  }
}

// Start cleanup on module load
startWorkflowLockCleanup();

/**
 * Continues workflow after agent completion (tests, approval, push)
 */
export async function continueWorkflowAfterAgent(
  clientFolder: string,
  runId: string // runId might be taskId or agentRunId (for demo steps)
): Promise<void> {
  // ISSUE 3 FIX: Prevent duplicate workflow continuations using a lock mechanism
  const lockKey = `${clientFolder}:${runId}`;
  const existingLock = workflowContinuationLocks.get(lockKey);
  
  if (existingLock) {
    const lockAge = Date.now() - existingLock.timestamp;
    if (lockAge < WORKFLOW_LOCK_TIMEOUT_MS) {
      logger.warn(`Skipping duplicate workflow continuation for ${runId} - already in progress (started ${Math.round(lockAge / 1000)}s ago)`);
      // Wait for the existing workflow to complete instead of starting a duplicate
      try {
        await existingLock.promise;
      } catch (e) {
        // Existing workflow failed, but we still shouldn't start a new one
        logger.debug(`Existing workflow for ${runId} failed, but not retrying from duplicate call`);
      }
      return;
    } else {
      // Lock is stale, remove it
      logger.warn(`Stale workflow lock found for ${runId} (${Math.round(lockAge / 1000)}s old), proceeding with new workflow`);
      workflowContinuationLocks.delete(lockKey);
    }
  }
  
  // Create a promise that we can await and track
  let resolveWorkflow: () => void;
  let rejectWorkflow: (err: Error) => void;
  const workflowPromise = new Promise<void>((resolve, reject) => {
    resolveWorkflow = resolve;
    rejectWorkflow = reject;
  });
  
  workflowContinuationLocks.set(lockKey, { timestamp: Date.now(), promise: workflowPromise });
  
  try {
    await _continueWorkflowAfterAgentInternal(clientFolder, runId);
    resolveWorkflow!();
  } catch (error) {
    rejectWorkflow!(error as Error);
    throw error;
  } finally {
    // Clean up the lock after completion
    workflowContinuationLocks.delete(lockKey);
  }
}

/**
 * Internal implementation of workflow continuation
 */
async function _continueWorkflowAfterAgentInternal(
  clientFolder: string,
  runId: string
): Promise<void> {
  logger.info(`Continuing workflow for run ${runId} after agent completion`);

  // 1. Load state and info early
  const state = await loadTaskState(clientFolder, runId);
  const runInfo = await loadTaskInfo(clientFolder, runId);
  
  if (!state || !state.branchName) {
    throw new Error(`Task state not found or branch name missing for run ${runId}`);
  }

  // CRITICAL: Distinguish between the current run ID and the external parent Task ID (ClickUp)
  const taskId = runInfo?.taskId || runId;
  const branchName = state.branchName;
  
  // ISSUE 6 FIX: Get assignee email from task, or fall back to notificationEmail for local tasks
  // Local tasks don't have ClickUp assignees, but may have a notificationEmail configured
  const assigneeEmail = runInfo?.task?.assignees?.[0]?.email || runInfo?.notificationEmail;
  const iterationBase = state.revisions?.length || 0;
  let iteration = iterationBase;

  // For demo tasks, use step number in iteration to avoid overwriting artifacts
  let isDemoTask = taskId.startsWith('demo-');
  let currentDemoStep = 1;
  let demoTotalSteps = 4; // Default to 4 steps
  if (isDemoTask) {
    try {
      const demoStatusPath = path.join(clientFolder, 'demo.status.json');
      if (await fs.pathExists(demoStatusPath)) {
        const status = await fs.readJson(demoStatusPath);
        currentDemoStep = status.currentStep || 1;
        demoTotalSteps = status.totalSteps || 4;
        iteration = (currentDemoStep * 100) + iterationBase;
      }
    } catch (e) {
      logger.warn(`Could not determine demo step for artifact iteration: ${e}`);
    }
  }

  // 2. Capture artifacts for the step that just finished (screenshots, diff)
  // This ensures Steps 1-3 of a demo still have their work preserved
  let screenshotCaptureSuccess = false;
  let screenshotError: string | undefined;
  
  let appStartedForAfter = false;
  try {
    // Take "after" screenshots for this step
    logger.info(`Taking artifacts for task ${taskId} (Iteration ${iteration}, runId ${runId})`);
    const url = await visualTester.startApp(clientFolder);
    appStartedForAfter = true;
    
    // Wait for app to fully initialize (warmup delay) - Phase 2 enhancement
    logger.info(`Waiting for app warmup before after screenshots...`);
    await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second warmup
    
    // Verify app is responding (with error protection) - Phase 2 enhancement
    try {
      const healthCheck = await visualTester.performHealthCheck(url);
      if (healthCheck.errors.length > 0) {
        logger.warn(`App health check found ${healthCheck.errors.length} issues, but continuing with after screenshots`);
      }
    } catch (healthError: any) {
      logger.warn(`Health check failed: ${healthError.message}, but continuing with after screenshots`);
    }
    
    // Use comprehensive site screenshots if enabled
    const useFullScreenshots = config.screenshots?.fullSiteCapture ?? true;
    let screenshotResult;
    let screenshots: string[] = [];
    
    if (useFullScreenshots) {
      screenshotResult = await visualTester.takeSiteScreenshots(url, taskId, 'after', iteration, {
        maxPages: config.screenshots?.maxPages ?? 20,
        captureSections: config.screenshots?.captureSections ?? true
      }, clientFolder);
      
      // ISSUE 2 FIX: Check if screenshots were actually captured
      if (screenshotResult) {
        if (screenshotResult.success) {
          screenshots = [`/screenshots/${taskId}/after_${iteration}/home/__fullpage.png`];
          screenshotCaptureSuccess = true;
        } else {
          // Screenshots were attempted but failed
          screenshotError = screenshotResult.error || 'Screenshot capture failed with no pages captured';
          logger.warn(`Screenshot capture reported failure: ${screenshotError}`);
        }
      }
    }
    
    // Fallback to simple screenshots if full capture failed or is disabled
    if (screenshots.length === 0) {
      const simpleScreenshots = await visualTester.takeScreenshots(url, taskId, 'after', iteration);
      if (simpleScreenshots.length > 0) {
        screenshots = simpleScreenshots;
        screenshotCaptureSuccess = true;
      }
    }
    
    // Save diff artifact
    const baseCommit = state.baseCommitHash || 'HEAD~1';
    const diff = await getDiff(clientFolder, baseCommit, 'HEAD');
    await saveArtifact(taskId, 'diff.patch', diff, process.cwd(), iteration);

    // Update state with screenshots (even if empty, record the failure)
    await updateWorkflowState(clientFolder, runId, WorkflowState.IN_PROGRESS, {
      finalScreenshots: screenshots,
      screenshotManifest: screenshotResult?.manifestPath,
      // ISSUE 2 FIX: Record screenshot capture status in state
      screenshotCaptureSuccess,
      screenshotError: screenshotError
    });
    
    // ISSUE 2 FIX: Log clear warning if screenshots failed but workflow continues
    if (!screenshotCaptureSuccess) {
      logger.warn(`Screenshot capture FAILED for task ${taskId}. Error: ${screenshotError || 'Unable to capture any screenshots'}. Workflow will continue without screenshots.`);
    }
  } catch (artifactError: any) {
    screenshotError = artifactError.message;
    logger.warn(`Could not capture step artifacts: ${artifactError.message}`);
    // Update state to record the failure
    await updateWorkflowState(clientFolder, runId, WorkflowState.IN_PROGRESS, {
      screenshotCaptureSuccess: false,
      screenshotError: artifactError.message
    }).catch(() => {}); // Don't fail if state update fails
  } finally {
    // Always stop the app to prevent resource leaks
    if (appStartedForAfter) {
      try {
        await visualTester.stopApp(clientFolder);
      } catch (stopError: any) {
        logger.warn(`Failed to stop app after after screenshots: ${stopError.message}`);
      }
    }
  }

  // 3. Handle multi-step demo customization transitions
  if (isDemoTask) {
    try {
      // FIX: Extract the completed step number from runId to prevent race conditions
      // runId format: "demo-name" (step 1) or "demo-name-step2" (step 2+)
      let completedStep = 1;
      const stepMatch = runId.match(/-step(\d+)$/);
      if (stepMatch) {
        const parsedStep = parseInt(stepMatch[1], 10);
        // FIX: Validate the extracted step number is valid (1-4 for typical demos)
        if (!isNaN(parsedStep) && parsedStep >= 1 && parsedStep <= 10) {
          completedStep = parsedStep;
        } else {
          logger.warn(`Invalid step number extracted from runId ${runId}: ${parsedStep}. Using step 1.`);
        }
      }
      
      // FIX: Cross-check with demo status to ensure consistency
      try {
        const demoStatusPath = path.join(clientFolder, 'demo.status.json');
        if (await fs.pathExists(demoStatusPath)) {
          const status = await fs.readJson(demoStatusPath);
          if (status.currentStep && status.currentStep !== completedStep) {
            logger.warn(`Step mismatch: runId suggests step ${completedStep}, demo.status.json shows step ${status.currentStep}. Using status file value.`);
            completedStep = status.currentStep;
          }
        }
      } catch (e: any) {
        logger.debug(`Could not cross-check step number with status file: ${e.message}`);
      }
      
      const isMultiStep = await handleDemoStepTransition(clientFolder, taskId, completedStep);
      if (isMultiStep) return;
    } catch (err: any) {
      logger.error(`Error in demo step transition for ${taskId}: ${err.message}`);
      // Fail hard if demo transition fails to avoid silent skips
      throw err;
    }
  }

  try {
    // Step 1: Update state to testing
    await updateWorkflowState(clientFolder, runId, WorkflowState.TESTING, undefined, 'Running tests');

    // Step 2: Detect and run tests
    const testCommand = await detectTestFramework(clientFolder);
    const testResult = await runTests(clientFolder, testCommand || undefined, taskId);
    await saveTestResults(clientFolder, runId, testResult);
    
    // Step 2.5: Save test logs as artifact
    await saveArtifact(taskId, 'test.log', testResult.output, process.cwd(), iteration);

    // Step 3: If tests fail, notify and stop
    if (!testResult.success) {
      logger.error(`Tests failed for task ${taskId} (runId: ${runId})`);
      await updateWorkflowState(clientFolder, runId, WorkflowState.ERROR, {
        testError: testResult.error,
      }, 'Tests failed');
      
      // FIX: Mark demo step as failed so error recovery (retry/skip) can work
      if (isDemoTask) {
        try {
          const state = await loadTaskState(clientFolder, taskId);
          const lastCheckpointHash = state?.lastCheckpoint?.gitCommitHash;
          const stepName = getStepName(currentDemoStep);
          
          await markStepFailed(
            clientFolder,
            taskId,
            currentDemoStep,
            stepName,
            'test_failure',
            `Tests failed: ${testResult.error || 'Unknown test error'}`,
            lastCheckpointHash
          );
          
          // Update demo.status.json for frontend
          const demoStatusPath = path.join(clientFolder, 'demo.status.json');
          if (await fs.pathExists(demoStatusPath)) {
            const demoStatus = await fs.readJson(demoStatusPath);
            await fs.writeJson(demoStatusPath, {
              ...demoStatus,
              state: 'failed',
              message: `Tests failed: ${testResult.error || 'Unknown test error'}`,
              updatedAt: new Date().toISOString()
            }, { spaces: 2 });
          }
          
          logger.info(`Marked demo step ${currentDemoStep} as failed for error recovery (test failure)`);
        } catch (markErr: any) {
          logger.warn(`Could not mark demo step as failed: ${markErr.message}`);
        }
      }

      // Send failure notifications
      const enableEmails = config.approval.enableEmailNotifications ?? true;
      if (config.approval.method === 'email' && enableEmails) {
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
    await updateWorkflowState(clientFolder, runId, WorkflowState.TESTING, undefined, 'Generating change summary');
    const changeSummary = await generateChangeSummary(clientFolder, branchName, state.baseCommitHash);
    
    // Step 4.5: Save artifacts (diff and summary)
    // Robustly determine base commit for the patch artifact
    let baseCommit = state.baseCommitHash;
    if (!baseCommit) {
      try {
        const { simpleGit } = await import('simple-git');
        const git = simpleGit(clientFolder);
        const countStr = await git.raw(['rev-list', '--count', 'HEAD']);
        const count = parseInt(countStr.trim(), 10);
        baseCommit = count > 1 ? 'HEAD~1' : 'HEAD';
      } catch (e) {
        baseCommit = 'HEAD';
      }
    }
    
    const diff = await getDiff(clientFolder, baseCommit, 'HEAD');
    await saveArtifact(taskId, 'diff.patch', diff, process.cwd(), iteration);
    
    // Save change summary as JSON artifact
    await saveArtifact(taskId, 'summary.json', JSON.stringify(changeSummary, null, 2), process.cwd(), iteration);
    
    const summaryMd = `# Change Summary for Task ${taskId} (Iteration ${iteration})\n\n` +
      `**Files Changed**: ${changeSummary.filesModified}\n` +
      `**Additions**: ${changeSummary.linesAdded}\n` +
      `**Deletions**: ${changeSummary.linesRemoved}\n\n` +
      `## Files List\n` +
      changeSummary.fileList.map(f => `- ${f.path} (${f.status})`).join('\n') +
      `\n\n## Diff Preview\n\`\`\`diff\n${changeSummary.diffPreview}\n\`\`\``;
    
    await saveArtifact(taskId, 'summary.md', summaryMd, process.cwd(), iteration);

    // Step 5: Create approval request and send notifications
    // First: persist state = AWAITING_APPROVAL
    await updateWorkflowState(clientFolder, runId, WorkflowState.AWAITING_APPROVAL, undefined, 'Creating approval request');

    try {
      // Then: attempt to send/create the approval request (Slack/email/dashboard)
      const approvalRequest = await createApprovalRequest(
        taskId,
        clientFolder,
        branchName,
        changeSummary,
        testResult,
        assigneeEmail
      );

      // Send notifications based on config
      const enableEmails = config.approval.enableEmailNotifications ?? true;
      if (config.approval.method === 'email' && enableEmails) {
        await sendApprovalEmail(approvalRequest);
      } else if (config.approval.method === 'slack') {
        await sendSlackNotification(approvalRequest);
      }

      logger.info(`Approval request created for task ${taskId}`);
    } catch (approvalError: any) {
      // Critical rule: failure to create/send an approval request must not advance the workflow and must not flip the task to ERROR.
      // It should stay AWAITING_APPROVAL with an error note like approvalNotificationFailed: true.
      logger.warn(`Failed to create/send approval request for task ${taskId}: ${approvalError.message}`);
      await updateWorkflowState(clientFolder, runId, WorkflowState.AWAITING_APPROVAL, { 
        approvalNotificationFailed: true,
        approvalError: approvalError.message
      }, 'Approval notification failed');
    }

    // FIX: For demo tasks on final step, also update demo.status.json so frontend shows approval section
    if (isDemoTask && currentDemoStep >= demoTotalSteps) {
      try {
        const demoStatusPath = path.join(clientFolder, 'demo.status.json');
        if (await fs.pathExists(demoStatusPath)) {
          const currentStatus = await fs.readJson(demoStatusPath);
          await fs.writeJson(demoStatusPath, {
            ...currentStatus,
            state: 'awaiting_approval',
            message: 'All steps complete! Ready for review.',
            updatedAt: new Date().toISOString(),
            logs: [...(currentStatus.logs || []), `[${new Date().toLocaleTimeString()}] All ${demoTotalSteps} steps completed. Awaiting approval.`]
          }, { spaces: 2 });
          logger.info(`Updated demo.status.json to awaiting_approval for ${taskId}`);
        }
      } catch (statusErr: any) {
        logger.warn(`Could not update demo.status.json after final step: ${statusErr.message}`);
      }
    }

    // Finally: return (do not continue to push/complete)
    return;
    

  } catch (error: any) {
    logger.error(`Error continuing workflow for task ${taskId} (runId: ${runId}): ${error.message}`);
    await updateWorkflowState(clientFolder, runId, WorkflowState.ERROR, {
      error: error.message,
    });
    throw error;
  }
}

/**
 * Backup state for rollback in case of failure
 */
interface DemoTransitionBackup {
  statusFile?: string;
  promptFile?: string;
  historyFile?: string;
}

/**
 * Performs atomic rollback of demo transition
 * FIX: Now also cleans up task state and removes any partial agentRunId state files
 */
async function rollbackDemoTransition(clientFolder: string, backup: DemoTransitionBackup, error: Error): Promise<void> {
  logger.error(`Rolling back demo transition due to error: ${error.message}`);
  
  const rollbackErrors: string[] = [];
  
  // 1. Restore demo.status.json
  try {
    if (backup.statusFile) {
      const statusPath = path.join(clientFolder, 'demo.status.json');
      await fs.writeFile(statusPath, backup.statusFile, 'utf-8');
      logger.info('Restored demo status from backup');
    }
  } catch (err: any) {
    rollbackErrors.push(`demo.status.json: ${err.message}`);
  }
  
  // 2. Restore CURSOR_TASK.md
  try {
    if (backup.promptFile) {
      const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
      await fs.writeFile(promptPath, backup.promptFile, 'utf-8');
      logger.info('Restored prompt file from backup');
    }
  } catch (err: any) {
    rollbackErrors.push(`CURSOR_TASK.md: ${err.message}`);
  }
  
  // 3. Restore workflow_history.json
  try {
    if (backup.historyFile) {
      const historyPath = path.join(clientFolder, 'workflow_history.json');
      await fs.writeFile(historyPath, backup.historyFile, 'utf-8');
      logger.info('Restored workflow history from backup');
    }
  } catch (err: any) {
    rollbackErrors.push(`workflow_history.json: ${err.message}`);
  }
  
  // 4. FIX: Clean up any partial agentRunId state directories that were created during transition
  // These would be state files for the NEXT step that we attempted to create
  try {
    if (backup.statusFile) {
      // Parse the backup to get the ORIGINAL currentStep (before failed transition)
      const originalStatus = JSON.parse(backup.statusFile);
      const failedNextStep = (originalStatus.currentStep || 1) + 1;
      
      // Get base task ID from the status file
      const taskId = originalStatus.taskId || `demo-${path.basename(clientFolder)}`;
      const nextStepTaskId = `${taskId}-step${failedNextStep}`;
      
      // Remove the state directory for the failed next step
      const nextStepStateDir = path.join(clientFolder, '.clickup-workflow', nextStepTaskId);
      if (await fs.pathExists(nextStepStateDir)) {
        await fs.remove(nextStepStateDir);
        logger.info(`Removed partial state directory for ${nextStepTaskId}`);
      }
      
      // Also clean up any temp files that might be left behind
      const tempFiles = [
        path.join(clientFolder, '.workflow_history.tmp.json'),
        path.join(clientFolder, '.CURSOR_TASK.tmp.md'),
        path.join(clientFolder, '.demo.status.tmp.json')
      ];
      
      for (const tempFile of tempFiles) {
        if (await fs.pathExists(tempFile)) {
          await fs.remove(tempFile);
          logger.debug(`Removed temp file: ${tempFile}`);
        }
      }
    }
  } catch (err: any) {
    rollbackErrors.push(`state cleanup: ${err.message}`);
  }
  
  // 5. FIX: Update parent task state to reflect the transition failure
  try {
    if (backup.statusFile) {
      const originalStatus = JSON.parse(backup.statusFile);
      const baseTaskId = originalStatus.taskId || `demo-${path.basename(clientFolder)}`;
      
      // Update the parent task's workflow state to indicate transition failure
      await updateTaskState(clientFolder, baseTaskId, (currentState) => ({
        metadata: {
          ...currentState?.metadata,
          lastTransitionError: {
            timestamp: new Date().toISOString(),
            error: error.message,
            attemptedStep: (originalStatus.currentStep || 1) + 1
          }
        }
      }));
      logger.info('Updated parent task state with transition error info');
    }
  } catch (err: any) {
    rollbackErrors.push(`task state update: ${err.message}`);
  }
  
  // Log summary of rollback result
  if (rollbackErrors.length > 0) {
    logger.error(`Rollback completed with ${rollbackErrors.length} error(s): ${rollbackErrors.join('; ')}. Manual intervention may be required.`);
  } else {
    logger.info('Demo transition rollback completed successfully');
  }
}

/**
 * Handles transitions between demo customization steps with atomic operations and rollback
 */
async function handleDemoStepTransition(clientFolder: string, taskId: string, completedStep: number = 1): Promise<boolean> {
  // Backup for rollback
  const backup: DemoTransitionBackup = {};
  
  try {
    // Check if this is a demo task and which step it is
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (!(await fs.pathExists(demoStatusPath))) return false;

    // Backup current status
    backup.statusFile = await fs.readFile(demoStatusPath, 'utf-8');
    
    const status = await fs.readJson(demoStatusPath);
    const currentStep = status.currentStep || 1;
    const totalSteps = status.totalSteps || 4;
    const lastCompletedStep = status.lastCompletedStep || 0;

    // FIX: Guard against duplicate/out-of-order transitions using completedStep from runId
    // Only the call that just completed step N should trigger the N→N+1 transition
    if (completedStep !== currentStep) {
      logger.warn(`Skipping transition for ${taskId}: completedStep(${completedStep}) != currentStep(${currentStep}). Another call already transitioned.`);
      return true; // Return true to prevent workflow from proceeding to tests/approval
    }
    
    // Guard against duplicate calls for the same step
    if (completedStep <= lastCompletedStep) {
      logger.warn(`Skipping duplicate transition for ${taskId}: step ${completedStep} already completed (lastCompletedStep=${lastCompletedStep}).`);
      return true; // Return true to prevent workflow from proceeding to tests/approval
    }
    
    // Mark this step as completed BEFORE transitioning
    status.lastCompletedStep = completedStep;
    await fs.writeJson(demoStatusPath, status, { spaces: 2 });
    logger.info(`Marked step ${completedStep} as completed for demo ${taskId}`);

    // **NEW**: Create checkpoint after successful step completion
    // FIX: Track checkpoint success to inform error recovery if transition fails
    let checkpointCreated = false;
    try {
      const checkpointResult = await createCheckpoint(
        clientFolder,
        taskId,
        completedStep,
        getStepName(completedStep)
      );
      
      if (checkpointResult.success) {
        logger.info(`Checkpoint created for ${taskId} step ${completedStep}: ${checkpointResult.checkpoint?.gitCommitHash}`);
        checkpointCreated = true;
      } else {
        logger.warn(`Checkpoint creation failed for ${taskId} step ${completedStep}: ${checkpointResult.error}`);
        // Non-fatal - continue with transition even if checkpoint fails
      }
    } catch (cpErr: any) {
      logger.warn(`Error creating checkpoint for ${taskId}: ${cpErr.message}`);
      // Non-fatal
    }
    
    // Store checkpoint status in metadata for debugging
    try {
      await updateTaskState(clientFolder, taskId, (currentState) => ({
        metadata: {
          ...currentState?.metadata,
          lastCheckpointCreated: checkpointCreated,
          lastCheckpointStep: completedStep,
          lastCheckpointTime: new Date().toISOString()
        }
      }));
    } catch (e) {
      // Ignore metadata update failures
    }

    // Auto-build the demo for production serving (ensures /client-websites/{slug}/ is always current)
    // This runs in the background and doesn't block step transitions
    try {
      const clientSlug = path.basename(clientFolder);
      const { buildDemo } = await import('../handlers/demoHandler');
      logger.info(`Auto-building demo ${clientSlug} after step ${completedStep} completion...`);
      buildDemo(clientSlug, true).then(result => {
        if (result.success) {
          logger.info(`Auto-build completed for ${clientSlug} (step ${completedStep})`);
        } else {
          logger.warn(`Auto-build failed for ${clientSlug}: ${result.error}`);
        }
      }).catch(err => {
        logger.warn(`Auto-build error for ${clientSlug}: ${err.message}`);
      });
    } catch (buildErr: any) {
      logger.warn(`Could not trigger auto-build for demo: ${buildErr.message}`);
    }

    if (currentStep >= totalSteps) {
      logger.info(`Demo workflow reached final step (${currentStep}/${totalSteps}) for ${taskId}`);
      return false; // Proceed to normal completion (testing/approval)
    }

    const nextStep = currentStep + 1;
    logger.info(`Transitioning demo ${taskId} from step ${currentStep} to ${nextStep}`);

    // 1. PHASE 1: Read and prepare all data (no writes yet)
    const historyPath = path.join(clientFolder, 'workflow_history.json');
    
    // Backup existing files
    if (await fs.pathExists(historyPath)) {
      backup.historyFile = await fs.readFile(historyPath, 'utf-8');
    }
    
    const taskFilePath = path.join(clientFolder, 'CURSOR_TASK.md');
    if (await fs.pathExists(taskFilePath)) {
      backup.promptFile = await fs.readFile(taskFilePath, 'utf-8');
    }
    
    let workflowHistory = [];
    if (backup.historyFile) {
      try {
        const data = JSON.parse(backup.historyFile);
        workflowHistory = Array.isArray(data) ? data : [data];
      } catch (e) {
        logger.warn(`Failed to parse workflow history for ${taskId}: ${e}`);
        workflowHistory = [];
      }
    }

    // Extract summary from the agent's work
    // FIX: More robust summary extraction with multiple fallback patterns
    let summary = 'Step completed';
    if (backup.promptFile) {
      // Try multiple patterns to find summary (agents may format differently)
      const patterns = [
        /# Summary\s*([\s\S]*?)(?=\n#|$)/i,                    // # Summary followed by content
        /## Summary\s*([\s\S]*?)(?=\n##|$)/i,                  // ## Summary variant
        /\*\*Summary\*\*:?\s*([^\n]+)/i,                       // **Summary**: inline format
        /Summary:\s*([^\n]+)/i                                  // Plain Summary: format
      ];
      
      for (const pattern of patterns) {
        const match = backup.promptFile.match(pattern);
        if (match && match[1]?.trim()) {
          summary = match[1].trim().substring(0, 500); // Limit length to prevent oversized history
          break;
        }
      }
    }

    // Prepare new history entry
    const newHistoryEntry = {
      step: currentStep,
      stepName: getStepName(currentStep),
      completedAt: new Date().toISOString(),
      taskId: taskId,
      summary: summary
    };
    const updatedHistory = [...workflowHistory, newHistoryEntry];

    // 2. PHASE 2: Load and validate prompt template
    const nextPromptFile = `demo_step${nextStep}_${getStepName(nextStep)}.md`;
    const promptTemplatePath = path.join(process.cwd(), 'prompts', nextPromptFile);
    
    if (!(await fs.pathExists(promptTemplatePath))) {
      throw new Error(`Prompt template for step ${nextStep} not found: ${nextPromptFile}`);
    }

    let promptContent = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Load context for placeholder replacement with file locking
    // This prevents race conditions with concurrent context updates from agent completion handlers
    const contextPath = path.join(clientFolder, 'demo.context.json');
    if (!(await fs.pathExists(contextPath))) {
      throw new Error(`Demo context file not found: ${contextPath}`);
    }
    
    const context = await demoContextLock.withReadLock(contextPath, async () => {
      return await fs.readJson(contextPath);
    });

    // Replace placeholders (comprehensive set for all steps)
    const replacements: Record<string, string> = {
      '{{taskId}}': `${taskId}-step${nextStep}`,
      '{{currentStep}}': nextStep.toString(),
      '{{totalSteps}}': totalSteps.toString(),
      '{{businessName}}': context.businessName || '',
      '{{clientSlug}}': context.clientSlug || '',
      '{{email}}': context.email || 'N/A',
      '{{phone}}': context.phone || 'N/A',
      '{{address}}': context.address || 'N/A',
      '{{primaryColor}}': context.primaryColor || '#000000',
      '{{secondaryColor}}': context.secondaryColor || '#ffffff',
      '{{fontFamily}}': context.fontFamily || 'sans-serif',
      '{{services}}': context.services || context.businessDescription || 'N/A',
      '{{imagesDir}}': context.imagesDir || 'src/assets/images',
      '{{imageRetrieverPath}}': context.imageRetrieverPath || '',
      '{{workflowHistory}}': JSON.stringify(updatedHistory, null, 2)
    };

    for (const [key, value] of Object.entries(replacements)) {
      promptContent = promptContent.split(key).join(value);
    }

    // Prepare updated status (in memory)
    const updatedStatus = {
      ...status,
      currentStep: nextStep,
      state: 'triggering',
      message: `Starting step ${nextStep}: ${getStepName(nextStep)}`,
      updatedAt: new Date().toISOString(),
      logs: status.logs || []
    };

    // Add log entry for the handoff transition
    const timestamp = new Date().toLocaleTimeString();
    updatedStatus.logs.push(`[${timestamp}] Handoff: Finished ${getStepName(currentStep)}. Starting ${getStepName(nextStep)}...`);

    // 3. PHASE 3: Atomic writes (all or nothing)
    const tmpHistoryPath = path.join(clientFolder, '.workflow_history.tmp.json');
    const tmpPromptPath = path.join(clientFolder, '.CURSOR_TASK.tmp.md');
    const tmpStatusPath = path.join(clientFolder, '.demo.status.tmp.json');

    try {
      // Write to temp files
      await fs.writeJson(tmpHistoryPath, updatedHistory, { spaces: 2 });
      await fs.writeFile(tmpPromptPath, promptContent, 'utf-8');
      await fs.writeJson(tmpStatusPath, updatedStatus, { spaces: 2 });

      // Atomic renames (all succeed or all fail)
      await fs.rename(tmpHistoryPath, historyPath);
      await fs.rename(tmpPromptPath, taskFilePath);
      await fs.rename(tmpStatusPath, demoStatusPath);

      logger.info(`Successfully transitioned demo ${taskId} to step ${nextStep}`);
    } catch (writeError: any) {
      // Clean up temp files
      await fs.remove(tmpHistoryPath).catch(() => {});
      await fs.remove(tmpPromptPath).catch(() => {});
      await fs.remove(tmpStatusPath).catch(() => {});
      throw new Error(`Failed to write transition files: ${writeError.message}`);
    }

    // 4. PHASE 4: Update external systems (best effort, non-critical)
    try {
      const { taskStatusManager } = await import('../cursor/taskStatusManager');
      await taskStatusManager.updateStatus(taskId, {
        step: updatedStatus.message,
        percent: Math.floor(((nextStep - 1) / totalSteps) * 100)
      }, clientFolder);

      // Update parent task state for dashboard visibility
      await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, {
        demoStep: nextStep
      }, updatedStatus.message);

      // Initialize state for the unique runId so it has branchName and other context
      const parentState = await loadTaskState(clientFolder, taskId);
      const agentRunId = `${taskId}-step${nextStep}`;
      if (parentState) {
        await saveTaskState(clientFolder, agentRunId, {
          ...parentState,
          taskId: agentRunId,
          state: WorkflowState.IN_PROGRESS,
          agentCompletion: undefined // Reset completion state for new run
        });
      }
    } catch (e: any) {
      logger.warn(`Failed to update external systems during transition: ${e.message}`);
      // Don't fail the transition for external system errors
    }

    // 5. PHASE 5: Cancel stale polling loops before triggering next step
    // This prevents previous step's completion detector from triggering duplicate transitions
    try {
      const { cancelAllDemoPolling } = await import('../cursor/agentCompletionDetector');
      cancelAllDemoPolling(taskId);
    } catch (e: any) {
      logger.warn(`Could not cancel stale polling loops: ${e.message}`);
    }

    // 6. PHASE 6: Trigger agent
    const taskInfo = await loadTaskInfo(clientFolder, taskId);
    const agentRunId = `${taskId}-step${nextStep}`;
    
    const mockTask: ClickUpTask = { 
      ...(taskInfo?.task || {}), 
      id: agentRunId, // Use unique ID for the agent run to avoid race conditions
      name: `Demo Step ${nextStep}: ${context.businessName}`,
      description: taskInfo?.task?.description || `Demo customization step ${nextStep}`
    } as ClickUpTask;
    
    // Ensure task info is preserved for the agentRunId so continueWorkflowAfterAgent can find parent taskId
    await saveTaskInfo(clientFolder, agentRunId, {
      task: mockTask,
      taskId: taskId, // Parent taskId
      clientName: context.businessName,
      clientFolder: clientFolder
    });

    // Read step-specific model from context
    const stepModel = context.stepModels?.[nextStep] || context.aiModel || config.cursor.defaultModel;
    logger.info(`Using AI model for step ${nextStep}: ${stepModel || 'default'}`);

    await triggerAgentWithRetry(clientFolder, mockTask, { model: stepModel });

    return true;
    
  } catch (error: any) {
    logger.error(`Error during demo step transition: ${error.message}`);
    
    // Rollback to previous state
    await rollbackDemoTransition(clientFolder, backup, error);
    
    // Mark as error but don't throw - let the task continue or be manually recovered
    try {
      await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
        error: `Step transition failed: ${error.message}`,
        transitionError: true
      });
    } catch (stateError: any) {
      logger.error(`Failed to update state after transition error: ${stateError.message}`);
    }
    
    // FIX: Mark step as failed so error recovery (retry/skip) can work
    // The transition failed AFTER a step completed, so we mark the NEXT step as failed
    // (the one we were trying to start)
    try {
      // Parse original status to get step info
      let failedStepNumber = 2; // Default to step 2 if we can't determine
      let lastCheckpointHash: string | undefined;
      
      if (backup.statusFile) {
        const originalStatus = JSON.parse(backup.statusFile);
        failedStepNumber = (originalStatus.currentStep || 1) + 1;
      }
      
      // Get last checkpoint hash if available
      const state = await loadTaskState(clientFolder, taskId);
      lastCheckpointHash = state?.lastCheckpoint?.gitCommitHash;
      
      const stepName = getStepName(failedStepNumber);
      await markStepFailed(
        clientFolder,
        taskId,
        failedStepNumber,
        stepName,
        'transition_error',
        `Step transition failed: ${error.message}`,
        lastCheckpointHash
      );
      
      logger.info(`Marked step ${failedStepNumber} as failed for error recovery`);
    } catch (markErr: any) {
      logger.warn(`Could not mark step as failed for recovery: ${markErr.message}`);
    }
    
    return false;
  }
}

function getStepName(step: number): string {
  const steps = ['branding', 'copywriting', 'imagery', 'review'];
  return steps[step - 1] || 'unknown';
}

interface TriggerAgentWithRetryOptions {
  model?: string;
}

async function triggerAgentWithRetry(clientFolder: string, task: any, options?: TriggerAgentWithRetryOptions, attempts = 0) {
  try {
    await triggerCursorAgent(clientFolder, task, { model: options?.model });
  } catch (error: any) {
    if ((error.code === 'EPERM' || error.code === 'EBUSY') && attempts < 3) {
      logger.warn(`Retry triggerAgent for ${task.id} due to ${error.code} (attempt ${attempts + 1})`);
      await new Promise(resolve => setTimeout(resolve, 1000 * (attempts + 1)));
      return triggerAgentWithRetry(clientFolder, task, options, attempts + 1);
    }
    throw error;
  }
}
export async function completeWorkflowAfterApproval(
  clientFolder: string,
  taskId: string
): Promise<void> {
  logger.info(`Completing workflow for task ${taskId} after approval`);

  try {
    // Load task state
    const state = await loadTaskState(clientFolder, taskId);
    if (!state || !state.branchName) {
      throw new Error(`Task state not found or branch name missing for task ${taskId}`);
    }

    const branchName = state.branchName;

    // Step 1: Push branch to GitHub
    await updateWorkflowState(clientFolder, taskId, WorkflowState.COMPLETED, undefined, 'Pushing to GitHub');
    await pushBranch(clientFolder, branchName);

    // Step 2: Update state to completed
    await updateWorkflowState(clientFolder, taskId, WorkflowState.COMPLETED, undefined, 'Workflow completed');

    // Step 3: Update ClickUp task
    try {
      const comment = `✅ Workflow completed successfully.\n\nBranch \`${branchName}\` has been pushed to GitHub.`;
      await clickUpApiClient.addComment(taskId, comment);
      logger.info(`Added completion comment to ClickUp task ${taskId}`);
    } catch (commentError: any) {
      logger.warn(`Could not add completion comment to ClickUp task ${taskId}: ${commentError.message}`);
    }

    // Step 4: Final cleanup - remove prompt file and other artifacts
    try {
      logger.info(`Performing final cleanup for task ${taskId}`);
      await taskCleanupService.deleteTaskArtifacts(taskId, clientFolder);
    } catch (cleanupError: any) {
      logger.warn(`Final cleanup failed for task ${taskId}: ${cleanupError.message}`);
      // Don't throw - workflow is already "complete" in ClickUp/Git
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

/**
 * Handles task rejection with feedback: patches prompt, updates state, and reruns agent
 */
// ============================================
// Demo Error Recovery Functions
// ============================================

/**
 * Continues demo execution after error recovery.
 * Called when user clicks retry or skip on frontend.
 * 
 * @param clientFolder - Path to the client folder
 * @param taskId - The demo task ID
 * @param action - 'retry' to rollback and retry, 'skip' to advance to next step
 */
export async function continueAfterError(
  clientFolder: string,
  taskId: string,
  action: 'retry' | 'skip'
): Promise<{ success: boolean; message: string; nextStep?: number; error?: string }> {
  logger.info(`Continuing ${taskId} after error with action: ${action}`);
  
  // FIX: acquireRetryLock now returns the lock token (or null if failed)
  // We store the token to pass to releaseRetryLock for ownership verification
  const lockToken = await acquireRetryLock(clientFolder, taskId, action);
  if (!lockToken) {
    // FIX: Return early WITHOUT entering try-finally to avoid releasing a lock we don't own
    return {
      success: false,
      message: 'Another recovery operation is in progress',
      error: 'Recovery operation already in progress. Please wait.'
    };
  }
  
  // Only enter try-finally AFTER we've successfully acquired the lock
  try {
    const state = await loadTaskState(clientFolder, taskId);
    if (!state?.failedStep) {
      return {
        success: false,
        message: 'No failed step found',
        error: 'Demo is not in a failed state'
      };
    }
    
    const failedStep = state.failedStep;
    
    // Load demo status for total steps
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    let totalSteps = 4;
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      totalSteps = status.totalSteps || 4;
    }
    
    if (action === 'retry') {
      return await handleRetryAction(clientFolder, taskId, failedStep, totalSteps);
    } else if (action === 'skip') {
      return await handleSkipAction(clientFolder, taskId, failedStep, totalSteps);
    } else {
      return {
        success: false,
        message: 'Invalid action',
        error: `Unknown action: ${action}`
      };
    }
    
  } catch (error: any) {
    logger.error(`Error in continueAfterError for ${taskId}: ${error.message}`);
    return {
      success: false,
      message: 'Recovery failed',
      error: error.message
    };
  } finally {
    // FIX: Pass the lock token to verify we own the lock before releasing
    // This prevents releasing a lock that was taken over by another process
    // due to timeout while our operation was running
    try {
      await releaseRetryLock(clientFolder, taskId, lockToken);
    } catch (lockErr) {
      logger.warn(`Could not release retry lock for ${taskId}: ${lockErr}`);
    }
  }
}

/**
 * Handles the retry action - rolls back to checkpoint and re-executes step
 */
async function handleRetryAction(
  clientFolder: string,
  taskId: string,
  failedStep: { stepNumber: number; stepName: string; retryCount: number; errorCategory?: string; errorMessage?: string },
  totalSteps: number
): Promise<{ success: boolean; message: string; nextStep?: number; error?: string }> {
  
  // Check retry limit
  const MAX_RETRIES = 3;
  if (failedStep.retryCount >= MAX_RETRIES) {
    return {
      success: false,
      message: `Maximum retries (${MAX_RETRIES}) reached for step ${failedStep.stepNumber}`,
      error: 'Please try skipping this step or restart the demo'
    };
  }
  
  // Find recovery checkpoint
  const checkpoint = await findRecoveryCheckpoint(clientFolder, taskId, failedStep.stepNumber);
  
  if (!checkpoint) {
    logger.warn(`No checkpoint found for ${taskId}, cannot rollback`);
    // FIX: Store complete original failedStep info before clearing to preserve on failure
    const originalFailedStep = { ...failedStep };
    
    // Clear failed step marker BEFORE retrigger to prevent state inconsistency
    // The demo.status.json will be updated to 'triggering' during retrigger, so we need
    // the task state to also reflect we're no longer in error state
    await clearFailedStepMarker(clientFolder, taskId);
    
    // FIX: Set retrying metadata flag BEFORE calling retriggerStep so it can detect this is a retry
    // This is critical for step 1 retries to use a unique agentRunId
    await updateTaskState(clientFolder, taskId, (current) => ({
      metadata: {
        ...current?.metadata,
        retrying: true,
        retryingStep: failedStep.stepNumber,
        retryTriggeredAt: new Date().toISOString()
      }
    }));
    
    const retriggerResult = await retriggerStep(clientFolder, taskId, failedStep.stepNumber);
    
    // If retrigger failed, restore the error state so user can see the failure
    // FIX: Preserve ALL original error context including errorCategory and errorMessage
    if (!retriggerResult.success) {
      await updateTaskState(clientFolder, taskId, () => ({
        failedStep: {
          stepNumber: originalFailedStep.stepNumber,
          stepName: originalFailedStep.stepName,
          errorCategory: originalFailedStep.errorCategory || 'step_failed', // Preserve original category
          errorMessage: `Retrigger failed: ${retriggerResult.error || 'Unknown error'}. Original error: ${originalFailedStep.errorMessage || 'Unknown'}`,
          timestamp: new Date().toISOString(),
          retryCount: (originalFailedStep.retryCount || 0) + 1 // FIX: Increment retry count on failure
        },
        state: WorkflowState.ERROR
      }));
      
      // FIX: Also update demo.status.json to reflect the failed state for frontend
      try {
        const demoStatusPath = path.join(clientFolder, 'demo.status.json');
        if (await fs.pathExists(demoStatusPath)) {
          const status = await fs.readJson(demoStatusPath);
          await fs.writeJson(demoStatusPath, {
            ...status,
            state: 'failed',
            message: `Retry failed: ${retriggerResult.error || 'Unknown error'}`,
            updatedAt: new Date().toISOString()
          }, { spaces: 2 });
        }
      } catch (e: any) {
        logger.warn(`Could not update demo.status.json after retry failure: ${e.message}`);
      }
    }
    
    return retriggerResult;
  }
  
  // Perform rollback
  const rollbackResult = await rollbackToCheckpoint(clientFolder, taskId, checkpoint);
  
  if (!rollbackResult.success) {
    return {
      success: false,
      message: 'Rollback failed',
      error: rollbackResult.error || 'Could not rollback to checkpoint'
    };
  }
  
  logger.info(`Rollback successful for ${taskId}, ${rollbackResult.discardedCommits} commits discarded`);
  
  // FIX: Set retrying metadata flag BEFORE calling retriggerStep so it can detect this is a retry
  // This is critical for step 1 retries to use a unique agentRunId
  await updateTaskState(clientFolder, taskId, (current) => ({
    metadata: {
      ...current?.metadata,
      retrying: true,
      retryingStep: failedStep.stepNumber,
      retryTriggeredAt: new Date().toISOString()
    }
  }));
  
  // Re-trigger the failed step
  return await retriggerStep(clientFolder, taskId, failedStep.stepNumber);
}

/**
 * Handles the skip action - advances to next step without rollback
 */
async function handleSkipAction(
  clientFolder: string,
  taskId: string,
  failedStep: { stepNumber: number; stepName: string },
  totalSteps: number
): Promise<{ success: boolean; message: string; nextStep?: number; error?: string }> {
  
  if (failedStep.stepNumber >= totalSteps) {
    return {
      success: false,
      message: 'Cannot skip final step',
      error: 'The final step cannot be skipped. Please retry or restart the demo.'
    };
  }
  
  const skipResult = await skipFailedStep(clientFolder, taskId, failedStep.stepNumber, totalSteps);
  
  if (!skipResult.success) {
    return {
      success: false,
      message: 'Skip failed',
      error: skipResult.error || 'Could not skip to next step'
    };
  }
  
  // Trigger the next step
  return await retriggerStep(clientFolder, taskId, skipResult.nextStep);
}

/**
 * Re-triggers execution from a specific step
 */
async function retriggerStep(
  clientFolder: string,
  taskId: string,
  stepNumber: number
): Promise<{ success: boolean; message: string; nextStep?: number; error?: string }> {
  try {
    // Load demo context
    const contextPath = path.join(clientFolder, 'demo.context.json');
    if (!(await fs.pathExists(contextPath))) {
      return {
        success: false,
        message: 'Context not found',
        error: 'Demo context file not found'
      };
    }
    const context = await fs.readJson(contextPath);
    
    // Update demo.status.json
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      await fs.writeJson(demoStatusPath, {
        ...status,
        currentStep: stepNumber,
        state: 'triggering',
        message: `Retrying step ${stepNumber}: ${getStepName(stepNumber)}`,
        updatedAt: new Date().toISOString(),
        logs: [
          ...(status.logs || []),
          `[${new Date().toLocaleTimeString()}] Retrying step ${stepNumber}...`
        ]
      }, { spaces: 2 });
    }
    
    // Load prompt template for the step
    const promptFile = `demo_step${stepNumber}_${getStepName(stepNumber)}.md`;
    const promptTemplatePath = path.join(process.cwd(), 'prompts', promptFile);
    
    if (!(await fs.pathExists(promptTemplatePath))) {
      return {
        success: false,
        message: 'Prompt not found',
        error: `Prompt template for step ${stepNumber} not found`
      };
    }
    
    let promptContent = await fs.readFile(promptTemplatePath, 'utf-8');
    
    // Get total steps
    let totalSteps = 4;
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      totalSteps = status.totalSteps || 4;
    }
    
    // Replace placeholders
    // FIX: Simplified and robust retry detection
    // Instead of complex timestamp-based detection, check definitive indicators:
    // 1. metadata.retrying flag (set by handleRetryAction before calling retriggerStep)
    // 2. metadata.stepRetryHistory having any retries for this step
    // 3. For step 1 specifically, check if this step has ever been run before (via checkpoints)
    const taskState = await loadTaskState(clientFolder, taskId);
    
    // Simple check: Is this explicitly marked as a retry?
    const explicitRetry = taskState?.metadata?.retrying === true;
    
    // Check if this step has been attempted before (retry history shows past attempts)
    const stepRetryHistory = taskState?.metadata?.stepRetryHistory || {};
    const hasRetryHistory = (stepRetryHistory[stepNumber] || 0) > 0;
    
    // Check if step 1 has a checkpoint (meaning it completed before and this is a re-run)
    const hasStep1Checkpoint = taskState?.checkpoints?.some((cp: any) => cp.stepNumber === 1);
    
    // Determine if this is a retry scenario
    const isRetrying = explicitRetry || hasRetryHistory || (stepNumber === 1 && hasStep1Checkpoint);
    
    // FIX: Always use step-specific ID for step 1 retries to prevent collision with original run
    // The original step 1 run uses taskId directly, so retries must use taskId-step1
    const agentRunId = (stepNumber > 1 || isRetrying) ? `${taskId}-step${stepNumber}` : taskId;
    
    logger.debug(`Retry detection for ${taskId} step ${stepNumber}: explicitRetry=${explicitRetry}, hasRetryHistory=${hasRetryHistory}, hasStep1Checkpoint=${hasStep1Checkpoint}, isRetrying=${isRetrying}, agentRunId=${agentRunId}`);
    
    // FIX: Load actual workflow history instead of empty array to preserve context
    let workflowHistory: any[] = [];
    const historyPath = path.join(clientFolder, 'workflow_history.json');
    if (await fs.pathExists(historyPath)) {
      try {
        const historyData = await fs.readJson(historyPath);
        workflowHistory = Array.isArray(historyData) ? historyData : [historyData];
      } catch (e) {
        logger.warn(`Could not load workflow history for retrigger: ${e}`);
      }
    }
    
    const replacements: Record<string, string> = {
      '{{taskId}}': agentRunId,
      '{{currentStep}}': stepNumber.toString(),
      '{{totalSteps}}': totalSteps.toString(),
      '{{businessName}}': context.businessName || '',
      '{{clientSlug}}': context.clientSlug || '',
      '{{email}}': context.email || 'N/A',
      '{{phone}}': context.phone || 'N/A',
      '{{address}}': context.address || 'N/A',
      '{{primaryColor}}': context.primaryColor || '#000000',
      '{{secondaryColor}}': context.secondaryColor || '#ffffff',
      '{{fontFamily}}': context.fontFamily || 'sans-serif',
      '{{services}}': context.services || context.businessDescription || 'N/A',
      '{{imagesDir}}': context.imagesDir || 'src/assets/images',
      '{{imageRetrieverPath}}': context.imageRetrieverPath || '',
      '{{workflowHistory}}': JSON.stringify(workflowHistory, null, 2)
    };
    
    for (const [key, value] of Object.entries(replacements)) {
      promptContent = promptContent.split(key).join(value);
    }
    
    // Write the prompt
    const taskFilePath = path.join(clientFolder, 'CURSOR_TASK.md');
    await fs.writeFile(taskFilePath, promptContent, 'utf-8');
    
    // Update task state
    await updateWorkflowState(clientFolder, taskId, WorkflowState.IN_PROGRESS, {
      demoStep: stepNumber,
      retrying: true
    }, `Retrying step ${stepNumber}`);
    
    // Initialize state for the unique runId
    // FIX: Also save state for step 1 retries to ensure agentRunId has proper context
    const parentState = await loadTaskState(clientFolder, taskId);
    if (parentState && (stepNumber > 1 || isRetrying)) {
      await saveTaskState(clientFolder, agentRunId, {
        ...parentState,
        taskId: agentRunId,
        state: WorkflowState.IN_PROGRESS,
        agentCompletion: undefined,
        failedStep: undefined
      });
    }
    
    // Trigger the agent
    const taskInfo = await loadTaskInfo(clientFolder, taskId);
    // FIX: ClickUpTask is a type, not a value - use type import correctly
    type ClickUpTaskType = import('../clickup/apiClient').ClickUpTask;
    
    const mockTask: ClickUpTaskType = {
      ...(taskInfo?.task || {}),
      id: agentRunId,
      name: `Demo Step ${stepNumber}: ${context.businessName}`,
      description: taskInfo?.task?.description || `Demo customization step ${stepNumber}`
    } as ClickUpTaskType;
    
    // Save task info for the agentRunId
    await saveTaskInfo(clientFolder, agentRunId, {
      task: mockTask,
      taskId: taskId, // Parent taskId
      clientName: context.businessName,
      clientFolder: clientFolder
    });
    
    // Get step-specific model
    const stepModel = context.stepModels?.[stepNumber] || context.aiModel || config.cursor.defaultModel;
    
    // Trigger agent
    const { triggerCursorAgent } = await import('../cursor/workspaceManager');
    await triggerCursorAgent(clientFolder, mockTask, { model: stepModel });
    
    logger.info(`Retriggered step ${stepNumber} for ${taskId}`);
    
    return {
      success: true,
      message: `Retrying step ${stepNumber}...`,
      nextStep: stepNumber
    };
    
  } catch (error: any) {
    logger.error(`Failed to retrigger step ${stepNumber} for ${taskId}: ${error.message}`);
    return {
      success: false,
      message: 'Retrigger failed',
      error: error.message
    };
  }
}

/**
 * Gets rollback preview for UI display
 */
export async function getRollbackPreview(
  clientFolder: string,
  taskId: string
): Promise<{
  preview: { preservedSteps: string[]; discardedChanges: string[]; changedFiles: string[] } | null;
  error?: string;
}> {
  try {
    const recoveryState = await getRecoveryState(clientFolder, taskId);
    
    if (!recoveryState.failedStep) {
      return { preview: null, error: 'No failed step found' };
    }
    
    const checkpoint = await findRecoveryCheckpoint(
      clientFolder, 
      taskId, 
      recoveryState.failedStep.stepNumber
    );
    
    if (!checkpoint) {
      return { 
        preview: {
          preservedSteps: ['No checkpoint available'],
          discardedChanges: ['Step will be re-executed from current state'],
          changedFiles: []
        }
      };
    }
    
    const demoStatusPath = path.join(clientFolder, 'demo.status.json');
    let totalSteps = 4;
    if (await fs.pathExists(demoStatusPath)) {
      const status = await fs.readJson(demoStatusPath);
      totalSteps = status.totalSteps || 4;
    }
    
    const preview = await generateRollbackPreview(clientFolder, taskId, checkpoint, totalSteps);
    
    return {
      preview: {
        preservedSteps: preview.preservedSteps,
        discardedChanges: preview.discardedChanges,
        changedFiles: preview.changedFiles
      }
    };
    
  } catch (error: any) {
    logger.error(`Error getting rollback preview: ${error.message}`);
    return { preview: null, error: error.message };
  }
}

export async function handleTaskRejectionWithFeedback(
  clientFolder: string,
  taskId: string,
  feedback: string
): Promise<void> {
  logger.info(`Handling rejection with feedback for task ${taskId}`);

  try {
    // 1. Update state to REJECTED and record feedback
    const updatedState = await rejectTask(clientFolder, taskId, feedback);
    const iteration = updatedState.revisions?.length || 1;

    // 2. Patch CURSOR_TASK.md with the feedback
    await patchPromptWithFeedback(clientFolder, taskId, feedback, iteration);

    // 3. Update state back to IN_PROGRESS for the rerun
    await updateWorkflowState(
      clientFolder, 
      taskId, 
      WorkflowState.IN_PROGRESS, 
      undefined, 
      `Rerunning agent (Iteration ${iteration})`
    );

    // 4. Load task info for triggering
    const taskInfo = await loadTaskInfo(clientFolder, taskId);
    if (!taskInfo || !taskInfo.task) {
      throw new Error(`Task info not found for ${taskId}`);
    }

    // 5. Trigger Cursor agent for the rerun
    logger.info(`Triggering agent rerun for task ${taskId} (Iteration ${iteration})`);
    await triggerCursorAgent(clientFolder, taskInfo.task);

    logger.info(`Agent rerun triggered for task ${taskId} (Iteration ${iteration})`);
  } catch (error: any) {
    logger.error(`Error during rejection rerun for task ${taskId}: ${error.message}`);
    // If we fail here, the task might be in an inconsistent state, but we should at least mark it as error
    await updateWorkflowState(clientFolder, taskId, WorkflowState.ERROR, {
      error: `Failed to trigger rerun after rejection: ${error.message}`
    });
    throw error;
  }
}














