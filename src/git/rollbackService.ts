/**
 * Rollback Service
 * 
 * Orchestrates the rollback process for demo error recovery.
 * Handles git rollback, artifact cleanup, and state management.
 */

import * as fs from 'fs-extra';
import * as path from 'path';
import { logger } from '../utils/logger';
import {
  rollbackToCommit,
  createSafetyTag,
  getCommitsSince,
  getCurrentCommitHash,
  hasUncommittedChanges,
  getChangedFiles,
  CommitInfo
} from './branchManager';
import {
  StepCheckpoint,
  clearFailedStepMarker,
  releaseRetryLock,
  loadTaskState,
  updateTaskState,
  WorkflowState
} from '../state/stateManager';
import { validateCheckpoint } from '../state/checkpointService';

/**
 * Result of a rollback operation
 */
export interface RollbackResult {
  success: boolean;
  checkpoint: StepCheckpoint;
  discardedCommits: number;
  cleanedArtifacts: string[];
  safetyTagName?: string;
  error?: string;
}

/**
 * Preview of what a rollback will do
 */
export interface RollbackPreview {
  preservedSteps: string[];
  discardedChanges: string[];
  discardedCommits: CommitInfo[];
  changedFiles: string[];
  willRollbackTo: string; // Commit hash
  willRollbackToStep: number;
}

/**
 * Step name lookup
 */
function getStepDisplayName(stepNumber: number): string {
  const steps = ['Branding', 'Copywriting', 'Imagery', 'Review'];
  return steps[stepNumber - 1] || `Step ${stepNumber}`;
}

/**
 * Rolls back a failed step to its pre-execution state.
 * 
 * 1. Validates checkpoint exists and is valid
 * 2. Creates safety tag before rollback
 * 3. Performs git hard reset to checkpoint commit
 * 4. Cleans up partial artifacts (screenshots, diffs)
 * 5. Updates state to reflect rollback
 */
export async function rollbackToCheckpoint(
  clientFolder: string,
  taskId: string,
  checkpoint: StepCheckpoint
): Promise<RollbackResult> {
  const cleanedArtifacts: string[] = [];
  let safetyTagName: string | undefined;
  
  try {
    logger.info(`Starting rollback for ${taskId} to checkpoint at step ${checkpoint.stepNumber}`);
    
    // 1. Validate checkpoint
    const validation = await validateCheckpoint(clientFolder, checkpoint);
    if (!validation.valid) {
      throw new Error(`Checkpoint validation failed: ${validation.errors.join(', ')}`);
    }
    
    if (validation.warnings.length > 0) {
      logger.warn(`Checkpoint warnings for ${taskId}: ${validation.warnings.join(', ')}`);
    }
    
    // 2. Get current state for safety tag
    const currentCommit = await getCurrentCommitHash(clientFolder);
    const state = await loadTaskState(clientFolder, taskId);
    const failedStep = state?.failedStep?.stepNumber || 'unknown';
    
    // 3. Create safety tag before rollback
    safetyTagName = `recovery-${taskId}-step${failedStep}-${Date.now()}`;
    try {
      await createSafetyTag(
        clientFolder,
        safetyTagName,
        `Safety backup before rollback from step ${failedStep} to step ${checkpoint.stepNumber}`
      );
      logger.info(`Created safety tag ${safetyTagName} at ${currentCommit}`);
    } catch (tagError: any) {
      // Non-fatal - log but continue
      logger.warn(`Could not create safety tag: ${tagError.message}`);
      safetyTagName = undefined;
    }
    
    // 4. Get commits that will be discarded (for reporting)
    const discardedCommits = await getCommitsSince(clientFolder, checkpoint.gitCommitHash);
    
    // 5. Perform git hard reset
    await rollbackToCommit(clientFolder, checkpoint.gitCommitHash, false);
    logger.info(`Git reset to ${checkpoint.gitCommitHash} completed`);
    
    // 6. Clean up partial artifacts from failed step
    const failedStepNumber = state?.failedStep?.stepNumber;
    if (failedStepNumber) {
      const cleaned = await cleanupFailedStepArtifacts(clientFolder, taskId, failedStepNumber);
      cleanedArtifacts.push(...cleaned);
    }
    
    // 7. Update state to reflect rollback
    await clearFailedStepMarker(clientFolder, taskId);
    
    // Update task state with rollback info
    await updateTaskState(clientFolder, taskId, (currentState) => ({
      metadata: {
        ...currentState?.metadata,
        lastRollback: {
          timestamp: new Date().toISOString(),
          fromCommit: currentCommit,
          toCommit: checkpoint.gitCommitHash,
          toStep: checkpoint.stepNumber,
          safetyTag: safetyTagName
        }
      }
    }));
    
    logger.info(`Rollback completed for ${taskId}: ${discardedCommits.length} commits discarded`);
    
    return {
      success: true,
      checkpoint,
      discardedCommits: discardedCommits.length,
      cleanedArtifacts,
      safetyTagName
    };
    
  } catch (error: any) {
    logger.error(`Rollback failed for ${taskId}: ${error.message}`);
    
    // NOTE: Lock release is handled by the caller (continueAfterError in workflowOrchestrator.ts)
    // to prevent double-release race conditions
    
    return {
      success: false,
      checkpoint,
      discardedCommits: 0,
      cleanedArtifacts,
      safetyTagName,
      error: error.message
    };
  }
}

