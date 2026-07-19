param(
  [string]$RepoDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path,
  [int]$BackendPort = 3001
)

$ErrorActionPreference = 'Stop'

function Info([string]$Message) { Write-Host "[✓] $Message" -ForegroundColor Green }
function Warn([string]$Message) { Write-Host "[!] $Message" -ForegroundColor Cyan }

Write-Host 'AURIX Deploy — sync repo + restart' -ForegroundColor Cyan
Write-Host ''

Set-Location $RepoDir

git pull --ff-only origin main
Info 'Repo synced'

try {
  npx tsc 2>$null
  Info 'Build OK'
} catch {
  Warn 'Build skipped (tsc not found or errors)'
}

try {
  pm2 delete aurix-reddit-api *> $null
} catch {}

try {
  pm2 restart aurix-agent --update-env *> $null
  Info 'PM2 restarted'
} catch {
  Warn 'PM2 aurix-agent not running (run: pm2 start dist/index.js --name aurix-agent)'
}

try {
  Invoke-WebRequest -UseBasicParsing -Uri "http://localhost:$BackendPort/api/health" -TimeoutSec 5 | Out-Null
  Info 'Embedded Reddit API healthy'
} catch {
  Warn "Embedded Reddit API not responding on port $BackendPort"
}

Write-Host ''
Info 'Deploy complete — Aurix backend is synced and restarted'
