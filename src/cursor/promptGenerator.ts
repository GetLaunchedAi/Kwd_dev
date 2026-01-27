import * as fs from 'fs-extra';
import * as path from 'path';
import { ClickUpTask } from '../clickup/apiClient';
import { logger } from '../utils/logger';

export interface PromptData {
  taskName: string;
  taskUrl: string;
  taskId: string;
  client: string;
  clientFolder: string;
  status: string;
  description: string;
  requirements?: string;
  suggestedChanges?: string;
  filesToModify?: string;
  testCommand?: string;
  branchName?: string;
  downloadedAttachments?: string[];
}

/**
 * Generates CURSOR_TASK.md file with detailed instructions
 */
export async function generatePromptFile(
  clientFolder: string,
  client: string,
  task: ClickUpTask,
  branchName?: string,
  testCommand?: string,
  downloadedAttachments?: string[]
): Promise<string> {
  
  const promptPath = path.join(clientFolder, 'CURSOR_TASK.md');
  
  
  // Extract requirements from task description
  const requirements = extractRequirements(task.description);
  const suggestedChanges = analyzeChanges(task.description);
  const filesToModify = suggestFilesToModify(task.description);

  const promptData: PromptData = {
    taskName: task.name,
    taskUrl: task.url,
    taskId: task.id,
    client,
    clientFolder,
    status: task.status.status,
    description: task.description || 'No description provided',
    requirements,
    suggestedChanges,
    filesToModify,
    testCommand: testCommand || 'npm test',
    branchName: branchName ? `**Branch**: ${branchName}` : '',
    downloadedAttachments,
  };

  const content = await formatPromptFile(promptData);
  
  await fs.writeFile(promptPath, content, 'utf-8');
  logger.info(`Generated CURSOR_TASK.md at ${promptPath}`);
  
  return promptPath;
}

/**
 * Extracts requirements from task description
 */
function extractRequirements(description: string): string {
  if (!description) return 'See task description above.';
  
  // Look for bullet points, numbered lists, or "requirements" section
  const lines = description.split('\n');
  const requirements: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.match(/^[-*•]\s+/) || trimmed.match(/^\d+\.\s+/) || 
        trimmed.toLowerCase().includes('requirement')) {
      requirements.push(trimmed);
    }
  }
  
  return requirements.length > 0 
    ? requirements.join('\n')
    : 'Review the task description above and identify all requirements.';
}

/**
 * Analyzes task description to suggest what needs to change
 */
function analyzeChanges(description: string): string {
  if (!description) return 'Analyze the task description and determine what code changes are needed.';
  
  // Simple keyword detection for common change types
  const lowerDesc = description.toLowerCase();
  const suggestions: string[] = [];
  
  if (lowerDesc.includes('add') || lowerDesc.includes('create') || lowerDesc.includes('new')) {
    suggestions.push('- Add new functionality/components');
  }
  if (lowerDesc.includes('update') || lowerDesc.includes('modify') || lowerDesc.includes('change')) {
    suggestions.push('- Update existing code');
  }
  if (lowerDesc.includes('fix') || lowerDesc.includes('bug') || lowerDesc.includes('error')) {
    suggestions.push('- Fix bugs or errors');
  }
  if (lowerDesc.includes('remove') || lowerDesc.includes('delete')) {
    suggestions.push('- Remove unused code or features');
  }
  if (lowerDesc.includes('style') || lowerDesc.includes('css') || lowerDesc.includes('design')) {
    suggestions.push('- Update styling/design');
  }
  
  return suggestions.length > 0
    ? suggestions.join('\n')
    : 'Review the task description to identify necessary code changes.';
}

/**
 * Suggests files that might need modification
 */
