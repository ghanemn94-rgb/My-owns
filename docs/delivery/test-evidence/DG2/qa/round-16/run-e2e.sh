#!/bin/bash
# qa-verifier DG2 round 16: e2e per locale setting on the disposable clone $TMPDIR/review-dg2-e2e @e3b2375a
# (source commit; candidate 0cab0a8c recomputed identical), pre-installed Chromium, --workers=1, unique ports. Setup
# (once, clone only, never the candidate tree): `pnpm -r build` (02-build-e2e-clone.log); the clone's
# docs/delivery/test-evidence copy is deleted (playwright testMatch e2e/**/*.spec.ts) after the qa-verifier specs
# dg2-qa-r8..r16 are copied into the clone's e2e/.
#   15-e2e-product-<loc>.log  product journeys (apps/web/e2e incl. P1, P2, p2-blank-text, session-end) + e2e/a20 on
#                             apps/web/e2e/support/with-stack.sh (harness limits), chromium-en + chromium-ar
#   17-e2e-qa-stack-<loc>.log every spec (e2e/** incl. dg2-qa-r8..r16 + apps/web/e2e/**) on e2e/support/qa-stack.sh
#                             (R16-06 is excluded here: it reproduces finding F-DG2-580 and is run on its own, below)
#   19-r16-06-<loc>.log       R16-06 alone (finding reproduction; a failure is the documented F-DG2-580 behaviour)
#   16-e2e-default-limits-<loc>-<project>.log  with-stack.sh with E2E_DEFAULT_RATE_LIMITS=1 (product default limits:
#                             20 auth/min, 300 general/min), ONE project per stack: qa R14-03 + product session-end test 3
# (changed after the 'unset' run: R16-06 had used $S/qa and its afterAll overwrote the full run's axe-summary-qa-r16.json;
#  from the 'cutf8' run on it writes to $S/r1606)
# usage: run-e2e.sh <unset|cutf8> <base port>
cd $TMPDIR/review-dg2-e2e
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-16
loc=$1; p=$2
if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
S=$TMPDIR/shots-$loc; rm -rf $S test-results; mkdir -p $S/product $S/qa $S/defaults $S/r1606
{ echo "\$ $L E2E_API_PORT=$p E2E_PG_PORT=$((p+1)) E2E_SCREENSHOT_DIR=<shots> apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list"; echo "# node $(node -v); $(date -u +%FT%TZ)";
  $L E2E_API_PORT=$p E2E_PG_PORT=$((p+1)) E2E_SCREENSHOT_DIR=$S/product apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/15-e2e-product-$loc.log
{ echo "\$ $L QA_E2E_API_PORT=$((p+2)) QA_E2E_PG_PORT=$((p+3)) QA_SHOT_DIR=<shots> E2E_SCREENSHOT_DIR=<shots> QA_R8_QUERY_OPS=<21-query-ops.py output> e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --grep-invert R16-06 --workers=1 --reporter=list"; echo "# node $(node -v); $(date -u +%FT%TZ)";
  $L QA_E2E_API_PORT=$((p+2)) QA_E2E_PG_PORT=$((p+3)) QA_SHOT_DIR=$S/qa E2E_SCREENSHOT_DIR=$S/qa QA_R8_QUERY_OPS=$TMPDIR/query-ops.json e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --grep-invert R16-06 --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/17-e2e-qa-stack-$loc.log
q=$((p+4))
{ echo "\$ $L QA_E2E_API_PORT=$((p+8)) QA_E2E_PG_PORT=$((p+9)) QA_SHOT_DIR=<shots> E2E_SCREENSHOT_DIR=<shots> e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r16.spec.ts --grep R16-06 --workers=1 --reporter=list   # F-DG2-580 reproduction"; echo "# node $(node -v); $(date -u +%FT%TZ)";
  $L QA_E2E_API_PORT=$((p+8)) QA_E2E_PG_PORT=$((p+9)) QA_SHOT_DIR=$S/r1606 E2E_SCREENSHOT_DIR=$S/r1606 e2e/support/qa-stack.sh npx playwright test e2e/dg2-qa-r16.spec.ts --grep R16-06 --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/19-r16-06-$loc.log
for proj in chromium-en chromium-ar; do
 { echo "\$ $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$q E2E_PG_PORT=$((q+1)) E2E_SCREENSHOT_DIR=<shots> apps/web/e2e/support/with-stack.sh npx playwright test e2e/dg2-qa-r14.spec.ts apps/web/e2e/session-end.spec.ts --project $proj --grep 'R14-03|another browser context from the same IP' --workers=1 --reporter=list"; echo "# node $(node -v); $(date -u +%FT%TZ)";
   $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$q E2E_PG_PORT=$((q+1)) E2E_SCREENSHOT_DIR=$S/defaults apps/web/e2e/support/with-stack.sh npx playwright test e2e/dg2-qa-r14.spec.ts apps/web/e2e/session-end.spec.ts --project $proj --grep 'R14-03|another browser context from the same IP' --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/16-e2e-default-limits-$loc-$proj.log
 q=$((q+2))
done
echo done $loc
