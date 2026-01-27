# ClickUp Webhook Setup - Quick Guide

## Automated Setup (Recommended)

1. **Make sure your server is running:**
   ```powershell
   npm start
   ```

2. **Run the setup script:**
   ```powershell
   .\setup-webhook.ps1
   ```

   This script will:
   - Check if your server is running
   - Start ngrok tunnel
   - Display the webhook URL you need
   - Update your config.json automatically

## Manual Setup

### Step 1: Start ngrok

Open a new terminal and run:
```powershell
npx ngrok http 3000
```

You'll see output like:
```
Forwarding  https://abc123xyz.ngrok.io -> http://localhost:3000
```

Copy the HTTPS URL (the one starting with `https://`).

### Step 2: Configure ClickUp Webhook

1. Go to ClickUp: https://app.clickup.com/settings/apps
2. Click on **Webhooks** in the left sidebar
3. Click **Create Webhook**
4. Fill in the form:
   - **Webhook URL**: `https://your-ngrok-url.ngrok.io/webhook/clickup`
     (Replace `your-ngrok-url` with your actual ngrok URL)
   - **Events**: Select:
     - ✅ `taskStatusUpdated` (required)
     - ✅ `taskUpdated` (optional, but recommended)
   - **Webhook Secret**: Create a random secret (e.g., use a password generator)
     - Save this secret - you'll need it for your `.env` file

5. Click **Save**

### Step 3: Add Webhook Secret to .env

1. Open your `.env` file
2. Update the `CLICKUP_WEBHOOK_SECRET` line:
   ```env
   CLICKUP_WEBHOOK_SECRET=the_secret_you_created_in_clickup
   ```

3. Save the file
4. Restart your server (Ctrl+C and `npm start` again)

### Step 4: Update Approval URL (if using email approval)

1. Open `config/config.json`
2. Find the `approvalUrl` field
3. Update it with your ngrok URL:
   ```json
   "approvalUrl": "https://your-ngrok-url.ngrok.io/approve/{token}"
   ```
   (Replace `your-ngrok-url` with your actual ngrok URL)

4. Save the file
5. Rebuild if needed: `npm run build`

### Step 5: Test the Webhook

1. Go to ClickUp and find a task
2. Change the task status to **"Ready to Code"** (or whatever your trigger status is)
3. Check your server terminal - you should see logs showing the webhook was received
4. Check the ClickUp webhook logs (in ClickUp settings) to see if it was successful

---

## Production Setup

When you're ready for production:

1. **Deploy your server** to a hosting service (Heroku, Railway, DigitalOcean, etc.)
2. **Get your production URL** (e.g., `https://your-app.herokuapp.com`)
3. **Update ClickUp webhook URL** to:
   ```
   https://your-app.herokuapp.com/webhook/clickup
   ```
4. **Update config.json approval URL** to:
   ```json
   "approvalUrl": "https://your-app.herokuapp.com/approve/{token}"
   ```

---

## Troubleshooting

**Problem:** ngrok URL changes every time
- **Solution:** Use ngrok's paid plan for static URLs, or use a production deployment

**Problem:** Webhook not receiving events
- Check that ngrok is still running
- Check that your server is running on port 3000
- Verify the webhook URL in ClickUp matches your ngrok URL exactly
- Check ClickUp webhook logs for error messages

**Problem:** "Invalid webhook signature" errors
- Make sure `CLICKUP_WEBHOOK_SECRET` in `.env` matches the secret you set in ClickUp
- Restart your server after updating `.env`

---

## Quick Reference

- **Webhook Endpoint**: `/webhook/clickup` (POST)
- **Approval Endpoint**: `/approve/{token}` (GET)
- **Rejection Endpoint**: `/reject/{token}` (GET)
- **Health Check**: `/health` (GET)
- **Default Port**: 3000




