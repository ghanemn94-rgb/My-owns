#!/usr/bin/env bash
# qa-verifier DG5 round 1: e2e specs on the real stack, --workers=1, chromium-en and chromium-ar.
# $1 = unset|cutf8, $2 = stack (prod = apps/web/e2e/support/with-stack.sh | demo = e2e/support/with-demo-stack.sh),
# $3 = PG port, $4 = API port, $5 = label, rest = spec files / playwright args.
set -u
MODE=$1 STK=$2 PGP=$3 APIP=$4 LBL=$5; shift 5
C=${CLONE:-$TMPDIR/review-dg5r1}; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$C"
if [ "$STK" = demo ]; then SCR=e2e/support/with-demo-stack.sh; else SCR=apps/web/e2e/support/with-stack.sh; fi
OUT=$TMPDIR/pw-$LBL-$MODE; rm -rf $OUT; mkdir -p $OUT
SH=$TMPDIR/shots-$LBL-$MODE; rm -rf $SH; mkdir -p $SH
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); ELBL="env -u LANG -u LC_ALL -u LC_CTYPE"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); ELBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
L=$E/05-e2e-$LBL-$MODE.log; S=$E/05-e2e-$LBL-$MODE-samples.log; : > $S
( while [ ! -f $TMPDIR/e2e$LBL$MODE.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg) disk_avail=$(df --output=avail -h $TMPDIR | tail -1)" >> $S; sleep 15; done ) & SP=$!
{
echo "\$ [$ELBL] E2E_PG_PORT=$PGP E2E_API_PORT=$APIP MTH_PORT_POOL=26600-26699 E2E_SCREENSHOT_DIR=\$TMPDIR/shots QA_EVIDENCE_DIR=\$TMPDIR/shots $SCR npx playwright test $* --workers=1 --reporter=list --trace=off --output=\$TMPDIR/pw  (node $(node -v), $(date -u +%FT%TZ))"
uptime
"${ENVP[@]}" E2E_PG_PORT=$PGP E2E_API_PORT=$APIP MTH_PORT_POOL=26600-26699 E2E_SCREENSHOT_DIR="$SH" QA_EVIDENCE_DIR="$SH" \
  $SCR npx playwright test "$@" --workers=1 --reporter=list --trace=off --output="$OUT" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"
date -u +%FT%TZ; uptime
} > "$L" 2>&1
touch $TMPDIR/e2e$LBL$MODE.stop; wait $SP; rm -f $TMPDIR/e2e$LBL$MODE.stop
tail -n 5 "$L"
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())>=4]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)}")
PY
