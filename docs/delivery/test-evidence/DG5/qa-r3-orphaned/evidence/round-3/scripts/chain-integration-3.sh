#!/usr/bin/env bash
# qa-verifier DG5 r3: tests/qa alone, the export/provisional probe (round-2 probe unchanged), and form-records.test.ts
# alone (its 5000-row export test timed out at 60 s in integration run 1 under load).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
echo "== tests/qa alone"; bash $S/run-integration.sh testsqa 26680 tests/qa
echo "== packs probe"; bash $S/run-probe-integration.sh run1
echo "== form-records alone"; bash $S/run-integration.sh form-records-alone 26688 apps/api/test/integration/forms/form-records.test.ts
