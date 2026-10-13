#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-146 verification): my round-6 mutant M4 and its split M4a/M4b against the candidate's
# session tests (incl. the new session-wait.test.tsx) and my round-6 held-/me test, in the disposable copy $TMPDIR/rv-mut.
# Expected: baseline passes; each mutant makes >= 1 test fail (killed). client.ts restored and cmp-checked afterwards.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-6/unit/qa-r6-session-wait.test.tsx
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig; cp $T apps/web/src/auth/qa-r6-session-wait.test.tsx
L=$E/02d-unit-f146-mutants.log; : > $L
FILES="apps/web/src/auth/session-wait.test.tsx apps/web/src/auth/session-bound.test.tsx apps/web/src/auth/session-identity.test.tsx apps/web/src/auth/session-generation.test.tsx"
runset() { local files=$1
  echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $files"; uptime
  TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $files 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ +(×|❯) |FAIL |AssertionError|Test Files|Tests " | head -60
  echo "EXIT ${PIPESTATUS[0]}"; }
mut() { local id=$1 desc=$2 from=$3 to=$4
  cp $TMPDIR/client.ts.orig $F
  if [ -n "$from" ]; then python3 - "$F" "$from" "$to" <<'PY'
import sys; p,a,b=sys.argv[1:]; s=open(p).read(); n=s.count(a); assert n==1, f"pattern found {n} times: {a!r}"; open(p,"w").write(s.replace(a,b))
PY
  fi
  { echo; echo "=== $id: $desc"; diff -u $TMPDIR/client.ts.orig $F | sed "s#$TMPDIR#\$TMPDIR#g"
    echo "--- (a) candidate session tests"; runset "$FILES"
    echo "--- (b) candidate session-wait.test.tsx alone"; runset apps/web/src/auth/session-wait.test.tsx
    echo "--- (c) my round-6 held-/me test (qa-r6-session-wait.test.tsx, sha256 $(sha256sum $T | cut -c1-16))"; runset apps/web/src/auth/qa-r6-session-wait.test.tsx
  } >> $L 2>&1
  cp $TMPDIR/client.ts.orig $F
}
mut BASELINE "unmutated candidate client.ts" "" ""
mut M4 "a page GET waits for neither the identity check nor the /me probe in flight" \
  "    if (pendingCheck) await pendingCheck;
    if (probesIdle) await probesIdle;" "    void probesIdle;"
mut M4a "a page GET does not wait for the pending identity check (still waits for a /me probe)" \
  "    if (pendingCheck) await pendingCheck;
" ""
mut M4b "a page GET does not wait for a /me probe in flight (still waits for the identity check)" \
  "    if (probesIdle) await probesIdle;
" ""
rm -f apps/web/src/auth/qa-r6-session-wait.test.tsx
cmp $TMPDIR/client.ts.orig $F && echo "client.ts restored (identical to the candidate); my test file removed from the copy" >> $L
grep -E "^===|^---|Tests |EXIT" $L
