# sourced by seqB*.sh
S=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/round-7
T=/home/user/My-owns/docs/delivery/test-evidence/DG6/qa/tests
export RV=$TMPDIR/rv2
export QA_PG_PORT=32540 E2E_PG_PORT=32540 E2E_API_PORT=32545
export MTH_SECRET_QA_A17_WEBHOOK_SIGNING_SECRET=qa-a17-synthetic-signing-secret-0001
ROOT_SPECS="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a12-p6-scope-isolation.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a13-connector-run-once.spec.ts e2e/a14-compare-reapply.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a17-failing-connector-exception.spec.ts e2e/a17-import-and-integration.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a20-p6-axe.spec.ts e2e/a20-p6-layout-brand.spec.ts e2e/a20-p6-ux.spec.ts e2e/a20-s15-014-term-scan.spec.ts e2e/a21-no-ai-operation.spec.ts e2e/a21-p6-degradation.spec.ts e2e/a22-operations-jobs.spec.ts e2e/a22-p6-operability.spec.ts"
DEMO_SPECS="e2e/a02-demo-labels.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-guided-walkthrough.spec.ts"
PW="npx playwright test --workers=1 --trace=off --reporter=list"
