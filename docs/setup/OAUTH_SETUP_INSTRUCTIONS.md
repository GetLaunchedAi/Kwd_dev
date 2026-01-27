# OAuth Setup Instructions

## ✅ What's Been Done

I've implemented OAuth authentication for your ClickUp integration! This means:
- ✅ No need for a new API token (your n8n setup is safe!)
- ✅ Uses your Client ID and Client Secret
- ✅ OAuth flow implemented
- ✅ Access tokens stored securely
- ✅ API client updated to use OAuth tokens

## 📋 Next Steps

### Step 1: Update ClickUp OAuth App Redirect URI

1. Go to ClickUp: https://app.clickup.com/settings/apps
2. Find your OAuth app (the one with Client ID: `MKOAT80TFRPM21DYICZ950RHZ41WUFKE`)
3. Update the **Redirect URI** to:
   ```
   https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup/callback
   ```
4. Save the changes

**Important:** Make sure ngrok is running so this URL is accessible!

### Step 2: Verify .env File

Check that your `.env` file has:
```env
CLICKUP_CLIENT_ID=MKOAT80TFRPM21DYICZ950RHZ41WUFKE
CLICKUP_CLIENT_SECRET=DSN4077N3VHE3QV2J017RJ5KLAKMN2JOYKIBGZFOMFKAL0S384852NF4F6F6Q6RP
CLICKUP_REDIRECT_URI=https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup/callback
CLICKUP_WEBHOOK_SECRET=placeholder_secret
```

### Step 3: Authorize the App (One-Time Setup)

1. Make sure your server is running: `npm start`
2. Make sure ngrok is running (so the redirect URI works)
3. Visit: `https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup`
4. You'll be redirected to ClickUp to authorize the app
5. Click "Authorize" or "Allow"
6. You'll be redirected back and see a success message
7. The access token is now saved and will be used automatically!

### Step 4: Test It

Once authorized, try:
- The webhook will automatically use the OAuth token for API calls
- Check server logs to confirm it's working
- Try changing a task status in ClickUp to trigger a webhook

## 🔄 How It Works

1. **First Time**: Visit `/auth/clickup` to authorize
2. **ClickUp Redirects**: You authorize the app
3. **Callback**: ClickUp sends you back with an authorization code
4. **Token Exchange**: App exchanges code for access token
5. **Storage**: Token saved to `tokens/clickup-access-token.json`
6. **API Calls**: All future API calls use this token automatically

## 📝 Important Notes

- **Keep ngrok running** - The redirect URI needs to be accessible
- **Token Storage**: Access tokens are stored in `tokens/` directory (already in .gitignore)
- **Token Expiration**: If tokens expire, just visit `/auth/clickup` again to re-authorize
- **n8n Safe**: Your existing API token in n8n won't be affected!

## 🆘 Troubleshooting

**"Redirect URI mismatch" error:**
- Make sure the Redirect URI in ClickUp matches exactly: `https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup/callback`
- Make sure ngrok is running

**"Authorization failed":**
- Check that Client ID and Secret are correct in `.env`
- Make sure the OAuth app in ClickUp is active

**Token not working:**
- Delete `tokens/clickup-access-token.json` and re-authorize
- Check server logs for errors




