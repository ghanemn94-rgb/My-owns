#!/usr/bin/env bash
# qa-verifier DG5 r7 (T-DG5-REV-QA-R7C): the picker probe, revision 2 (bounded getAttribute; see the spec), both locale
# settings, label probe-r7picker2 (revision 1's logs stay as probe-r7picker-*).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
T7=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-7/e2e
for m in unset cutf8; do bash $S/run-probe-e2e.sh $m prod 26670 26671 probe-r7picker2 $T7/zz-qa-dg5r7-picker-complete.spec.ts; done
