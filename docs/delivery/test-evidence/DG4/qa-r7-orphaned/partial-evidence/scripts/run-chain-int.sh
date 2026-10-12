#!/usr/bin/env bash
# qa-verifier DG4 round 7: integration x2, tests/qa alone, the REQ-DLV-036 subset, then my earlier integration probes
# (rounds 2-4, unchanged, regression) -- sequentially in $TMPDIR/rv. The probes are copied into tests/qa/integration/
# only for their run and removed afterwards (git status checked).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/scripts; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests
bash $S/run-integration.sh run1 26510
bash $S/run-integration.sh run2 26530
bash $S/run-integration.sh tests-qa-candidate-only 26550 tests/qa
bash $S/run-integration.sh dlv036-a04-a09-a10-a11 26570 tests/qa/integration/a04-kpi-propagation.test.ts tests/qa/integration/a04-a05-a10-partials.test.ts tests/qa/integration/a09-decision-escalation.test.ts tests/qa/integration/a10-benefit-integrity.test.ts tests/qa/integration/a11-adoption.test.ts tests/qa/integration/a11-value-closure.test.ts tests/qa/integration/a11-bau-sustain.test.ts
P="$T/round-2/integration/dg4-qa-r1-probes.test.ts $T/round-2/integration/dg4-qa-r1-scope-totals.test.ts $T/round-2/integration/dg4-qa-r2-repairs.test.ts $T/round-3/integration/dg4-qa-r3-headlines.test.ts $T/round-4/integration/dg4-qa-r4-value-basis.test.ts"
N=""; for p in $P; do cp $p $TMPDIR/rv/tests/qa/integration/; N="$N tests/qa/integration/$(basename $p)"; echo "$(basename $p) sha256 $(sha256sum $p | cut -c1-16)"; done > /home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/03-qa-probes-files.txt
bash $S/run-integration.sh qa-probes-r2-r4 26590 $N
for p in $N; do rm -f $TMPDIR/rv/$p; done
git -C $TMPDIR/rv status --short >> /home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/03-qa-probes-files.txt; echo "git status after removal (empty = clean)" >> /home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7/03-qa-probes-files.txt
echo INT-CHAIN-DONE
