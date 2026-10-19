#!/usr/bin/env bash
# qa-verifier DG5 r3: after the integration chain, the round-2 export/provisional probe (UNCHANGED, from
# tests/round-2/integration) on a disposable PostgreSQL, writing the samples for REQ-DLV-037, then the inspections.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
until grep -q "^EXIT" $E/04-integration-run2.log 2>/dev/null; do sleep 30; done
echo "== tests/qa alone"; QA_RUN_TESTSQA=1 bash $E/scripts/run-integration.sh testsqa-alone 26656 tests/qa
echo "== packs probe"; bash $E/scripts/run-probe-integration.sh run1
cd $TMPDIR/rev && cp $E/scripts/inspect-samples.ts ./qa-inspect-samples.ts
{ echo "\$ node qa-inspect-samples.ts <evidence>/samples  (node $(/opt/nvm/versions/node/v24.21.0/bin/node -v), $(date -u +%FT%TZ))"; /opt/nvm/versions/node/v24.21.0/bin/node qa-inspect-samples.ts $E/samples 2>&1; echo "EXIT $?"; } > $E/07-sample-inspection.log
rm -f qa-inspect-samples.ts
cd $E && { echo "\$ python3 -I scripts/arabic-in-english.py  (cwd <evidence>)"; python3 -I scripts/arabic-in-english.py; echo "EXIT $?"; } > $E/07b-arabic-in-english-samples.log 2>&1
echo done
