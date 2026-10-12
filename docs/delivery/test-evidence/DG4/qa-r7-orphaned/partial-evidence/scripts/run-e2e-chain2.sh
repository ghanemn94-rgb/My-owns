#!/usr/bin/env bash
# qa-verifier DG4 round 7: after the locale-unset full run: the C.UTF-8 full run (copy $TMPDIR/rv4), then my earlier
# e2e probes (rounds 4-6, unchanged; regression incl. AUD read-only, 390 px, 200 % text, axe on the P4 screens) in both
# locale settings (copy $TMPDIR/rv2). Sequential, --workers=1.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests
O=/var/tmp/mth-run.nf3lX9/claude-0/-home-user-My-owns/c1a3a7a5-65ab-4173-b805-cc97c6497f24/tasks/bad32kbv2.output
until grep -q E2E-FULL-UNSET-DONE $O; do sleep 20; done
CLONE=$TMPDIR/rv4 bash $S/run-e2e.sh cutf8 26660 26665 full $(cat $TMPDIR/specs.txt)
PR="$T/round-6/e2e/dg4-qa-r6-session-window.spec.ts $T/round-5/e2e/dg4-qa-r5.spec.ts $T/round-5/e2e/dg4-qa-r5-bu-remedies.spec.ts $T/round-4/e2e/dg4-qa-r4-bu-limit.spec.ts"
for M in unset cutf8; do
  EXTRA="$PR" CLONE=$TMPDIR/rv2 bash $S/run-e2e.sh $M 26680 26685 probes e2e/dg4-qa-r6-session-window.spec.ts e2e/dg4-qa-r5-bu-remedies.spec.ts e2e/dg4-qa-r4-bu-limit.spec.ts e2e/dg4-qa-r5.spec.ts
done
echo E2E-CHAIN2-DONE
