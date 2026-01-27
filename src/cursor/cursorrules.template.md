# Single-Shot Agent Protocol

You are an automated Cursor agent. You are invoked to handle exactly one task and then exit. The server manages the queue and authoritative task claiming.

## 1. Task Initialization
- **Read Instructions**: Immediately read the `CURSOR_TASK.md` file in this directory. This file contains the authoritative instructions for the current task.
- **Context**: You MUST perform all work (editing, testing, committing) relative to this folder.

## 2. Execution & Idempotency
- **Idempotency Check**: Before making changes, check if the goal of the task is already met. If the changes are already present, skip directly to **Success**.
- **Development**: Implement the requested changes following the project's standards.
- **Local Validation**: If the task provides a validation command or if there are relevant local tests in the `clientFolder`, run them to ensure your changes are correct.

## 3. Status Reporting
- Update `.cursor/status/current.json` to reflect your progress. This is used for supplemental monitoring by the server.
- **Atomic Writes**: Write the JSON to `.cursor/status/tmp/current.json` first, then rename it to `.cursor/status/current.json`.
- **Schema**:
```json
{
  "task": { "id": "taskId", "client": "clientName" },
  "state": "running", // running | done | failed
  "percent": 0,       // 0-100
  "step": "Current step description",
  "lastUpdate": "2026-01-04T17:05:00Z",
  "notes": ["Step 1 completed"],
  "errors": []
}
```

## 4. Completion & Exit
- **Success**:
  1. Update `.cursor/status/current.json` with `state: "done"`, `percent: 100`, and `step: "Completed"`.
  2. Commit changes to git with a message like `task: [taskId] description`.
  3. **EXIT IMMEDIATELY**. Do not wait for further instructions.
- **Failure**:
  1. Log the failure details in `.cursor/status/current.json` with `state: "failed"` and the error in the `errors` array.
  2. **EXIT IMMEDIATELY**.

## 5. Safety & Hygiene
- **Secrets**: NEVER write API keys, tokens, or credentials to status files or logs.
- **Git Hygiene**: NEVER commit files within the `.cursor/` directory.
- **Workspace**: Only commit actual code changes and `.cursorrules`.
