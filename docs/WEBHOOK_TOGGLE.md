# ClickUp Webhook Toggle Feature

## Overview

The ClickUp webhook is now **disabled by default** and can be enabled/disabled via a play/pause button in the dashboard.

## Features

### Default State
- **Disabled by default**: When the server starts, the webhook will not process incoming ClickUp events
- State is persisted in `state/webhook-state.json`
- If the state file doesn't exist, it will be created with `enabled: false`

### UI Control
- **Location**: Dashboard header (top-right area)
- **Button**: Play/Pause icon button with status text
- **Visual Feedback**:
  - **Disabled**: Gray play icon, "Webhook Off" text
  - **Enabled**: Green pause icon with green background, "Webhook On" text

### Behavior

#### When Disabled (Default)
- Webhook endpoint (`/webhook/clickup`) receives events but doesn't process them
- Returns: `{ "message": "Webhook is currently disabled" }`
- No tasks are triggered or processed
- Logs: "Webhook is disabled, ignoring event"

#### When Enabled
- Webhook endpoint processes events normally
- Tasks matching the trigger status are processed
- Full workflow automation runs

## API Endpoints

### Get Webhook Status
```http
GET /api/webhook/status
```

**Response:**
```json
{
  "enabled": false,
  "lastToggleTime": "2026-01-05T10:30:00.000Z",
  "toggledBy": "dashboard"
}
```

### Toggle Webhook
```http
POST /api/webhook/toggle
```

**Response:**
```json
{
  "enabled": true,
  "message": "Webhook enabled"
}
```

### Enable Webhook
```http
POST /api/webhook/enable
```

**Response:**
```json
{
  "enabled": true,
  "message": "Webhook enabled"
}
```

### Disable Webhook
```http
POST /api/webhook/disable
```

**Response:**
```json
{
  "enabled": false,
  "message": "Webhook disabled"
}
```

## Implementation Details

### Backend

#### Webhook State Manager (`src/state/webhookState.ts`)
- Singleton class managing webhook state
- Persists state to `state/webhook-state.json`
- Provides methods: `isEnabled()`, `enable()`, `disable()`, `toggle()`, `getState()`
- Logs all state changes

#### Server Integration (`src/server.ts`)
- Imports `webhookStateManager`
- Webhook endpoint checks `webhookStateManager.isEnabled()` before processing
- Four new API endpoints for webhook control
- State is checked on every webhook request

### Frontend

#### UI Components (`public/index.html`)
- Webhook status container with toggle button and status text
- Play/Pause icons (Lucide icons)
- Positioned in dashboard header before auto-refresh controls

#### Styling (`public/styles.css`)
- `.webhook-status-container`: Container with border and background
- `.webhook-status-container.enabled`: Green theme when enabled
- `.webhook-toggle`: Button styling with hover effects
- Smooth transitions between states

#### JavaScript (`public/app.js`)
- `loadWebhookStatus()`: Fetches current status from API
- `toggleWebhook()`: Toggles webhook and updates UI
- `updateWebhookUI()`: Updates button icons, text, and styling
- `startWebhookStatusPolling()`: Polls status every 10 seconds
- Auto-loads webhook status on page load
- Shows notifications on toggle

## Usage

### For Users

1. **Enable Webhook**:
   - Click the play button (▶) in the dashboard header
   - Status changes to "Webhook On" with green styling
   - Webhook will now process ClickUp events

2. **Disable Webhook**:
   - Click the pause button (⏸) in the dashboard header
   - Status changes to "Webhook Off" with gray styling
   - Webhook will ignore ClickUp events

3. **Check Status**:
   - Status is always visible in the dashboard header
   - Auto-refreshes every 10 seconds
   - Persists across page reloads and server restarts

### For Developers

```typescript
// Check if webhook is enabled
if (webhookStateManager.isEnabled()) {
  // Process webhook event
}

// Enable webhook programmatically
await webhookStateManager.enable('admin');

// Disable webhook programmatically
await webhookStateManager.disable('admin');

// Toggle webhook
const newState = await webhookStateManager.toggle('automation');

// Get current state
const state = webhookStateManager.getState();
console.log(state.enabled); // true or false
```

## State File

**Location**: `state/webhook-state.json`

**Format**:
```json
{
  "enabled": false,
  "lastToggleTime": "2026-01-05T10:30:00.000Z",
  "toggledBy": "dashboard"
}
```

## Benefits

1. **Control**: Easily pause webhook processing without stopping the server
2. **Testing**: Test webhook endpoint without triggering workflows
3. **Maintenance**: Disable during maintenance or troubleshooting
4. **Safety**: Default disabled prevents unexpected automation
5. **Visibility**: Always know if webhooks are active or not
6. **Persistence**: State survives server restarts

## Migration Notes

- Existing installations will start with webhook **disabled**
- State file will be created on first server start
- No database migration required
- Backward compatible - all existing functionality works when enabled

## Troubleshooting

### Webhook not processing events
- Check if webhook is enabled in dashboard (should show "Webhook On")
- Check server logs for "Webhook is disabled, ignoring event"
- Verify state file exists: `state/webhook-state.json`

### UI not updating
- Check browser console for errors
- Verify API endpoints are accessible
- Try manual refresh of webhook status

### State file errors
- Ensure `state/` directory exists and is writable
- Check file permissions on `state/webhook-state.json`
- Delete state file to reset to default (disabled)

## Future Enhancements

- Add role-based access control for webhook toggle
- Add webhook event history/logs
- Add scheduled enable/disable times
- Add webhook rate limiting controls
- Add webhook event filtering UI










