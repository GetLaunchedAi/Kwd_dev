# Webhook Trigger Information

## Current Configuration

**Trigger Status**: `Ready to Code`

This is configured in `config/config.json`:
```json
{
  "clickup": {
    "triggerStatus": "Ready to Code"
  }
}
```

## What Triggers the Webhook

The webhook will be processed when:

1. **Task status changes** to `"Ready to Code"` in ClickUp
2. ClickUp sends a `taskStatusUpdated` or `taskUpdated` webhook event
3. The webhook is properly configured in ClickUp with:
   - URL: `https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup`
   - Events: `taskStatusUpdated`, `taskUpdated`

## How to Test

1. **Find a task** in your ClickUp workspace
2. **Change the task status** to "Ready to Code"
   - If you don't have this status, you can:
     - Create a new status called "Ready to Code"
     - Or change the trigger status in `config/config.json` to match an existing status
3. **Check your server logs** - you should see:
   ```
   Received ClickUp webhook
   Received webhook event: taskStatusUpdated for task: <task_id>
   Task <task_id> status changed to trigger status: Ready to Code
   Starting workflow for task: <task_id>
   ```

## Changing the Trigger Status

If you want to use a different status to trigger the workflow:

1. Open `config/config.json`
2. Change the `triggerStatus` value:
   ```json
   {
     "clickup": {
       "triggerStatus": "Your Status Name Here"
     }
   }
   ```
3. Rebuild: `npm run build`
4. Restart server: `npm start`

## What Happens After Webhook Triggers

Once a task status changes to the trigger status:

1. ✅ Webhook received from ClickUp
2. ✅ Task details fetched via API
3. ✅ Client name extracted from task name
4. ✅ Client folder found
5. ✅ Feature branch created
6. ✅ Cursor agent triggered
7. ✅ Tests run
8. ✅ Approval request sent (email/Slack)
9. ✅ After approval, changes pushed to GitHub

## Current Status

- ✅ Webhook endpoint: `/webhook/clickup`
- ✅ Trigger status: `Ready to Code`
- ✅ OAuth authentication: Ready
- ⚠️ Webhook must be configured in ClickUp
- ⚠️ Webhook secret must be set in `.env`




