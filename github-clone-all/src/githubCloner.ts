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
  status: 'cloning' | 'updating' | 'success' | 'error';
  message?: string;
}

export class GitHubCloneAll {
  private githubToken: string;
  private baseUrl = 'https://api.github.com';
  private progressCallback?: (progress: CloneProgress) => void;

  constructor(token: string, progressCallback?: (progress: CloneProgress) => void) {
    this.githubToken = token;
    this.progressCallback = progressCallback;
  }

  /**
   * Fetches all repositories for a user or organization
   */
  async getAllRepos(username: string, includePrivate: boolean = false): Promise<GitHubRepo[]> {
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:36',message:'getAllRepos called',data:{username,includePrivate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

    const repos: GitHubRepo[] = [];
    let page = 1;
    const perPage = 100;

    while (true) {
      try {
        const url = username.includes('/')
          ? `${this.baseUrl}/orgs/${username.split('/')[0]}/repos`
          : `${this.baseUrl}/users/${username}/repos`;

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:45',message:'Making GitHub API request',data:{url,page,hasToken:!!this.githubToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

        const response = await axios.get(url, {
          headers: {
            'Authorization': `token ${this.githubToken}`,
            'Accept': 'application/vnd.github.v3+json',
          },
          params: {
            page,
            per_page: perPage,
            type: 'all',
          },
        });

        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:60',message:'GitHub API response received',data:{status:response.status,repoCount:response.data.length,page},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

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
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:78',message:'GitHub API error',data:{errorMessage:error.message,status:error.response?.status,statusText:error.response?.statusText},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
        // #endregion

        if (error.response?.status === 404) {
          throw new Error(`User or organization '${username}' not found`);
        }
        throw new Error(`Error fetching repositories: ${error.message}`);
      }
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:85',message:'getAllRepos completed',data:{totalRepos:repos.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'D'})}).catch(()=>{});
    // #endregion

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
    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:88',message:'cloneOrUpdateRepo called',data:{repoName:repo.name,repoPath:path.join(targetDir, repo.name),useSSH,updateExisting},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
    // #endregion

    const repoPath = path.join(targetDir, repo.name);

    // Check if repo already exists
    if (fs.existsSync(repoPath)) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:99',message:'Repository path already exists',data:{repoPath,updateExisting},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      if (!updateExisting) {
        if (this.progressCallback) {
          this.progressCallback({
            current: currentIndex + 1,
            total,
            repoName: repo.name,
            status: 'success',
            message: 'Skipped (already exists)'
          });
        }
        return;
      }

      if (this.progressCallback) {
        this.progressCallback({
          current: currentIndex + 1,
          total,
          repoName: repo.name,
          status: 'updating',
          message: 'Updating existing repository...'
        });
      }

      try {
        const git = simpleGit(repoPath);
        
        // Check if it's a git repo
        if (!fs.existsSync(path.join(repoPath, '.git'))) {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:128',message:'Path exists but not a git repo, removing',data:{repoPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          await fs.remove(repoPath);
        } else {
          // #region agent log
          fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:131',message:'Updating existing git repo',data:{repoPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
          // #endregion
          // Pull latest changes
          await git.fetch();
          await git.pull();
          if (this.progressCallback) {
            this.progressCallback({
              current: currentIndex + 1,
              total,
              repoName: repo.name,
              status: 'success',
              message: 'Updated successfully'
            });
          }
          return;
        }
      } catch (error: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:145',message:'Error updating existing repo, removing',data:{repoPath,errorMessage:error.message,errorStack:error.stack},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion
        await fs.remove(repoPath);
      }
    }

    // Clone the repository
    if (this.progressCallback) {
      this.progressCallback({
        current: currentIndex + 1,
        total,
        repoName: repo.name,
        status: 'cloning',
        message: 'Cloning repository...'
      });
    }

    // Prepare clone URL
    let cloneUrl = useSSH ? repo.ssh_url : repo.clone_url;

    // For private repos with HTTPS, embed token in URL
    if (!useSSH && repo.private && this.githubToken) {
      // Replace https://github.com/ with https://TOKEN@github.com/
      cloneUrl = cloneUrl.replace('https://', `https://${this.githubToken}@`);
    }

    try {
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:162',message:'Attempting to clone repository',data:{repoName:repo.name,cloneUrl:cloneUrl.replace(this.githubToken,'[TOKEN]'),repoPath,useSSH,isPrivate:repo.private,hasToken:!!this.githubToken},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      await simpleGit().clone(cloneUrl, repoPath, ['--recursive']);
      
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:165',message:'Clone successful',data:{repoName:repo.name,repoPath},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      if (this.progressCallback) {
        this.progressCallback({
          current: currentIndex + 1,
          total,
          repoName: repo.name,
          status: 'success',
          message: 'Cloned successfully'
        });
      }
    } catch (error: any) {
      // #region agent log
      fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:178',message:'Clone failed with error',data:{repoName:repo.name,cloneUrl,errorMessage:error.message,errorStack:error.stack,errorName:error.name,errorCode:error.code},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
      // #endregion

      if (this.progressCallback) {
        this.progressCallback({
          current: currentIndex + 1,
          total,
          repoName: repo.name,
          status: 'error',
          message: `Error: ${error.message}`
        });
      }
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

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:272',message:'Starting clone loop',data:{totalRepos:filteredRepos.length,useSSH,includePrivate},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion

    for (let i = 0; i < filteredRepos.length; i++) {
      const repo = filteredRepos[i];
      try {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:225',message:'Processing repo in loop',data:{index:i,total:filteredRepos.length,repoName:repo.name,isPrivate:repo.private,cloneUrl:repo.clone_url},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion

        await this.cloneOrUpdateRepo(repo, targetDir, useSSH, updateExisting, i, filteredRepos.length);
        
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:230',message:'Repo clone succeeded',data:{repoName:repo.name,successCount:successCount+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion

        successCount++;
      } catch (error: any) {
        // #region agent log
        fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:235',message:'Repo clone failed in loop catch',data:{repoName:repo.name,errorMessage:error.message,errorStack:error.stack,errorName:error.name,failCount:failCount+1},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'F'})}).catch(()=>{});
        // #endregion

        failCount++;
      }
    }

    // #region agent log
    fetch('http://127.0.0.1:7242/ingest/ba0e9212-a723-45eb-a5c4-2ac1c27b1b9d',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'githubCloner.ts:297',message:'Clone loop completed',data:{successCount,failCount,total:filteredRepos.length},timestamp:Date.now(),sessionId:'debug-session',runId:'run1',hypothesisId:'G'})}).catch(()=>{});
    // #endregion

    return {
      success: successCount,
      failed: failCount,
      total: filteredRepos.length
    };
  }
}


