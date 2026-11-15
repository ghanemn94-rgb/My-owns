#!/bin/bash
# Serial re-runs (no other run of mine in parallel): typecheck (first run OOM-killed, 137), unit (first run: 3 web
# timeouts at load 18, and its tail cut the unit-node summary), financial-parity (first run: ENOSPC), then mutants, e2e.
set -u
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
E=/home/user/My-owns/docs/delivery/test-evidence/DG7/code-security/round-2
cd $TMPDIR/rv
hdr() { echo "# $(date -u +%FT%TZ) $1 (Node $(node -v), cwd \$TMPDIR/rv at $(git rev-parse --short=9 HEAD), git status lines $(git status --short | wc -l), load $(cut -d' ' -f1-3 /proc/loadavg), free $(free -g | awk '/Mem/{print $7}')G)"; }
{ hdr "pnpm -r typecheck (serial re-run)"; pnpm -r --workspace-concurrency=1 typecheck 2>&1 | tail -20; echo "exit=${PIPESTATUS[0]}"; } > $E/04b-typecheck-rerun.log
{ hdr "pnpm test (unit projects, re-run; summaries and failures only)"; pnpm test 2>&1 | grep -E "RUN|Test Files|Tests |FAIL|×|✗|Error:|exit|ELIFECYCLE|skipped" | grep -v "^ *✓" | head -80; echo "exit=${PIPESTATUS[0]}"; } > $E/08b-unit-rerun.log
export QA_PG_PORT=32411 MTH_PORT_POOL=32412-32449
{ hdr "with-pg.sh vitest --project integration tests/integration/transfer/financial-parity.test.ts (re-run after ENOSPC)"; tests/qa/support/with-pg.sh npx vitest run --project integration tests/integration/transfer/financial-parity.test.ts 2>&1 | grep -v "^ *✓" | tail -25; echo "exit=${PIPESTATUS[0]}"; df -h $TMPDIR | tail -1; } > $E/10b-integration-financial-parity-rerun.log
$E/scripts/mutants.sh
$E/scripts/e2e.sh
echo RERUN-DONE >> $E/31-e2e-retention.log
