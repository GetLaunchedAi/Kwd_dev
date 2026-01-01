import express, { Request, Response } from 'express';
import * as path from 'path';
import { config } from './config/config';
import { logger } from './utils/logger';
import { processWebhookEvent } from './clickup/webhookHandler';
import { processTask } from './workflow/workflowOrchestrator';
import { continueWorkflowAfterAgent } from './workflow/workflowOrchestrator';
import { completeWorkflowAfterApproval } from './workflow/workflowOrchestrator';
import { approveRequest, rejectRequest, getApprovalRequest } from './approval/approvalManager';
import { findAllTasks, findTaskById } from './utils/taskScanner';
import { generateChangeSummary } from './approval/changeSummarizer';
import { loadTaskState } from './state/stateManager';
import { getAuthorizationUrl, exchangeCodeForToken, generateState, getAccessToken } from './clickup/oauthService';
import { importTask, previewTaskImport } from './handlers/taskImportHandler';

const app = express();

// In-memory cache for failed imports (persists during server runtime)
interface FailedImport {
  taskId: string;
  taskName: string;
  clickUpUrl?: string;
  error: string;
  timestamp: string;
  suggestions?: string[];
}

const failedImportsCache: Map<string, FailedImport> = new Map();

// Helper function to track failed import
function trackFailedImport(taskId: string, taskName: string, error: string, clickUpUrl?: string, suggestions?: string[]) {
  failedImportsCache.set(taskId, {
    taskId,
    taskName,
    clickUpUrl,
    error,
    timestamp: new Date().toISOString(),
    suggestions,
  });
}

// Middleware
app.use(express.json());

