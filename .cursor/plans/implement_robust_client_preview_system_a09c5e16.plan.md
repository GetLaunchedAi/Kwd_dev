---
name: Implement Robust Client Preview System
overview: Refactor the existing VisualTester to support multiple simultaneous client previews with dynamic port allocation, automatic timeouts, and dedicated API management endpoints.
todos:
  - id: refactor-visual-tester
    content: Refactor VisualTester for multi-instance support and dynamic ports in src/utils/visualTesting.ts
    status: pending
  - id: add-api-endpoints
    content: Add start/stop/status API endpoints to src/server.ts
    status: pending
  - id: update-usages
    content: Update existing startApp calls in workspaceManager.ts, workflowOrchestrator.ts, and testRunner.ts
    status: pending
  - id: cleanup-logic
    content: Implement graceful shutdown and 30-minute auto-timeout logic
    status: pending
---

