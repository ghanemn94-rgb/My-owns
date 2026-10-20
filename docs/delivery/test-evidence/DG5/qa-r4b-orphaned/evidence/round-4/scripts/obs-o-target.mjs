// qa-verifier r4, observation (o): does ts.transpileModule's syntactic diagnostic set change with target ES2015 (the
// guard test's surviving mutant) on the guard corpus x 8 extensions, plus a few target-sensitive extras?
import ts from "typescript";
const corpus = [
  `import { x } from "./a.ts";\nexport const y: number = x;`, `export const a = (1;`, `const C = (async () => {} as any)[k];`,
  `export const e = <div a='b'>{x}</div>;`, `export function f(a: string): string { return a; }`, `await Promise.resolve(1);`,
  `export const r = /a/v;`, "export const s = `abc", `export const o = 010;`, `export enum E { A }\nexport class K { constructor(private p: number) {} }`,
];
const extras = [`export const r2 = /(?<n>a)\\k<n>/;`, `export const r3 = /a/s;`, `export const b = 1_000n;`, `class A { #p = 1; static { } }`, `export const t = a?.b ?? c;`];
const run = (fileName, src, target) => (ts.transpileModule(src, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve, ...(target ? { target } : {}) } }).diagnostics ?? [])
  .filter((d) => d.category === ts.DiagnosticCategory.Error).map((d) => ts.flattenDiagnosticMessageText(d.messageText, " "));
let diff = 0, n = 0;
for (const [set, list] of [["corpus", corpus], ["extras", extras]])
  for (const src of list) for (const ext of [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]) {
    n++; const a = run(`m/zz${ext}`, src), b = run(`m/zz${ext}`, src, ts.ScriptTarget.ES2015);
    if (JSON.stringify(a) !== JSON.stringify(b)) { diff++; console.log(`DIFF [${set}] ${ext} ${JSON.stringify(src)}\n  default: ${JSON.stringify(a)}\n  ES2015:  ${JSON.stringify(b)}`); }
  }
console.log(`typescript ${ts.version}: ${n} cases, ${diff} differ between the default target and ES2015`);
