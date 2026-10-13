#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-148): pnpm test x4 (Node 22/24 x locale unset/C.UTF-8) with NO other job of mine running,
# so the load is the other two concurrent reviews' load plus this run only. Load sampled every 15 s. $1 = log suffix.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7; S=$E/02-unit-samples$1.log; : > $S
( while [ ! -f $TMPDIR/samp$1.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $S; sleep 15; done ) & SP=$!
for NV in node22 node24; do for M in unset C; do bash $E/scripts/run-unit-one.sh $NV $M $1; done; done
touch $TMPDIR/samp$1.stop; wait $SP; rm -f $TMPDIR/samp$1.stop
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())>1]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f}")
PY
echo CLEAN-DONE
