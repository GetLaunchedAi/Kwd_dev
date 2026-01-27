import * as fs from 'fs-extra';
import * as path from 'path';
import axios from 'axios';
import simpleGit from 'simple-git';

export interface GitHubRepo {
  name: string;
  full_name: string;
  clone_url: string;
  ssh_url: string;
  private: boolean;
  default_branch: string;
}

export interface CloneProgress {
  current: number;
  total: number;
  repoName: string;
  status: 'cloning' | 'updating' | 'success' | 'error' | 'completed';
  message?: string;
  operationId?: string;
}

export class GitHubCloneAll {
  private githubToken: string;
  private baseUrl = 'https://api.github.com';
  private progressCallback?: (progress: CloneProgress) => void;
  private operationId?: string;

  constructor(token: string, progressCallback?: (progress: CloneProgress) => void, operationId?: string) {
    this.githubToken = token;
    this.progressCallback = progressCallback;
    this.operationId = operationId;
  }

  private updateProgress(progress: Omit<CloneProgress, 'operationId'>) {
    if (this.progressCallback) {
      this.progressCallback({
        ...progress,
        operationId: this.operationId
      });
    }
  }

  /**
   * Fetches all repositories for a user or organization
   */
  async getAllRepos(username: string, includePrivate: boolean = false): Promise<GitHubRepo[]> {
    const repos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      try {
        const url = username.includes('/')
          ? `${this.baseUrl}/orgs/${username.split('/')[0]}/repos`
          : `${this.baseUrl}/users/${username}/repos`;

        const response = await axios.get(url, {
          headers: {
            'Authorization': `Bearer ${this.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
          params: {
            page,
            per_page: perPage,
            type: 'all',
          },
        });

        if (response.data.length === 0) {
          break;
        }

        const filteredRepos = includePrivate
          ? response.data
          : response.data.filter((repo: GitHubRepo) => !repo.private);

        repos.push(...filteredRepos);

        if (response.data.length < perPage) {
          break;
        }

        page++;
      } catch (error: any) {
        if (error.response?.status === 404) {
          throw new Error(`User or organization '${username}' not found`);
        }
        throw new Error(`Error fetching repositories: ${error.message}`);
      }
    }

    return repos;
  }

  /**
   * Clones a repository or updates it if it already exists
   */
  async cloneOrUpdateRepo(
    repo: GitHubRepo,
    targetDir: string,
    useSSH: boolean = false,
    updateExisting: boolean = true,
    currentIndex: number,
    total: number
  ): Promise<void> {
    const repoPath = path.join(targetDir, repo.name);

    // Check if repo already exists
    if (fs.existsSync(repoPath)) {
      if (!updateExisting) {
        this.updateProgress({
          current: currentIndex + 1,
          total,
          repoName: repo.name,
          status: 'success',
          message: 'Skipped (already exists)'
        });
        return;
      }

      this.updateProgress({
        current: currentIndex + 1,
        total,
        repoName: repo.name,
        status: 'updating',
        message: 'Updating existing repository...'
      });

      try {
        const git = simpleGit(repoPath);
        
        // Check if it's a git repo
        if (!fs.existsSync(path.join(repoPath, '.git'))) {
          await fs.remove(repoPath);
        } else {
          // Pull latest changes
          await git.fetch();
          await git.pull();
          this.updateProgress({
            current: currentIndex + 1,
            total,
            repoName: repo.name,
            status: 'success',
            message: 'Updated successfully'
          });
          return;
        }
      } catch (error: any) {
        await fs.remove(repoPath);
      }
    }

    // Clone the repository
    this.updateProgress({
      current: currentIndex + 1,
      total,
      repoName: repo.name,
      status: 'cloning',
      message: 'Cloning repository...'
    });

    // Prepare clone URL
    let cloneUrl = useSSH ? repo.ssh_url : repo.clone_url;

    // For private repos with HTTPS, embed token in URL
    if (!useSSH && repo.private && this.githubToken) {
      // Replace https://github.com/ with https://TOKEN@github.com/
      cloneUrl = cloneUrl.replace('https://', `https://${this.githubToken}@`);
    }

    try {
      await simpleGit().clone(cloneUrl, repoPath, ['--recursive']);
      
      this.updateProgress({
        current: currentIndex + 1,
        total,
        repoName: repo.name,
        status: 'success',
        message: 'Cloned successfully'
      });
    } catch (error: any) {
      this.updateProgress({
        current: currentIndex + 1,
        total,
        repoName: repo.name,
        status: 'error',
        message: `Error: ${error.message}`
      });
      throw error;
    }
  }

  /**
   * Clones all repositories
   */
  async cloneAll(
    username: string,
    targetDir: string,
    options: {
      includePrivate?: boolean;
      useSSH?: boolean;
      updateExisting?: boolean;
      filter?: string;
    } = {}
  ): Promise<{ success: number; failed: number; total: number }> {
    const {
      includePrivate = false,
      useSSH = false,
      updateExisting = true,
      filter,
    } = options;

    // Ensure target directory exists
    await fs.ensureDir(targetDir);

    // Get all repositories
    const repos = await this.getAllRepos(username, includePrivate);

    // Filter repositories if filter is provided
    const filteredRepos = filter
      ? repos.filter(repo => repo.name.toLowerCase().includes(filter.toLowerCase()))
      : repos;

    if (filteredRepos.length === 0) {
      throw new Error('No repositories to clone');
    }

    // Clone each repository
    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < filteredRepos.length; i++) {
      const repo = filteredRepos[i];
      try {
        await this.cloneOrUpdateRepo(repo, targetDir, useSSH, updateExisting, i, filteredRepos.length);
        successCount++;
      } catch (error: any) {
        failCount++;
      }
    }

    this.updateProgress({
      current: filteredRepos.length,
      total: filteredRepos.length,
      repoName: 'All Done',
      status: 'completed',
      message: `Finished: ${successCount} success, ${failCount} failed`
    });

    return {
      success: successCount,
      failed: failCount,
      total: filteredRepos.length
    };
  }
}

