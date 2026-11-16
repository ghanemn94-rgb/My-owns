#!/usr/bin/env bash
# qa-verifier DG7 round 3: F-DG7-962 order-dependence probe with revert-to-fail. Runs in $TMPDIR/m2 (sparse clone at
# 8323dac, candidate recomputed). Config: vitest.qa-order.config.ts (copy of round-2 probe config, untracked).
set -u
cd "$TMPDIR/m2"
G=packages/db/test/integration/p7-transfer-guards.test.ts
C=apps/api/test/integration/contract/contract.test.ts
R=apps/api/test/integration/contract/response-validation.test.ts
run() { # $1 label, $2 order, $3 port
  echo "=== $1 (order: $2) $(date -u +%T)"
  QA_ORDER="$2" QA_PG_PORT="$3" MTH_PORT_POOL=32540-32549 tests/qa/support/with-pg.sh \
    npx vitest run --config vitest.qa-order.config.ts --project integration "$G" "$C" "$R" 2>&1 \
    | grep -E 'Test Files|Tests |✓ .*\.test\.ts|❯ .*\.test\.ts|× |FAIL |export_in_progress|RUN ' | head -60
  echo "=== $1 exit ${PIPESTATUS[0]}"
}
echo "HEAD $(git rev-parse HEAD); $(node tools/gates/candidate.mjs --stage DG7)"
run "P1 candidate, guard first" "$G,$C,$R" 32550
run "P2 candidate, guard last" "$C,$R,$G" 32551
cp "$G" "$TMPDIR/guard.keep"
git show f22c97b5:"$G" > "$G"
echo "--- P3: guard file reverted to f22c97b5 (round-2 candidate): $(git diff --stat | tail -1)"
run "P3 reverted guard file, guard first (expected to FAIL)" "$G,$C,$R" 32552
cp "$TMPDIR/guard.keep" "$G"
echo "--- restored: $(git status --short | wc -l) changed; $(node tools/gates/candidate.mjs --stage DG7)"
