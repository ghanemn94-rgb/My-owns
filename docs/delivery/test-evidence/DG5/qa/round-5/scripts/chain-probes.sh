#!/usr/bin/env bash
# qa-verifier DG5 r5: the finding-verification probes on the real stacks, one Playwright run at a time (--workers=1),
# chromium-en and chromium-ar, each in both locale settings (unset; LANG=LC_ALL=C.UTF-8).
#  F-DG5-146: my round-5 probe (prod stack) and the product regression spec apps/web/e2e/p5-form-tables-reflow.spec.ts.
#  F-DG5-144: my round-3 reproduction R3-DIAG and verification probe R3-REG (demo stack), UNCHANGED, and my round-4
#             real-stack probe R4 (prod stack: R4-DIAG-PROD, R4-CONF-FORM, R4-CONF-DIALOG), UNCHANGED.
# $1 = optional subset: f146 | f144 (default both)
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-5/scripts
Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
W=${1:-all}
if [ "$W" != f144 ]; then
for m in unset cutf8; do echo "== r5 probe $m"; bash $S/run-probe-e2e.sh $m prod 26610 26611 probe-r5forms $Q/round-5/e2e/zz-qa-dg5r5-form-tables-verify.spec.ts; done
for m in unset cutf8; do echo "== product z1 spec $m"; bash $S/run-e2e.sh $m prod 26612 26613 z1spec apps/web/e2e/p5-form-tables-reflow.spec.ts; done
fi
if [ "$W" != f146 ]; then
for m in unset cutf8; do echo "== r3diag $m"; bash $S/run-probe-e2e.sh $m demo 26614 26615 probe-r3diag $Q/round-3/e2e/zz-qa-dg5r3-diagnose-reflow.spec.ts; done
for m in unset cutf8; do echo "== r3regions $m"; bash $S/run-probe-e2e.sh $m demo 26616 26617 probe-r3regions $Q/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts; done
for m in unset cutf8; do echo "== r4 reflow $m"; bash $S/run-probe-e2e.sh $m prod 26618 26619 probe-r4reflow $Q/round-4/e2e/zz-qa-dg5r4-reflow-verify.spec.ts; done
fi
