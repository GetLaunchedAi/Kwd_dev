import * as path from 'path';
import * as fs from 'fs-extra';
import * as crypto from 'crypto';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { validateModel } from '../utils/modelValidator';
import {
  saveTaskInfo,
  updateWorkflowState,
  saveTaskState,
  WorkflowState,
  TaskInfo,
} from '../state/stateManager';
import { ClickUpTask } from '../clickup/apiClient';
import { ensureDevBranch } from '../git/branchManager';
import { generatePromptFile } from '../cursor/promptGenerator';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CreateTaskInput {
  title: string;
  description: string;
  clientName: string;
  model?: string;
  notificationEmail?: string;
  systemPrompt?: string;
}

export interface CreateTaskResult {
  success: boolean;
  taskId?: string;
  taskName?: string;
  clientName?: string;
  clientFolder?: string;
  branchName?: string;
  notificationEmail?: string | null;
  notificationConfigured?: boolean;
  message?: string;
  error?: string;
  /** HTTP status code hint – the route can use this to set the response code */
  statusCode?: number;
}

// ---------------------------------------------------------------------------
// Validation helpers (private)
// ---------------------------------------------------------------------------

function validateRequiredString(
  value: unknown,
  fieldName: string,
  maxLength?: number
): string | CreateTaskResult {
  if (!value || typeof value !== 'string' || (value as string).trim().length === 0) {
    return { success: false, error: `${fieldName} is required`, statusCode: 400 };
  }
  const trimmed = (value as string).trim();
  if (maxLength && trimmed.length > maxLength) {
    return {
      success: false,
      error: `${fieldName} must be ${maxLength} characters or less`,
      statusCode: 400,
    };
  }
  return trimmed;
}

function validateNotificationEmail(
  email: unknown
): { valid: true; email?: string } | CreateTaskResult {
  if (!email || typeof email !== 'string') {
    return { valid: true };
  }
  const trimmed = (email as string).trim();
  if (!trimmed) {
    return { valid: true };
  }
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(trimmed)) {
    return {
      success: false,
      error: 'Invalid notification email format',
      statusCode: 400,
    };
  }
  return { valid: true, email: trimmed };
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

/**
 * Creates a local task (no ClickUp dependency).
 *
 * Performs validation, generates a unique task ID, initialises state,
 * creates a dev branch, generates the CURSOR_TASK.md prompt, and
 * optionally injects a custom system prompt.
 *
 * On partial failure after state files are written the task directory
 * is cleaned up so the dashboard never shows a half-initialised task.
 */
