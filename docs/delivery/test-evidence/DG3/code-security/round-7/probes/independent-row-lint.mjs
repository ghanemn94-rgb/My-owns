// code-security-reviewer DG3 round 7: independent re-check of ADR-0024 §6 "Pinned by tests" (F-DG3-280), outside the
// candidate's own test. Takes every row of fuzz.test.ts's PROBES table (runtime dump, see below), lints each text with ESLint (cwd = clone root) as packages/shared/src/formula/tokenize.ts,
// and reports per row: fatal parse error?, the formula-block GUARD rules that refuse it, and any other error rules.
// Exit 0 iff: rows == 101; exactly the two "unbalanced" rows are fatal (and nothing else is); every other row has >=1 guard rule.
// Usage: node independent-row-lint.mjs <clone-root> <probes-dump.json>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const root = process.argv[2];
const req = createRequire(`${root}/package.json`);
const { ESLint } = req("eslint");
// Rows come from a runtime dump of PROBES (argv[3], JSON), taken in a SEPARATE disposable copy whose fuzz.test.ts had one
// added line after the PROBES literal writing JSON.stringify(PROBES) to a file (collection only, no test run); the
// template-literal handler rows (G1, G2, …) cannot be read from the AST without evaluating them.
const rows = JSON.parse(readFileSync(process.argv[3], "utf8"));
const GUARD = new Set(["no-eval", "no-implied-eval", "no-new-func", "no-restricted-globals", "no-restricted-imports", "no-restricted-syntax", "no-unsafe-finally"]);
const eslint = new ESLint({ cwd: root });
let fatalRows = [], unguarded = [], n = 0;
for (const [text, what] of rows) {
  const [res] = await eslint.lintText(text, { filePath: `${root}/packages/shared/src/formula/tokenize.ts` });
  const errs = res.messages.filter((m) => m.severity === 2);
  const fatal = res.messages.some((m) => m.fatal);
  const guard = [...new Set(errs.map((m) => m.ruleId).filter((r) => r && GUARD.has(r)))];
  const other = [...new Set(errs.map((m) => m.ruleId).filter((r) => r && !GUARD.has(r)))];
  n++;
  if (fatal) fatalRows.push(text);
  else if (guard.length === 0) unguarded.push(text);
  console.log(`${String(n).padStart(3)}\t${fatal ? "FATAL" : guard.length ? "GUARD" : "NONE "}\t${guard.join(",") || "-"}\t${other.join(",") || "-"}\t[${what}]\t${JSON.stringify(text).slice(0, 90)}`);
}
const expectFatal = ['const s = "unclosed;', "function f() {"];
const ok = rows.length === 101 && fatalRows.length === 2 && expectFatal.every((t) => fatalRows.includes(t)) && unguarded.length === 0;
console.log(`# rows ${rows.length}; fatal ${fatalRows.length} ${JSON.stringify(fatalRows)}; refused by a guard rule ${rows.length - fatalRows.length - unguarded.length}; unguarded ${unguarded.length} ${JSON.stringify(unguarded)}`);
console.log(`# VERDICT: ${ok ? "ADR-0024 §6 'Pinned by tests' row claim holds (101 rows: 99 guard-refused, 2 unbalanced rows fatal)" : "MISMATCH"}`);
process.exit(ok ? 0 : 1);