/**
 * Cleans up artifacts from a failed step.
 * - Removes partial screenshots
 * - Deletes incomplete diffs
 * - Clears temporary files
 */
export async function cleanupFailedStepArtifacts(
  clientFolder: string,
  taskId: string,
  stepNumber: number
): Promise<string[]> {
  const cleanedPaths: string[] = [];
  
  try {
    // Calculate iteration number (matching workflowOrchestrator logic)
    const iteration = stepNumber * 100;
    
    // Clean up screenshots for this step
    const screenshotsDir = path.join(process.cwd(), 'public', 'screenshots', taskId);
    
    if (await fs.pathExists(screenshotsDir)) {
      // Remove after_<iteration> directory
      const afterDir = path.join(screenshotsDir, `after_${iteration}`);
      if (await fs.pathExists(afterDir)) {
        await fs.remove(afterDir);
        cleanedPaths.push(afterDir);
        logger.debug(`Removed screenshot directory: ${afterDir}`);
      }
      
      // Remove any partial iteration sub-directories (e.g., after_100_partial)
      // FIX: Skip exact match since afterDir was already removed above to avoid redundant operations
      try {
        const dirs = await fs.readdir(screenshotsDir);
        const iterationStr = `after_${iteration}`;
        for (const dir of dirs) {
          // Only match sub-iterations (name_suffix), NOT the exact name (already removed above)
          if (dir.startsWith(`${iterationStr}_`)) {
            const fullPath = path.join(screenshotsDir, dir);
            await fs.remove(fullPath);
            cleanedPaths.push(fullPath);
          }
        }
      } catch (readErr) {
        logger.warn(`Could not read screenshots directory: ${readErr}`);
      }
    }
    
    // Clean up diff artifacts in client folder
    const clientTaskDir = path.join(clientFolder, '.clickup-workflow', taskId);
    if (await fs.pathExists(clientTaskDir)) {
      // Remove step-specific diff files
      const diffFile = path.join(clientTaskDir, `diff_step${stepNumber}.patch`);
      if (await fs.pathExists(diffFile)) {
        await fs.remove(diffFile);
        cleanedPaths.push(diffFile);
      }
    }
    
    // Clean up temp files in client folder
    const tempFiles = [
      '.workflow_history.tmp.json',
      '.CURSOR_TASK.tmp.md',
      '.demo.status.tmp.json'
    ];
    
    for (const tempFile of tempFiles) {
      const tempPath = path.join(clientFolder, tempFile);
      if (await fs.pathExists(tempPath)) {
        await fs.remove(tempPath);
        cleanedPaths.push(tempPath);
      }
    }
    
    if (cleanedPaths.length > 0) {
      logger.info(`Cleaned ${cleanedPaths.length} artifacts for ${taskId} step ${stepNumber}`);
    }
    
  } catch (error: any) {
    logger.warn(`Error during artifact cleanup for ${taskId}: ${error.message}`);
    // Non-fatal - cleanup is best-effort
  }
  
  return cleanedPaths;
}

/**
 * Generates rollback preview for UI.
 * Shows what will be preserved vs discarded.
 */
