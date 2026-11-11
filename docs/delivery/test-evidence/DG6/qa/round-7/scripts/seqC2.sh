#!/bin/bash
# Re-run of seqC's load/export step only: the first attempt exited 127 because seqC.sh named a non-existent driver path
# (my copy error, kept in interrupted-2h-limit/50-load-export.harness-path-error.log). seqC.sh is corrected.
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7
T=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/tests
cd $TMPDIR/rv || exit 9
mkdir -p $E/50-load
QA_PG_PORT=32581 API_PORT=32580 SKIP_A=1 OUT=$E/50-load $S/run.sh 50-load-export node24 tests/qa/support/with-pg.sh bash $T/round-7/load-driver-rg-r7.sh
{ echo "## clone state after seqC2 (expect empty)"; git status --short; echo "(end)"; } > $E/34c-clone-after-seqC.log 2>&1
echo SEQC2-DONE
