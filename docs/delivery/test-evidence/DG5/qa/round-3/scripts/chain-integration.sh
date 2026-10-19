#!/usr/bin/env bash
# qa-verifier DG5 r3: integration twice on disposable PostgreSQL clusters, then tests/qa alone (sequential).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
echo "== run1"; bash $S/run-integration.sh run1 26650
echo "== run2"; bash $S/run-integration.sh run2 26652
echo "== tests/qa alone"; bash $S/run-integration.sh testsqa 26654 tests/qa
