#!/usr/bin/env bash
# qa-verifier DG5 r4: the probes, each copied into the clone's e2e/ for its run only (run-probe-e2e.sh). $1 = unset|cutf8
#  demo stack: R3-DIAG and R3-REG/R3-TAB (round-3 specs, re-run UNCHANGED), R4-WORDS (observation (n)),
#              P-PB-090 / P-S21-001 / P-REFLOW (round-1 spec, re-run unchanged: the P5 screens at 390 px and 200 % text)
#  production stack: R4-CONF (the 409 conflict banner)
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
T=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
m=$1; o=0; [ "$m" = cutf8 ] && o=5
echo "== r3diag $m"; bash $S/run-probe-e2e.sh $m demo $((26630+o)) $((26631+o)) probe-r3diag $T/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts
echo "== r4words $m"; bash $S/run-probe-e2e.sh $m demo $((26630+o)) $((26631+o)) probe-r4words $T/round-4/e2e/zz-qa-dg5r4-diagnose-words.spec.ts
echo "== r4conf $m"; bash $S/run-probe-e2e.sh $m prod $((26632+o)) $((26633+o)) probe-r4conf $T/round-4/e2e/zz-qa-dg5r4-conflict-banner.spec.ts
echo "== r1demo $m"; bash $S/run-probe-e2e.sh $m demo $((26630+o)) $((26631+o)) probe-r1demo $T/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts
echo "== r3regions $m"; bash $S/run-probe-e2e.sh $m demo $((26630+o)) $((26631+o)) probe-r3regions $T/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts
echo "== r1studio $m"; bash $S/run-probe-e2e.sh $m prod $((26632+o)) $((26633+o)) probe-r1studio $T/round-1/e2e/zz-qa-dg5r1c-studio-weights.spec.ts
echo "== r4trace $m"; bash $S/run-probe-e2e.sh $m demo $((26630+o)) $((26631+o)) probe-r4trace $T/round-4/e2e/zz-qa-dg5r4-trace-and-banner.spec.ts
