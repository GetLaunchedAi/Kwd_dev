import * as fs from 'fs-extra';
import * as path from 'path';
import { ClickUpTask } from '../clickup/apiClient';
import { logger } from '../utils/logger';

export interface PromptData {
  taskName: string;
  taskUrl: string;
  taskId: string;
  status: string;
  description: string;
  requirements?: string;
  suggestedChanges?: string;
  filesToModify?: string;
  testCommand?: string;
  branchName?: string;
}

/**
 * Generates CURSOR_TASK.md file with detailed instructions
 */
export async function generatePromptFile(
  clientFolder: string,
  task: ClickUpTask,
  branchName?: string,
  testCommand?: string
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
    status: task.status.status,
    description: task.description || 'No description provided',
    requirements,
    suggestedChanges,
    filesToModify,
    testCommand: testCommand || 'npm test',
    branchName,
  };

  const content = formatPromptFile(promptData);
  
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
function formatPromptFile(data: PromptData): string {
  return `# Task: ${data.taskName}

**ClickUp Task**: ${data.taskUrl}
**Task ID**: ${data.taskId}
**Status**: ${data.status}
${data.branchName ? `**Branch**: ${data.branchName}` : ''}

## Description
${data.description}

## Requirements
${data.requirements || 'Review the task description and identify all requirements.'}

## Suggested Changes
${data.suggestedChanges || 'Analyze the task and determine what code changes are needed.'}

## Files to Review/Modify
${data.filesToModify || 'Identify relevant files based on the task requirements.'}

## Testing
- Run: ${data.testCommand || 'npm test'}
- Expected: All tests pass

## Success Criteria
- [ ] Changes implemented according to requirements
- [ ] Code follows project conventions and style
- [ ] Tests passing
- [ ] No console errors or warnings
- [ ] Code is properly formatted

---

**Note**: This task will be processed by Cursor's agent automatically. The workflow tool will monitor for completion and proceed with testing once changes are detected.

When you have completed the changes, commit them to this branch. The workflow tool will detect the changes and proceed with testing.
`;
}















