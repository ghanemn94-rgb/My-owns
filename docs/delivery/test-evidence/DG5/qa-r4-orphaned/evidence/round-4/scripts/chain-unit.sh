#!/usr/bin/env bash
# qa-verifier DG5 r4: pnpm test on Node 22 and Node 24, locale unset and C.UTF-8 (sequential).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
for n in node22 node24; do for m in unset cutf8; do echo "== $n $m"; bash $S/run-unit.sh $n $m; done; done
