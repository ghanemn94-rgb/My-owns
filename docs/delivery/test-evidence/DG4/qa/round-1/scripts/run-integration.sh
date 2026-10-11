#!/usr/bin/env bash
# qa-verifier DG4 round 1: integration project on a disposable PostgreSQL. $1 = label, $2 = starting PG port, rest = extra vitest args
set -u
C=$TMPDIR/rv; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
LBL=$1; PORT=$2; shift 2
cd "$C"; L=$E/03-integration-$LBL.log
{
echo "\$ QA_PG_PORT=$PORT MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose $*   (node $(node -v), $(date -u +%FT%TZ))"
uptime
QA_PG_PORT=$PORT MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime
} > "$L" 2>&1
grep -E "^ +(Test Files|Tests) " "$L"; grep ^EXIT "$L"
