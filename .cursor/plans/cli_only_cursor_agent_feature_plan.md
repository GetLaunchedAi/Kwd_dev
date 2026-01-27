# CLI-Only Cursor Agent Feature — Implementation Plan (3 Parallel Tracks)

## Goal
Replace any “nudge an open Cursor instance” behavior with a **backend-driven Cursor CLI runner** that:
1) reliably runs `cursor-agent` headlessly in a repo workspace,  
2) streams real-time progress back to the dashboard (status + logs), and  
3) produces a reviewable diff + artifacts for approval.

## Non‑negotiables (what “CLI‑only” means)
- Backend **spawns `cursor-agent`** as a child process (no `.cursorrules` nudging; no dependency on an open Cursor UI).
- Completion is determined primarily by **process exit** (`0` = success, non‑zero = failure).
- Progress is shown by **parsing CLI stdout** and exposing it via status/log APIs to the dashboard.

---

## System Overview
**Frontend (Dashboard)**
- Triggers a run
- Shows progress + logs
- Shows diff + Approve/Reject actions

**Backend (Server)**
- Preps workspace and writes `CURSOR_TASK.md`
- Spawns `cursor-agent` via Cursor CLI
- Streams/parses output → writes status + logs
- Post-processes diff + summary
- Moves task to `AWAITING_APPROVAL` (or `FAILED`)

**Filesystem Artifacts (recommended)**
- `.cursor/status/<taskId>.json` — task-scoped live status
- `.cursor/logs/<taskId>.ndjson` — append-only raw/parsed events
- `.cursor/artifacts/<taskId>/` — diff patch, summary, test logs

---

## End-to-End Flow (Run Agent → Awaiting Approval)

### 1) Trigger (Frontend)
1. User clicks **Run Agent**.
2. Dashboard calls `POST /api/tasks/:taskId/run-cli-agent`.
3. UI switches to **Starting…** and polls `GET /api/tasks/:taskId/status` every ~3–5s (or uses SSE/WebSocket).

### 2) Task Prep (Backend)
1. Resolve correct repo + client folder for the task.
2. Ensure a clean workspace (recommended: per-task `git worktree` or explicit lock).
3. Write `CURSOR_TASK.md` into the correct client folder:
   - goal + acceptance criteria
   - constraints (no push, no secrets, run tests)
   - how to report status
   - definition of done
4. Set task state to `IN_PROGRESS` (or `QUEUED` then `IN_PROGRESS`).

### 3) Execute (Backend spawns Cursor CLI)
Backend starts `cursor-agent` as a subprocess with:
- print mode (non-interactive)
- writes enabled
- streaming machine-readable output (NDJSON)

Recommended command shape:
```bash
cursor-agent -p --force   --output-format stream-json   --stream-partial-output   "Read ./CURSOR_TASK.md and implement it. Run tests. Do NOT push. Summarize changes at the end."
```

### 4) Live Status + Logs (Backend → Dashboard)
- Backend reads stdout line-by-line (NDJSON).
- Each line:
  - attempt JSON parse; if parse fails, store as raw log line
  - write/append logs to `.cursor/logs/<taskId>.ndjson`
  - update `.cursor/status/<taskId>.json` (atomic write) with:
    - `state`, `step`, `notes`, `percent` (optional), `lastHeartbeat`, `pid`

Dashboard polls `/status` (and optionally `/logs`) to show progress in near real-time.

### 5) Completion Detection (CLI-only)
Primary completion signal:
- `cursor-agent` exits:
  - exit code `0` → success
  - non-zero → failure

### 6) Post-Processing & Review
On completion:
1. Update status JSON with `DONE`/`FAILED`, `exitCode`.
2. Generate Git diff from base ref to final state.
3. Save artifacts:
   - `diff.patch`
   - `summary.md`
   - optional test logs
4. Update task state:
   - success → `AWAITING_APPROVAL`
   - failure → `FAILED`
5. UI shows:
   - success/failure banner
   - changes summary + diff viewer + logs

### 7) Finalization (Human Approval)
- **Approve:** merge/push (or open PR) + mark ClickUp done
- **Reject:** keep artifacts, attach feedback, re-queue and rerun

