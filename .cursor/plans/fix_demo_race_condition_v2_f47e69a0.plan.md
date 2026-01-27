---
name: Fix Demo Race Condition v2
overview: Resolve demo step race conditions with unique step IDs and explicit resets, while mitigating risks to dashboard visibility and external integrations.
todos:
  - id: cleanup-test-dir
    content: Delete client-websites/sunny-side-bakery15/ directory
    status: pending
  - id: add-reset-status
    content: Add resetStatus method to TaskStatusManager in src/cursor/taskStatusManager.ts
    status: pending
  - id: harden-completion-detector
    content: Add taskId validation to checkStatusFile in src/cursor/agentCompletionDetector.ts
    status: pending
  - id: update-orchestrator-logic-v2
    content: Implement unique step IDs and fail-hard logic in src/workflow/workflowOrchestrator.ts while preserving parentTaskId for external calls
    status: pending
  - id: integrate-reset-lifecycle-v2
    content: Integrate status reset into triggerCursorAgent in src/cursor/workspaceManager.ts
    status: pending
---

# Plan: Resolve Demo Step Transition Race Condition (Updated)

This plan fixes the issue where demo steps are skipped because the completion detector incorrectly identifies a previous step's "DONE" state as the current step's completion.

## 1. Cleanup

- Delete the test directory `client-websites/sunny-side-bakery15/`.

## 2. Implement Status Reset Logic

- Update [`src/cursor/taskStatusManager.ts`](src/cursor/taskStatusManager.ts) to add a `resetStatus(taskId: string)` method that deletes the `.cursor/status/current.json` file.
- This ensures that any new agent run starts without stale data from previous steps.

## 3. Harden Completion Detector

- Update [`src/cursor/agentCompletionDetector.ts`](src/cursor/agentCompletionDetector.ts) to verify that `status.taskId` matches the `taskId` being polled.
- If the IDs do not match, the detector should treat the task as "not yet started" even if the file exists and shows "DONE".

## 4. Implement Unique Step IDs and Strict Transitions

- Update [`src/workflow/workflowOrchestrator.ts`](src/workflow/workflowOrchestrator.ts):
    - In `handleDemoStepTransition`, generate a unique ID for the next step (e.g., `${taskId}-step${nextStep}`).
    - **CRITICAL**: Ensure all external calls (ClickUp, Slack, Email) continue to use the *original* `taskId` so they link correctly to the parent task.
    - Modify the transition logic to **throw an error** if a step cannot be triggered, preventing the workflow from silently proceeding to the next step.
- Update [`src/cursor/workspaceManager.ts`](src/cursor/workspaceManager.ts) to call `taskStatusManager.resetStatus()` at the beginning of `triggerCursorAgent()`.

## 5. Potential Edge Cases & Unintended Consequences

### Dashboard and UI Visibility

- **Risk**: The dashboard or log viewer might expect a single `taskId`. Using unique IDs per step could cause steps to appear as separate, disconnected tasks.
- **Mitigation**: Ensure the unique IDs share the same prefix (the original `taskId`) so UI filters can still group them.

### Artifact Management

- **Risk**: `saveArtifact` uses `taskId` to determine folder paths. Changing the ID for each step will scatter artifacts across multiple folders (e.g., `logs/tasks/taskId-step1`, `logs/tasks/taskId-step2`).
- **Mitigation**: Verify that the `ChangeSummarizer` and other artifact-consuming tools can either handle multi-folder retrieval or that we explicitly pass the `parentTaskId` for artifact storage.

### Resuming Tasks After Crash

- **Risk**: `resumeActiveDetections` scans for `IN_PROGRESS` tasks. If a task crashes mid-step, the resume logic must correctly identify which step-specific ID it needs to poll.
- **Mitigation**: Ensure `saveTaskState` stores the *current* unique ID being used by the agent, not just the parent ID.

### ClickUp Communication

- **Risk**: Posting comments using a step-specific ID (e.g., `demo-bakery-step3`) to ClickUp will fail because ClickUp only knows about the parent ID.
- **Mitigation**: The Orchestrator must maintain a clear distinction between the `agentRunId` (step-specific) and the `externalTaskId` (ClickUp).

## 6. Verification

- Verify that the logs for each step now reside in unique directories within `logs/tasks/`.
- Confirm that the status file is correctly cleared between steps.
- Ensure ClickUp comments are still posted correctly to the original task.