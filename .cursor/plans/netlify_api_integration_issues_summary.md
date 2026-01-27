# Netlify API Integration - Critical Issues & Fixes

## Summary of Changes to Plan

Based on comprehensive codebase analysis, here are the 10 critical issues identified and how the plan was updated:

---

## 1. **Build Verification Must Use Existing `buildDemo()` Function**

**Issue:** Original plan would create new build verification logic, duplicating existing robust implementation.

**Fix:** Use existing `buildDemo(clientSlug, false)` function from `src/handlers/demoHandler.ts` (lines 1109-1335) which already handles:
- Package.json validation
- Build script detection
- Activity-based timeouts (2min base, 1min inactivity)
- Retry logic with exponential backoff
- Public folder verification

**Impact:** Saves development time, leverages battle-tested code, prevents orphaned Netlify sites from build failures.

---

## 2. **Missing NETLIFY_API_TOKEN in OPTIONAL_ENV_VARS**

**Issue:** Config loader will crash when NETLIFY_API_TOKEN is not set, even though it should be optional.

**Fix:** Add `NETLIFY_API_TOKEN` to `OPTIONAL_ENV_VARS` Set in `src/config/config.ts` line 123.

**Impact:** Critical blocker - without this, the app won't start if token is missing.

---

## 3. **No DemoStatus TypeScript Interface**

**Issue:** All status objects are typed as `any` throughout `src/handlers/demoHandler.ts`, causing type safety issues.

**Fix:** Define comprehensive `DemoStatus` interface with all fields including new Netlify fields:
```typescript
export interface DemoStatus {
  state: 'starting' | 'cloning' | ... | 'publishing' | 'deploying' | 'published' | 'deploy_failed';
  netlifySiteId?: string;
  netlifySiteUrl?: string;
  netlifyAdminUrl?: string;
  netlifyDeployState?: 'building' | 'ready' | 'error';
  netlifyError?: string;
  // ... other fields
}
```

**Impact:** Enables IDE autocomplete, catches type errors at compile time, improves maintainability.

---

## 4. **Status Updates Must Use DemoStatusManager**

**Issue:** Current publish endpoint (`src/server.ts` line 1288+) writes directly to `demo.status.json` using `fs.writeJson`, bypassing atomic update logic.

**Fix:** Import and use `DemoStatusManager.write()` for all status updates. This ensures:
- Atomic file writes (temp file + rename)
- Cache invalidation
- Consistent audit log updates
- Thread safety

**Impact:** Prevents race conditions and corrupted status files.

---

## 5. **DemoStatusManager Not Exported**

**Issue:** `demoStatusManager` singleton is defined but not exported from `src/handlers/demoHandler.ts`.

**Fix:** Add `export` to the singleton declaration (around line 305).

**Impact:** Publish endpoint and other modules can't access the status manager.

---

## 6. **OAuth Prerequisite is CRITICAL but Easy to Miss**

**Issue:** Netlify cannot access GitHub repos without OAuth app installation. This will cause 99% of first deployments to fail silently.

**Fix:** 
- Add prominent warning in Settings UI
- Add "Test Netlify Connection" button to verify setup before first deploy
- Add OAuth setup checkbox to Settings
- Enhanced error messaging when OAuth issues detected

**User-facing change:**
```
"Netlify cannot access the GitHub repository. This is usually because 
the Netlify GitHub App is not installed.

Setup: https://github.com/apps/netlify/installations/new
Grant access to organization: {githubOrg}
Then retry deployment."
```

**Impact:** This is the #1 reason deployments will fail. Must be emphasized heavily in docs and UI.

---

## 7. **Build Command Should Be Detected, Not Assumed**

**Issue:** Original plan assumes `npm run build` for all projects.

**Fix:** Read actual build command from `package.json`:
```typescript
const pkg = await fs.readJson(path.join(demoDir, 'package.json'));
const buildCommand = pkg.scripts?.build || 'npm run build';
```
Pass this to Netlify site creation, don't hardcode.

**Impact:** Supports projects with custom build commands (e.g., `eleventy`, `vite build`).

---

## 8. **New State Required: `deploy_failed`**

**Issue:** No way to distinguish "GitHub succeeded, Netlify failed" from complete failure.

**Fix:** Add new state `deploy_failed` (distinct from `publish_failed`) to indicate partial success:
- GitHub repo created ✓
- Netlify deployment failed ✗
- User can retry Netlify via `/api/demos/:clientSlug/retry-netlify`

**Impact:** Clear communication of partial success, enables targeted retries.

---

## 9. **Progress Callback Must Match GitHub Publisher Pattern**

**Issue:** For UI consistency, Netlify publisher must use identical progress callback signature.

