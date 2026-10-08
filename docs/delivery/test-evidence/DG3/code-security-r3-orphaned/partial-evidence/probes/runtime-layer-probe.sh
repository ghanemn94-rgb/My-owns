#!/usr/bin/env bash
# code-security-reviewer DG3 round-3: attacks on the ADR-0024 §6 run-time layer (project unit-formula-nocodegen).
# Disposable clone ONLY ($TMPDIR/probe at 0e820ae). Every edit is reverted with `git checkout -- . && git clean -fdq`
# after each case. Usage: bash runtime-layer-probe.sh   (Node from PATH)
set -u
cd "$TMPDIR/probe" || exit 2
case "$(pwd)" in */probe) ;; *) echo "refusing: not the disposable clone"; exit 2 ;; esac
F=packages/shared/src/formula
reset() { git checkout -q -- . && git clean -fdq "$F" vitest.config.ts package.json; }
step() { echo; echo "=================== $*"; }
tail_tests() { grep -E "Test Files|Tests +[0-9]|No test files|Error:|×|FAIL|EXECARGV|ERR_|EvalError" | head -${1:-20}; }
trap reset EXIT
reset

step "A. every fork of the project carries the flag; the first invocation (unit-node) never does"
for n in 1 2 3; do cat > $F/zz-sec-r3-fork$n.test.ts <<EOF
import { expect, it } from "vitest";
it("fork $n: execArgv and code generation", () => {
  const flag = process.execArgv.includes("--disallow-code-generation-from-strings");
  let threw = "none";
  try { new Function("return 1")(); } catch (e) { threw = (e as Error).name; }
  console.log("EXECARGV file=$n pid=" + process.pid + " flag=" + flag + " newFunction=" + threw + " project=" + (globalThis as { __vitest_worker__?: { ctx?: { projectName?: string } } }).__vitest_worker__?.ctx?.projectName);
  if (flag) expect(threw).toBe("EvalError"); else expect(threw).toBe("none");
});
EOF
done
pnpm vitest run --project unit-formula-nocodegen 2>&1 | tail_tests 30; echo "exit(nocodegen)=${PIPESTATUS[0]}"
pnpm vitest run --project unit-node $F 2>&1 | tail_tests 30; echo "exit(unit-node formula)=${PIPESTATUS[0]}"
reset

step "B. a per-file environment docblock (@vitest-environment jsdom) does not escape the flag"
cat > $F/zz-sec-r3-jsdom.test.ts <<'EOF'
// @vitest-environment jsdom
import { expect, it } from "vitest";
import { evaluateFormula } from "./index.ts";
it("jsdom env: still EvalError for eval, Function and a prototype-reached constructor", () => {
  console.log("EXECARGV jsdom typeof window=" + typeof window + " flag=" + process.execArgv.includes("--disallow-code-generation-from-strings"));
  expect(() => (0, eval)("1")).toThrow(EvalError);
  expect(() => new Function("return 1")).toThrow(EvalError);
  const k = ["con", "struc", "tor"].join("");
  expect(() => ((() => 0) as unknown as Record<string, (s: string) => unknown>)[k]!("return 1")).toThrow(EvalError);
  expect(() => (window as unknown as { eval(s: string): unknown }).eval("1")).toThrow(EvalError);
  expect(evaluateFormula("a * b", [{ name: "a", kind: "number", period: "none", value: "6" }, { name: "b", kind: "number", period: "none", value: "7" }]).result).toBe("42");
});
EOF
pnpm vitest run --project unit-formula-nocodegen 2>&1 | tail_tests; echo "exit=${PIPESTATUS[0]}"
reset

step "C. the canary failing makes 'pnpm test' fail (flag dropped from the root execArgv)"
sed -i 's/execArgv: nocodegenRun ? \[NOCODEGEN_FLAG, "--import", NOCODEGEN_PRELOAD\] : \[\]/execArgv: []/' vitest.config.ts
git diff --stat vitest.config.ts
pnpm test 2>&1 | tail_tests; echo "exit(pnpm test)=${PIPESTATUS[0]}"
reset

step "D. preload removed (flag kept): forks die, 'pnpm vitest run --project unit-formula-nocodegen' fails loudly"
sed -i 's/\[NOCODEGEN_FLAG, "--import", NOCODEGEN_PRELOAD\]/[NOCODEGEN_FLAG]/' vitest.config.ts
git diff --stat vitest.config.ts
timeout 300 pnpm vitest run --project unit-formula-nocodegen 2>&1 | tail_tests; echo "exit=${PIPESTATUS[0]}"
reset

step "E. pool switched to threads / vmForks in the project: the canary fails loudly"
for pool in threads vmForks; do
  sed -i "s/          pool: \"forks\",/          pool: \"$pool\",/" vitest.config.ts
  echo "-- pool=$pool"; git diff vitest.config.ts | grep '^[-+] '
  timeout 300 pnpm vitest run --project unit-formula-nocodegen 2>&1 | tail_tests 12; echo "exit=${PIPESTATUS[0]}"
  reset
done

step "F. all projects in one invocation / a wildcard project filter: the canary runs without the flag and fails"
timeout 300 pnpm vitest run --project 'unit-*' $F 2>&1 | tail_tests 12; echo "exit(--project unit-*)=${PIPESTATUS[0]}"
timeout 300 pnpm vitest run $F 2>&1 | tail_tests 12; echo "exit(no --project)=${PIPESTATUS[0]}"

step "G. combining the no-codegen project with another project is refused by the config"
timeout 300 pnpm vitest run --project unit-node --project unit-formula-nocodegen 2>&1 | grep -E "Error|own vitest" | head -3; echo "exit=${PIPESTATUS[0]}"

step "H. an empty selection cannot pass silently (no passWithNoTests)"
grep -n passWithNoTests vitest.config.ts apps/web/vitest.config.ts package.json || echo "passWithNoTests: not set anywhere"
timeout 300 pnpm vitest run --project unit-formula-nocodegen zz-no-such-file 2>&1 | tail_tests 5; echo "exit(filter matching nothing)=${PIPESTATUS[0]}"
sed -i 's|include: \["packages/shared/src/formula/\*\*/\*.test.ts"\],|include: ["packages/shared/src/formula/**/*.nomatch.ts"],|' vitest.config.ts
git diff vitest.config.ts | grep '^[-+] '
timeout 300 pnpm vitest run --project unit-formula-nocodegen 2>&1 | tail_tests 5; echo "exit(empty include)=${PIPESTATUS[0]}"
reset

step "I. 'pnpm test <filter>': extra args reach only the second invocation (informational)"
timeout 600 pnpm test fuzz 2>&1 | grep -E "Test Files|Tests +[0-9]|unit-formula-nocodegen|^> " | head -8; echo "exit(pnpm test fuzz)=${PIPESTATUS[0]}"

step "J. canary assertion broken: pnpm test exits non-zero"
sed -i 's/expect(process.execArgv).toContain("--disallow-code-generation-from-strings");/expect(process.execArgv).toContain("--no-such-flag");/' $F/codegen.nocodegen.test.ts
git diff --stat
pnpm test 2>&1 | tail_tests 8; echo "exit(pnpm test)=${PIPESTATUS[0]}"
reset
git status --porcelain
echo "DONE"
