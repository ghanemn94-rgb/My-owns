#!/usr/bin/env bash
# qa-verifier DG4 round 4: e2e on the real stack (qa-stack.sh). $1 = unset|cutf8, $2 = PG port, $3 = API port, $4 = label, rest = spec files
set -u
MODE=$1 PGP=$2 APIP=$3 LBL=$4; shift 4
C=${CLONE:-$TMPDIR/rv2}; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-4
SPEC=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-4/e2e/dg4-qa-r4.spec.ts
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
cd "$C"
cp "$SPEC" e2e/dg4-qa-r4.spec.ts
R=$E/results/e2e-$LBL-$MODE; rm -rf "$R"; mkdir -p "$R"; rm -rf test-results playwright-report
if [ "$MODE" = unset ]; then ENVP=(env -u LANG -u LC_ALL -u LC_CTYPE); ELBL="env -u LANG -u LC_ALL -u LC_CTYPE"; else ENVP=(env LANG=C.UTF-8 LC_ALL=C.UTF-8); ELBL="env LANG=C.UTF-8 LC_ALL=C.UTF-8"; fi
L=$E/04-e2e-$LBL-$MODE.log
{
echo "\$ [$ELBL] QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 e2e/support/qa-stack.sh npx playwright test $* --workers=1 --reporter=list  (node $(node -v), dg4-qa-r4.spec.ts sha256 $(sha256sum e2e/dg4-qa-r4.spec.ts | cut -c1-16), $(date -u +%FT%TZ))"
uptime
"${ENVP[@]}" QA_E2E_PG_PORT=$PGP QA_E2E_API_PORT=$APIP MTH_PORT_POOL=26500-26699 QA_RESULTS_DIR="$R" E2E_SCREENSHOT_DIR="$TMPDIR/shots-$LBL-$MODE" QA_EVIDENCE_DIR="$TMPDIR/shots-$LBL-$MODE" \
  e2e/support/qa-stack.sh npx playwright test "$@" --workers=1 --reporter=list 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"
date -u +%FT%TZ; uptime
} > "$L" 2>&1
rm -f e2e/dg4-qa-r4.spec.ts
tail -n 4 "$L"
