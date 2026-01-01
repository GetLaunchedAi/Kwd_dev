# Test script for importing a task by ID
# Usage: .\test-import.ps1

$taskId = "86b7yt9z5"
$baseUrl = "http://localhost:3000"

Write-Host "Testing task import with ID: $taskId" -ForegroundColor Cyan
Write-Host ""

try {
    $body = @{
        triggerWorkflow = $true
    } | ConvertTo-Json

    Write-Host "Sending POST request to: $baseUrl/api/tasks/import/$taskId" -ForegroundColor Yellow
    $response = Invoke-WebRequest -Uri "$baseUrl/api/tasks/import/$taskId" -Method POST -Body $body -ContentType "application/json" -ErrorAction Stop
    
    Write-Host ""
    Write-Host "✅ Success!" -ForegroundColor Green
    Write-Host "Status Code: $($response.StatusCode)" -ForegroundColor Green
    Write-Host ""
    Write-Host "Response:" -ForegroundColor Cyan
    $response.Content | ConvertFrom-Json | ConvertTo-Json -Depth 10
    
} catch {
    Write-Host ""
    Write-Host "❌ Error occurred!" -ForegroundColor Red
    
    if ($_.Exception.Response) {
        $statusCode = $_.Exception.Response.StatusCode.value__
        Write-Host "Status Code: $statusCode" -ForegroundColor Red
        
        $stream = $_.Exception.Response.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        $reader.Close()
        $stream.Close()
        
        Write-Host ""
        Write-Host "Error Response:" -ForegroundColor Yellow
        try {
            $json = $responseBody | ConvertFrom-Json
            $json | ConvertTo-Json -Depth 10 | Write-Host
        } catch {
            Write-Host $responseBody
        }
    } else {
        Write-Host "Error Message: $($_.Exception.Message)" -ForegroundColor Red
        Write-Host "Full Exception: $($_.Exception)" -ForegroundColor Red
    }
}

