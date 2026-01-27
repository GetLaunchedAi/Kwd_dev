# Repository Map: ClickUp-Cursor Workflow Tool

This document provides a code-first overview of the project structure, entrypoints, and core orchestration logic.

## 1. Directory Tree
```text
.
├── src/                    # Primary TypeScript Source
│   ├── workflow/           # Central Orchestrator (The "Brain")
│   ├── cursor/             # Agent Lifecycle (Triggering, Monitoring, CLI)
│   ├── clickup/            # ClickUp API & Webhook Processing
│   ├── git/                # Automated Repository Management
│   ├── approval/           # Slack/Email Approval Workflow
│   └── server.ts           # REST API & Dashboard Entrypoint
├── public/                 # Dashboard UI (Vanilla JS, Polling-based)
├── client-websites/        # Working directory for AI agent tasks
├── github-clone-all/       # Sub-project: Utility for bulk repo management
├── ImageRetriever/         # Sub-project: Specialized asset qualification tool
└── config/                 # task-client-mappings.json (ClickUp -> Repo map)
```

## 2. Runtime Entrypoints
| Entrypoint | File Path | Invocation | Role |
| :--- | :--- | :--- | :--- |
| **Main Web Server** | `src/server.ts` | `npm start` / `npm run dev` | Handles webhooks, API, and Dashboard. |
| **CLI Runner** | `src/cursor/runner.ts` | Programmatic (`spawn`) | Launches `cursor-agent chat` for tasks. |
| **Scripts** | `scripts/test_*.ts` | `npx ts-node` | Targeted testing of workflow segments. |

---

## 3. Core Orchestration Logic

### Agent-IDE Protocol: "Single-Shot Agent Protocol"
The system utilizes a structured handoff to the Cursor AI agent:
- **Instruction File**: `CURSOR_TASK.md` is generated in the client repo with specific Acceptance Criteria and constraints.
- **Rules Enforcement**: `.cursorrules` is updated to force the agent to follow the "Open → Follow Instructions" loop.
- **Status Tracking**: The agent updates `.cursor/status/current.json` which the server polls to track progress.

### Dashboard & State
- **UI Mechanism**: The `public/` dashboard uses aggressive polling via `public/app.js` to fetch task status, health checks, and webhook toggle states.
- **Workflow State**: Managed by `src/workflow/workflowOrchestrator.ts` and persisted via `src/state/stateManager.ts`.

---

## 4. Key Modules & Responsibility

| Module | Responsibility |
| :--- | :--- |
| `workflowOrchestrator.ts` | Manages the full state machine from import to completion. |
| `agentTrigger.ts` | Handles the transition from server event to agent execution. |
| `agentCompletionDetector.ts` | Watches the filesystem for the agent's "Done" signal. |
| `changeSummarizer.ts` | Generates human-readable summaries for Slack/Email notifications. |
| `githubCloner.ts` | Automates the cloning and updating of client repositories. |
| `taskScanner.ts` | Indexes the `client-websites/` directory to track active work. |

---

## 5. Deployment Notes
- **WSL Support**: The system has dedicated logic in `src/cursor/runner.ts` to detect and run the `cursor-agent` within a WSL environment (e.g., Ubuntu) if configured.
- **Mapping**: All task-to-repo routing is controlled by `config/task-client-mappings.json`.

---

## 6. ClickUp Integration Analysis

The following is a code-first analysis of the ClickUp integration, based on the `src/clickup/` and `src/utils/` directories.

### A) Key Files + Responsibilities
| File Path | Responsibility |
| :--- | :--- |
| `src/clickup/apiClient.ts` | **Core Client**: `ClickUpApiClient` class. Manages `Axios` instance, rate limiting (100ms delay + exponential backoff), and all API V2 interactions. |
| `src/clickup/oauthService.ts` | **Auth Manager**: Handles OAuth 2.0 flow, code-to-token exchange, and persistent storage of tokens in `tokens/clickup-access-token.json`. |
| `src/clickup/webhookHandler.ts` | **Event Processor**: Validates `x-clickup-signature` (HMAC SHA-256) and filters events based on `triggerStatus` defined in config. |
| `src/utils/taskParser.ts` | **Mapper**: High-complexity logic for extracting client/folder names from task metadata (names, folders, spaces). |
| `src/config/config.ts` | **Config Loader**: Reads `config/config.json`, resolving `env:VAR` placeholders into actual environment values. |

