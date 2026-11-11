#!/bin/bash
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts
QA_PG_PORT=32526 $S/run.sh 12-tests-qa-integration-alone node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration tests/qa/integration
$S/run.sh 13-tests-qa-unit-alone node24 npx vitest run --configLoader runner --project unit-node tests/qa/unit
$S/run.sh 04b-unit-node22-unset-rerun node22 env -u LANG -u LC_ALL -u LC_CTYPE pnpm test
$S/seqC.sh
# typecheck again on the clean clone: the first one (03-static-typecheck) overlapped probe31b's temporary test file
{ cd $TMPDIR/rv && echo "## clone state before typecheck rerun (expect empty)"; git status --short; echo "(end)"; } > /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/03b-clone-before-typecheck-rerun.log 2>&1
$S/run.sh 03-static-typecheck-rerun node24 pnpm -r typecheck
echo SEQA4-DONE
