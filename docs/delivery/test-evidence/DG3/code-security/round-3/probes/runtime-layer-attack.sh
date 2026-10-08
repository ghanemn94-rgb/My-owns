#!/usr/bin/env bash
# code-security-reviewer DG3 round-3 (T-DG3-REV-SEC-R3B): attacks on the ADR-0024 §6 run-time layer
# (vitest project unit-formula-nocodegen). Disposable clone ONLY: $TMPDIR/review-p4 at ce988e20. Every probe file or
# config edit is removed/restored with `git checkout`/`rm` after its step; git status is printed at the end.
# Each step prints the command, the relevant output lines and the exit status. Expected results are stated per step.
set -u
C=$TMPDIR/review-p4
cd "$C" || exit 2
case "$C" in *review-p4*) ;; *) echo "refusing"; exit 2;; esac
FD=packages/shared/src/formula
NC="pnpm exec vitest run --project unit-formula-nocodegen"
step() { echo; echo "=== $1"; echo "# expected: $2"; }
show() { grep -E "$1" | sed 's/^/    /' | head -${2:-12}; }
clean() { git checkout -q -- . ; rm -f $FD/zz-r3-*.test.ts; }

step "R1 the flag is in EVERY fork of the project (8 extra probe files + the corpus; distinct pids)" \
     "all files pass; every probe file sees the flag and EvalError; >1 distinct pid"
for i in 1 2 3 4 5 6 7 8; do cat > $FD/zz-r3-fork$i.test.ts <<EOF
import { expect, it } from "vitest";
it("fork $i: flag present and string code generation refused", () => {
  console.log("[r1] file $i pid " + process.pid + " execArgv " + JSON.stringify(process.execArgv));
  expect(process.execArgv).toContain("--disallow-code-generation-from-strings");
  const k = ["con", "structor"].join("");
  expect(() => (Object.getPrototypeOf(() => 0) as Record<string, (s: string) => unknown>)[k]!("return 1")).toThrow(EvalError);
});
EOF
done
out=$($NC --reporter=verbose 2>&1); rc=$?
echo "$out" | show "\[r1\]" 8
echo "    distinct pids: $(echo "$out" | grep -oE '\[r1\] file [0-9]+ pid [0-9]+' | awk '{print $5}' | sort -u | wc -l)"
echo "$out" | show "Test Files|Tests  " 2
echo "# exit $rc"; clean

step "R2a a formula test file switching its environment (// @vitest-environment jsdom) stays under the flag" \
     "passes: flag present, eval and Function refused inside the jsdom environment"
cat > $FD/zz-r3-env.test.ts <<'EOF'
// @vitest-environment jsdom
import { expect, it } from "vitest";
it("jsdom environment: still no string code generation", () => {
  expect(typeof (globalThis as { document?: unknown }).document).toBe("object");
  expect(process.execArgv).toContain("--disallow-code-generation-from-strings");
  // eslint-disable-next-line no-eval
  expect(() => (0, eval)("1")).toThrow(EvalError);
  const k = ["con", "structor"].join("");
  expect(() => (Object.getPrototypeOf(() => 0) as Record<string, (s: string) => unknown>)[k]!("return 1")).toThrow(EvalError);
});
EOF
$NC $FD/zz-r3-env.test.ts 2>&1 | show "Test Files|Tests  |FAIL|Error" 6; echo "# exit ${PIPESTATUS[0]}"; clean

for P in vmForks threads vmThreads; do
step "R2b CLI pool override on the no-codegen invocation: --pool=$P" \
     "fails (non-zero exit): either the project keeps forks+flag and passes (then the override is inert: exit 0 is also safe), or the canary/pool start fails; it must never PASS with code generation enabled"
out=$($NC --pool=$P --reporter=verbose 2>&1); rc=$?
echo "$out" | show "codegen.nocodegen.test.ts|Test Files|Tests  |ERR_WORKER|Error:" 10
echo "# exit $rc"
done

step "R2c per-project pool via a second config: --config pointing at a copy with pool vmForks for the project" \
     "the canary fails (codegen re-enabled in vm contexts) => non-zero exit"
