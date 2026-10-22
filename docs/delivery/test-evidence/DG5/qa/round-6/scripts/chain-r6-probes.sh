#!/usr/bin/env bash
# qa-verifier DG5 r6: clean format:check, then probe revision 2 (title reflow) in both locale settings, then the demo
# form-export label probe on the demo stack in both locale settings.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-6/scripts; Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-6/e2e
ls $TMPDIR/review-qa/e2e/zz-* 2>/dev/null && echo "probe left in clone" || echo "clone e2e/ holds no probe"
bash $S/run-static.sh pnpm-format-check
bash $S/chain-probe-title.sh rev2
for m in unset cutf8; do echo "== r6 export label $m"; bash $S/run-probe-e2e.sh $m demo 26612 26613 probe-r6export $Q/zz-qa-dg5r6-demo-form-export-label.spec.ts; done
