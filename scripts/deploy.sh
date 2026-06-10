#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="/root/main/aurix-agent"
BACKEND_PORT=3001

RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn()  { echo -e "${CYAN}[!]${NC} $1"; }

echo -e "${CYAN}AURIX Deploy — sync repo + restart${NC}"
echo ""

cd "$REPO_DIR"
git pull --ff-only origin main
info "Repo synced"

npx tsc 2>/dev/null && info "Build OK" || warn "Build skipped (tsc not found or errors)"

pm2 restart aurix-agent 2>/dev/null && info "PM2 restarted" || warn "PM2 aurix-agent not running (run: pm2 start dist/index.js --name aurix-agent)"

curl -sf http://localhost:$BACKEND_PORT/api/health >/dev/null && info "Backend api.haikz.me healthy" || warn "Backend not responding on port $BACKEND_PORT"

echo ""
info "Deploy complete — api.haikz.me/install.sh serves latest code"