node -e 'const fs=require("fs");let s=fs.readFileSync("vitest.config.ts","utf8");const a=s.indexOf("name: NOCODEGEN_PROJECT");const b=s.indexOf("pool: \"forks\"",a);s=s.slice(0,b)+"pool: \"vmForks\""+s.slice(b+"pool: \"forks\"".length);fs.writeFileSync("vitest.r3-vmforks.config.ts",s)'
grep -n 'pool: "vmForks"' vitest.r3-vmforks.config.ts | sed 's/^/    /'
pnpm exec vitest run --config vitest.r3-vmforks.config.ts --project unit-formula-nocodegen 2>&1 | show "×|Test Files|Tests  " 8; echo "# exit ${PIPESTATUS[0]}"
rm -f vitest.r3-vmforks.config.ts; clean

step "R3 the preload enables no code generation: under the flag WITH the preload, a plain node process still refuses eval" \
     "EvalError"
node --disallow-code-generation-from-strings --import ./$FD/test-support/nocodegen-preload.mjs -e 'try { (0, eval)("1"); console.log("    eval ran: GUARD BROKEN") } catch (e) { console.log("    " + e.name + ": " + e.message) }'; echo "# exit $?"
echo "    preload source lines mentioning code generation APIs (expect only comments):"; grep -nE "eval|Function|vm|codeGeneration|allow" $FD/test-support/nocodegen-preload.mjs | sed 's/^/      /'

step "R4 pnpm test FAILS when the flag is dropped from vitest.config.ts (canary must fail; overall exit non-zero)" \
     "first invocation passes, second invocation: canary 'flag present' and EvalError tests fail; pnpm test exit 1"
sed -i 's/execArgv: nocodegenRun ? \[NOCODEGEN_FLAG, "--import", NOCODEGEN_PRELOAD\] : \[\]/execArgv: []/' vitest.config.ts
git diff --stat | sed 's/^/    /'
out=$(pnpm test 2>&1); rc=$?
echo "$out" | show "Test Files|Tests  |× .*canary|FAIL .*nocodegen|ELIFECYCLE" 14
echo "# pnpm test exit $rc"; clean

step "R5a pnpm test with a non-matching file filter (appended to the SECOND invocation only)" \
     "second invocation: 'No test files found' => non-zero exit (the layer cannot be filtered away silently)"
out=$(pnpm test zz-no-such-file 2>&1); rc=$?
echo "$out" | show "Test Files|Tests  |No test files|ELIFECYCLE|filter" 8
echo "# pnpm test exit $rc"

step "R5b pnpm test -t <name matching nothing> (appended to the SECOND invocation only)" \
     "observation: the first invocation runs unfiltered; the second skips every test. Exit status recorded as is."
out=$(pnpm test -t zz-no-such-test-name 2>&1); rc=$?
echo "$out" | show "Test Files|Tests  |ELIFECYCLE|skipped" 8
echo "# pnpm test exit $rc"

step "R6 vitest run --project 'unit-formula-*' (wildcard: the config's own project detection does not see the name)" \
     "the project runs WITHOUT the flag and the canary fails => non-zero exit (fail-safe)"
pnpm exec vitest run --project 'unit-formula-*' 2>&1 | show "× |Test Files|Tests  " 8; echo "# exit ${PIPESTATUS[0]}"

step "R7 combining the project with another one is refused by the config" \
     "error thrown by vitest.config.ts, non-zero exit"
pnpm exec vitest run --project unit-formula-nocodegen --project unit-node 2>&1 | show "Run --project|Error" 4; echo "# exit ${PIPESTATUS[0]}"

step "R8 the first pnpm test invocation does NOT inherit the flag (unit-node/unit-web forks)" \
     "a unit-node probe sees execArgv without the flag and eval works there"
cat > packages/shared/src/zz-r3-noflag.test.ts <<'EOF'
import { expect, it } from "vitest";
it("unit-node forks have no flag", () => {
  console.log("[r8] execArgv " + JSON.stringify(process.execArgv));
  expect(process.execArgv).not.toContain("--disallow-code-generation-from-strings");
});
EOF
pnpm exec vitest run --project unit-node --project unit-web packages/shared/src/zz-r3-noflag.test.ts 2>&1 | show "\[r8\]|Test Files|Tests  " 4; echo "# exit ${PIPESTATUS[0]}"
rm -f packages/shared/src/zz-r3-noflag.test.ts; clean

echo; echo "# git status --porcelain (expect empty): '$(git status --porcelain)'"
