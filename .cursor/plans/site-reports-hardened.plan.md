# Site Reports: Share Links + Scheduled Reports + Uptime Monitoring (Hardened Plan)

> **Purpose**: Add a “Reports” tab that supports:
> 1) **Share links** for report artifacts (tokenized, expiring)
> 2) **Scheduled reports** (**bi-weekly** or **monthly**)
> 3) **Uptime monitoring** (rolling 24h + 7d stats)
>
> This updated plan explicitly addresses edge cases: missing artifacts, atomic writes, DST/timezone, server downtime, duplicate enqueues, rate limiting, disk growth, and safe public sharing.

---

## 0) Ground Truth From Codebase (confirmed)

- Backend: **Node + Express**, entrypoint **`src/server.ts`**.
- Frontend: vanilla **`public/`** HTML/JS calling **`/api/...`** via fetch.
- Sites discovered by scanning **`client-websites/`** (`src/utils/clientScanner.ts`).
- Production domain stored per site: **`client-websites/<slug>/src/_data/client.json`** → `domain`.
- Local serve/build helper exists: **`src/utils/visualTesting.ts`** (`VisualTester`).
- Existing file-based queue pattern exists (`src/cursor/agentQueue.ts`).
- Session token auth exists (`tokens/sessions.json`, sessionManager).
- Tokenized “anyone with link” pattern exists with expiry (approval flow).

---

## 1) Explicit Decisions (to remove ambiguity)

### 1.1 Scheduled run “catch-up” policy (server downtime)

If the server is down at `nextRunAt`:

- On next tick after restart, **run exactly once** per schedule (no backfill of multiple missed periods).
- Then compute a fresh `nextRunAt` from the new `lastRunAt`.

Rationale: prevents burst jobs after long downtime and keeps behavior predictable.

### 1.2 Monthly cadence rule

“Monthly” means **add 1 calendar month** from the schedule’s base date/time:

- If target month lacks the day (e.g., 31st), **clamp to last day of month**.
- Next month re-attempts the **original day** (not permanently clamped).

Example: Jan 31 → Feb 28 (clamp) → Mar 31 (restore).

### 1.3 Timezone + DST

All schedule computations and displays use:

- `America/Detroit` (IANA timezone)
- Ambiguous DST times:
- If a local time repeats (fall back), choose the **first occurrence**.
- If a local time doesn’t exist (spring forward), shift forward to the **next valid time**.

(Implementation uses a timezone-aware library; see Track 1.)

### 1.4 Uptime classification

Each uptime check results in one of:

- `UP` (HTTP 200–399, final URL resolves)
- `DOWN` (HTTP 400–599 OR explicit “site reachable but erroring”)
- `UNKNOWN` (monitor-side failures: DNS errors, TLS handshake errors, local network error, timeout)

Uptime % in UI:

- Primary: **UP / (UP + DOWN)** (UNKNOWN excluded; displayed separately)
- Secondary: show UNKNOWN count to avoid hiding monitor issues.

### 1.5 Public sharing scope (avoid leaking sensitive data)

Share links serve a **safe public view** by default:

- Lighthouse **HTML** + a normalized `summary.json`
- Excludes raw internal logs, stack traces, and full dependency audit output unless explicitly enabled by an admin-only flag.

### 1.6 Retention (disk growth)

Default retention:

- Keep last **10 runs per site per reportType**
- Keep uptime points for last **7 days** only (rolling window)
- Prune expired share tokens automatically on read + daily prune.

---

## 2) New Data & Storage Layout (file-based, atomic writes)

### 2.1 New state paths

Create:

- `state/reports/`
- `runs/<siteSlug>/<runId>/`
 - `summary.json`
 - `performance/` (lighthouse html/json)
 - `security/` (audit summaries)
 - `meta.json` (run metadata: start/end, trigger, status)
- `state/report-jobs/`
- queue folders: `queue/ running/ done/ failed/` (same pattern as agentQueue)
- `state/share-links.json`
- `state/schedules.json`
- `state/uptime/<siteSlug>.json`

### 2.2 Atomic write rule (important)

All JSON writes must be atomic:
1) write to temp file `file.tmp.<pid>.<ts>`
2) `fsync` (best effort)
3) rename → final filename

This prevents corrupted JSON on crashes.

---

## 3) API Endpoints (explicit)

### 3.1 Report runs (manual)

