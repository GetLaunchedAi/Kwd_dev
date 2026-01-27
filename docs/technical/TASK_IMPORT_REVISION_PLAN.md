# Task Import System Revision Plan

## Current Issues Analysis

### Problem Statement
There are tasks in ClickUp that aren't being imported into the system. This plan addresses the root causes and proposes a comprehensive solution.

### Identified Issues

1. **Webhook Dependency**
   - Tasks are only imported when webhooks fire and status matches trigger status
   - If webhook fails or isn't configured properly, tasks are missed
   - Tasks that don't match trigger status are never imported via webhook

2. **Incomplete Task Fetching (`getAllIncompleteTasks`)**
   - Only traverses Spaces → Lists, missing ClickUp Folders structure
   - Hardcoded status filtering (`complete`, `completed`, `done`, `closed`, `cancelled`) may miss custom statuses
   - No pagination handling for spaces/lists
   - No filtering options (can't target specific spaces/lists/folders)
   - Potential API rate limiting issues with large workspaces

3. **Client Name Extraction Failures**
   - Tasks fail to import if client name cannot be extracted from task name
   - Pattern-based extraction is fragile and misses edge cases
   - No fallback mechanisms or manual mapping options

4. **No Scheduled Sync**
   - No periodic background sync to catch missed tasks
   - Relies entirely on webhooks or manual imports

5. **Limited Error Reporting**
   - Import failures are logged but not easily queryable
   - No visibility into which tasks failed and why
   - No retry mechanism for failed imports

6. **Manual Import Limitations**
   - Bulk import endpoint exists but requires manual triggering
   - No way to import specific tasks by criteria (e.g., by assignee, tag, list, etc.)
   - No incremental sync (only full sync)

## Proposed Solutions

### Phase 1: Enhanced Task Fetching (High Priority)

#### 1.1 Add Folder Support to API Client
- **File**: `src/clickup/apiClient.ts`
- **Changes**:
  - Add `getFolders(spaceId: string)` method
  - Add `getTasksFromFolder(folderId: string, includeClosed: boolean)` method
  - Update `getAllIncompleteTasks()` to traverse: Spaces → Folders → Lists → Tasks
  - Add support for tasks directly in folders (if applicable)

#### 1.2 Improve Status Filtering
- **File**: `src/clickup/apiClient.ts`
- **Changes**:
  - Make completion statuses configurable in `config.json`
  - Add option to fetch all tasks regardless of status
  - Use ClickUp API's status type (open/closed) instead of hardcoded strings
  - Add status inclusion/exclusion filters

#### 1.3 Add Pagination and Rate Limiting
- **File**: `src/clickup/apiClient.ts`
- **Changes**:
  - Implement proper pagination for all API calls
  - Add rate limiting with exponential backoff
  - Add request queuing for large batch operations
  - Add progress tracking for long-running operations

#### 1.4 Add Filtering Options
- **File**: `src/clickup/apiClient.ts`
- **New Method**: `getTasksByFilter(options: TaskFilterOptions)`
- **Options**:
  - Space IDs (whitelist/blacklist)
  - Folder IDs (whitelist/blacklist)
  - List IDs (whitelist/blacklist)
  - Status filters
  - Assignee filters
  - Date range filters
  - Tag filters

### Phase 2: Improved Client Name Extraction (High Priority)

#### 2.1 Enhanced Extraction Logic
- **File**: `src/utils/taskParser.ts`
- **Changes**:
  - Improve pattern matching with more regex patterns
  - Add support for custom field extraction (if client name is in a custom field)
  - Add fuzzy matching for similar client names
  - Add validation against actual folder names

#### 2.2 Manual Mapping System
- **File**: `src/utils/taskParser.ts`
- **New Feature**: Task-to-Client mapping cache/database
- **Storage**: JSON file or simple database (e.g., `config/task-client-mappings.json`)
- **API**: 
  - `mapTaskToClient(taskId: string, clientName: string)` - Manual mapping
  - `getClientMapping(taskId: string)` - Get mapping
  - Auto-save successful mappings for future use

#### 2.3 Client Name Validation
- **File**: `src/utils/taskParser.ts`
- **Changes**:
  - Validate extracted client names against actual folder structure
  - Suggest closest matches when extraction fails
  - Return multiple candidates for manual selection

### Phase 3: Scheduled Sync System (Medium Priority)

#### 3.1 Background Sync Service
- **New File**: `src/sync/taskSyncService.ts`
- **Features**:
  - Periodic sync (configurable interval, e.g., every hour)
  - Incremental sync (only fetch tasks updated since last sync)
  - Full sync option (sync all tasks)
  - Configurable sync schedule

#### 3.2 Sync State Management
- **New File**: `src/sync/syncState.ts` (or add to `state/stateManager.ts`)
- **Features**:
  - Track last sync timestamp per space/list
  - Track sync status and errors
  - Store sync history

#### 3.3 Sync API Endpoints
- **File**: `src/server.ts`
- **New Endpoints**:
  - `POST /api/sync/start` - Start manual sync
  - `GET /api/sync/status` - Get sync status
  - `GET /api/sync/history` - Get sync history
  - `POST /api/sync/configure` - Configure sync settings

### Phase 4: Enhanced Import System (Medium Priority)

#### 4.1 Improved Bulk Import
- **File**: `src/server.ts`
- **Changes**:
  - Add filtering options to bulk import endpoint
  - Add incremental import (only new/changed tasks)
  - Add progress tracking for bulk imports
  - Add dry-run mode to preview what would be imported

#### 4.2 Import by Criteria
- **File**: `src/server.ts`
- **New Endpoints**:
  - `POST /api/tasks/import-by-list/:listId` - Import all tasks from a list
  - `POST /api/tasks/import-by-folder/:folderId` - Import all tasks from a folder
  - `POST /api/tasks/import-by-space/:spaceId` - Import all tasks from a space
  - `POST /api/tasks/import-by-filter` - Import tasks matching filter criteria

#### 4.3 Import Status Tracking
- **File**: `src/utils/taskScanner.ts` or new `src/import/importTracker.ts`
- **Features**:
  - Track import attempts and results
  - Store import errors with task details
  - Provide API to query failed imports
  - Automatic retry for transient failures

### Phase 5: Error Handling and Reporting (Medium Priority)

#### 5.1 Enhanced Error Logging
- **Files**: Various import-related files
- **Changes**:
  - Structured error logging with context
  - Error categorization (extraction failure, folder not found, API error, etc.)
  - Error aggregation and reporting

#### 5.2 Failed Import Management
- **New File**: `src/import/failedImports.ts`
- **Features**:
  - Store failed imports with reasons
  - API endpoint to view failed imports
  - Manual retry capability
  - Bulk retry with fixes (e.g., after adding client mappings)

#### 5.3 Import Analytics Dashboard
- **Frontend Enhancement**: `public/index.html` or new dashboard page
- **Features**:
  - Show import statistics (total, successful, failed, skipped)
  - Display failed imports with reasons
  - Show sync status and last sync time
  - Import success rate over time

### Phase 6: Configuration Enhancements (Low Priority)

#### 6.1 Enhanced Config Schema
- **File**: `config/config.example.json`
- **New Options**:
  ```json
  {
    "clickup": {
      "sync": {
        "enabled": true,
        "interval": 3600000,
        "fullSyncInterval": 86400000,
        "incrementalSync": true
      },
      "filters": {
        "spaces": [],
        "folders": [],
        "lists": [],
        "excludeStatuses": ["complete", "done"],
        "includeOnlyStatuses": null
      },
      "completionStatuses": ["complete", "completed", "done", "closed", "cancelled"]
    },
    "import": {
      "autoRetry": true,
      "retryAttempts": 3,
      "retryDelay": 5000,
      "saveClientMappings": true
    }
  }
  ```

#### 6.2 Client Mapping Configuration
- **New File**: `config/task-client-mappings.json`
- **Structure**:
  ```json
  {
    "mappings": {
      "task-id-1": "client-folder-name",
      "task-id-2": "client-folder-name"
    },
    "patternMappings": {
      "pattern": "regex pattern",
      "client": "client-folder-name"
    }
  }
  ```

## Implementation Priority

### Immediate (Week 1)
1. Phase 1.1: Add Folder Support (Critical - many tasks are in folders)
2. Phase 1.2: Improve Status Filtering (Critical - may miss tasks)
3. Phase 2.2: Manual Mapping System (High - enables import of tasks with extraction failures)

### Short-term (Week 2-3)
4. Phase 1.3: Pagination and Rate Limiting (Important for reliability)
5. Phase 2.1: Enhanced Extraction Logic (Improves success rate)
6. Phase 4.1: Improved Bulk Import (Better user experience)

### Medium-term (Week 4-6)
7. Phase 3: Scheduled Sync System (Reduces manual intervention)
8. Phase 4.2: Import by Criteria (More flexible imports)
9. Phase 5: Error Handling and Reporting (Better visibility)

### Long-term (Future)
10. Phase 6: Configuration Enhancements (Polish and refinement)
11. Phase 4.3: Import Status Tracking (Advanced features)

## Testing Strategy

1. **Unit Tests**
   - Test folder traversal logic
   - Test enhanced client name extraction
   - Test mapping system
   - Test filtering logic

2. **Integration Tests**
   - Test full sync workflow
   - Test import endpoints
   - Test error handling

3. **Manual Testing**
   - Test with real ClickUp workspace
   - Verify tasks in folders are found
   - Test manual mapping
   - Test scheduled sync

## Migration Plan

1. **Backward Compatibility**
   - Ensure existing webhook flow continues to work
   - Existing config remains valid (add new optional fields)
   - Existing tasks continue to work

2. **Data Migration**
   - Create task-client-mappings.json if manual mappings exist
   - Migrate any existing sync state if present

3. **Rollout**
   - Deploy Phase 1 changes first (critical fixes)
   - Test in staging/development
   - Gradual rollout with monitoring

## Success Metrics

- **Import Success Rate**: >95% of eligible tasks imported
- **Client Name Extraction Rate**: >90% success without manual mapping
- **Sync Reliability**: 99%+ sync success rate
- **Error Visibility**: All import failures visible and actionable

## Notes

- Consider using ClickUp's webhooks more effectively (subscribe to all task events, not just status changes)
- Evaluate using ClickUp's Views API if available for more flexible querying
- Consider caching ClickUp workspace structure to reduce API calls
- May want to add task deduplication logic if same task appears in multiple lists/folders















