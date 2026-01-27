# Netlify Deployment Setup Guide

This guide explains how to configure Netlify auto-deployment for demo sites.

## Overview

When publishing a demo site, the system can automatically:
1. Push code to GitHub (organization repository)
2. Create a Netlify site linked to that GitHub repo
3. Configure continuous deployment
4. Return a live URL (e.g., `https://demo-name-xyz.netlify.app`)

## Prerequisites

Before enabling Netlify deployment, ensure you have:

1. **Netlify Account** - Sign up at [netlify.com](https://netlify.com)
2. **Netlify Personal Access Token** - Generate from [Netlify User Settings](https://app.netlify.com/user/applications#personal-access-tokens)
3. **Netlify GitHub App** - **CRITICAL: This is required!**

## Step 1: Install Netlify GitHub App

> ⚠️ **IMPORTANT**: This is the #1 cause of deployment failures. Don't skip this step!

Netlify needs permission to access your GitHub repositories. Without this, deployments will fail with "OAuth" or "repository access" errors.

1. Go to: **https://github.com/apps/netlify/installations/new**
2. Select your GitHub organization (the one used for demo publishing)
3. Choose "All repositories" or select specific repositories
4. Click **Install**
5. Authorize Netlify when prompted

### Verify Installation

1. Go to your GitHub organization → Settings → Installed GitHub Apps
2. Confirm "Netlify" appears in the list
3. Verify it has access to the repositories you want to deploy

## Step 2: Generate Netlify API Token

1. Log in to [Netlify](https://app.netlify.com)
2. Go to **User Settings** → **Applications** → **Personal Access Tokens**
3. Click **New access token**
4. Name it (e.g., "KWD Dev Automation")
5. Copy the token immediately (it won't be shown again)

## Step 3: Find Your Account Slug

1. Go to **Team Settings** in Netlify
2. Look at the URL: `app.netlify.com/teams/YOUR-SLUG/...`
3. The slug is the part after `/teams/`

Example: If URL is `app.netlify.com/teams/my-agency`, your slug is `my-agency`.

## Step 4: Configure Environment Variables

Add to your server environment (`.env` file or system environment):

```bash
NETLIFY_API_TOKEN=your-token-here
NETLIFY_ACCOUNT_SLUG=your-slug-here
```

Alternatively, add to `config/config.json`:

```json
{
  "netlify": {
    "apiToken": "env:NETLIFY_API_TOKEN",
    "accountSlug": "env:NETLIFY_ACCOUNT_SLUG"
  }
}
```

## Step 5: Configure in Settings UI

1. Navigate to **Settings** in the KWD Dev dashboard
2. Scroll to the **Netlify Deployment** section
3. Verify:
   - ✅ API token status shows "configured"
   - Enter your Account/Team slug
   - Check the "I have installed the Netlify GitHub App" checkbox
4. Click **Test Connection** to verify
5. **Save Settings**

## Configuration Options

### Build Command

Leave empty to auto-detect from `package.json`. The system will use:
- `package.json` → `scripts.build` value
- Default: `npm run build`

### Publish Directory

The folder containing built files. Defaults to `public` (standard for Eleventy projects).

Common values:
- `public` - Eleventy, 11ty
- `_site` - Jekyll
- `dist` - Vite, Webpack
- `build` - Create React App

## Testing Your Setup

1. Go to **Settings** → **Netlify Deployment**
2. Click **Test Connection**
3. Expected result: "Connected: [Your Name]"

If the test fails, check:
- Token is valid and not expired
- Account slug is correct
- Network can reach Netlify API

## Using Netlify Deployment

### During Publish

When publishing a demo, select "Deploy to Netlify" option (if available in UI) or the system will automatically deploy if Netlify is configured.

### Partial Success

If GitHub publishing succeeds but Netlify fails:
- Status will show "deploy_failed"
- GitHub repo will exist and be accessible
- You can retry Netlify deployment from the demo details page

### Retry Failed Deployments

1. Go to the demo details page
2. Find the "Publishing Status" card
3. Click **Retry Netlify Deploy**

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NETLIFY_API_TOKEN` | Yes | Personal access token from Netlify |
| `NETLIFY_ACCOUNT_SLUG` | Yes | Team/account slug from Netlify URL |

## Build Settings

The system automatically:
- Detects build commands from `package.json`
- Sets publish directory to `public`
- Links the GitHub repository
- Configures continuous deployment

You can override these in Settings:
- **Build Command**: Custom build command
- **Publish Directory**: Output folder

## Security Notes

1. **Never commit API tokens** to version control
2. Use environment variables for sensitive values
3. Tokens can be rotated in Netlify dashboard if compromised
4. Limit token permissions to only what's needed

## Next Steps

After setup:
1. Create a demo site
2. Complete all steps
3. Click "Approve & Publish" 
4. Select "Deploy to Netlify" option
5. Wait for deployment to complete
6. Access your live site!

## Related Documentation

- [NETLIFY_TROUBLESHOOTING.md](./NETLIFY_TROUBLESHOOTING.md) - Common issues and solutions
- [GitHub Publishing Setup](./GITHUB_SETUP.md) - GitHub configuration (required before Netlify)
