#!/usr/bin/env bash
# qa-verifier DG5 r7: pnpm test on Node 22 and Node 24, each with the locale unset and with LANG=LC_ALL=C.UTF-8.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7/scripts
for n in node22 node24; do for m in unset cutf8; do echo "== $n $m"; bash $S/run-unit.sh $n $m; done; done
