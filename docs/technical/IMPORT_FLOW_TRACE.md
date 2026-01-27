# Import Task Flow Trace

## Task ID: 86b7yt9z5

### What is Called with taskId:

1. **Endpoint receives taskId from URL params:**
   - `POST /api/tasks/import/86b7yt9z5`
   - `req.params.taskId = "86b7yt9z5"`

2. **ClickUp API Call:**
   - `clickUpApiClient.getTask("86b7yt9z5")`
   - Makes GET request to: `https://api.clickup.com/api/v2/task/86b7yt9z5`
   - Returns: `ClickUpTask` object with:
     ```typescript
     {
       id: string,        // This is the actual task ID from ClickUp (might differ from URL param)
       name: string,
       description: string,
       status: { status: string, color: string },
       url: string,
       assignees: Array<...>,
       ...
     }
     ```

3. **Check if task exists:**
   - `findTaskById(task.id)` - Uses `task.id` from ClickUp response, NOT the URL param
   - Checks local state files for existing task

4. **Extract Client Name:**
   - `extractClientName(task.name, task.id)` - Uses `task.id` from ClickUp response
   - Inside `extractClientName`:
     - **Step 1:** `getClientMapping(task.id)` 
       - Loads `config/task-client-mappings.json`
       - Returns: `mappings.mappings[task.id] || null`
       - **This is the key call using taskId!**
     - **Step 2:** `checkPatternMappings(task.name)` - Pattern matching on task name
     - **Step 3:** Check config folder mapping
     - **Step 4:** Enhanced pattern extraction from task name
     - **Step 5:** Fallback to capitalized words

5. **Find Client Folder:**
   - `findClientFolder(clientName)` - Validates client folder exists

6. **Save Task Info:**
   - `updateWorkflowState(clientFolder, task.id, WorkflowState.PENDING)`
   - `saveTaskInfo(clientFolder, task.id, { task, taskId: task.id, ... })`

### Key Points:

- **URL param taskId** (`86b7yt9z5`) is used to fetch from ClickUp
- **ClickUp response task.id** is used for all subsequent operations
- **`getClientMapping(task.id)`** is the function that looks up the task ID in mappings
- The mapping file path: `config/task-client-mappings.json`
- The mapping structure: `{ mappings: { "taskId": "clientName" } }`

### What getClientMapping Returns:

```typescript
async function getClientMapping(taskId: string): Promise<string | null> {
  const mappings = await loadMappings();  // Loads from config/task-client-mappings.json
  return mappings.mappings[taskId] || null;  // Returns client name or null
}
```

### Example:

If `task.id = "86b7yt9z5"` and mappings file contains:
```json
{
  "mappings": {
    "86b7yt9z5": "SomeClient"
  }
}
```

Then `getClientMapping("86b7yt9z5")` returns `"SomeClient"`

