#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-148): (1) my Suspense probe with the candidate's warm-up and with the warm-up removed;
# (2) the harness-config guard; all in the disposable copy $TMPDIR/rv-mut. Every edit is restored and checked with cmp.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
T=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-7/unit/qa-r7-warmup-suspense.test.tsx
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; S=apps/web/test/setup.ts; cp $S $TMPDIR/setup.ts.orig; cp $T apps/web/src/app/
L=$E/02h-unit-warmup-suspense-probe.log; : > $L
run() { { echo "=== $1 (probe sha256 $(sha256sum $T | cut -c1-16); setup.ts sha256 $(sha256sum $S | cut -c1-16))"; uptime
  echo "\$ MTH_UNIT_WEB_WARMUP_REPORT=1 TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/app/qa-r7-warmup-suspense.test.tsx apps/web/src/test/harness-config.test.ts --reporter=verbose"
  MTH_UNIT_WEB_WARMUP_REPORT=1 TZ=UTC CI=1 npx vitest run --configLoader runner --project unit-web apps/web/src/app/qa-r7-warmup-suspense.test.tsx apps/web/src/test/harness-config.test.ts --reporter=verbose 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "✓|×|→|warm-up|Expected|Received|Test Files|Tests |Error" | head -40
  echo "EXIT ${PIPESTATUS[0]}"; } >> $L 2>&1; }
run "CANDIDATE setup.ts (warm-up active)"
python3 - "$S" <<'PY'
import sys,re; p=sys.argv[1]; s=open(p).read()
a="  await Promise.all(Object.values(PAGE_MODULES).map((load) => load()));\n"; assert s.count(a)==1; open(p,"w").write(s.replace(a,"  void PAGE_MODULES; // qa-r7: warm-up removed\n"))
PY
{ echo "--- setup.ts with the warm-up removed"; diff -u $TMPDIR/setup.ts.orig $S | sed "s#$TMPDIR#\$TMPDIR#g"; } >> $L
run "setup.ts WITHOUT the warm-up (control)"
cp $TMPDIR/setup.ts.orig $S; rm -f apps/web/src/app/qa-r7-warmup-suspense.test.tsx
cmp $S $TMPDIR/rv/$S && echo "setup.ts restored (identical to the candidate); probe removed from the copy" >> $L
grep -E "^===|Tests |EXIT|restored" $L
