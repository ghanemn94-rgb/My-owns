#!/usr/bin/env bash
# qa-verifier DG4 round 6: the surviving mutant M4 (and a stronger M6b) against the WHOLE unit-web project, in $TMPDIR/rv-mut.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-6
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; F=apps/web/src/api/client.ts; cp $F $TMPDIR/client.ts.orig2
L=$E/02e-unit-web-mutants-full.log; : > $L
mut() { local id=$1 desc=$2; shift 2
  cp $TMPDIR/client.ts.orig2 $F
  while [ $# -gt 0 ]; do python3 - "$F" "$1" "$2" <<'PY'
import sys; p,a,b=sys.argv[1:]; s=open(p).read(); n=s.count(a); assert n==1, f"pattern found {n} times: {a!r}"; open(p,"w").write(s.replace(a,b))
PY
  shift 2; done
  { echo "=== MUTANT $id: $desc"; diff -u $TMPDIR/client.ts.orig2 $F | sed "s#$TMPDIR#\$TMPDIR#g"; uptime
    echo "\$ TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web"
    TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ +(×|❯) |→|Test Files|Tests " | head -80
    echo "EXIT ${PIPESTATUS[0]}"; uptime; } >> $L 2>&1
  cp $TMPDIR/client.ts.orig2 $F
}
mut M4 "a page GET does not wait for the identity check in flight (sent before /me answers)" \
  "    if (pendingCheck) await pendingCheck;
    if (probesIdle) await probesIdle;" "    void probesIdle;"
mut M6b "one /me per page GET after the window: no join of the check in flight, and no /me restarts the window" \
  "  if (pendingCheck) return pendingCheck;
  lastMeAt = Date.now(); // bounded even when the check fails (offline): no /me per request" "  void 0;" \
  "  if (options.sessionProbe) {
    lastMeAt = Date.now();
  } else" "  if (options.sessionProbe) {
    void 0;
  } else" \
  "  if (options.sessionProbe) lastMeAt = Date.now();" "  void 0;"
cmp $TMPDIR/client.ts.orig2 $F && echo "client.ts restored (identical to the candidate)" | tee -a $L