- `POST /api/reports/run`
- body: `{ siteSlug, reportType: "performance"|"security" }`
- returns: `{ jobId }`
- `GET /api/reports/jobs/:jobId`
- returns: `{ status, siteSlug, reportType, startedAt, finishedAt, error? }`
- `GET /api/reports/:siteSlug/latest?type=performance|security`
- returns: `{ runId, summary, artifacts }`

### 3.2 Share links

- `POST /api/reports/share`
- body: `{ siteSlug, runId, reportType, expiresInDays?: number, publicView?: boolean }`
- returns: `{ shareUrl, token, expiresAt }`
- `GET /r/:token` (public)
- serves a minimal viewer HTML that embeds/links safe artifacts
- expired/missing token returns **404** (do not reveal existence)
- expired tokens are pruned opportunistically

### 3.3 Scheduling

- `POST /api/schedules`
- body: `{ siteSlug, cadence: "biweekly"|"monthly", reportTypes: ["performance","security"], hour?: number, minute?: number }`
- `GET /api/schedules?siteSlug=...`
- `PATCH /api/schedules/:id` (enable/disable/change cadence/types)
- `DELETE /api/schedules/:id`

### 3.4 Uptime

- `GET /api/uptime/:siteSlug`
- returns: `{ window24h, window7d, unknown24h, unknown7d, avgLatencyMs24h, avgLatencyMs7d, lastCheckedAt, lastDownAt? }`

---

## 4) Core Edge Cases & How We Handle Them (checklist)

### 4.1 Missing / invalid domain in `client.json`

- If `domain` missing or invalid:
- Uptime monitor marks site as **UNCONFIGURED** and skips checks
- UI shows “Domain not set” with link to the file path

### 4.2 Domain normalization

- Accept `domain` values like:
- `example.com`, `www.example.com`, `https://example.com`, `example.com/path`
- Normalize to a check URL:
- If protocol missing → assume `https://`
- Strip trailing spaces
- Preserve path if present
- Record `finalUrl` after redirects; if final hostname differs, surface warning

### 4.3 Rate limiting / bot protection

- Add `User-Agent: KWD-UptimeMonitor/1.0`
- Concurrency limit (e.g., 3 parallel checks)
- Backoff if repeated 429/403:
- mark as `UNKNOWN` and increase interval temporarily for that site

### 4.4 Duplicate enqueues

- Schedule tick and manual clicks can collide.
- Add dedupe key: `{siteSlug}:{reportType}:{dayBucket}` for scheduled jobs
- If a job of same dedupe key is running/queued, return existing jobId.

### 4.5 Multi-instance server protection

If there is any chance of multiple server processes on the *same filesystem*:

- Use a global lock file `state/locks/scheduler.lock` for schedule tick.
- Use per-site lock `state/locks/uptime.<siteSlug>.lock` to prevent overlapping checks.

(Does not protect if instances run on separate machines without shared FS.)

### 4.6 Artifact not found when serving share link

- If run folder deleted/pruned:
- return 404
- prune token entry automatically

### 4.7 Disk growth

- Retention job runs daily at startup + every 24h:
- delete old report runs beyond 10
- drop uptime points older than 7 days
- prune expired share tokens

### 4.8 JSON corruption resilience

- On read, validate schema; if invalid:
- back up file to `.corrupt.<ts>`
- recreate empty default file
- log event

### 4.9 Long-running/hung report jobs

- Hard timeouts:
- Lighthouse: 5–10 minutes
- Security scan: 2–5 minutes
- On timeout:
- mark job failed with reason `TIMEOUT`
- ensure VisualTester process is killed (finally block)

---

## 5) Shared Contracts (create first so agents can work in parallel safely)

Create `src/reports/contracts.ts` **(owned by Track 1)** with:

- `ReportType = "performance" | "security"`
- `Cadence = "biweekly" | "monthly"`
- Interfaces:
- `ReportJob`, `ReportRunMeta`, `ShareLink`, `Schedule`, `UptimePoint`, `UptimeSummary`
- Utility signatures:
- `enqueueReportJob(...)`
- `getLatestRun(...)`
- `computeNextRunAt(...)`
- `normalizeDomainToUrl(...)`

**Rule**: Tracks 2–5 must not change contracts without coordination.

---

# IMPLEMENTATION: 7 TRACKS (5 parallel + 2 verification)

## Track 1 (Agent A): Storage + Locks + Time Utilities (FOUNDATION)

