#!/usr/bin/env bash
# qa-verifier DG5 r3: after the integration chain, the round-2 export/provisional probe (UNCHANGED, from
# (third form: runs integration run 2 itself as run2b, since the first chain cannot finish it within its 2 h task limit)
# tests/round-2/integration) on a disposable PostgreSQL, writing the samples for REQ-DLV-037, then the inspections.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3
echo "== integration run2b (the chain-integration run2 is stopped by the 2 h task limit)"; bash $E/scripts/run-integration.sh run2b 26658
