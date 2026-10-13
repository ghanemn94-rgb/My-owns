#!/usr/bin/env bash
# qa-verifier DG4 round 7: pnpm test x4 (Node 22/24 x locale unset/C.UTF-8) under the concurrent-review load, in $TMPDIR/rv
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts
bash $S/run-unit.sh
echo CHAIN-DONE
