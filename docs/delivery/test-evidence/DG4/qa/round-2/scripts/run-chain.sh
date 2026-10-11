#!/usr/bin/env bash
# qa-verifier DG4 round 2: integration x2, tests/qa alone (+ my round-2 probe), the REQ-DLV-036 subset, then pnpm test x4, sequentially in $TMPDIR/rv
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-2/scripts
P=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-2/integration/dg4-qa-r2-repairs.test.ts
bash $S/run-integration.sh run1 26510
bash $S/run-integration.sh run2 26530
bash $S/run-integration.sh tests-qa-candidate-only 26550 tests/qa
bash $S/run-integration.sh dlv036-a04-a09-a10-a11 26570 tests/qa/integration/a04-kpi-propagation.test.ts tests/qa/integration/a09-decision-escalation.test.ts tests/qa/integration/a10-benefit-integrity.test.ts tests/qa/integration/a11-adoption.test.ts tests/qa/integration/a11-value-closure.test.ts tests/qa/integration/a11-bau-sustain.test.ts
bash $S/run-unit.sh
echo CHAIN-DONE
