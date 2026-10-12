#!/usr/bin/env bash
# qa-verifier DG4 round 6 (F-DG4-145): do the identity guarantees that session-bound/identity/generation tests protect
# still FAIL when the product is broken? Each mutant edits apps/web/src/api/client.ts in the disposable copy $TMPDIR/rv-mut
# (never the candidate), runs the three files, and restores the file. Expected: every mutant makes >= 1 test fail.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig
L=$E/02d-unit-session-mutants.log; : > $L
FILES="apps/web/src/auth/session-bound.test.tsx apps/web/src/auth/session-identity.test.tsx apps/web/src/auth/session-generation.test.tsx"
mut() { local id=$1 desc=$2 from=$3 to=$4
  cp $TMPDIR/client.ts.orig $F
  python3 - "$F" "$from" "$to" <<'PY'
import sys; p,a,b=sys.argv[1:]; s=open(p).read(); n=s.count(a); assert n==1, f"pattern found {n} times: {a!r}"; open(p,"w").write(s.replace(a,b))
PY
  { echo "=== MUTANT $id: $desc"; echo "--- diff"; diff -u $TMPDIR/client.ts.orig $F | sed "s#$TMPDIR#\$TMPDIR#g"; uptime
    echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES"
    TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ +(×|✓|❯)|FAIL |AssertionError|Expected|Received|expected|Test Files|Tests " | head -80
    echo "EXIT ${PIPESTATUS[0]}"; } >> $L 2>&1
  cp $TMPDIR/client.ts.orig $F
  echo "$id: $(grep -A200 "MUTANT $id" $L | grep -m1 -E '^ +Tests ') $(grep -A300 "MUTANT $id" $L | grep -m1 ^EXIT)"
}
{ echo "=== BASELINE (unmutated)"; echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES"; uptime
  TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web $FILES 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -E "Test Files|Tests |×"; echo "EXIT ${PIPESTATUS[0]}"; } >> $L 2>&1
mut M1 "the 2 s window is ignored: every page GET revalidates /me (recheckDue always true when active)" \
  "Date.now() - lastMeAt >= SESSION_RECHECK_MS;" "true;"
mut M2 "the window is never crossed: no revalidation of /me after SESSION_RECHECK_MS (recheckDue always false)" \
  "return sessionPhase === \"active\" && checkRunners.size > 0 && Date.now() - lastMeAt >= SESSION_RECHECK_MS;" "return false;"
mut M3 "no navigation identity confirmation (F-DG2-570 rule 1): revalidateSessionIdentity is a no-op" \
  "  if (sessionPhase !== \"active\" || checkRunners.size === 0) return Promise.resolve();
  return startSessionCheck();" "  return Promise.resolve();"
mut M4 "a page GET does not wait for the identity check in flight (sent before /me answers)" \
  "    if (pendingCheck) await pendingCheck;
    if (probesIdle) await probesIdle;" "    void probesIdle;"
mut M5 "no generation check (F-DG2-530): an answer to A's request is returned after the identity changed" \
  "const changed = () => sessionGeneration !== sentGeneration;" "const changed = () => false;"
mut M6 "the revalidation is not shared: one /me per GET after the window (no join, window not restarted by the check)" \
  "  if (pendingCheck) return pendingCheck;
  lastMeAt = Date.now(); // bounded even when the check fails (offline): no /me per request" "  void 0;"
cmp $TMPDIR/client.ts.orig $F && echo "client.ts restored (identical to the candidate)" | tee -a $L
