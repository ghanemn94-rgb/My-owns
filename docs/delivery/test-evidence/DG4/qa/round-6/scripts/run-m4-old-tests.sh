#!/usr/bin/env bash
# qa-verifier DG4 round 6: mutant M4 against the PRE-repair versions (round-5 source 3e3a06e) of the three session test files, in $TMPDIR/rv-mut. Shows whether the M4 gap pre-dates the FE-R9B repair.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6; R=/home/user/My-owns
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig4
FILES="apps/web/src/auth/session-bound.test.tsx apps/web/src/auth/session-identity.test.tsx apps/web/src/auth/session-generation.test.tsx"
for f in $FILES; do cp $f $TMPDIR/$(basename $f).cand; git -C $R show 3e3a06e:$f > $f; done
L=$E/02g-unit-m4-pre-repair-tests.log
{ echo "=== the three session test files at 3e3a06e (pre-repair), client.ts with mutant M4"
  for f in $FILES; do echo "$f sha256 $(sha256sum $f | cut -c1-16) (git show 3e3a06e:$f)"; done
  python3 - "$F" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read(); a="    if (pendingCheck) await pendingCheck;\n    if (probesIdle) await probesIdle;\n"; assert s.count(a)==1; open(p,"w").write(s.replace(a,"    void probesIdle;\n"))
PY
  diff -u $TMPDIR/client.ts.orig4 $F | sed "s#$TMPDIR#\$TMPDIR#g"; uptime
  echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES"
  TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ +(×|❯) |→|Test Files|Tests "
  echo "EXIT ${PIPESTATUS[0]}"; uptime; } > $L 2>&1
cp $TMPDIR/client.ts.orig4 $F; for f in $FILES; do cp $TMPDIR/$(basename $f).cand $f; done
cmp $TMPDIR/client.ts.orig4 $F && echo "client.ts and the three test files restored to the candidate" >> $L
cat $L | tail -8
