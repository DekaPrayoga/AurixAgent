#!/usr/bin/env bash
# AURIX Agent — macOS installer
# Usage: curl -fsSL https://api.haikz.me/install.mac.sh | bash
set -euo pipefail

echo "  AURIX Agent — Installer (macOS)"
echo ""

INSTALL_DIR="${AURIX_HOME:-$HOME/.aurix/agent}"
REPO="${AURIX_REPO:-https://github.com/DekaPrayoga/AurixAgent.git}"

# Colors
GREEN='\033[38;2;127;216;143m'
RED='\033[38;2;224;108;117m'
ORANGE='\033[38;2;250;178;131m'
RESET='\033[0m'

ok()  { echo -e "  ${GREEN}✓${RESET} $1"; }
warn(){ echo -e "  ${ORANGE}!${RESET} $1"; }
fail(){ echo -e "  ${RED}✗${RESET} $1"; exit 1; }

# 1. Homebrew
echo "==> Checking Homebrew..."
if ! command -v brew &>/dev/null; then
  warn "Homebrew not found. Installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add to PATH for Apple Silicon
  if [ -f "/opt/homebrew/bin/brew" ]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  fi
fi
ok "Homebrew ready"

# 2. Node.js
echo "==> Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "  Installing Node.js 20..."
  brew install node@20
  brew link --overwrite node@20
fi
ok "Node.js $(node --version)"

# 3. Bun
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
ok "Bun $(bun --version)"

# 4. Rust (optional, for native token counter)
echo "==> Checking Rust toolchain (optional)..."
if command -v rustc &>/dev/null; then
  ok "Rust $(rustc --version | awk '{print $2}')"
else
  warn "Rust not found — native token counter will use JS fallback"
  echo "  Optional: curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
fi

# 5. Git
echo "==> Checking Git..."
if ! command -v git &>/dev/null; then
  brew install git
fi
ok "Git $(git --version | awk '{print $3}')"

# 6. kitty (optional)
echo "==> Checking kitty terminal (optional)..."
if command -v kitty &>/dev/null; then
  ok "kitty found"
else
  warn "kitty not found (optional, enhances terminal UI)"
  echo "  Install: brew install --cask kitty"
fi

# 7. Clone or update
echo "==> Setting up AURIX Agent..."
if [ -d "$INSTALL_DIR/.git" ]; then
  echo "  Updating existing installation..."
  cd "$INSTALL_DIR" && git pull --quiet
else
  mkdir -p "$(dirname "$INSTALL_DIR")"
  echo "  Cloning repository..."
  git clone "$REPO" "$INSTALL_DIR"
fi

# 8. Build
echo "==> Building..."
cd "$INSTALL_DIR"
npm install --silent 2>/dev/null || bun install
npm run build

# 9. Install launcher
echo "==> Installing launcher..."
chmod +x bin/aurix

# Create symlink in /usr/local/bin or ~/.local/bin
if [ -d "/usr/local/bin" ] && [ -w "/usr/local/bin" ]; then
  ln -sf "$INSTALL_DIR/bin/aurix" /usr/local/bin/aurix
  ok "Linked to /usr/local/bin/aurix"
elif [ -d "$HOME/.local/bin" ]; then
  ln -sf "$INSTALL_DIR/bin/aurix" "$HOME/.local/bin/aurix"
  ok "Linked to ~/.local/bin/aurix"
else
  mkdir -p "$HOME/.local/bin"
  ln -sf "$INSTALL_DIR/bin/aurix" "$HOME/.local/bin/aurix"
  # Add to PATH in shell config
  SHELL_RC="$HOME/.zshrc"
  if [ -f "$HOME/.bashrc" ] && [ ! -f "$HOME/.zshrc" ]; then
    SHELL_RC="$HOME/.bashrc"
  fi
  if ! grep -q '.local/bin' "$SHELL_RC" 2>/dev/null; then
    echo '' >> "$SHELL_RC"
    echo '# AURIX Agent' >> "$SHELL_RC"
    echo 'export PATH="$HOME/.local/bin:$PATH"' >> "$SHELL_RC"
    warn "Added ~/.local/bin to PATH in $SHELL_RC"
    echo "  Run: source $SHELL_RC"
  fi
fi

# 10. macOS-specific: remove quarantine from .node binaries
echo "==> Finalizing..."
find "$INSTALL_DIR" -name "*.node" -exec xattr -d com.apple.quarantine {} \; 2>/dev/null || true
ok "Native modules cleared"

echo ""
echo -e "  ${ORANGE}AURIX Agent${RESET} installed!"
echo ""
echo -e "  Run:     ${GREEN}aurix${RESET}"
echo -e "  Setup:   ${GREEN}aurix setup${RESET}"
echo ""
