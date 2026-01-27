# Manual Testing Guide

This guide provides step-by-step instructions for manually testing all backend APIs and events.

---

## Prerequisites

Before starting, ensure:

- [ ] Server is running: `npm start` or `npm run dev`
- [ ] Server accessible at `http://localhost:3000`
- [ ] ngrok is running (for webhook testing): `npx ngrok http 3000`
- [ ] ClickUp OAuth is authorized (visit `/auth/clickup` once)
- [ ] Webhook is configured in ClickUp
- [ ] Test client folder exists: `client-websites/test-client`
- [ ] Environment variables are set in `.env` file
- [ ] GitHub token is configured

---

## Quick Test Commands

### PowerShell Commands

```powershell
# Health check
Invoke-WebRequest -Uri http://localhost:3000/health

# Get all tasks
Invoke-WebRequest -Uri http://localhost:3000/api/tasks | ConvertFrom-Json

# Get incomplete tasks
Invoke-WebRequest -Uri http://localhost:3000/api/tasks/incomplete | ConvertFrom-Json
```

### cURL Commands

```bash
# Health check
curl http://localhost:3000/health

# Get all tasks
curl http://localhost:3000/api/tasks

# Get incomplete tasks
curl http://localhost:3000/api/tasks/incomplete
```

---

## Section 1: Health Check Testing

### Test 1.1: Basic Health Check

**Steps:**
1. Open browser or use command line
2. Navigate to: `http://localhost:3000/health`
3. Verify response

**Expected Result:**
```json
{
  "status": "ok",
  "timestamp": "2025-01-XX..."
}
```

**Verification:**
- ✅ Status is "ok"
- ✅ Timestamp is valid ISO format
- ✅ Response time < 100ms

---

## Section 2: OAuth Flow Testing

### Test 2.1: OAuth Initiation

**Steps:**
1. Open browser
2. Navigate to: `http://localhost:3000/auth/clickup`
3. Observe redirect

**Expected Result:**
- Redirects to ClickUp authorization page
- URL contains `client_id` parameter
- URL contains `redirect_uri` parameter
- URL contains `state` parameter

**Verification:**
- ✅ Redirect occurs
- ✅ ClickUp authorization page loads
- ✅ Can see authorization request

### Test 2.2: OAuth Callback - Success

**Steps:**
1. Complete OAuth flow in ClickUp
2. Click "Authorize"
3. Observe redirect back to callback URL

**Expected Result:**
- Redirects to `/auth/clickup/callback?code=...`
- Shows success page
- Token saved to `tokens/clickup-access-token.json`

**Verification:**
- ✅ Success page displayed
- ✅ Token file exists
- ✅ Token file contains valid access token

### Test 2.3: OAuth Callback - Error

**Steps:**
1. Navigate to: `http://localhost:3000/auth/clickup/callback?error=access_denied`
2. Observe response

**Expected Result:**
- Shows error page
- Displays error message
- Provides link to try again

**Verification:**
- ✅ Error page displayed
- ✅ Error message shown
- ✅ Retry link works

### Test 2.4: OAuth Callback - Missing Code

**Steps:**
1. Navigate to: `http://localhost:3000/auth/clickup/callback`
2. Observe response

**Expected Result:**
- Shows error page
- Message: "No authorization code received"
- Provides link to try again

**Verification:**
- ✅ Error page displayed
- ✅ Appropriate error message
- ✅ Retry link works

---

## Section 3: Webhook Event Testing

### Test 3.1: Valid Status Change Webhook

**Prerequisites:**
- Test task created in ClickUp
- Task name format: `[TestClient] - Test Task`
- Task status can be changed

**Steps:**
1. Note the task ID from ClickUp
2. Change task status to "Ready to Code" in ClickUp
3. Check server logs
4. Verify webhook received

**Expected Result:**
- Server logs show: "Received ClickUp webhook"
- Server logs show: "Task [ID] status changed to trigger status: Ready to Code"
- Server logs show: "Starting workflow for task: [ID]"
- Response: 200 OK

**Verification:**
- ✅ Webhook received
- ✅ Task fetched from ClickUp
- ✅ Workflow started
- ✅ Task state initialized

**Check Logs:**
```bash
# Watch logs in real-time
# Look for:
# - "Received ClickUp webhook"
# - "Received webhook event: taskStatusUpdated"
# - "Starting workflow for task: [ID]"
```

