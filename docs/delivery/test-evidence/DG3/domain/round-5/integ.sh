#!/usr/bin/env bash
# domain-reviewer DG3 round 5: inside the disposable stack, the targeted integration suites of the repaired area
# (dispensations incl. the new inheritedApproval tests, gates, the contract checks) against a scratch DB on the stack's PG.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG3/domain/round-5
cd "$TMPDIR/review-dom"
export TEST_DATABASE_ADMIN_URL="postgresql://postgres@127.0.0.1:${PGP:-26401}/postgres"
{ echo "### $(node -v) vitest integration (targeted)"; npx vitest run --project integration apps/api/test/integration/portfolio apps/api/test/integration/gates apps/api/test/integration/gates.test.ts apps/api/test/integration/contract; echo "### integration exit=$?"; } > $E/integration-targeted.log 2>&1
tail -n 8 $E/integration-targeted.log
