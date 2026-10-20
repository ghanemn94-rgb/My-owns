#!/usr/bin/env bash
# T-DG5-REV-SEC-R4B (code-security-reviewer): mutation check of the F-DG5-102 guard test
# 'rule 4 reports exactly the diagnostics of a full ts.transpileModule, for every extension (F-DG5-102/145)'
# and of the planted-violation self-checks, in a DISPOSABLE clone only. Usage: rule4-guard-mutations.sh <clone>
# Each mutant edits apps/api/src/architecture.testkit.ts, runs architecture.test.ts, and restores the file byte for byte
# (cmp-checked). A mutant is KILLED when the run exits non-zero with a failing test; SURVIVED otherwise.
set -u
C="$1"
K="$C/apps/api/src/architecture.testkit.ts"
cp "$K" "$TMPDIR/testkit.orig.ts"
run() { # name, python replacement (old, new)
  local name="$1" old="$2" new="$3"
  python3 - "$K" "$old" "$new" <<'EOF'
import sys
p, old, new = sys.argv[1:4]
s = open(p).read()
assert s.count(old) == 1, f"mutation anchor not found exactly once: {old!r}"
open(p, "w").write(s.replace(old, new))
EOF
  echo "## $(date -u +%FT%TZ) mutant $name"
  echo "   - $old"
  echo "   + $new"
  (cd "$C" && npx vitest run --project unit-node apps/api/src/architecture.test.ts 2>&1 | grep -E "^ +(×|✗)|FAIL .*>|Tests |AssertionError" | head -8; echo "   vitest exit=${PIPESTATUS[0]}")
  cp "$TMPDIR/testkit.orig.ts" "$K"
  cmp "$K" "$TMPDIR/testkit.orig.ts" && echo "   restored (cmp OK)"
}
# M1: rule 4 reports nothing (diagnostics dropped).
run M1-no-report-diagnostics "reportDiagnostics: true," "reportDiagnostics: false,"
# M2: rule 4 keeps only the first diagnostic.
run M2-first-diagnostic-only ".filter((d) => d.category === ts.DiagnosticCategory.Error)" ".filter((d, i) => i === 0 && d.category === ts.DiagnosticCategory.Error)"
# M3: rule 4 parses with a fixed TS script kind instead of transpileModule (the extension-derived kind is lost).
run M3-fixed-ts-parse "    : (ts.transpileModule(source, {" "    : ((ts.createSourceFile(fileName.replace(/\\.[cm]?jsx?\$/, '.ts'), source, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics as never) ?? (ts.transpileModule(source, {"
# M4: line numbers off by one.
run M4-line-off-by-one "getLineAndCharacterOfPosition(d.start).line + 1" "getLineAndCharacterOfPosition(d.start).line + 2"
# M5: the EMPTY_EMIT transformer replaced by a transformer that THROWS (would the walk notice an emit-stage failure?).
run M5-throwing-transformer "context.factory.updateSourceFile(sourceFile, []);" "(() => { throw new Error('SEC-R4B planted emit failure'); })();"
# M6: warnings counted as errors (category filter dropped).
run M6-no-category-filter ".filter((d) => d.category === ts.DiagnosticCategory.Error)" ".filter(() => true)"
# M7: rule 4 disabled entirely (always no syntax errors): the planted P20 / syntax-error self-checks must catch it.
run M7-rule4-disabled "export function syntaxErrors(fileName: string, source: string): string[] {" "export function syntaxErrors(fileName: string, source: string): string[] {
  if (fileName) return [];"
rm -f "$TMPDIR/testkit.orig.ts"