**Goal**: Provide safe primitives that all other tracks build on.

**Owns files**

- `src/storage/jsonStore.ts` (atomic read/write, schema validation hooks)
- `src/storage/locks.ts` (lock file helper: acquire/release with stale timeout)
- `src/time/timeUtils.ts` (timezone-aware date calc)
- `src/reports/contracts.ts` (shared interfaces + small helpers)
- `state/locks/` folder creation

**Key tasks**

1. Implement `readJsonSafe(path, defaultValue, validateFn?)`
2. Implement `writeJsonAtomic(path, data)`
3. Implement lock helper:

- `withFileLock(lockPath, fn, {staleMs})`

4. Implement schedule math with timezone + DST rules:

- `computeNextRunAt(schedule, baseTime)`

5. Add schema validators (lightweight):

- manual validation functions OR introduce `zod` if acceptable

**Acceptance**

- Can survive kill/restart without corrupting JSON
- Unit tests (or simple node script) verifying:
- atomic write works
- schedule math handles Jan 31 monthly correctly
- DST transition does not crash

---

## Track 2 (Agent B): Share Links (token persistence + safe public viewer)

**Goal**: Generate expiring share URLs and safely serve public report artifacts.

**Owns files**

- `src/reports/shareLinkManager.ts`
- `src/routes/shareRoutes.ts` (Express router)
- `public/report-viewer.html` + `public/report-viewer.js` (minimal, safe display)

**Key tasks**

1. Persist share links in `state/share-links.json` via jsonStore
2. Token generation: 64-char hex
3. Resolve token → map to run artifacts (safe allowlist)
4. Serve `GET /r/:token`:

- validate expiry
- validate run exists
- serve viewer HTML that loads:
 - `summary.json`
 - `lighthouse.report.html` (if performance)
 - security `public-summary.json` (if security)

5. Prune expired tokens on read

**Acceptance**

- Share links still work after server restart
- Expired links return 404
- No path traversal: only reads within `state/reports/runs/<siteSlug>/<runId>/...`

---

## Track 3 (Agent C): Scheduling (CRUD + tick loop + dedupe + catch-up)

**Goal**: Bi-weekly/monthly schedules that safely trigger report jobs.

**Owns files**

- `src/reports/scheduleManager.ts` (CRUD, persistence)
- `src/reports/scheduleService.ts` (tick loop)
- `src/routes/scheduleRoutes.ts` (Express router)

**Key tasks**

1. CRUD for schedules stored in `state/schedules.json`
2. Compute `nextRunAt` using Track 1 time utils
3. Tick loop every 60s:

- acquire `state/locks/scheduler.lock`
- for each enabled schedule:
 - if due, enqueue report types (via Track 5 enqueue API)
 - apply dedupe to prevent repeats
 - set `lastRunAt`, `nextRunAt`

4. Catch-up policy: run once if overdue

**Acceptance**

- No duplicate runs for same due window
- Restart doesn’t lose schedules
- Due schedules fire after downtime exactly once

---

## Track 4 (Agent D): Uptime Monitor (rolling window + rate limiting + summaries)

**Goal**: Record uptime points safely and expose summary API.

**Owns files**

- `src/uptime/domainResolver.ts` (read `client.json`, normalize URL)
- `src/uptime/uptimeStore.ts` (rolling storage + aggregates)
- `src/uptime/uptimeMonitor.ts` (interval + concurrency)
- `src/routes/uptimeRoutes.ts`

**Key tasks**

1. Read and normalize domain:

- handle missing/invalid values gracefully

2. Monitor loop:

- every 5 minutes (configurable)
- stagger sites with jitter to avoid burst
- concurrency limit

3. Store points (timestamp, status UP/DOWN/UNKNOWN, latency, httpStatus, finalUrl)
4. Keep last 7 days; compute 24h and 7d aggregates
5. API returns summary + unknown counts

**Acceptance**

- No unbounded growth
- “UNKNOWN” handled separately
- Resistant to 429/403 rate limits with backoff

---

## Track 5 (Agent E): Report Queue + Runners + Retention

**Goal**: A unified queue for report jobs and retention/pruning.

**Owns files**

- `src/reports/reportQueue.ts` (queue folders: queue/running/done/failed)
- `src/reports/reportRunner.ts` (performance + security runners)
- `src/reports/retentionService.ts` (daily prune)
- `src/routes/reportRoutes.ts` (`/api/reports/run`, `/api/reports/jobs/:id`, latest)

