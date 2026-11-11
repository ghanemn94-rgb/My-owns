#!/bin/bash
# Track B chunk 1 in $TMPDIR/rv2: root acceptance specs (locale unset, inside the A21 connection-log wrapper), demo specs
# (locale unset), the independent DB text scans on both stacks, and the rendered-text probe for F-DG6-990.
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7/scripts/seqB-common.sh
mkdir -p $E/22-root-evidence-unset $TMPDIR/shots-unset
QA_EVIDENCE_DIR=$E/22-root-evidence-unset E2E_SCREENSHOT_DIR=$TMPDIR/shots-unset QA_CONNECTION_LOG=$TMPDIR/conn-unset.jsonl $S/run.sh 22-e2e-root-unset node24 env -u LANG -u LC_ALL -u LC_CTYPE e2e/support/a21-connection-log-run.sh $PW $ROOT_SPECS
gzip -c $TMPDIR/conn-unset.jsonl > $E/22-e2e-root-unset.connection-log.jsonl.gz 2>/dev/null
mkdir -p $E/23-demo-evidence-unset
QA_EVIDENCE_DIR=$E/23-demo-evidence-unset $S/run.sh 23-e2e-demo-unset node24 env -u LANG -u LC_ALL -u LC_CTYPE e2e/support/with-demo-stack.sh $PW $DEMO_SPECS
$S/run.sh 35-db-text-scan-demo-stack node24 e2e/support/with-demo-stack.sh bash $T/round-5/qa-rg-r5-db-text-scan.sh
$S/run.sh 35b-db-text-scan-production-stack node24 apps/web/e2e/support/with-stack.sh bash $T/round-5/qa-rg-r5-db-text-scan.sh
cp $T/round-5/zz-qa-rg-r5-served-text-ui.spec.ts $RV/apps/web/e2e/
$S/run.sh 36-probe-f990-rendered-screens node24 apps/web/e2e/support/with-stack.sh $PW apps/web/e2e/zz-qa-rg-r5-served-text-ui.spec.ts
rm -f $RV/apps/web/e2e/zz-qa-rg-r5-served-text-ui.spec.ts
{ cd $RV; echo "## rv2 state after seqB1 (expect empty)"; git status --short; echo "(end)"; } > $E/34e-rv2-after-seqB1.log 2>&1
echo SEQB1-DONE
