#!/usr/bin/env bash
# qa-verifier DG4 round 6: the rest of the integration chain after run-chain.sh was stopped at the 2 h background limit
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6/scripts
bash $S/run-integration.sh run2 26530
bash $S/run-integration.sh tests-qa-candidate-only 26550 tests/qa
bash $S/run-integration.sh dlv036-a04-a09-a10-a11 26570 tests/qa/integration/a04-kpi-propagation.test.ts tests/qa/integration/a04-a05-a10-partials.test.ts tests/qa/integration/a09-decision-escalation.test.ts tests/qa/integration/a10-benefit-integrity.test.ts tests/qa/integration/a11-adoption.test.ts tests/qa/integration/a11-value-closure.test.ts tests/qa/integration/a11-bau-sustain.test.ts
echo CHAIN2-DONE
