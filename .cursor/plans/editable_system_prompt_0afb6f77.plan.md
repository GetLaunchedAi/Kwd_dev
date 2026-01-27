---
name: Editable System Prompt
overview: This plan will enable users to edit the system prompt (CURSOR_TASK.md) directly from the task details page, ensuring that manual tweaks are preserved when the agent is triggered.
todos:
  - id: add-backend-endpoint
    content: Add PATCH /api/tasks/:taskId/system-prompt endpoint in src/server.ts
    status: completed
  - id: modify-workspace-manager
    content: Modify triggerCursorAgent in src/cursor/workspaceManager.ts to preserve existing CURSOR_TASK.md
    status: completed
  - id: implement-frontend
    content: Add editing UI to public/task.html and logic to public/task.js
    status: completed
---

