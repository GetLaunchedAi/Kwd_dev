# PowerShell script to create ClickUp webhook via API
# Usage: .\create-webhook.ps1

# Load .env file
$envFile = ".env"
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)\s*=\s*(.+)\s*$') {
            $key = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($key, $value, "Process")
        }
    }
}

$webhookUrl = "https://lili-monasterial-messiah.ngrok-free.dev/webhook/clickup"
$events = @("taskStatusUpdated", "taskUpdated")

# Try to get access token
$token = $null

# Try OAuth token file first
$tokenFile = "tokens\clickup-access-token.json"
if (Test-Path $tokenFile) {
    try {
        $tokenData = Get-Content $tokenFile | ConvertFrom-Json
        if ($tokenData.access_token) {
            $token = $tokenData.access_token
            Write-Host "✓ Found OAuth access token" -ForegroundColor Green
        }
    } catch {
        # Ignore
    }
}

# Try environment variable
if (-not $token) {
    $token = $env:CLICKUP_ACCESS_TOKEN
    if ($token) {
        Write-Host "✓ Found access token from environment" -ForegroundColor Green
    }
}

# Try API token
if (-not $token) {
    $token = $env:CLICKUP_API_TOKEN
    if ($token) {
        Write-Host "✓ Found API token from environment" -ForegroundColor Green
    }
}

if (-not $token) {
    Write-Host "❌ No access token found!" -ForegroundColor Red
    Write-Host "Please authorize OAuth first or set CLICKUP_API_TOKEN in .env" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To authorize OAuth, visit:" -ForegroundColor Cyan
    Write-Host "https://lili-monasterial-messiah.ngrok-free.dev/auth/clickup" -ForegroundColor Green
    exit 1
}

# Get Team ID
$teamId = $env:CLICKUP_TEAM_ID
if (-not $teamId) {
    Write-Host "Fetching teams to get Team ID..." -ForegroundColor Yellow
    try {
        $teamsResponse = Invoke-RestMethod -Uri "https://api.clickup.com/api/v2/team" -Method Get -Headers @{
            "Authorization" = $token
        }
        
        if ($teamsResponse.teams -and $teamsResponse.teams.Count -gt 0) {
            $teamId = $teamsResponse.teams[0].id
            Write-Host "✓ Using Team ID: $teamId" -ForegroundColor Green
        } else {
            Write-Host "❌ No teams found" -ForegroundColor Red
            exit 1
        }
    } catch {
        Write-Host "❌ Error fetching teams: $_" -ForegroundColor Red
        Write-Host "Please set CLICKUP_TEAM_ID in .env file" -ForegroundColor Yellow
        exit 1
    }
}

# Create webhook
Write-Host ""
Write-Host "Creating webhook..." -ForegroundColor Yellow

$body = @{
    endpoint = $webhookUrl
    client_id = $env:CLICKUP_CLIENT_ID
    events = $events
    task_id = $null
    list_id = $null
    folder_id = $null
    space_id = $null
    health = @{
        status = "active"
    }
} | ConvertTo-Json -Depth 10

try {
    $response = Invoke-RestMethod -Uri "https://api.clickup.com/api/v2/team/$teamId/webhook" -Method Post -Headers @{
        "Authorization" = $token
        "Content-Type" = "application/json"
    } -Body $body

    Write-Host ""
    Write-Host "✅ Webhook created successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Webhook Details:" -ForegroundColor Cyan
    Write-Host "  ID: $($response.id)"
    Write-Host "  URL: $($response.endpoint)"
    Write-Host "  Status: $($response.status)"
    
    if ($response.secret) {
        Write-Host ""
        Write-Host "⚠️  IMPORTANT: Save the webhook secret!" -ForegroundColor Yellow
        Write-Host "  Secret: $($response.secret)"
        Write-Host ""
        Write-Host "Add this to your .env file:" -ForegroundColor Cyan
        Write-Host "  CLICKUP_WEBHOOK_SECRET=$($response.secret)"
    }
} catch {
    Write-Host ""
    Write-Host "❌ Error creating webhook:" -ForegroundColor Red
    if ($_.Exception.Response) {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $responseBody = $reader.ReadToEnd()
        Write-Host "Status: $($_.Exception.Response.StatusCode)"
        Write-Host "Error: $responseBody"
    } else {
        Write-Host "Error: $($_.Exception.Message)"
    }
    exit 1
}




