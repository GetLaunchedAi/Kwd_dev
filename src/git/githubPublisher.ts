import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import simpleGit, { SimpleGit } from 'simple-git';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { applyGitUserConfig } from './repoManager';

export interface PublishResult {
  success: boolean;
  repoUrl?: string;
  repoFullName?: string;
  error?: string;
}

export interface PublishProgress {
  stage: 'validating' | 'creating_repo' | 'configuring_remote' | 'pushing' | 'completed' | 'failed';
  message: string;
  progress?: number;
}

type ProgressCallback = (progress: PublishProgress) => void;

/**
 * Publishes a demo site to a GitHub organization by creating a new repo and pushing the code.
 */
export async function publishDemoToGitHubOrg(
  clientSlug: string,
  progressCallback?: ProgressCallback
): Promise<PublishResult> {
  const githubOrg = config.git.githubOrg;
  const githubToken = config.git.githubToken;
  const defaultBranch = config.git.defaultBranch || 'main';
  const demoDir = path.join(process.cwd(), 'client-websites', clientSlug);

  const updateProgress = (progress: PublishProgress) => {
    logger.info(`Publish progress [${clientSlug}]: ${progress.stage} - ${progress.message}`);
    if (progressCallback) {
      progressCallback(progress);
    }
  };

  // Validation
  updateProgress({ stage: 'validating', message: 'Validating configuration and repository...' });

  if (!githubOrg) {
    const error = 'GitHub organization not configured. Please set it in Settings.';
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error };
  }

  if (!githubToken) {
    const error = 'GitHub token not configured. Please set GITHUB_TOKEN environment variable.';
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error };
  }

  if (!await fs.pathExists(demoDir)) {
    const error = `Demo directory not found: ${demoDir}`;
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error };
  }

  const gitDir = path.join(demoDir, '.git');
  if (!await fs.pathExists(gitDir)) {
    const error = `Demo directory is not a git repository: ${demoDir}`;
    updateProgress({ stage: 'failed', message: error });
    return { success: false, error };
  }

  // Create repo in org
  updateProgress({ stage: 'creating_repo', message: `Creating repository "${clientSlug}" in organization "${githubOrg}"...`, progress: 25 });

  let repoUrl: string;
  let repoFullName: string;

  try {
    const response = await axios.post(
      `https://api.github.com/orgs/${githubOrg}/repos`,
      {
        name: clientSlug,
        description: `Demo site for ${clientSlug}`,
        private: false,
        auto_init: false
      },
      {
        headers: {
          'Authorization': `Bearer ${githubToken}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    );

    repoUrl = response.data.html_url;
    repoFullName = response.data.full_name;
    logger.info(`Created GitHub repo: ${repoFullName}`);
  } catch (error: any) {
    if (error.response?.status === 422 && error.response?.data?.errors?.[0]?.message?.includes('already exists')) {
      // Repo already exists - try to get its URL
      try {
        const getRepoResponse = await axios.get(
          `https://api.github.com/repos/${githubOrg}/${clientSlug}`,
          {
            headers: {
              'Authorization': `Bearer ${githubToken}`,
              'Accept': 'application/vnd.github.v3+json'
            }
          }
        );
        repoUrl = getRepoResponse.data.html_url;
        repoFullName = getRepoResponse.data.full_name;
        logger.info(`Using existing GitHub repo: ${repoFullName}`);
      } catch (getError: any) {
        const errorMsg = `Repository "${clientSlug}" already exists in "${githubOrg}" but cannot be accessed. Consider using a unique name.`;
        updateProgress({ stage: 'failed', message: errorMsg });
        return { success: false, error: errorMsg };
      }
    } else if (error.response?.status === 404) {
      const errorMsg = `Organization "${githubOrg}" not found or token lacks access.`;
      updateProgress({ stage: 'failed', message: errorMsg });
      return { success: false, error: errorMsg };
    } else if (error.response?.status === 403) {
      const errorMsg = `Token lacks permission to create repos in "${githubOrg}". Ensure token has 'repo' and 'admin:org' scopes.`;
      updateProgress({ stage: 'failed', message: errorMsg });
      return { success: false, error: errorMsg };
    } else {
      const errorMsg = `Failed to create repository: ${error.response?.data?.message || error.message}`;
      updateProgress({ stage: 'failed', message: errorMsg });
      return { success: false, error: errorMsg };
    }
  }

  // Configure remote
  updateProgress({ stage: 'configuring_remote', message: 'Configuring git remote...', progress: 50 });

  const git: SimpleGit = simpleGit(demoDir);
  const useSSH = config.git.useSSH ?? false;

  try {
    // Ensure git user config is set
    await applyGitUserConfig(demoDir);

    // Check if origin remote exists
    const remotes = await git.getRemotes(true);
    const originRemote = remotes.find(r => r.name === 'origin');

    // Build the remote URL based on useSSH config
    let remoteUrl: string;
    if (useSSH) {
      // SSH URL format (assumes SSH key is configured on server)
      remoteUrl = `git@github.com:${repoFullName}.git`;
      logger.info('Using SSH remote URL for push');
    } else {
      // HTTPS URL with token authentication
      remoteUrl = `https://${githubToken}@github.com/${repoFullName}.git`;
      logger.info('Using HTTPS remote URL for push');
    }

    if (originRemote) {
      // Update existing origin
      await git.remote(['set-url', 'origin', remoteUrl]);
      logger.info('Updated origin remote URL');
    } else {
      // Add origin remote
      await git.addRemote('origin', remoteUrl);
      logger.info('Added origin remote');
    }
  } catch (error: any) {
    const errorMsg = `Failed to configure git remote: ${error.message}`;
    updateProgress({ stage: 'failed', message: errorMsg });
    return { success: false, error: errorMsg, repoUrl, repoFullName };
  }

  // Push to remote with retry
  updateProgress({ stage: 'pushing', message: `Pushing to ${defaultBranch}...`, progress: 75 });

  const maxRetries = 3;
  let lastError: string = '';

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // Ensure we're on the right branch
      const currentBranch = await git.revparse(['--abbrev-ref', 'HEAD']);
      if (currentBranch !== defaultBranch) {
        try {
          await git.checkout(defaultBranch);
        } catch {
          // Branch might not exist, create it
          await git.checkoutLocalBranch(defaultBranch);
        }
      }

      // Push with force to handle initial empty repo or branch mismatch
      await git.push('origin', defaultBranch, ['--set-upstream', '--force']);
      logger.info(`Successfully pushed to ${repoFullName}/${defaultBranch}`);

      // Clear the token from the remote URL for security (only needed for HTTPS)
      if (!useSSH) {
        try {
          const publicUrl = `https://github.com/${repoFullName}.git`;
          await git.remote(['set-url', 'origin', publicUrl]);
        } catch {
          // Non-critical if this fails
        }
      }

      updateProgress({ stage: 'completed', message: `Successfully published to ${repoUrl}`, progress: 100 });
      return { success: true, repoUrl, repoFullName };
    } catch (error: any) {
      lastError = error.message;
      logger.warn(`Push attempt ${attempt}/${maxRetries} failed: ${lastError}`);

      if (attempt < maxRetries) {
        // Wait before retry with exponential backoff
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }

  const errorMsg = `Failed to push after ${maxRetries} attempts: ${lastError}`;
  updateProgress({ stage: 'failed', message: errorMsg });
  return { success: false, error: errorMsg, repoUrl, repoFullName };
}
