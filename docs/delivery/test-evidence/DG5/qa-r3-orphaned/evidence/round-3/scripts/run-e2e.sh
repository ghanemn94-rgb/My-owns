#!/usr/bin/env bash
# qa-verifier DG5 r3: Playwright on the real stack, --workers=1, both projects unless args say otherwise.
# $1 = unset|cutf8, $2 = prod|demo, $3 = PG port, $4 = API port, $5 = label, rest = spec files / playwright args.
set -u
MODE=$1 STK=$2 PGP=$3 APIP=$4 LBL=$5; shift 5
C=$TMPDIR/rev; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$C"
if [ "$STK" = demo ]; then SCR=e2e/support/with-demo-stack.sh; else SCR=apps/web/e2e/support/with-stack.sh; fi
OUT=$TMPDIR/pw-$LBL-$MODE; rm -rf $OUT; mkdir -p $OUT
SH=$E/shots/$LBL-$MODE; mkdir -p $SH
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); fi
L=$E/05-e2e-$LBL-$MODE.log; S=$E/05-e2e-$LBL-$MODE-samples.log; : > $S; rm -f $TMPDIR/e$LBL$MODE.stop
bash $E/scripts/sampler.sh $S $TMPDIR/e$LBL$MODE.stop & SP=$!
{ echo "\$ ${ENVP[*]} E2E_PG_PORT=$PGP E2E_API_PORT=$APIP MTH_PORT_POOL=26600-26699 E2E_SCREENSHOT_DIR=<evidence>/shots/$LBL-$MODE QA_EVIDENCE_DIR=<same> $SCR npx playwright test $* --workers=1 --reporter=list --trace=off --output=\$TMPDIR/pw  (node $(node -v), $(date -u +%FT%TZ))"; uptime
"${ENVP[@]}" E2E_PG_PORT=$PGP E2E_API_PORT=$APIP MTH_PORT_POOL=26600-26699 E2E_SCREENSHOT_DIR="$SH" QA_EVIDENCE_DIR="$SH" \
  $SCR npx playwright test "$@" --workers=1 --reporter=list --trace=off --output="$OUT" 2>&1 | sed -u "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > "$L" 2>&1
touch $TMPDIR/e$LBL$MODE.stop; wait $SP
# keep failure context (error-context.md / screenshots) small
if ls $OUT/*/ >/dev/null 2>&1; then mkdir -p $E/failure-context/$LBL-$MODE; find $OUT -name 'error-context.md' -o -name '*.png' | while read f; do d=$(basename $(dirname $f)); cp "$f" "$E/failure-context/$LBL-$MODE/$d-$(basename $f)"; done; fi
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "passed|failed|flaky|skipped|did not run|^EXIT" | tail -6
