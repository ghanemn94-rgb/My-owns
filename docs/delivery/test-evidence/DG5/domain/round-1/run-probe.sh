#!/usr/bin/env bash
# domain-reviewer DG5 r1: copy a probe spec into the disposable clone's e2e/ and run it on a stack.
#   run-probe.sh prod|demo <spec-basename> <log>
set -uo pipefail
EV=/home/user/My-owns/docs/delivery/test-evidence/DG5/domain/round-1
C="$TMPDIR/review-dg5"; cd "$C"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers
export E2E_SCREENSHOT_DIR="$EV/screens" MTH_PORT_POOL=26450-26499
cp "$EV/$2" "e2e/zz-$2"
echo "### $(date -u +%FT%TZ) load=$(cut -d' ' -f1-3 /proc/loadavg) HEAD $(git rev-parse HEAD) stack=$1 spec=$2"
if [ "$1" = prod ]; then
  E2E_PG_PORT=${PGP:-26460} E2E_API_PORT=${APIP:-26461} apps/web/e2e/support/with-stack.sh npx playwright test "e2e/zz-$2" --workers=1 --reporter=list ${EXTRA:-}
else
  E2E_PG_PORT=${PGP:-26470} E2E_API_PORT=${APIP:-26471} e2e/support/with-demo-stack.sh npx playwright test "e2e/zz-$2" --workers=1 --reporter=list ${EXTRA:-}
fi
S=$?; echo "### exit=$S $(date -u +%FT%TZ)"; rm -f "e2e/zz-$2"; exit $S
