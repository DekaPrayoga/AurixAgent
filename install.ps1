# AURIX Agent — Windows PowerShell Installer
# Usage: irm https://api.haikz.me/install.ps1 | iex
$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  AURIX Agent — Installer (Windows)" -ForegroundColor White
Write-Host ""

$InstallDir = "$env:USERPROFILE\.aurix\agent"
$Repo = "https://github.com/DekaPrayoga/AurixAgent.git"

function Write-Ok($msg)   { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ! $msg" -ForegroundColor Yellow }
function Write-Fail($msg) { Write-Host "  ✗ $msg" -ForegroundColor Red; Read-Host "Press Enter to exit"; exit 1 }

# 1. Check Node.js
Write-Host "==> Checking Node.js..."
$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
    Write-Fail "Node.js not found. Install from https://nodejs.org/ or run: winget install OpenJS.NodeJS.LTS"
}
$nodeVer = & node --version
Write-Ok "Node.js $nodeVer"

# 2. Check Bun
Write-Host "==> Checking Bun runtime..."
$bunCmd = Get-Command bun -ErrorAction SilentlyContinue
if (-not $bunCmd) {
    Write-Host "  Bun not found. Installing..."
    try {
        Invoke-RestMethod "https://bun.sh/install.ps1" | Invoke-Expression
    } catch {
        Write-Host "  PowerShell install failed. Trying npm..."
        npm install -g bun 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Fail "Could not install Bun. Install manually from https://bun.sh"
        }
    }
    $env:Path = "$env:USERPROFILE\.bun\bin;$env:Path"
}
$bunVer = & bun --version 2>$null
if ($bunVer) { Write-Ok "Bun $bunVer" } else { Write-Ok "Bun installed (restart may be needed)" }

# 3. Check Rust (optional)
Write-Host "==> Checking Rust toolchain (optional)..."
$rustCmd = Get-Command rustc -ErrorAction SilentlyContinue
if ($rustCmd) {
    $rustVer = & rustc --version 2>&1
    Write-Ok $rustVer
} else {
    Write-Warn "Rust not found — native token counter will use JS fallback"
    Write-Host "  Optional: install from https://rustup.rs/"
}

# 4. Check Git
Write-Host "==> Checking Git..."
$gitCmd = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCmd) {
    Write-Fail "Git not found. Install from https://git-scm.com/ or run: winget install Git.Git"
}
Write-Ok "Git ready"

# 5. Clone or update
Write-Host "==> Setting up AURIX Agent..."
if (Test-Path "$InstallDir\.git") {
    Write-Host "  Updating existing installation..."
    Push-Location $InstallDir
    git pull --quiet
    Pop-Location
} else {
    $parentDir = Split-Path $InstallDir -Parent
    if (-not (Test-Path $parentDir)) { New-Item -ItemType Directory -Path $parentDir -Force | Out-Null }
    Write-Host "  Cloning repository..."
    git clone $Repo $InstallDir
    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Git clone failed."
    }
}

# 6. Build
Write-Host "==> Building..."
Push-Location $InstallDir
npm install --silent 2>$null
if ($LASTEXITCODE -ne 0) {
    Write-Host "  npm install failed, trying bun..."
    bun install
}
npm run build
if ($LASTEXITCODE -ne 0) {
    Pop-Location
    Write-Fail "Build failed."
}
Pop-Location

# 7. Add to PATH
Write-Host "==> Adding to PATH..."
$binDir = "$InstallDir\bin"
$currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($currentPath -notlike "*$binDir*") {
    [Environment]::SetEnvironmentVariable("Path", "$currentPath;$binDir", "User")
    $env:Path = "$env:Path;$binDir"
    Write-Ok "Added $binDir to user PATH"
    Write-Warn "Restart your terminal for PATH changes to take effect"
} else {
    Write-Ok "Already in PATH"
}

# 8. Desktop shortcut
Write-Host "==> Creating desktop shortcut..."
$ws = New-Object -ComObject WScript.Shell
$shortcut = $ws.CreateShortcut("$env:USERPROFILE\Desktop\AURIX Agent.lnk")
$shortcut.TargetPath = "cmd.exe"
$shortcut.Arguments = "/k aurix"
$shortcut.WorkingDirectory = $env:USERPROFILE
$shortcut.Description = "AURIX AI Agent"
$shortcut.Save()
Write-Ok "Desktop shortcut created"

Write-Host ""
Write-Host "  ===================================" -ForegroundColor White
Write-Host "   AURIX Agent installed!" -ForegroundColor Green
Write-Host "  ===================================" -ForegroundColor White
Write-Host ""
Write-Host "  Run:     aurix" -ForegroundColor Cyan
Write-Host "  Setup:   aurix setup" -ForegroundColor Cyan
Write-Host ""
Write-Host "  If 'aurix' is not recognized, restart your terminal first." -ForegroundColor Yellow
Write-Host ""
