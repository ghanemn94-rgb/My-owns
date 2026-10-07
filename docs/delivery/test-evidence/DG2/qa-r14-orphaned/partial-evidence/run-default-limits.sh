#!/bin/bash
# qa-verifier DG2 round 14: the session-end checks with the product's DEFAULT rate limits (RATE_LIMIT_PER_MINUTE 300,
# AUTH_RATE_LIMIT_PER_MINUTE 20; apps/web/e2e/support/with-stack.sh with E2E_DEFAULT_RATE_LIMITS=1 unsets both) on the
# disposable clone $TMPDIR/review-dg2-e2e @d99de98 (freeze; candidate 9f3ca298, source ea9051b2), pre-installed
# Chromium, --workers=1. One stack per spec/test and per project, because the harness's own sign-ins (the login page's
# dev-login availability probe plus the dev-login itself, both on the 20/min per-IP auth bucket) would otherwise add up
# across tests; each session end itself is measured inside its own test.
#   - product apps/web/e2e/session-end.spec.ts (4 tests) per project;
#   - qa-verifier e2e/dg2-qa-r14.spec.ts R14-01, R14-02, R14-03, one stack each, per project.
# usage: run-default-limits.sh <unset|cutf8> <first port>
cd $TMPDIR/review-dg2-e2e
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
E=/home/user/My-owns/docs/delivery/test-evidence/DG2/qa/round-14/default-limits
mkdir -p $E
loc=$1; port=$2
if [ $loc = unset ]; then L="env -u LANG -u LC_ALL"; else L="env -u LC_ALL LANG=C.UTF-8"; fi
S=$TMPDIR/shots-default-$loc; rm -rf $S; mkdir -p $S
run() { # <log name> <project> <spec> [grep]
  f=$E/$1.log; proj=$2; spec=$3; g=$4
  { echo "\$ $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$port E2E_PG_PORT=$((port+300)) apps/web/e2e/support/with-stack.sh npx playwright test $spec --project=$proj ${g:+-g '$g'} --workers=1 --reporter=list"
    echo "# node $(node -v); $(date -u +%FT%TZ)"
    $L E2E_DEFAULT_RATE_LIMITS=1 E2E_API_PORT=$port E2E_PG_PORT=$((port+300)) E2E_SCREENSHOT_DIR=$S apps/web/e2e/support/with-stack.sh npx playwright test $spec --project=$proj ${g:+-g "$g"} --workers=1 --reporter=list 2>&1
    echo "exit $?"; } | sed "s#$TMPDIR#\$TMPDIR#g" > $f
  echo "$1: $(grep -cE '✓' $f) passed-lines, $(grep -cE '✘' $f) failed-lines, $(tail -1 $f)"
  port=$((port+1))
}
for proj in chromium-en chromium-ar; do
  run "$loc-$proj-product-session-end" $proj apps/web/e2e/session-end.spec.ts
  for t in R14-01 R14-02 R14-03; do run "$loc-$proj-qa-$t" $proj e2e/dg2-qa-r14.spec.ts "$t"; done
done
echo done $loc
