# ClickUp Webhook URL Configuration

## Main Webhook URL

ClickUp needs to send webhook events to your server. Configure this URL in ClickUp:

### Local Development (with ngrok or similar tunneling service):
```
https://your-ngrok-url.ngrok.io/webhook/clickup
```

### Production:
```
https://yourdomain.com/webhook/clickup
```

**Note:** ClickUp webhooks require HTTPS, so for local development you'll need to use a tunneling service like:
- [ngrok](https://ngrok.com/) - `ngrok http 3000`
- [Cloudflare Tunnel](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/)
- [localtunnel](https://localtunnel.github.io/www/) - `npx localtunnel --port 3000`

---

## Additional URLs to Configure

### 1. Approval URLs (in `config/config.json`)

If you're using email approval, update the `approvalUrl` in your config:

**Local Development:**
```json
"approvalUrl": "http://localhost:3000/approve/{token}"
```

**Production:**
```json
"approvalUrl": "https://yourdomain.com/approve/{token}"
```

This URL is embedded in approval emails and allows reviewers to approve/reject changes.

---

## Setting Up the Webhook in ClickUp

1. **Go to ClickUp Settings:**
   - Click on your profile → Settings
   - Navigate to **Apps** → **Webhooks**

2. **Create a New Webhook:**
   - Click "Create Webhook"
   - **Webhook URL**: Use one of the URLs above (must be HTTPS for production)
   - **Events to Subscribe**: Select the events you want to receive:
     - `taskStatusUpdated` (required - this triggers the workflow)
     - `taskUpdated` (optional - for additional updates)
   - **Secret**: Set a secret and add it to your `.env` as `CLICKUP_WEBHOOK_SECRET`

3. **Webhook Secret:**
   - Use the secret from ClickUp webhook configuration
   - Add it to your `.env` file:
     ```
     CLICKUP_WEBHOOK_SECRET=your_webhook_secret_here
     ```

---

## Testing the Webhook Locally

1. **Start ngrok:**
   ```bash
   ngrok http 3000
   ```

2. **Copy the HTTPS URL** (e.g., `https://abc123.ngrok.io`)

3. **Use in ClickUp webhook configuration:**
   ```
   https://abc123.ngrok.io/webhook/clickup
   ```

4. **Update your config.json approval URL** if using email:
   ```json
   "approvalUrl": "https://abc123.ngrok.io/approve/{token}"
   ```

5. **Test the webhook:**
   - Update a task status in ClickUp to the trigger status (default: "Ready to Code")
   - Check your server logs to see if the webhook was received

---

## Production Deployment

When deploying to production:

1. **Update `config/config.json`:**
   ```json
   {
     "approval": {
       "email": {
         "approvalUrl": "https://yourdomain.com/approve/{token}"
       }
     }
   }
   ```

2. **Configure ClickUp webhook with production URL:**
   ```
   https://yourdomain.com/webhook/clickup
   ```

3. **Ensure your server:**
   - Has HTTPS enabled (SSL certificate)
   - Is publicly accessible
   - Has port 3000 (or your configured port) open

---

## Summary

- **Webhook URL (ClickUp → Your Server):** `https://yourdomain.com/webhook/clickup`
- **Approval URL (Emails → Your Server):** `https://yourdomain.com/approve/{token}` (configured in `config/config.json`)
- **Rejection URL (Emails → Your Server):** `https://yourdomain.com/reject/{token}` (automatically generated from approval URL)

All URLs must use HTTPS for production (ClickUp requires it for webhooks).




