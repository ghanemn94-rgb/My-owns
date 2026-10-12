#!/usr/bin/env bash
# qa-verifier DG4 round 6 (F-DG4-145): the round-5 reproduction, repeated. session-bound.test.tsx alone, pinned to CPU 0
# with 3 busy loops on the same CPU. Candidate tests (in $TMPDIR/rv) x3, then control = the pre-repair file from 3e3a06e
# (in $TMPDIR/rv-mut, file swapped, restored afterwards) x2. Product code is identical in both.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6; R=/home/user/My-owns
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=apps/web/src/auth/session-bound.test.tsx
L=$E/02c-unit-session-bound-contention.log; : > $L
busy() { for i in 1 2 3; do taskset -c 0 bash -c 'end=$((SECONDS+'$1')); while [ $SECONDS -lt $end ]; do :; done' & done; }
one() { local lbl=$1 dir=$2
  cd $dir; busy 150; sleep 2
  { echo "\$ [$lbl] taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F  (+3 busy loops on cpu 0; file sha256 $(sha256sum $F | cut -c1-16); $(date -u +%FT%TZ))"; uptime
    taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -vE "^\s+✓ " | grep -E "✓|×|→|Test Files|Tests |Duration|AssertionError|expected" | head -30
    echo "EXIT ${PIPESTATUS[0]}"; uptime; } >> $L 2>&1
  wait; echo "$lbl: $(tail -3 $L | grep EXIT)"; }
one "candidate run 1" $TMPDIR/rv
one "candidate run 2" $TMPDIR/rv
one "candidate run 3" $TMPDIR/rv
cp $TMPDIR/rv-mut/$F $TMPDIR/sb.cand; git -C $R show 3e3a06e:$F > $TMPDIR/rv-mut/$F
one "control 3e3a06e run 1" $TMPDIR/rv-mut
one "control 3e3a06e run 2" $TMPDIR/rv-mut
cp $TMPDIR/sb.cand $TMPDIR/rv-mut/$F; cmp $TMPDIR/rv/$F $TMPDIR/rv-mut/$F && echo "control copy restored to the candidate file" >> $L
