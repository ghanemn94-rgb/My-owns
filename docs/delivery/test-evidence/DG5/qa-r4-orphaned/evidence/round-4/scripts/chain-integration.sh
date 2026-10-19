#!/usr/bin/env bash
# qa-verifier DG5 r4: integration on a disposable PostgreSQL. $1 = run label (run1|run2), $2 = PG port.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts
echo "== $1"; bash $S/run-integration.sh $1 $2
