import axios, { AxiosInstance } from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as crypto from 'crypto';

const DEBUG_LOG_PATH = path.join(process.cwd(), '.cursor', 'debug.log');
function debugLog(location: string, message: string, data: any, hypothesisId: string) {
  try {
    fs.ensureDirSync(path.dirname(DEBUG_LOG_PATH));
    const logEntry = JSON.stringify({
      location,
      message,
      data,
      timestamp: Date.now(),
      sessionId: 'debug-session',
      runId: 'run1',
      hypothesisId
    }) + '\n';
    fs.appendFileSync(DEBUG_LOG_PATH, logEntry);
  } catch (e) {}
}

export interface ClickUpTask {
  id: string;
  name: string;
  description: string;
  status: {
    status: string;
    color: string;
    type?: string; // 'open' or 'closed' from ClickUp API
  };
  url: string;
  assignees: Array<{
    id: string;
    username: string;
    email: string;
  }>;
  comments?: Array<{
    id: string;
    comment: Array<{
      text: string;
    }>;
    user: {
      username: string;
    };
    date: string;
  }>;
  attachments?: Array<{
    id: string;
    name?: string;
    title?: string;
    extension?: string;
    thumbnail_medium?: string;
    thumbnail_small?: string;
    url?: string;
    url_w_query?: string;
    mimetype?: string;
  }>;
  folder?: {
    id: string;
    name: string;
  };
  list?: {
    id: string;
    name: string;
  };
  project?: {
    id: string;
    name: string;
  };
  space?: {
    id: string;
    name: string;
  };
  custom_fields?: Array<{
    id: string;
    name: string;
    value?: any;
  }>;
  priority?: {
    id: string;
    priority: string;
    color: string;
    orderindex: string;
  };
}

export interface ClickUpWebhookEvent {
  event: string;
  task_id: string;
  webhook_id: string;
  history_items?: Array<{
    field: string;
    value: any;
  }>;
}

export interface TaskFilterOptions {
  spaceIds?: string[];
  excludeSpaceIds?: string[];
  folderIds?: string[];
  excludeFolderIds?: string[];
  listIds?: string[];
  excludeListIds?: string[];
  statusFilters?: {
    excludeStatuses?: string[];
    includeOnlyStatuses?: string[];
  };
}

class ClickUpApiClient {
  private api: AxiosInstance;
  private baseUrl = 'https://api.clickup.com/api/v2';
  private requestQueue: Array<() => Promise<any>> = [];
  private isProcessingQueue = false;
  private lastRequestTime = 0;
  private minRequestDelay = 100; // Minimum delay between requests in ms
  private retryAttempts = 0;
  private maxRetryAttempts = 5;
  private baseRetryDelay = 1000; // Base delay for exponential backoff in ms

