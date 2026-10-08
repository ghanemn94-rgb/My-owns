#!/usr/bin/env bash
# qa-verifier DG3 round 6: e2e on the real stack. $1 = unset|cutf8, $2 = PG port, $3 = API port
set -u
MODE=$1 PGP=$2 APIP=$3
C=$TMPDIR/review-dg3; E=/home/user/My-owns/docs/delivery/test-evidence/DG3/qa/round-6
SPEC=/home/user/My-owns/docs/delivery/test-evidence/DG3/qa/tests/round-6/e2e/dg3-qa-r6.spec.ts
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$C"
cp "$SPEC" e2e/dg3-qa-r6.spec.ts
R=$TMPDIR/ev/e2e-$MODE; rm -rf "$R"; mkdir -p "$R/shots"; rm -rf test-results playwright-report
SPECS="apps/web/e2e/journeys.spec.ts apps/web/e2e/p2-blank-text.spec.ts apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p3-business-cases.spec.ts apps/web/e2e/p3-g4-refusal.spec.ts apps/web/e2e/p3-inherited-approval.spec.ts apps/web/e2e/p3-journeys.spec.ts apps/web/e2e/p3-portfolio.spec.ts apps/web/e2e/p3-prioritization-roadmap.spec.ts apps/web/e2e/p3-seams.spec.ts apps/web/e2e/p3-ui-completion.spec.ts apps/web/e2e/session-end.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/dg3-qa-r6.spec.ts"
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); LBL="env -u LANG -u LC_ALL"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); LBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
L=$E/04-e2e-$MODE.log
{
echo "\$ [$LBL] QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 e2e/support/qa-stack.sh npx playwright test $SPECS --workers=1 --reporter=list  (node $(node -v), dg3-qa-r6.spec.ts sha256 $(sha256sum e2e/dg3-qa-r6.spec.ts | cut -c1-16), $(date -u +%FT%TZ))"
uptime
"${ENVP[@]}" QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 QA_RESULTS_DIR="$R" E2E_SCREENSHOT_DIR="$R/shots" \
  e2e/support/qa-stack.sh npx playwright test $SPECS --workers=1 --reporter=list
echo "EXIT $?"
date -u +%FT%TZ; uptime
} > "$L" 2>&1
rm -f e2e/dg3-qa-r6.spec.ts
tail -3 "$L"
