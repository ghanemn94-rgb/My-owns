// code-security-reviewer DG3 round 6: counts the rows of fuzz.test.ts's PROBES table (AST, TypeScript parser) and
// which of them the candidate's lintText test lints (its filter on the hit name, copied verbatim from fuzz.test.ts:829-831).
// Spread rows (ROUND5_HANDLER_FORMS, F1_FORMS) are counted from their own arrays. Usage: node count-lint-pinned-rows.mjs <clone>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const root = process.argv[2];
const ts = createRequire(`${root}/packages/shared/package.json`)("typescript");
const file = `${root}/packages/shared/src/formula/fuzz.test.ts`;
const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const arrays = {};
(function walk(n) {
  if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer && ts.isArrayLiteralExpression(n.initializer)) arrays[n.name.text] = n.initializer;
  ts.forEachChild(n, walk);
})(sf);
const FILTER = /^(catch|finally|\.then|Promise|generator|then|fromAsync)/; // fuzz.test.ts:830
const rows = [];
for (const el of arrays.PROBES.elements) {
  if (ts.isArrayLiteralExpression(el)) rows.push(el.elements[1].text);
  else if (ts.isSpreadElement(el)) {
    const src = el.expression.expression.expression.text; // X.map(...)
    const n = arrays[src].elements.length;
    const what = src === "F1_FORMS" ? "finally with return/throw/break/continue" : null;
    for (let i = 0; i < n; i++) rows.push(what ?? arrays[src].elements[i].elements[2].text);
  }
}
const linted = rows.filter((w) => FILTER.test(w));
const not = rows.filter((w) => !FILTER.test(w));
const by = {}; for (const w of not) by[w] = (by[w] ?? 0) + 1;
console.log(`PROBES rows: ${rows.length}; linted by the candidate's lintText test: ${linted.length}; not linted: ${not.length}`);
console.log("not linted, by scan hit name:", JSON.stringify(by, null, 1));
console.log("of which handler/asynchrony (L1-L7) rows:", ["async", "await", "EvalError outside instanceof"].map((w) => `${w}=${by[w] ?? 0}`).join(" "));
