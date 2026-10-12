#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-146 verification): mutants of apps/web/src/api/client.ts in the disposable copy
# $TMPDIR/rv-mut (never the candidate). Phase A: each mutant vs the candidate's new session-wait.test.tsx (+ my round-6
# held-/me test). Phase B: each mutant vs the WHOLE unit-web project. Expected: every non-equivalent mutant is killed.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
Q=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-6/unit/qa-r6-session-wait.test.tsx
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig
echo "client.ts sha256 $(sha256sum $F | cut -c1-16) (candidate: $(sha256sum $TMPDIR/rv/$F | cut -c1-16))"
PHASE=${1:-A}
L=$E/02d-unit-mutants-146-phase$PHASE.log; : > $L
apply() { # id
  cp $TMPDIR/client.ts.orig $F
  python3 - "$F" "$1" <<'PY'
import sys; p,id=sys.argv[1:]; s=open(p).read()
W="    if (pendingCheck) await pendingCheck;\n    if (probesIdle) await probesIdle;\n"
T="new Promise<void>((r) => setTimeout(r, 20))"
subs={
 "CAND": [],
 "M4":  [(W,"    void probesIdle;\n")],
 "M4a": [("    if (pendingCheck) await pendingCheck;\n","")],
 "M4b": [("    if (probesIdle) await probesIdle;\n","")],
 "M4d": [(W,f"    if (pendingCheck) await Promise.race([pendingCheck, {T}]);\n    if (probesIdle) await Promise.race([probesIdle, {T}]);\n")],
 "M4e": [("    probesIdle = new Promise<void>((resolve) => {\n      resolveProbesIdle = resolve;\n    });\n","    void 0;\n")],
}[id]
for a,b in subs:
  n=s.count(a); assert n==1, f"pattern found {n} times: {a!r}"; s=s.replace(a,b)
open(p,"w").write(s)
PY
}
desc() { case $1 in CAND) echo "unmutated candidate";; M4) echo "both waits dropped (round-6 M4)";; M4a) echo "only the wait for a pending identity check dropped";; M4b) echo "only the wait for a GET /me probe in flight dropped";; M4d) echo "bounded wait: each wait gives up after 20 ms";; M4e) echo "asIdentityProbe never publishes probesIdle (the probe bookkeeping, not apiRequest, is broken)";; esac; }
for id in ${MUTANTS:-CAND M4 M4a M4b M4d M4e}; do
  apply $id
  { echo "=== $id: $(desc $id)"; diff -u $TMPDIR/client.ts.orig $F | sed "s#$TMPDIR#\$TMPDIR#g"; uptime
    if [ $PHASE = A ]; then
      cp $Q apps/web/src/auth/
      echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/auth/session-wait.test.tsx apps/web/src/auth/qa-r6-session-wait.test.tsx"
      TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/auth/session-wait.test.tsx apps/web/src/auth/qa-r6-session-wait.test.tsx 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "✓|×|→|FAIL |AssertionError|Expected|Received|Test Files|Tests " | head -60
      echo "EXIT ${PIPESTATUS[0]}"; rm -f apps/web/src/auth/qa-r6-session-wait.test.tsx
    else
      echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web"
      TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ +(×|❯) |→|FAIL |Test Files|Tests " | head -60
      echo "EXIT ${PIPESTATUS[0]}"
    fi; uptime; } >> $L 2>&1
  cp $TMPDIR/client.ts.orig $F
  echo "$id: $(grep -A400 "^=== $id:" $L | grep -m1 -E '^ +Tests ') $(grep -A400 "^=== $id:" $L | grep -m1 ^EXIT)"
done
cmp $TMPDIR/client.ts.orig $F && cmp $F $TMPDIR/rv/$F && echo "client.ts restored (identical to the candidate)" | tee -a $L
ls apps/web/src/auth/qa-r6-* 2>/dev/null || echo "no QA test file left in the copy" | tee -a $L
