#!/usr/bin/env bash
# qa-verifier DG5 r3, third e2e chain: the root and demo acceptance specs, after chain 1 was stopped by its 2 h task limit
# (labels root2/demo2 so chain 1's partial logs are kept as they are).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
ROOT="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a22-operations-jobs.spec.ts"
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in unset cutf8; do echo "== root2 $m"; bash $S/run-e2e.sh $m prod 26640 26641 root2 $ROOT; done
for m in unset cutf8; do echo "== demo2 $m"; bash $S/run-e2e.sh $m demo 26642 26643 demo2 $DEMO; done
