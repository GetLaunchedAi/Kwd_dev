---
name: Demo_UI_Revamp_Approval_Publish_3Tracks
overview: "Revamp `public/demo.html` and `public/create-demo.html` to provide robust live updates, and implement a full demo approval workflow: approve → create GitHub repo in configured org + push; reject → close/delete task + delete demo folder; request changes → enqueue a revision task with feedback."
todos:
  - id: trackA-contracts
    content: Define shared status + endpoint contracts in a short doc comment and align UI states for create-demo and demo pages.
    status: completed
  - id: trackA-ui
    content: Revamp `public/demo.html|.js` and `public/create-demo.html|.js` with unified live-updates widget, 3-way approval UX, and resilient rendering.
    status: completed
  - id: trackA-settings
    content: Add GitHub Org section to `public/settings.html|.js` and wire it to `/api/settings`.
    status: completed
  - id: trackB-endpoints
    content: Implement demo reject + request-changes endpoints and connect them to queue/task cleanup with idempotency + Windows-safe deletion.
    status: completed
  - id: trackB-approval-hooks
    content: Update demo approval semantics so final approval triggers publish flow (or calls publish endpoint) and intermediate approvals keep step advance.
    status: completed
  - id: trackC-config
    content: Add `git.githubOrg` to config types + example config; update `/api/settings` to persist it.
    status: completed
  - id: trackC-publish
    content: Implement GitHub org repo creation + push (PAT) with progress logs and retryable push behavior.
    status: completed
---

## Scope (pages + workflows)

- Pages in scope:
- `public/create-demo.html` + `public/create-demo.js`
- `public/demo.html` + `public/demo.js`
- `public/settings.html` + `public/settings.js` (add GitHub org setting)
- Backend in scope:
- Demo lifecycle + status: `src/handlers/demoHandler.ts`
- Demo approval endpoints + task queue behavior: `src/server.ts`, `src/workflow/workflowOrchestrator.ts`
- Git/GitHub helpers: `src/git/*.ts`
- Settings persistence: `src/server.ts` (`/api/settings`)

## Shared “contract” between tracks (define first; then implement)

### Status model (frontend must tolerate unknown/new states)

- Extend demo status (`demo.status.json` via `DemoStatusManager`) with additional states:
- `publishing` (creating repo, setting remote, pushing)
- `published` (repo created + push success; include repo URL)
- `rejected` (only briefly; hard-delete will then remove status)
- `revision_queued` / `revision_running` (optional but recommended for clarity)
- Frontend rules:
- Treat unknown `state` as “Unknown/Idle” with diagnostics.
- Render `message`, `updatedAt`, and a bounded log feed even if other fields missing.

### API endpoints (new/adjusted)

- **Settings**
- Extend existing `GET/POST /api/settings` in `src/server.ts` to include:
- `gitHubOrg` (stored as `config.git.githubOrg`)
- **Demo publishing**
- New endpoint: `POST /api/demos/:clientSlug/publish`
- Requires configured org + `config.git.githubToken`
- Returns `{ success, repoUrl, repoFullName }` and streams progress through demo status logs.
- **Demo rejection**
- New endpoint: `POST /api/demos/:clientSlug/reject`
- Hard-delete: stop/kill queue + delete task state + delete `client-websites/<slug>`.
- **Demo revision (“request changes”)**
- New endpoint: `POST /api/demos/:clientSlug/request-changes` with `{ feedback: string }`
- Creates a *new queued task* (new taskId) tied to the same folder.
- Stores feedback, patches prompt, and triggers/queues the agent.

### Task ID conventions (to avoid collisions/race conditions)

- Base: `demo-<slug>`
- Steps already exist: `demo-<slug>-step2..step4`
- Revisions (new): `demo-<slug>-rev<NN>` (NN increments, persisted in demo context/state)

## 3 Parallel Tracks (agents can work simultaneously)

### Track A — UI/UX revamp + “robust updates” on the pages (frontend-only)

