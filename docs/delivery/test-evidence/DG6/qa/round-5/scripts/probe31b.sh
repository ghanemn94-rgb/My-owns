#!/bin/bash
# Re-run of my round-5 probe after fixing its own column name (automation_rule_version.version_no; P1 now compares
# whole rows minus the reworded column and row bookkeeping). In $TMPDIR/rv, own port.
R=/home/user/My-owns
S=$R/docs/delivery/test-evidence/DG6/qa/round-5/scripts
E=$R/docs/delivery/test-evidence/DG6/qa/round-5
cd $TMPDIR/rv || exit 9
T=apps/api/test/integration/text-scan
cp $R/docs/delivery/test-evidence/DG6/qa/tests/round-5/qa-rg-r5-seeded-0130.test.ts $T/
QA_PG_PORT=32512 $S/run.sh 31b-probe-qa-rg-r5-seeded-0130-run2 node24 tests/qa/support/with-pg.sh npx vitest run --configLoader runner --project integration $T/qa-rg-r5-seeded-0130.test.ts
rm -f $T/qa-rg-r5-seeded-0130.test.ts
{ echo "## clone state after probe31b (expect empty)"; git status --short; echo "(end)"; } > $E/34b-clone-after-probe31b.log 2>&1
echo P31B-DONE
