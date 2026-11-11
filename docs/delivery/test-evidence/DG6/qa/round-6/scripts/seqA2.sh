#!/bin/bash
# Track A chunk 2: unit on Node 22 (both locales), integration run 1 (locale unset)
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-6/scripts
$S/run.sh 04-unit-node22-unset node22 env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$S/run.sh 04-unit-node22-cutf8 node22 env LANG=C.UTF-8 LC_ALL=C.UTF-8 pnpm test
QA_PG_PORT=32520 $S/run.sh 10-integration-run1 node24 env -u LANG -u LC_ALL -u LC_CTYPE tests/qa/support/with-pg.sh pnpm test:integration
echo SEQA2-DONE
