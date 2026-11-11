#!/bin/bash
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-3/scripts
R=/home/user/My-owns
D=apps/api/test/integration/assistant
cd $TMPDIR/rv || exit 9
cp $R/docs/delivery/test-evidence/DG6/qa/tests/round-3/qa-rg-r3-history-adversarial.test.ts $D/
QA_PG_PORT=32512 $S/run.sh 31b-probe-qa-rg-r3-adversarial-run2 node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $D/qa-rg-r3-history-adversarial.test.ts
rm -f $D/qa-rg-r3-history-adversarial.test.ts
{ echo "## clone state before sequence A (expect empty)"; git status --short; git diff HEAD --stat; echo "(end)"; } > $R/docs/delivery/test-evidence/DG6/qa/round-3/34b-clone-before-seqA.log 2>&1
$S/seqA.sh
