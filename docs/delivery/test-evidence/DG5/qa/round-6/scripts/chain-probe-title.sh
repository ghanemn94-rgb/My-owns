#!/usr/bin/env bash
# qa-verifier DG5 r6: the F-DG5-147 verification probe (R6-TITLE-A, R6-TITLE-B) on the production-initialized stack,
# chromium-en and chromium-ar, --workers=1, locale unset and C.UTF-8. $1 = optional run suffix.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-6/scripts
for m in unset cutf8; do echo "== r6 title probe $m"; bash $S/run-probe-e2e.sh $m prod 26610 26611 probe-r6title${1:+-$1} /home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-6/e2e/zz-qa-dg5r6-title-reflow-verify.spec.ts; done
