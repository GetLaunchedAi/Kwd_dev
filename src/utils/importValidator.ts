import { logger } from './logger';
import { findTaskById } from './taskScanner';
import { extractClientName } from './taskParser';
import { findClientFolder } from '../git/repoManager';
import { getClientMapping } from './clientMappingManager';

import { ClickUpTask } from '../clickup/apiClient';

export interface ValidationResult {
  valid: boolean;
  error?: string;
  suggestions?: string[];
  clientName?: string;
  clientFolder?: string;
  warnings?: string[];
  determinationMethod?: 'manual' | 'pattern' | 'extracted' | 'folder';
}

export interface TaskImportInput {
  taskId: string;
  taskName: string;
  providedClientName?: string;
  fullTask?: ClickUpTask;
}

/**
 * Validates whether a task can be imported
 * @param input - Task import input containing taskId, taskName, and optional client name override
 * @returns ValidationResult with validation status and details
 */
export async function validateTaskImport(input: TaskImportInput): Promise<ValidationResult> {
  const { taskId, taskName, providedClientName, fullTask } = input;
  const warnings: string[] = [];
  
  try {
    // Step 1: Check if task already exists
    logger.debug(`Validating import for task ${taskId}`);
    const existing = await findTaskById(taskId);
    if (existing.taskState && existing.clientFolder) {
      return {
        valid: false,
        error: `Task ${taskId} is already imported and exists in the system`,
        suggestions: ['This task is already in your dashboard', 'Check the tasks list to see the existing task'],
      };
    }

    // Step 2: Determine client name (from provided override or extraction)
    let clientName: string;
    let determinationMethod: 'manual' | 'pattern' | 'extracted' | 'folder' | undefined;

    if (providedClientName && typeof providedClientName === 'string' && providedClientName.trim()) {
      // Use provided client name (manual override)
      clientName = providedClientName.trim();
      determinationMethod = 'manual';
      logger.debug(`Using provided client name: ${clientName}`);
    } else {
      // Extract client name from task name, providing the full task for folder fallback
      const extractionResult = await extractClientName(taskName, taskId, fullTask);
      
      // If extraction failed, try manual mapping as fallback
      if (!extractionResult.clientName) {
        const manualMapping = await getClientMapping(taskId);
        if (manualMapping) {
          clientName = manualMapping;
          determinationMethod = 'manual';
          logger.debug(`Using existing manual mapping for task ${taskId}: ${clientName}`);
          warnings.push(`Using previously saved client mapping: ${clientName}`);
        } else {
          // Extraction failed and no manual mapping found
          const suggestionsMsg = extractionResult.suggestions && extractionResult.suggestions.length > 0
            ? ` Possible matches: ${extractionResult.suggestions.join(', ')}`
            : '';
          return {
            valid: false,
            error: `Could not determine client name from task: "${taskName}"${suggestionsMsg}`,
            suggestions: extractionResult.suggestions && extractionResult.suggestions.length > 0
              ? [
                  ...extractionResult.suggestions.map(s => `Try providing client name: "${s}"`),
                  'You can manually specify a client name to override extraction',
                ]
              : [
                  'Check if the task name contains a recognizable client name',
                  'You can manually specify a client name to override extraction',
                ],
          };
        }
      } else {
        clientName = extractionResult.clientName;
        // Determine method from extraction result if possible, or default to extracted
        determinationMethod = (extractionResult as any).method || 'extracted';
        logger.debug(`Extracted client name: ${clientName} (method: ${determinationMethod})`);
      }
    }

    // Step 3: Validate client folder exists (optional - will create if needed)
    const clientFolderInfo = await findClientFolder(clientName);
    let clientFolder: string;
    
    if (!clientFolderInfo || !clientFolderInfo.isValid) {
      // Client folder doesn't exist yet - that's okay, we'll create it or use a placeholder
      logger.warn(`Client folder not found for "${clientName}" - will be created during workflow`);
      warnings.push(`Client folder "${clientName}" does not exist yet and will be created during workflow`);
      
      // Use the expected path even if it doesn't exist yet
      const githubCloneAllDir = require('../config/config').config.git.githubCloneAllDir;
      const path = require('path');
      clientFolder = path.join(githubCloneAllDir, 'client-websites', clientName);
    } else {
      clientFolder = clientFolderInfo.path;
    }

    // Step 4: All validations passed
    logger.debug(`Validation successful for task ${taskId} -> ${clientName} (${clientFolder})`);
    return {
      valid: true,
      clientName,
      clientFolder,
      warnings: warnings.length > 0 ? warnings : undefined,
      determinationMethod,
    };
  } catch (error: any) {
    logger.error(`Error during task import validation: ${error.message}`);
    return {
      valid: false,
      error: `Validation error: ${error.message}`,
      suggestions: ['Check server logs for more details', 'Verify task ID is correct'],
    };
  }
}

/**
 * Validates whether a task exists in ClickUp and is accessible
 * This is a lightweight check that can be used before full import validation
 * @param taskId - ClickUp task ID
 * @returns true if task exists and is accessible, false otherwise
 */
export async function validateTaskExists(taskId: string): Promise<boolean> {
  try {
    const { clickUpApiClient } = await import('../clickup/apiClient');
    await clickUpApiClient.getTask(taskId);
    return true;
  } catch (error: any) {
    logger.debug(`Task ${taskId} not found in ClickUp: ${error.message}`);
    return false;
  }
}