// #region agent log
app.use((req, res, next) => {
  if (req.path.startsWith('/api/tasks/import')) {
    fetch('http://127.0.0.1:7243/ingest/d494afa8-946f-47d4-9935-30e65c9d5f53',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'src/server.ts:middleware',message:'Incoming import request',data:{method:req.method,path:req.path,body:req.body},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A'})}).catch(()=>{});
  }
  next();
});
// #endregion

// Serve static files from public directory
const publicDir = path.join(process.cwd(), 'public');
app.use(express.static(publicDir));

// Health check endpoint
app.get('/api/health', async (req: Request, res: Response) => {
  try {
    const { getAccessToken } = await import('./clickup/oauthService');
    const { clickUpApiClient } = await import('./clickup/apiClient');
    
    const accessToken = await getAccessToken();
    let clickUpStatus = 'disconnected';
    let user = null;

    if (accessToken) {
      try {
        // Verify token by getting the authorized user
        user = await clickUpApiClient.getAuthenticatedUser();
        clickUpStatus = 'connected';
      } catch (error) {
        logger.warn('Stored ClickUp token is invalid or expired');
        clickUpStatus = 'expired';
      }
    }

    res.json({ 
      status: 'ok', 
      timestamp: new Date().toISOString(),
      clickup: {
        status: clickUpStatus,
        user: user ? {
          id: user.id,
          username: user.username,
          email: user.email
        } : null
      }
    });
  } catch (error: any) {
    logger.error(`Health check error: ${error.message}`);
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// Basic health check endpoint (kept for simplicity)
app.get('/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// OAuth endpoints
app.get('/auth/clickup', async (req: Request, res: Response) => {
  try {
    const state = generateState();
    const authUrl = getAuthorizationUrl(state);
    
    // Store state in session (in production, use proper session storage)
    // For now, we'll just redirect - ClickUp will handle the state
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error(`Error initiating OAuth flow: ${error.message}`);
    res.status(500).send(`
      <html>
        <head><title>OAuth Error</title></head>
        <body>
          <h1>Error</h1>
          <p>${error.message}</p>
          <p>Make sure CLICKUP_CLIENT_ID and CLICKUP_REDIRECT_URI are set in your .env file.</p>
        </body>
      </html>
    `);
  }
});

app.get('/auth/clickup/callback', async (req: Request, res: Response) => {
  try {
    const { code, error } = req.query;

    if (error) {
      logger.error(`OAuth error: ${error}`);
      return res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h1>Authorization Failed</h1>
            <p>Error: ${error}</p>
            <p><a href="/auth/clickup">Try again</a></p>
          </body>
        </html>
      `);
    }

    if (!code || typeof code !== 'string') {
      return res.status(400).send(`
        <html>
          <head><title>Authorization Failed</title></head>
          <body>
            <h1>Authorization Failed</h1>
            <p>No authorization code received.</p>
            <p><a href="/auth/clickup">Try again</a></p>
          </body>
        </html>
      `);
    }

    logger.info('Received authorization code, exchanging for token...');
    const tokenResponse = await exchangeCodeForToken(code);

    res.send(`
      <html>
        <head>
          <title>Authorization Successful</title>
          <style>
            body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
            .success { background: #d4edda; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
            .button { display: inline-block; padding: 10px 20px; background: #007bff; color: white; text-decoration: none; border-radius: 5px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="success">
            <h1>✅ Authorization Successful!</h1>
            <p>Your ClickUp app has been authorized successfully.</p>
            <p>The access token has been saved and will be used for API calls.</p>
            <p>You can now close this window.</p>
            <a href="/" class="button">Go to Dashboard</a>
          </div>
        </body>
      </html>
    `);

    logger.info('OAuth flow completed successfully');
  } catch (error: any) {
    logger.error(`Error in OAuth callback: ${error.message}`);
    res.status(500).send(`
      <html>
        <head><title>Authorization Error</title></head>
        <body>
          <h1>Authorization Error</h1>
          <p>${error.message}</p>
          <p><a href="/auth/clickup">Try again</a></p>
        </body>
      </html>
    `);
  }
});

// ClickUp webhook endpoint
app.post('/webhook/clickup', async (req: Request, res: Response) => {
  try {
    logger.info('Received ClickUp webhook');
    
    const processedEvent = await processWebhookEvent(req);
    
    if (!processedEvent) {
      logger.debug('Webhook event not processed (not matching trigger criteria)');
      return res.status(200).json({ message: 'Event received but not processed' });
    }

    // Process task asynchronously
    processTask(processedEvent.task).catch((error: any) => {
      logger.error(`Error processing task ${processedEvent.taskId}: ${error.message}`);
    });

    // Respond immediately to ClickUp
    res.status(200).json({ message: 'Webhook received and processing started' });
  } catch (error: any) {
    logger.error(`Error handling webhook: ${error.message}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Approval endpoint
app.get('/approve/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const reason = req.query.reason as string | undefined;

    const request = getApprovalRequest(token);
    if (!request) {
      return res.status(404).send('Approval request not found or expired');
    }

    const approved = await approveRequest(token, reason);
    if (!approved) {
      return res.status(400).send('Failed to approve request');
    }

    // Complete workflow (push to GitHub)
    await completeWorkflowAfterApproval(request.clientFolder, request.taskId);

    res.send(`
      <html>
        <head><title>Approval Successful</title></head>
        <body>
          <h1>✅ Changes Approved</h1>
          <p>Task ${request.taskId} has been approved and pushed to GitHub.</p>
          <p>Branch: ${request.branchName}</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error(`Error processing approval: ${error.message}`);
    res.status(500).send('Error processing approval');
  }
});

// Rejection endpoint
app.get('/reject/:token', async (req: Request, res: Response) => {
  try {
    const { token } = req.params;
    const reason = req.query.reason as string | undefined;

    const request = getApprovalRequest(token);
    if (!request) {
      return res.status(404).send('Approval request not found or expired');
    }

    const rejected = await rejectRequest(token, reason);
    if (!rejected) {
      return res.status(400).send('Failed to reject request');
    }

    res.send(`
      <html>
        <head><title>Rejection Successful</title></head>
        <body>
          <h1>❌ Changes Rejected</h1>
          <p>Task ${request.taskId} has been rejected.</p>
          ${reason ? `<p>Reason: ${reason}</p>` : ''}
          <p>You can update the task in ClickUp and retry.</p>
        </body>
      </html>
    `);
  } catch (error: any) {
    logger.error(`Error processing rejection: ${error.message}`);
    res.status(500).send('Error processing rejection');
  }
});

// Manual workflow continuation endpoint (for testing/debugging)
app.post('/workflow/continue/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientFolder } = req.body;

    if (!clientFolder) {
      return res.status(400).json({ error: 'clientFolder is required' });
    }

    await continueWorkflowAfterAgent(clientFolder, taskId);
    res.json({ message: `Workflow continued for task ${taskId}` });
  } catch (error: any) {
    logger.error(`Error continuing workflow: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Manual task import endpoint - imports a ClickUp task by ID
app.post('/api/tasks/import', async (req: Request, res: Response) => {
  try {
    const { taskId, triggerWorkflow, clientName } = req.body;
    
    if (!taskId) {
      return res.status(400).json({ error: 'taskId is required' });
    }

    const result = await importTask({
      taskId,
      providedClientName: clientName,
      triggerWorkflow
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 400).json({
        error: result.error,
        suggestions: result.suggestions
      });
    }

    res.json(result);
  } catch (error: any) {
    logger.error(`Error importing task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Task import preview endpoint
app.get('/api/tasks/import/preview/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientName } = req.query;

    const preview = await previewTaskImport(taskId, clientName as string | undefined);
    res.json(preview);
  } catch (error: any) {
    logger.error(`Error previewing task import: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Legacy Manual task import endpoint (keeping for backward compatibility if needed)
app.post('/api/tasks/import/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { triggerWorkflow, clientName: providedClientName } = req.body;
    
    const result = await importTask({
      taskId,
      providedClientName,
      triggerWorkflow
    });

    if (!result.success) {
      return res.status(result.error?.includes('not found') ? 404 : 400).json({
        error: result.error,
        suggestions: result.suggestions
      });
    }

    res.json(result);
  } catch (error: any) {
    logger.error(`Error importing task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Web Dashboard API Endpoints

// Get all tasks
app.get('/api/tasks', async (req: Request, res: Response) => {
  try {
    const tasks = await findAllTasks();
    res.json(tasks);
  } catch (error: any) {
    logger.error(`Error fetching tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete all tasks
app.delete('/api/tasks', async (req: Request, res: Response) => {
  try {
    const { deleteAllTasks } = await import('./utils/taskScanner');
    const result = await deleteAllTasks();
    res.json({ success: true, ...result });
  } catch (error: any) {
    logger.error(`Error deleting all tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Delete a single task
app.delete('/api/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { deleteTaskById } = await import('./utils/taskScanner');
    const deleted = await deleteTaskById(taskId);
    
    if (deleted) {
      res.json({ success: true, message: `Task ${taskId} deleted successfully` });
    } else {
      res.status(404).json({ error: 'Task not found' });
    }
  } catch (error: any) {
    logger.error(`Error deleting task: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Trigger Cursor Agent for a task
app.post('/api/tasks/:taskId/trigger-agent', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    logger.info(`Manual trigger request for Cursor agent: task ${taskId}`);

    const { findTaskById } = await import('./utils/taskScanner');
    const { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    if (!taskState || !taskInfo || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const { triggerAgent } = await import('./cursor/agentTrigger');
    const { triggerCursorAgent, openCursorWorkspace } = await import('./cursor/workspaceManager');
    
    // Step 1: Open Cursor workspace if not already open
    await openCursorWorkspace(clientFolder);
    
    // Step 2: Trigger the agent
    const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
    await triggerAgent(clientFolder, promptPath, taskInfo.task);
    await triggerCursorAgent(clientFolder, taskInfo.task);

    res.json({ success: true, message: 'Cursor agent triggered successfully' });
  } catch (error: any) {
    logger.error(`Error triggering agent for task ${req.params.taskId}: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get all incomplete tasks from ClickUp
app.get('/api/tasks/incomplete', async (req: Request, res: Response) => {
  try {
    const { clickUpApiClient } = await import('./clickup/apiClient');
    const tasks = await clickUpApiClient.getAllIncompleteTasks();
    res.json(tasks);
  } catch (error: any) {
    logger.error(`Error fetching incomplete tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Bulk import incomplete tasks
app.post('/api/tasks/import-incomplete', async (req: Request, res: Response) => {
  try {
    const { filterOptions } = req.body; // Optional: filter options for task fetching
    const { clickUpApiClient } = await import('./clickup/apiClient');
    const { extractClientName } = await import('./utils/taskParser');
    const { findClientFolder } = await import('./git/repoManager');
    const { updateWorkflowState, saveTaskInfo, WorkflowState } = await import('./state/stateManager');
    const { findTaskById } = await import('./utils/taskScanner');
    const { getClientMapping } = await import('./utils/clientMappingManager');

    logger.info('Bulk importing incomplete tasks from ClickUp' + (filterOptions ? ' with filters' : ''));
    const tasks = await clickUpApiClient.getAllIncompleteTasks(filterOptions);
    
    const results = {
      total: tasks.length,
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ taskId: string; taskName: string; clickUpUrl?: string; error: string }>,
    };

    for (const task of tasks) {
      try {
        // Check if task already exists
        const existing = await findTaskById(task.id);
        if (existing.taskState && existing.clientFolder) {
          results.skipped++;
          continue;
        }

        // Extract client name and find folder
        const extractionResult = await extractClientName(task.name, task.id);
        let clientName: string | null = extractionResult.clientName;
        
        // If extraction failed, try manual mapping as fallback
        if (!clientName) {
          const manualMapping = await getClientMapping(task.id);
          if (manualMapping) {
            clientName = manualMapping;
            logger.debug(`Using manual mapping for task ${task.id}: ${clientName}`);
          }
        }

        if (!clientName) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Could not extract client name${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolderInfo = await findClientFolder(clientName);
        if (!clientFolderInfo || !clientFolderInfo.isValid) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Client folder not found: ${clientName}${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolder = clientFolderInfo.path;

        // Initialize task state and info
        await updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING);
        await saveTaskInfo(clientFolder, task.id, {
          task,
          taskId: task.id,
          clientName,
          clientFolder,
        });

        results.imported++;
      } catch (error: any) {
        logger.error(`Error importing task ${task.id}: ${error.message}`);
        const errorMsg = error.message;
        results.errors.push({
          taskId: task.id,
          taskName: task.name || 'Unknown',
          clickUpUrl: task.url,
          error: errorMsg,
        });
        trackFailedImport(task.id, task.name || 'Unknown', errorMsg, task.url);
      }
    }

    logger.info(`Bulk import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`);
    res.json(results);
  } catch (error: any) {
    logger.error(`Error bulk importing tasks: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Retry importing failed tasks
app.post('/api/tasks/retry-import', async (req: Request, res: Response) => {
  try {
    const { taskIds } = req.body; // Array of task IDs to retry

    if (!taskIds || !Array.isArray(taskIds) || taskIds.length === 0) {
      return res.status(400).json({ error: 'taskIds array is required' });
    }

    const { clickUpApiClient } = await import('./clickup/apiClient');
    const { extractClientName } = await import('./utils/taskParser');
    const { findClientFolder } = await import('./git/repoManager');
    const { updateWorkflowState, saveTaskInfo, WorkflowState } = await import('./state/stateManager');
    const { findTaskById } = await import('./utils/taskScanner');
    const { getClientMapping } = await import('./utils/clientMappingManager');

    logger.info(`Retrying import for ${taskIds.length} tasks`);
    
    const results = {
      total: taskIds.length,
      imported: 0,
      skipped: 0,
      errors: [] as Array<{ taskId: string; taskName: string; clickUpUrl?: string; error: string }>,
    };

    for (const taskId of taskIds) {
      try {
        // Fetch task from ClickUp
        const task = await clickUpApiClient.getTask(taskId);

        // Check if task already exists
        const existing = await findTaskById(task.id);
        if (existing.taskState && existing.clientFolder) {
          results.skipped++;
          continue;
        }

        // Extract client name and find folder
        const extractionResult = await extractClientName(task.name, task.id);
        let clientName: string | null = extractionResult.clientName;
        
        // If extraction failed, try manual mapping as fallback
        if (!clientName) {
          const manualMapping = await getClientMapping(task.id);
          if (manualMapping) {
            clientName = manualMapping;
            logger.debug(`Using manual mapping for task ${task.id}: ${clientName}`);
          }
        }

        if (!clientName) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Could not extract client name${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolderInfo = await findClientFolder(clientName);
        if (!clientFolderInfo || !clientFolderInfo.isValid) {
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Suggested matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          const errorMsg = `Client folder not found: ${clientName}${suggestionsMsg}`;
          results.errors.push({
            taskId: task.id,
            taskName: task.name,
            clickUpUrl: task.url,
            error: errorMsg,
          });
          trackFailedImport(task.id, task.name, errorMsg, task.url, extractionResult.suggestions);
          continue;
        }

        const clientFolder = clientFolderInfo.path;

        // Initialize task state and info
        await updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING);
        await saveTaskInfo(clientFolder, task.id, {
          task,
          taskId: task.id,
          clientName,
          clientFolder,
        });

        results.imported++;
      } catch (error: any) {
        logger.error(`Error importing task ${taskId}: ${error.message}`);
        const errorMsg = error.message;
        results.errors.push({
          taskId: taskId,
          taskName: 'Unknown',
          error: errorMsg,
        });
        trackFailedImport(taskId, 'Unknown', errorMsg);
      }
    }

    logger.info(`Retry import completed: ${results.imported} imported, ${results.skipped} skipped, ${results.errors.length} errors`);
    res.json(results);
  } catch (error: any) {
    logger.error(`Error retrying imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get failed imports history
app.get('/api/tasks/failed-imports', async (req: Request, res: Response) => {
  try {
    const failedImports = Array.from(failedImportsCache.values());
    
    // Sort by timestamp descending (most recent first)
    failedImports.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    
    res.json({
      total: failedImports.length,
      failures: failedImports,
    });
  } catch (error: any) {
    logger.error(`Error retrieving failed imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Clear failed imports cache
app.delete('/api/tasks/failed-imports', async (req: Request, res: Response) => {
  try {
    const count = failedImportsCache.size;
    failedImportsCache.clear();
    logger.info(`Cleared ${count} failed import entries`);
    res.json({ 
      message: `Cleared ${count} failed import entries`,
      cleared: count,
    });
  } catch (error: any) {
    logger.error(`Error clearing failed imports: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get task details
app.get('/api/tasks/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { refresh } = req.query;
    let { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    if (!taskState || !taskInfo) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (refresh === 'true' && clientFolder) {
      try {
        const { clickUpApiClient } = await import('./clickup/apiClient');
        const updatedTask = await clickUpApiClient.getTask(taskId);
        
        // Update taskInfo with new data from ClickUp
        taskInfo.task = updatedTask;
        const { saveTaskInfo } = await import('./state/stateManager');
        await saveTaskInfo(clientFolder, taskId, taskInfo);
        
        logger.info(`Refreshed task details from ClickUp for task ${taskId}`);
      } catch (refreshError: any) {
        logger.error(`Error refreshing task ${taskId} from ClickUp: ${refreshError.message}`);
        // Continue with existing data if refresh fails
      }
    }

    res.json({
      taskState,
      taskInfo,
      clientFolder,
    });
  } catch (error: any) {
    logger.error(`Error fetching task details: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Update task description
app.patch('/api/tasks/:taskId/description', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { description } = req.body;

    if (description === undefined) {
      return res.status(400).json({ error: 'Description is required' });
    }

    const { taskState, taskInfo, clientFolder } = await findTaskById(taskId);

    if (!taskState || !taskInfo || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    // Update local task info
    taskInfo.task.description = description;
    const { saveTaskInfo } = await import('./state/stateManager');
    await saveTaskInfo(clientFolder, taskId, taskInfo);

    logger.info(`Updated description for task ${taskId}`);
    res.json({ success: true, description });
  } catch (error: any) {
    logger.error(`Error updating task description: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get task diff
app.get('/api/tasks/:taskId/diff', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { taskState, clientFolder } = await findTaskById(taskId);

    if (!taskState || !clientFolder) {
      return res.status(404).json({ error: 'Task not found' });
    }

    if (!taskState.branchName) {
      return res.status(400).json({ error: 'No branch found for this task' });
    }

    const changeSummary = await generateChangeSummary(clientFolder, taskState.branchName);
    res.json(changeSummary);
  } catch (error: any) {
    logger.error(`Error fetching task diff: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Client mapping management endpoints

// Map a task to a client name
app.post('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { clientName } = req.body;

    if (!clientName || typeof clientName !== 'string') {
      return res.status(400).json({ error: 'clientName is required' });
    }

    const { mapTaskToClient } = await import('./utils/clientMappingManager');
    await mapTaskToClient(taskId, clientName);

    res.json({ 
      success: true,
      message: `Task ${taskId} mapped to client: ${clientName}`
    });
  } catch (error: any) {
    logger.error(`Error mapping task to client: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get client mapping for a task
app.get('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { getClientMapping } = await import('./utils/clientMappingManager');
    const clientName = await getClientMapping(taskId);

    if (!clientName) {
      return res.status(404).json({ error: 'No mapping found for this task' });
    }

    res.json({ taskId, clientName });
  } catch (error: any) {
    logger.error(`Error getting task mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Remove a task mapping
app.delete('/api/mappings/task/:taskId', async (req: Request, res: Response) => {
  try {
    const { taskId } = req.params;
    const { removeTaskMapping } = await import('./utils/clientMappingManager');
    await removeTaskMapping(taskId);

    res.json({ 
      success: true,
      message: `Mapping removed for task: ${taskId}`
    });
  } catch (error: any) {
    logger.error(`Error removing task mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Add a pattern mapping
app.post('/api/mappings/pattern', async (req: Request, res: Response) => {
  try {
    const { pattern, clientName } = req.body;

    if (!pattern || typeof pattern !== 'string') {
      return res.status(400).json({ error: 'pattern is required' });
    }
    if (!clientName || typeof clientName !== 'string') {
      return res.status(400).json({ error: 'clientName is required' });
    }

    // Validate regex pattern
    try {
      new RegExp(pattern);
    } catch (regexError: any) {
      return res.status(400).json({ error: `Invalid regex pattern: ${regexError.message}` });
    }

    const { addPatternMapping } = await import('./utils/clientMappingManager');
    await addPatternMapping(pattern, clientName);

    res.json({ 
      success: true,
      message: `Pattern mapping added: ${pattern} -> ${clientName}`
    });
  } catch (error: any) {
    logger.error(`Error adding pattern mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Remove a pattern mapping
app.delete('/api/mappings/pattern', async (req: Request, res: Response) => {
  try {
    const { pattern } = req.body;

    if (!pattern) {
      return res.status(400).json({ error: 'pattern is required in request body' });
    }

    const { removePatternMapping } = await import('./utils/clientMappingManager');
    await removePatternMapping(pattern);

    res.json({ 
      success: true,
      message: `Pattern mapping removed: ${pattern}`
    });
  } catch (error: any) {
    logger.error(`Error removing pattern mapping: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Get all mappings
app.get('/api/mappings', async (req: Request, res: Response) => {
  try {
    const { loadMappings } = await import('./utils/clientMappingManager');
    const mappings = await loadMappings();

    res.json(mappings);
  } catch (error: any) {
    logger.error(`Error loading mappings: ${error.message}`);
    res.status(500).json({ error: error.message });
  }
});

// Start server
const PORT = config.server.port || 3000;
app.listen(PORT, () => {
  logger.info(`Server started on port ${PORT}`);
  logger.info(`ClickUp webhook endpoint: http://localhost:${PORT}/webhook/clickup`);
  logger.info(`Health check: http://localhost:${PORT}/health`);
});
