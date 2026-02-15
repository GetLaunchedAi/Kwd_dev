# Product Requirements Document: KWD Dev Automation Suite

**Author:** Senior Product Manager  
**Date:** January 9, 2026  
**Status:** Final Draft

---

## 1. Product Overview
### Product Name
**KWD Dev (Killer Website Design Development Suite)**

### One-Sentence Value Proposition
An automated AI-driven orchestration platform that transforms ClickUp project requirements into production-ready website code through Cursor agent integration, automated testing, and human-in-the-loop approvals.

### Primary User Personas
1.  **Project Manager (PM):** Wants to track task progress in ClickUp and review AI-generated changes without touching code. Goal: Reduce time-to-delivery for client updates.
2.  **Web Developer / Senior Engineer:** Wants to automate repetitive coding tasks (branding, basic features) while maintaining control over the final merge. Goal: Focus on high-value architectural tasks.
3.  **Client / Stakeholder:** Wants to see live previews of requested changes and approve them quickly. Goal: High transparency and fast feedback loops.

### Core Problems Solved
*   **Manual Translation:** Eliminates the manual work of translating ClickUp tickets into code changes.
*   **Context Switching:** Automates the setup of local environments, branching, and agent prompts for every task.
*   **Quality Assurance Lag:** Automatically runs tests and provides visual previews before human review.
*   **Scale:** Allows a small team to manage hundreds of client websites simultaneously by leveraging AI agents.

---

## 2. Goals & Non-Goals
### Goals
*   **Business:** Reduce website demo creation time by 80% and maintenance overhead by 50%.
*   **User:** Provide a "one-click" workflow from ClickUp task to GitHub pull request.
*   **Technical:** Create a robust, scalable queueing system for AI agents that can handle concurrent tasks across diverse tech stacks.

### Non-Goals
*   **Full Autonomy:** The system is *not* intended to ship code without human approval (v1).
*   **CMS Replacement:** This is a developer tool, not a drag-and-drop website builder for non-technical clients.
*   **Generic AI Assistant:** It is specifically optimized for web development workflows, not general-purpose coding.

---

## 3. High-Level Architecture
### Tech Stack
*   **Frontend:** React/TypeScript Dashboard (served from `/public` via Express).
*   **Backend:** Node.js / Express with TypeScript.
*   **Storage:** Local JSON-based persistence (`src/storage/jsonStore.ts`) for state, artifacts, and configuration.
*   **Infrastructure:** Local execution environment with support for `ngrok` (for webhooks) and `multer` (for file uploads).

### Third-Party Integrations
*   **ClickUp:** Primary source of truth for tasks and triggers via Webhooks and REST API.
*   **GitHub/Git:** Repository management, branching, and automated pushing.
*   **Cursor / VS Code:** Execution engine for AI agents via CLI wrappers.
*   **Slack/Email:** Notification services for approvals and alerts.

### Auth & Permissions Model
*   **OAuth 2.0:** Specifically for ClickUp integration.
*   **Session Management:** Token-based sessions for the local dashboard.
*   **Role-Based Access:** 
    *   *Admin:* Can configure system settings, tokens, and global mappings.
    *   *Reviewer:* Can approve/reject changes and view diffs.

---

## 4. Core Modules

### 4.1 Demo Generation Module
#### Purpose
Bootstrapping new client websites from templates or existing repositories with custom branding applied.

#### User Stories
1.  As a PM, I want to provide a business name and primary color so that a basic website structure is generated automatically.
2.  As a PM, I want to upload a logo and hero image to ensure the demo matches the client's brand immediately.
3.  As a PM, I want to check slug availability so I don't overwrite existing client sites.

#### Functional Requirements
*   **Slug Generation:** Automatically generate unique, URL-friendly slugs from business names.
*   **Cloning:** Support cloning from a "Template" repo or a specific GitHub URL.
*   **Asset Management:** Handle multi-part uploads (logo, hero) and store them in `temp-uploads`.
*   **Validation:** Hex code validation for colors and regex validation for slugs.

#### Data Models
```typescript
interface DemoRequest {
  businessName: string;
  clientSlug: string;
  templateId?: string;
  githubRepoUrl?: string;
  primaryColor: string;
  logo?: string; // Path to uploaded file
  heroImage?: string; // Path to uploaded file
}
```

#### API Endpoints
*   **POST `/api/demo/create`**
    *   **Body:** Form-data (businessName, clientSlug, etc.).
    *   **Response:** `{ success: true, clientSlug: string, status: 'starting' }`
*   **GET `/api/demo/status/:clientSlug`**
    *   **Response:** Progress details (e.g., "Cloning", "Branding", "Complete").

