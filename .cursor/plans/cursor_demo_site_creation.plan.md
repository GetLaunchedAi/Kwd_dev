# Cursor-Powered Demo Site Creation — Implementation Plan (Working v1)

## Your request

**Go over the plan again and make sure it is clear and will produce a working result and send me a markdown file that I can download with it.**

---

## Goal

Enable users to create a customized demo website by submitting business details + brand assets. The system will:

1. Receive business info + images (logo + hero).
2. Clone a selected template repo into `client-websites/<client-slug>/`.
3. Normalize the cloned template into a predictable structure.
4. Generate a demo-specific `CURSOR_TASK.md` (and context/status files).
5. Trigger the Cursor CLI agent to intelligently update typography, colors, text, and image usage.
6. Provide UI feedback (basic progress + optional polling).

This plan is designed to produce a **working end-to-end** result on the first iteration.

---

## Final Result (What “working” means)

### ✅ When complete, the system supports:

- A UI page at `/create-demo.html` that submits a demo creation request.
- An API endpoint `POST /api/demo/create` that:
  - validates input
  - creates the demo folder
  - clones the template
  - places assets
  - writes `demo.context.json`, `demo.status.json`, and demo `CURSOR_TASK.md`
  - triggers Cursor agent
  - returns JSON with the new demo folder + status
- A demo site created at:
  - `client-websites/<client-slug>/` (Eleventy template clone + edits)
- Status tracking written to:
  - `client-websites/<client-slug>/demo.status.json`

---

## Folder Layout (Expected)

After creation:

```
client-websites/
  <client-slug>/
    src/
      _data/
      assets/
        images/
          logo.(png|jpg|svg)
          hero.(png|jpg|svg)
    demo.context.json
    demo.status.json
    CURSOR_TASK.md
    ...
```

---

## API Contract

### POST `/api/demo/create`

**Content-Type:** `multipart/form-data`

**Fields (text):**

- `businessName` (required)
- `clientSlug` (required)
- `email` (optional)
- `phone` (optional)
- `address` (optional)
- `primaryColor` (required, hex)
- `secondaryColor` (optional, hex)
- `fontFamily` (optional string, e.g. `"Montserrat"`)
- `templateId` (required, e.g. `modern` / `trade`)

**Files:**

- `logo` (optional)
- `heroImage` (optional)

**Response (200):**

```json
{
  "success": true,
  "clientSlug": "sample-plumbing",
  "demoPath": "client-websites/sample-plumbing",
  "status": "queued",
  "message": "Demo created and Cursor agent triggered."
}
```

**Response (4xx/5xx):**

```json
{ "success": false, "error": "Meaningful message here" }
```

---

## Status Tracking (Enables “progress” without overbuilding)

To support UI progress, write status updates to `demo.status.json` at each phase:

**Example:**

```json
{
  "state": "cloning | organizing | prompting | triggering | running | completed | failed",
  "message": "Human-readable status",
  "updatedAt": "2026-01-07T18:00:00-05:00"
}
```

### Optional but recommended endpoint for the UI

Add `GET /api/demo/status/:clientSlug` to read and return `demo.status.json` (or 404 if not found).

This makes progress updates reliable without SSE/websockets.

---

## Template Selection (Security + Predictability)

**Do not accept arbitrary repo URLs from the browser.**

Instead, map `templateId` → `repoUrl` on the server.

Example:

```ts
const TEMPLATE_MAP = {
  modern: "https://github.com/your-org/template-1",
  trade: "https://github.com/your-org/template-2"
};
```

---

## Three-Agent Implementation Plan (Parallel-safe)

### Agent 1 — Backend Infrastructure

**Purpose:** Add upload handling + API route wiring.

**Primary changes**

- Add multer configuration (disk storage to `temp-uploads/`)
- Register:
  - `POST /api/demo/create`
  - (recommended) `GET /api/demo/status/:clientSlug`
- Validate required fields early
- Call `createDemo(body, files)` from the handler

**Files**

- Modify: `src/server.ts`

**Dependencies**

- `multer`, `@types/multer`

**Working Definition**

- Endpoint accepts payload and successfully calls the handler.
- Returns meaningful errors if validation fails.

---

### Agent 2 — Core Orchestration + Cursor Trigger

**Purpose:** Clone template, place assets, generate prompt files, trigger Cursor.

