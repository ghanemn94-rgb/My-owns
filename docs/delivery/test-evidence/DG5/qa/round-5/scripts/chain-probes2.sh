#!/usr/bin/env bash
# qa-verifier DG5 r5: second probe chain: my round-5 probe revision 2 (F-DG5-146; prod stack), then the F-DG5-144 probes
# (chain-probes.sh f144: R3-DIAG, R3-REG on the demo stack; R4 on the prod stack), each in both locale settings.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-5/scripts
Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
for m in unset cutf8; do echo "== r5 probe rev2 $m"; bash $S/run-probe-e2e.sh $m prod 26620 26621 probe-r5forms-rev2 $Q/round-5/e2e/zz-qa-dg5r5-form-tables-verify.spec.ts; done
bash $S/chain-probes.sh f144
