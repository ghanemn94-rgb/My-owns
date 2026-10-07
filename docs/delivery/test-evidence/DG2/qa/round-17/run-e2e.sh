#!/bin/bash
# qa-verifier DG2 round 17: e2e per locale setting on the disposable clone $TMPDIR/review-dg2-e2e @805da3e2
# (source commit; candidate ddaab3cc recomputed identical), pre-installed Chromium, --workers=1, unique ports. Setup
# (once, clone only, never the candidate tree): `pnpm -r build` (02-build-e2e-clone.log); the clone's
# docs/delivery/test-evidence copy is deleted (playwright testMatch e2e/**/*.spec.ts) after the qa-verifier specs
# dg2-qa-r8..r17 are copied into the clone's e2e/ (r16 unchanged, sha256 408a6a14...).
#   15-e2e-product-<loc>.log  product journeys (apps/web/e2e: P1 journeys, P2 journeys incl. Define->G2 and Design->G3,
#                             p2-blank-text, session-end) + e2e/a20 on apps/web/e2e/support/with-stack.sh,
#                             chromium-en + chromium-ar
#   17-e2e-qa-stack-<loc>.log EVERY spec (e2e/** incl. dg2-qa-r8..r17, R16-06 INCLUDED this round, + apps/web/e2e/**)
#                             on e2e/support/qa-stack.sh, chromium-en + chromium-ar
#   16-e2e-default-limits-<loc>-<project>.log  with-stack.sh with E2E_DEFAULT_RATE_LIMITS=1 (product default limits),
#                             ONE project per stack: qa R14-03 + product session-end test 3
# usage: run-e2e.sh <unset|cutf8> <base port>
cd $TMPDIR/review-dg2-e2e
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-17
loc=$1; p=$2
if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
S=$TMPDIR/shots-$loc; rm -rf $S test-results; mkdir -p $S/product $S/qa $S/defaults
{ echo "\$ $L E2E_API_PORT=$p E2E_PG_PORT=$((p+1)) E2E_SCREENSHOT_DIR=<shots> apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list"; echo "# clone @805da3e2; node $(node -v); $(date -u +%FT%TZ)";
  $L E2E_API_PORT=$p E2E_PG_PORT=$((p+1)) E2E_SCREENSHOT_DIR=$S/product apps/web/e2e/support/with-stack.sh npx playwright test apps/web/e2e e2e/a20-bilingual-shell.spec.ts --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/15-e2e-product-$loc.log
echo "15 $loc: $(tail -n 1 $E/15-e2e-product-$loc.log)"
{ echo "\$ $L QA_E2E_API_PORT=$((p+2)) QA_E2E_PG_PORT=$((p+3)) QA_SHOT_DIR=<shots> E2E_SCREENSHOT_DIR=<shots> QA_R8_QUERY_OPS=<21-query-ops.py output> e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list"; echo "# clone @805da3e2; node $(node -v); $(date -u +%FT%TZ)";
  $L QA_E2E_API_PORT=$((p+2)) QA_E2E_PG_PORT=$((p+3)) QA_SHOT_DIR=$S/qa E2E_SCREENSHOT_DIR=$S/qa QA_R8_QUERY_OPS=$TMPDIR/query-ops.json e2e/support/qa-stack.sh npx playwright test e2e apps/web/e2e --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/17-e2e-qa-stack-$loc.log
echo "17 $loc: $(tail -n 1 $E/17-e2e-qa-stack-$loc.log)"
q=$((p+4))
for proj in chromium-en chromium-ar; do
 { echo "\$ $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$q E2E_PG_PORT=$((q+1)) E2E_SCREENSHOT_DIR=<shots> apps/web/e2e/support/with-stack.sh npx playwright test e2e/dg2-qa-r14.spec.ts apps/web/e2e/session-end.spec.ts --project $proj --grep 'R14-03|another browser context from the same IP' --workers=1 --reporter=list"; echo "# clone @805da3e2; node $(node -v); $(date -u +%FT%TZ)";
   $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$q E2E_PG_PORT=$((q+1)) E2E_SCREENSHOT_DIR=$S/defaults apps/web/e2e/support/with-stack.sh npx playwright test e2e/dg2-qa-r14.spec.ts apps/web/e2e/session-end.spec.ts --project $proj --grep 'R14-03|another browser context from the same IP' --workers=1 --reporter=list 2>&1; echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $E/16-e2e-default-limits-$loc-$proj.log
 echo "16 $loc $proj: $(tail -n 1 $E/16-e2e-default-limits-$loc-$proj.log)"
 q=$((q+2))
done
# keep the axe summaries and the qa-r17 screenshots (EN + AR) as evidence
for k in product qa; do mkdir -p $E/e2e-$k-$loc; for l in en ar; do for f in $S/$k/$l/axe-summary*.json; do [ -f "$f" ] && cp "$f" $E/e2e-$k-$loc/$k-$l-$(basename $f); done; done; done
mkdir -p $E/screens; for l in en ar; do for f in $S/qa/$l/*qa-r17*.png $S/qa/$l/*qa-r16-06*.png; do [ -f "$f" ] && cp "$f" $E/screens/$loc-$l-$(basename $f); done; done
echo done $loc
