#!/usr/bin/env bash
# qa-verifier r4: copy the probe into the disposable clone, run it alone on a disposable PostgreSQL, remove it.
set -u
C=$TMPDIR/rev; E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4; T=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-2
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=zz-qa-dg5r2-packs-provisional-samples.test.ts; LBL=${1:-run1}
cp $T/integration/$F $C/tests/qa/integration/$F; cd $C
mkdir -p $E/samples
L=$E/06-probe-packs-provisional-$LBL.log
{ echo "\$ QA_SAMPLES_DIR=<evidence>/samples QA_PG_PORT=26640 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/$F  (node $(node -v), $(date -u +%FT%TZ))"; uptime
QA_SAMPLES_DIR=$E/samples QA_PG_PORT=26640 MTH_PORT_POOL=26600-26699 tests/qa/support/with-pg.sh npx vitest run --project integration tests/qa/integration/$F 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g; s#$E#<evidence>#g"
echo "EXIT ${PIPESTATUS[0]}"; date -u +%FT%TZ; } > $L 2>&1
rm -f $C/tests/qa/integration/$F
sed 's/\x1b\[[0-9;]*m//g' $L | grep -E "Test Files|Tests |^EXIT|✓|×"
