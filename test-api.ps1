# API Testing Script for ClickUp-Cursor Automation System
# This script tests all backend API endpoints

param(
    [string]$BaseUrl = "http://localhost:3000",
    [switch]$Verbose,
    [string]$OutputFile = "test-results-$(Get-Date -Format 'yyyyMMdd-HHmmss').csv"
)

$ErrorActionPreference = "Stop"
$results = @()
$testCount = 0
$passCount = 0
$failCount = 0

function Write-TestResult {
    param(
        [string]$Name,
        [string]$Status,
        [int]$ExpectedStatus,
        [int]$ActualStatus,
        [string]$Error = "",
        [string]$ResponseTime = "",
        [string]$Details = ""
    )
    
    $result = [PSCustomObject]@{
        TestName = $Name
        Status = $Status
        ExpectedStatus = $ExpectedStatus
        ActualStatus = $ActualStatus
        Error = $Error
        ResponseTime = $ResponseTime
        Details = $Details
        Timestamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    }
    
    $script:results += $result
    $script:testCount++
    
    if ($Status -eq "PASS") {
        $script:passCount++
        Write-Host "✅ PASS: $Name" -ForegroundColor Green
        if ($Verbose -and $Details) {
            Write-Host "   Details: $Details" -ForegroundColor Gray
        }
    } else {
        $script:failCount++
        Write-Host "❌ FAIL: $Name" -ForegroundColor Red
        if ($Error) {
            Write-Host "   Error: $Error" -ForegroundColor Yellow
        }
        if ($Details) {
            Write-Host "   Details: $Details" -ForegroundColor Gray
        }
    }
}

