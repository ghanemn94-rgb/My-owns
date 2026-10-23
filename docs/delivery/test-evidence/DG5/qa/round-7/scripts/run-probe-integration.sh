#!/usr/bin/env bash
# qa-verifier r7 (round-3 harness, ports moved): copy the probe into the disposable clone, run it alone on a disposable PostgreSQL, remove it.
set -u
C=$TMPDIR/review-qa; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7; T=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=zz-qa-dg5r2-packs-provisional-samples.test.ts; LBL=${1:-run1}
# T-DG5-REV-QA-R7C: a per-label lock. Two background chains of this run can reach the same label (a chain I could
# not stop: the shell sandbox gives each command its own PID namespace). The first caller runs; a later caller waits
# for the first one's log to end and exits; a label reserved by hand ($TMPDIR/ilock-<label>/reserved) is skipped.
LK=$TMPDIR/ilock-probe-$LBL
if ! mkdir "$LK" 2>/dev/null; then
  if [ -f "$LK/reserved" ]; then echo "label probe-$LBL reserved: skipped by this caller"; exit 0; fi
  echo "label probe-$LBL already running in another chain: waiting for it, then exiting"; until [ -f "$LK/done" ]; do sleep 20; done; exit 0
fi
trap 'touch "$LK/done"' EXIT
cp $T/integration/$F $C/tests/qa/integration/$F; cd $C
mkdir -p $E/samples
L=$E/06-probe-packs-provisional-$LBL.log
{ echo "\$ QA_SAMPLES_DIR=<evidence>/samples QA_PG_PORT=26690 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/$F  (node $(node -v), $(date -u +%FT%TZ))"; uptime
QA_SAMPLES_DIR=$E/samples QA_PG_PORT=26690 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/$F 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s#$E#<evidence>#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; } > $L 2>&1
rm -f $C/tests/qa/integration/$F
sed 's/\x1b\[[0-9;]*m//g' $L | grep -E "Test Files|Tests |^EXIT|✓|×"
