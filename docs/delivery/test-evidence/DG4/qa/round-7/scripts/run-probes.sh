#!/usr/bin/env bash
# qa-verifier DG4 round 7: regression of my round-6/5/4 e2e probes (unchanged) on this candidate, in $TMPDIR/rv3, locale unset then C.UTF-8.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests
X="$T/round-6/e2e/dg4-qa-r6-session-window.spec.ts $T/round-5/e2e/dg4-qa-r5.spec.ts $T/round-5/e2e/dg4-qa-r5-bu-remedies.spec.ts $T/round-4/e2e/dg4-qa-r4-bu-limit.spec.ts"
SPECS="e2e/dg4-qa-r6-session-window.spec.ts e2e/dg4-qa-r5.spec.ts e2e/dg4-qa-r5-bu-remedies.spec.ts e2e/dg4-qa-r4-bu-limit.spec.ts"
CLONE=$TMPDIR/rv3 EXTRA="$X" bash $S/run-e2e.sh unset 26660 26665 probes $SPECS
CLONE=$TMPDIR/rv3 EXTRA="$X" bash $S/run-e2e.sh cutf8 26670 26675 probes $SPECS
echo PROBES-DONE
