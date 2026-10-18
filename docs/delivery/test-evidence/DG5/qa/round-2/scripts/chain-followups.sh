#!/usr/bin/env bash
# qa-verifier DG5 r2 follow-ups: (1) the round-1 reflow probe, UNCHANGED, once more with the locale unset (its first
# unset run missed the banner on one screen per language, a non-waiting check); (2) tests/qa alone on a disposable
# PostgreSQL; (3) the export/provisional probe (samples for REQ-DLV-037).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-2/scripts
T1=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-1/e2e/zz-qa-dg5r1c-demo-probes.spec.ts
echo "== r1-probe unset run2"; bash $S/run-probe-e2e.sh unset demo 26638 26639 probe-r1reflow-run2 $T1
echo "== tests/qa alone"; bash $S/run-integration.sh testsqa 26660 tests/qa
echo "== packs probe"; bash $S/run-probe-integration.sh run1
