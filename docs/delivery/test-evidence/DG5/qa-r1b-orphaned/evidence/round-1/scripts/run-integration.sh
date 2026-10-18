#!/usr/bin/env bash
# qa-verifier DG5 round 1: integration suite on a disposable PostgreSQL (tests/qa/support/with-pg.sh).
# $1 = label, $2 = starting PG port (26600-26699), rest = extra vitest args (e.g. tests/qa). Load sampled every 15 s.
set -u
C=${CLONE:-$TMPDIR/review-dg5r1}; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-1
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
LBL=$1; PORT=$2; shift 2
cd "$C"; L=$E/04-integration-$LBL.log; S=$E/04-integration-$LBL-samples.log; : > $S
( while [ ! -f $TMPDIR/int$LBL.stop ]; do echo "$(date -u +%T) $(cut -d' ' -f1-3 /proc/loadavg) disk_avail=$(df --output=avail -h $TMPDIR | tail -1)" >> $S; sleep 15; done ) & SP=$!
{
echo "\$ QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration $*  (node $(node -v), $(date -u +%FT%TZ))"
uptime
QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"
date -u +%FT%TZ; uptime
} > "$L" 2>&1
touch $TMPDIR/int$LBL.stop; wait $SP; rm -f $TMPDIR/int$LBL.stop
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "Test Files|Tests |Duration|^EXIT" | tail -5
