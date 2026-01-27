# Netlify Deployment Troubleshooting

This guide covers common issues with Netlify deployment and their solutions.

## Quick Diagnosis

| Symptom | Likely Cause | Solution |
|---------|--------------|----------|
| "OAuth" error | GitHub App not installed | [Install Netlify GitHub App](#github-oauth-issues) |
| "API token invalid" | Token expired/wrong | [Regenerate token](#api-token-issues) |
| "Account not found" | Wrong slug | [Find correct slug](#account-slug-issues) |
| "Build failed" | Build script error | [Check build locally](#build-failures) |
| "Site name taken" | Name collision | Automatic retry should handle this |
| Deployment times out | Large build or slow network | [Increase timeouts](#timeout-issues) |

---

## GitHub OAuth Issues

### Error: "Netlify cannot access the GitHub repository"

**Cause**: The Netlify GitHub App is not installed or doesn't have access to the repository.

**Solution**:

1. Go to: **https://github.com/apps/netlify/installations/new**
2. Select your GitHub organization
3. Grant access to **All repositories** or specific ones
4. Click **Install** and authorize

### Verify GitHub App Installation

1. Go to your GitHub organization
2. Navigate to **Settings** → **Installed GitHub Apps**
3. Confirm "Netlify" is listed
4. Check it has access to the repository in question

### Error: "Repository not found" or "Permission denied"

**Cause**: Netlify has limited access or the repo is private without proper permissions.

**Solution**:
- In GitHub App settings, ensure "All repositories" is selected
- Or explicitly add the repository to the allowed list
- Verify the repository exists and is not renamed/deleted

---

## API Token Issues

### Error: "API token is invalid or lacks required permissions"

**Cause**: Token is expired, revoked, or incorrectly entered.

**Solution**:

1. Log in to [Netlify](https://app.netlify.com)
2. Go to **User Settings** → **Applications** → **Personal Access Tokens**
3. Revoke the old token (if visible)
4. Create a new token
5. Update `NETLIFY_API_TOKEN` in your environment
6. Restart the server

### Error: "401 Unauthorized"

**Cause**: Token not being sent correctly or malformed.

**Solution**:
- Ensure token has no leading/trailing whitespace
- Check it's set as `env:NETLIFY_API_TOKEN` in config.json
- Verify the environment variable is loaded at server startup

---

## Account Slug Issues

### Error: "Account not found" or "Invalid team"

**Cause**: The account slug doesn't match any Netlify team.

**Solution**:

1. Log in to Netlify
2. Go to any team page
3. Check the URL: `app.netlify.com/teams/YOUR-SLUG/...`
4. Update the slug in Settings

### Finding Your Correct Slug

- Personal account: Usually your username
- Team account: Set when team was created
- Check **Team Settings** → **General** → **Team slug**

---

## Build Failures

### Error: "Local build failed" (before Netlify site creation)

**Cause**: The project doesn't build successfully locally.

**Solution**:

1. Navigate to the demo directory
2. Run `npm install && npm run build`
3. Fix any errors
4. Retry the publish

### Common Build Errors

#### "Cannot find module"
```
npm install
```

#### "Build script not found"
Ensure `package.json` has a `build` script:
```json
{
  "scripts": {
    "build": "eleventy"
  }
}
```

#### "Sharp installation failed" (on Windows)
```
npm rebuild sharp
```

### Error: "Build exited with code 1" (on Netlify)

**Cause**: Build succeeds locally but fails on Netlify.

**Investigation**:
1. Click the Netlify Admin link in the demo status
2. View the deploy log
3. Look for the specific error

**Common causes**:
- Node.js version mismatch
- Missing environment variables
- Platform-specific dependencies

**Solution**:
Add a `netlify.toml` in the project root:
```toml
[build]
  command = "npm run build"
  publish = "public"

[build.environment]
  NODE_VERSION = "18"
```

---

## Timeout Issues

### Error: "Deployment timed out"

**Cause**: Build takes longer than the maximum allowed time.

**Current limits**:
- Local build: 2 minutes (base) + 1 minute inactivity
- Netlify deployment polling: 10 minutes

**Solutions**:

1. **Optimize the build**:
   - Remove unused dependencies
   - Use build caching
   - Reduce image processing

2. **Check for infinite loops**:
   - Review build scripts
   - Check for circular dependencies

3. **Large assets**:
   - Move large files to a CDN
   - Use image optimization

---

## Site Name Collision

### Error: "Site name already taken"

**Cause**: Another site with the same name exists on Netlify.

**Behavior**: The system automatically retries with a unique suffix.

If it continues failing:
1. Choose a different client slug
2. Or manually delete the conflicting site in Netlify dashboard

---

## Partial Success (deploy_failed)

### State: GitHub succeeded, Netlify failed

This is a recoverable state. The GitHub repository was created and pushed successfully, but the Netlify deployment failed.

**Recovery**:
1. Go to the demo details page
2. Find the "Publishing Status" card
3. Review the error message
4. Fix the underlying issue
5. Click **Retry Netlify Deploy**

**If Retry Fails Again**:
1. Check the Netlify dashboard for the site (if created)
2. Review deploy logs there
3. Fix any issues
4. Trigger a new deploy from Netlify dashboard

---

## Connection Test Failures

### "Test Connection" fails in Settings

**Checklist**:
1. ✅ NETLIFY_API_TOKEN is set in environment
2. ✅ Token is valid (not expired)
3. ✅ Server can reach api.netlify.com
4. ✅ No firewall blocking HTTPS

**Debug**:
```bash
# Test API access directly
curl -H "Authorization: Bearer YOUR_TOKEN" https://api.netlify.com/api/v1/user
```

Expected: JSON response with user info
Error: 401 = token issue, timeout = network issue

---

## Logs and Debugging

### Server-Side Logs

Look for entries with `[Netlify deploy]` or `[clientSlug]`:
```
[INFO] Netlify deploy [demo-name]: validating - Validating Netlify configuration...
[INFO] Netlify deploy [demo-name]: creating_site - Creating Netlify site...
[ERROR] Netlify deploy failed: Repository access denied
```

### Netlify Dashboard

1. Go to app.netlify.com
2. Find the site (or check "Sites" list)
3. Click on the failed deploy
4. Review the build log

### Enable Verbose Logging

Set environment variable:
```
LOG_LEVEL=debug
```

---

## Manual Deployment

If automated deployment consistently fails:

1. **GitHub repo should exist** (from successful GitHub publish)
2. Go to Netlify dashboard
3. Click "Add new site" → "Import an existing project"
4. Select GitHub
5. Choose the repository
6. Configure build settings:
   - Build command: `npm run build`
   - Publish directory: `public`
7. Deploy

This creates continuous deployment for future pushes.

---

## Getting Help

If issues persist:

1. **Check Netlify Status**: https://www.netlifystatus.com/
2. **Netlify Community**: https://answers.netlify.com/
3. **Review System Logs**: Look for detailed error messages
4. **Test Manually**: Try deploying from Netlify dashboard directly

---

## Prevention Tips

1. **Always install GitHub App first** - Most common issue
2. **Test connection before first deploy** - Use Settings UI
3. **Verify local build works** - Run `npm run build` locally
4. **Keep tokens secure** - Rotate if compromised
5. **Monitor deploy logs** - Check Netlify dashboard after deploys
