# Detailed test showing what is called with taskId and what is returned

$taskId = "86b7yt9z5"
$baseUrl = "http://localhost:3000"

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "DETAILED IMPORT TEST - Task ID: $taskId" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""

Write-Host "FLOW TRACE:" -ForegroundColor Yellow
Write-Host "1. Endpoint receives taskId from URL: '$taskId'" -ForegroundColor Gray
Write-Host "2. Calls clickUpApiClient.getTask('$taskId')" -ForegroundColor Gray
Write-Host "   → GET https://api.clickup.com/api/v2/task/$taskId" -ForegroundColor DarkGray
Write-Host "3. ClickUp returns task object with task.id (may differ from URL param)" -ForegroundColor Gray
Write-Host "4. Calls extractClientName(task.name, task.id)" -ForegroundColor Gray
Write-Host "5. Inside extractClientName, calls getClientMapping(task.id)" -ForegroundColor Gray
Write-Host "   → Loads config/task-client-mappings.json" -ForegroundColor DarkGray
Write-Host "   → Returns: mappings.mappings[task.id] || null" -ForegroundColor DarkGray
Write-Host ""

Write-Host "MAKING REQUEST..." -ForegroundColor Yellow
Write-Host ""

try {
    $body = @{ triggerWorkflow = $false } | ConvertTo-Json
    $response = Invoke-RestMethod -Uri "$baseUrl/api/tasks/import/$taskId" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
    
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response | ConvertTo-Json -Depth 10 | Write-Host
    
    Write-Host ""
    Write-Host "WHAT WAS RETURNED:" -ForegroundColor Yellow
    Write-Host "  - taskId: $($response.taskId)" -ForegroundColor Gray
    Write-Host "  - taskName: $($response.taskName)" -ForegroundColor Gray
    Write-Host "  - workflowStarted: $($response.workflowStarted)" -ForegroundColor Gray
    if ($response.note) {
        Write-Host "  - note: $($response.note)" -ForegroundColor Gray
    }
    
} catch {
    Write-Host "❌ ERROR!" -ForegroundColor Red
    Write-Host ""
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        
        # Try to get response body
        try {
            $responseStream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($responseStream)
            $responseBody = $reader.ReadToEnd()
            $reader.Close()
            $responseStream.Close()
            
            if ($responseBody) {
                Write-Host ""
                Write-Host "Error Response:" -ForegroundColor Yellow
                try {
                    $errorJson = $responseBody | ConvertFrom-Json
                    $errorJson | ConvertTo-Json -Depth 10 | Write-Host
                    
                    Write-Host ""
                    Write-Host "ERROR DETAILS:" -ForegroundColor Red
                    if ($errorJson.error) { 
                        Write-Host "  Error: $($errorJson.error)" -ForegroundColor Red 
                    }
                    if ($errorJson.message) { 
                        Write-Host "  Message: $($errorJson.message)" -ForegroundColor Yellow 
                    }
                    if ($errorJson.suggestions -and $errorJson.suggestions.Count -gt 0) { 
                        Write-Host "  Suggestions: $($errorJson.suggestions -join ', ')" -ForegroundColor Cyan 
                    }
                } catch {
                    Write-Host $responseBody
                }
            } else {
                Write-Host "  (Empty response body - check server logs)" -ForegroundColor Gray
            }
        } catch {
            Write-Host "  Could not read error response: $($_.Exception.Message)" -ForegroundColor Red
        }
    } else {
        Write-Host "Network Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Make sure server is running on $baseUrl" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host "TEST COMPLETE" -ForegroundColor Cyan
Write-Host "=" * 70 -ForegroundColor Cyan
Write-Host ""

