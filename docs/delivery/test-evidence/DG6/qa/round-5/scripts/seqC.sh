#!/bin/bash
# Probes re-used from rounds 1/2 (unchanged areas, re-run on this candidate) + the load/export measurement. In $TMPDIR/rv.
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5
T=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/tests
cd $TMPDIR/rv || exit 9
cp $T/round-1/qa-r1-token-sequences.test.ts apps/api/test/integration/access/
cp $T/round-1/qa-r1-worker-burst.test.ts apps/worker/test/integration/
cp $T/round-1/qa-r1-ar-export-literals.test.ts packages/reporting/src/
QA_PG_PORT=32514 $S/run.sh 35-probe-token-sequences node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/api/test/integration/access/qa-r1-token-sequences.test.ts
QA_PG_PORT=32516 $S/run.sh 36-probe-worker-burst node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration apps/worker/test/integration/qa-r1-worker-burst.test.ts
$S/run.sh 37-probe-ar-export-literals node24 npx vitest run --configLoader runner --project unit-node packages/reporting/src/qa-r1-ar-export-literals.test.ts
rm -f apps/api/test/integration/access/qa-r1-token-sequences.test.ts apps/worker/test/integration/qa-r1-worker-burst.test.ts packages/reporting/src/qa-r1-ar-export-literals.test.ts
mkdir -p $E/50-load
QA_PG_PORT=32581 API_PORT=32580 SKIP_A=1 OUT=$E/50-load $S/run.sh 50-load-export node24 tests/qa/support/with-pg.sh bash $T/round-5/load-driver-rg-r5.sh
{ echo "## clone state after seqC (expect empty)"; git status --short; echo "(end)"; } > $E/34c-clone-after-seqC.log 2>&1
echo SEQC-DONE
