# Quick ClickUp Webhook Setup

## ✅ Your server is already running on port 3000!

Now follow these simple steps:

## Step 1: Start ngrok (in a NEW terminal)

Open a **NEW PowerShell terminal** and run:

```powershell
cd "c:\Users\yunus\Desktop\KWD Dev"
npx ngrok http 3000
```

You'll see output like this:
```
Session Status                online
Account                       (Plan: Free)
Forwarding                    https://abc123xyz.ngrok.io -> http://localhost:3000
```

**Copy the HTTPS URL** (the one that looks like `https://abc123xyz.ngrok.io`)

**⚠️ Keep this terminal open!** (ngrok needs to keep running)

---

## Step 2: Configure ClickUp Webhook

1. **Go to ClickUp**: https://app.clickup.com/settings/apps
2. Click **"Webhooks"** in the left sidebar
3. Click **"Create Webhook"**
4. Fill in:
   - **Webhook URL**: `https://YOUR-NGROK-URL.ngrok.io/webhook/clickup`
     (Replace `YOUR-NGROK-URL` with your actual ngrok URL from Step 1)
   - **Events to Subscribe**:
     - ✅ Check `taskStatusUpdated` (REQUIRED)
     - ✅ Check `taskUpdated` (optional but recommended)
   - **Webhook Secret**: Generate a random secret (e.g., use https://randomkeygen.com/)
     - **IMPORTANT:** Save this secret - you'll need it next!

5. Click **"Save"**

---

## Step 3: Add Webhook Secret to .env

1. Open your `.env` file
2. Find the line: `CLICKUP_WEBHOOK_SECRET=placeholder`
3. Replace `placeholder` with the secret you created in ClickUp
4. Save the file
5. **Restart your server** (press Ctrl+C in the server terminal, then run `npm start` again)

---

## Step 4: Update Approval URL (Optional - if using email approvals)

1. Open `config/config.json`
2. Find this line:
   ```json
   "approvalUrl": "http://localhost:3000/approve/{token}"
   ```
3. Replace it with:
   ```json
   "approvalUrl": "https://YOUR-NGROK-URL.ngrok.io/approve/{token}"
   ```
   (Replace `YOUR-NGROK-URL` with your actual ngrok URL)

4. Save the file
5. Rebuild: `npm run build`

---

## Step 5: Test It!

1. Go to ClickUp and find any task
2. Change the task status to **"Ready to Code"**
3. Check your server terminal - you should see logs showing the webhook was received! 🎉

---

## Summary of URLs

Once you have your ngrok URL (e.g., `https://abc123.ngrok.io`):

- **ClickUp Webhook URL**: `https://abc123.ngrok.io/webhook/clickup`
- **Approval URL** (in config.json): `https://abc123.ngrok.io/approve/{token}`

---

## Troubleshooting

**Q: ngrok URL changes every time?**
- A: Yes, free ngrok URLs change each time you restart. For a permanent URL, use ngrok's paid plan or deploy to production.

**Q: Webhook not working?**
- Make sure ngrok is still running
- Make sure your server is running
- Double-check the URL in ClickUp matches exactly (including `/webhook/clickup`)
- Check ClickUp webhook logs for error messages

**Q: Need to stop ngrok?**
- Press Ctrl+C in the ngrok terminal




