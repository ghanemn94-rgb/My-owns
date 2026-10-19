#!/usr/bin/env bash
# qa-verifier DG5 r4: F-DG5-144 verification. The round-3 R3-DIAG reproduction and the round-3 R3-REG/R3-TAB probe,
# UNCHANGED (tests/round-3), on the DEMO stack; the round-4 probes (conflict banner on the production stack, statement-cell
# words on the demo stack); FE-Y1's p5-diagnose-reflow.spec.ts on the DEMO stack (the product run covers production).
# Each in both locale settings (unset; LANG=LC_ALL=C.UTF-8), chromium-en and chromium-ar, --workers=1.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
for m in unset cutf8; do
  echo "== r3-diag $m"; bash $S/run-probe-e2e.sh $m demo 26610 26611 probe-r3diag $Q/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts
  echo "== r4-conflict $m"; bash $S/run-probe-e2e.sh $m prod 26612 26613 probe-r4conflict $Q/round-4/e2e/zz-qa-dg5r4-conflict-reflow.spec.ts
  echo "== r4-words $m"; bash $S/run-probe-e2e.sh $m demo 26614 26615 probe-r4words $Q/round-4/e2e/zz-qa-dg5r4-diagnose-words.spec.ts
  echo "== y1-spec-on-demo $m"; bash $S/run-e2e.sh $m demo 26616 26617 y1demo apps/web/e2e/p5-diagnose-reflow.spec.ts
done
for m in unset cutf8; do echo "== r3-reg $m"; bash $S/run-probe-e2e.sh $m demo 26618 26619 probe-r3regions $Q/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts; done
# the round-1 probe UNCHANGED (31 P5 screens on demo data: page overflow at 390 px and 200 % text, axe, the demo
# banner, the B0147 chains, the S21-001 label), after BE-Y1's demo-data change
for m in unset cutf8; do echo "== r1-probe $m"; bash $S/run-probe-e2e.sh $m demo 26620 26621 probe-r1reflow $Q/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts; done
