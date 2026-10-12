#!/usr/bin/env bash
# qa-verifier DG4 round 6: why does the candidate's Y1c (en) miss its 5 s 'created' wait under the pinned contention (02c)
# while the pre-repair control gets past it? Same pinned setup (CPU 0 + 3 busy loops), in $TMPDIR/rv-mut, Y1c tests only (-t Y1c):
#   A = the candidate file, unchanged;  B = the candidate file with the controlled clock NOT installed (installClock() call
#   removed from beforeEach; nothing else changed);  C = the pre-repair file (3e3a06e). 2 runs each, alternating.
set -u
E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6; R=/home/user/My-owns
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
F=apps/web/src/auth/session-bound.test.tsx; C=$TMPDIR/rv-mut; cd $C
cp $F $TMPDIR/sbA.tsx; git -C $R show 3e3a06e:$F > $TMPDIR/sbC.tsx
python3 - $TMPDIR/sbA.tsx $TMPDIR/sbB.tsx <<'PY'
import sys; s=open(sys.argv[1]).read(); a='  document.documentElement.dir = "ltr";\n  installClock();\n'; assert s.count(a)==1; open(sys.argv[2],'w').write(s.replace(a,'  document.documentElement.dir = "ltr";\n'))
PY
L=$E/02c3-unit-pinned-y1c-variants.log; : > $L
{ echo "variant B diff:"; diff -u $TMPDIR/sbA.tsx $TMPDIR/sbB.tsx | sed "s#$TMPDIR#\$TMPDIR#g"; } >> $L
busy() { for i in 1 2 3; do taskset -c 0 bash -c 'end=$((SECONDS+'$1')); while [ $SECONDS -lt $end ]; do :; done' & done; }
one() { local v=$1 n=$2; cp $TMPDIR/sb$v.tsx $F; busy 100; sleep 2
  { echo "\$ [variant $v run $n] taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F -t Y1c --reporter=verbose  (+3 busy loops on cpu 0; file sha256 $(sha256sum $F | cut -c1-16); $(date -u +%FT%TZ))"; uptime
    taskset -c 0 env TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $F -t Y1c --reporter=verbose 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "Y1c|→|Tests " | grep -v "↓" | head -20
    echo "EXIT ${PIPESTATUS[0]}"; uptime; } >> $L 2>&1; wait; echo "$v $n: $(tail -2 $L | grep EXIT)"; }
for n in 1 2; do one A $n; one B $n; one C $n; done
cp $TMPDIR/sbA.tsx $F; cmp $F $TMPDIR/rv/$F && echo "copy restored to the candidate file" >> $L
