#!/usr/bin/env bash
# qa-verifier DG5 r3: the e2e sequence, one Playwright run at a time (--workers=1), both projects (chromium-en, chromium-ar),
# each in both locale settings (unset; LANG=LC_ALL=C.UTF-8).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
T1=$Q/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts        # round-1 probe, UNCHANGED
T2=$Q/round-2/e2e/zz-qa-dg5r2-regions-keyboard.spec.ts    # round-2 probe (F-DG5-142 reproduction), UNCHANGED
T3=$Q/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts      # round-3 verification probe
ROOT="e2e/a03-modular-entry.spec.ts e2e/a04-kpi-update.spec.ts e2e/a06-configuration-change.spec.ts e2e/a07-historical-integrity.spec.ts e2e/a08-a09-gates-decisions.spec.ts e2e/a13-automation-recovery.spec.ts e2e/a15-reporting.spec.ts e2e/a16-health-launch.spec.ts e2e/a20-bilingual-shell.spec.ts e2e/a22-operations-jobs.spec.ts"
DEMO="e2e/a02-guided-walkthrough.spec.ts e2e/a02-demo-users-walkthrough.spec.ts e2e/a02-demo-labels.spec.ts e2e/a21-no-ai-operation.spec.ts"
for m in unset cutf8; do echo "== r3-probe $m"; bash $S/run-probe-e2e.sh $m demo 26610 26611 probe-r3regions $T3; done
for m in unset cutf8; do echo "== r2-probe $m"; bash $S/run-probe-e2e.sh $m demo 26612 26613 probe-r2regions $T2; done
for m in unset cutf8; do echo "== r1-probe $m"; bash $S/run-probe-e2e.sh $m demo 26614 26615 probe-r1reflow $T1; done
for m in unset cutf8; do echo "== forms-repeat $m"; bash $S/run-e2e.sh $m prod 26616 26617 forms-repeat10 apps/web/e2e/p5-forms.spec.ts --repeat-each=10; done
for m in unset cutf8; do echo "== root $m"; bash $S/run-e2e.sh $m prod 26618 26619 root $ROOT; done
for m in unset cutf8; do echo "== demo $m"; bash $S/run-e2e.sh $m demo 26620 26621 demo $DEMO; done
for m in unset cutf8; do echo "== product $m"; bash $S/run-e2e.sh $m prod 26622 26623 product apps/web/e2e; done