---

### 4.2 Workflow Orchestrator
#### Purpose
Managing the lifecycle of a task from ClickUp ingestion to GitHub deployment.

#### User Stories
1.  As a system, I want to detect a ClickUp status change and automatically start the developer workflow.
2.  As a PM, I want the system to automatically create a Git branch named after the ClickUp task ID.
3.  As a system, I want to feed the ClickUp task description and client context into the Cursor agent.

#### Functional Requirements
*   **Queueing:** Manage an `agentQueue` to ensure controlled concurrent execution.
*   **State Machine:** Track states: `PENDING` -> `IN_PROGRESS` -> `TESTING` -> `AWAITING_APPROVAL` -> `COMPLETED`.
*   **Context Injection:** Generate `CURSOR_TASK.md` dynamically with task-specific instructions.

---

### 4.3 Approval & Review Module
#### Purpose
Providing a human interface to verify AI-generated code changes.

#### User Stories
1.  As a Developer, I want to see a side-by-side diff of what the AI changed.
2.  As a Reviewer, I want to click an "Approve" link in my email to merge the changes.
3.  As a Reviewer, I want to provide text feedback on a rejection so the AI agent can try again.

#### Functional Requirements
*   **Diff Generation:** Calculate line-level diffs between the task branch and base branch.
*   **Approval Tokens:** Generate secure, time-limited tokens for one-click approvals.
*   **Rerun Logic:** Automatically patch prompts and re-queue tasks on rejection with feedback.

---

### 4.4 Reporting & Uptime Module
#### Purpose
Maintaining visibility into the health and status of all managed client websites.

#### Functional Requirements
*   **Uptime Monitoring:** Poll client URLs at configurable intervals.
*   **Report Generation:** Compile task statistics into CSV/JSON reports.
*   **Data Retention:** Manage automated cleanup of old logs and artifacts.

---

### 4.5 Image Retrieval & Management Module
#### Purpose
Automated sourcing and optimization of visual assets for client demos.

#### Functional Requirements
*   **Source Integration:** Connect to Unsplash API to find images based on business category.
*   **Metadata Storage:** Store image metadata alongside the local file.

---

## 5. User Flows

### Happy Path: Task Update
1.  **Trigger:** PM moves task to "To Do" in ClickUp.
2.  **Ingestion:** Webhook triggers task import and branch creation.
3.  **Execution:** Cursor agent starts, writes code, and commits changes.
4.  **Verification:** System runs tests and generates a visual preview.
5.  **Notification:** Reviewer receives an approval request via Email/Slack.
6.  **Approval:** Reviewer clicks "Approve"; code is pushed to GitHub, and ClickUp is updated.

### Failure Path: Rejection with Feedback
1.  **Rejection:** Reviewer finds an issue and submits feedback.
2.  **Retrigger:** System updates the task prompt with feedback and restarts the agent.

---

## 6. State Management & Data Flow
*   **Server-Side:** States are persisted in `.json` files (e.g., `state/`, `logs/tasks/`).
*   **Real-time:** The dashboard polls API endpoints for status updates; optional SSE support for logs.
*   **Persistence:** Uses atomic writes to ensure data integrity.

---

## 7. Validation, Errors & Edge Cases
*   **Input Validation:** Strict regex for slugs, hex codes, and task IDs.
*   **Process Monitoring:** Cleanup service kills hung agent processes.
*   **Slug Collision:** Numeric suffixes are added to conflicting slugs automatically.

---

## 8. Analytics & Logging
*   **Events:** Track `task_started`, `agent_completion`, and `approval_latency`.
*   **Logging:** Centralized logs with levels (INFO, WARN, ERROR) and context tags.

---

## 9. Security & Compliance
*   **Authentication:** Session-based local auth; OAuth 2.0 for ClickUp.
*   **Secrets:** All API tokens must be stored in `.env` files.
*   **Access Control:** Review-only tokens for stakeholders.

---

## 10. Scalability & Performance
*   **Concurrency:** Limited to 5 concurrent agents by default to manage local resource usage.
*   **Efficiency:** Uses Git caching to speed up repository operations.

---

## 11. QA & Acceptance Criteria
*   **Demo Creation:** Successful cloning and branding within 5 minutes.
*   **Workflow:** End-to-end task completion from ClickUp to GitHub.
*   **Feedback Loop:** Agent successfully incorporates rejection feedback into the next run.

---

## 12. Open Questions & Assumptions
*   **Assumption:** Cursor CLI is installed and configured on the host machine.
*   **Question:** Should we integrate with other project management tools (e.g., Jira, Trello) in v2?
*   **Question:** What is the maximum concurrent agent limit for the current hardware?





