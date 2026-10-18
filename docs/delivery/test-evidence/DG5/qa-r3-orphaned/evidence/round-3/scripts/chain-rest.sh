#!/usr/bin/env bash
# qa-verifier DG5 r3: after chain A. (1) the round-3 regions probe, run 2: the probe fixed after run 1 (run 1's Tab walk
# through the links inside a region had scrolled it to its end before the arrow key, and its walk stopped early on
# repeated identical focus keys; see the spec's "Run-1 fix" comments).
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-3/scripts
T3=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/tests/round-3/e2e/zz-qa-dg5r3-regions-all.spec.ts
for m in unset cutf8; do echo "== r3-probe run2 $m"; bash $S/run-probe-e2e.sh $m demo 26626 26627 probe-r3regions-run2 $T3; done
# chain B (product, one locale setting per background task) is started separately: the 2 h task limit
