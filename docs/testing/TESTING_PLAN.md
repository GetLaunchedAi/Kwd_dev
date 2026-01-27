# Comprehensive Backend API & Event Testing Plan

## Overview

This document outlines a detailed testing plan for all backend APIs and events in the ClickUp-Cursor automation system. The plan covers unit testing, integration testing, and end-to-end workflow testing.

---

## Coverage Summary

The plan covers:

- **17 API endpoints** with multiple test cases each
- **2 webhook event types** (`taskStatusUpdated`, `taskUpdated`)
- **8 workflow states** and their transitions
- **Error handling scenarios** across all endpoints
- **3 end-to-end workflow scenarios**
- **Performance benchmarks** for all endpoints
- **Security test cases** for authentication and authorization

---

## How to Use

- **Quick automated testing**: Run `.\test-api.ps1`
- **Manual testing**: Follow `MANUAL_TESTING_GUIDE.md` step by step
- **Reference**: Use `TESTING_QUICK_REFERENCE.md` for quick lookups
- **Track progress**: Update test status in this document (checkboxes ⬜ → ✅)

All files are ready to use. The plan is structured to ensure comprehensive coverage of your backend APIs and events.

---

## Table of Contents

1. [API Endpoints Testing](#api-endpoints-testing)
2. [Webhook Events Testing](#webhook-events-testing)
3. [Workflow State Testing](#workflow-state-testing)
4. [Error Handling Testing](#error-handling-testing)
5. [Integration Testing](#integration-testing)
6. [Performance Testing](#performance-testing)
7. [Security Testing](#security-testing)
8. [Test Execution Checklist](#test-execution-checklist)

---

## API Endpoints Testing

### 1. Health Check Endpoint

**Endpoint:** `GET /health`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| H-001 | Basic health check | Returns `{ status: 'ok', timestamp: ISO string }` | ⬜ |
| H-002 | Response time < 100ms | Response received quickly | ⬜ |
| H-003 | Server running check | Can verify server is operational | ⬜ |

**Test Commands:**
```bash
# PowerShell
Invoke-WebRequest -Uri http://localhost:3000/health -Method GET

# cURL
curl http://localhost:3000/health

# Expected Response
{
  "status": "ok",
  "timestamp": "2025-01-XX..."
}
```

---

### 2. OAuth Endpoints

#### 2.1 OAuth Initiation

**Endpoint:** `GET /auth/clickup`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| O-001 | Valid OAuth initiation | Redirects to ClickUp authorization URL | ⬜ |
| O-002 | State parameter generated | URL contains state parameter | ⬜ |
| O-003 | Missing CLICKUP_CLIENT_ID | Returns 500 error with helpful message | ⬜ |
| O-004 | Missing CLICKUP_REDIRECT_URI | Returns 500 error with helpful message | ⬜ |
| O-005 | OAuth URL format correct | URL matches ClickUp OAuth format | ⬜ |

**Test Commands:**
```bash
# Test valid OAuth flow
Invoke-WebRequest -Uri http://localhost:3000/auth/clickup -Method GET -MaximumRedirection 0

# Check redirect location
# Should redirect to: https://app.clickup.com/api/v2/oauth/token?client_id=...
```

#### 2.2 OAuth Callback

**Endpoint:** `GET /auth/clickup/callback`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| O-006 | Valid authorization code | Exchanges code for token, shows success page | ⬜ |
| O-007 | Missing code parameter | Returns 400 error with helpful message | ⬜ |
| O-008 | Invalid authorization code | Returns 500 error | ⬜ |
| O-009 | OAuth error in query | Returns 400 error with error message | ⬜ |
| O-010 | Token saved to file | Token stored in `tokens/clickup-access-token.json` | ⬜ |
| O-011 | Expired authorization code | Handles expiration gracefully | ⬜ |

**Test Commands:**
```bash
# Test with valid code (from ClickUp redirect)
Invoke-WebRequest -Uri "http://localhost:3000/auth/clickup/callback?code=VALID_CODE" -Method GET

# Test with error
Invoke-WebRequest -Uri "http://localhost:3000/auth/clickup/callback?error=access_denied" -Method GET

# Test with missing code
Invoke-WebRequest -Uri "http://localhost:3000/auth/clickup/callback" -Method GET
```

---

### 3. Webhook Endpoint

**Endpoint:** `POST /webhook/clickup`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| W-001 | Valid taskStatusUpdated event | Processes event, returns 200 | ⬜ |
| W-002 | Valid taskUpdated event | Processes event, returns 200 | ⬜ |
| W-003 | Event with trigger status | Starts workflow processing | ⬜ |
| W-004 | Event with non-trigger status | Returns 200 but doesn't process | ⬜ |
| W-005 | Invalid event type | Returns 200 but doesn't process | ⬜ |
| W-006 | Missing task_id | Returns 500 error | ⬜ |
| W-007 | Invalid webhook signature | Returns 200 but doesn't process (if secret configured) | ⬜ |
| W-008 | Non-existent task ID | Handles error gracefully | ⬜ |
| W-009 | Malformed JSON payload | Returns 500 error | ⬜ |
| W-010 | Webhook processing is async | Returns 200 immediately, processes in background | ⬜ |

**Test Payloads:**

```json
// Valid taskStatusUpdated event
{
  "event": "taskStatusUpdated",
  "task_id": "123456789",
  "webhook_id": "webhook_123",
  "history_items": [
    {
      "field": "status",
      "value": {
        "status": "Ready to Code"
      }
    }
  ]
}

// Valid taskUpdated event
{
  "event": "taskUpdated",
  "task_id": "123456789",
  "webhook_id": "webhook_123"
}

// Invalid event type
{
  "event": "taskCreated",
  "task_id": "123456789"
}

// Missing task_id
{
  "event": "taskStatusUpdated",
  "webhook_id": "webhook_123"
}
```

**Test Commands:**
```bash
# Test valid webhook
$body = @{
  event = "taskStatusUpdated"
  task_id = "VALID_TASK_ID"
  webhook_id = "webhook_123"
  history_items = @(
    @{
      field = "status"
      value = @{
        status = "Ready to Code"
      }
    }
  )
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:3000/webhook/clickup -Method POST -Body $body -ContentType "application/json"

# Test invalid event
$body = @{
  event = "taskCreated"
  task_id = "123456789"
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:3000/webhook/clickup -Method POST -Body $body -ContentType "application/json"
```

---

### 4. Approval Endpoints

#### 4.1 Approve Request

**Endpoint:** `GET /approve/:token`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| A-001 | Valid approval token | Approves request, completes workflow, shows success page | ⬜ |
| A-002 | Invalid token | Returns 404 error | ⬜ |
| A-003 | Expired token | Returns 404 error | ⬜ |
| A-004 | Approval with reason | Reason saved in state | ⬜ |
| A-005 | Workflow completion | Branch pushed to GitHub after approval | ⬜ |
| A-006 | Already approved token | Returns 404 (token removed after approval) | ⬜ |
| A-007 | Missing branch name | Handles error gracefully | ⬜ |

**Test Commands:**
```bash
# Test valid approval
Invoke-WebRequest -Uri "http://localhost:3000/approve/VALID_TOKEN" -Method GET

# Test with reason
Invoke-WebRequest -Uri "http://localhost:3000/approve/VALID_TOKEN?reason=Looks%20good" -Method GET

# Test invalid token
Invoke-WebRequest -Uri "http://localhost:3000/approve/invalid_token_12345" -Method GET
```

#### 4.2 Reject Request

**Endpoint:** `GET /reject/:token`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| R-001 | Valid rejection token | Rejects request, shows rejection page | ⬜ |
| R-002 | Invalid token | Returns 404 error | ⬜ |
| R-003 | Expired token | Returns 404 error | ⬜ |
| R-004 | Rejection with reason | Reason displayed on page | ⬜ |
| R-005 | State updated to rejected | Workflow state reflects rejection | ⬜ |
| R-006 | Already rejected token | Returns 404 (token removed after rejection) | ⬜ |

**Test Commands:**
```bash
# Test valid rejection
Invoke-WebRequest -Uri "http://localhost:3000/reject/VALID_TOKEN" -Method GET

# Test with reason
Invoke-WebRequest -Uri "http://localhost:3000/reject/VALID_TOKEN?reason=Needs%20more%20work" -Method GET
```

---

### 5. Workflow Management Endpoints

#### 5.1 Continue Workflow

**Endpoint:** `POST /workflow/continue/:taskId`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| WF-001 | Valid task ID with clientFolder | Continues workflow, runs tests | ⬜ |
| WF-002 | Missing clientFolder | Returns 400 error | ⬜ |
| WF-003 | Invalid task ID | Returns 500 error | ⬜ |
| WF-004 | Task without branch | Returns 500 error | ⬜ |
| WF-005 | Tests run successfully | Test results saved | ⬜ |
| WF-006 | Tests fail | Workflow stops, state updated to ERROR | ⬜ |
| WF-007 | Approval request created | Approval request generated after tests pass | ⬜ |

**Test Commands:**
```bash
# Test valid continuation
$body = @{
  clientFolder = "client-websites/example-client"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/TASK_ID" -Method POST -Body $body -ContentType "application/json"

# Test missing clientFolder
Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/TASK_ID" -Method POST -Body "{}" -ContentType "application/json"
```

---

### 6. Task Management API Endpoints

#### 6.1 Get All Tasks

**Endpoint:** `GET /api/tasks`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-001 | Returns all tasks | Array of task objects | ⬜ |
| T-002 | Empty result | Returns empty array if no tasks | ⬜ |
| T-003 | Task structure correct | Each task has required fields | ⬜ |
| T-004 | Response time acceptable | Returns within 2 seconds | ⬜ |

**Test Commands:**
```bash
Invoke-WebRequest -Uri http://localhost:3000/api/tasks -Method GET | ConvertFrom-Json
```

#### 6.2 Get Incomplete Tasks

**Endpoint:** `GET /api/tasks/incomplete`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-005 | Returns incomplete tasks | Array of incomplete tasks from ClickUp | ⬜ |
| T-006 | Filters completed tasks | No completed tasks in response | ⬜ |
| T-007 | Handles API errors | Returns 500 with error message | ⬜ |
| T-008 | Handles missing token | Returns 500 with error message | ⬜ |

**Test Commands:**
```bash
Invoke-WebRequest -Uri http://localhost:3000/api/tasks/incomplete -Method GET | ConvertFrom-Json
```

#### 6.3 Import Task

**Endpoint:** `POST /api/tasks/import/:taskId`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-009 | Valid task ID | Imports task, initializes state | ⬜ |
| T-010 | Task already exists | Returns 400 with error message | ⬜ |
| T-011 | Invalid task ID | Returns 500 error | ⬜ |
| T-012 | Cannot extract client name | Returns 400 with error message | ⬜ |
| T-013 | Client folder not found | Returns 400 with error message | ⬜ |
| T-014 | Import with triggerWorkflow=true | Starts workflow if status matches | ⬜ |
| T-015 | Import with triggerWorkflow=true, wrong status | Imports but doesn't start workflow | ⬜ |

**Test Commands:**
```bash
# Import task
Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import/TASK_ID" -Method POST -Body "{}" -ContentType "application/json"

# Import and trigger workflow
$body = @{
  triggerWorkflow = $true
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

#### 6.4 Bulk Import Incomplete Tasks

**Endpoint:** `POST /api/tasks/import-incomplete`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-016 | Bulk import success | Returns summary with imported/skipped/errors | ⬜ |
| T-017 | Skips existing tasks | Existing tasks not re-imported | ⬜ |
| T-018 | Handles partial failures | Continues processing other tasks | ⬜ |
| T-019 | Error summary accurate | Errors array contains failed tasks | ⬜ |

**Test Commands:**
```bash
Invoke-WebRequest -Uri http://localhost:3000/api/tasks/import-incomplete -Method POST -Body "{}" -ContentType "application/json"
```

#### 6.5 Get Task Details

**Endpoint:** `GET /api/tasks/:taskId`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-020 | Valid task ID | Returns task state, info, and clientFolder | ⬜ |
| T-021 | Invalid task ID | Returns 404 error | ⬜ |
| T-022 | Task not found | Returns 404 error | ⬜ |
| T-023 | Response structure correct | Contains taskState, taskInfo, clientFolder | ⬜ |

**Test Commands:**
```bash
Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/TASK_ID" -Method GET | ConvertFrom-Json
```

#### 6.6 Get Task Diff

**Endpoint:** `GET /api/tasks/:taskId/diff`

**Test Cases:**

| Test ID | Description | Expected Result | Status |
|---------|-------------|-----------------|--------|
| T-024 | Valid task with branch | Returns change summary | ⬜ |
| T-025 | Task without branch | Returns 400 error | ⬜ |
| T-026 | Invalid task ID | Returns 404 error | ⬜ |
| T-027 | Diff structure correct | Contains files, additions, deletions | ⬜ |

**Test Commands:**
```bash
Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/TASK_ID/diff" -Method GET | ConvertFrom-Json
```

---

## Webhook Events Testing

### Event Types to Test

| Event Type | Description | Test Cases |
|------------|-------------|------------|
| `taskStatusUpdated` | Task status changed | Status matches trigger, doesn't match, invalid status |
| `taskUpdated` | Task updated (general) | Status matches trigger, doesn't match |
| `taskCreated` | Task created | Should be ignored |
| `taskDeleted` | Task deleted | Should be ignored |
| `taskCommentPosted` | Comment added | Should be ignored |

### Webhook Event Scenarios

#### Scenario 1: Valid Status Change to Trigger Status

**Test Steps:**
1. Create test task in ClickUp
2. Change status to "Ready to Code"
3. Verify webhook received
4. Verify workflow started
5. Verify task state updated

**Expected Results:**
- Webhook received and logged
- Task fetched from ClickUp API
- Client name extracted
- Workflow state initialized
- Feature branch created
- Cursor agent triggered

#### Scenario 2: Status Change to Non-Trigger Status

**Test Steps:**
1. Create test task in ClickUp
2. Change status to "In Progress"
3. Verify webhook received
4. Verify workflow NOT started

**Expected Results:**
- Webhook received and logged
- Event processed but workflow not started
- Returns 200 with "Event received but not processed"

#### Scenario 3: Multiple Rapid Status Changes

**Test Steps:**
1. Create test task
2. Rapidly change status multiple times
3. Verify only trigger status starts workflow

**Expected Results:**
- All webhooks received
- Only trigger status processes workflow
- No duplicate workflows started

#### Scenario 4: Webhook with Invalid Signature

**Test Steps:**
1. Send webhook with invalid signature
2. Verify rejection

**Expected Results:**
- Webhook rejected (if secret configured)
- Event not processed
- Warning logged

---

## Workflow State Testing

### Workflow States to Test

| State | Description | Test Cases |
|-------|-------------|------------|
| `PENDING` | Task imported, waiting | Initial state after import |
| `IN_PROGRESS` | Workflow started | After webhook triggers |
| `TESTING` | Running tests | After agent completion |
| `AWAITING_APPROVAL` | Waiting for approval | After tests pass |
| `APPROVED` | Approved, ready to push | After approval |
| `REJECTED` | Rejected | After rejection |
| `COMPLETED` | Workflow complete | After push to GitHub |
| `ERROR` | Error occurred | On any failure |

### State Transition Testing

**Test Matrix:**

| From State | Action | To State | Test ID |
|------------|--------|----------|---------|
| PENDING | Webhook trigger | IN_PROGRESS | ST-001 |
| IN_PROGRESS | Agent completes | TESTING | ST-002 |
| TESTING | Tests pass | AWAITING_APPROVAL | ST-003 |
| TESTING | Tests fail | ERROR | ST-004 |
| AWAITING_APPROVAL | Approval granted | APPROVED | ST-005 |
| AWAITING_APPROVAL | Approval rejected | REJECTED | ST-006 |
| APPROVED | Push to GitHub | COMPLETED | ST-007 |
| Any | Error occurs | ERROR | ST-008 |

---

## Error Handling Testing

### Error Scenarios

| Error Type | Test Case | Expected Behavior |
|------------|-----------|-------------------|
| Network timeout | ClickUp API timeout | Logs error, returns 500 |
| Invalid credentials | OAuth token expired | Handles gracefully, prompts re-auth |
| Missing config | Missing env variables | Server fails to start with clear error |
| File system errors | Cannot write state file | Logs error, continues if possible |
| Git errors | Cannot create branch | Updates state to ERROR |
| Test failures | Tests fail | Stops workflow, updates state |
| Invalid task format | Cannot parse task | Logs error, skips task |

### Error Response Testing

**Test Cases:**

| Test ID | Scenario | Expected HTTP Status | Expected Response |
|---------|----------|---------------------|-------------------|
| E-001 | Invalid endpoint | 404 | Not found |
| E-002 | Missing required param | 400 | Bad request with message |
| E-003 | Server error | 500 | Internal server error |
| E-004 | Invalid token | 404 | Not found or unauthorized |
| E-005 | Rate limiting | 429 | Too many requests (if implemented) |

---

## Integration Testing

### End-to-End Workflow Tests

#### Test 1: Complete Happy Path

**Steps:**
1. Create task in ClickUp: "Update [ClientName] website - Add contact form"
2. Set status to "Ready to Code"
3. Verify webhook received
4. Verify workflow started
5. Wait for agent completion (or manually trigger)
6. Verify tests run
7. Verify approval request created
8. Approve request
9. Verify branch pushed to GitHub
10. Verify state is COMPLETED

**Success Criteria:**
- All steps complete without errors
- State transitions correctly
- Branch exists in GitHub
- Approval email/Slack sent

#### Test 2: Workflow with Test Failure

**Steps:**
1. Create task that will cause test failure
2. Trigger workflow
3. Wait for agent completion
4. Verify tests fail
5. Verify workflow stops
6. Verify state is ERROR
7. Verify notification sent (if configured)

**Success Criteria:**
- Workflow stops at testing phase
- State updated to ERROR
- Error message logged

#### Test 3: Workflow with Rejection

**Steps:**
1. Create task and trigger workflow
2. Complete agent work
3. Tests pass
4. Reject approval
5. Verify state is REJECTED
6. Verify branch NOT pushed

**Success Criteria:**
- Approval rejected
- State is REJECTED
- Branch remains local
- Can retry workflow

#### Test 4: Bulk Import and Process

**Steps:**
1. Import all incomplete tasks
2. Verify tasks imported
3. Change one task status to trigger
4. Verify only that task processes
5. Verify other tasks remain PENDING

**Success Criteria:**
- All tasks imported
- Only trigger task processes
- No interference between tasks

---

## Performance Testing

### Performance Benchmarks

| Endpoint | Target Response Time | Max Acceptable |
|----------|---------------------|----------------|
| GET /health | < 50ms | < 100ms |
| GET /api/tasks | < 500ms | < 2s |
| GET /api/tasks/incomplete | < 5s | < 10s |
| POST /webhook/clickup | < 200ms | < 500ms |
| POST /api/tasks/import/:taskId | < 2s | < 5s |
| POST /api/tasks/import-incomplete | < 30s | < 60s |

### Load Testing

**Test Scenarios:**

| Test ID | Scenario | Expected Result |
|---------|----------|------------------|
| P-001 | 10 concurrent webhooks | All processed correctly |
| P-002 | 100 tasks in bulk import | Completes within timeout |
| P-003 | Multiple workflows simultaneously | No interference |
| P-004 | High API request rate | No crashes or memory leaks |

---

## Security Testing

### Security Test Cases

| Test ID | Scenario | Expected Result |
|---------|----------|------------------|
| S-001 | Webhook signature validation | Invalid signatures rejected |
| S-002 | OAuth state validation | CSRF protection works |
| S-003 | Token expiration | Expired tokens rejected |
| S-004 | SQL injection (if applicable) | Input sanitized |
| S-005 | XSS in task names | Content escaped |
| S-006 | Unauthorized API access | Returns 401/403 |
| S-007 | Rate limiting | Prevents abuse |

---

## Test Execution Checklist

### Pre-Testing Setup

- [ ] Server running on port 3000
- [ ] All environment variables set
- [ ] ClickUp OAuth authorized
- [ ] Webhook configured in ClickUp
- [ ] ngrok running (for webhook testing)
- [ ] Test client folder exists
- [ ] GitHub token configured
- [ ] Test task created in ClickUp

### Test Execution Order

1. **Basic Health Checks**
   - [ ] H-001: Health endpoint
   - [ ] H-002: Response time
   - [ ] H-003: Server status

2. **OAuth Flow**
   - [ ] O-001 to O-011: All OAuth tests

3. **Webhook Events**
   - [ ] W-001 to W-010: All webhook tests

4. **Task Management**
   - [ ] T-001 to T-027: All task API tests

5. **Workflow Management**
   - [ ] WF-001 to WF-007: All workflow tests

6. **Approval Flow**
   - [ ] A-001 to A-007: Approval tests
   - [ ] R-001 to R-006: Rejection tests

7. **Integration Tests**
   - [ ] Complete happy path
   - [ ] Test failure scenario
   - [ ] Rejection scenario
   - [ ] Bulk import scenario

8. **Error Handling**
   - [ ] E-001 to E-005: Error scenarios

9. **Performance Tests**
   - [ ] P-001 to P-004: Performance benchmarks

10. **Security Tests**
    - [ ] S-001 to S-007: Security scenarios

### Test Results Tracking

Create a test results file: `TEST_RESULTS.md`

**Template:**
```markdown
# Test Results - [Date]

## Summary
- Total Tests: X
- Passed: Y
- Failed: Z
- Skipped: W

## Failed Tests
- [Test ID]: [Description] - [Error Message]

## Notes
[Any observations or issues]
```

---

## Automated Testing Scripts

### PowerShell Test Script

Create `test-api.ps1`:

```powershell
# Test script for API endpoints
$baseUrl = "http://localhost:3000"
$results = @()

function Test-Endpoint {
    param($name, $method, $uri, $body = $null, $expectedStatus = 200)
    
    try {
        $params = @{
            Uri = "$baseUrl$uri"
            Method = $method
        }
        
        if ($body) {
            $params.Body = ($body | ConvertTo-Json)
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-WebRequest @params -ErrorAction Stop
        $status = $response.StatusCode
        
        $result = [PSCustomObject]@{
            Test = $name
            Status = if ($status -eq $expectedStatus) { "PASS" } else { "FAIL" }
            Expected = $expectedStatus
            Actual = $status
            Time = (Get-Date).ToString()
        }
        
        $script:results += $result
        Write-Host "✅ $name - Status: $status" -ForegroundColor Green
    }
    catch {
        $result = [PSCustomObject]@{
            Test = $name
            Status = "FAIL"
            Expected = $expectedStatus
            Actual = $_.Exception.Response.StatusCode.value__
            Error = $_.Exception.Message
            Time = (Get-Date).ToString()
        }
        $script:results += $result
        Write-Host "❌ $name - Error: $($_.Exception.Message)" -ForegroundColor Red
    }
}

# Run tests
Write-Host "Starting API Tests..." -ForegroundColor Cyan

Test-Endpoint "Health Check" GET "/health"
Test-Endpoint "Get All Tasks" GET "/api/tasks"
Test-Endpoint "Get Incomplete Tasks" GET "/api/tasks/incomplete"

# Export results
$results | Export-Csv -Path "test-results.csv" -NoTypeInformation
$results | Format-Table
```

---

## Continuous Testing Recommendations

1. **Automated Test Suite**
   - Set up Jest or Mocha for unit tests
   - Use Supertest for API testing
   - Run tests on CI/CD pipeline

2. **Monitoring**
   - Set up health check monitoring
   - Alert on failed webhooks
   - Track API response times

3. **Regular Testing Schedule**
   - Daily: Health checks
   - Weekly: Full API test suite
   - Monthly: End-to-end workflow tests
   - On deployment: Full regression test

---

## Notes

- Update test status (⬜) as tests are completed
- Document any deviations from expected behavior
- Keep test data separate from production data
- Clean up test tasks and branches after testing
- Use test-specific client folders when possible

---

## Test Data Requirements

### Test ClickUp Tasks

Create test tasks with these patterns:
- `[TestClient] - Test Task 1` (for valid client)
- `InvalidTask` (for client name extraction failure)
- `[NonExistentClient] - Test Task` (for folder not found)

### Test Client Folders

Ensure these exist:
- `client-websites/test-client` (for valid tests)
- Use existing client folders for integration tests

---

**Last Updated:** [Date]
**Version:** 1.0
**Maintained By:** Development Team