export async function generateRollbackPreview(
  clientFolder: string,
  taskId: string,
  checkpoint: StepCheckpoint,
  totalSteps: number = 4
): Promise<RollbackPreview> {
  try {
    // Get commits that will be discarded
    const discardedCommits = await getCommitsSince(clientFolder, checkpoint.gitCommitHash);
    
    // Get files that changed since checkpoint
    const changedFiles = await getChangedFiles(clientFolder, checkpoint.gitCommitHash);
    
    // Calculate preserved and discarded steps
    const preservedSteps: string[] = [];
    const discardedChanges: string[] = [];
    
    for (let step = 1; step <= checkpoint.stepNumber; step++) {
      preservedSteps.push(`Step ${step}: ${getStepDisplayName(step)} (completed)`);
    }
    
    // Get current demo status to know what step failed
    const state = await loadTaskState(clientFolder, taskId);
    const failedStep = state?.failedStep?.stepNumber || checkpoint.stepNumber + 1;
    
    for (let step = checkpoint.stepNumber + 1; step <= failedStep; step++) {
      discardedChanges.push(`Step ${step}: ${getStepDisplayName(step)} (will be discarded)`);
    }
    
    // Add commit summaries to discarded changes
    if (discardedCommits.length > 0) {
      const commitSummary = discardedCommits.length === 1
        ? '1 commit will be discarded'
        : `${discardedCommits.length} commits will be discarded`;
      discardedChanges.push(commitSummary);
    }
    
    // Add file change summary
    if (changedFiles.length > 0) {
      const filesSummary = changedFiles.length === 1
        ? '1 file modification will be undone'
        : `${changedFiles.length} file modifications will be undone`;
      discardedChanges.push(filesSummary);
    }
    
    return {
      preservedSteps,
      discardedChanges,
      discardedCommits,
      changedFiles,
      willRollbackTo: checkpoint.gitCommitHash,
      willRollbackToStep: checkpoint.stepNumber
    };
    
  } catch (error: any) {
    logger.error(`Error generating rollback preview: ${error.message}`);
    
    // Return minimal preview on error
    return {
      preservedSteps: [`Steps 1-${checkpoint.stepNumber} will be preserved`],
      discardedChanges: ['Failed step changes will be discarded'],
      discardedCommits: [],
      changedFiles: [],
      willRollbackTo: checkpoint.gitCommitHash,
      willRollbackToStep: checkpoint.stepNumber
    };
  }
}

/**
 * Performs a "skip" operation - marks current step as skipped and advances.
 * Does NOT rollback git, just updates status to move to next step.
 */
export async function skipFailedStep(
  clientFolder: string,
  taskId: string,
  failedStepNumber: number,
  totalSteps: number = 4
): Promise<{ success: boolean; nextStep: number; error?: string }> {
  // FIX: Store original status for rollback if task state update fails
  let originalStatusJson: string | null = null;
  const demoStatusPath = path.join(clientFolder, 'demo.status.json');
  
  try {
    if (failedStepNumber >= totalSteps) {
      return {
        success: false,
        nextStep: failedStepNumber,
        error: 'Cannot skip the final step'
      };
    }
    
    const nextStep = failedStepNumber + 1;
    
    // Backup original status for potential rollback
    if (await fs.pathExists(demoStatusPath)) {
      originalStatusJson = await fs.readFile(demoStatusPath, 'utf-8');
      const status = JSON.parse(originalStatusJson);
      
      // Deduplicate skippedSteps to prevent duplicates from rapid clicks
      const existingSkipped = status.skippedSteps || [];
      const newSkippedSteps = existingSkipped.includes(failedStepNumber) 
        ? existingSkipped 
        : [...existingSkipped, failedStepNumber];
      
      await fs.writeJson(demoStatusPath, {
        ...status,
        currentStep: nextStep,
        lastCompletedStep: failedStepNumber, // Mark as "completed" (skipped)
        state: 'pending',
        message: `Skipped step ${failedStepNumber}, starting step ${nextStep}`,
        skippedSteps: newSkippedSteps,
        updatedAt: new Date().toISOString(),
        logs: [
          ...(status.logs || []),
          `[${new Date().toLocaleTimeString()}] Step ${failedStepNumber} skipped by user. Moving to step ${nextStep}.`
        ]
      }, { spaces: 2 });
    }
    
    // Now update task state (source of truth for recovery)
    try {
      await updateTaskState(clientFolder, taskId, (currentState) => {
        const existingSkipped = currentState?.metadata?.skippedSteps || [];
        const newSkippedSteps = existingSkipped.includes(failedStepNumber)
          ? existingSkipped
          : [...existingSkipped, failedStepNumber];
        
        return {
          state: WorkflowState.IN_PROGRESS,
          failedStep: undefined, // Clear failed step marker
          metadata: {
            ...currentState?.metadata,
            skippedSteps: newSkippedSteps,
            lastSkipTimestamp: new Date().toISOString()
          }
        };
      });
    } catch (taskStateError: any) {
      // FIX: Rollback demo.status.json if task state update fails to maintain consistency
      logger.error(`Task state update failed, rolling back demo.status.json: ${taskStateError.message}`);
      if (originalStatusJson) {
        await fs.writeFile(demoStatusPath, originalStatusJson, 'utf-8');
      }
      throw taskStateError;
    }
    
    logger.info(`Skipped step ${failedStepNumber} for ${taskId}, advancing to step ${nextStep}`);
    
    return {
      success: true,
      nextStep
    };
    
  } catch (error: any) {
    logger.error(`Failed to skip step ${failedStepNumber} for ${taskId}: ${error.message}`);
    return {
      success: false,
      nextStep: failedStepNumber,
      error: error.message
    };
  }
}
