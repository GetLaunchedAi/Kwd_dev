# 🚨 Configuration Issues Audit

> **Last Updated:** January 13, 2026  
> **Target Environment:** Cloudways Classic (PHP app running Node.js)

---

## 🔴 CRITICAL ISSUES

### 1. **Port Mismatch Between Config and Approval URL**
**File:** `config/config.json`

| Setting | Value |
|---------|-------|
| Server Port | `3001` (line 70) |
| Approval URL | `http://localhost:3000/approve/{token}` (line 85) |

**Impact:** All approval email links will be broken - they point to the wrong port.

**Fix:** 
- Change `approvalUrl` to use the correct port, OR
- Use environment variable: `"approvalUrl": "env:APPROVAL_BASE_URL"`

---

### 2. **Debug Logging Calls Left in Production Code** ⚠️ SECURITY RISK
**Files:** Multiple source files

| File | Occurrences |
|------|-------------|
| `src/cursor/runner.ts` | 3 |
| `src/cursor/agentTrigger.ts` | 4 |
| `src/workflow/workflowOrchestrator.ts` | Multiple |
| `src/cursor/agentCompletionDetector.ts` | Multiple |
| `src/cursor/agentQueue.ts` | Multiple |

These files contain hardcoded debug fetch calls to `http://127.0.0.1:7243/ingest/...` which:
- Will fail silently in production (due to `.catch(()=>{})`)
- Potentially leak sensitive task data if the endpoint exists
- Add unnecessary network overhead

**Fix:** Remove debug fetch calls or wrap in `if (process.env.NODE_ENV !== 'production')` check.

---

### 3. **Hardcoded Windows CLI Path Won't Work on Production**
**File:** `config/config.json` (line 29)

```json
"cliPath": "D:/Program Files/cursor/resources/app/bin/cursor.cmd"
```

**Impact:** Cursor agent will fail to launch on Linux production server.

**Fix:** Change to `"cursor"` for production (relies on PATH), or use environment-based config switching.

---

### 4. **`resolveEnvValue` Always Throws for Missing Required Env Vars**
**File:** `src/config/config.ts` (lines 128-142)

The `resolveEnvObject` function doesn't pass the `required: false` flag, treating ALL environment variables as required - including optional ones like:
- `SLACK_WEBHOOK_URL`
- `CURSOR_API_KEY` (when using non-CLI trigger method)

**Impact:** App crashes on startup if any env var referenced in config is missing.

**Fix:** Add optional/required metadata to config schema, or handle missing optional vars gracefully.

---

### 5. **OAuth State Not Stored (CSRF Vulnerability)**
**File:** `src/server.ts` (lines 258-264)

```javascript
const state = generateState();
const authUrl = getAuthorizationUrl(state);
// Store state in session (in production, use proper session storage)
// For now, we'll just redirect - ClickUp will handle the state
res.redirect(302, authUrl);
```

The OAuth state parameter is generated but **never stored** for verification in the callback, making the flow vulnerable to CSRF attacks.

**Fix:** Store state in session/Redis and verify it matches on callback.

---

### 6. **CURSOR_API_KEY Logged in Plain Text** ⚠️ MAJOR SECURITY RISK
**Files:** `src/cursor/runner.ts`, status files, log files

The Cursor API key is being written in plain text to:
- `client-websites/*/logs/tasks/*/runner-*.log`
- `client-websites/*/.cursor/status/current.json`

The runner logs the full command including the API key:
```javascript
envExports += `; export CURSOR_API_KEY='${escapedApiKey}'`;
```

This command gets stored in status files, exposing the API key.

**Impact:** API key exposure in log files - credentials leak.

**Fix:** 
- Mask API keys when logging commands
- Don't store full command strings in status files
- Add `.cursor/status/` and task logs to `.gitignore`

---

### 7. **Approval URL Hardcoded to `localhost`**
**Files:** `config/config.json`, `config/config.example.json`

Both config files have:
```json
"approvalUrl": "http://localhost:3000/approve/{token}"
```

**Impact:** Approval links in production emails will point to localhost, making them unusable.

**Fix:** Use environment variable or derive from request host dynamically.

---

### 8. **No Trust Proxy Configuration**
**File:** `src/server.ts`

Missing `app.set('trust proxy', 1)` or equivalent. This is **required** when running behind Apache/Nginx reverse proxy on Cloudways.

**Impact:**
- `req.ip` returns proxy IP instead of client IP
- HTTPS detection fails (`req.secure` always false)
- Rate limiting based on IP won't work correctly

**Fix:** Add `app.set('trust proxy', 1)` before defining routes.

---

### 9. **Agent Trigger Method Incompatible with Production**
**File:** `config/config.json` (lines 32, 36)

```json
"agentTriggerMethod": "cli",
"useWsl": true,
```

Per `INFRASTRUCTURE_DIFFERENCES.md`, production should use:
- `agentTriggerMethod: "api"`
- `useWsl: false`

**Impact:** CLI trigger with WSL won't work on headless Linux server.

**Fix:** Create separate production config or implement environment-based config switching.

---

## 🟠 HIGH PRIORITY ISSUES

### 10. **Fallback Email Uses Placeholder**
**File:** `src/approval/emailService.ts` (lines 163, 334)

```javascript
const toEmail = toEmailOverride || process.env.APPROVAL_EMAIL_TO || 'developer@example.com';
```

**Impact:** If `APPROVAL_EMAIL_TO` is not set, approval emails go to a non-existent address.

