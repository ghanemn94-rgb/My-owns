#!/bin/bash
# Re-runs in $TMPDIR/rv2 on their own ports: (1) a20-s15-014-term-scan.spec.ts alone, both projects, locale unset
# (two tests of it failed in 22-e2e-root-unset under load: an error-state timeout and a browser 'Target crashed');
# (2) the DB text scans, after fixing my script's psql connection (its first run, 35*, failed to connect).
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts/seqB-common.sh
export QA_PG_PORT=32560 E2E_PG_PORT=32560 E2E_API_PORT=32565
mkdir -p $TMPDIR/shots-r1
E2E_SCREENSHOT_DIR=$TMPDIR/shots-r1 QA_EVIDENCE_DIR=$TMPDIR/ev-r1 $S/run.sh 22b-e2e-root-unset-term-scan-alone node24 env -u LANG -u LC_ALL -u LC_CTYPE apps/web/e2e/support/with-stack.sh $PW e2e/a20-s15-014-term-scan.spec.ts
$S/run.sh 35c-db-text-scan-demo-stack-run2 node24 e2e/support/with-demo-stack.sh bash $T/round-5/qa-rg-r5-db-text-scan.sh
$S/run.sh 35d-db-text-scan-production-stack-run2 node24 apps/web/e2e/support/with-stack.sh bash $T/round-5/qa-rg-r5-db-text-scan.sh
echo SEQR1-DONE
