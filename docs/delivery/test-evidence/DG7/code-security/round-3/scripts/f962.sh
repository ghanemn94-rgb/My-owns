#!/bin/bash
# F-DG7-962: deterministic order probes (one vitest run per order, fresh disposable PostgreSQL each, file parallelism
# off, given-order sequencer), then revert-to-fail with the pre-fix guard file (git show f22c97b59:...).
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
export QA_PG_PORT=32411 MTH_PORT_POOL=32412-32439
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-3
cd $TMPDIR/rv
cp $E/scripts/probe-order.config.ts.txt probe-order.config.ts
G=packages/db/test/integration/p7-transfer-guards.test.ts
C=apps/api/test/integration/contract/contract.test.ts
R=apps/api/test/integration/contract/response-validation.test.ts
run() { QA_ORDER="$1" tests/qa/support/with-pg.sh npx vitest run --config probe-order.config.ts --project integration $G $C $R 2>&1 | grep -E "^ (✓|❯|×)|FAIL|Test Files|Tests |AssertionError|expected|export_in_progress|qa disposable" | head -40; echo "exit=${PIPESTATUS[0]}"; }
{
echo "# $(date -u +%FT%TZ) F-DG7-962 order probes (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), load $(cut -d' ' -f1-3 /proc/loadavg))"
sha256sum $G
echo "== P1 candidate: guard file FIRST, then contract, then response-validation"; run "p7-transfer-guards.test.ts,contract.test.ts,response-validation.test.ts"
echo "== P2 candidate: contract, response-validation, then guard file LAST"; run "contract.test.ts,response-validation.test.ts,p7-transfer-guards.test.ts"
echo "== M1 revert-to-fail: pre-fix guard file (f22c97b59) FIRST"
git show f22c97b5931a40969574f4e646ea480be4454861:$G > $G; git diff --stat
run "p7-transfer-guards.test.ts,contract.test.ts,response-validation.test.ts"
git checkout -- $G; sha256sum $G
rm -f probe-order.config.ts
echo "== final git status (must be clean)"; git status --short | head
echo "# end $(date -u +%FT%TZ)"
} > $E/30-f962-order-probes.log 2>&1
