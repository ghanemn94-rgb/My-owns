// code-security-reviewer DG2 round-13: independent AST sweep (F-DG2-441). For every function that is (a) the callback
// of `<x>.transaction().execute(...)` / `.transaction(...)`, (b) declares a parameter whose type text mentions
// Tx|DbOrTx|Transaction|PoolClient|ClientBase, or (c) checks out a pooled client (`await <pool>.connect()`), list every
// `await` whose operand neither is rooted at, nor passes as an argument, an identifier that names the transaction /
// database / client (tx, trx, db, dbOrTx, client, c, conn, owner, ctx where ctx.tx). The rest is printed for review.
import { createRequire } from "node:module";
const ts = createRequire(process.argv[2] + "/package.json")("typescript");
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
const root = process.argv[2];
const files = execSync(`git -C ${root} ls-files ':(glob)apps/*/src/**/*.ts' ':(glob)packages/*/src/**/*.ts'`).toString().split("\n").filter((f) => f && !f.endsWith(".test.ts") && !f.endsWith(".d.ts"));
const DBID = /^(tx|trx|db|dbOrTx|client|conn|connection|executor|t)$/;
let fnCount = 0; const flagged = [];
const rootId = (e) => { while (true) { if (ts.isCallExpression(e) || ts.isPropertyAccessExpression(e) || ts.isElementAccessExpression(e) || ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e)) e = e.expression; else break; } return ts.isIdentifier(e) ? e.text : e.kind === ts.SyntaxKind.ThisKeyword ? "this" : ""; };
const mentionsDb = (node) => { let hit = false; const v = (n) => { if (hit) return; if (ts.isIdentifier(n) && DBID.test(n.text)) hit = true; else if (ts.isPropertyAccessExpression(n) && /^(tx|db)$/.test(n.name.text)) hit = true; else ts.forEachChild(n, v); }; v(node); return hit; };
for (const f of files) {
  const src = ts.createSourceFile(f, readFileSync(`${root}/${f}`, "utf8"), ts.ScriptTarget.Latest, true);
  const isScope = (fn) => {
    if (fn.parameters.some((p) => p.type && /\b(Tx|DbOrTx|Transaction|PoolClient|ClientBase|Kysely)\b/.test(p.type.getText(src)))) return "param";
    const par = fn.parent;
    if (ts.isCallExpression(par) && /transaction\(\)?\s*\.?\s*(execute)?$|\.transaction$/.test(par.expression.getText(src).replace(/\s+/g, ""))) return "tx-callback";
    if (ts.isCallExpression(par) && /\.transaction\(\)\.execute$|\.execute$/.test(par.expression.getText(src).replace(/\s+/g, "")) && /transaction/.test(par.expression.getText(src))) return "tx-callback";
    let checkout = false; const v = (n) => { if (checkout) return; if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression) && /\.connect$/.test(n.expression.expression.getText(src))) checkout = true; else if (!ts.isFunctionLike(n)) ts.forEachChild(n, v); }; if (fn.body) v(fn.body); if (checkout) return "client-checkout";
    return null;
  };
  const visitFn = (fn, kind) => {
    fnCount++;
    const v = (n) => {
      if (n !== fn && ts.isFunctionLike(n)) return; // nested functions are visited on their own if in scope
      if (ts.isAwaitExpression(n) || ts.isForOfStatement(n) && n.awaitModifier) {
        const e = ts.isAwaitExpression(n) ? n.expression : n.expression;
        const r = rootId(e);
        if (!(DBID.test(r) || mentionsDb(e))) { const { line } = src.getLineAndCharacterOfPosition(n.getStart(src)); flagged.push(`${f}:${line + 1} [${kind}] ${n.getText(src).replace(/\s+/g, " ").slice(0, 140)}`); }
      }
      ts.forEachChild(n, v);
    };
    if (fn.body) ts.forEachChild(fn.body, v);
  };
  const walk = (n) => { if (ts.isFunctionLike(n) && n.body) { const k = isScope(n); if (k) visitFn(n, k); } ts.forEachChild(n, walk); };
  walk(src);
}
console.log(`# files scanned: ${files.length}; in-transaction / tx-taking / client-checkout functions: ${fnCount}; awaits NOT evidently database work: ${flagged.length}`);
for (const l of flagged) console.log(l);