**Primary files**: `public/demo.html`, `public/demo.js`, `public/create-demo.html`, `public/create-demo.js`, `public/styles.css`, `public/utils/*`, `public/settings.html`, `public/settings.js`

**Goals**

- Make every feature on both pages readable, consistent, and resilient to partial/late data.
- Upgrade “updates” from basic polling to a unified live-updates experience.

**Work items**

- Create a consistent “Task/Demo status header” component used in both pages:
- Connection status (server online/offline)
- Current state badge (supports new states like `publishing`)
- “Last updated” timestamp + stale indicator (e.g., >30s without update)
- Explicit “Live updates: On/Off” toggle
- Replace fragile polling-only flows with a **dual-mode updater**:
- Prefer SSE for: logs/events/status (leveraging existing `/api/tasks/:taskId/events/stream` in `src/server.ts`)
- Fall back to polling if SSE fails.
- `create-demo.html`:
- Make the approval panel actionable and informative:
- Show when `awaiting_approval` vs `completed`.
- Add explicit 3-button decision: **Approve & Publish**, **Request Changes**, **Reject Demo**.
- Improve progress section:
- Don’t “jump backward” (already partially handled by `lastProgressPercent`)
- If status is stale/unknown, show recovery actions: “Reconnect”, “Open Demo Details”, “View logs”.
- `demo.html`:
- Harmonize the 2 approval areas (Step approval + final demo publish):
- If `currentStep < totalSteps`: show “Approve Step” + “Request Changes (step)”
- If final step done: show “Approve & Publish” + “Request Changes (revision)” + “Reject Demo”
- Improve logs/events viewer:
- Virtualize long lists, cap at N entries with “Load more”.
- Add filters (errors/warnings/tool calls) and search.
- Screenshots section:
- Gracefully handle missing manifests, missing iterations, and show “screenshot capture failed” using the state fields already written by `workflowOrchestrator.ts`.
- `settings.html`:
- Add a “GitHub Publishing” section:
- `GitHub Org` input (org login)
- Inline validation rules (no spaces, GitHub slug format)
- Warning if missing PAT on server (generic: “server not configured”)—don’t expose secrets.

**Frontend edge cases & side effects to handle**

- Browser reload/resume:
- `create-demo.js` already uses `localStorage.activeDemoSlug`; extend to resume SSE and/or polling safely.
- Multiple tabs open:
- Avoid double-SSE connections spamming server; back off if another tab is active.
- Status “stuck”:
- Show stale badge; provide “Kill demo” and “Run queue health check” links (if backend exposes).
- Huge logs:
- Prevent UI freezes; bounded rendering and request paging.
- Accessibility:
- Keyboard reachable controls, ARIA labels for icon-only buttons, focus management for modals.

### Track B — Demo workflow semantics + queue/task lifecycle (backend + API)

**Primary files**: `src/server.ts`, `src/handlers/demoHandler.ts`, `src/workflow/workflowOrchestrator.ts`, `src/cursor/*`, `src/utils/taskScanner.ts`

**Goals**

- Implement the required behavior:
- Approve → publish
- Reject outright → kill + delete task + delete folder
- Request changes → create a new queued revision task
- Ensure race-safe transitions and idempotency.

**Work items**

