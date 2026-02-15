# Git Validation Helper

## Overview

The git validation helper (`src/git/gitValidator.ts`) ensures that tasks and demos are properly initialized as git repositories with correct configuration before workflows begin.

## Features

### `validateGitSetup(folderPath, taskId, updateState?)`

Comprehensive validation that checks:

1. **Folder Existence**: Verifies the target folder exists
2. **Git Repository**: Checks for `.git` directory
3. **Configuration Settings**: Validates required git settings from `config.json`:
   - `git.clientWebsitesDir` - Client websites directory path
   - `git.defaultBranch` - Default branch name (e.g., "main")
   - `git.githubToken` - GitHub authentication token
   - `git.userName` - Git commit author name (has fallback)
   - `git.userEmail` - Git commit author email (has fallback)
4. **Repository Integrity**: Validates git repository structure
5. **Local Configuration**: Checks for local git user config

**Parameters:**
- `folderPath` (string): Path to the task/demo folder
- `taskId` (string): Task or demo ID for error reporting
- `updateState` (boolean, optional): Whether to update workflow state on error (default: true)

**Returns:** `GitValidationResult`
```typescript
{
  isValid: boolean;      // Overall validation status
  errors: string[];      // Critical errors that prevent workflow
  warnings: string[];    // Non-critical issues that are auto-fixed
}
```

### `areGitSettingsConfigured()`

Quick pre-flight check to validate git settings in configuration before starting any workflows.

**Returns:** `boolean` - true if all required git settings are configured

### `validateGitConfigSettings()`

Validates configuration settings without checking a specific folder.

**Returns:** `string[]` - Array of error messages (empty if valid)

## Integration

### Task Workflows

The validation is automatically called in `workflowOrchestrator.ts` after finding the client folder:

```typescript
// Step 2.5: Validate git setup
const gitValidation = await validateGitSetup(clientFolder, taskId, true);
if (!gitValidation.isValid) {
  throw new Error(`Git validation failed: ${gitValidation.errors.join('; ')}`);
}
```

### Demo Workflows

The validation is called in `demoHandler.ts`:

1. **Pre-flight check** before starting demo creation:
```typescript
if (!areGitSettingsConfigured()) {
  throw new Error('Git configuration is incomplete...');
}
```

2. **Post-initialization validation** after git repo is created:
```typescript
const gitValidation = await validateGitSetup(demoDir, taskId, false);
if (!gitValidation.isValid) {
  throw new Error(`Git validation failed: ${gitValidation.errors.join('; ')}`);
}
```

## Error Display

When validation fails and `updateState` is true, the error is automatically displayed in the workflow progress UI's **Error node** with a clear message:

Example error messages:
- `"Git Validation Failed: Not a Git repository. Please initialize the project with git."`
- `"Git Configuration Missing: git.githubToken is not set in configuration."`
- `"Git Validation Failed: Folder does not exist"`

## Configuration

Ensure these settings are configured in `config/config.json`:

```json
{
  "git": {
    "clientWebsitesDir": "./client-websites",
    "githubToken": "env:GITHUB_TOKEN",
    "defaultBranch": "main",
    "userName": "KWD Dev Bot",
    "userEmail": "bot@kwd.dev"
  }
}
```

**Required fields:**
- `clientWebsitesDir`
- `defaultBranch`
- `githubToken`

**Optional fields (with fallbacks):**
- `userName` (defaults to "KWD Dev Bot")
- `userEmail` (defaults to "bot@kwd.dev")

## Example Usage

### Manual Validation

```typescript
import { validateGitSetup } from './git/gitValidator';

const result = await validateGitSetup('/path/to/project', 'task-123', true);

if (!result.isValid) {
  console.error('Validation failed:', result.errors);
  // Workflow state is automatically updated with error
}

if (result.warnings.length > 0) {
  console.warn('Warnings:', result.warnings);
  // Workflow continues, issues are auto-fixed
}
```

### Pre-flight Check

```typescript
import { areGitSettingsConfigured } from './git/gitValidator';

if (!areGitSettingsConfigured()) {
  throw new Error('Please configure git settings before starting workflows');
}
```

## Benefits

1. **Early Error Detection**: Catches configuration issues before workflow execution
2. **Clear Error Messages**: Provides actionable error messages in the UI
3. **Automatic State Updates**: Errors are automatically reflected in workflow progress
4. **Comprehensive Checks**: Validates both folder state and configuration settings
5. **User-Friendly**: Errors displayed in the workflow progress error node guide users to fix issues


