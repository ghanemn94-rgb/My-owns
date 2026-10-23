#!/usr/bin/env bash
# qa-verifier DG5 r7: the remaining probes: R7-F148/F149 revision 2 with the locale unset (revision 1 had a probe error),
# the D-181 picker probe and the D-182 health-submit probe (CPU rate 1, 4 and 8; --repeat-each), both locale settings.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
T7=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-7/e2e
case "${1:-all}" in
f148) bash $S/run-probe-e2e.sh unset prod 26610 26611 probe-r7f148f149 $T7/zz-qa-dg5r7-f148-f149-verify.spec.ts ;;
picker) for m in unset cutf8; do bash $S/run-probe-e2e.sh $m prod 26618 26619 probe-r7picker $T7/zz-qa-dg5r7-picker-complete.spec.ts; done ;;
health) for r in 1 4 8; do QA_CPU_RATE=$r bash $S/run-probe-e2e.sh unset prod 26620 26621 probe-r7health-rate$r $T7/zz-qa-dg5r7-health-submit-race.spec.ts --repeat-each=5 --project=chromium-ar; done ;;
esac
