# ClickUp Webhook Setup Script
Write-Host "🚀 Setting up ClickUp Webhook..." -ForegroundColor Cyan
Write-Host ""

# Check if server is running
Write-Host "Checking if server is running on port 3000..." -ForegroundColor Yellow
try {
    $response = Invoke-WebRequest -Uri "http://localhost:3000/health" -TimeoutSec 2 -ErrorAction Stop
    Write-Host "✅ Server is running!" -ForegroundColor Green
} catch {
    Write-Host "❌ Server is not running. Please start it first with: npm start" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "Starting ngrok tunnel..." -ForegroundColor Yellow
Write-Host "This will create a public HTTPS URL for your local server." -ForegroundColor Gray
Write-Host ""

# Start ngrok in background
$ngrokProcess = Start-Process -FilePath "npx" -ArgumentList "--yes", "ngrok", "http", "3000" -PassThru -WindowStyle Hidden

# Wait for ngrok to start
Start-Sleep -Seconds 8

# Try to get the ngrok URL
$maxAttempts = 10
$attempt = 0
$ngrokUrl = $null

while ($attempt -lt $maxAttempts -and -not $ngrokUrl) {
    try {
        $tunnels = Invoke-RestMethod -Uri "http://localhost:4040/api/tunnels" -Method Get -ErrorAction Stop
        if ($tunnels.tunnels) {
            $httpsTunnel = $tunnels.tunnels | Where-Object { $_.proto -eq 'https' } | Select-Object -First 1
            if ($httpsTunnel) {
                $ngrokUrl = $httpsTunnel.public_url
            }
        }
    } catch {
        Start-Sleep -Seconds 2
    }
    $attempt++
}

if ($ngrokUrl) {
    Write-Host "✅ ngrok tunnel is active!" -ForegroundColor Green
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host "📋 COPY THESE URLs FOR CLICKUP:" -ForegroundColor Yellow
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Webhook URL (for ClickUp webhook configuration):" -ForegroundColor White
    Write-Host "$ngrokUrl/webhook/clickup" -ForegroundColor Green -BackgroundColor Black
    Write-Host ""
    Write-Host "═══════════════════════════════════════════════════" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "📝 Next Steps:" -ForegroundColor Yellow
    Write-Host "1. Go to ClickUp → Settings → Apps → Webhooks" -ForegroundColor White
    Write-Host "2. Create a new webhook with URL: $ngrokUrl/webhook/clickup" -ForegroundColor White
    Write-Host "3. Subscribe to events: taskStatusUpdated, taskUpdated" -ForegroundColor White
    Write-Host "4. Set a webhook secret and add it to your .env file as CLICKUP_WEBHOOK_SECRET" -ForegroundColor White
    Write-Host ""
    Write-Host "⚠️  Keep this window open to keep ngrok running!" -ForegroundColor Yellow
    Write-Host "⚠️  Press Ctrl+C to stop ngrok when done" -ForegroundColor Yellow
    Write-Host ""
    
    # Update config.json with ngrok URL for approval
    $configPath = "config\config.json"
    if (Test-Path $configPath) {
        $config = Get-Content $configPath | ConvertFrom-Json
        $config.approval.email.approvalUrl = "$ngrokUrl/approve/{token}"
        $config | ConvertTo-Json -Depth 10 | Set-Content $configPath
        Write-Host "✅ Updated config.json with ngrok approval URL" -ForegroundColor Green
    }
    
    Write-Host ""
    Write-Host "Press Enter to stop ngrok and exit..." -ForegroundColor Gray
    Read-Host
    
    # Stop ngrok
    Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    Write-Host "✅ ngrok stopped" -ForegroundColor Green
} else {
    Write-Host "❌ Could not get ngrok URL. Please check if ngrok is installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "Manual setup:" -ForegroundColor Yellow
    Write-Host "1. Open a new terminal and run: npx ngrok http 3000" -ForegroundColor White
    Write-Host "2. Copy the HTTPS URL from ngrok" -ForegroundColor White
    Write-Host "3. Use it in ClickUp webhook configuration" -ForegroundColor White
    Stop-Process -Id $ngrokProcess.Id -Force -ErrorAction SilentlyContinue
    exit 1
}




