#!/usr/bin/env bash
# qa-verifier DG5 r7 (T-DG5-REV-QA-R7C): finding verifications on the production-initialized real stack, chromium-en and
# chromium-ar, for ONE locale setting ($1 = unset|cutf8): R7-F148/R7-F149 (asserted), R7-TRACE-ROOT (the focus-state
# note), and my round-6 reproductions UNCHANGED (R6-TITLE-B -> F-DG5-148, R6-DEFINE-NARROW -> F-DG5-149; files from
# tests/round-6/e2e, not modified). Port offset per mode so two modes never share ports.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
T7=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-7/e2e
T6=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-6/e2e
m=$1; o=0; [ "$m" = cutf8 ] && o=50
echo "== r7 f148/f149 $m"; bash $S/run-probe-e2e.sh $m prod $((26610+o)) $((26611+o)) probe-r7f148f149 $T7/zz-qa-dg5r7-f148-f149-verify.spec.ts
echo "== r7 trace-root $m"; bash $S/run-probe-e2e.sh $m prod $((26612+o)) $((26613+o)) probe-r7traceroot $T7/zz-qa-dg5r7-trace-root-note.spec.ts
echo "== r6 DEFINE-NARROW (unchanged) $m"; bash $S/run-probe-e2e.sh $m prod $((26616+o)) $((26617+o)) probe-r6define $T6/zz-qa-dg5r6-define-narrow.spec.ts
echo "== r6 TITLE-B (unchanged) $m"; bash $S/run-probe-e2e.sh $m prod $((26614+o)) $((26615+o)) probe-r6titleB $T6/zz-qa-dg5r6-title-reflow-verify.spec.ts --grep R6-TITLE-B
