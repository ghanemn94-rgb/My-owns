// code-security-reviewer DG3 round 6: checks the ADR-0024 §6 word claims about decimal.js 10.6.0 and the seven engine
// sources with a real parser (TypeScript's createSourceFile from the clone's own node_modules), not a regex. Comments are
// not nodes, so they are excluded; identifiers, private names, string/template/regex texts and keyword constructs are
// collected. (Revision 2: revision 1 used the raw scanner and mis-tokenized template literals, so comment text leaked
// into tokens; that output was discarded.) Usage: node word-claims.mjs <clone-root>
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
const root = process.argv[2];
if (!root || !root.includes("review-p6")) throw new Error("pass the disposable clone $TMPDIR/review-p6");
const ts = createRequire(`${root}/packages/shared/package.json`)("typescript");
const WORDS = ["try", "catch", "finally", "Promise", "async", "await", "then", "yield", "fromAsync", "asyncIterator"];
const K = ts.SyntaxKind;
function scan(file) {
  const kind = file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const by = {};
  const add = (w, n) => { by[w] = (by[w] ?? 0) + 1; if (n) (by._at ??= []).push(`${w}@L${sf.getLineAndCharacterOfPosition(n.getStart()).line + 1}`); };
  const words = (text, n) => { for (const w of WORDS) if (new RegExp(`\\b${w}\\b`).test(text)) add(`${w}(text)`, n); };
  (function walk(n) {
    switch (n.kind) {
      case K.Identifier: case K.PrivateIdentifier: words(n.text, n); break;
      case K.StringLiteral: case K.NoSubstitutionTemplateLiteral: case K.TemplateHead: case K.TemplateMiddle: case K.TemplateTail: case K.RegularExpressionLiteral: words(n.text, n); break;
      case K.TryStatement: add("try-statement"); if (n.catchClause) add("catch-clause"); if (n.finallyBlock) add("finally-block", n.finallyBlock); break;
      case K.YieldExpression: add("yield-expr", n); break;
      case K.AwaitExpression: add("await-expr", n); break;
      case K.ForOfStatement: if (n.awaitModifier) add("for-await", n); break;
    }
    if ((ts.isFunctionLike(n)) && n.asteriskToken) add("generator-function", n);
    if (n.modifiers?.some((m) => m.kind === K.AsyncKeyword)) add("async-function", n);
    ts.forEachChild(n, walk);
  })(sf);
  return by;
}
const dec = `${root}/node_modules/.pnpm/decimal.js@10.6.0/node_modules/decimal.js`;
const files = [`${dec}/decimal.js`, `${dec}/decimal.mjs`,
  ...["evaluate", "index", "parse", "tokenize", "typecheck", "types"].map((f) => `${root}/packages/shared/src/formula/${f}.ts`),
  `${root}/packages/shared/src/value.ts`];
let bad = 0, catches = 0;
for (const f of files) {
  const by = scan(f);
  const rel = f.replace(root + "/", "");
  console.log(`${rel}: ${JSON.stringify(by)}`);
  const keys = Object.keys(by).filter((k) => k !== "_at");
  if (rel.includes("decimal.js")) { if (keys.length) bad++; }
  else { catches += by["catch-clause"] ?? 0; if (keys.some((k) => !["try-statement", "catch-clause"].includes(k))) bad++; }
}
console.log(`engine catch clauses: ${catches} (ADR-0024 §6 says five)`);
if (catches !== 5) bad++;
console.log(bad ? `RESULT: ${bad} contradiction(s) of the §6 word claims` : "RESULT: decimal.js 10.6.0 (both files) has none of the words or constructs outside comments; the seven engine sources have only try statements with catch clauses (5), no finally block, generator, yield, async, await, then, fromAsync or asyncIterator");
process.exit(bad ? 1 : 0);
