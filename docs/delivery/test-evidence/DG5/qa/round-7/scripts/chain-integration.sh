#!/usr/bin/env bash
# qa-verifier DG5 r7: integration twice on a disposable PostgreSQL, then tests/qa alone, then the export-sample probe,
# then the p5-pending lists. $1 = A (run1, run2) | B (the rest), so each fits a 2 h task. Waits for the unit chain to finish first (load).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts; E=$(dirname $S)
until grep -q '^EXIT' $E/02-unit-node24-cutf8.log 2>/dev/null; do sleep 20; done
if [ "${1:-A}" = A ]; then
echo "== run1"; bash $S/run-integration.sh run1 26600
echo "== run2"; bash $S/run-integration.sh run2 26602
else
echo "== tests/qa alone"; QA_RUN_TESTSQA=1 bash $S/run-integration.sh testsqa-alone 26604 tests/qa
echo "== export samples"; bash $S/run-probe-integration.sh run1
echo "== pending lists"; (cd $TMPDIR/review-qa && export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH && { echo "\$ node scripts/pending-lists.mjs (copy of $S/pending-lists.mjs, run in the clone root; node $(node -v))"; node $S/pending-lists.mjs; echo "EXIT $?"; } > $E/04-pending-lists.txt 2>&1); tail -2 $E/04-pending-lists.txt
fi
