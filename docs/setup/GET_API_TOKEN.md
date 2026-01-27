# How to Get Your ClickUp API Token

## ⚠️ You're Currently Looking At: OAuth App Settings
This page shows Client ID and Client Secret - **you don't need these for webhooks!**

## ✅ What You Need: API Token

### Step-by-Step Navigation:

1. **From where you are now (OAuth App page):**
   - Look at the LEFT SIDEBAR
   - Find and click on **"API"** (it's a menu item, not the OAuth app)
   - OR close this page and go back to Settings

2. **Alternative: Direct Navigation**
   - Go to: https://app.clickup.com/settings/apps
   - In the LEFT SIDEBAR, click **"API"** (not "Apps", not "OAuth")
   - You'll see a section that says "API Token"

3. **On the API Page:**
   - You'll see your API token (starts with `pk_`)
   - If you don't have one, click **"Generate"**
   - Copy the entire token

4. **The API Token looks like:**
   ```
   pk_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
   ```
   (It's much longer and starts with `pk_`)

---

## Visual Guide

```
ClickUp Settings
├── Apps (you're here now - OAuth apps)
├── API ← CLICK HERE! (this is what you need)
├── Webhooks (you'll go here next)
└── ...
```

---

## Once You Have the API Token:

1. Open your `.env` file
2. Find: `CLICKUP_API_TOKEN=placeholder_token`
3. Replace with: `CLICKUP_API_TOKEN=pk_your_actual_token_here`
4. Save the file

---

## Then Create the Webhook:

1. Still in Settings → Apps
2. Click **"Webhooks"** in the left sidebar
3. Click **"Create Webhook"**
4. Use URL: `https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup`
5. Create a Webhook Secret and save it
6. Add that secret to `.env` as `CLICKUP_WEBHOOK_SECRET`

---

## Summary

- ❌ **Client ID / Client Secret** = OAuth (not needed)
- ✅ **API Token** = What you need (Settings → Apps → API)
- ✅ **Webhook Secret** = Create when making webhook (Settings → Apps → Webhooks)