function Test-Endpoint {
    param(
        [string]$Name,
        [string]$Method,
        [string]$Uri,
        [object]$Body = $null,
        [int]$ExpectedStatus = 200,
        [string]$ExpectedContent = "",
        [hashtable]$Headers = @{}
    )
    
    try {
        $stopwatch = [System.Diagnostics.Stopwatch]::StartNew()
        
        $params = @{
            Uri = "$BaseUrl$Uri"
            Method = $Method
            Headers = $Headers
            ErrorAction = "Stop"
        }
        
        if ($Body) {
            $params.Body = ($Body | ConvertTo-Json -Depth 10)
            $params.ContentType = "application/json"
        }
        
        $response = Invoke-WebRequest @params
        $stopwatch.Stop()
        $responseTime = "$($stopwatch.ElapsedMilliseconds)ms"
        
        $statusCode = $response.StatusCode
        $content = $response.Content
        
        # Check status code
        if ($statusCode -eq $ExpectedStatus) {
            # Check content if specified
            if ($ExpectedContent -and $content -notlike "*$ExpectedContent*") {
                Write-TestResult -Name $Name -Status "FAIL" -ExpectedStatus $ExpectedStatus -ActualStatus $statusCode `
                    -Error "Content mismatch" -ResponseTime $responseTime -Details "Expected content not found"
            } else {
                Write-TestResult -Name $Name -Status "PASS" -ExpectedStatus $ExpectedStatus -ActualStatus $statusCode `
                    -ResponseTime $responseTime -Details "Response: $($content.Substring(0, [Math]::Min(100, $content.Length)))..."
            }
        } else {
            Write-TestResult -Name $Name -Status "FAIL" -ExpectedStatus $ExpectedStatus -ActualStatus $statusCode `
                -Error "Status code mismatch" -ResponseTime $responseTime
        }
    }
    catch {
        $statusCode = 0
        if ($_.Exception.Response) {
            $statusCode = [int]$_.Exception.Response.StatusCode.value__
        }
        
        $errorMessage = $_.Exception.Message
        if ($_.Exception.Response) {
            try {
                $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
                $errorBody = $reader.ReadToEnd()
                $errorMessage = $errorBody
            } catch {
                # Ignore stream reading errors
            }
        }
        
        if ($statusCode -eq $ExpectedStatus) {
            Write-TestResult -Name $Name -Status "PASS" -ExpectedStatus $ExpectedStatus -ActualStatus $statusCode `
                -ResponseTime "N/A" -Details "Expected error occurred"
        } else {
            Write-TestResult -Name $Name -Status "FAIL" -ExpectedStatus $ExpectedStatus -ActualStatus $statusCode `
                -Error $errorMessage -ResponseTime "N/A"
        }
    }
}

# Print header
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  API Testing Suite" -ForegroundColor Cyan
Write-Host "  Base URL: $BaseUrl" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

# Test 1: Health Check
Write-Host "`n--- Health Check Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Health Check - Basic" -Method "GET" -Uri "/health" -ExpectedStatus 200 -ExpectedContent "ok"

# Test 2: OAuth Endpoints
Write-Host "`n--- OAuth Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "OAuth Initiation" -Method "GET" -Uri "/auth/clickup" -ExpectedStatus 302
Test-Endpoint -Name "OAuth Callback - Missing Code" -Method "GET" -Uri "/auth/clickup/callback" -ExpectedStatus 400
Test-Endpoint -Name "OAuth Callback - With Error" -Method "GET" -Uri "/auth/clickup/callback?error=access_denied" -ExpectedStatus 400

# Test 3: Task Management API
Write-Host "`n--- Task Management API Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Get All Tasks" -Method "GET" -Uri "/api/tasks" -ExpectedStatus 200
Test-Endpoint -Name "Get Incomplete Tasks" -Method "GET" -Uri "/api/tasks/incomplete" -ExpectedStatus 200
Test-Endpoint -Name "Get Task Details - Invalid ID" -Method "GET" -Uri "/api/tasks/invalid_task_id_12345" -ExpectedStatus 404
Test-Endpoint -Name "Get Task Diff - Invalid ID" -Method "GET" -Uri "/api/tasks/invalid_task_id_12345/diff" -ExpectedStatus 404

# Test 4: Task Import
Write-Host "`n--- Task Import Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Import Task - Missing Body" -Method "POST" -Uri "/api/tasks/import/invalid_task_id" -Body @{} -ExpectedStatus 400
Test-Endpoint -Name "Bulk Import Incomplete Tasks" -Method "POST" -Uri "/api/tasks/import-incomplete" -Body @{} -ExpectedStatus 200

# Test 5: Workflow Management
Write-Host "`n--- Workflow Management Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Continue Workflow - Missing Body" -Method "POST" -Uri "/workflow/continue/invalid_task_id" -Body @{} -ExpectedStatus 400
Test-Endpoint -Name "Continue Workflow - Missing clientFolder" -Method "POST" -Uri "/workflow/continue/invalid_task_id" -Body @{} -ExpectedStatus 400

# Test 6: Approval Endpoints
Write-Host "`n--- Approval Endpoints Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Approve - Invalid Token" -Method "GET" -Uri "/approve/invalid_token_12345" -ExpectedStatus 404
Test-Endpoint -Name "Reject - Invalid Token" -Method "GET" -Uri "/reject/invalid_token_12345" -ExpectedStatus 404

# Test 7: Webhook Endpoint
Write-Host "`n--- Webhook Tests ---" -ForegroundColor Yellow
$webhookBody = @{
    event = "taskStatusUpdated"
    task_id = "test_task_123"
    webhook_id = "webhook_test"
} | ConvertTo-Json

Test-Endpoint -Name "Webhook - Valid Event" -Method "POST" -Uri "/webhook/clickup" -Body $webhookBody -ExpectedStatus 200

$invalidWebhookBody = @{
    event = "taskCreated"
    task_id = "test_task_123"
} | ConvertTo-Json

Test-Endpoint -Name "Webhook - Invalid Event Type" -Method "POST" -Uri "/webhook/clickup" -Body $invalidWebhookBody -ExpectedStatus 200

$missingTaskIdBody = @{
    event = "taskStatusUpdated"
    webhook_id = "webhook_test"
} | ConvertTo-Json

Test-Endpoint -Name "Webhook - Missing task_id" -Method "POST" -Uri "/webhook/clickup" -Body $missingTaskIdBody -ExpectedStatus 500

# Test 8: Invalid Endpoints
Write-Host "`n--- Invalid Endpoint Tests ---" -ForegroundColor Yellow
Test-Endpoint -Name "Invalid Endpoint" -Method "GET" -Uri "/invalid/endpoint" -ExpectedStatus 404

# Print summary
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  Test Summary" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Total Tests: $testCount" -ForegroundColor White
Write-Host "Passed: $passCount" -ForegroundColor Green
Write-Host "Failed: $failCount" -ForegroundColor Red
Write-Host "Success Rate: $([math]::Round(($passCount / $testCount) * 100, 2))%" -ForegroundColor $(if ($failCount -eq 0) { "Green" } else { "Yellow" })

# Export results
if ($results.Count -gt 0) {
    $results | Export-Csv -Path $OutputFile -NoTypeInformation
    Write-Host "`nResults exported to: $OutputFile" -ForegroundColor Cyan
}

# Print failed tests
if ($failCount -gt 0) {
    Write-Host "`n--- Failed Tests ---" -ForegroundColor Red
    $results | Where-Object { $_.Status -eq "FAIL" } | ForEach-Object {
        Write-Host "  ❌ $($_.TestName)" -ForegroundColor Red
        if ($_.Error) {
            Write-Host "     Error: $($_.Error)" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n"

