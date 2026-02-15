# Task Deletion Cleanup Implementation

## Summary

Implemented comprehensive task cleanup to ensure no orphaned files remain after task deletion. The system now removes all task-related artifacts across the filesystem-based state bus.

## Changes Made

### 1. New Service: `TaskCleanupService` (`src/cursor/taskCleanupService.ts`)

A centralized service that handles complete task artifact cleanup:

**Features:**
- **Path validation** to prevent path traversal attacks
- **Idempotent operations** - safe to call multiple times
- **Comprehensive artifact removal** for all task-related files
- **Smart current.json handling** - only removes if it references the deleted task
- **Detailed logging** for all cleanup operations

**Artifacts Cleaned:**
- `.cursor/status/{taskId}.json` - Task status file
- `.cursor/status/current.json` - Only if it references this task
- `.cursor/queue/*_{taskId}.md` - Queued task files
- `.cursor/running/*_{taskId}.md` - Running task files
- `.cursor/done/*_{taskId}.md` - Completed task files
- `.cursor/failed/*_{taskId}.md` - Failed task files
- `.cursor/logs/{taskId}.ndjson` - NDJSON log files
- `.cursor/logs/{taskId}.stderr.log` - Stderr log files
- `.cursor/status/tmp/{taskId}.*.json` - Temporary status files
- `logs/tasks/{taskId}/` - Runner log directories
- `{clientFolder}/.clickup-workflow/{taskId}/` - Client workflow state

### 2. Updated: `deleteTaskById()` (`src/utils/taskScanner.ts`)

**Before:**
- Only deleted `.clickup-workflow/{taskId}` directory in client folder
- Left orphaned status files, logs, and queue files

**After:**
- Uses `TaskCleanupService.deleteTaskArtifacts()`
- Removes ALL task-related files across the system
- Blocks deletion if task is currently running
- Handles orphaned artifacts even when task not found in client folders
- Returns clear error messages

### 3. Updated: `deleteAllTasks()` (`src/utils/taskScanner.ts`)

**Before:**
- Deleted entire `.clickup-workflow` directories
- No individual task cleanup

**After:**
- Iterates through all tasks
- Uses `TaskCleanupService` for each task
- Skips running tasks with clear error messages
- Returns detailed count of deleted tasks and errors

### 4. Tests (`tests/taskCleanupService.test.ts`)

Comprehensive test suite covering:
- Complete artifact removal
- Idempotency (calling delete twice doesn't fail)
- current.json safety (not deleted when referencing different task)
- Selective deletion (only target task files removed)
- Missing artifacts handling (graceful, no errors)
- Running task detection
- Path validation
- Concurrent deletion handling

## Concurrency & Safety

### Running Tasks
When a task is currently running (has a file in `.cursor/running/`):
- **Deletion is blocked** with a clear error message
- User must wait for completion or manually cancel the task first
- This prevents data loss and ensures clean agent shutdown

### Idempotency
- All cleanup operations are safe to call multiple times
- ENOENT errors are caught and logged as debug (not errors)
- No exceptions thrown for already-deleted files

### current.json Handling
- Only deleted if `task.taskId` matches the deleted task
- Prevents accidentally clearing status for a different running task
- Smart check prevents disrupting active workflows

### Path Validation
- All paths validated against allowed roots
- Prevents path traversal attacks (`../../../` patterns)
- Operations only within workspace root and client folders

## Acceptance Criteria - Met

✅ **After deleting a task, no `.cursor/status/{taskId}.json` remains**
- Verified by test scripts and TaskCleanupService implementation

✅ **No `logs/tasks/{taskId}/` directory remains**
- Removed using `fs.remove()` with recursive: true

✅ **Queue/running entries for that taskId are removed**
- Pattern-based removal from queue/, running/, done/, failed/

✅ **No other task's artifacts are deleted**
- Regex pattern matching ensures only exact taskId matches
- current.json only deleted when it references the deleted task

✅ **Deletion is safe, idempotent, and well-logged**
- Path validation prevents directory traversal
- Idempotent operations handle missing files gracefully
- Comprehensive logging with [CLEANUP] prefix for all operations

✅ **No orphaned status/log/queue files remain**
- All artifact types covered in cleanup service
- End-to-end verification tests pass

## Usage

### Delete Single Task
```typescript
import { deleteTaskById } from './utils/taskScanner';

// Deletes all artifacts for task
await deleteTaskById('86b81fu94');
```

### Delete All Tasks
```typescript
import { deleteAllTasks } from './utils/taskScanner';

const result = await deleteAllTasks();
console.log(`Deleted ${result.deletedCount} tasks`);
console.log(`Errors: ${result.errors.length}`);
```

### Direct Cleanup Service Usage
```typescript
import { taskCleanupService } from './cursor/taskCleanupService';

// Check if task is running
const isRunning = await taskCleanupService.isTaskRunning('86b81fu94');

// Perform cleanup
if (!isRunning) {
  await taskCleanupService.deleteTaskArtifacts('86b81fu94', clientFolder);
}
```

## Logging

All cleanup operations log with the `[CLEANUP]` prefix for easy filtering:

```
[CLEANUP] Starting cleanup for task 86b81fu94
[CLEANUP] Removed done file: .cursor/done/0001_86b81fu94.md
[CLEANUP] Removed status file: .cursor/status/86b81fu94.json
[CLEANUP] Removed current.json (task matched): .cursor/status/current.json
[CLEANUP] Removed log file: .cursor/logs/86b81fu94.ndjson
[CLEANUP] Removed runner logs directory: logs/tasks/86b81fu94
[CLEANUP] ✓ Cleanup complete for task 86b81fu94
```

## Error Handling

### Task Running
```
[DELETE] Cannot delete task 86b81fu94: Task is currently running. 
Please wait for the task to complete or cancel it first.
```

### Cleanup Errors
- Non-ENOENT errors are logged and re-thrown
- Provides clear error context for debugging
- Cleanup stops on serious errors (prevents partial cleanup)

### Orphaned Artifacts
- Cleanup proceeds even when task not found in client folders
- Removes any leftover files from incomplete cleanup or crashes

## Architecture Notes

### Why Not Delete on Task Completion?
Tasks remain in `done/` or `failed/` folders for auditing and troubleshooting. Only explicit deletion via API removes artifacts.

### Filesystem as State Bus
The implementation respects the queue-based architecture where:
- `queue/` = pending tasks
- `running/` = active task
- `done/` = successful completions
- `failed/` = failures and stale tasks
- Cleanup only occurs on explicit deletion, not automatic transitions

### Integration Points
- **Express API**: `/api/tasks/:taskId` DELETE route
- **Dashboard UI**: Delete button on task cards
- **Batch Operations**: `/api/tasks` DELETE route for delete all

## Testing

Comprehensive test suite validates:
- All artifacts are removed
- Idempotent operations
- current.json safety
- Path validation
- Concurrent deletion

Build and run tests:
```bash
npm run build
```

## Files Modified

**New:**
- `src/cursor/taskCleanupService.ts` - Cleanup service
- `tests/taskCleanupService.test.ts` - Unit tests

**Updated:**
- `src/utils/taskScanner.ts` - deleteTaskById() & deleteAllTasks()

**Documentation:**
- `docs/technical/TASK_CLEANUP_IMPLEMENTATION.md` - This file
- `docs/technical/TASK_CLEANUP_QUICK_REFERENCE.md` - Quick reference








