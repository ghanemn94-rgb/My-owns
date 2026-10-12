#!/usr/bin/env bash
# domain-reviewer DG4 round 5: the FULL integration project (backend suites + the qa acceptance suites A01-A14) and my
# in-process domain probe (zz-domain-r5.test.ts, copied into the clone only), on a disposable PostgreSQL cluster created
# by the candidate's own tests/qa/support/with-pg.sh (QA_PG_PORT 26410, my range). Vitest uses --configLoader runner.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/domain/round-5
cd "$TMPDIR/review-dom"
export PATH=/opt/nvm/versions/node/v24.21.0/bin:/opt/node22/bin:/usr/bin:/bin
cp "$E/zz-domain-r5.test.ts" tests/qa/integration/zz-domain-r5.test.ts
export QA_PG_PORT=${QA_PG_PORT:-26410} MTH_PORT_POOL=26411-26499
node -v
bash tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration ${INTEG_FILTER:-} 2>&1
s=$?
rm -f tests/qa/integration/zz-domain-r5.test.ts
echo "### integration exit=$s"
exit $s
