# Step-by-Step ClickUp Setup Guide

## ✅ What You've Done
You've created a ClickUp OAuth App with:
- Client ID: `MKOAT80TFRPM21DYICZ950RHZ41WUFKE`
- Client Secret: `DSN4077N3VHE3QV2J017RJ5KLAKMN2JOYKIBGZFOMFKAL0S384852NF4F6F6Q6RP`

**Note:** Save these for later if you want OAuth, but we don't need them for webhooks.

---

## 🔴 What You Need for Webhooks (Different!)

### Step 1: Get Your ClickUp API Token

1. In ClickUp, go to: **Settings → Apps → API** (NOT "Apps" - click on "API" specifically)
2. You'll see a section for "API Token"
3. Click **"Generate"** or copy your existing token
4. The token will look like: `pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

**This is what goes in your `.env` file as `CLICKUP_API_TOKEN`**

---

### Step 2: Create the Webhook

1. In ClickUp, go to: **Settings → Apps → Webhooks**
2. Click **"Create Webhook"**
3. Fill in:
   - **Webhook URL**: `https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup`
   - **Events**: 
     - ✅ `taskStatusUpdated` (required)
     - ✅ `taskUpdated` (optional but recommended)
   - **Webhook Secret**: Click "Generate" or create your own random string
     - This is like a password to verify webhooks are from ClickUp
     - Save this! You'll need it for `.env`

4. Click **"Save"**

---

### Step 3: Update Your .env File

Open your `.env` file and update:

```env
# ClickUp Configuration
CLICKUP_API_TOKEN=pk_your_actual_api_token_here
CLICKUP_WEBHOOK_SECRET=the_secret_you_created_in_webhook_settings
```

---

## Summary

| What You Have | What You Need |
|--------------|---------------|
| ✅ OAuth Client ID | ❌ Not needed for webhooks |
| ✅ OAuth Client Secret | ❌ Not needed for webhooks |
| ❌ API Token | ✅ **Need this!** (Settings → Apps → API) |
| ❌ Webhook Secret | ✅ **Need this!** (Create when making webhook) |

---

## Quick Links

- **Get API Token**: https://app.clickup.com/settings/apps → Click "API"
- **Create Webhook**: https://app.clickup.com/settings/apps → Click "Webhooks"




