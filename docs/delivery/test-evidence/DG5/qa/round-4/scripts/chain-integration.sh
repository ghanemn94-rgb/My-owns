#!/usr/bin/env bash
# qa-verifier DG5 r4: one integration run. $1 = label, $2 = PG port, rest = extra vitest args.
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
echo "== integration $1 $(date -u +%T)"; QA_RUN_TESTSQA=1 bash $S/run-integration.sh "$@"