- Add new endpoints in `src/server.ts`:
- `POST /api/demos/:clientSlug/reject`
- Steps:
- Validate demo exists.
- Stop preview app (already done in `createDemo` cleanup logic via `visualTester.stopApp`).
- Call existing kill logic (`/api/tasks/:taskId/kill` internal helper or extracted service).
- Delete task state + artifacts (reuse `taskCleanupService.deleteTaskArtifacts`).
- Delete folder `client-websites/<slug>` with Windows-safe retries (similar to `createDemo` cleanup).
- Clear `demo.status.json` / cache.
- `POST /api/demos/:clientSlug/request-changes` `{ feedback }`
- Validate feedback length.
- Generate new revision taskId `demo-<slug>-revN`.
- Persist revision metadata into `demo.context.json` (e.g. `revisionCount`, `lastFeedback`).
- Patch prompt (reuse `patchPromptWithFeedback` or create a demo-specific patcher).
- Queue agent run using `triggerCursorAgent(demoDir, mockTask)`.
- Update demo status to `revision_queued`/`running` and include the revision taskId in status.
- Adjust existing `POST /api/tasks/:taskId/approve` behavior for demos:
- If not final step: keep existing step advancement.
- If final step: set demo status to `awaiting_publish` or directly call publish endpoint logic.

**Backend edge cases & side effects to handle**

- Idempotency:
- Reject endpoint should be safe to call twice (second call returns 404 or “already deleted”).
- Request-changes should de-dup if same feedback submitted twice quickly (store last request hash + timestamp).
- Race conditions:
- Demo step transitions already have locking/guards in `workflowOrchestrator.ts`; revisions must not conflict with step transitions.
- If agent is running, reject should either (a) refuse with 409, or (b) force-kill and then delete. Prefer force-kill with clear status updates.
- Windows file locks:
- Use retry loops for directory deletion (similar to `createDemo` cleanup around `fs.remove`).
- Queue side effects:
- Ensure revision tasks don’t block unrelated tasks indefinitely; respect existing queue TTL.
- State consistency:
- Always update `demo.status.json` / TaskStatusManager before and after long operations so the UI can show progress.

### Track C — GitHub org publishing (settings + repo creation + push)

**Primary files**: `src/server.ts` (`/api/settings`), `src/config/config.ts` types, `config/config.example.json`, new helper under `src/git/` (or `src/github/`)

**Goals**

- On final approval, create a GitHub repo named `<slug>` in the configured org and push the demo repo.

**Work items**

- Extend config schema:
- Add `git.githubOrg?: string` to `ClickUpConfig` typings in `src/config/config.ts` (under `GitConfig`).
- Add `githubOrg` to `config/config.example.json`.
- Extend `GET/POST /api/settings` in `src/server.ts` to read/write `git.githubOrg`.
- Implement GitHub repo creation + push:
- Create a backend service function `publishDemoToGitHubOrg({ clientSlug })` that:
- Reads org from config.
- Uses PAT from `config.git.githubToken`.
- Creates repo via GitHub REST API (name: slug) and returns `html_url`.
- Adds `origin` remote to the demo repo in `client-websites/<slug>` and pushes `config.git.defaultBranch`.
- Writes demo status transitions: `publishing` → `published` and logs each step.
- Wire `publishDemoToGitHubOrg` into:
- Final approval path (`POST /api/tasks/:taskId/approve` when demo final step), or
- Explicit `POST /api/demos/:clientSlug/publish` (called by UI).

**GitHub edge cases & side effects to handle**

- Repo name collision in org:
- If `<slug>` already exists: decide policy (default: fail with clear error and suggest `slug-xxxx`).
- Token permissions:
- If PAT lacks org repo creation perms: fail fast with actionable message (“token needs repo + org permissions”).
- Network flakiness:
- Retry create/push with backoff; ensure status logs show retries.
- Partial success:
- Repo created but push failed → status should expose repo URL and allow “Retry push” without recreating repo.
- Security:
- Never return/store the token in frontend; only store org name in Settings.

## Verification (after implementation)

- Manual test flows:
- Create demo → watch live updates → reach `awaiting_approval`.
- Approve & Publish → repo created in org, remote set, push succeeds, UI shows repo URL.
- Request Changes (with feedback) → new revision task appears/runs and updates UI.
- Reject Demo → demo task disappears and folder is deleted; UI handles 404 cleanly.
- Regression checks:
- Existing non-demo task approval flow still works (`completeWorkflowAfterApproval`).
- Existing demo step transitions still work (`handleDemoStepTransition`).