#!/bin/bash
# Run 2 of my rendered-screen probe after fixing the probe itself (its own waits and the page of its positive check).
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts/seqB-common.sh
export QA_PG_PORT=32570 E2E_PG_PORT=32570 E2E_API_PORT=32575
cp $T/round-5/zz-qa-rg-r5-served-text-ui.spec.ts $RV/apps/web/e2e/
$S/run.sh 36e-probe-f990-rendered-screens-run5 node24 apps/web/e2e/support/with-stack.sh $PW apps/web/e2e/zz-qa-rg-r5-served-text-ui.spec.ts
rm -f $RV/apps/web/e2e/zz-qa-rg-r5-served-text-ui.spec.ts
echo SEQR2-DONE
