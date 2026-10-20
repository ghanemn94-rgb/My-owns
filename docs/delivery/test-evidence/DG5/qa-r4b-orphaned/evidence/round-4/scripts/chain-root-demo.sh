#!/usr/bin/env bash
# qa-verifier DG5 r4: the ten root acceptance specs on the production-initialized stack and the four demo specs on the
# demo stack, each in both locale settings, --workers=1 (run-e2e.sh). $1 = unset|cutf8 (default: both)
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
ROOT="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a22-operations-jobs.spec.ts"
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in ${1:-unset cutf8}; do echo "== root $m"; bash $S/run-e2e.sh $m prod 26620 26621 root $ROOT; echo "== demo $m"; bash $S/run-e2e.sh $m demo 26622 26623 demo $DEMO; done