**Primary changes**

- Create `src/handlers/demoHandler.ts`
- Implement `createDemo(data, files)`:

  1. Normalize + validate slug
  2. Prevent collisions in `client-websites/`
  3. Clone template repo into target
  4. Remove `.git`
  5. Ensure required directories exist
  6. Move uploaded files into deterministic paths
  7. Write `demo.context.json` + `demo.status.json` (update per stage)
  8. Load `prompts/demo_creation.md`, replace placeholders, write demo `CURSOR_TASK.md`
  9. Trigger Cursor via `triggerCursorAgent(targetDir, ...)` (using your existing workflow)
  10. Update status to `running` / `triggering`

**Files**

- Create: `src/handlers/demoHandler.ts`

**Important behavior**

- Always update `demo.status.json` as you progress.
- Clean up temp uploads after move.
- Add a `.demo.lock` (optional) to avoid double-submits.

---

### Agent 3 — Prompt Template + Frontend UI

**Purpose:** Add prompt template and a usable create-demo page.

**Primary changes**

- Create prompt file: `prompts/demo_creation.md`
- Create UI: `public/create-demo.html`
- Create JS: `public/js/create-demo.js`
- Add nav link: `public/index.html`

**UI behavior (working v1)**

- Submit multipart form to `/api/demo/create`
- Show immediate client-side steps:
  - Uploading…
  - Creating demo…
  - Success / error
- If `GET /api/demo/status/:clientSlug` exists:
  - Poll every 1–2s and display real backend phase updates

---

## Prompt Template Requirements (Important for reliable AI edits)

Your `prompts/demo_creation.md` should explicitly instruct Cursor:

**Must do**

- Update brand colors + typography using existing project patterns
- Update business name + contact info using the provided context
- Replace hero + logo usage with the uploaded asset paths
- Keep edits within site content/styling files only

**Must NOT do**

- Do not modify build config, package.json, deployment scripts
- Do not add dependencies
- Do not invent claims, reviews, or statistics

**Suggested scope restriction**

- Only modify: `src/**` and template content files
- Avoid: `package.json`, `.github/`, deployment files

---

## Implementation Sequence (to produce a working result)

1. **Install deps**

   - `npm i multer`
   - `npm i -D @types/multer`
   - (verify `simple-git` and `fs-extra` are already installed; if not, install them)

2. **Agent 1**

   - multer + route(s) in `src/server.ts`

3. **Agent 3 (part 1)**

   - add `prompts/demo_creation.md`
   - add `public/create-demo.html`

4. **Agent 2**

   - implement `src/handlers/demoHandler.ts`
   - confirm it writes:
     - `demo.context.json`
     - `demo.status.json`
     - demo `CURSOR_TASK.md`
   - confirm it triggers Cursor

5. **Agent 3 (part 2)**

   - implement `public/js/create-demo.js`
   - add nav link in `public/index.html`

6. **Integration test**

   - Create demo for: **Sample Plumbing**
   - Ensure folder appears under:
     - `client-websites/sample-plumbing/`
   - Ensure `demo.status.json` updates
   - Ensure Cursor agent triggers and performs edits

---

## Key Edge Cases Covered by This Plan

- **Slug collisions / unsafe slugs** → normalized + checked
- **Template missing expected folders** → normalization step creates them
- **Large images / wrong file type** → multer limits + clear errors
- **Double submit** → optional lock file, status file existence check
- **Agent partial failure** → status reflects failed state; folder remains inspectable
- **Template drift** → server-side template map avoids arbitrary repos

---

## Acceptance Checklist

- [ ] `/create-demo.html` loads and submits successfully
- [ ] `POST /api/demo/create` creates a new folder under `client-websites/`
- [ ] Assets are placed in `src/assets/images/`
- [ ] `demo.context.json` + `demo.status.json` exist
- [ ] `CURSOR_TASK.md` exists in the demo folder and includes correct placeholders replaced
- [ ] Cursor agent trigger is called
- [ ] UI displays success/error and (optionally) status polling

---

## Notes (Keep it shippable)

This is intentionally a **v1** that avoids overbuilding:

- Polling status via `demo.status.json` is simpler than SSE/websockets.
- Template selection is locked down via `templateId` mapping for safety.
- Normalization + context files make the AI edits reliable.