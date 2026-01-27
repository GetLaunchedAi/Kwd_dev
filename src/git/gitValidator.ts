import * as fs from 'fs-extra';
import * as path from 'path';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { updateWorkflowState, WorkflowState } from '../state/stateManager';

export interface GitValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates that a folder is initialized as a git repository and has proper git configuration.
 * This should be called before starting any task or demo workflow.
 * 
 * @param folderPath - The path to the task/demo folder
 * @param taskId - The task or demo ID (for error reporting)
 * @param updateState - Whether to update workflow state on error (default: true)
 * @returns GitValidationResult with validation status and messages
 */
export async function validateGitSetup(
  folderPath: string,
  taskId: string,
  updateState: boolean = true
): Promise<GitValidationResult> {
  const result: GitValidationResult = {
    isValid: true,
    errors: [],
    warnings: []
  };

  logger.info(`Validating git setup for ${taskId} in ${folderPath}`);

  // 1. Check if folder exists
  if (!(await fs.pathExists(folderPath))) {
    result.isValid = false;
    result.errors.push(`Folder does not exist: ${folderPath}`);
    
    if (updateState) {
      await updateWorkflowStateError(
        folderPath,
        taskId,
        'Git Validation Failed: Folder does not exist'
      ).catch(() => {}); // Best effort - can't write state if folder doesn't exist
    }
    
    return result;
  }

  // 2. Check if it's a git repository
  const gitPath = path.join(folderPath, '.git');
  if (!(await fs.pathExists(gitPath))) {
    result.isValid = false;
    result.errors.push(
      `Not a Git repository: ${folderPath} is missing .git directory. ` +
      `Please initialize with "git init" or clone from a repository.`
    );
    
    if (updateState) {
      await updateWorkflowStateError(
        folderPath,
        taskId,
        'Git Validation Failed: Not a Git repository. Please initialize the project with git.'
      ).catch(() => {}); // Best effort
    }
    
    return result;
  }

  // 3. Validate git configuration from settings
  const gitConfigErrors = validateGitConfigSettings();
  if (gitConfigErrors.length > 0) {
    result.isValid = false;
    result.errors.push(...gitConfigErrors);
    
    if (updateState) {
      const errorMessage = gitConfigErrors.join(' | ');
      await updateWorkflowStateError(
        folderPath,
        taskId,
        `Git Configuration Missing: ${errorMessage}`
      ).catch(() => {});
    }
    
    return result;
  }

  // 4. Check if git is properly initialized (has commits or is ready to commit)
  try {
    const git: SimpleGit = simpleGit(folderPath);
    
    // Check if repository is properly initialized
    const isRepo = await git.checkIsRepo();
    if (!isRepo) {
      result.isValid = false;
      result.errors.push(`Invalid Git repository: ${folderPath} is not recognized as a valid git repo`);
      
      if (updateState) {
        await updateWorkflowStateError(
          folderPath,
          taskId,
          'Git Validation Failed: Invalid Git repository structure'
        ).catch(() => {});
      }
      
      return result;
    }

    // Check if we have user config set locally (required for commits)
    try {
      const localConfig = await git.listConfig('local');
      if (!localConfig.all['user.name'] || !localConfig.all['user.email']) {
        result.warnings.push(
          'Git user.name and user.email are not configured locally. ' +
          'They will be set automatically from settings.'
        );
      }
    } catch (configError: any) {
      logger.warn(`Could not check local git config: ${configError.message}`);
    }

    // Check current branch exists
    try {
      const branches = await git.branchLocal();
      if (branches.all.length === 0) {
        result.warnings.push(
          'No branches found in repository. This may be a fresh init. ' +
          'A branch will be created automatically.'
        );
      }
    } catch (branchError: any) {
      logger.warn(`Could not check branches: ${branchError.message}`);
    }

  } catch (error: any) {
    result.isValid = false;
    result.errors.push(`Git validation error: ${error.message}`);
    
    if (updateState) {
      await updateWorkflowStateError(
        folderPath,
        taskId,
        `Git Validation Failed: ${error.message}`
      ).catch(() => {});
    }
    
    return result;
  }

  // If we got here, validation passed
  if (result.warnings.length > 0) {
    logger.warn(`Git validation passed with warnings for ${taskId}: ${result.warnings.join('; ')}`);
  } else {
    logger.info(`Git validation passed for ${taskId}`);
  }

  return result;
}

/**
 * Validates that git configuration settings are properly set.
 * Checks for required git settings in config.
 * 
 * @returns Array of error messages (empty if valid)
 */
export function validateGitConfigSettings(): string[] {
  const errors: string[] = [];

  // Check if git configuration exists
  if (!config.git) {
    errors.push(
      'Git configuration is missing from settings. ' +
      'Please configure git settings in config.json.'
    );
    return errors;
  }

  // Check for required git settings
  if (!config.git.clientWebsitesDir || config.git.clientWebsitesDir.trim() === '') {
    errors.push(
      'git.clientWebsitesDir is not set in configuration. ' +
      'Please set the client websites directory in config.json.'
    );
  }

  if (!config.git.defaultBranch || config.git.defaultBranch.trim() === '') {
    errors.push(
      'git.defaultBranch is not set in configuration. ' +
      'Please set the default branch name (e.g., "main" or "master") in config.json.'
    );
  }

  // GitHub token is required for some operations
  if (!config.git.githubToken || config.git.githubToken.trim() === '') {
    errors.push(
      'git.githubToken is not set in configuration. ' +
      'Please set the GitHub token in config.json or as GITHUB_TOKEN environment variable.'
    );
  }

  // Check user config (used for commits) - these have fallback defaults, so just warn
  if (!config.git.userName || config.git.userName.trim() === '') {
    logger.warn('git.userName is not set. Using default: "KWD Dev Bot"');
  }

  if (!config.git.userEmail || config.git.userEmail.trim() === '') {
    logger.warn('git.userEmail is not set. Using default: "bot@kwd.dev"');
  }

  return errors;
}

/**
 * Helper to update workflow state with error
 */
async function updateWorkflowStateError(
  folderPath: string,
  taskId: string,
  errorMessage: string
): Promise<void> {
  try {
    // Only update state if the folder exists (otherwise state file can't be written)
    if (await fs.pathExists(folderPath)) {
      await updateWorkflowState(
        folderPath,
        taskId,
        WorkflowState.ERROR,
        { error: errorMessage },
        'Git validation failed'
      );
    }
    logger.error(`${taskId}: ${errorMessage}`);
  } catch (error: any) {
    logger.error(`Failed to update workflow state for ${taskId}: ${error.message}`);
  }
}

/**
 * Quick check if git settings are configured (without folder validation).
 * Useful for pre-flight checks before starting workflows.
 * 
 * @returns true if git settings are valid, false otherwise
 */
export function areGitSettingsConfigured(): boolean {
  const errors = validateGitConfigSettings();
  return errors.length === 0;
}

