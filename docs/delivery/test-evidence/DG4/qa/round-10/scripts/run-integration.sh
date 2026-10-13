#!/usr/bin/env bash
# qa-verifier DG4 round 10: full integration suite on a disposable PostgreSQL, as the assignment names it:
#   tests/qa/support/with-pg.sh pnpm test:integration
# $1 = label, $2 = starting PG port (26500-26699 range). 1-min load sampled every 15 s into 03-integration-<label>-samples.log.
set -u
C=$TMPDIR/review-dg4r10; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-10
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
LBL=$1; PORT=$2; shift 2
cd "$C"; L=$E/04-integration-$LBL.log; S=$E/04-integration-$LBL-samples.log; : > $S
( while [ ! -f $TMPDIR/int$LBL.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg)" >> $S; sleep 15; done ) & SP=$!
{
echo "\$ QA_PG_PORT=$PORT MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh pnpm test:integration $*  (node $(node -v), $(date -u +%FT%TZ))"
uptime
QA_PG_PORT=$PORT MTH_PORT_POOL=26500-26699 tests/qa/support/with-pg.sh pnpm test:integration "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime
} > "$L" 2>&1
touch $TMPDIR/int$LBL.stop; wait $SP; rm -f $TMPDIR/int$LBL.stop
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "^ +(Test Files|Tests) |^EXIT"
python3 - $S <<'PY'
import sys,statistics; v=[float(l.split()[1]) for l in open(sys.argv[1]) if len(l.split())==4]
print(f"load1 samples n={len(v)} min={min(v):.2f} median={statistics.median(v):.2f} max={max(v):.2f} above8={sum(x>8 for x in v)}")
PY