function suggestFilesToModify(description: string): string {
  if (!description) return 'Identify relevant files based on the task requirements.';
  
  // Extract file mentions or common patterns
  const filePatterns = [
    /(\w+\.(js|ts|tsx|jsx|css|html|py|java|go|rs|php|rb))/gi,
    /file[s]?\s+([a-zA-Z0-9/._-]+)/gi,
    /component[s]?\s+([a-zA-Z0-9/._-]+)/gi,
  ];
  
  const files = new Set<string>();
  
  for (const pattern of filePatterns) {
    const matches = description.matchAll(pattern);
    for (const match of matches) {
      files.add(match[1] || match[0]);
    }
  }
  
  if (files.size > 0) {
    return Array.from(files).map(f => `- ${f}`).join('\n');
  }
  
  return 'Review the codebase structure and identify files that need to be modified based on the task.';
}

/**
 * Formats the prompt file content
 */
async function formatPromptFile(data: PromptData): Promise<string> {
  const templatePath = path.join(__dirname, 'task_template.md');
  let templateContent: string;
  
  try {
    if (await fs.pathExists(templatePath)) {
      templateContent = await fs.readFile(templatePath, 'utf-8');
    } else {
      logger.warn(`Task template not found at ${templatePath}, using fallback`);
      templateContent = getFallbackTemplate();
    }
  } catch (err) {
    logger.error(`Error reading task template: ${err}`);
    templateContent = getFallbackTemplate();
  }

  let attachmentSection = '';
  if (data.downloadedAttachments && data.downloadedAttachments.length > 0) {
    attachmentSection = `

## Attached Reference Images
The following images were attached to the ClickUp task and downloaded locally:
${data.downloadedAttachments.map(filePath => {
  // Make path relative to clientFolder (which is usually the repo root)
  const relPath = path.relative(data.clientFolder, filePath);
  return `- ${relPath.replace(/\\/g, '/')}`;
}).join('\n')}

`;
  }

  // Replace placeholders
  let content = templateContent;
  content = content.replace(/\$\{attachmentSection\}/g, attachmentSection);
  
  // Replace ${data.xxx} placeholders
  const keys = Object.keys(data) as (keyof PromptData)[];
  for (const key of keys) {
    const value = data[key];
    const stringValue = Array.isArray(value) ? value.join('\n') : (value || '');
    // Replace all occurrences of ${data.key}
    content = content.split(`\${data.${key}}`).join(stringValue);
  }

  return content;
}

/**
 * Returns the fallback template if the template file is missing
 */
function getFallbackTemplate(): string {
  return `# Task: \${data.taskName}

## 1. Goal + Acceptance Criteria
**Objective**: \${data.description}

**Requirements**:
\${data.requirements}

**Success Criteria**:
- All requirements are implemented.
- Code matches the project's standards.
- Local validation passes.\${attachmentSection}
## 2. Metadata
**ClickUp Task**: \${data.taskUrl}
**Task ID**: \${data.taskId}
**Client**: \${data.client}
**Client Folder**: \${data.clientFolder}
**Status**: \${data.status}
\${data.branchName}

## 3. Constraints
1. **No Push**: NEVER push your changes to GitHub. The system handles the push after approval.
2. **Run Tests**: Always run the validation command before finishing.
3. **Scope**: Only work on this task. Do not explore other parts of the codebase unless necessary.

## 4. Local Validation
- **Command**: \${data.testCommand} (Run this inside \${data.clientFolder} if possible)
- **Expected**: All tests pass and changes are verified locally.

## 5. What "Done" Means
1. **Development**: Implement requested changes.
2. **Validation**: Run the validation command and ensure it passes.
3. **Status Update**: Update \\.cursor/status/current.json with state: "done", percent: 100, and step: "Completed".
4. **Commit**: Commit your changes with a message like task: [\${data.taskId}] description.
5. **EXIT**: After committing and updating status, **EXIT IMMEDIATELY**. Do not wait for further instructions.

---

**Technical Suggestions**:
### Suggested Changes
\${data.suggestedChanges}

### Files to Review/Modify
\${data.filesToModify}
`;
}















