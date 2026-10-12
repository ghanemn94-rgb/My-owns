#!/usr/bin/env bash
# qa-verifier DG4 round 7 (F-DG4-148): does the split root `test` script still fail on a failing test, and does every
# invocation still run after an earlier failure? In the disposable copy $TMPDIR/rv-mut, one injected failing test per
# variant (removed afterwards):
#   V1 unit-node only:  apps/api/src/qa-r7-fail.test.ts
#   V2 unit-web only:   apps/web/src/qa-r7-fail.test.ts
#   V3 no-codegen only: packages/shared/src/formula/qa-r7-fail.test.ts, failing only when the fork runs with the
#                       no-codegen flag (in unit-node the same file passes).
# Expected for each: pnpm test EXIT 1, the three "RUN" banners present, and exactly one failed test.
set -u
C=$TMPDIR/rv-mut; E=/home/user/My-owns/docs/delivery/test-evidence/DG4/qa/round-7
export PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH
cd "$C"; L=$E/02i-unit-fail-propagation.log; : > $L
grep -n '"test":' package.json >> $L
body_fail='import { expect, it } from "vitest";
it("qa-r7 injected failure", () => { expect("qa-r7").toBe("deliberately failing"); });'
body_nc='import { expect, it } from "vitest";
it("qa-r7 injected failure (no-codegen only)", () => {
  const nocodegen = process.execArgv.includes("--disallow-code-generation-from-strings");
  expect(nocodegen ? "fails under no-codegen" : "ok").toBe("ok");
});'
for v in V1:apps/api/src/qa-r7-fail.test.ts V2:apps/web/src/qa-r7-fail.test.ts V3:packages/shared/src/formula/qa-r7-fail.test.ts; do
  id=${v%%:*}; f=${v#*:}
  if [ $id = V3 ]; then printf '%s\n' "$body_nc" > $f; else printf '%s\n' "$body_fail" > $f; fi
  { echo "=== $id: injected $f"; uptime; echo "\$ TZ=UTC CI=1 pnpm test"
    TZ=UTC CI=1 pnpm test 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | sed "s#$TMPDIR#\$TMPDIR#g" | grep -E "^ RUN |qa-r7|^ +(Test Files|Tests) |FAIL " | head -30
    echo "EXIT ${PIPESTATUS[0]}"; uptime; } >> $L 2>&1
  rm -f $f
  echo "$id: $(grep -A40 "^=== $id" $L | grep -c '^ RUN ') RUN banners, $(grep -A40 "^=== $id" $L | grep -m1 ^EXIT)"
done
git -C $TMPDIR/rv status --short | head -3
ls apps/api/src/qa-r7-* apps/web/src/qa-r7-* packages/shared/src/formula/qa-r7-* 2>/dev/null || echo "injected files removed" | tee -a $L