---

## Status Contract (task-scoped; atomic writes)
Path:
- `.cursor/status/<taskId>.json`

Minimum schema:
```json
{
  "taskId": "123",
  "state": "STARTING|RUNNING|DONE|FAILED",
  "percent": 0,
  "step": "Implementing ...",
  "notes": "Latest note ...",
  "startedAt": "ISO",
  "lastHeartbeat": "ISO",
  "pid": 12345,
  "exitCode": null,
  "error": null
}
```

Atomic write rule:
- write to temp (e.g., `.tmp`) then rename to final filename.

Logs:
- `.cursor/logs/<taskId>.ndjson` (append each parsed JSON event or raw line wrapper)

---

# Parallel Work Plan — 3 Tracks

## Track A — CLI Runner + Process Orchestration (Agent A)
### Goal
Implement the module that spawns `cursor-agent`, streams output, and returns completion results.

### Tasks
- Build a `CursorCliRunner`:
  - constructs args (print mode + force + stream-json + stream-partial-output)
  - spawns process with `cwd = workspacePath`
  - streams stdout line-by-line
  - streams stderr line-by-line
  - exposes callbacks: `onEvent(line|obj)`, `onStderr(line)`, `onExit(exitCode)`
- Handle lifecycle:
  - timeout/max runtime
  - cancellation (SIGTERM → SIGKILL fallback)
  - non-JSON output resilience (don’t crash; forward as raw logs)

### Outputs / Contract
- Inputs: `taskId`, `workspacePath`, `prompt`, `env`
- Outputs: `pid`, streamed events, and final `{ exitCode, signal, duration }`

---

## Track B — Status + Logs Pipeline + APIs (Agent B)
### Goal
Turn runner output into task-scoped status + logs and expose it to the UI.

### Tasks
- Implement status writer:
  - `.cursor/status/<taskId>.json` (atomic writes)
  - update `lastHeartbeat` on any output
  - map events → `step/notes/percent` (best effort)
- Implement log appender:
  - `.cursor/logs/<taskId>.ndjson` append-only
  - store parsed events and raw lines
- Implement APIs:
  - `GET /api/tasks/:taskId/status`
  - `GET /api/tasks/:taskId/logs?tail=200`
  - optional: SSE endpoint for streaming updates

### Outputs / Contract
- Consumes Track A callbacks
- Returns JSON payloads used directly by the dashboard

---

## Track C — Workspace Prep + Post-Processing + Approval Artifacts (Agent C)
### Goal
Own everything around the run: workspace isolation, instruction file, diffs, and approval artifacts/state transitions.

### Tasks
- Workspace isolation:
  - per-task `git worktree` or branch clone
  - record `baseCommit` for diff generation
- Instruction generation:
  - write `CURSOR_TASK.md` into the correct client folder
  - embed acceptance criteria + constraints + done conditions
- Post-processing:
  - generate diff from `baseCommit` to final
  - write `.cursor/artifacts/<taskId>/diff.patch`
  - write `.cursor/artifacts/<taskId>/summary.md`
  - optionally run tests and store logs
- State transitions:
  - success → `AWAITING_APPROVAL`
  - failure → `FAILED`
- Optional queue markers (if using a filesystem queue):
  - `.cursor/queue` → `.cursor/running` → `.cursor/done|failed`

### Outputs / Contract
- Provides Track A: `workspacePath`, `prompt`, `CURSOR_TASK.md` location
- Provides Track B: artifact paths (diff/summary) for UI display

---

## Integration Notes (how tracks connect cleanly)
- Track C prepares the workspace + instructions and provides `workspacePath` + `baseCommit`.
- Track A runs `cursor-agent` and emits streamed output + exit code.
- Track B maps streamed output into `.cursor/status/<taskId>.json` + logs and exposes read endpoints.
- Track C uses the exit code + baseCommit to generate diffs and updates the task state for approval.

## Definition of Done
- Clicking **Run Agent** starts a CLI run without requiring an open Cursor UI.
- Status JSON updates while the run is active.
- Logs are persisted and retrievable.
- Exit code sets final state and triggers diff generation.
- UI can show a changes summary/diff and allow Approve/Reject.
