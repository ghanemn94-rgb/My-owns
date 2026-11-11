#!/bin/bash
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts/seqB-common.sh
mkdir -p $E/22-root-evidence-cutf8 $TMPDIR/shots-cutf8 $E/23-demo-evidence-cutf8
QA_EVIDENCE_DIR=$E/22-root-evidence-cutf8 E2E_SCREENSHOT_DIR=$TMPDIR/shots-cutf8 $S/run.sh 22-e2e-root-cutf8 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 apps/web/e2e/support/with-stack.sh $PW $ROOT_SPECS
QA_EVIDENCE_DIR=$E/23-demo-evidence-cutf8 $S/run.sh 23-e2e-demo-cutf8 node24 env LANG=C.UTF-8 LC_ALL=C.UTF-8 e2e/support/with-demo-stack.sh $PW $DEMO_SPECS
echo SEQB3-DONE