### B) Data Pulled from ClickUp (Fields) + Usage
Data is modeled in the `ClickUpTask` interface (`src/clickup/apiClient.ts:25`).

| Field | Source Object | Usage |
| :--- | :--- | :--- |
| `id` | Task | Primary key for state management and manual mapping lookups. |
| `name` | Task | Main source for regex-based client name extraction. |
| `description` | Task | Parsed for implementation details and passed to LLM prompts. |
| `status` | Task | Used to trigger workflows (via `triggerStatus`) and filter incomplete tasks. |
| `assignees` | Task | `email` is used for sending failure/approval notifications. |
| `folder.name` | Hierarchy | Primary fallback for identifying the target local directory. |
| `list.name` | Hierarchy | Secondary fallback for folder identification. |
| `space.name` | Hierarchy | Tertiary fallback for folder identification. |
| `custom_fields` | Task | Defined in interface but usage appears dynamic/generic. |

### C) Mapping/Parsing Rules
The system uses a prioritized multi-stage extraction strategy in `src/utils/taskParser.ts`:

1.  **Manual Lookup**: Checks `src/utils/clientMappingManager.ts` for a direct `taskId` -> `clientName` map.
2.  **Hierarchy Extraction**: 
    *   Iterates through `folder.name`, `list.name`, `project.name`, and `space.name`.
    *   Attempts direct matches, then hyphenated versions (e.g., "Jacks Roofing LLC" → `jacks-roofing-llc`).
    *   Cleans common suffixes (`LLC`, `Inc`, `Corp`) before matching.
3.  **Pattern Mappings**: Uses `config/task-client-mappings.json` to match task names against regex patterns (e.g., `.*audit.*` → `AuditClient`).
4.  **Static Config**: Checks `config.git.folderMapping` for explicit string replacements.
5.  **Regex Patterns**: Runs a series of patterns against the task name:
    *   `for|in|to|from [ClientName]`
    *   `client|project|repo: [ClientName]`
    *   `[ClientName] website|site`
6.  **Fuzzy Matching**: Uses Levenshtein distance (via `findClosestMatches`) to suggest existing directories if similarity is ≥ 50%.

### D) Env Vars Involved
Env vars are loaded via `dotenv` and resolved in `src/config/config.ts` if the JSON config uses the `env:` prefix.

*   `CLICKUP_API_TOKEN`: Used as a fallback if no OAuth token is present.
*   `CLICKUP_WEBHOOK_SECRET`: Used in `src/clickup/apiClient.ts:730` to verify `x-clickup-signature` using HMAC SHA-256.
*   `CLICKUP_CLIENT_ID` & `CLICKUP_CLIENT_SECRET`: Used for the OAuth flow in `src/clickup/oauthService.ts`.

### E) Unknowns
*   **Custom Fields**: While `custom_fields` are fetched, there is no hardcoded logic showing specific custom fields (like "Github Repo URL") being used for mapping; it relies heavily on name/hierarchy parsing.
*   **Token Refresh**: `src/clickup/oauthService.ts` contains an `expires_in` field but no explicit `refresh_token` logic was visible in the current `exchangeCodeForToken` implementation (it only logs a warning if expired).
*   **Rate Limit Thresholds**: The client uses a 100ms `minRequestDelay` and 5 max retries, but it's unknown if this is optimized for ClickUp's specific tier limits (e.g., Enterprise vs. Free).

---

## 7. Task Model & Persistence Analysis

The following is a code-first analysis of the task data model and persistence mechanism, identifying how task state is stored and transitioned.

### A) Types/Interfaces + Locations

| Type / Interface | File Path | Description |
| :--- | :--- | :--- |
| `WorkflowState` (Enum) | `src/state/stateManager.ts` | High-level lifecycle states for the overall process. |
| `TaskState` | `src/state/stateManager.ts` | Schema for the workflow status file (`state.json`). |
| `TaskInfo` | `src/state/stateManager.ts` | Schema for the ClickUp metadata file (`task-info.json`). |
| `ClickUpTask` | `src/clickup/apiClient.ts` | Original data structure from ClickUp API. |
| `QueueStatus` | `src/cursor/agentQueue.ts` | Schema for real-time agent execution status (`current.json`). |
| `TaskMetadata` | `src/cursor/agentQueue.ts` | Metadata embedded in YAML headers of task files in `.cursor/queue/`. |

