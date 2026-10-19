#!/usr/bin/env bash
# SEC-R4 (code-security-reviewer, round 4, F-DG5-102): own mutation check of the rule-4 guard test. Each mutant is a
# plausible regression of syntaxErrors() in apps/api/src/architecture.testkit.ts, applied in the DISPOSABLE clone,
# run against architecture.test.ts, then restored with `git checkout`. Expected: every mutant makes the guard test
# 'rule 4 reports exactly the diagnostics of a full ts.transpileModule' (and/or a planted-syntax-error control) fail.
# Usage: rule4-mutants.sh <clone-dir>
set -u
cd "$1" || exit 2
F=apps/api/src/architecture.testkit.ts
run() {
  echo "### mutant $1: $2"
  npx vitest run --project unit-node apps/api/src/architecture.test.ts > "$TMPDIR/mut-$1.out" 2>&1
  local s=$?
  grep -E '^\s+(×|✗)|Tests ' "$TMPDIR/mut-$1.out" | sed -E 's/\x1b\[[0-9;]*m//g' | head -12
  echo "exit=$s ($( [ $s -ne 0 ] && echo KILLED || echo SURVIVED ))"
  git checkout -q -- "$F"
}
node -e '
const fs=require("fs");const f=process.argv[1];const s=fs.readFileSync(f,"utf8");
const muts={
 M1:[/reportDiagnostics: true,\n        compilerOptions: \{ jsx: ts.JsxEmit.Preserve \},\n        transformers/, "reportDiagnostics: false,\n        compilerOptions: { jsx: ts.JsxEmit.Preserve },\n        transformers"],
 M2:[/: \(ts\.transpileModule\(source, \{\n        fileName,/, ": (ts.transpileModule(source, {\n        fileName: \"module.ts\","],
 M3:[/\.filter\(\(d\) => d\.category === ts\.DiagnosticCategory\.Error\)\n    \.map\(\(d\) => \{\n      const line = d\.file && d\.start !== undefined \? d\.file\.getLineAndCharacterOfPosition\(d\.start\)\.line \+ 1 : 0;\n      return `unparseable source/, ".filter((d) => d.category === ts.DiagnosticCategory.Error)\n    .slice(0, 1)\n    .map((d) => {\n      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;\n      return `unparseable source"],
 M4:[/: \(ts\.transpileModule\(source, \{\n        fileName,\n        reportDiagnostics: true,\n        compilerOptions: \{ jsx: ts\.JsxEmit\.Preserve \},\n        transformers: \{ before: \[EMPTY_EMIT\] \},\n      \}\)\.diagnostics \?\? \[\]\);/, ": ((ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, /x$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS) as unknown as { parseDiagnostics: ts.Diagnostic[] }).parseDiagnostics ?? []);"],
 M5:[/compilerOptions: \{ jsx: ts\.JsxEmit\.Preserve \},\n        transformers/, "compilerOptions: { jsx: ts.JsxEmit.Preserve, target: ts.ScriptTarget.ES2015 },\n        transformers"],
};
for (const [k,[re,rep]] of Object.entries(muts)) { if(!re.test(s)) { console.error("pattern not found for "+k); process.exit(3);} fs.writeFileSync(process.env.TMPDIR+"/"+k+".ts", s.replace(re,rep)); }
' "$F" || exit 3
declare -A D=(
 [M1]="reportDiagnostics: false (rule 4 reports nothing)"
 [M2]="fileName fixed to module.ts (script kind no longer follows the extension)"
 [M3]="only the first syntax error is reported (.slice(0, 1))"
 [M4]="parser-only diagnostics (createSourceFile parseDiagnostics, the 'cheaper' path that skips the program's additional JS diagnostics)"
 [M5]="target ES2015 added to the same call (the handback's disclosed equivalent survivor; expected to SURVIVE)"
)
for k in M1 M2 M3 M4 M5; do cp "$TMPDIR/$k.ts" "$F"; git diff --stat -- "$F" | tail -1; run "$k" "${D[$k]}"; done
git status --short -- apps/api/src
echo "(clone source restored; git status above lists nothing under apps/api/src)"
