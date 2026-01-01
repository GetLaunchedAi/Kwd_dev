# Detailed trace of import process
# Shows what is called with taskId and what is returned

$taskId = "86b7yt9z5"
$baseUrl = "http://localhost:3000"

Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "TRACING IMPORT PROCESS FOR TASK ID: $taskId" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host ""

# Step 1: Check what the endpoint receives
Write-Host "STEP 1: Calling import endpoint" -ForegroundColor Yellow
Write-Host "  URL: POST $baseUrl/api/tasks/import/$taskId" -ForegroundColor Gray
Write-Host "  Body: { triggerWorkflow: false }" -ForegroundColor Gray
Write-Host ""

# Step 2: Make the request
try {
    $body = @{ triggerWorkflow = $false } | ConvertTo-Json
    $response = Invoke-WebRequest -Uri "$baseUrl/api/tasks/import/$taskId" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
    
    Write-Host "✅ SUCCESS!" -ForegroundColor Green
    Write-Host "  Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response Body:" -ForegroundColor Cyan
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10 | Write-Host
    
} catch {
    Write-Host "❌ ERROR!" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "  Status Code: $statusCode" -ForegroundColor Red
        
        # Get response body
        $responseStream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($responseStream)
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        $responseStream.Close()
        
        Write-Host ""
        Write-Host "Error Response Body:" -ForegroundColor Yellow
        if ($responseBody) {
            try {
                $errorJson = $responseBody | ConvertFrom-Json
                $errorJson | ConvertTo-Json -Depth 10 | Write-Host
                
                Write-Host ""
                Write-Host "Error Details:" -ForegroundColor Yellow
                if ($errorJson.error) { Write-Host "  Error: $($errorJson.error)" -ForegroundColor Red }
                if ($errorJson.message) { Write-Host "  Message: $($errorJson.message)" -ForegroundColor Red }
                if ($errorJson.suggestions) { 
                    Write-Host "  Suggestions: $($errorJson.suggestions -join ', ')" -ForegroundColor Yellow 
                }
            } catch {
                Write-Host $responseBody
            }
        } else {
            Write-Host "  (Empty response body)" -ForegroundColor Gray
        }
    } else {
        Write-Host "  Network Error: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "  Make sure the server is running on $baseUrl" -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "=" * 80 -ForegroundColor Cyan
Write-Host "TRACE COMPLETE" -ForegroundColor Cyan
Write-Host "=" * 80 -ForegroundColor Cyan

