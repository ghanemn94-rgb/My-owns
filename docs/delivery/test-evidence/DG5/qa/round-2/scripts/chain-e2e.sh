#!/usr/bin/env bash
# qa-verifier DG5 r2: the e2e sequence, one Playwright run at a time (--workers=1), both projects (chromium-en, chromium-ar).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-2/scripts
T1=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts   # round-1 probe, UNCHANGED
T2=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-2/e2e/zz-qa-dg5r2-regions-keyboard.spec.ts
ROOT="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a22-operations-jobs.spec.ts"
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in unset cutf8; do echo "== r1-probe $m"; bash $S/run-probe-e2e.sh $m demo 26620 26621 probe-r1reflow $T1; done
for m in unset cutf8; do echo "== r2-probe $m"; bash $S/run-probe-e2e.sh $m demo 26622 26623 probe-r2regions $T2; done
for m in unset cutf8; do echo "== root $m"; bash $S/run-e2e.sh $m prod 26616 26617 root $ROOT; done
for m in unset cutf8; do echo "== demo $m"; bash $S/run-e2e.sh $m demo 26624 26625 demo $DEMO; done
echo "== product cutf8"; bash $S/run-e2e.sh cutf8 prod 26614 26615 product apps/web/e2e