export async function createTask(input: CreateTaskInput): Promise<CreateTaskResult> {
  // --- Field validation ---------------------------------------------------

  const titleResult = validateRequiredString(input.title, 'title', 200);
  if (typeof titleResult !== 'string') return titleResult;
  const trimmedTitle = titleResult;

  const descResult = validateRequiredString(input.description, 'description', 5000);
  if (typeof descResult !== 'string') return descResult;
  const trimmedDescription = descResult;

  const clientResult = validateRequiredString(input.clientName, 'clientName');
  if (typeof clientResult !== 'string') return clientResult;

  // Validate client name format (prevent path traversal)
  const clientNamePattern = /^[a-z0-9-]+$/i;
  const normalizedClientName = clientResult.toLowerCase();

  if (!clientNamePattern.test(normalizedClientName)) {
    return {
      success: false,
      error: 'Invalid client name. Use only letters, numbers, and hyphens.',
      statusCode: 400,
    };
  }

  // Validate model
  const modelCheck = validateModel(input.model);
  if (!modelCheck.valid) {
    return {
      success: false,
      error: modelCheck.error,
      statusCode: 400,
    };
  }

  // Validate notification email
  const emailCheck = validateNotificationEmail(input.notificationEmail);
  if ('success' in emailCheck && !emailCheck.success) return emailCheck as CreateTaskResult;
  const validatedNotificationEmail = (emailCheck as { valid: true; email?: string }).email;

  // --- Resolve client folder -----------------------------------------------

  const githubCloneAllDir = path.resolve(config.git.githubCloneAllDir || '');
  let clientFolder = path.join(githubCloneAllDir, normalizedClientName);

  const clientWebsitesPath = path.join(githubCloneAllDir, 'client-websites', normalizedClientName);
  if (await fs.pathExists(clientWebsitesPath)) {
    clientFolder = clientWebsitesPath;
  }

  if (!(await fs.pathExists(clientFolder))) {
    return {
      success: false,
      error: `Client folder not found: ${normalizedClientName}`,
      statusCode: 404,
    };
  }

  // --- Generate unique task ID with collision retry ------------------------

  let taskId: string = '';
  let taskFolder: string = '';
  const maxAttempts = 3;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const randomBytes = crypto.randomBytes(3).toString('hex');
    taskId = `local-${Date.now()}-${randomBytes}`;
    taskFolder = path.join(clientFolder, '.clickup-workflow', taskId);

    if (!(await fs.pathExists(taskFolder))) break;

    logger.warn(`Task ID collision detected: ${taskId}, retrying...`);
    if (attempt === maxAttempts - 1) {
      return {
        success: false,
        error: 'Failed to generate unique task ID. Please try again.',
        statusCode: 409,
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  // --- Initialise task state (with rollback on failure) --------------------

  const timestamp = new Date().toISOString();

  const localTask: ClickUpTask = {
    id: taskId,
    name: trimmedTitle,
    description: trimmedDescription,
    status: { status: 'pending', color: '#d3d3d3', type: 'open' },
    url: '#',
    assignees: [],
  };

  const taskInfo: TaskInfo = {
    task: localTask,
    taskId,
    clientName: normalizedClientName,
    clientFolder,
    model: input.model || config.cursor.defaultModel,
    notificationEmail: validatedNotificationEmail,
  };

  // Track whether we've written state files so we can clean up on error
  let stateWritten = false;

  try {
    // Save task info & initialise workflow state
    await saveTaskInfo(clientFolder, taskId, taskInfo);
    await updateWorkflowState(clientFolder, taskId, WorkflowState.PENDING, {
      isLocalTask: true,
      createdVia: 'dashboard',
      createdAt: timestamp,
    });
    stateWritten = true;

    // Create dev branch
    let branchName: string | undefined;
    try {
      branchName = await ensureDevBranch(clientFolder);
      await saveTaskState(clientFolder, taskId, { branchName });
      logger.info(`Initialized branch ${branchName} for local task ${taskId}`);
    } catch (branchError: any) {
      logger.warn(
        `Could not initialize branch for local task ${taskId}: ${branchError.message}. Branch will be set when agent starts.`
      );
    }

    // Generate CURSOR_TASK.md
    const promptPath = await generatePromptFile(
      clientFolder,
      normalizedClientName,
      localTask,
      branchName,
      undefined // testCommand – detected when agent runs
    );

    // 2.4 FIX: Inject custom system prompt into the template structure instead
    // of blindly overwriting the whole file (which strips Task ID, branch, etc.)
    if (input.systemPrompt && typeof input.systemPrompt === 'string' && input.systemPrompt.trim().length > 0) {
      const existingContent = await fs.readFile(promptPath, 'utf-8');
      const customSection = [
        '',
        '## Custom Instructions',
        '',
        input.systemPrompt.trim(),
        '',
      ].join('\n');

      // Insert the custom section right before "## 2. Operating Rules" (template)
      // or before "## 3. Metadata" (fallback) so it appears prominently
      let updatedContent: string;
      if (existingContent.includes('## 2. Operating Rules')) {
        updatedContent = existingContent.replace(
          '## 2. Operating Rules',
          customSection + '\n## 2. Operating Rules'
        );
      } else if (existingContent.includes('## 3. Constraints')) {
        updatedContent = existingContent.replace(
          '## 3. Constraints',
          customSection + '\n## 3. Constraints'
        );
      } else {
        // Append at the end as a last resort
        updatedContent = existingContent + '\n' + customSection;
      }

      await fs.writeFile(promptPath, updatedContent, 'utf-8');

      // Save a flag so shouldGeneratePrompt() knows this is a custom-prompt task
      await saveTaskState(clientFolder, taskId, { customSystemPrompt: true } as any);
      logger.info(`Custom system prompt injected for task ${taskId} at ${promptPath}`);
    }

    logger.info(
      `Created local task ${taskId} for client ${normalizedClientName}${validatedNotificationEmail ? ` (notifications: ${validatedNotificationEmail})` : ' (no notification email)'}`
    );

    return {
      success: true,
      taskId,
      taskName: trimmedTitle,
      clientName: normalizedClientName,
      clientFolder,
      branchName: branchName || undefined,
      notificationEmail: validatedNotificationEmail || null,
      notificationConfigured: !!(validatedNotificationEmail || process.env.APPROVAL_EMAIL_TO),
      message: 'Local task created successfully',
    };
  } catch (error: any) {
    // 2.3 FIX: Rollback – remove the half-initialised task directory so the
    // dashboard doesn't show a broken task.
    if (stateWritten) {
      try {
        await fs.remove(taskFolder);
        logger.info(`Rolled back partial task directory: ${taskFolder}`);
      } catch (cleanupErr: any) {
        logger.error(`Failed to rollback task directory ${taskFolder}: ${cleanupErr.message}`);
      }
    }

    logger.error(`Error creating local task: ${error.message}`);
    throw error; // re-throw so the route can return 500
  }
}

