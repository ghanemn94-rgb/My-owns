#!/usr/bin/env bash
# qa-verifier DG7 round 2, sequence B: integration in the disposable clone $TMPDIR/rv (after 10-build).
#  40 full integration project, locale unset; 41 tests/qa/integration again with C.UTF-8. Disposable PostgreSQL each.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-2/scripts
R="bash $S/run.sh"
QA_PG_PORT=32510 $R 40-integration-unset env -u LANG -u LC_ALL -u LC_CTYPE tests/qa/support/with-pg.sh pnpm test:integration
QA_PG_PORT=32512 $R 41-integration-tests-qa-cutf8 env LANG=C.UTF-8 LC_ALL=C.UTF-8 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration
echo "seqB done $(date -u +%FT%TZ)"