  constructor() {
    this.api = axios.create({
      baseURL: this.baseUrl,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Set up request interceptor to add authorization header and rate limiting delays
    this.api.interceptors.request.use(async (config) => {
      // Ensure minimum delay between requests
      await this.ensureRequestDelay();
      
      const token = await this.getAuthToken();
      if (token) {
        config.headers['Authorization'] = token;
      } else {
      }
      return config;
    });

    // Set up response interceptor to handle rate limiting
    this.api.interceptors.response.use(
      (response) => {
        // Reset retry attempts on successful request
        this.retryAttempts = 0;
        return response;
      },
      async (error) => {
        const originalRequest = error.config;

        // Handle rate limit errors (429)
        if (error.response?.status === 429) {
          this.retryAttempts += 1;
          
          if (this.retryAttempts <= this.maxRetryAttempts) {
            const retryDelay = this.baseRetryDelay * Math.pow(2, this.retryAttempts - 1);
            logger.warn(`Rate limit hit. Retrying after ${retryDelay}ms (attempt ${this.retryAttempts}/${this.maxRetryAttempts})`);
            
            await this.delay(retryDelay);
            
            // Retry the request
            return this.api(originalRequest);
          } else {
            logger.error(`Rate limit exceeded after ${this.maxRetryAttempts} attempts`);
            this.retryAttempts = 0;
            throw error;
          }
        }

        return Promise.reject(error);
      }
    );
  }

  /**
   * Delays execution for the specified number of milliseconds
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Ensures minimum delay between requests to avoid rate limiting
   */
  private async ensureRequestDelay(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - this.lastRequestTime;
    
    if (timeSinceLastRequest < this.minRequestDelay) {
      await this.delay(this.minRequestDelay - timeSinceLastRequest);
    }
    
    this.lastRequestTime = Date.now();
  }

  /**
   * Gets the authenticated user
   */
  async getAuthenticatedUser(): Promise<any> {
    try {
      logger.debug('Fetching authenticated user');
      const response = await this.api.get('/user');
      return response.data.user;
    } catch (error: any) {
      logger.error(`Error fetching authenticated user: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the authorization token (API token or OAuth access token)
   */
  private async getAuthToken(): Promise<string | null> {
    // Try OAuth access token from file first (this is the preferred method)
    const { getAccessToken } = await import('./oauthService');
    const oauthToken = await getAccessToken();
    if (oauthToken) {
      return oauthToken;
    }

    // Try API token as fallback
    if (config.clickup.apiToken && config.clickup.apiToken !== 'placeholder') {
      return config.clickup.apiToken;
    }

    // Try explicit accessToken from config
    if (config.clickup.accessToken) {
      return config.clickup.accessToken;
    }

    return null;
  }

  /**
   * Fetches a task by ID
   */
  async getTask(taskId: string): Promise<ClickUpTask> {
    try {
      logger.debug(`Fetching ClickUp task: ${taskId}`);
      const response = await this.api.get(`/task/${taskId}`);
      return response.data as ClickUpTask;
    } catch (error: any) {
      logger.error(`Error fetching task ${taskId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Fetches task comments
   */
  async getTaskComments(taskId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching comments for task: ${taskId}`);
      const response = await this.api.get(`/task/${taskId}/comment`);
      return response.data.comments || [];
    } catch (error: any) {
      logger.error(`Error fetching comments for task ${taskId}: ${error.message}`);
      return [];
    }
  }

  /**
   * Updates task status
   */
  async updateTaskStatus(taskId: string, statusId: string): Promise<void> {
    try {
      logger.debug(`Updating task ${taskId} status to ${statusId}`);
      await this.api.put(`/task/${taskId}`, {
        status: statusId,
      });
    } catch (error: any) {
      logger.error(`Error updating task status: ${error.message}`);
      throw error;
    }
  }

  /**
   * Updates task description
   */
  async updateTaskDescription(taskId: string, description: string): Promise<void> {
    try {
      logger.debug(`Updating task ${taskId} description`);
      await this.api.put(`/task/${taskId}`, {
        description: description,
      });
    } catch (error: any) {
      logger.error(`Error updating task description: ${error.message}`);
      throw error;
    }
  }

  /**
   * Adds a comment to a task
   */
  async addComment(taskId: string, comment: string): Promise<void> {
    try {
      logger.debug(`Adding comment to task ${taskId}`);
      await this.api.post(`/task/${taskId}/comment`, {
        comment_text: comment,
      });
    } catch (error: any) {
      logger.error(`Error adding comment: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets the team ID (first team from user's teams)
   */
  async getTeamId(): Promise<string> {
    try {
      logger.debug('Fetching team ID');
      const response = await this.api.get('/team');
      const teams = response.data.teams;
      if (teams && teams.length > 0) {
        return teams[0].id;
      }
      throw new Error('No teams found');
    } catch (error: any) {
      logger.error(`Error fetching team ID: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets all spaces for a team
   */
  async getSpaces(teamId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching spaces for team: ${teamId}`);
      const response = await this.api.get(`/team/${teamId}/space`, {
        params: { archived: false },
      });
      return response.data.spaces || [];
    } catch (error: any) {
      logger.error(`Error fetching spaces: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets all folders for a space with pagination support
   */
  async getFolders(spaceId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching folders for space: ${spaceId}`);
      const params: any = {
        archived: false,
        page: 0,
      };
      
      const allFolders: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await this.api.get(`/space/${spaceId}/folder`, { params });
        const folders = response.data.folders || [];
        allFolders.push(...folders);

        // Check if there are more pages (ClickUp typically returns 100 items per page)
        hasMore = folders.length > 0 && folders.length === 100;
        params.page += 1;
      }

      return allFolders;
    } catch (error: any) {
      logger.error(`Error fetching folders: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets all lists for a space with pagination support
   */
  async getLists(spaceId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching lists for space: ${spaceId}`);
      const params: any = {
        archived: false,
        page: 0,
      };
      
      const allLists: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await this.api.get(`/space/${spaceId}/list`, { params });
        const lists = response.data.lists || [];
        allLists.push(...lists);

        // Check if there are more pages (ClickUp typically returns 100 items per page)
        hasMore = lists.length > 0 && lists.length === 100;
        params.page += 1;
      }

      return allLists;
    } catch (error: any) {
      logger.error(`Error fetching lists: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets all lists from a folder with pagination support
   */
  async getListsFromFolder(folderId: string): Promise<any[]> {
    try {
      logger.debug(`Fetching lists from folder: ${folderId}`);
      const params: any = {
        archived: false,
        page: 0,
      };
      
      const allLists: any[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await this.api.get(`/folder/${folderId}/list`, { params });
        const lists = response.data.lists || [];
        allLists.push(...lists);

        // Check if there are more pages (ClickUp typically returns 100 items per page)
        hasMore = lists.length > 0 && lists.length === 100;
        params.page += 1;
      }

      return allLists;
    } catch (error: any) {
      logger.error(`Error fetching lists from folder ${folderId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Gets all tasks from a list, optionally filtered by status
   */
  async getTasksFromList(listId: string, includeClosed: boolean = false): Promise<ClickUpTask[]> {
    try {
      logger.debug(`Fetching tasks from list: ${listId}`);
      const params: any = {
        include_closed: includeClosed,
        page: 0,
      };
      
      const allTasks: ClickUpTask[] = [];
      let hasMore = true;

      while (hasMore) {
        const response = await this.api.get(`/list/${listId}/task`, { params });
        const tasks = response.data.tasks || [];
        allTasks.push(...tasks);

        // Check if there are more pages (100 is the max page size)
        hasMore = tasks.length === 100;
        params.page += 1;
      }

      return allTasks;
    } catch (error: any) {
      logger.error(`Error fetching tasks from list ${listId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Filters tasks based on status configuration
   * Uses status.type === 'open' as primary filter, then applies config-based filters
   */
  private filterTasksByStatus(tasks: ClickUpTask[]): ClickUpTask[] {
    const completionStatuses = config.clickup.completionStatuses || ['complete', 'completed', 'done', 'closed', 'cancelled'];
    const filters = config.clickup.filters || {};
    const excludeStatuses = filters.excludeStatuses || [];
    const includeOnlyStatuses = filters.includeOnlyStatuses;

    return tasks.filter(task => {
      const status = task.status?.status?.toLowerCase() || '';
      const statusType = task.status?.type?.toLowerCase();

      // Primary filter: Use ClickUp API's status type if available
      if (statusType === 'closed') {
        return false;
      }

      // Secondary filter: Check against completion statuses from config
      if (completionStatuses.some(completeStatus => status.includes(completeStatus.toLowerCase()))) {
        return false;
      }

      // Apply excludeStatuses filter
      if (excludeStatuses.length > 0 && excludeStatuses.some(excludeStatus => 
        status.includes(excludeStatus.toLowerCase())
      )) {
        return false;
      }

      // Apply includeOnlyStatuses filter (if specified)
      if (includeOnlyStatuses && includeOnlyStatuses.length > 0) {
        return includeOnlyStatuses.some(includeStatus => 
          status.includes(includeStatus.toLowerCase())
        );
      }

      return true;
    });
  }

  /**
   * Gets tasks by filter options
   * Provides flexible filtering for fetching tasks from specific spaces, folders, lists, and statuses
   */
  async getTasksByFilter(options: TaskFilterOptions = {}): Promise<ClickUpTask[]> {
    try {
      logger.info('Fetching tasks with filter options', options);
      const teamId = await this.getTeamId();
      const spaces = await this.getSpaces(teamId);
      
      const allTasks: ClickUpTask[] = [];

      // Filter spaces based on options
      const filteredSpaces = spaces.filter(space => {
        if (options.spaceIds && options.spaceIds.length > 0) {
          return options.spaceIds.includes(space.id);
        }
        if (options.excludeSpaceIds && options.excludeSpaceIds.length > 0) {
          return !options.excludeSpaceIds.includes(space.id);
        }
        return true;
      });

      for (const space of filteredSpaces) {
        try {
          // Get folders in the space
          const folders = await this.getFolders(space.id);
          
          // Filter folders based on options
          const filteredFolders = folders.filter(folder => {
            if (options.folderIds && options.folderIds.length > 0) {
              return options.folderIds.includes(folder.id);
            }
            if (options.excludeFolderIds && options.excludeFolderIds.length > 0) {
              return !options.excludeFolderIds.includes(folder.id);
            }
            return true;
          });
          
          // Traverse folders → lists → tasks
          for (const folder of filteredFolders) {
            try {
              const lists = await this.getListsFromFolder(folder.id);
              
              // Filter lists based on options
              const filteredLists = lists.filter(list => {
                if (options.listIds && options.listIds.length > 0) {
                  return options.listIds.includes(list.id);
                }
                if (options.excludeListIds && options.excludeListIds.length > 0) {
                  return !options.excludeListIds.includes(list.id);
                }
                return true;
              });
              
              for (const list of filteredLists) {
                try {
                  const tasks = await this.getTasksFromList(list.id, false);
                  
                  // Apply status filters if provided
                  let filteredTasks = tasks;
                  if (options.statusFilters) {
                    filteredTasks = this.filterTasksByStatusWithOptions(tasks, options.statusFilters);
                  } else {
                    filteredTasks = this.filterTasksByStatus(tasks);
                  }
                  
                  allTasks.push(...filteredTasks);
                } catch (error: any) {
                  logger.warn(`Error fetching tasks from list ${list.id}: ${error.message}`);
                }
              }
            } catch (error: any) {
              logger.warn(`Error fetching lists from folder ${folder.id}: ${error.message}`);
            }
          }

          // Also handle lists directly in space (not in folders)
          const spaceLists = await this.getLists(space.id);
          
          // Filter lists based on options
          const filteredSpaceLists = spaceLists.filter(list => {
            if (options.listIds && options.listIds.length > 0) {
              return options.listIds.includes(list.id);
            }
            if (options.excludeListIds && options.excludeListIds.length > 0) {
              return !options.excludeListIds.includes(list.id);
            }
            return true;
          });
          
          for (const list of filteredSpaceLists) {
            try {
              const tasks = await this.getTasksFromList(list.id, false);
              
              // Apply status filters if provided
              let filteredTasks = tasks;
              if (options.statusFilters) {
                filteredTasks = this.filterTasksByStatusWithOptions(tasks, options.statusFilters);
              } else {
                filteredTasks = this.filterTasksByStatus(tasks);
              }
              
              allTasks.push(...filteredTasks);
            } catch (error: any) {
              logger.warn(`Error fetching tasks from list ${list.id}: ${error.message}`);
            }
          }
        } catch (error: any) {
          logger.warn(`Error processing space ${space.id}: ${error.message}`);
        }
      }

      logger.info(`Found ${allTasks.length} tasks with filter options`);
      return allTasks;
    } catch (error: any) {
      logger.error(`Error fetching tasks with filter options: ${error.message}`);
      throw error;
    }
  }

  /**
   * Filters tasks by status with custom filter options
   */
  private filterTasksByStatusWithOptions(tasks: ClickUpTask[], statusFilters: { excludeStatuses?: string[]; includeOnlyStatuses?: string[] }): ClickUpTask[] {
    const excludeStatuses = statusFilters.excludeStatuses || [];
    const includeOnlyStatuses = statusFilters.includeOnlyStatuses;

    return tasks.filter(task => {
      const status = task.status?.status?.toLowerCase() || '';
      const statusType = task.status?.type?.toLowerCase();

      // Primary filter: Use ClickUp API's status type if available
      if (statusType === 'closed') {
        return false;
      }

      // Apply excludeStatuses filter
      if (excludeStatuses.length > 0 && excludeStatuses.some(excludeStatus => 
        status.includes(excludeStatus.toLowerCase())
      )) {
        return false;
      }

      // Apply includeOnlyStatuses filter (if specified)
      if (includeOnlyStatuses && includeOnlyStatuses.length > 0) {
        return includeOnlyStatuses.some(includeStatus => 
          status.includes(includeStatus.toLowerCase())
        );
      }

      return true;
    });
  }

  /**
   * Gets all incomplete tasks across all spaces and lists
   * Filters out tasks with status that indicates completion (e.g., "complete", "done", "closed")
   * Traverses: Spaces → Folders → Lists → Tasks, and also handles lists directly in spaces
   * @param filterOptions Optional filter options to apply
   */
  async getAllIncompleteTasks(filterOptions?: TaskFilterOptions): Promise<ClickUpTask[]> {
    if (filterOptions) {
      return this.getTasksByFilter(filterOptions);
    }
    try {
      logger.info('Fetching all incomplete tasks from ClickUp');
      const teamId = await this.getTeamId();
      const spaces = await this.getSpaces(teamId);
      
      const allTasks: ClickUpTask[] = [];

      for (const space of spaces) {
        try {
          // Get folders in the space
          const folders = await this.getFolders(space.id);
          
          // Traverse folders → lists → tasks
          for (const folder of folders) {
            try {
              const lists = await this.getListsFromFolder(folder.id);
              for (const list of lists) {
                try {
                  const tasks = await this.getTasksFromList(list.id, false);
                  // Filter out completed tasks using config-based filtering
                  const incompleteTasks = this.filterTasksByStatus(tasks);
                  allTasks.push(...incompleteTasks);
                } catch (error: any) {
                  logger.warn(`Error fetching tasks from list ${list.id}: ${error.message}`);
                }
              }
            } catch (error: any) {
              logger.warn(`Error fetching lists from folder ${folder.id}: ${error.message}`);
            }
          }

          // Also handle lists directly in space (not in folders)
          const spaceLists = await this.getLists(space.id);
          for (const list of spaceLists) {
            try {
              const tasks = await this.getTasksFromList(list.id, false);
              // Filter out completed tasks using config-based filtering
              const incompleteTasks = this.filterTasksByStatus(tasks);
              allTasks.push(...incompleteTasks);
            } catch (error: any) {
              logger.warn(`Error fetching tasks from list ${list.id}: ${error.message}`);
            }
          }
        } catch (error: any) {
          logger.warn(`Error processing space ${space.id}: ${error.message}`);
        }
      }

      logger.info(`Found ${allTasks.length} incomplete tasks`);
      return allTasks;
    } catch (error: any) {
      logger.error(`Error fetching all incomplete tasks: ${error.message}`);
      throw error;
    }
  }

  /**
   * Validates webhook signature
   * ClickUp uses HMAC SHA-256 to sign webhooks
   */
  validateWebhookSignature(payload: string, signature: string): boolean {
    if (!config.clickup.webhookSecret) {
      logger.warn('Webhook secret not configured, skipping signature validation');
      return true;
    }
    
    try {
      const hash = crypto
        .createHmac('sha256', config.clickup.webhookSecret)
        .update(payload)
        .digest('hex');
        
      return hash === signature;
    } catch (error: any) {
      logger.error(`Error validating webhook signature: ${error.message}`);
      return false;
    }
  }
}

export const clickUpApiClient = new ClickUpApiClient();
