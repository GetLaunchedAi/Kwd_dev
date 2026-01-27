---
name: Integrate Client Previews into Dashboard
overview: This plan covers hardening the preview backend (port management, process cleanup) and integrating live preview controls into the frontend Clients page. It is structured for parallel execution by two agents.
todos:
  - id: reserve-ports-backend
    content: Update VisualTester port logic to skip 3000, 5173, 8080
    status: pending
  - id: process-cleanup-backend
    content: Install tree-kill and implement tree termination in VisualTester
    status: pending
  - id: frontend-card-template-ui
    content: Update clients.js card template with preview section HTML
    status: pending
  - id: frontend-state-polling-logic
    content: Implement preview state fetching and polling in clients.js
    status: pending
  - id: frontend-css-styles
    content: Add CSS styles for preview live/inactive states
    status: pending
  - id: frontend-action-handlers-logic
    content: Wire Start/Stop button event handlers to API endpoints
    status: pending
---

# Integrate Client Previews into Dashboard

This plan involves hardening the `VisualTester` backend and adding live preview controls to the frontend `clients.html` dashboard.

## Agent 1: Backend Hardening and Stability
Focuses on making the preview system robust, especially for Windows environments.

### 1. Reserve Ports and Refine Allocation
- Modify `findAvailablePort` in `src/utils/visualTesting.ts` to:
    - Set `basePort` to `8081`.
    - Skip reserved ports: `3000`, `5173`, `8080`.
    - Increase search range to ensure a port is always found.

### 2. Robust Process Cleanup (Windows Support)
- Install `tree-kill` dependency.
- Update `stopApp` and `stopAll` in `src/utils/visualTesting.ts` to use `tree-kill` for terminating the entire process tree (Shell -> Eleventy -> Node).
- Ensure `SIGINT`/`SIGTERM` in `src/server.ts` calls the updated `stopAll`.
- **Note**: Only processes started within the current session will be managed/closed. No proactive port-scanning or killing of existing processes on startup.

## Agent 2: Frontend Dashboard Integration
Focuses on the UI/UX of the Clients dashboard.

### 1. Update Client Card Template
- Modify `createClientCard` in `public/clients.js` to include a `.preview-section`.
- Add placeholders for:
    - Status Indicator (Live vs. Inactive).
    - Metadata (Port, Uptime).
    - Actions (Start/Stop button, Open link).

### 2. Implement Preview State Management
- Add `activePreviews` array to `public/clients.js`.
- Update `loadClients` to fetch `/api/previews` in parallel with `/api/clients`.
- Implement a 10-second polling interval to keep preview statuses fresh without a full page reload.

### 3. Add UI Styles
- Update `public/styles.css` with:
    - `.preview-section` styling (background, borders).
    - `.running` state for the section (green tint).
    - Button styles for Start (secondary) and Stop (danger).

### 4. Wire Action Handlers
- Add event delegation in `public/clients.js` to handle clicks on `.start-preview-btn` and `.stop-preview-btn`.
- Use the `api.post` helper from `public/utils/api.js` to call the backend endpoints.