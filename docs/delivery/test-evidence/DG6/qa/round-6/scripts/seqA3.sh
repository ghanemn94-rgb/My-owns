#!/bin/bash
# Track A chunk 3: integration run 2 (C.UTF-8), tests/qa alone (integration + unit)
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-6/scripts
QA_PG_PORT=32524 $S/run.sh 11-integration-run2 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 tests/qa/support/with-pg.sh pnpm test:integration
QA_PG_PORT=32526 $S/run.sh 12-tests-qa-integration-alone node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration
$S/run.sh 13-tests-qa-unit-alone node24 npx vitest run --configLoader runner --project unit-node tests/qa/unit
echo SEQA3-DONE
