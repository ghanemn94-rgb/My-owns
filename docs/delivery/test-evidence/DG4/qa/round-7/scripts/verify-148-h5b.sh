#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-148): H5 repeated when no other job of mine runs, so that ONLY the last invocation
# (unit-formula-nocodegen) fails: proves `exit $s` carries a failure of the last invocation alone. In $TMPDIR/rv-mut.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; L=$E/02h2-unit-f148-h5b.log
{ echo "=== H5b one test that fails only in the no-codegen invocation (packages/shared/src/formula/zz-qa-nocodegen.test.ts)"
  printf 'import { expect, it } from "vitest";\nit("zz-qa passes in unit-node, fails under --disallow-code-generation-from-strings", () => { expect(new Function("return 7")()).toBe(7); });\n' > packages/shared/src/formula/zz-qa-nocodegen.test.ts
  echo "\$ TZ=UTC CI=1 pnpm test"; uptime
  TZ=UTC CI=1 pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^> |^\s+(×|FAIL) |zz-qa|RUN |Test Files|Tests |EvalError" | head -60
  echo "EXIT ${PIPESTATUS[0]}"; uptime
  rm -f packages/shared/src/formula/zz-qa-nocodegen.test.ts; ls packages/shared/src/formula/zz-qa* 2>&1 | sed "s#$TMPDIR#\$TMPDIR#g"; } > $L 2>&1
grep -E "Tests |EXIT" $L
