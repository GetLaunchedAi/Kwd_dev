---
name: Git Configuration Guard for Demos
overview: Skip Git push during demo creation if global configuration is missing, using a bot fallback for local commits and notifying the frontend.
todos:
  - id: git-util-check
    content: Implement Git config check utility in repoManager.ts
    status: pending
  - id: backend-skip-push-logic
    content: Add skip-push logic and bot fallback to demoHandler.ts
    status: pending
  - id: frontend-warning-ui
    content: Update frontend to detect and display push-skip warnings
    status: pending
---

# Plan: Git Configuration Guard for Demos

This plan implements a safety check to prevent demo creation failures on machines without a configured Git user, while ensuring the user is notified that their changes were not pushed to a remote repository.

## 1. Backend: Git Utility & Handler Logic (Agent 1)

### [src/git/repoManager.ts](src/git/repoManager.ts)

- Add a helper `isGitConfigured()` that checks for `user.name` and `user.email`.

### [src/handlers/demoHandler.ts](src/handlers/demoHandler.ts)

- In `createDemo()`, check `isGitConfigured()`.
- If false:
- Set a `pushSkipped` flag.
- Set local repo config to "KWD Demo Bot" to prevent commit failure.
- Call `updateStatus` with a message containing "Warning: Push skipped due to missing Git config".
- Implement the actual push logic (if not skipped and remote URL exists).

## 2. Frontend: UI Notifications (Agent 2)

### [public/create-demo.js](public/create-demo.js)

- Update the status polling logic to detect "Warning" in the message.
- Display a persistent warning message in the UI if the push was skipped, even after the status reaches `completed`.

## 3. Communication & Synchronization

- Agent 1 must finish the `updateStatus` message format before Agent 2 can reliably detect it.
- Both agents should verify that the `demo.status.json` file on disk correctly reflects the skip state.