#!/usr/bin/env bash
# qa-verifier DG4 round 6: e2e reruns after the full runs, sequential: C.UTF-8 solo of the 2 specs that failed in the C.UTF-8
# full run; p2-journeys alone with the locale unset; my probes with C.UTF-8 (rev-3 session probe + round-5/round-4 probes).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6/scripts; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests
export CLONE=$TMPDIR/rv3
bash $S/run-e2e.sh cutf8 26670 26675 solo-failed apps/web/e2e/p2-journeys.spec.ts apps/web/e2e/p4-dashboards.spec.ts
bash $S/run-e2e.sh unset 26680 26685 solo-p2 apps/web/e2e/p2-journeys.spec.ts
EXTRA="$T/round-6/e2e/dg4-qa-r6-session-window.spec.ts $T/round-5/e2e/dg4-qa-r5.spec.ts $T/round-5/e2e/dg4-qa-r5-bu-remedies.spec.ts $T/round-4/e2e/dg4-qa-r4-bu-limit.spec.ts" \
  bash $S/run-e2e.sh cutf8 26660 26665 probes e2e/dg4-qa-r6-session-window.spec.ts e2e/dg4-qa-r5-bu-remedies.spec.ts e2e/dg4-qa-r4-bu-limit.spec.ts e2e/dg4-qa-r5.spec.ts
echo E2E-CHAIN2-DONE
