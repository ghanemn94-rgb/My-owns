#!/bin/bash
# after pipe2 (C.UTF-8 pass): mutant M1 (edits the migrations dir, so alone), then the LANG-unset integration re-run (2 shards) and the targeted e2e concurrently
set -u
until [ -f $TMPDIR/pipe2-done ]; do sleep 15; done
until grep -q '^exit=' /home/user/My-owns/docs/delivery/test-evidence/DG6/code-security/round-7/05b-lint-rerun.log 2>/dev/null; do sleep 10; done
bash $TMPDIR/scripts/mutants.sh
bash $TMPDIR/scripts/integ.sh unset 1/2 32450 &
bash $TMPDIR/scripts/integ.sh unset 2/2 32455 &
bash $TMPDIR/scripts/e2e.sh &
wait
echo POST-DONE