### B) State Machine (Transitions)

The system manages two state machines: one for the **Workflow** (managed by the backend) and one for the **Agent Queue** (managed during execution).

#### 1. Workflow State Machine (`WorkflowState`)
*   **`PENDING`** (Initial) → `IN_PROGRESS` (When workspace preparation starts).
*   **`IN_PROGRESS`** → `TESTING` (Triggered after agent completion detection).
*   **`TESTING`** → `AWAITING_APPROVAL` (If tests pass and approval request is sent).
*   **`TESTING`** → `ERROR` (If tests fail).
*   **`AWAITING_APPROVAL`** → `APPROVED` / `REJECTED` (Via user interaction in Slack/Email).
*   **`APPROVED`** → `COMPLETED` (After code is pushed to GitHub).
*   **`ERROR`** (Terminal state for any failure).

#### 2. Agent Queue State Machine (`QueueStatus.state`)
*   **`queued`** → `running` (When the agent claims the task from the queue).
*   **`running`** → `done` (Successful execution).
*   **`running`** → `failed` (Error during execution).
*   **`running`** → `stale` (If heartbeat stops for > TTL).

### C) Storage Layout (Paths + Examples)

Persistence is strictly **filesystem-based**. There is no database.

#### 1. Per-Task State Folder
Located inside each client's website repository:
*   **Root**: `{clientFolder}/.clickup-workflow/{taskId}/`
*   **`state.json`**: Current workflow state and metadata.
*   **`task-info.json`**: Cached ClickUp task data.

#### 2. Cursor Agent Workspace
Located inside each client's website repository:
*   **Root**: `{clientFolder}/.cursor/`
*   **`status/current.json`**: **Authoritative** real-time status file.
*   **`queue/`**: Contains `{id}_{taskId}.md` files (Instructions with YAML metadata).
*   **`running/`**: Contains the file currently being processed.
*   **`done/` / `failed/`**: Archived task files after completion/failure.
*   **`CURSOR_TASK.md`**: The prompt file generated for the Cursor Agent.

#### 3. Execution Logs
*   **Path**: `{clientFolder}/logs/tasks/{taskId}/`
*   **Contents**: `runner-{timestamp}.log`, `events.ndjson`, `test.log`.

### D) Status Schema (Key List)

#### `state.json` (Workflow State)
`taskId`, `state`, `clientFolder`, `branchName`, `createdAt`, `updatedAt`, `error`, `currentStep`, `command`, `metadata`, `baseCommitHash`, `agentCompletion` (sub-object with polling timestamps).

#### `current.json` (Agent Status)
`state` (`RUNNING`, `done`, `failed`), `percent`, `step`, `lastUpdate`, `notes` (string array), `errors` (string array), `task` (sub-object with `file`, `id`, `taskId`), `startedAt`, `lastHeartbeat`, `pid`.

### E) Unknowns
*   **Database**: None identified; persistence is 100% JSON on disk.
*   **State Persistence Across Restarts**: Approval requests (`ApprovalRequest`) are currently stored in an **in-memory map** (`approvalRequests` in `src/approval/approvalManager.ts`). They will be lost if the server restarts.
*   **Global Task View**: There is no central database for tasks across all clients; `src/utils/taskScanner.ts` crawls all `client-websites/` directories to build a list.

---

## 9. Queue/Concurrency + Status Streaming + Cleanup Analysis

The following is a code-first analysis of the agent queue, locking rules, status update pipeline, and cleanup mechanisms.

### A) Queue Mechanism Summary
The queue is a **file-based state machine** managed by the `AgentQueue` class (`src/cursor/agentQueue.ts`), moving `.md` task files between lifecycle directories within the `.cursor/` folder.

| Status | Directory | Action / Mechanism |
| :--- | :--- | :--- |
| **Queued** | `.cursor/queue/` | `enqueueTask()` writes a `{number}_{taskId}.md` file with YAML metadata. |
| **Running** | `.cursor/running/` | `claimNextTask()` renames the file from `queue/` to `running/`. Only **one** task is allowed in this folder at a time. |
| **Done** | `.cursor/done/` | `completeTask(success=true)` renames the file from `running/` to `done/`. |
| **Failed** | `.cursor/failed/` | `completeTask(success=false)` or stale detection renames the file to `failed/`. |

