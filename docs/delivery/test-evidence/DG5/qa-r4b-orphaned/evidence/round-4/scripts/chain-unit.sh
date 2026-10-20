#!/usr/bin/env bash
# qa-verifier DG5 r4: pnpm test in each Node/locale combination given (default all four), then the F-DG5-145 timing lines.
set -u
S=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-4/scripts; E=$(dirname $S)
for c in ${@:-node22-unset node22-cutf8 node24-unset node24-cutf8}; do echo "== unit $c"; bash $S/run-unit.sh ${c%-*} ${c#*-}; \
  sed 's/\x1b\[[0-9;]*m//g' $E/02-unit-$c.log | grep -E "architecture.test.ts \(|every import respects|rule 4 reports exactly" ; done
