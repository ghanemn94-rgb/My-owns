#!/usr/bin/env bash
# qa-verifier DG4 round 10: product e2e specs on the real stack (e2e/support/qa-stack.sh), --workers=1,
# chromium-en and chromium-ar. $1 = unset|cutf8, $2 = PG port, $3 = API port, $4 = label, rest = spec files / args.
set -u
MODE=$1 PGP=$2 APIP=$3 LBL=$4; shift 4
C=${CLONE:-$TMPDIR/review-dg4r10}; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-10
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$C"; rm -rf test-results playwright-report
SH=$TMPDIR/shots-$LBL-$MODE; rm -rf $SH; mkdir -p $SH
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); ELBL="env -u LANG -u LC_ALL -u LC_CTYPE"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); ELBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
L=$E/05-e2e-$LBL-$MODE.log; S=$E/05-e2e-$LBL-$MODE-samples.log; : > $S
( while [ ! -f $TMPDIR/e2e$LBL$MODE.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $S; sleep 15; done ) & SP=$!
{
echo "\$ [$ELBL] QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 e2e/support/qa-stack.sh npx playwright test $* --workers=1 --reporter=list  (node $(node -v), $(date -u +%FT%TZ))"
uptime
"${ENVP[@]}" QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 E2E_SCREENSHOT_DIR="$SH" QA_EVIDENCE_DIR="$SH" QA_RESULTS_DIR="$SH" \
  e2e/support/qa-stack.sh npx playwright test "$@" --workers=1 --reporter=list 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"
date -u +%FT%TZ; uptime
} > "$L" 2>&1
touch $TMPDIR/e2e$LBL$MODE.stop; wait $SP; rm -f $TMPDIR/e2e$LBL$MODE.stop
tail -n 6 "$L"
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())==4]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)}")
PY
