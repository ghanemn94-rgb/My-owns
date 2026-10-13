#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-147): the candidate's 'a 403 is not a session end' x10 per project in $TMPDIR/rv3, with the
# 1-min load held at >= 13 by the same controller as run-unit-load-held.sh (busy loops added below 13.3, removed above 14.7).
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7; S=$E/04-e2e-f147-held-samples.log; : > $S
PIDS=()
ctl() { while [ -f $TMPDIR/loadctl147.on ]; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk "BEGIN{exit !($l < 13.3)}" && [ ${#PIDS[@]} -lt 24 ]; then bash -c 'while :; do :; done' & PIDS+=($!);
    elif awk "BEGIN{exit !($l > 14.7)}" && [ ${#PIDS[@]} -gt 0 ]; then kill ${PIDS[-1]}; unset 'PIDS[-1]'; fi
    echo "$(date -u +%T) load1=$l busy_loops=${#PIDS[@]}" >> $S; sleep 15; done
  for p in "${PIDS[@]}"; do kill $p 2>/dev/null; done; echo "$(date -u +%T) controller stopped; busy loops killed: ${#PIDS[@]}" >> $S; }
touch $TMPDIR/loadctl147.on; ctl & CTL=$!
sleep 180
CLONE=$TMPDIR/rv3 bash $E/scripts/run-e2e.sh unset 26680 26685 f147-contention-x10-held apps/web/e2e/session-end.spec.ts --grep "a 403 is not a session end" --repeat-each=10
rm -f $TMPDIR/loadctl147.on; wait $CTL
echo HELD147-DONE
