// T-DG5-REV-SEC-R4B (code-security-reviewer), F-DG5-102 adversarial check of the EMPTY_EMIT rule-4 path.
// Usage (from <clone>/apps/api): node <this file> <clone>/apps/api/src/architecture.testkit.ts <repo root>
// Compares, for every case, the testkit's syntaxErrors() (new path: transpileModule + EMPTY_EMIT `before` transformer)
// with the PRE-REPAIR rule-4 computation (bbd6294: the same transpileModule call without `transformers`), including
// thrown exceptions. Corpus: (1) hostile hand-written sources, (2) every .ts/.tsx/.mts/.cts/.js/.jsx/.mjs/.cjs file
// tracked under apps/, packages/, tools/, e2e/, tests/ (no node_modules, no dist), each as-is and under seeded random
// mutations (truncation, deletion, insertion of hostile tokens), x 8 extensions.
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import ts from "typescript";

const [testkitPath, repo] = process.argv.slice(2);
const { syntaxErrors, MODULES_DIR } = await import(testkitPath!);

const fmt = (ds: readonly ts.Diagnostic[]) =>
  ds
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `unparseable source: ${ts.flattenDiagnosticMessageText(d.messageText, " ")} (line ${line})`;
    });
// The pre-repair rule 4 (bbd6294 architecture.testkit.ts syntaxErrors, non-declaration branch), verbatim options.
const oldRule4 = (fileName: string, source: string) =>
  fmt(
    ts.transpileModule(source, { fileName, reportDiagnostics: true, compilerOptions: { jsx: ts.JsxEmit.Preserve } })
      .diagnostics ?? [],
  );
const run = (fn: () => string[]) => {
  try {
    return JSON.stringify(fn());
  } catch (e) {
    return `THROW ${(e as Error).message.split("\n")[0]}`;
  }
};

const hostile = [
  `// @ts-nocheck\nexport const a = (1;`,
  `/// <reference path="x" />\nexport {};`,
  `/** @jsx h */\nexport const e = <a/>;`,
  `/** @jsxImportSource preact */\nexport const e = <a b={1}/>;`,
  `@dec class A { @dec m() {} }`,
  `export class A { accessor x = 1; static { this.x; } #p = 1; has(o) { return #p in o; } }`,
  `using r = open(); await using s = open2();`,
  `import defer * as ns from "./x.ts";`,
  `import x = require("./x");\nexport = x;`,
  `enum E { A } const enum F { B } namespace N { export const n = 1; }`,
  `declare module "m" { export const z: number; }`,
  `/** @type {string} */ let s = 1; /** @param {*} a @returns {} */ function f(a) {}`,
  `/** @type {{a: } */ let bad;`,
  `﻿export const bom = 1;`,
  `export const u = "\\u{110000}";`,
  `export const u2 = '\\x';`,
  `let \\u0061wait = 1;`,
  `export const n = 1_000__000;`,
  `export const big = 0b102n;`,
  `with (o) { x; }`,
  `"use strict"; delete x; var eval = 1; arguments = 2;`,
  `label: label: for(;;) {}`,
  `function* g() { yield = 1; } async function h() { var await; }`,
  `export default function () {} export default 1;`,
  `return 1;`,
  `break;`,
  `import { a as "b" } from "./x.ts"; export { a as "\\uD800" };`,
  `export * as default from "./x.ts";`,
  `let x: <T>(a: T) => T = (a) => a; let y = <T,>(a: T) => a;`,
  `let z = a < b > c;`,
  `type T = { [K in keyof U as \`k\${K}\`]: U[K] };`,
  `function f(this: Window, ...a: number[], b) {}`,
  `class C { constructor(public readonly p?: number = 1) {} }`,
  `abstract class D { abstract m(): void {} }`,
  `let o = { a: 1, a: 2, get a() { return 1; } };`,
  `export const r = /(?<n>a)\\k<m>/u;`,
  `export const r2 = /[/;`,
  `export const t = tag\`\\unicode\`;`,
  `export const t2 = \`\\unicode\`;`,
  `(async () => {} as any)[k];`,
  `const C = (async () => {} as any)[k]; import("./a.ts"); require("b");`,
  "x y",
  `if (a) function f() {}`,
  `for (let let = 0;;) {}`,
  `class K extends A, B {}`,
  `interface I extends A implements B {}`,
  `export const satisfied = { a: 1 } satisfies Record<string, number>;`,
  `export const nn = a!.b!!;`,
  `let q = a ?? b || c;`,
  `let q2 = -1 ** 2;`,
  `export const jsxText = <div>></div>;`,
  `export const jsx2 = <div {...p} a=b />;`,
  `export const frag = <></>; export const frag2 = <><a></>;`,
  `#!/usr/bin/env node\nexport {};`,
  `export {};\n#!/usr/bin/env node`,
  `<<<<<<< HEAD\nexport const a = 1;\n=======\nexport const a = 2;\n>>>>>>> b`,
  "",
  "\0",
  "/*",
  "'",
  "export const deep = " + "(".repeat(2000) + "1" + ")".repeat(2000) + ";",
  "export const deep2 = " + "[".repeat(3000) + ";",
];

