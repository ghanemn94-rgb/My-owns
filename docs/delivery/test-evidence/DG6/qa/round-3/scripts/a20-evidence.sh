#!/bin/bash
# Re-run of the A20 axe and layout/brand specs with QA_EVIDENCE_DIR in the evidence directory (their axe summaries and
# screenshots default to test-results/, which later Playwright runs clear). In $TMPDIR/rv (idle), own ports.
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-3/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-3
export QA_PG_PORT=32560 E2E_PG_PORT=32560 E2E_API_PORT=32565
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
mkdir -p $E/25-a20-axe-layout $E/25-a20-axe-layout/shots
QA_EVIDENCE_DIR=$E/25-a20-axe-layout E2E_SCREENSHOT_DIR=$E/25-a20-axe-layout/shots $S/run.sh 25-e2e-a20-axe-layout-evidence node24 apps/web/e2e/support/with-stack.sh npx playwright test --workers=1 --trace=off --reporter=list e2e/a20-p6-axe.spec.ts e2e/a20-p6-layout-brand.spec.ts
echo A20-DONE