- **Transitions**: Every state change is performed via `fs.rename()`, which is atomic on the same filesystem.
- **Validation**: `validateTaskCreation()` explicitly rejects any attempt to create a task directly in the `running/` folder, enforcing the queue-first lifecycle.

### B) Locking + Concurrency Rules
Concurrency is handled through filesystem-level locks and strict single-task-at-a-time execution.

1.  **Atomic Locking**:
    - Uses directory creation (`fs.mkdir`) as a lock mechanism: `.cursor/claim.lock` for claiming and `enqueue.lock` for enqueuing.
    - **Retry Logic**: Retries up to 100 times with a random backoff (10-60ms) if `EEXIST` (lock exists) or `EPERM` (Windows file lock) occurs.
2.  **Concurrency Limit**:
    - Only **one** task is permitted in `.cursor/running/` at any time.
    - `claimNextTask()` checks if `running/` is non-empty. If so, it blocks new claims unless the existing task is detected as stale or finished.
3.  **Stale Detection**:
    - **TTL**: Tasks in `running/` older than `config.cursor.queue.ttlMinutes` (default 120) are moved to `failed/`.
    - **Heartbeat**: `AgentCompletionDetector` checks `.cursor/status/current.json` for a `lastHeartbeat`. If missing for >2 minutes, the task is considered hung.

### C) Status Pipeline (Writer → API → Frontend)
Status updates follow an **Atomic Write Pattern** to prevent the frontend from reading partially written JSON files.

1.  **Writer (Agent/Server)**:
    - Writes occur in `AgentQueue.updateStatus()` and by the agent itself (`cursorrules.template.md`).
    - **Pattern**: Write to `.cursor/status/tmp/current.[randomId].json` → `fs.rename` to `.cursor/status/current.json`.
    - On Windows, renames are retried up to 5 times to handle `EBUSY/EPERM` errors.
2.  **API**:
    - `GET /api/cursor/status`: Returns the content of `current.json`.
    - `GET /api/tasks/:taskId`: Uses `taskScanner.ts` to read the task's state and current step from `current.json`.
3.  **Frontend**:
    - `public/task.js`: Implements `startAutoRefresh()` which polls the API every **5 seconds** (if `in_progress`) or **3 seconds** (others).
    - It specifically monitors `status.state` and `status.step` to update progress bars and timeline icons.

### D) Cleanup Paths (Completion + Deletion)
Cleanup is split between **lifecycle completion** and **authoritative deletion**.

1.  **Lifecycle Completion** (`AgentQueue.completeTask`):
    - Moves the `.md` file to `done/` or `failed/`.
    - Updates `current.json` state to `done` or `failed`.
2.  **Authoritative Deletion** (`TaskCleanupService.deleteTaskArtifacts`):
    - **Queue Files**: Removes matching `{id}_{taskId}.md` from `queue/`, `running/`, `done/`, and `failed/`.
    - **Status**: Deletes `current.json` (only if it matches the taskId) and the task-specific status file.
    - **Logs**: Recursively deletes `logs/tasks/{taskId}/` and legacy `.cursor/logs/{taskId}.*`.
    - **Workspace**: Removes `.cursor/artifacts/{taskId}/` and the client's `.clickup-workflow/{taskId}/` state directory.
    - **Temp Files**: Cleans up any orphaned `current.*.json` in the `tmp/` folder.

### E) Known Failure Modes Found in Code
- **Cross-Filesystem Renames**: If `.cursor/` subdirectories are on different mount points, `fs.rename` fails (checked during initialization).
- **Windows File Locking**: `EPERM` or `EBUSY` during status updates or claiming (handled by retry loops).
- **Hung Agent**: A process that crashes without updating its state will remain in `running/` until the 2-minute heartbeat timeout or 120-minute TTL triggers a cleanup.
- **Lock Deadlock**: If a process crashes while holding a `.lock` directory, the queue is blocked until manual deletion or server restart.

