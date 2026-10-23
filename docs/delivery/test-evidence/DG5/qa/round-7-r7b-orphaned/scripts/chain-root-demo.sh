#!/usr/bin/env bash
# qa-verifier DG5 r7: the root acceptance specs (explicit paths) on the production-initialized stack, and the a02/a21
# specs on the demo-initialized stack, --workers=1, chromium-en and chromium-ar, each in both locale settings.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
ROOT="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a22-operations-jobs.spec.ts"
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in unset cutf8; do echo "== root $m"; bash $S/run-e2e.sh $m prod 26640 26641 root $ROOT; done
for m in unset cutf8; do echo "== demo $m"; bash $S/run-e2e.sh $m demo 26642 26643 demo $DEMO; done
