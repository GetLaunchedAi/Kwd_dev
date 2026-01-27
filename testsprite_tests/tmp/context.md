Create Demo – Full Code Review & Fix Summary
Scope of Review

This thread covers a comprehensive, step-by-step code review of the entire “Create Demo” feature, spanning:

Backend demo creation logic

Agent orchestration, handoff, and completion detection

Frontend demo UI, polling logic, and dashboard pages

The goal was to identify functional bugs, logic errors, stuck-state risks, UI inconsistencies, and memory leaks, then fix the most critical issues while validating overall system correctness.

1. Create Demo Core Flow (Backend + Frontend)

A full walkthrough of the demo creation lifecycle (from API request → background processing → frontend progress display) was performed.

Bug found & fixed (frontend):

In create-demo.js, the retry/reset logic (showError handler) was missing the installing stage in the stages array.

When a demo failed during or after the installing step and the user clicked “Go Back to Form”, the UI would reset all other steps but leave installing stuck in its previous state.

Fix: Added installing to the stages array so all steps reset to pending consistently.

Validation of core logic:

Slug reservation via generateUniqueSlug() happens early, preventing collisions.

isDemoInActiveCreation() properly blocks concurrent demo creation for the same slug.

Directory cleanup includes retry logic to handle Windows file-lock issues.

Git initialization uses correct bot credentials and creates a clean repo state.

Frontend polling correctly handles deleted demos (404s) and cleans up localStorage on completion or failure.

Atomic writes, cache invalidation, and audit logs provide reliable demo state tracking.

Conclusion: Core demo creation logic is correct and robust after the UI stage reset fix.

2. Agent Handoff & Completion Pipeline

A deep inspection was done across:

agentTrigger.ts

workspaceManager.ts

agentQueue.ts

runner.ts

workflowOrchestrator.ts

agentCompletionDetector.ts

Critical bug found & fixed:

In agentTrigger.ts, the .catch() handler for async agent execution only logged errors.

If continueWorkflowAfterAgent() threw, the workflow state and demo status were never updated.

Result: demos could get permanently stuck in a “running” state with no UI feedback.

Fix implemented:

The error handler now:

Marks the workflow state as ERROR

Updates demo.status.json to failed for demo tasks

Ensures the frontend immediately reflects agent failures

Validation of remaining agent logic:

Directory-based queue locking prevents concurrent task collisions.

Agent completion is detected via explicit completion calls plus heartbeat-based stale detection (≈10 min timeout for demos).

agentQueue.completeTask() is called before workflow continuation, ensuring queue cleanup occurs reliably.

Step transitions preserve history and use unique taskId-stepN identifiers to avoid conflicts across multi-step demos.

Conclusion: After the fix, agent handoff and completion handling is resilient and failure-safe.

3. Frontend & Dashboard Review

The frontend was reviewed across:

app.js

create-demo.js

clients.js

task.js

reports.js

utils/api.js

Bugs found & fixed:

API client retry bug (utils/api.js)

The code claimed not to retry 4xx errors but actually retried them up to 3 times.

This caused unnecessary network calls and delayed error feedback.

Fix: Immediately throw on 4xx responses and skip retries entirely.

Memory leaks – clients page (clients.js)

previewPollingInterval and terminalUpdateInterval were not cleared on page unload.

This caused background polling to persist after navigation.

Fix: Added beforeunload cleanup logic.

Null reference crash – task page (task.js)

renderTaskDetails() accessed taskState.state.replace() without guarding against missing data.

Could crash if API responses were partial or malformed.

Fix: Added defensive checks for taskState and taskState.state.

Memory leaks – reports page (reports.js)

jobPollingIntervals were never cleared on unload.

Fix: Added cleanup logic to clear all active polling intervals.

Dashboard validation:

Re-render logic correctly uses deep equality checks to avoid unnecessary updates.

Terminal error states correctly stop polling.

HTML escaping is used consistently, reducing XSS risk.

localStorage usage for theme persistence and demo resumption is correct.

Conclusion: After fixes, the frontend and dashboard are stable, leak-free, and correctly reflect backend state.

Overall Outcome

After this review and set of targeted fixes:

The Create Demo feature is functionally sound end-to-end

Agent failures no longer leave demos stuck in limbo

Frontend UI state is consistent and reset correctly

Polling and background intervals are cleaned up properly

Error handling is faster, clearer, and more reliable

This system is now in a production-ready state with strong failure handling and clean lifecycle management across backend, agents, and frontend.