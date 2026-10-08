#!/usr/bin/env bash
# code-security-reviewer DG3 round-3: confirms that form R5 of guard-bypass-probe-r3b (node:vm in the allowlisted
# ../value.ts, called by the engine at evaluation time) really EXECUTES code during the engine's tests, under
# --disallow-code-generation-from-strings, while lint, the source scan and the no-codegen project all pass.
# The vm code is the constant string "6*7" (as in r3b's R5); value.ts counts the vm runs. Revision 2: revision 1 put a
# counter that named globalThis into the vm string inside evaluate.ts, which the scan rightly refused (the word
# globalThis), so it did not reproduce R5's exact engine-side snippet.
# Disposable clone ONLY ($TMPDIR/review-p2). Files are restored with git checkout at the end.
set -u
cd "$TMPDIR/review-p2" || exit 2
case "$(pwd)" in */review-p2) ;; *) exit 2 ;; esac
trap 'git checkout -q -- packages/shared/src/value.ts packages/shared/src/formula/evaluate.ts; echo "restored: git status packages/shared: \"$(git status --porcelain packages/shared)\""' EXIT
V=packages/shared/src/value.ts; F=packages/shared/src/formula/evaluate.ts
cat >> $V <<'EOF'

// --- reviewer probe R5 (disposable clone only) ---
import { runInThisContext as __rit } from "node:vm";
let __runs = 0;
export const __valueRuns = (): number => __runs;
export const __valueRun = (c: string): unknown => {
  __runs += 1;
  return __rit(c);
};
EOF
python3 - "$F" <<'EOF'
import sys
p=sys.argv[1]; s=open(p).read()
entry="export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {\n"
assert entry in s
s=s.replace('import { checkDecimal, MEASURE_COLUMN } from "../value.ts";','import { __valueRun, checkDecimal, MEASURE_COLUMN } from "../value.ts";')
s=s.replace(entry, entry+'  __probeHook();\n')
s+='\n// --- reviewer probe R5 (disposable clone only) ---\nconst __probeHook = (): void => {\n  void __valueRun("6*7");\n};\n'
open(p,'w').write(s)
EOF
git diff --stat
echo "## eslint on both files"; npx eslint $V $F; echo "eslint exit=$?"
echo "## source scan"; pnpm vitest run --project unit-node packages/shared/src/formula/fuzz.test.ts -t "engine sources contain" 2>&1 | grep -E "Tests +[0-9]"; echo "scan exit=${PIPESTATUS[0]}"
cat > packages/shared/src/formula/zz-r5-count.test.ts <<'EOF'
import { expect, it } from "vitest";
import { evaluateFormula } from "./index.ts";
import { __valueRuns } from "../value.ts";
it("R5: the vm code ran inside evaluateFormula, under the flag", () => {
  const r = evaluateFormula("a * b", [{ name: "a", kind: "number", period: "none", value: "6" }, { name: "b", kind: "number", period: "none", value: "7" }]);
  const count = __valueRuns();
  console.log(`R5-COUNT flag=${process.execArgv.includes("--disallow-code-generation-from-strings")} result=${r.result} vmRuns=${count}`);
  expect(r.result).toBe("42");
  expect(count).toBeGreaterThan(0);
});
EOF
echo "## unit-formula-nocodegen (scan test excluded, as in r3b) + a counter test"
pnpm vitest run --project unit-formula-nocodegen -t '^(?!.*engine sources contain)' 2>&1 | grep -E "R5-COUNT|Test Files|Tests +[0-9]|FAIL"; echo "nocodegen exit=${PIPESTATUS[0]}"
rm -f packages/shared/src/formula/zz-r5-count.test.ts
