#!/usr/bin/env bash
# qa-verifier r7: wait until every given log (relative to the evidence dir) ends with an EXIT line, then run the command.
# $1 = comma-separated logs to wait for; rest = command
E=/home/user/My-owns/docs/delivery/test-evidence/DG5/qa/round-7; W=$1; shift
IFS=, read -ra LOGS <<< "$W"
for l in "${LOGS[@]}"; do until grep -q '^EXIT' "$E/$l" 2>/dev/null; do sleep 20; done; done
"$@"
