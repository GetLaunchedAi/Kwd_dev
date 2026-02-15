# Task Cleanup - Quick Reference

## Overview

Task deletion now completely removes all artifacts. No orphaned files remain after deletion.

## What Gets Deleted

When you delete a task (e.g., `86b81fu94`), these files are removed:

```
.cursor/
  ├── status/86b81fu94.json              ✓ Removed
  ├── status/current.json                ✓ Removed (if matches taskId)
  ├── queue/0001_86b81fu94.md           ✓ Removed
  ├── running/0002_86b81fu94.md         ✓ Removed
  ├── done/0001_86b81fu94.md            ✓ Removed
  ├── failed/0003_86b81fu94.md          ✓ Removed
  └── logs/
      ├── 86b81fu94.ndjson               ✓ Removed
      └── 86b81fu94.stderr.log           ✓ Removed

logs/tasks/86b81fu94/                    ✓ Removed (entire directory)
  └── runner-*.log

client-folder/.clickup-workflow/86b81fu94/  ✓ Removed (entire directory)
  ├── state.json
  └── info.json
```

## API Endpoints

### Delete Single Task
```http
DELETE /api/tasks/:taskId
```

**Response (Success):**
```json
{
  "success": true,
  "message": "Task 86b81fu94 deleted successfully"
}
```

**Response (Task Running):**
```json
{
  "error": "Cannot delete task 86b81fu94: Task is currently running. Please wait for the task to complete or cancel it first."
}
```

### Delete All Tasks
```http
DELETE /api/tasks
```

**Response:**
```json
{
  "success": true,
  "deletedCount": 5,
  "errors": []
}
```

## UI Integration

The dashboard already has delete buttons that call these endpoints:
- **Single task delete**: Click trash icon on task card
- **Delete all**: Click "Delete All Tasks" button (with confirmation)

## Safety Features

### 1. Running Task Protection
✓ Cannot delete tasks that are currently running
✓ Must wait for completion or manually cancel first

### 2. current.json Protection
✓ Only deleted if it references the deleted task
✓ Other tasks' status remains intact

### 3. Idempotent Operations
✓ Safe to call delete multiple times
✓ No errors if files already removed

### 4. Path Validation
✓ Prevents path traversal attacks
✓ Operations only within allowed directories

## Troubleshooting

### "Cannot delete task: Task is currently running"
**Solution:** Wait for the task to complete, or:
1. Check `.cursor/running/` for task file
2. Check task status in dashboard
3. Manually move task file from `running/` to `failed/` if stuck

### Orphaned Files After Manual Intervention
**Solution:** Run delete again - cleanup is idempotent and will remove any remaining artifacts.

### Manual Cleanup (if needed)
```bash
# Find all artifacts for a task
find . -name "*86b81fu94*"

# Remove specific artifacts
rm .cursor/status/86b81fu94.json
rm .cursor/logs/86b81fu94.*
rm -rf logs/tasks/86b81fu94
```

## Logging

Look for `[CLEANUP]` prefix in logs:
```
[CLEANUP] Starting cleanup for task 86b81fu94
[CLEANUP] Removed status file: .cursor/status/86b81fu94.json
[CLEANUP] Removed current.json (task matched)
[CLEANUP] Removed done file: .cursor/done/0001_86b81fu94.md
[CLEANUP] ✓ Cleanup complete for task 86b81fu94
```

Or for delete operations:
```
[DELETE] Starting deletion of task 86b81fu94
[DELETE] ✓ Successfully deleted task 86b81fu94 and all its artifacts
```

## Code Examples

### TypeScript/Node.js
```typescript
import { deleteTaskById } from './utils/taskScanner';

try {
  const deleted = await deleteTaskById('86b81fu94');
  console.log('Task deleted:', deleted);
} catch (error) {
  console.error('Delete failed:', error.message);
}
```

### Direct Service Usage
```typescript
import { taskCleanupService } from './cursor/taskCleanupService';

// Check if running first
const isRunning = await taskCleanupService.isTaskRunning('86b81fu94');
if (isRunning) {
  console.log('Task is running, cannot delete');
} else {
  await taskCleanupService.deleteTaskArtifacts('86b81fu94', clientFolder);
}
```

### JavaScript (Frontend)
```javascript
// Delete single task
async function deleteTask(taskId) {
  const response = await fetch(`/api/tasks/${taskId}`, {
    method: 'DELETE'
  });
  const result = await response.json();
  if (result.success) {
    console.log('Task deleted');
  }
}

// Delete all tasks
async function deleteAllTasks() {
  const response = await fetch('/api/tasks', {
    method: 'DELETE'
  });
  const result = await response.json();
  console.log(`Deleted ${result.deletedCount} tasks`);
}
```

## Testing

### Run Tests
```bash
# Build first
npm run build

# Run cleanup test
npx ts-node scripts/test-cleanup.ts

# Run current.json safety test
npx ts-node scripts/test-cleanup-current-json.ts
```

### Expected Output
```
============================================================
✅ ALL TESTS PASSED
============================================================
```

## Files Changed

**New Files:**
- `src/cursor/taskCleanupService.ts` - Cleanup service implementation
- `tests/taskCleanupService.test.ts` - Unit tests
- `scripts/test-cleanup.ts` - End-to-end test
- `scripts/test-cleanup-current-json.ts` - Safety test

**Modified Files:**
- `src/utils/taskScanner.ts` - Updated deleteTaskById() and deleteAllTasks()

## Migration Notes

**No migration needed** - This is a fix to existing functionality. All existing code continues to work, but now cleanup is comprehensive.

## Related Documentation

- Full implementation details: `TASK_CLEANUP_IMPLEMENTATION.md`
- Queue system: `.cursor/plans/migrate_to_file-based_agent_queue_df440b6c.plan.md`
- Status files: `src/cursor/taskStatusManager.ts`








