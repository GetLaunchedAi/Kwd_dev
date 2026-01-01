# Testing Quick Reference

Quick reference guide for testing backend APIs and events.

---

## Quick Test Commands

### Health Check
```powershell
Invoke-WebRequest http://localhost:3000/health
```

### Get All Tasks
```powershell
Invoke-WebRequest http://localhost:3000/api/tasks | ConvertFrom-Json
```

### Import Task
```powershell
$body = @{ triggerWorkflow = $false } | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

### Continue Workflow
```powershell
$body = @{ clientFolder = "client-websites/test-client" } | ConvertTo-Json
Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

### Test Webhook
```powershell
$body = @{
    event = "taskStatusUpdated"
    task_id = "TASK_ID"
    webhook_id = "webhook_test"
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:3000/webhook/clickup -Method POST -Body $body -ContentType "application/json"
```

---

## API Endpoints Summary

| Method | Endpoint | Purpose | Expected Status |
|--------|----------|---------|----------------|
| GET | `/health` | Health check | 200 |
| GET | `/auth/clickup` | OAuth initiation | 302 |
| GET | `/auth/clickup/callback` | OAuth callback | 200/400 |
| POST | `/webhook/clickup` | Webhook receiver | 200 |
| GET | `/approve/:token` | Approve request | 200/404 |
| GET | `/reject/:token` | Reject request | 200/404 |
| POST | `/workflow/continue/:taskId` | Continue workflow | 200/400/500 |
| GET | `/api/tasks` | Get all tasks | 200 |
| GET | `/api/tasks/incomplete` | Get incomplete tasks | 200 |
| POST | `/api/tasks/import/:taskId` | Import task | 200/400/500 |
| POST | `/api/tasks/import-incomplete` | Bulk import | 200 |
| GET | `/api/tasks/:taskId` | Get task details | 200/404 |
| GET | `/api/tasks/:taskId/diff` | Get task diff | 200/400/404 |

---

## Webhook Events

| Event Type | Processed? | Notes |
|------------|------------|-------|
| `taskStatusUpdated` | ✅ Yes | If status matches trigger |
| `taskUpdated` | ✅ Yes | If status matches trigger |
| `taskCreated` | ❌ No | Ignored |
| `taskDeleted` | ❌ No | Ignored |
| `taskCommentPosted` | ❌ No | Ignored |

**Trigger Status:** `Ready to Code` (configurable in `config/config.json`)

---

## Workflow States

| State | Description | Next States |
|-------|-------------|-------------|
| `PENDING` | Task imported | `IN_PROGRESS` |
| `IN_PROGRESS` | Workflow started | `TESTING`, `ERROR` |
| `TESTING` | Running tests | `AWAITING_APPROVAL`, `ERROR` |
| `AWAITING_APPROVAL` | Waiting for approval | `APPROVED`, `REJECTED` |
| `APPROVED` | Approved | `COMPLETED` |
| `REJECTED` | Rejected | (can retry) |
| `COMPLETED` | Workflow complete | (final) |
| `ERROR` | Error occurred | (can retry) |

---

## Test Checklist

### Pre-Testing
- [ ] Server running (`npm start`)
- [ ] ngrok running (for webhooks)
- [ ] OAuth authorized
- [ ] Webhook configured
- [ ] Test client folder exists

### Basic Tests
- [ ] Health check works
- [ ] OAuth flow works
- [ ] Webhook receives events
- [ ] Task import works
- [ ] Approval flow works

### Integration Tests
- [ ] Complete workflow (webhook → agent → tests → approval → push)
- [ ] Test failure handling
- [ ] Rejection handling
- [ ] Error recovery

---

## Common Test Scenarios

### Scenario 1: Happy Path
1. Create task: `[TestClient] - Test Task`
2. Set status: "Ready to Code"
3. Verify webhook → workflow → tests → approval → push

### Scenario 2: Test Failure
1. Create task that fails tests
2. Verify workflow stops at testing
3. Verify state is ERROR

### Scenario 3: Rejection
1. Complete workflow to approval
2. Reject approval
3. Verify state is REJECTED
4. Verify branch not pushed

---

## Running Automated Tests

```powershell
# Run automated test script
.\test-api.ps1

# With custom base URL
.\test-api.ps1 -BaseUrl "http://localhost:3000"

# With verbose output
.\test-api.ps1 -Verbose

# Custom output file
.\test-api.ps1 -OutputFile "my-results.csv"
```

---

## Expected Response Times

| Endpoint | Target | Max |
|----------|--------|-----|
| `/health` | < 50ms | < 100ms |
| `/api/tasks` | < 500ms | < 2s |
| `/api/tasks/incomplete` | < 5s | < 10s |
| `/webhook/clickup` | < 200ms | < 500ms |
| `/api/tasks/import/:taskId` | < 2s | < 5s |

---

## Error Codes Reference

| Code | Meaning | Common Causes |
|------|---------|---------------|
| 200 | Success | - |
| 302 | Redirect | OAuth flow |
| 400 | Bad Request | Missing/invalid parameters |
| 404 | Not Found | Invalid token/task ID |
| 500 | Server Error | Internal error, check logs |

---

## Test Data Requirements

### Test Tasks
- Format: `[ClientName] - Description`
- Example: `[TestClient] - Add contact form`
- Status: "Ready to Code" (to trigger workflow)

### Test Client Folders
- Must exist: `client-websites/test-client`
- Or use existing client folders

---

## Quick Troubleshooting

| Issue | Solution |
|-------|----------|
| Server not responding | Check `npm start`, check port 3000 |
| Webhook not received | Check ngrok, verify webhook URL |
| OAuth fails | Check env variables, verify credentials |
| Import fails | Check task name format, verify client folder |
| Tests fail | Check test framework, verify test files |

---

## Files Reference

- **TESTING_PLAN.md** - Comprehensive testing plan
- **MANUAL_TESTING_GUIDE.md** - Step-by-step manual testing
- **test-api.ps1** - Automated test script
- **TESTING_QUICK_REFERENCE.md** - This file

---

**Last Updated:** [Date]