**Key tasks**

1. Implement file-based report queue (copy pattern from `src/cursor/agentQueue.ts`)

- dedupe support
- job status persistence (`meta.json`)

2. Performance runner:

- start site via `VisualTester`
- run Lighthouse (CLI) against local URL
- output to `state/reports/runs/.../performance/`
- generate normalized `summary.json`

3. Security runner (public-safe by default):

- if package.json exists: `npm audit --json` (timeout)
- parse into severity counts
- optionally header checks against production URL
- write `security/public-summary.json` and keep raw audit internal-only

4. Retention:

- keep last 10 runs per site/type
- prune expired share tokens (can call Track 2 helper or re-implement by reading file)

**Acceptance**

- Queue survives restart
- Jobs time out and clean up processes
- “latest” endpoint returns correct most recent completed run

---

# Track 6 (Agent F): Frontend Implementation + Manual Verification (starts after Tracks 1–5)

**Goal**: Add “Reports” tab UI and ensure it works end-to-end.

**Owns files**

- `public/clients.html` (or the relevant page)
- `public/clients.js` (or the relevant JS module)
- any new `public/reports.js` helper

**Key tasks**

1. UI sections:

- Run Performance / Run Security buttons
- Scheduling dropdown: Off / Bi-weekly / Monthly
- Type checkboxes (Perf/Sec)
- Uptime card (24h + 7d + unknown)
- Latest run list + Share button + Copy link

2. UX error handling:

- show “Domain missing” for uptime
- show “Report not available (pruned)” for share attempt
- show job status polling for manual runs

3. Validate with 2–3 real sites:

- one with valid domain
- one missing domain
- one with package.json for audit

**Acceptance**

- No console errors
- Share link can be generated and opened in incognito
- Scheduling can be created/updated/disabled from UI

---

# Track 7 (Agent G): Backend Integration + Automated/Structured Verification (starts after Tracks 1–5; can run alongside Track 6 safely)

**Goal**: Wire everything in `src/server.ts`, confirm middleware/auth, add sanity tests/scripts.

**Owns files**

- `src/server.ts` (minimal edits: register routers + start services)
- `src/config/reporting.ts` (new config defaults)
- `scripts/verify-reports.mjs` (optional) quick verification runner

**Key tasks**

1. Register routers:

- `reportRoutes`, `shareRoutes`, `scheduleRoutes`, `uptimeRoutes`

2. Ensure correct auth:

- `/api/*` requires session middleware
- `/r/:token` is public

3. Start background services:

- `ScheduleService.start()`
- `UptimeMonitor.start()`
- `RetentionService.start()` (daily)

4. Add backend verification checklist:

- create schedule, force due, confirm enqueue
- generate share link, confirm public view
- confirm uptime points written and aggregated

5. Validate locking works:

- run two processes briefly (if feasible) and ensure scheduler doesn’t double-run

**Acceptance**

- All routes respond correctly
- Restart preserves schedules/share tokens/jobs
- No duplicate scheduled runs under normal conditions

---

## Parallel Safety Rules (so Tracks 1–5 can work concurrently)

- **Track 1 owns contracts + storage utilities**. Others depend on these APIs.
- Tracks 2–5 each own separate routers and services. They must avoid editing `src/server.ts`.
- Track 7 is the *only* track that edits `src/server.ts` (integration point).
- If a shared config file is needed, Track 7 owns it.
- If any new dependency is added (e.g., a timezone library), Track 1 owns package.json changes and announces it immediately.

---

## Final Verification Matrix (what must be tested before merge)

1. **Manual run** performance → job completes → latest shows summary → share link opens.
2. **Manual run** security → public summary generated → share link opens.
3. **Schedule bi-weekly** created → due-run triggers once → nextRunAt correct.
4. **Schedule monthly** created on 31st → clamps → next month restores day.
5. **Uptime**:

- valid domain: produces points + 24h/7d summaries
- invalid/missing domain: UI shows unconfigured, no crashes
- repeated 429/403: monitor backs off and marks UNKNOWN

6. **Retention**:

- run >10 reports → older pruned
- share link to pruned run → returns 404 and token pruned

---

## Notes / Non-Goals (for this iteration)

- True 24/7 uptime monitoring when your server is offline (can add GitHub Actions later).
- Multi-region monitoring (single origin only).
- Deep penetration testing (security report is static + dependency + header posture).