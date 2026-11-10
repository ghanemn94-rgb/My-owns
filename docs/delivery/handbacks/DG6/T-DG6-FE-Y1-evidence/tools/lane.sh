#!/bin/bash
# usage: lane.sh <lane-no> <phase: measure|verify> <outdir> spec...
lane=$1; phase=$2; out=$3; shift 3
cd /home/user/wt/dg6-fe-y1
base=$((28360 + lane*10))
extra=(); [ "$phase" = measure ] && extra=(--timeout=300000)
for s in "$@"; do
  log="$out/$phase-$s.log"; [ -n "$RERUN" ] && log="$out/$phase-$s.rerun.log"
  ( while :; do echo "[load $(date -u +%H:%M:%S)] $(cat /proc/loadavg)"; sleep 15; done ) > "${log%.log}.load" & sp=$!
  echo "=== $phase $s (lane $lane) start $(date -u +%H:%M:%S) load $(cat /proc/loadavg) extra=${extra[*]}" > "$log"
  E2E_SCREENSHOT_DIR=$TMPDIR/shots-$phase-$lane E2E_PG_PORT=$base E2E_API_PORT=$((base+1)) MTH_PORT_POOL=$((base+2))-$((base+9)) \
    timeout 2400 apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e/$s.spec.ts --workers=1 --reporter=list --output=$TMPDIR/tr-$phase-$lane "${extra[@]}" >> "$log" 2>&1
  rc=$?
  kill $sp
  echo "=== exit $rc end $(date -u +%H:%M:%S) load $(cat /proc/loadavg)" >> "$log"
done
