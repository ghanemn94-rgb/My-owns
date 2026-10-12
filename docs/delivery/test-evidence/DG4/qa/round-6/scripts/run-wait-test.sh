#!/usr/bin/env bash
# qa-verifier DG4 round 6: my held-/me test (tests/round-6/unit/qa-r6-session-wait.test.tsx) on the candidate and under mutant M4, in $TMPDIR/rv-mut.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6; T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-6/unit/qa-r6-session-wait.test.tsx
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig3; cp $T apps/web/src/auth/
L=$E/02f-unit-held-me-test.log; : > $L
run() { { echo "=== $1 (test file sha256 $(sha256sum $T | cut -c1-16))"; uptime; echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/auth/qa-r6-session-wait.test.tsx"
  TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/auth/qa-r6-session-wait.test.tsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -vE "node_modules|^\s*$" | grep -E "✓|×|→|Expected|Received|^\s+[-+] |Test Files|Tests |Error" | head -60
  echo "EXIT ${PIPESTATUS[0]}"; } >> $L 2>&1; }
run "CANDIDATE (unmutated client.ts)"
python3 - "$F" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read(); a="    if (pendingCheck) await pendingCheck;\n    if (probesIdle) await probesIdle;\n"; assert s.count(a)==1; open(p,"w").write(s.replace(a,"    void probesIdle;\n"))
PY
{ echo "--- mutant M4 diff"; diff -u $TMPDIR/client.ts.orig3 $F | sed "s#$TMPDIR#\$TMPDIR#g"; } >> $L
run "MUTANT M4 (a page GET does not wait for the identity check in flight)"
cp $TMPDIR/client.ts.orig3 $F; rm -f apps/web/src/auth/qa-r6-session-wait.test.tsx
cmp $TMPDIR/client.ts.orig3 $F && echo "client.ts restored; test file removed from the copy" >> $L
grep -E "^===|Tests |EXIT" $L
