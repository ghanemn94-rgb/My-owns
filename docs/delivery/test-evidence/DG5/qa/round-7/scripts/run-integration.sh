#!/usr/bin/env bash
# qa-verifier DG5 r7: integration project on a disposable PostgreSQL (tests/qa/support/with-pg.sh).
# $1 = label, $2 = starting PG port (26600-26699), rest = extra vitest args (e.g. tests/qa).
set -u
C=$TMPDIR/review-qa; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
LBL=$1; PORT=$2; shift 2
[ "$LBL" = testsqa ] && [ -z "${QA_RUN_TESTSQA:-}" ] && { echo "tests/qa alone deferred to its own task (2 h task limit)"; exit 0; }
# T-DG5-REV-QA-R7C: a per-label lock. Two background chains of this run can reach the same label (a chain I could
# not stop: the shell sandbox gives each command its own PID namespace). The first caller runs; a later caller waits
# for the first one's log to end and exits; a label reserved by hand ($TMPDIR/ilock-<label>/reserved) is skipped.
LK=$TMPDIR/ilock-$LBL
if ! mkdir "$LK" 2>/dev/null; then
  if [ -f "$LK/reserved" ]; then echo "label $LBL reserved: skipped by this caller"; exit 0; fi
  echo "label $LBL already running in another chain: waiting for it, then exiting"; until [ -f "$LK/done" ]; do sleep 20; done; exit 0
fi
trap 'touch "$LK/done"' EXIT
cd "$C"; L=$E/04-integration-$LBL.log; S=$E/04-integration-$LBL-samples.log; : > $S; rm -f $TMPDIR/i$LBL.stop
bash $E/scripts/sampler.sh $S $TMPDIR/i$LBL.stop & SP=$!
{ echo "\$ QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration $*  (node $(node -v), $(date -u +%FT%TZ))"; uptime
QA_PG_PORT=$PORT MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh pnpm test:integration "$@" 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; uptime; } > "$L" 2>&1
touch $TMPDIR/i$LBL.stop; wait $SP
sed 's/\x1b\[[0-9;]*m//g' "$L" | grep -E "Test Files|Tests |Duration|^EXIT" | tail -5
