#!/bin/bash
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts
QA_PG_PORT=32520 $S/run.sh 10-integration-run1 node24 env -u LANG -u LC_ALL -u LC_CTYPE tests/qa/support/with-pg.sh pnpm test:integration
echo SEQA2B-DONE
