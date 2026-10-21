#!/usr/bin/env bash
# qa-verifier r5: the A06/A07/A15/A16 executable suites (tests/qa/integration) per integration log: file result line.
for L in "$@"; do echo "== $(basename $L)"; sed 's/\x1b\[[0-9;]*m//g' $L | grep -E "^ (✓|❯|×) \|integration\| tests/qa/integration/(a06|a07|a15|a16)-" | sed 's/ [0-9]*ms$//'; done
