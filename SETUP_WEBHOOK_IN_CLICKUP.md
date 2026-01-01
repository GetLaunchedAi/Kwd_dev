# How to Set Up Webhook in ClickUp

## Step-by-Step Instructions

### Step 1: Go to ClickUp Webhook Settings

1. Log in to ClickUp
2. Click on your **profile/avatar** (top right)
3. Click **"Settings"**
4. In the left sidebar, click **"Apps"**
5. Click **"Webhooks"** in the left sidebar

**Direct Link**: https://app.clickup.com/settings/apps → Click "Webhooks"

---

### Step 2: Create a New Webhook

1. Click the **"Create Webhook"** button (usually top right)

---

### Step 3: Configure the Webhook

Fill in the webhook form:

**Webhook URL:**
```
https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup
```
*(Make sure ngrok is running and this URL is accessible)*

**Events to Subscribe:**
- ✅ Check **`taskStatusUpdated`** (required - this is the main trigger)
- ✅ Check **`taskUpdated`** (optional, but recommended - catches other task updates)

**Webhook Secret:**
- Click "Generate" or enter a random secret string
- **IMPORTANT**: Copy this secret! You'll need it for your `.env` file
- Example secret: `my_webhook_secret_12345` (but use something more secure)

**Status Filter (Optional):**
- You can optionally filter by specific statuses
- Leave blank to receive all status changes (recommended)

**Team/Workspace:**
- Select the workspace/team where your tasks are

---

### Step 4: Save the Webhook

1. Click **"Save"** or **"Create"**
2. The webhook is now active!

---

### Step 5: Add Webhook Secret to .env File

1. Open your `.env` file
2. Find or add:
   ```
   CLICKUP_WEBHOOK_SECRET=the_secret_you_created_in_clickup
   ```
3. Replace `the_secret_you_created_in_clickup` with the actual secret from Step 3
4. Save the file
5. Restart your server: `npm start`

---

## Visual Guide

```
ClickUp Settings
├── Apps
    ├── Webhooks ← Click here
        ├── Create Webhook ← Click this button
            ├── Webhook URL: [paste your ngrok URL]
            ├── Events:
            │   ├── ☑ taskStatusUpdated
            │   ├── ☑ taskUpdated
            │   └── ☐ other events...
            ├── Webhook Secret: [generate/copy this]
            └── Save
```

---

## Testing the Webhook

After setup:

1. **Find any task** in ClickUp
2. **Change its status** to "Ready to Code" (or your trigger status)
3. **Check your server logs** - you should see:
   ```
   Received ClickUp webhook
   Received webhook event: taskStatusUpdated for task: <task_id>
   ```

---

## Troubleshooting

**"Webhook not receiving events":**
- Make sure ngrok is running
- Verify the webhook URL is correct (no typos)
- Check that events are subscribed (`taskStatusUpdated`)
- Look at ClickUp webhook logs (in webhook settings) for delivery status

**"Invalid webhook signature" errors:**
- Make sure `CLICKUP_WEBHOOK_SECRET` in `.env` matches the secret in ClickUp
- Restart server after updating `.env`

**"Webhook URL not accessible":**
- Make sure ngrok is running: `npx ngrok http 3000`
- Make sure your server is running: `npm start`
- Test the URL in browser: `https://lili-monasterial-messiah.ngrok-free.dev/health`

---

## Quick Summary

1. **Go to**: ClickUp Settings → Apps → Webhooks
2. **Click**: "Create Webhook"
3. **Enter URL**: `https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup`
4. **Check**: `taskStatusUpdated` (and optionally `taskUpdated`)
5. **Create secret**: Copy the secret
6. **Save**: Click "Save"
7. **Add to .env**: `CLICKUP_WEBHOOK_SECRET=your_secret_here`
8. **Restart server**: `npm start`




