#!/usr/bin/env bash
# qa-verifier DG5 r3: integration run 2 (fresh task: the first chain's run 2 was stopped at the 2 h background-task limit;
# its partial log is kept as 04-integration-run2-stopped.log).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
echo "== run2"; bash $S/run-integration.sh run2 26672
