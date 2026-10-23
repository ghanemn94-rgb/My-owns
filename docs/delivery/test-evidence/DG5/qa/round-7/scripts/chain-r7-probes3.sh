#!/usr/bin/env bash
# qa-verifier DG5 r7 (T-DG5-REV-QA-R7C): the D-181 picker probe (both locale settings) and the D-182 health probes:
# R7-HEALTH-RACE with the browser CPU slowed 1x and 4x (chromium-ar, --repeat-each=5), and R7-HEALTH-SLOWGET with the
# assessment GETs delayed 0 ms (control) and 1500 ms (chromium-en and chromium-ar, --repeat-each=3). Locale unset.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
T7=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-7/e2e
for m in unset cutf8; do bash $S/run-probe-e2e.sh $m prod 26618 26619 probe-r7picker $T7/zz-qa-dg5r7-picker-complete.spec.ts; done
for r in 1 4; do QA_CPU_RATE=$r bash $S/run-probe-e2e.sh unset prod 26620 26621 probe-r7health-rate$r $T7/zz-qa-dg5r7-health-submit-race.spec.ts --grep R7-HEALTH-RACE --repeat-each=5 --project=chromium-ar; done
for d in 0 1500; do QA_SLOW_MS=$d bash $S/run-probe-e2e.sh unset prod 26622 26623 probe-r7slowget-$d $T7/zz-qa-dg5r7-health-submit-race.spec.ts --grep R7-HEALTH-SLOWGET --repeat-each=3; done