### Test 3.2: Non-Trigger Status Webhook

**Steps:**
1. Change task status to "In Progress" (or any non-trigger status)
2. Check server logs
3. Verify webhook received but not processed

**Expected Result:**
- Server logs show: "Received ClickUp webhook"
- Server logs show: "Event received but not processed"
- Response: 200 OK
- Workflow NOT started

**Verification:**
- ✅ Webhook received
- ✅ Event not processed (status doesn't match)
- ✅ No workflow started

### Test 3.3: Invalid Event Type

**Steps:**
1. Send manual webhook with invalid event type:

```powershell
$body = @{
    event = "taskCreated"
    task_id = "test_task_123"
    webhook_id = "webhook_test"
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:3000/webhook/clickup -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
- Response: 200 OK
- Message: "Event received but not processed"
- No workflow started

**Verification:**
- ✅ Webhook received
- ✅ Event ignored (wrong type)
- ✅ No errors

### Test 3.4: Webhook with Missing task_id

**Steps:**
1. Send webhook without task_id:

```powershell
$body = @{
    event = "taskStatusUpdated"
    webhook_id = "webhook_test"
} | ConvertTo-Json

Invoke-WebRequest -Uri http://localhost:3000/webhook/clickup -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
- Response: 500 Internal Server Error
- Error logged in server

**Verification:**
- ✅ Error handled gracefully
- ✅ Error logged

---

## Section 4: Task Management API Testing

### Test 4.1: Get All Tasks

**Steps:**
1. Open browser or use command line
2. Navigate to: `http://localhost:3000/api/tasks`
3. Verify response

**Expected Result:**
```json
[
  {
    "taskId": "...",
    "taskState": {...},
    "taskInfo": {...},
    "clientFolder": "..."
  },
  ...
]
```

**Verification:**
- ✅ Returns array of tasks
- ✅ Each task has required fields
- ✅ Response time < 2 seconds

### Test 4.2: Get Incomplete Tasks

**Steps:**
1. Navigate to: `http://localhost:3000/api/tasks/incomplete`
2. Verify response

**Expected Result:**
- Returns array of incomplete tasks from ClickUp
- Tasks filtered (no completed tasks)

**Verification:**
- ✅ Returns tasks from ClickUp
- ✅ No completed tasks in response
- ✅ Response time < 10 seconds

### Test 4.3: Import Single Task

**Prerequisites:**
- Valid ClickUp task ID
- Task name format: `[ClientName] - Description`
- Client folder exists

**Steps:**
1. Get a task ID from ClickUp
2. Send POST request:

```powershell
$body = @{
    triggerWorkflow = $false
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
```json
{
  "message": "Task [ID] imported successfully",
  "taskId": "...",
  "taskName": "...",
  "workflowStarted": false
}
```

**Verification:**
- ✅ Task imported
- ✅ Task state initialized
- ✅ Task appears in `/api/tasks`

### Test 4.4: Import Task and Trigger Workflow

**Steps:**
1. Get task ID with status "Ready to Code"
2. Send POST request:

```powershell
$body = @{
    triggerWorkflow = $true
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
```json
{
  "message": "Task [ID] imported and workflow started",
  "taskId": "...",
  "workflowStarted": true
}
```

**Verification:**
- ✅ Task imported
- ✅ Workflow started
- ✅ Check server logs for workflow progress

### Test 4.5: Import Task - Already Exists

**Steps:**
1. Import a task (Test 4.3)
2. Try to import the same task again
3. Verify error

**Expected Result:**
- Response: 400 Bad Request
- Error: "Task already exists"

**Verification:**
- ✅ Error returned
- ✅ Task not duplicated

### Test 4.6: Import Task - Invalid Client Name

**Steps:**
1. Get task with name that doesn't match pattern
2. Try to import
3. Verify error

**Expected Result:**
- Response: 400 Bad Request
- Error: "Could not extract client name"

**Verification:**
- ✅ Error returned
- ✅ Helpful error message

### Test 4.7: Bulk Import Incomplete Tasks

**Steps:**
1. Send POST request:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/tasks/import-incomplete" -Method POST -Body "{}" -ContentType "application/json"
```

**Expected Result:**
```json
{
  "total": 10,
  "imported": 8,
  "skipped": 2,
  "errors": []
}
```

**Verification:**
- ✅ Summary returned
- ✅ Correct counts
- ✅ Errors array populated if any failures

### Test 4.8: Get Task Details

**Prerequisites:**
- Task already imported

**Steps:**
1. Get task ID from imported tasks
2. Navigate to: `http://localhost:3000/api/tasks/TASK_ID`
3. Verify response

**Expected Result:**
```json
{
  "taskState": {...},
  "taskInfo": {...},
  "clientFolder": "..."
}
```

**Verification:**
- ✅ Task details returned
- ✅ All required fields present

### Test 4.9: Get Task Details - Not Found

**Steps:**
1. Navigate to: `http://localhost:3000/api/tasks/invalid_task_id_12345`
2. Verify error

**Expected Result:**
- Response: 404 Not Found
- Error: "Task not found"

**Verification:**
- ✅ Error returned
- ✅ Appropriate status code

### Test 4.10: Get Task Diff

**Prerequisites:**
- Task with branch created

**Steps:**
1. Get task ID with branch
2. Navigate to: `http://localhost:3000/api/tasks/TASK_ID/diff`
3. Verify response

**Expected Result:**
```json
{
  "files": [...],
  "additions": 10,
  "deletions": 5,
  "summary": "..."
}
```

**Verification:**
- ✅ Diff returned
- ✅ File changes listed
- ✅ Summary provided

### Test 4.11: Get Task Diff - No Branch

**Steps:**
1. Get task ID without branch
2. Navigate to: `http://localhost:3000/api/tasks/TASK_ID/diff`
3. Verify error

**Expected Result:**
- Response: 400 Bad Request
- Error: "No branch found for this task"

**Verification:**
- ✅ Error returned
- ✅ Helpful error message

---

## Section 5: Workflow Management Testing

### Test 5.1: Continue Workflow - Valid

**Prerequisites:**
- Task in IN_PROGRESS state
- Branch created
- Agent work completed

**Steps:**
1. Get task ID and client folder
2. Send POST request:

```powershell
$body = @{
    clientFolder = "client-websites/test-client"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/TASK_ID" -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
- Response: 200 OK
- Message: "Workflow continued for task [ID]"
- Tests run
- Approval request created

**Verification:**
- ✅ Workflow continued
- ✅ State updated to TESTING
- ✅ Tests executed
- ✅ Approval request created
- ✅ Notification sent (if configured)

### Test 5.2: Continue Workflow - Missing clientFolder

**Steps:**
1. Send POST without clientFolder:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/TASK_ID" -Method POST -Body "{}" -ContentType "application/json"
```

**Expected Result:**
- Response: 400 Bad Request
- Error: "clientFolder is required"

**Verification:**
- ✅ Error returned
- ✅ Helpful error message

### Test 5.3: Continue Workflow - Invalid Task ID

**Steps:**
1. Send POST with invalid task ID:

```powershell
$body = @{
    clientFolder = "client-websites/test-client"
} | ConvertTo-Json

Invoke-WebRequest -Uri "http://localhost:3000/workflow/continue/invalid_task_id" -Method POST -Body $body -ContentType "application/json"
```

**Expected Result:**
- Response: 500 Internal Server Error
- Error logged

**Verification:**
- ✅ Error handled
- ✅ Error logged

---

## Section 6: Approval Flow Testing

### Test 6.1: Approve Request - Valid Token

**Prerequisites:**
- Approval request created (from workflow)
- Valid approval token

**Steps:**
1. Get approval token from email/Slack or state file
2. Navigate to: `http://localhost:3000/approve/TOKEN`
3. Verify approval

**Expected Result:**
- Success page displayed
- Message: "Changes Approved"
- Branch pushed to GitHub
- State updated to COMPLETED

**Verification:**
- ✅ Approval successful
- ✅ Branch exists in GitHub
- ✅ State is COMPLETED
- ✅ Workflow complete

### Test 6.2: Approve Request - With Reason

**Steps:**
1. Navigate to: `http://localhost:3000/approve/TOKEN?reason=Looks%20good`
2. Verify approval with reason

**Expected Result:**
- Approval successful
- Reason saved in state

**Verification:**
- ✅ Approval successful
- ✅ Reason stored

### Test 6.3: Approve Request - Invalid Token

**Steps:**
1. Navigate to: `http://localhost:3000/approve/invalid_token_12345`
2. Verify error

**Expected Result:**
- Response: 404 Not Found
- Error: "Approval request not found or expired"

**Verification:**
- ✅ Error returned
- ✅ Appropriate message

### Test 6.4: Approve Request - Expired Token

**Steps:**
1. Wait for token to expire (7 days) or manually expire
2. Try to approve
3. Verify error

**Expected Result:**
- Response: 404 Not Found
- Error: "Approval request not found or expired"

**Verification:**
- ✅ Expired token rejected
- ✅ Appropriate error

### Test 6.5: Reject Request - Valid Token

**Steps:**
1. Navigate to: `http://localhost:3000/reject/TOKEN`
2. Verify rejection

**Expected Result:**
- Rejection page displayed
- Message: "Changes Rejected"
- State updated to REJECTED
- Branch NOT pushed

**Verification:**
- ✅ Rejection successful
- ✅ State is REJECTED
- ✅ Branch remains local
- ✅ Can retry workflow

### Test 6.6: Reject Request - With Reason

**Steps:**
1. Navigate to: `http://localhost:3000/reject/TOKEN?reason=Needs%20more%20work`
2. Verify rejection with reason

**Expected Result:**
- Rejection successful
- Reason displayed on page

**Verification:**
- ✅ Rejection successful
- ✅ Reason displayed

---

## Section 7: End-to-End Workflow Testing

### Test 7.1: Complete Happy Path

**Steps:**
1. Create task in ClickUp: `[TestClient] - Add contact form`
2. Set status to "Ready to Code"
3. Wait for webhook
4. Verify workflow started
5. Wait for agent completion (or manually trigger: `/workflow/continue/TASK_ID`)
6. Verify tests run
7. Verify approval request created
8. Check email/Slack for approval link
9. Click approve link
10. Verify branch pushed to GitHub
11. Verify state is COMPLETED

**Expected Result:**
- All steps complete successfully
- No errors in logs
- Branch exists in GitHub
- State transitions correctly

**Verification Checklist:**
- [ ] Webhook received
- [ ] Workflow started
- [ ] Branch created
- [ ] Agent triggered
- [ ] Tests passed
- [ ] Approval request created
- [ ] Notification sent
- [ ] Approval successful
- [ ] Branch pushed
- [ ] State is COMPLETED

### Test 7.2: Workflow with Test Failure

**Steps:**
1. Create task that will cause test failure
2. Trigger workflow
3. Wait for agent completion
4. Verify tests fail
5. Verify workflow stops
6. Check state

**Expected Result:**
- Tests fail
- Workflow stops at testing phase
- State updated to ERROR
- Error message in state

**Verification:**
- ✅ Tests failed
- ✅ Workflow stopped
- ✅ State is ERROR
- ✅ Error details saved

### Test 7.3: Workflow with Rejection

**Steps:**
1. Create task and trigger workflow
2. Complete agent work
3. Tests pass
4. Reject approval
5. Verify state

**Expected Result:**
- Approval rejected
- State is REJECTED
- Branch remains local
- Can retry workflow

**Verification:**
- ✅ Rejection successful
- ✅ State is REJECTED
- ✅ Branch not pushed
- ✅ Can retry

---

## Section 8: Error Handling Testing

### Test 8.1: Invalid Endpoint

**Steps:**
1. Navigate to: `http://localhost:3000/invalid/endpoint`
2. Verify error

**Expected Result:**
- Response: 404 Not Found

**Verification:**
- ✅ Appropriate error
- ✅ No server crash

### Test 8.2: Missing Required Parameters

**Steps:**
1. Test various endpoints with missing parameters
2. Verify errors

**Expected Result:**
- 400 Bad Request for missing required params
- Helpful error messages

**Verification:**
- ✅ Errors returned
- ✅ Messages are helpful

### Test 8.3: Server Error Handling

**Steps:**
1. Cause server error (e.g., invalid config)
2. Verify graceful handling

**Expected Result:**
- Error logged
- 500 response returned
- Server continues running

**Verification:**
- ✅ Error handled
- ✅ Server stable
- ✅ Error logged

---

## Section 9: Performance Testing

### Test 9.1: Response Time Checks

**Steps:**
1. Test each endpoint
2. Measure response time
3. Verify within acceptable limits

**Expected Limits:**
- Health check: < 100ms
- Get tasks: < 2s
- Get incomplete tasks: < 10s
- Webhook: < 500ms
- Import task: < 5s

**Verification:**
- ✅ All endpoints within limits
- ✅ No timeouts

### Test 9.2: Concurrent Requests

**Steps:**
1. Send multiple concurrent requests
2. Verify all processed correctly

**Expected Result:**
- All requests processed
- No errors
- No crashes

**Verification:**
- ✅ All requests succeed
- ✅ Server stable

---

## Test Results Template

Use this template to track your test results:

```markdown
# Test Results - [Date]

## Test Summary
- Total Tests: X
- Passed: Y
- Failed: Z
- Skipped: W

## Detailed Results

### Section 1: Health Check
- [ ] Test 1.1: Basic Health Check - PASS/FAIL

### Section 2: OAuth Flow
- [ ] Test 2.1: OAuth Initiation - PASS/FAIL
- [ ] Test 2.2: OAuth Callback - Success - PASS/FAIL
- [ ] Test 2.3: OAuth Callback - Error - PASS/FAIL
- [ ] Test 2.4: OAuth Callback - Missing Code - PASS/FAIL

### Section 3: Webhook Events
- [ ] Test 3.1: Valid Status Change - PASS/FAIL
- [ ] Test 3.2: Non-Trigger Status - PASS/FAIL
- [ ] Test 3.3: Invalid Event Type - PASS/FAIL
- [ ] Test 3.4: Missing task_id - PASS/FAIL

### Section 4: Task Management API
- [ ] Test 4.1: Get All Tasks - PASS/FAIL
- [ ] Test 4.2: Get Incomplete Tasks - PASS/FAIL
- [ ] Test 4.3: Import Single Task - PASS/FAIL
- [ ] Test 4.4: Import and Trigger Workflow - PASS/FAIL
- [ ] Test 4.5: Import - Already Exists - PASS/FAIL
- [ ] Test 4.6: Import - Invalid Client - PASS/FAIL
- [ ] Test 4.7: Bulk Import - PASS/FAIL
- [ ] Test 4.8: Get Task Details - PASS/FAIL
- [ ] Test 4.9: Get Task Details - Not Found - PASS/FAIL
- [ ] Test 4.10: Get Task Diff - PASS/FAIL
- [ ] Test 4.11: Get Task Diff - No Branch - PASS/FAIL

### Section 5: Workflow Management
- [ ] Test 5.1: Continue Workflow - Valid - PASS/FAIL
- [ ] Test 5.2: Continue Workflow - Missing clientFolder - PASS/FAIL
- [ ] Test 5.3: Continue Workflow - Invalid Task ID - PASS/FAIL

### Section 6: Approval Flow
- [ ] Test 6.1: Approve - Valid Token - PASS/FAIL
- [ ] Test 6.2: Approve - With Reason - PASS/FAIL
- [ ] Test 6.3: Approve - Invalid Token - PASS/FAIL
- [ ] Test 6.4: Approve - Expired Token - PASS/FAIL
- [ ] Test 6.5: Reject - Valid Token - PASS/FAIL
- [ ] Test 6.6: Reject - With Reason - PASS/FAIL

### Section 7: End-to-End Workflow
- [ ] Test 7.1: Complete Happy Path - PASS/FAIL
- [ ] Test 7.2: Workflow with Test Failure - PASS/FAIL
- [ ] Test 7.3: Workflow with Rejection - PASS/FAIL

### Section 8: Error Handling
- [ ] Test 8.1: Invalid Endpoint - PASS/FAIL
- [ ] Test 8.2: Missing Parameters - PASS/FAIL
- [ ] Test 8.3: Server Error Handling - PASS/FAIL

### Section 9: Performance
- [ ] Test 9.1: Response Time Checks - PASS/FAIL
- [ ] Test 9.2: Concurrent Requests - PASS/FAIL

## Issues Found
[List any issues discovered during testing]

## Notes
[Any additional observations or notes]
```

---

## Troubleshooting

### Common Issues

**Issue: Server not responding**
- Check if server is running: `npm start`
- Check port 3000 is not in use
- Check firewall settings

**Issue: Webhook not received**
- Verify ngrok is running
- Check webhook URL in ClickUp matches ngrok URL
- Check server logs for errors
- Verify webhook is enabled in ClickUp

**Issue: OAuth not working**
- Check environment variables are set
- Verify ClickUp app credentials
- Check redirect URI matches configuration

**Issue: Tasks not importing**
- Verify task name format: `[ClientName] - Description`
- Check client folder exists
- Verify ClickUp API token/access token is valid

---

**Last Updated:** [Date]
**Version:** 1.0

