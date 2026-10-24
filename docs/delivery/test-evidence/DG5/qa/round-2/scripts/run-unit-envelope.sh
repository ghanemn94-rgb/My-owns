#!/usr/bin/env bash
# qa-verifier DG5 round 2 (D-134 load envelope): pnpm test x4 (Node 22/24 x locale unset/C.UTF-8), sequential.
# The 1-min load average is sampled every 15 s into 02-unit-envelope-samples$1.log. $1 = series label; $2.. = optional subset "node22:unset" ...
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-2; S=$E/02-unit-envelope-samples$1.log; : > $S; SER=$1; shift
COMBOS=("$@"); [ ${#COMBOS[@]} -eq 0 ] && COMBOS=(node22:unset node22:C node24:unset node24:C)
( while [ ! -f $TMPDIR/samp$SER.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $S; sleep 15; done ) & SP=$!
for c in "${COMBOS[@]}"; do NV=${c%%:*}; M=${c##*:}; echo "$(date -u +%T) START $NV $M" >> $S; bash $E/scripts/run-unit-one.sh $NV $M "$SER"; echo "$(date -u +%T) END $NV $M" >> $S; done
touch $TMPDIR/samp$SER.stop; wait $SP; rm -f $TMPDIR/samp$SER.stop
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())==4 and l.split()[1][0].isdigit()]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)}")
PY
echo ENVELOPE-DONE
