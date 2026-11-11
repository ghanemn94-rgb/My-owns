#!/bin/bash
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts
QA_PG_PORT=32524 $S/run.sh 11-integration-run2 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 tests/qa/support/with-pg.sh pnpm test:integration
echo SEQA3-DONE
