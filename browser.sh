#!/bin/bash
# ix-browser — Headful Chrome automation CLI.
# Fully portable. No OpenClaw dependency.
#
# All paths derived from IX_BROWSER_HOME (default: ~/.ix-browser).
# Node detected automatically via PATH.
#
# Usage: browser.sh <command> [args...]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
IX_HOME="${IX_BROWSER_HOME:-$HOME/.ix-browser}"
SERVER="http://127.0.0.1:${BROWSER_PORT:-18840}"
CURL="curl -sf --max-time 35"

# Find node — check PATH first, then common locations
find_node() {
  if command -v node >/dev/null 2>&1; then
    command -v node
  elif [ -x /opt/homebrew/bin/node ]; then
    echo /opt/homebrew/bin/node
  elif [ -x /usr/local/bin/node ]; then
    echo /usr/local/bin/node
  elif [ -x /usr/bin/node ]; then
    echo /usr/bin/node
  else
    echo "node"  # will fail clearly if not found
  fi
}
NODE="$(find_node)"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

err() { echo -e "${RED}error:${NC} $1" >&2; exit 1; }
ok()  { echo -e "${GREEN}✓${NC} $1"; }

check_server() {
  $CURL "$SERVER/health" >/dev/null 2>&1 || {
    err "browser server not running. Start with: browser.sh start"
  }
}

json_field() {
  local json="$1" field="$2"
  echo "$json" | $NODE -e "
    let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
      try{const j=JSON.parse(d);console.log(j.${field}||'')}catch(e){console.log('')}
    })"
}

extract_page() {
  local response="$1"
  local error
  error=$(json_field "$response" "error")
  if [ -n "$error" ]; then
    err "$error"
  fi
  json_field "$response" "page"
}

json_escape() {
  echo -n "$1" | $NODE -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>process.stdout.write(JSON.stringify(d)))"
}

