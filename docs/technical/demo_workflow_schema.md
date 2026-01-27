# Demo Workflow History Schema

This document defines the schema for `workflow_history.json`, which tracks the state and summaries of the 4-agent demo customization workflow.

## File Location
`state/demo-workflows/{{clientSlug}}/history.json`

## Schema Definition

```json
{
  "clientSlug": "string",
  "businessName": "string",
  "currentStep": 1,
  "totalSteps": 4,
  "status": "in_progress", // "in_progress", "completed", "failed"
  "startTime": "2026-01-08T10:00:00Z",
  "lastUpdated": "2026-01-08T10:05:00Z",
  "steps": [
    {
      "step": 1,
      "agent": "Branding",
      "status": "completed",
      "summary": "Updated CSS variables for colors and font. Replaced logo with client logo.",
      "startTime": "2026-01-08T10:00:00Z",
      "endTime": "2026-01-08T10:05:00Z",
      "artifacts": ["src/styles/theme.css", "public/img/logo.png"]
    },
    {
      "step": 2,
      "agent": "Copywriting",
      "status": "pending",
      "summary": null,
      "startTime": null,
      "endTime": null,
      "artifacts": []
    },
    {
      "step": 3,
      "agent": "Imagery",
      "status": "pending",
      "summary": null,
      "startTime": null,
      "endTime": null,
      "artifacts": []
    },
    {
      "step": 4,
      "agent": "Review",
      "status": "pending",
      "summary": null,
      "startTime": null,
      "endTime": null,
      "artifacts": []
    }
  ],
  "error": null // Stores error message if status is "failed"
}
```

## Field Descriptions

- **`clientSlug`**: Unique identifier for the client.
- **`currentStep`**: The index of the currently active or last completed step (1-4).
- **`status`**: Overall workflow status.
- **`steps`**: Array of step objects, one for each agent.
    - **`summary`**: A concise description of the changes made by the agent. This is passed to subsequent agents as context.
    - **`artifacts`**: List of files modified or created during this step.
- **`error`**: Details of any error that caused the workflow to halt.




