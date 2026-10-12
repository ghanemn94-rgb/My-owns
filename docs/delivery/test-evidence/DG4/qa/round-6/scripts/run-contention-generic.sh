#!/usr/bin/env bash
# qa-verifier DG4 round 6: generic CPU-starvation control for 02c. The SAME pinned setup (CPU 0 + 3 busy loops) on a web test
# file unrelated to the session window (PINNED_FILE), on the candidate in $TMPDIR/rv, 2 runs per file.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6; R=/home/user/My-owns
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=${PINNED_FILE}
L=$E/02c2-unit-pinned-generic-control.log; : > $L
busy() { for i in 1 2 3; do taskset -c 0 bash -c 'end=$((SECONDS+'$1')); while [ $SECONDS -lt $end ]; do :; done' & done; }
one() { local lbl=$1 dir=$2
  cd $dir; busy 150; sleep 2
  { echo "\$ [$lbl] taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F  (+3 busy loops on cpu 0; file sha256 $(sha256sum $F | cut -c1-16); $(date -u +%FT%TZ))"; uptime
    taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -vE "^\s+✓ " | grep -E "✓|×|→|Test Files|Tests |Duration|AssertionError|expected" | head -30
    echo "EXIT ${PIPESTATUS[0]}"; uptime; } >> $L 2>&1
  wait; echo "$lbl: $(tail -3 $L | grep EXIT)"; }
one "candidate run 1" $TMPDIR/rv
one "candidate run 2" $TMPDIR/rv
