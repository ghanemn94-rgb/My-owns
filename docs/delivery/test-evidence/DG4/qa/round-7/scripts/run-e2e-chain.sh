#!/usr/bin/env bash
# qa-verifier DG4 round 7: full e2e (all 31 candidate spec files) locale unset, then C.UTF-8, in $TMPDIR/rv2
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts
bash $S/run-e2e.sh unset 26600 26605 full
bash $S/run-e2e.sh cutf8 26620 26625 full
echo E2E-CHAIN-DONE