case "${1:-help}" in
  navigate|go)
    [ -z "${2:-}" ] && err "usage: browser.sh navigate <url>"
    check_server
    url_json=$(json_escape "$2")
    response=$($CURL -X POST "$SERVER/navigate" \
      -H 'Content-Type: application/json' \
      -d "{\"url\":$url_json}" 2>&1) || err "navigation failed"
    extract_page "$response"
    ;;

  read|r)
    check_server
    response=$($CURL "$SERVER/read" 2>&1) || err "read failed"
    extract_page "$response"
    ;;

  click|c)
    [ -z "${2:-}" ] && err "usage: browser.sh click <index|text>"
    check_server
    if [[ "$2" =~ ^[0-9]+$ ]]; then
      target="$2"
    else
      target=$(json_escape "$2")
    fi
    response=$($CURL -X POST "$SERVER/click" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":$target}" 2>&1) || err "click failed"
    extract_page "$response"
    ;;

  type|t)
    [ -z "${2:-}" ] || [ -z "${3:-}" ] && err "usage: browser.sh type <index|text> <value>"
    check_server
    if [[ "$2" =~ ^[0-9]+$ ]]; then
      target="$2"
    else
      target=$(json_escape "$2")
    fi
    value_json=$(json_escape "$3")
    response=$($CURL -X POST "$SERVER/type" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":$target,\"value\":$value_json}" 2>&1) || err "type failed"
    extract_page "$response"
    ;;

  key|k)
    [ -z "${2:-}" ] && err "usage: browser.sh key <Enter|Tab|Escape|...>"
    check_server
    response=$($CURL -X POST "$SERVER/key" \
      -H 'Content-Type: application/json' \
      -d "{\"key\":\"$2\"}" 2>&1) || err "key press failed"
    extract_page "$response"
    ;;

  screenshot|ss)
    check_server
    full="false"
    [ "${2:-}" = "--full" ] && full="true"
    response=$($CURL -X POST "$SERVER/screenshot" \
      -H 'Content-Type: application/json' \
      -d "{\"fullPage\":$full}" 2>&1) || err "screenshot failed"
    filepath=$(json_field "$response" "path")
    ok "Screenshot saved: $filepath"
    ;;

  scroll|s)
    check_server
    direction="${2:-down}"
    amount="${3:-500}"
    response=$($CURL -X POST "$SERVER/scroll" \
      -H 'Content-Type: application/json' \
      -d "{\"direction\":\"$direction\",\"amount\":$amount}" 2>&1) || err "scroll failed"
    extract_page "$response"
    ;;

  wait|w)
    [ -z "${2:-}" ] && err "usage: browser.sh wait <text> [timeout_ms]"
    check_server
    timeout="${3:-10000}"
    text_json=$(json_escape "$2")
    response=$($CURL --max-time "$(( timeout / 1000 + 5 ))" -X POST "$SERVER/wait" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":$text_json,\"timeout\":$timeout}" 2>&1) || err "wait timed out"
    extract_page "$response"
    ;;

  back|b)
    check_server
    response=$($CURL -X POST "$SERVER/back" 2>&1) || err "back failed"
    extract_page "$response"
    ;;

  forward|f)
    check_server
    response=$($CURL -X POST "$SERVER/forward" 2>&1) || err "forward failed"
    extract_page "$response"
    ;;

  tabs)
    check_server
    response=$($CURL -X POST "$SERVER/tab" \
      -H 'Content-Type: application/json' \
      -d '{"action":"list"}' 2>&1) || err "failed to list tabs"
    echo "$response" | $NODE -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        const j=JSON.parse(d);
        j.tabs.forEach(t=>console.log((t.active?'→ ':' ')+'['+t.index+'] '+t.url));
      })"
    ;;

  tab)
    check_server
    case "${2:-}" in
      new)
        body='{"action":"new"'
        [ -n "${3:-}" ] && body="$body,\"url\":\"$3\""
        body="$body}"
        response=$($CURL -X POST "$SERVER/tab" \
          -H 'Content-Type: application/json' \
          -d "$body" 2>&1) || err "failed to open tab"
        extract_page "$response"
        ;;
      close)
        body='{"action":"close"'
        [ -n "${3:-}" ] && body="$body,\"index\":$3"
        body="$body}"
        $CURL -X POST "$SERVER/tab" \
          -H 'Content-Type: application/json' \
          -d "$body" >/dev/null 2>&1 || err "failed to close tab"
        ok "Tab closed"
        ;;
      *)
        [[ "$2" =~ ^[0-9]+$ ]] || err "usage: browser.sh tab <index|new|close>"
        response=$($CURL -X POST "$SERVER/tab" \
          -H 'Content-Type: application/json' \
          -d "{\"action\":\"switch\",\"index\":$2}" 2>&1) || err "failed to switch tab"
        extract_page "$response"
        ;;
    esac
    ;;

  select)
    [ -z "${2:-}" ] || [ -z "${3:-}" ] && err "usage: browser.sh select <index|text> <value>"
    check_server
    if [[ "$2" =~ ^[0-9]+$ ]]; then target="$2"; else target=$(json_escape "$2"); fi
    value_json=$(json_escape "$3")
    response=$($CURL -X POST "$SERVER/select" \
      -H 'Content-Type: application/json' \
      -d "{\"target\":$target,\"value\":$value_json}" 2>&1) || err "select failed"
    extract_page "$response"
    ;;

  eval|evaluate)
    [ -z "${2:-}" ] && err "usage: browser.sh eval <javascript>"
    check_server
    escaped=$(json_escape "$2")
    response=$($CURL -X POST "$SERVER/evaluate" \
      -H 'Content-Type: application/json' \
      -d "{\"script\":$escaped}" 2>&1) || err "eval failed"
    echo "$response" | $NODE -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{const j=JSON.parse(d);console.log(JSON.stringify(j.result,null,2))}
        catch(e){console.log(d)}
      })"
    ;;

  status)
    $CURL "$SERVER/health" 2>/dev/null | $NODE -e "
      let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{
        try{
          const j=JSON.parse(d);
          console.log('ix-browser status:');
          console.log('  Connected:', j.connected);
          console.log('  Chrome running:', j.chromeRunning);
          console.log('  Port:', j.port);
          console.log('  Home:', j.home);
          console.log('  Profile:', j.profile);
          console.log('  Screenshots:', j.screenshotDir);
        }catch(e){console.log('Server not responding')}
      })" || echo "Server not running"
    ;;

  start)
    if $CURL "$SERVER/health" >/dev/null 2>&1; then
      ok "Server already running"
      exit 0
    fi
    echo "Starting ix-browser server..."
    cd "$SCRIPT_DIR"
    # Install deps if needed
    if [ ! -d node_modules ]; then
      echo "Installing dependencies..."
      npm install --silent 2>/dev/null || npm install 2>&1 | tail -3
    fi
    mkdir -p "$IX_HOME/logs"
    nohup $NODE server.mjs >> "$IX_HOME/logs/browser.log" 2>&1 &
    echo $! > "$IX_HOME/browser.pid"
    for i in {1..20}; do
      if $CURL "$SERVER/health" >/dev/null 2>&1; then
        ok "Server started (pid $(cat "$IX_HOME/browser.pid"))"
        exit 0
      fi
      sleep 0.5
    done
    err "Server failed to start. Check $IX_HOME/logs/browser.log"
    ;;

  stop)
    if [ -f "$IX_HOME/browser.pid" ]; then
      kill "$(cat "$IX_HOME/browser.pid")" 2>/dev/null && ok "Server stopped" || echo "Server not running"
      rm -f "$IX_HOME/browser.pid"
    else
      pkill -f "node.*server.mjs" 2>/dev/null && ok "Server stopped" || echo "Server not running"
    fi
    ;;

  help|--help|-h)
    cat << 'HELP'
ix-browser — Headful Chrome automation for autonomous agents

Navigation:
  navigate <url>              Go to URL
  back                        Go back
  forward                     Go forward
  scroll [up|down] [pixels]   Scroll page (default: down 500)
  wait <text> [timeout_ms]    Wait for text to appear (default: 10s)

Reading:
  read                        Page markdown with indexed interactive elements
  screenshot [--full]         Save PNG (use Read tool to view it)
  eval <javascript>           Run JavaScript, return result

Interaction:
  click <index|text>          Click element by index or visible text
  type <index|text> <value>   Type into element (clears first)
  key <Enter|Tab|Escape>      Press keyboard key
  select <index|text> <value> Select dropdown option

Tabs:
  tabs                        List open tabs
  tab <index>                 Switch to tab
  tab new [url]               Open new tab
  tab close [index]           Close tab

Server:
  start                       Start server + launch Chrome
  stop                        Stop server
  status                      Health check + paths

Environment:
  IX_BROWSER_HOME             Root directory (default: ~/.ix-browser)
  BROWSER_PORT                Server port (default: 18840)
  CHROME_DEBUG_PORT           Chrome CDP port (default: 9222)
  BROWSER_PROFILE             Chrome profile dir (default: $IX_BROWSER_HOME/profiles/default)
  CHROME_PATH                 Chrome executable (auto-detected)
HELP
    ;;

  *)
    err "Unknown command: $1. Run 'browser.sh help' for usage."
    ;;
esac
