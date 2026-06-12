#!/usr/bin/env bash
# AURIX Agent — one-line installer
# Usage: curl -fsSL <url> | bash
set -euo pipefail

echo "  AURIX Agent — Installer"
echo ""

INSTALL_DIR="${AURIX_HOME:-$HOME/.aurix/agent}"
REPO="${AURIX_REPO:-https://github.com/DekaPrayoga/AurixAgent.git}"

# 1. Node.js
echo "==> Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js 20..."
  if command -v apt-get &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
    sudo apt-get install -y nodejs
  else
    echo "  ERROR: Install Node.js manually"
    exit 1
  fi
else
  echo "  Node.js $(node --version) ok"
fi

# 2. kitty
echo "==> Checking kitty terminal..."
if ! command -v kitty &>/dev/null; then
  echo "  Installing kitty..."
  if command -v apt-get &>/dev/null; then
    sudo apt-get install -y kitty
  else
    curl -fsSL https://sw.kovidgoyal.net/kitty/installer.sh | bash
  fi
else
  echo "  kitty ok"
fi

# 2. Bun
echo "==> Checking Bun runtime..."
if ! command -v bun &>/dev/null; then
  if [ -x "$HOME/.bun/bin/bun" ]; then
    export PATH="$HOME/.bun/bin:$PATH"
  else
    echo "  Installing Bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
fi
echo "  Bun $(bun --version) ok"

# 3. Rust (optional, for native token counter)
echo "==> Checking Rust toolchain (optional)..."
if command -v rustc &>/dev/null; then
  echo "  Rust $(rustc --version | awk '{print $2}') ok"
else
  echo "  Rust not found — native token counter will use JS fallback"
  echo "  Optional: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

# 4. Clone or update
echo "==> Setting up AURIX Agent..."
if [ -d "$INSTALL_DIR/.git" ]; then
  cd "$INSTALL_DIR" && git pull --quiet
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  git clone "$REPO" "$INSTALL_DIR"
fi

# 4. Build
cd "$INSTALL_DIR"
npm install --silent
npm run build

# 5. Install launcher
chmod +x bin/aurix
sudo ln -sf "$INSTALL_DIR/bin/aurix" /usr/local/bin/aurix

echo ""
echo "  AURIX Agent installed!"
echo "  Run:     aurix"
echo "  Setup:   aurix setup"
echo ""
