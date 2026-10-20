#!/usr/bin/env bash
# qa-verifier DG5 r4: the four unit runs in sequence (Node 22 and 24, locale unset and C.UTF-8).
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
for n in node22 node24; do for m in unset cutf8; do echo "== $n $m $(date -u +%T)"; bash $S/run-unit.sh $n $m; done; done
