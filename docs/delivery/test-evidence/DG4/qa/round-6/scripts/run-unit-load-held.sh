#!/usr/bin/env bash
# qa-verifier DG4 round 6 (F-DG4-145): the round-5 contention runs repeated at load 13-15. A controller adds or removes
# unpinned busy loops every 15 s to hold the 1-min load average between 13 and 15 (my e2e run and the other reviews count
# towards it), while pnpm test runs 4 times (Node 22/24 x locale unset/C.UTF-8). Load samples: 02-unit-load-held-samples.log.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6
S=$E/02-unit-load-held-samples.log; : > $S
PIDS=()
ctl() { while [ -f $TMPDIR/loadctl.on ]; do
    l=$(cut -d' ' -f1 /proc/loadavg)
    if awk "BEGIN{exit !($l < 13.3)}" && [ ${#PIDS[@]} -lt 24 ]; then bash -c 'while :; do :; done' & PIDS+=($!);
    elif awk "BEGIN{exit !($l > 14.7)}" && [ ${#PIDS[@]} -gt 0 ]; then kill ${PIDS[-1]}; unset 'PIDS[-1]'; fi
    echo "$(date -u +%T) load1=$l busy_loops=${#PIDS[@]}" >> $S; sleep 15; done
  for p in "${PIDS[@]}"; do kill $p 2>/dev/null; done; echo "$(date -u +%T) controller stopped; busy loops killed: ${#PIDS[@]}" >> $S; }
touch $TMPDIR/loadctl.on; ctl & CTL=$!
sleep 240   # let the load settle into the band first
bash $E/scripts/run-unit.sh -load13-15
rm -f $TMPDIR/loadctl.on; wait $CTL
echo LOADHELD-DONE