**Fix:** Use exact same pattern from `src/git/githubPublisher.ts`:
```typescript
export interface PublishProgress {
  stage: 'validating' | 'creating_repo' | ...;
  message: string;
  progress?: number;
}

type ProgressCallback = (progress: PublishProgress) => void;
```

**Impact:** Frontend code can handle both publishers identically.

---

## 10. **src/deployment/ Directory Doesn't Exist**

**Issue:** Plan assumes `src/deployment/` exists but it's not in the current directory structure.

**Fix:** Create `src/deployment/` directory before adding `netlifyPublisher.ts`.

**Impact:** Blocking issue for Sprint 1.

---

## Additional Critical Observations

### Dependencies Already Available
- ✅ `axios` - Already in package.json (line 22), can use for Netlify API
- ✅ `vitest` - Already configured (package.json line 10), use for tests
- ✅ `fs-extra` - Already in package.json (line 26)

### Existing Code to Leverage
- ✅ `buildDemo()` - Robust build verification (demoHandler.ts:1109-1335)
- ✅ `PublishProgress` interface - Progress callback pattern (githubPublisher.ts:16-20)
- ✅ Settings endpoints - Already exist at lines 1618 & 1653 in server.ts

### New Files Required
1. `src/deployment/netlifyPublisher.ts` - Core Netlify logic
2. `tests/netlifyPublisher.test.ts` - Unit tests
3. `docs/setup/NETLIFY_SETUP.md` - Setup guide with OAuth emphasis
4. `docs/setup/NETLIFY_TROUBLESHOOTING.md` - Troubleshooting guide

---

## Risk Assessment

### HIGH RISK (99% probability of issues)
1. **OAuth Setup** - Users WILL miss this step
2. **Status File Corruption** - If not using DemoStatusManager
3. **Config Loading Crash** - If OPTIONAL_ENV_VARS not updated

### MEDIUM RISK (50% probability)
1. **Build Command Mismatch** - If hardcoded instead of detected
2. **Site Name Collisions** - In shared Netlify accounts
3. **Partial Failures** - GitHub succeeds, Netlify fails

### LOW RISK (Mitigated)
1. **Build Failures** - Caught by local verification before Netlify site creation
2. **API Rate Limits** - Typical usage won't hit limits
3. **Token Expiration** - Proper error handling added

---

## Testing Priorities

### Must Test Before Release
1. ✅ OAuth not configured → Clear error message
2. ✅ Build fails locally → No Netlify site created
3. ✅ GitHub succeeds, Netlify fails → deploy_failed state
4. ✅ Site name collision → Timestamp appended
5. ✅ Settings UI → All Netlify fields save/load correctly

### Manual Testing Required
- Complete OAuth setup flow with screenshots
- Test with multiple demo projects (different build commands)
- Verify status file integrity under concurrent operations
- Test retry endpoint after partial failure

---

## Documentation Must Emphasize

1. **OAuth Setup is REQUIRED** (not optional)
   - Must be done BEFORE first deployment
   - Step-by-step with screenshots
   - Link to GitHub App installation page

2. **Build Command Detection**
   - System reads from package.json
   - Can override in config if needed
   - Must have `build` script in package.json

3. **Partial Success Scenarios**
   - What `deploy_failed` means
   - How to retry Netlify only
   - When to delete and start over

---

## Implementation Order (Blocking Dependencies)

**Sprint 0 (Blockers):**
1. Create `src/deployment/` directory
2. Add NETLIFY_API_TOKEN to OPTIONAL_ENV_VARS
3. Define DemoStatus interface
4. Export demoStatusManager singleton
5. Update DemoStatusManager type signatures

**Sprint 1 (Core):**
1. Add NetlifyConfig interface to config.ts
2. Implement netlifyPublisher.ts (using buildDemo)
3. Write unit tests

**Sprint 2 (Integration):**
1. Extend settings endpoints
2. Update publish endpoint (use DemoStatusManager!)
3. Add retry endpoint

**Sprint 3 (UI):**
1. Settings UI with OAuth warning
2. Demo details UI with deployment status
3. Dashboard badges

**Sprint 4 (Polish):**
1. Write detailed documentation (emphasize OAuth!)
2. Add "Test Connection" button
3. Integration testing

---

## Success Criteria

- ✅ OAuth setup is obvious and well-documented
- ✅ 95%+ deployment success rate (after OAuth setup)
- ✅ Clear error messages for all failure modes
- ✅ Status files never corrupted (atomic writes)
- ✅ Local build verification prevents Netlify failures
- ✅ Partial failures handled gracefully with retry
- ✅ Type safety with DemoStatus interface
- ✅ All existing demos unaffected (backward compatible)
