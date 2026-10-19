// SEC-R4 (code-security-reviewer, round 4, F-DG5-102): adversarial differential of rule 4 (syntaxErrors, now with the
// EMPTY_EMIT `before` transformer) against the pre-repair path (a full ts.transpileModule with the same options and no
// transformer, i.e. bbd6294's syntaxErrors body). Run from a disposable clone as apps/api/src/zz-sec-r4-rule4-differential.test.ts
// in the unit-node project; never part of the candidate.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODULES_DIR, syntaxErrors } from "./architecture.testkit.ts";

const oldPath = (fileName: string, source: string): string[] =>
  (
    ts.transpileModule(source, {
      fileName,
      reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.Preserve },
    }).diagnostics ?? []
  )
    .filter((d) => d.category === ts.DiagnosticCategory.Error)
    .map((d) => {
      const line = d.file && d.start !== undefined ? d.file.getLineAndCharacterOfPosition(d.start).line + 1 : 0;
      return `unparseable source: ${ts.flattenDiagnosticMessageText(d.messageText, " ")} (line ${line})`;
    });

// Hostile sources chosen to hit diagnostics that are produced late or that depend on the script kind, the module
// detection, the target, JSX, strict mode, or what the emit's own transformers (ts, jsx, esnext, module) touch.
const HOSTILE = [
  `export const a = (1;`,
  `const C = (async () => {} as any)[k];`,
  `with (o) { x; }`,
  `"use strict"; with (o) { x; }`,
  `export const o = 010;`,
  `export const s = "\\08";`,
  "export const t = `\\08`;",
  "export const t2 = tag`\\unicode`;",
  `export const r = /a/v;`,
  `export const r2 = /(?<a>x)(?<a>y)/;`,
  `export const r3 = /[/;`,
  `export const r4 = /a/gg;`,
  `export const n = 1__0;`,
  `export const n2 = 1.5n;`,
  `export const n3 = 0b102;`,
  `export const u = "\\u{110000}";`,
  `export const x\\u0061 = 1; export const \\u{64}efault = 2;`,
  `await Promise.resolve(1);`,
  `for await (const x of y) {}`,
  `export {}; using r = f();`,
  `export {}; await using r = f();`,
  `@dec export class A { @m() method() {} #p = 1; has(o: object) { return #p in o; } }`,
  `class A { accessor x = 1; static { this.y = 2; } }`,
  `export = foo;`,
  `import x = require("./a.ts"); export default x;`,
  `import type T, { U } from "./a.ts";`,
  `import { type default as D } from "./a.ts";`,
  `export * as ns from "./a.ts"; export { default } from "./b.ts";`,
  `import a from "./a.json" with { type: "json" };`,
  `import a from "./a.json" assert { type: "json" };`,
  `export const v = import.meta.url;`,
  `export const e = <div a='b'>{x}</div>;`,
  `export const e2 = <div><span></div>;`,
  `export const e3 = <T,>(x: T) => x;`,
  `export const e4 = <string>y;`,
  `export const e5 = <></>;`,
  `export const e6 = <a:b c:d="1" />;`,
  `export enum E { A = "a", B = A }`,
  `export const enum CE { A }`,
  `declare module "m" { export const z: number; }`,
  `namespace N { export const q = 1; }`,
  `export abstract class K { abstract m(): void; constructor(private readonly p: number, public q?: string) {} }`,
  `function f(this: Window, ...a: number[]): asserts a is number[] {}`,
  `let x!: number; let y = z satisfies number; let w = q as const;`,
  `export function g<const T extends readonly unknown[]>(t: T): T { return t; }`,
  `export const obj = { __proto__: null, __proto__: 1 };`,
  `export const dup = { a, a };`,
  `function f(a, a) {}`,
  `"use strict"; function f(a, a) {}`,
  `export function h(a = 1, a) {}`,
  `delete x;`,
  `"use strict"; delete x;`,
  `label: label: x;`,
  `break;`,
  `continue foo;`,
  `return 1;`,
  `yield 1;`,
  `function* gen() { yield* ; }`,
  `async function af() { await; }`,
  `let let = 1;`,
  `export const let = 1;`,
  `const a;`,
  `export default class {} export default class {}`,
  `import { a } from;`,
  `export { a as "string name" } from "./a.ts";`,
  `import { "string name" as b } from "./a.ts";`,
  `x?.y\`t\`;`,
  `new.target;`,
  `class B extends A { constructor() { super.x; super(); } m() { super(); } }`,
  `#!/usr/bin/env node\nexport const shebang = 1;`,
  `export const a = 1;\n#!/not/first`,
  `<!-- html comment\nexport const h = 1;`,
  `export const bom = 1;﻿;`,
  `/* unterminated comment`,
  "export const unterminated = `abc",
  `export const unterminated2 = "abc`,
  `export const z = 0x;`,
  `export const nul = "\\x";`,
  `if (a) function f() {}`,
  `"use strict"; if (a) function f() {}`,
  `export const arrow = async x => await x; const bad = async (x) \n => x;`,
  `export const opt = a?.b!.c?.[d]!(e);`,
  `export interface I { m?(): void; readonly [k: string]: unknown; new (): I; }`,
  `export type T = typeof import("./a.ts");`,
  `export type U<in out T> = T;`,
  `export const g = function* () {}; export const ag = async function* () {};`,
  `export const sym = Symbol(); export const big = 2n ** 64n;`,
  `export const nested = ((((((((((((((((((((1))))))))))))))))))));`,
  `export const nul2 = "a\\0b";`,
  `export const v = a ?? b || c;`,
  `export const v2 = -2 ** 2;`,
  `export const v3 = (a, b) => { "use strict"; };`,
  `export function v4(a = 1) { "use strict"; }`,
  `export const v5 = class { static async *[Symbol.iterator]() {} };`,
  `export {}; declare global { interface Window { q: 1 } }`,
  `export const s = new class { #x; static #y() {} get #z() { return 1; } };`,
  `export const t = this.x;`,
  `arguments = 1; eval = 2;`,
  `"use strict"; arguments = 1; eval = 2;`,
  `export const octalEsc = "\\101";`,
  `"use strict"; export const octalEsc = "\\101";`,
];

const EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];

function walkModules(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walkModules(p, out);
    else if (/\.[cm]?[jt]sx?$/.test(e) && !/\.d\.[cm]?ts$/.test(e)) out.push(p);
  }
  return out;
}

// Deterministic PRNG (mulberry32) so the run is reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const TOKENS = ["(", ")", "{", "}", "[", "]", ";", ",", "`", '"', "'", "/", "<", ">", "@", "#", "=>", "\\", "?.", "!", ":", " as ", "<div>", "await ", "yield ", "\n"];

describe("SEC-R4 rule-4 differential (F-DG5-102)", () => {
  it("hostile corpus x 8 extensions: EMPTY_EMIT path === full transpileModule", () => {
    let cases = 0;
    let withErrors = 0;
    const diffs: string[] = [];
    for (const src of HOSTILE)
      for (const ext of EXT) {
        const f = join(MODULES_DIR, "transformations", `zz-hostile${ext}`);
        const a = syntaxErrors(f, src);
        const b = oldPath(f, src);
        cases++;
        if (b.length) withErrors++;
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${ext} ${JSON.stringify(src)}\n new=${JSON.stringify(a)}\n old=${JSON.stringify(b)}`);
      }
    console.log(`SEC-R4 hostile: cases=${cases} withErrors=${withErrors} diffs=${diffs.length}`);
    expect(diffs).toEqual([]);
    expect(withErrors).toBeGreaterThan(HOSTILE.length);
  }, 300_000);

  it("every real module file, verbatim and with 3 seeded random mutations each: EMPTY_EMIT path === full transpileModule", () => {
    const files = walkModules(MODULES_DIR);
    const r = rng(0x5ec4);
    let cases = 0;
    let withErrors = 0;
    const diffs: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const variants = [src];
      for (let i = 0; i < 3; i++) {
        const pos = Math.floor(r() * src.length);
        const op = r();
        const tok = TOKENS[Math.floor(r() * TOKENS.length)]!;
        variants.push(op < 0.4 ? src.slice(0, pos) + tok + src.slice(pos) : op < 0.8 ? src.slice(0, pos) + src.slice(pos + 1 + Math.floor(r() * 5)) : src.slice(0, pos));
      }
      for (const v of variants) {
        const a = syntaxErrors(f, v);
        const b = oldPath(f, v);
        cases++;
        if (b.length) withErrors++;
        if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${f}: new=${JSON.stringify(a)} old=${JSON.stringify(b)}`);
      }
    }
    console.log(`SEC-R4 real-files: files=${files.length} cases=${cases} withErrors=${withErrors} diffs=${diffs.length}`);
    expect(diffs).toEqual([]);
    expect(files.length).toBeGreaterThan(400);
  }, 600_000);
});
