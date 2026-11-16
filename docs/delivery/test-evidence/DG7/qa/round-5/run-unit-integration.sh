#!/usr/bin/env bash
# qa-verifier DG7 round 5: unit then integration suites in the disposable clone ($QA_REPO at the frozen source commit).
set -u
cd "${QA_REPO:?}"; E="${QA_E:?}"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
echo "unit start $(date -u +%T) HEAD $(git rev-parse HEAD) node $(node -v)"
env -u LANG -u LC_ALL QA_EVIDENCE_DIR=$TMPDIR/qaev-unit pnpm test > "$E/03-unit.log" 2>&1; echo "unit exit $? $(date -u +%T)"
QA_PG_PORT=32510 MTH_PORT_POOL=32511-32519 tests/qa/support/with-pg.sh npx vitest run --project integration > "$E/04-integration.log" 2>&1; echo "integration exit $? $(date -u +%T)"
