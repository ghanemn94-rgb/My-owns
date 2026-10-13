#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-148 verification, harness part), in the disposable copy $TMPDIR/rv-mut (never the candidate):
#  H1  my probe qa-r7-warmup-suspense.test.tsx + the candidate's RouteFallback/harness-config tests on the candidate harness: expected PASS
#  H2  mutant FB (router.tsx Suspense fallback -> null) with the warm-up active: expected FAIL (the fallback is still exercised)
#  H3  `pnpm test` with one deliberately failing test in unit-node only: expected EXIT 1 and unit-web + no-codegen still run
#  H4  `pnpm test` with one deliberately failing test in unit-web only: expected EXIT 1
#  H5  `pnpm test` with one test that fails ONLY under --disallow-code-generation-from-strings (the last invocation): expected EXIT 1
# Every injected file is removed and router.tsx is restored; cmp/ls logged.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
P=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/tests/round-7/unit/qa-r7-warmup-suspense.test.tsx
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; L=$E/02h-unit-f148-harness.log; : > $L
R=apps/web/src/app/router.tsx; cp $R $TMPDIR/router.orig
cp $P apps/web/src/components/qa-r7-warmup-suspense.test.tsx
vt() { echo "\$ TZ=UTC CI=1 MTH_UNIT_WEB_WARMUP_REPORT=1 npx vitest run --configLoader runner --project unit-web $*"; uptime
  TZ=UTC CI=1 MTH_UNIT_WEB_WARMUP_REPORT=1 npx vitest run --configLoader runner --project unit-web "$@" 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "✓|×|→|qa-r7\]|warm-up\]|AssertionError|Unable|Test Files|Tests " | head -60
  echo "EXIT ${PIPESTATUS[0]}"; }
pt() { echo "\$ TZ=UTC CI=1 pnpm test"; uptime
  TZ=UTC CI=1 pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^> |^\s+(×|FAIL) |zz-qa|RUN |Test Files|Tests |EvalError" | head -60
  echo "EXIT ${PIPESTATUS[0]}"; uptime; }
{ echo "=== H1 candidate harness (probe sha256 $(sha256sum $P | cut -c1-16))"
  vt apps/web/src/components/qa-r7-warmup-suspense.test.tsx apps/web/src/components/RouteFallback.test.tsx apps/web/src/test/harness-config.test.ts
  echo; echo "=== H2 mutant FB: Suspense fallback -> null (warm-up active)"
  python3 - "$R" <<'PY'
import sys; p=sys.argv[1]; s=open(p).read(); a="<Suspense fallback={<RouteLoadingFallback />}>"; assert s.count(a)==1; open(p,"w").write(s.replace(a,"<Suspense fallback={null}>"))
PY
  diff -u $TMPDIR/router.orig $R | sed "s#$TMPDIR#\$TMPDIR#g"
  vt apps/web/src/components/qa-r7-warmup-suspense.test.tsx apps/web/src/components/RouteFallback.test.tsx
  cp $TMPDIR/router.orig $R; cmp $TMPDIR/router.orig $R && echo "router.tsx restored"
  rm -f apps/web/src/components/qa-r7-warmup-suspense.test.tsx
  echo; echo "=== H3 one failing test in unit-node only (packages/config/src/zz-qa-fail.test.ts)"
  printf 'import { expect, it } from "vitest";\nit("zz-qa deliberate failure (unit-node)", () => { expect(1).toBe(2); });\n' > packages/config/src/zz-qa-fail.test.ts
  pt; rm -f packages/config/src/zz-qa-fail.test.ts
  echo; echo "=== H4 one failing test in unit-web only (apps/web/src/zz-qa-fail.test.tsx)"
  printf 'import { expect, it } from "vitest";\nit("zz-qa deliberate failure (unit-web)", () => { expect(1).toBe(2); });\n' > apps/web/src/zz-qa-fail.test.tsx
  pt; rm -f apps/web/src/zz-qa-fail.test.tsx
  echo; echo "=== H5 one test that fails only in the no-codegen invocation (packages/shared/src/formula/zz-qa-nocodegen.test.ts)"
  printf 'import { expect, it } from "vitest";\nit("zz-qa passes in unit-node, fails under --disallow-code-generation-from-strings", () => { expect(new Function("return 7")()).toBe(7); });\n' > packages/shared/src/formula/zz-qa-nocodegen.test.ts
  pt; rm -f packages/shared/src/formula/zz-qa-nocodegen.test.ts
  echo; ls packages/config/src/zz-qa* apps/web/src/zz-qa* packages/shared/src/formula/zz-qa* apps/web/src/components/qa-r7* 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"
} >> $L 2>&1
grep -E "^===|Tests |EXIT" $L
