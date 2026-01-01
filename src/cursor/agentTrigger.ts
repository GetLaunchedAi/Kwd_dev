import * as path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { exec } from 'child_process';
import { promisify } from 'util';
import { ClickUpTask } from '../clickup/apiClient';

const execAsync = promisify(exec);

/**
 * Very lightweight rule-based model selector.
 * Expand/adjust rules as you learn more about task patterns.
 */
function chooseBestModel(task: ClickUpTask): string {
  const text = `${task.name} ${task.description}`.toLowerCase();

  // UI / styling / simple tweaks
  if (text.includes('css') || text.includes('color') || text.includes('padding') || text.includes('margin') || text.includes('footer')) {
    return 'claude-3.5-sonnet';
  }

  // API / integration / new feature
  if (text.includes('api') || text.includes('integration') || text.includes('feature') || text.includes('endpoint')) {
    return 'gpt-4o';
  }

  // Refactors / architecture / complex logic
  if (text.includes('refactor') || text.includes('architecture') || text.includes('redesign') || text.includes('rewrite')) {
    return 'claude-opus';
  }

  // Bug fixes (general)
  if (text.includes('bug') || text.includes('fix') || text.includes('error')) {
    return 'claude-3.5-sonnet';
  }

  // Default: balanced, capable model
  return 'claude-3.5-sonnet';
}

/**
 * Attempts to trigger Cursor agent programmatically
 * This is a placeholder that will need to be adapted based on Cursor's actual API
 */
export async function triggerAgent(
  clientFolder: string,
  taskFilePath: string,
  task: ClickUpTask
): Promise<void> {
  logger.info(`Attempting to trigger Cursor agent for task file: ${taskFilePath}`);
  
  const method = config.cursor.agentTriggerMethod || 'file';
  
  switch (method) {
    case 'api':
      await triggerViaApi(clientFolder, taskFilePath, task);
      break;
    case 'cli':
      await triggerViaCli(clientFolder, taskFilePath, task);
      break;
    case 'file':
    default:
      await triggerViaFile(clientFolder, taskFilePath);
      break;
  }
}

/**
 * Attempts to trigger via Cursor API (if available)
 */
async function triggerViaApi(clientFolder: string, taskFilePath: string, task: ClickUpTask): Promise<void> {
  // TODO: Implement when Cursor API is available
  logger.warn('API trigger method not yet implemented - using file-based trigger');
  await triggerViaFile(clientFolder, taskFilePath);
}

/**
 * Attempts to trigger via Cursor CLI
 */
async function triggerViaCli(clientFolder: string, taskFilePath: string, task: ClickUpTask): Promise<void> {
  try {
    const selectedModel = chooseBestModel(task);
    logger.info(`Attempting to trigger Cursor Composer via keyboard automation using model: ${selectedModel}...`);
    
    // Wait for Cursor to fully open and stabilize
    logger.info('Waiting 3 seconds for Cursor to fully open...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    if (process.platform === 'win32') {
      // Use PowerShell to send Ctrl+L to open Composer
      const modelPrefix = selectedModel ? `@${selectedModel} ` : '';
      const psScript = `
        Add-Type -AssemblyName System.Windows.Forms;
        $wshell = New-Object -ComObject wscript.shell;
        Start-Sleep -Milliseconds 500;
        $cursorProcess = Get-Process | Where-Object {$_.ProcessName -eq 'Cursor'} | Select-Object -First 1;
        if ($cursorProcess) {
          $wshell.AppActivate($cursorProcess.Id);
          Start-Sleep -Milliseconds 500;
          $wshell.SendKeys('^l');
          Start-Sleep -Milliseconds 1500;
          $wshell.SendKeys('${modelPrefix}Read CURSOR_TASK.md in this workspace and implement all the requirements described in that file');
          Start-Sleep -Milliseconds 500;
          $wshell.SendKeys('{ENTER}');
        }
      `.trim().replace(/\n/g, ' ');
      
      await execAsync(`powershell -Command "${psScript}"`);
      logger.info(`Successfully triggered Cursor Composer via keyboard automation (Ctrl+L) with model: ${selectedModel}`);
    } else {
      throw new Error('Keyboard automation only supported on Windows (use macOS/Linux methods)');
    }
  } catch (error: any) {
    logger.warn(`Could not trigger agent via keyboard automation: ${error.message}`);
    logger.info('Falling back to file-based trigger');
    await triggerViaFile(clientFolder, taskFilePath);
  }
}

/**
 * Creates task file - agent will pick it up automatically (file-based trigger)
 */
async function triggerViaFile(clientFolder: string, taskFilePath: string): Promise<void> {
  const pathModule = require('path');
  const fse = require('fs-extra');
  
  // File is already created by promptGenerator
  logger.info(`Task file created at ${taskFilePath}`);
  
  // Create/update .cursorrules to direct the agent to the task file
  const cursorRulesPath = pathModule.join(clientFolder, '.cursorrules');
  const cursorRulesContent = `# Automated Task Processing

IMPORTANT: There is a task file that needs your attention.

## Task File Location
${taskFilePath}

## Instructions
1. Read the CURSOR_TASK.md file in this workspace
2. Follow all instructions in that file
3. Implement the required changes
4. Test your changes
5. Commit your changes when complete

## Expected Behavior
You should automatically start working on the task described in CURSOR_TASK.md when this workspace opens.

---
Generated: ${new Date().toISOString()}
`;

  try {
    await fse.writeFile(cursorRulesPath, cursorRulesContent, 'utf-8');
    logger.info(`Created .cursorrules file at ${cursorRulesPath} to guide the agent`);
  } catch (error: any) {
    logger.warn(`Could not create .cursorrules file: ${error.message}`);
  }
  
  logger.warn('NOTE: Cursor agent must be manually triggered with Ctrl+Shift+I or Ctrl+L');
  logger.warn('Or ensure Background Agents are enabled in Settings > Features > Cursor Tab');
}















