#!/usr/bin/env bash
# qa-verifier DG4 round 7: my worker-cadence probe (tests/round-7/integration/dg4-qa-r7-worker-cadence.test.ts) on a
# disposable PostgreSQL, in the copy $TMPDIR/rv4 (built). The file is copied in for the run and removed afterwards.
set -u
C=$TMPDIR/rv4; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-7/integration/dg4-qa-r7-worker-cadence.test.ts
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; cp $T tests/qa/integration/; L=$E/03b-integration-worker-cadence-probe${1:-}.log
{ echo "\$ QA_PG_PORT=26600 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose tests/qa/integration/dg4-qa-r7-worker-cadence.test.ts apps/worker/test/integration/supervise-cadence.test.ts  (probe sha256 $(sha256sum $T | cut -c1-16), node $(node -v), $(date -u +%FT%TZ))"; uptime
  QA_PG_PORT=26600 MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration --reporter=verbose tests/qa/integration/dg4-qa-r7-worker-cadence.test.ts apps/worker/test/integration/supervise-cadence.test.ts 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
  echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > $L 2>&1
rm -f tests/qa/integration/dg4-qa-r7-worker-cadence.test.ts
sed 's/\x1b\[[0-9;]*m//g' $L | grep -E "✓|×|qa-r7 R1 idle|Test Files|Tests |EXIT"
