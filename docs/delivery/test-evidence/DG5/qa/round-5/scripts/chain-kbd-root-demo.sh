#!/usr/bin/env bash
# qa-verifier DG5 r5: (1) the keyboard-scroll diagnostic (demo stack) in both locale settings; (2) the UNCHANGED round-3
# R3-REG/R3-TAB probe re-run alone (second run, after the first runs' keyboard-scroll misses); (3) root and demo specs.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-5/scripts
Q=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests
for m in unset cutf8; do echo "== kbd diagnostic $m"; bash $S/run-probe-e2e.sh $m demo 26644 26645 probe-r5kbd $Q/round-5/e2e/zz-qa-dg5r5-kbd-diagnostic.spec.ts; done
for m in unset cutf8; do echo "== r3regions run2 $m"; bash $S/run-probe-e2e.sh $m demo 26646 26647 probe-r3regions-run2 $Q/round-3/e2e/zz-qa-dg5r3-regions-verify.spec.ts; done
bash $S/chain-root-demo.sh