const exts = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const tokens = ["(", ")", "{", "}", "<", ">", "`", "'", '"', "/", "*", "@", "#", ";", ":", "=>", "<div>", " ", "\\", "?."];
let seed = 0x5ec4b;
const rnd = (n: number) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const mutate = (s: string): string[] => {
  if (s.length === 0) return [];
  const out: string[] = [];
  for (let i = 0; i < 3; i++) {
    const p = rnd(s.length);
    out.push(s.slice(0, p));
    out.push(s.slice(0, p) + s.slice(Math.min(s.length, p + 1 + rnd(40))));
    out.push(s.slice(0, p) + tokens[rnd(tokens.length)] + s.slice(p));
  }
  return out;
};

let cases = 0;
let withErrors = 0;
let throwsOld = 0;
const diffs: string[] = [];
const check = (fileName: string, source: string, label: string) => {
  cases++;
  const a = run(() => oldRule4(fileName, source));
  const b = run(() => syntaxErrors(fileName, source));
  if (a.startsWith("THROW")) throwsOld++;
  else if (a !== "[]") withErrors++;
  if (a !== b && diffs.length < 50) diffs.push(`${label} ${fileName}\n  old: ${a.slice(0, 400)}\n  new: ${b.slice(0, 400)}`);
  else if (a !== b) diffs.push("…");
};

for (const [i, src] of hostile.entries())
  for (const ext of exts) check(join(MODULES_DIR, "transformations", `zz-hostile-${i}${ext}`), src, `hostile#${i}`);
const hostileCases = cases;

const files = execFileSync("git", ["-C", repo!, "ls-files", "apps", "packages", "tools", "e2e", "tests"], { encoding: "utf8" })
  .split("\n")
  .filter((f) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(f) && !/\.d\.[^/]*ts$/.test(f) && !f.includes("node_modules"));
let bytes = 0;
for (const f of files) {
  const src = readFileSync(join(repo!, f), "utf8");
  bytes += src.length;
  const base = join(MODULES_DIR, "transformations", "zz-corpus");
  const variants = [src, ...mutate(src)];
  for (const [vi, v] of variants.entries())
    for (const ext of vi === 0 ? exts : [exts[rnd(exts.length)]!, exts[rnd(exts.length)]!])
      check(base + ext, v, `${f}#v${vi}`);
}
console.log(`node ${process.version}; typescript ${ts.version}`);
console.log(`hostile sources: ${hostile.length} x ${exts.length} extensions = ${hostileCases} cases`);
console.log(`repository corpus: ${files.length} tracked source files (${(bytes / 1e6).toFixed(2)} MB), as-is x 8 extensions + 9 seeded mutations x 2 random extensions each`);
console.log(`total cases ${cases}; with syntax errors (old path) ${withErrors}; old path threw ${throwsOld}; differences ${diffs.length}`);
for (const d of diffs) console.log(d);
process.exit(diffs.length === 0 ? 0 : 1);
