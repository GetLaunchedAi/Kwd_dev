# Agent Workflow: Step-by-Step Execution

This document provides a detailed walkthrough of the automated workflow triggered when a ClickUp task is assigned to the AI agent.

## Phase 1: Trigger & Initialization
The workflow is initiated when a ClickUp task is imported (via webhook or manual import) and its status matches the configured trigger status (e.g., `AI-AGENT`).

### 1. Client Identification
- **Extraction:** The agent extracts the client name from the task name (e.g., "Aimai - Fix header" -> Client: `aimai`).
- **Validation:** It searches for a corresponding directory in the `client-websites/` folder.
- **Mapping:** If a manual mapping exists in `config/task-client-mappings.json`, it uses that instead.

### 2. Pre-change Documentation
- **Visual Capture:** The agent starts the client's local development server and takes "before" screenshots of the website. These are used for visual regression testing later.
- **State Initialization:** A persistent state file is created to track the workflow's progress and store task metadata.

## Phase 2: Environment Setup
### 3. Git Synchronization
- **Fetch & Pull:** The agent pulls the latest changes from the main branch of the client repository to ensure it's working on the most recent code.
- **Branch Creation:** A new feature branch is created specifically for this task, following the naming convention `feature/CU-[task_id]-[sanitized_task_name]`.

### 4. Project Analysis
- **Test Detection:** The system automatically scans the project structure to detect the testing framework in use (e.g., Vitest, Jest, Playwright).
- **Workspace Preparation:** It generates a `CURSOR_TASK.md` file in the client folder. This file contains the full task description, context, and specific instructions for the AI to follow.

## Phase 3: AI Processing (Cursor Agent)
### 5. Cursor Interaction
- **IDE Launch:** If configured, the Cursor IDE is automatically opened to the client's project directory.
- **Agent Trigger:** The Cursor agent is triggered using the instructions provided in `CURSOR_TASK.md`. This can happen via CLI automation or file-based triggers.

### 6. Automated Coding
- **Execution:** The Cursor agent reads the requirements and begins implementing the requested changes, creating files, and fixing bugs.
- **Monitoring:** The workflow orchestrator enters a polling state, monitoring the file system and agent logs to detect when the AI has finished its work.

## Phase 4: Verification & Approval
Once the agent completes its changes, the workflow automatically continues.

### 7. Automated Testing
- **Execution:** The system runs the previously detected test suite.
- **Result Handling:** 
    - **Failure:** If tests fail, the workflow stops, sends a failure notification (Email/Slack) to the assignee, and adds a detailed error comment to the ClickUp task.
    - **Success:** If tests pass, the workflow proceeds to summarization.

### 8. Change Review Generation
- **Diff Analysis:** The agent generates a comprehensive summary of all code changes made during the session.
- **Visual Comparison:** (Optional) "After" screenshots are taken and compared with the "before" screenshots.

### 9. Approval Request
- **Notification:** An approval request is sent to the developer/assignee via Email or Slack. This request includes:
    - A summary of the changes.
    - Test results.
    - A link to the feature branch.
- **Waiting State:** The workflow pauses until a human reviews the changes and provides approval.

## Phase 5: Completion
### 10. Finalizing Changes
- **Git Push:** Upon approval, the feature branch is pushed to the remote GitHub repository.
- **ClickUp Update:** The ClickUp task is updated with a final success comment and a link to the pushed branch.
- **Cleanup:** Temporary files (like `CURSOR_TASK.md`) are cleaned up, and the workflow state is marked as `COMPLETED`.