### F) Unknowns
- **Multi-Server Safety**: The locking mechanism works for multiple processes on a single machine, but there is no mechanism for distributed locking across multiple server instances.
- **Process ID Tracking**: The code checks `lastHeartbeat` and `mtime`, but doesn't seem to verify if the OS PID of the agent is actually still alive.
- **Queue Priority**: While `TaskMetadata` includes a `priority` field, `claimNextTask()` currently sorts strictly by filename (timestamp/sequence prefix), potentially ignoring priority.

---

## 8. Runner + Cursor CLI Invocation Analysis

The following is a code-first analysis of how the Cursor CLI is invoked to execute tasks within the codebase.

### A) Trigger Path
The execution flow is triggered through a hierarchical chain of components:
1.  **Entry Point (UI/API)**: The process is usually initiated via the **"Run Agent"** button in the UI (`public/task.js`), which makes an API request to the backend.
2.  **Orchestrator**: `src/workflow/workflowOrchestrator.ts:processTask` coordinates the high-level workflow and calls `triggerCursorAgent`.
3.  **Workspace Manager**: `src/cursor/workspaceManager.ts:triggerCursorAgent` performs pre-flight setup (generating `CURSOR_TASK.md`, creating status directories) and then calls `triggerAgent`.
4.  **Agent Trigger**: `src/cursor/agentTrigger.ts:triggerAgent` is the final wrapper that imports and executes the runner.
5.  **Runner**: `src/cursor/runner.ts:CursorCliRunner.run()` is the implementation that performs the actual system spawn.

### B) Exact Cursor Command Patterns
The command construction varies based on whether WSL (Windows Subsystem for Linux) is enabled.

#### 1. Standard Pattern (Windows/Native)
```bash
cursor-agent chat "Open the CURSOR_TASK.md file and follow the instructions there." --force --output-format stream-json --stream-partial-output
```

#### 2. WSL Pattern (Windows with WSL enabled)
When `config.cursor.useWsl` is true, the command is wrapped in a WSL bash invocation:
```bash
wsl -d Ubuntu --cd /path/to/workspace bash -c "echo \"BASH_STARTING\"; export PATH=\"$HOME/.local/bin:$PATH\"; export CURSOR_API_KEY='[KEY]'; echo \"BASH_ENV_READY\"; exec \"~/.local/bin/cursor-agent\" 'chat' 'Open the CURSOR_TASK.md file and follow the instructions there.' '--force' '--output-format' 'stream-json' '--stream-partial-output'"
```

### C) Instruction Handoff Method
Instructions are passed using a **Hybrid Method**:
- **Command Argument (Primary)**: A standardized "Execution Prompt" is passed as the first argument to the `chat` command. This prompt acts as the "Master Instruction."
- **File-Based (Detail)**: The Master Instruction explicitly tells the agent to **"Open the CURSOR_TASK.md file and follow the instructions there."**
- **Preparation**: `src/cursor/workspaceManager.ts` ensures that `CURSOR_TASK.md` is generated and written to the workspace root before the CLI is ever invoked.

### D) Output Capture + Storage
- **Method**: Captured via `child_process.spawn` stdout and stderr streams.
- **Log File**: Every run generates a unique timestamped log file:
  `{workspacePath}/logs/tasks/{taskId}/runner-{timestamp}.log`
- **JSON Event Stream**: The `--output-format stream-json` flag causes the agent to emit JSON lines. The runner parses these in real-time (`runner.ts`).
- **Persistence**: 
    - Parsed events are stored via `TaskStatusManager.appendLog(taskId, event)`.
    - Stderr lines are stored via `TaskStatusManager.appendStderr(taskId, line)`.

### E) Env Vars Involved
The following environment variables are explicitly handled in `src/cursor/runner.ts`:
- **`CURSOR_AGENT_BIN`**: Used to override the default `cursor-agent` command name.
- **`CURSOR_API_KEY`**: Pulled from `config.cursor.apiKey` and exported to the process environment.
- **`PATH`**: In WSL mode, `$HOME/.local/bin` is prepended to ensure the `cursor-agent` binary is found.

### F) Unknowns / Observations
- **Retries**: There is **no automatic retry logic** within the `CursorCliRunner`. If the process fails (non-zero exit code), it transitions to a `FAILED` state and stops.
- **Timeouts**: Timeouts are handled via `setTimeout` and `SIGTERM`/`taskkill`.
- **Shell dependency**: On Windows, the runner defaults to `shell: true` unless in WSL mode, where it uses `shell: false`.
