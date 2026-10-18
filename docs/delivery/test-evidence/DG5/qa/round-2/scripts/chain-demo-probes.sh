#!/usr/bin/env bash
# qa-verifier DG5 r2: demo acceptance specs and the probes, one Playwright run at a time (fresh task after the first
# chain's demo run stalled; see 05-e2e-demo-unset-attempt1-stalled.log). Labels differ so no earlier log is overwritten.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-2/scripts
T1=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts   # round-1 probe, UNCHANGED
T2=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-2/e2e/zz-qa-dg5r2-regions-keyboard.spec.ts
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in unset cutf8; do echo "== demo $m"; bash $S/run-e2e.sh $m demo 26628 26629 demo2 $DEMO; done
for m in unset cutf8; do echo "== r1-probe $m"; bash $S/run-probe-e2e.sh $m demo 26634 26635 probe-r1reflow $T1; done
for m in unset cutf8; do echo "== r2-probe $m"; bash $S/run-probe-e2e.sh $m demo 26636 26637 probe-r2regions $T2; done
