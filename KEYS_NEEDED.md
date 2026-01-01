# Environment Variables / Keys Needed

Here are all the environment variables you need to set in your `.env` file:

## 🔴 Required Keys (Always Needed)

### ClickUp Configuration
- **`CLICKUP_API_TOKEN`** - Your ClickUp API token
  - Get it from: ClickUp Settings → Apps → API → Generate token
  - Used for: Fetching task details and managing tasks

- **`CLICKUP_WEBHOOK_SECRET`** - Secret for validating ClickUp webhooks
  - Get it from: ClickUp webhook configuration
  - Used for: Verifying webhook requests are from ClickUp

### GitHub Configuration
- **`GITHUB_TOKEN`** - GitHub Personal Access Token
  - Get it from: GitHub Settings → Developer settings → Personal access tokens → Generate new token
  - Required scopes: `repo` (full repository access)
  - Used for: Pushing code changes to GitHub repositories

---

## 🟡 Conditional Keys (Based on Approval Method)

The approval method is set in `config/config.json` under `approval.method` (either `"email"` or `"slack"`).

### If using Email Approval (`approval.method: "email"`):

- **`SMTP_HOST`** - SMTP server hostname
  - Examples: `smtp.gmail.com`, `smtp.sendgrid.net`, `smtp.mailgun.org`
  - Used for: Sending approval notification emails

- **`SMTP_USER`** - SMTP authentication username
  - Usually your email address
  - Used for: SMTP authentication

- **`SMTP_PASS`** - SMTP authentication password
  - Your email password or app-specific password
  - Used for: SMTP authentication

- **`EMAIL_FROM`** - Email address to send from
  - Example: `noreply@yourcompany.com`
  - Used for: "From" field in approval emails

### If using Slack Approval (`approval.method: "slack"`):

- **`SLACK_WEBHOOK_URL`** - Slack incoming webhook URL
  - Get it from: Slack App → Incoming Webhooks → Add to Slack
  - Format: `https://hooks.slack.com/services/YOUR/WEBHOOK/URL`
  - Used for: Sending approval notifications to Slack

---

## 📝 Example `.env` File

### For Email Approval:
```env
# ClickUp Configuration
CLICKUP_API_TOKEN=your_clickup_api_token_here
CLICKUP_WEBHOOK_SECRET=your_webhook_secret_here

# GitHub Configuration
GITHUB_TOKEN=your_github_token_here

# Email Configuration (for approvals)
SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
EMAIL_FROM=noreply@yourcompany.com

# Slack Configuration (not needed if using email)
SLACK_WEBHOOK_URL=
```

### For Slack Approval:
```env
# ClickUp Configuration
CLICKUP_API_TOKEN=your_clickup_api_token_here
CLICKUP_WEBHOOK_SECRET=your_webhook_secret_here

# GitHub Configuration
GITHUB_TOKEN=your_github_token_here

# Email Configuration (not needed if using Slack)
SMTP_HOST=
SMTP_USER=
SMTP_PASS=
EMAIL_FROM=

# Slack Configuration (for approvals)
SLACK_WEBHOOK_URL=https://hooks.slack.com/services/YOUR/WEBHOOK/URL
```

---

## 🔗 Quick Links to Get Keys

1. **ClickUp API Token**: https://app.clickup.com/settings/apps
2. **GitHub Token**: https://github.com/settings/tokens
3. **Gmail App Password**: https://myaccount.google.com/apppasswords
4. **Slack Webhook**: https://api.slack.com/messaging/webhooks

---

## ⚠️ Important Notes

- The `.env` file is in `.gitignore` and should never be committed to git
- All values starting with `env:` in `config/config.json` need a corresponding environment variable
- If you change the approval method, make sure to update `config/config.json` accordingly
- For Gmail, you may need to use an "App Password" instead of your regular password




