#!/bin/bash
# ix-browser setup — First-time install on any Mac or Linux machine.
# No OpenClaw dependency. Fully portable.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IX_HOME="${IX_BROWSER_HOME:-$HOME/.ix-browser}"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
NC='\033[0m'

ok()   { echo -e "${GREEN}✓${NC} $1"; }
warn() { echo -e "${YELLOW}!${NC} $1"; }
err()  { echo -e "${RED}✗${NC} $1" >&2; exit 1; }

echo "=== ix-browser setup ==="
echo "Home: $IX_HOME"
echo ""

# --- Prerequisites ---
echo "Checking prerequisites..."

# Node
if command -v node >/dev/null 2>&1; then
  NODE="$(command -v node)"
elif [ -x /opt/homebrew/bin/node ]; then
  NODE="/opt/homebrew/bin/node"
else
  err "Node.js not found. Install via: brew install node (macOS) or apt install nodejs (Linux)"
fi
ok "Node.js $($NODE --version) at $NODE"

# Chrome
CHROME_PATH=""
if [ "$(uname)" = "Darwin" ]; then
  if [ -d "/Applications/Google Chrome.app" ]; then
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  fi
else
  for c in /usr/bin/chromium-browser /usr/bin/chromium /usr/bin/google-chrome; do
    [ -x "$c" ] && CHROME_PATH="$c" && break
  done
fi
[ -n "$CHROME_PATH" ] && ok "Chrome: $CHROME_PATH" || warn "Chrome not found — install Google Chrome"

# --- Directories ---
mkdir -p "$IX_HOME"/{profiles/default,screenshots,logs}
ok "Directories created"

# --- Dependencies ---
echo "Installing dependencies..."
cd "$SCRIPT_DIR"
npm install --silent 2>&1 | tail -1 || npm install 2>&1 | tail -3
ok "Dependencies installed"

# --- Make CLI executable ---
chmod +x "$SCRIPT_DIR/browser.sh"
ok "browser.sh is executable"

# --- LaunchAgent (macOS only, optional) ---
if [ "$(uname)" = "Darwin" ]; then
  echo ""
  read -p "Install macOS LaunchAgent (auto-restart on crash)? [y/N] " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    PLIST_NAME="ai.ix.browser"
    PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_NAME}.plist"

    cat > "$PLIST_PATH" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${SCRIPT_DIR}/server.mjs</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${SCRIPT_DIR}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
    <key>HOME</key>
    <string>${HOME}</string>
    <key>IX_BROWSER_HOME</key>
    <string>${IX_HOME}</string>
  </dict>
  <key>StandardOutPath</key>
  <string>${IX_HOME}/logs/browser.log</string>
  <key>StandardErrorPath</key>
  <string>${IX_HOME}/logs/browser.log</string>
  <key>RunAtLoad</key>
  <false/>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key>
    <false/>
  </dict>
</dict>
</plist>
EOF

    launchctl unload "$PLIST_PATH" 2>/dev/null || true
    launchctl load "$PLIST_PATH"
    ok "LaunchAgent registered: $PLIST_NAME"
  else
    ok "Skipped LaunchAgent"
  fi
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Usage:"
echo "  $SCRIPT_DIR/browser.sh start              Start server + Chrome"
echo "  $SCRIPT_DIR/browser.sh navigate <url>     Go to URL"
echo "  $SCRIPT_DIR/browser.sh read               Read page content"
echo "  $SCRIPT_DIR/browser.sh screenshot         Take screenshot"
echo "  $SCRIPT_DIR/browser.sh help               All commands"
echo ""
echo "Tip: Add to PATH for convenience:"
echo "  ln -sf $SCRIPT_DIR/browser.sh /usr/local/bin/ix-browser"
