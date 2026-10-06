#!/bin/bash
# qa-verifier DG2 round 9: e2e per locale setting on the second disposable clone (@7854770e), pre-installed Chromium.
# The clone's docs/delivery/test-evidence/DG2/qa/tests copies are deleted first (playwright testMatch e2e/**/*.spec.ts).
cd $TMPDIR/review-dg2-e2e
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-9
loc=$1; api=$2; pg=$3; qapi=$4; qpg=$5
if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
S=$TMPDIR/shots-$loc; rm -rf $S; mkdir -p $S/product $S/qa
{ echo "\$ $L E2E_API_PORT=$api E2E_PG_PORT=$pg E2E_SCREENSHOT_DIR=<shots> apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list"; echo "# node $(node -v); $(date -u +%FT%TZ)";
  $L E2E_API_PORT=$api E2E_PG_PORT=$pg E2E_SCREENSHOT_DIR=$S/product apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/15-e2e-product-$loc.log
{ echo "\$ $L QA_E2E_API_PORT=$qapi QA_E2E_PG_PORT=$qpg QA_SHOT_DIR=<shots> E2E_SCREENSHOT_DIR=<shots> QA_R8_QUERY_OPS=<21-query-ops.py output> e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list"; echo "# node $(node -v); $(date -u +%FT%TZ)";
  $L QA_E2E_API_PORT=$qapi QA_E2E_PG_PORT=$qpg QA_SHOT_DIR=$S/qa E2E_SCREENSHOT_DIR=$S/qa QA_R8_QUERY_OPS=$TMPDIR/query-ops.json e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/17-e2e-qa-stack-$loc.log
echo done $loc
