#!/usr/bin/env bash
# qa-verifier DG4 round 8 (F-DG4-148 / D-134 load envelope): pnpm test x4 (Node 22/24 x locale unset/C.UTF-8),
# run sequentially with no other job of mine; the other two reviewers do not run heavy tests this round (assignment).
# The 1-min load average is sampled every 15 s (envelope requires >= every 30 s) into 02-unit-envelope-samples$1.log.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-8; S=$E/02-unit-envelope-samples$1.log; : > $S
( while [ ! -f $TMPDIR/samp$1.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $S; sleep 15; done ) & SP=$!
for NV in node22 node24; do for M in unset C; do echo "$(date -u +%T) START $NV $M" >> $S; bash $E/scripts/run-unit-one.sh $NV $M "$1"; echo "$(date -u +%T) END $NV $M" >> $S; done; done
touch $TMPDIR/samp$1.stop; wait $SP; rm -f $TMPDIR/samp$1.stop
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())==4 and l.split()[1][0].isdigit()]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)}")
PY
echo ENVELOPE-DONE
