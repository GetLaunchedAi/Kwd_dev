# ImageRetriever Helper Script (PowerShell)
#
# This script provides an easy way to call the ImageRetriever tool
# with common defaults and helpful prompts.
#
# Usage:
#   .\scripts\retrieve-image.ps1
#   (follow the interactive prompts)
#
# Or with arguments:
#   .\scripts\retrieve-image.ps1 "search query" landscape "context description" ".\output\path"
#

param(
    [string]$Query = "",
    [ValidateSet("landscape", "portrait", "square", "")]
    [string]$Shape = "",
    [string]$Context = "",
    [string]$Output = "",
    [int]$Turns = 5
)

# Colors for output
function Write-ColorOutput($ForegroundColor) {
    $fc = $host.UI.RawUI.ForegroundColor
    $host.UI.RawUI.ForegroundColor = $ForegroundColor
    if ($args) {
        Write-Output $args
    }
    $host.UI.RawUI.ForegroundColor = $fc
}

Write-ColorOutput Green "=== ImageRetriever Helper Script ==="
Write-Output ""

# Get script directory and project root
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ImageRetrieverDir = Join-Path $ProjectRoot "ImageRetriever"

# Check if ImageRetriever exists
if (-not (Test-Path $ImageRetrieverDir)) {
    Write-ColorOutput Red "Error: ImageRetriever directory not found at: $ImageRetrieverDir"
    exit 1
}

# Interactive mode if no query provided
if ([string]::IsNullOrWhiteSpace($Query)) {
    Write-Output "Interactive mode - please provide the following information:"
    Write-Output ""
    
    # Query
    $Query = Read-Host "Search query (e.g., 'bakery fresh bread')"
    if ([string]::IsNullOrWhiteSpace($Query)) {
        Write-ColorOutput Red "Error: Query is required"
        exit 1
    }
    
    # Shape
    Write-Output ""
    Write-Output "Image shape options:"
    Write-Output "  1) landscape - Wide images for headers/banners"
    Write-Output "  2) portrait  - Tall images for sidebars"
    Write-Output "  3) square    - Square images for icons/profiles"
    $ShapeChoice = Read-Host "Select shape (1-3)"
    
    switch ($ShapeChoice) {
        "1" { $Shape = "landscape" }
        "2" { $Shape = "portrait" }
        "3" { $Shape = "square" }
        default {
            Write-ColorOutput Yellow "Invalid choice. Using 'landscape' as default."
            $Shape = "landscape"
        }
    }
    
    # Context
    Write-Output ""
    $Context = Read-Host "Context description (e.g., business description)"
    if ([string]::IsNullOrWhiteSpace($Context)) {
        Write-ColorOutput Yellow "Warning: No context provided. Image relevance may be lower."
        $Context = "No context provided"
    }
    
    # Output path
    Write-Output ""
    $DefaultOutput = Join-Path $ImageRetrieverDir "downloads"
    $OutputInput = Read-Host "Output directory (default: $DefaultOutput)"
    if ([string]::IsNullOrWhiteSpace($OutputInput)) {
        $Output = $DefaultOutput
    } else {
        $Output = $OutputInput
    }
    
    # Turns
    Write-Output ""
    $TurnsInput = Read-Host "Maximum retrieval turns (default: 5, range: 1-10)"
    if ([string]::IsNullOrWhiteSpace($TurnsInput)) {
        $Turns = 5
    } else {
        $Turns = [int]$TurnsInput
    }
}

# Set defaults if not provided
if ([string]::IsNullOrWhiteSpace($Shape)) {
    $Shape = "landscape"
}
if ([string]::IsNullOrWhiteSpace($Context)) {
    $Context = "No context provided"
}
if ([string]::IsNullOrWhiteSpace($Output)) {
    $Output = Join-Path $ImageRetrieverDir "downloads"
}
if ($Turns -eq 0) {
    $Turns = 5
}

# Validate shape
if ($Shape -notmatch '^(landscape|portrait|square)$') {
    Write-ColorOutput Red "Error: Invalid shape '$Shape'. Must be landscape, portrait, or square."
    exit 1
}

# Create output directory if it doesn't exist
New-Item -ItemType Directory -Force -Path $Output | Out-Null

# Display configuration
Write-Output ""
Write-ColorOutput Green "Configuration:"
Write-Output "  Query:   $Query"
Write-Output "  Shape:   $Shape"
Write-Output "  Context: $Context"
Write-Output "  Output:  $Output"
Write-Output "  Turns:   $Turns"
Write-Output ""

# Confirm
$Confirm = Read-Host "Proceed with image retrieval? (y/n)"
if ($Confirm -notmatch '^[Yy]$') {
    Write-Output "Cancelled."
    exit 0
}

# Change to ImageRetriever directory
Set-Location $ImageRetrieverDir

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-ColorOutput Yellow "Installing ImageRetriever dependencies..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-ColorOutput Red "Error: Failed to install dependencies"
        exit 1
    }
}

# Run the ImageRetriever
Write-Output ""
Write-ColorOutput Green "Starting image retrieval..."
Write-Output ""

# Escape quotes in parameters
$QueryEscaped = $Query -replace '"', '\"'
$ContextEscaped = $Context -replace '"', '\"'

# Run npm start with arguments
npm start -- --query "$QueryEscaped" --shape $Shape --context "$ContextEscaped" --output "$Output" --turns $Turns

$ExitCode = $LASTEXITCODE

Write-Output ""
if ($ExitCode -eq 0) {
    Write-ColorOutput Green "✓ Image retrieval completed successfully!"
    Write-Output "  Check output directory: $Output"
} else {
    Write-ColorOutput Red "✗ Image retrieval failed with exit code $ExitCode"
}

exit $ExitCode





