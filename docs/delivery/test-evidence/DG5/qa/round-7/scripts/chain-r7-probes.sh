#!/usr/bin/env bash
# qa-verifier DG5 r7: the finding verifications on the production-initialized real stack, chromium-en and chromium-ar,
# each in both locale settings: R7-F148/R7-F149 (new, asserted), my round-6 reproductions UNCHANGED (R6-TITLE-B, which
# measured F-DG5-148, and R6-DEFINE-NARROW, which measured F-DG5-149; files from tests/round-6/e2e, not modified).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
T7=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-7/e2e
T6=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-6/e2e
for m in unset cutf8; do
  echo "== r7 f148/f149 $m"; bash $S/run-probe-e2e.sh $m prod 26610 26611 probe-r7f148f149 $T7/zz-qa-dg5r7-f148-f149-verify.spec.ts
  echo "== r6 TITLE-B (unchanged) $m"; bash $S/run-probe-e2e.sh $m prod 26614 26615 probe-r6titleB $T6/zz-qa-dg5r6-title-reflow-verify.spec.ts --grep R6-TITLE-B
  echo "== r6 DEFINE-NARROW (unchanged) $m"; bash $S/run-probe-e2e.sh $m prod 26616 26617 probe-r6define $T6/zz-qa-dg5r6-define-narrow.spec.ts
done
