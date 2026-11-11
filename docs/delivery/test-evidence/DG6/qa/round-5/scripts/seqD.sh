#!/bin/bash
# e2e probes re-used from round 1 (P6 reflow 360/390/200 %, AUD read-only, XSS, S17-001 run UI; keyboard walkthrough). In $TMPDIR/rv2.
. /home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-5/scripts/seqB-common.sh
export QA_PG_PORT=32550 E2E_PG_PORT=32550 E2E_API_PORT=32555
cd $RV || exit 9
cp $T/round-1/zz-qa-rg-r1-p6-reflow-aud.spec.ts $T/round-1/zz-qa-rg-r1-s17-001-run-ui.spec.ts $T/round-1/zz-qa-rg-r1-walkthrough-keyboard-reach.spec.ts apps/web/e2e/
$S/run.sh 38-probe-p6-reflow-aud-xss-s17 node24 apps/web/e2e/support/with-stack.sh $PW apps/web/e2e/zz-qa-rg-r1-p6-reflow-aud.spec.ts apps/web/e2e/zz-qa-rg-r1-s17-001-run-ui.spec.ts
$S/run.sh 39-probe-walkthrough-keyboard-demo node24 e2e/support/with-demo-stack.sh $PW apps/web/e2e/p6-walkthrough-keyboard.spec.ts apps/web/e2e/zz-qa-rg-r1-walkthrough-keyboard-reach.spec.ts
rm -f apps/web/e2e/zz-qa-rg-r1-*.spec.ts
{ echo "## rv2 state after seqD (expect empty)"; git status --short; echo "(end)"; } > $E/34d-rv2-after-seqD.log 2>&1
echo SEQD-DONE
