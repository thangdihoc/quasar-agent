# Install Quasar as a Windows Service
# Run as Administrator

param(
    [switch]$Install,
    [switch]$Uninstall,
    [switch]$Start,
    [switch]$Stop,
    [switch]$Status
)

$ServiceName = "QuasarAgent"
$DisplayName = "Quasar AI Agent"
$Description = "Personal AI Agent running on Windows"
$ScriptPath = Join-Path $PSScriptRoot ".." "packages" "cli" "src" "index.ts"

# Use nssm (Non-Sucking Service Manager)
$nssm = "nssm"

if ($Install) {
    Write-Host "Installing $ServiceName..." -ForegroundColor Cyan

    # Check nssm
    if (-not (Get-Command $nssm -ErrorAction SilentlyContinue)) {
        Write-Host "nssm not found. Install it:" -ForegroundColor Yellow
        Write-Host "  winget install nssm" -ForegroundColor White
        exit 1
    }

    $npx = (Get-Command npx).Source
    & $nssm install $ServiceName $npx "tsx $ScriptPath start"
    & $nssm set $ServiceName DisplayName $DisplayName
    & $nssm set $ServiceName Description $Description
    & $nssm set $ServiceName AppDirectory (Join-Path $PSScriptRoot "..")
    & $nssm set $ServiceName Start SERVICE_AUTO_START

    Write-Host "Service installed! Start with: .\install-service.ps1 -Start" -ForegroundColor Green
}

if ($Uninstall) {
    & $nssm remove $ServiceName confirm
    Write-Host "Service removed." -ForegroundColor Yellow
}

if ($Start) {
    & $nssm start $ServiceName
    Write-Host "Service started." -ForegroundColor Green
}

if ($Stop) {
    & $nssm stop $ServiceName
    Write-Host "Service stopped." -ForegroundColor Yellow
}

if ($Status) {
    & $nssm status $ServiceName
}
