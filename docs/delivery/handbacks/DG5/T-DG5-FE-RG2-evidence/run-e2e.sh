#!/usr/bin/env bash
# Usage: run-e2e.sh <unset|cutf8> <label> <spec...>  (from the repository root; ports 23200-23249 only, D-164)
set -uo pipefail
MODE=$1; LBL=$2; shift 2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
EV=docs/delivery/handbacks/DG5/T-DG5-FE-RG2-evidence
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); fi
OUT="$TMPDIR/pw-$LBL-$MODE"; SH="$TMPDIR/shots-$LBL-$MODE"; rm -rf "$OUT" "$SH"; mkdir -p "$SH"
LOG="$EV/$LBL-$MODE.log"
{ echo "\$ [$MODE] E2E_PG_PORT=23210 E2E_API_PORT=23220 MTH_PORT_POOL=23200-23249 apps/web/e2e/support/with-stack.sh npx playwright test $* --workers=1 --reporter=list (node $(node -v), $(date -u +%FT%TZ), load $(cut -d' ' -f1-3 /proc/loadavg))"; } > "$LOG"
"${ENVP[@]}" E2E_PG_PORT=23210 E2E_API_PORT=23220 MTH_PORT_POOL=23200-23249 E2E_SCREENSHOT_DIR="$SH" PLAYWRIGHT_JSON_OUTPUT_NAME="$EV/$LBL-$MODE.json" \
  apps/web/e2e/support/with-stack.sh npx playwright test "$@" --workers=1 --reporter=list,json --output="$OUT" >> "$LOG" 2>&1
RC=$?
echo "exit $RC ($(date -u +%FT%TZ), load $(cut -d' ' -f1-3 /proc/loadavg))" >> "$LOG"
echo "exit $RC"; tail -8 "$LOG"
