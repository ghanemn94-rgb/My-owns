#!/usr/bin/env bash
# qa-verifier DG3 round 7: integration project on a disposable PostgreSQL. $1 = run number, $2 = starting PG port
set -u
C=$TMPDIR/review-dg3; E=/home/user/My-owns/docs/delivery/test-evidence/DG3/qa/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; L=$E/03-integration-run$1.log
{
echo "\$ QA_PG_PORT=$2 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose   (node $(node -v), $(date -u +%FT%TZ))"
uptime
QA_PG_PORT=$2 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --project integration --reporter=verbose
echo "EXIT $?"; date -u +%FT%TZ; uptime
} > "$L" 2>&1
tail -4 "$L"
