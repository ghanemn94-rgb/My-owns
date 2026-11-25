#!/usr/bin/env bash
# qa-verifier DG7 round 4, wave 1b (rv): the full integration project on a disposable PostgreSQL, locale unset.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG7/qa/round-4/scripts
QA_PG_PORT=32514 bash $S/run.sh 40-integration-unset env -u LANG -u LC_ALL -u LC_CTYPE tests/qa/support/with-pg.sh pnpm test:integration
echo "w1-integration done $(date -u +%FT%TZ)"
