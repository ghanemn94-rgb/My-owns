#!/usr/bin/env bash
# qa-verifier DG5 r3, second e2e chain: the round-3 probe (revision 3) in both locale settings, FE-X1's
# p5-table-regions-axe.spec.ts on the DEMO stack (its demo branch; the product run covers the production branch).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
T3=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts
for m in unset cutf8; do echo "== r3-probe-v3 $m"; bash $S/run-probe-e2e.sh $m demo 26630 26631 probe-r3regions-v3 $T3; done
for m in unset cutf8; do echo "== x1-spec-on-demo $m"; bash $S/run-e2e.sh $m demo 26632 26633 x1demo apps/web/e2e/p5-table-regions-axe.spec.ts; done
# the round-1 probe, UNCHANGED, once more in each locale setting (its non-waiting banner check missed the banner on one
# screen per run in chain 1; see the record)
T1=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts
for m in unset cutf8; do echo "== r1-probe run2 $m"; bash $S/run-probe-e2e.sh $m demo 26638 26639 probe-r1reflow-run2 $T1; done
