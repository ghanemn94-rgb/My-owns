#!/usr/bin/env bash
# qa-verifier DG4 round 4: the full e2e (apps/web/e2e + e2e, with my round-4 spec), locale unset then C.UTF-8, sequentially in $TMPDIR/rv2
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-4/scripts
cd $TMPDIR/rv2
SPECS=$(ls apps/web/e2e/*.spec.ts e2e/*.spec.ts | grep -v dg4-qa-r4; echo e2e/dg4-qa-r4.spec.ts)
CLONE=$TMPDIR/rv2 bash $S/run-e2e.sh unset 26620 26625 full $SPECS
CLONE=$TMPDIR/rv2 bash $S/run-e2e.sh cutf8 26640 26645 full $SPECS
echo E2E-CHAIN-DONE