**Fix:** Make `APPROVAL_EMAIL_TO` a required environment variable, or log a warning and skip sending.

---

### 11. **Template URLs All Point to Same Repo**
**File:** `src/handlers/demoHandler.ts` (lines 17-26)

```javascript
const TEMPLATE_MAP: Record<string, string> = {
  'modern': 'https://github.com/11ty/eleventy-base-blog',
  'trade': 'https://github.com/11ty/eleventy-base-blog',
  'default-template': 'https://github.com/11ty/eleventy-base-blog',
  // ... all identical
};
```

**Impact:** Template selection in UI is meaningless - all options produce the same result.

**Fix:** Add distinct template repositories or remove unused template options.

---

### 12. **`githubOrg` Missing from Main Config**
**File:** `config/config.json`

The actual `config.json` is missing the `githubOrg` field, which exists in `config.example.json`:
```json
"githubOrg": ""
```

**Impact:** Publishing demos to GitHub organization may fail.

**Fix:** Add `githubOrg` field to production config.

---

### 13. **Missing `screenshots` Config Section**
**File:** `config/config.json`

Config is missing the explicit `screenshots` section (present in `config.example.json`):
```json
"screenshots": {
  "fullSiteCapture": true,
  "maxPages": 20,
  "captureSections": true,
  "maxIterationsToKeep": 3
}
```

**Impact:** Relies on code defaults, which may differ from expected behavior.

**Fix:** Add explicit screenshots configuration.

---

### 14. **Session Storage is File-Based (Not Scalable)**
**File:** `src/utils/sessionManager.ts`

```javascript
const SESSION_FILE = path.join(process.cwd(), 'tokens', 'sessions.json');
```

Sessions are stored in a single JSON file.

**Impact:**
- Race conditions with concurrent requests
- Lost on server restart if file is corrupted
- Not suitable for multiple server instances

**Fix:** Use Redis or database-backed session storage for production.

---

## 🟡 MEDIUM PRIORITY ISSUES

### 15. **No `NODE_ENV` Detection in Code**
The main application codebase lacks conditional logic based on `NODE_ENV`, leading to:
- Debug overhead running in production
- Identical behavior across environments
- Verbose error messages exposed to users

**Fix:** Add environment checks for debug logging, error detail exposure, and development-only features.

---

### 16. **Missing PM2 Ecosystem Config File**
No `ecosystem.config.js` file exists in the repository. The `DEPLOY.md` instructs manual creation.

**Fix:** Include a production-ready `ecosystem.config.js` in the repo:
```javascript
module.exports = {
  apps: [{
    name: 'kwd-cursor-tool',
    script: './dist/server.js',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      PORT: 3000
    }
  }]
};
```

---

### 17. **Hardcoded npm Global Path**
**File:** `src/utils/visualTesting.ts` (lines 165-167)

```javascript
const npmGlobalBin = process.env.npm_config_prefix 
  ? `${process.env.npm_config_prefix}/bin`
  : '/home/master/.npm-global/bin';
```

The fallback path is specific to Cloudways master user structure.

**Impact:** May fail on different hosting environments or user configurations.

**Fix:** Make this configurable or detect dynamically.

---

## 📋 Summary Table

| Issue | Severity | Environment | Status |
|-------|----------|-------------|--------|
| Port mismatch (3001 vs 3000 in approval URL) | 🔴 Critical | Both | ✅ Fixed |
| Debug fetch calls to 127.0.0.1:7243 | 🔴 Critical | Production | ✅ Fixed |
| Windows CLI path hardcoded | 🔴 Critical | Production | ⚠️ Config-specific |
| OAuth state not stored (CSRF) | 🔴 Critical | Both | ✅ Fixed |
| CURSOR_API_KEY logged in plain text | 🔴 Critical | Both | ✅ Fixed |
| Approval URL hardcoded to localhost | 🔴 Critical | Production | ✅ Fixed |
| No trust proxy setting | 🔴 Critical | Production | ✅ Fixed |
| CLI + WSL agent trigger for production | 🔴 Critical | Production | ⚠️ Config-specific |
| All env vars treated as required | 🟠 High | Both | ✅ Fixed |
| Fallback email to example.com | 🟠 High | Production | ✅ Fixed |
| All templates same URL | 🟠 High | Both | ⚠️ Placeholder |
| Missing `githubOrg` in config | 🟠 High | Both | ✅ Fixed |
| Missing `screenshots` config | 🟠 High | Both | ✅ Fixed |
| File-based sessions | 🟠 High | Production | ⏳ Future work |
| No NODE_ENV detection | 🟡 Medium | Both | ✅ Fixed |
| Missing ecosystem.config.js | 🟡 Medium | Production | ✅ Fixed |
| Hardcoded npm global path | 🟡 Medium | Production | ✅ Fixed |

---

## 🔧 Recommended Production Config Changes

Create or update `config/config.json` for production with these changes:

```json
{
  "server": {
    "port": 3000
  },
  "cursor": {
    "cliPath": "cursor",
    "agentTriggerMethod": "api",
    "useWsl": false
  },
  "approval": {
    "email": {
      "approvalUrl": "https://yourdomain.com/approve/{token}"
    }
  },
  "git": {
    "githubOrg": "your-github-org"
  }
}
```

And ensure these environment variables are set:
```env
NODE_ENV=production
PORT=3000
APPROVAL_EMAIL_TO=real-email@yourdomain.com
APPROVAL_BASE_URL=https://yourdomain.com
```
