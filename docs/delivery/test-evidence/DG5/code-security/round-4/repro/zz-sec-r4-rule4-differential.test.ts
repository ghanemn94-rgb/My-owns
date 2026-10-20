// T-DG5-REV-SEC-R4C (code-security-reviewer), F-DG5-102 re-verification. Disposable probe: copied into a clone's
// apps/api/src/ and removed afterwards; never part of the candidate.
// Adversarial differential: rule 4 (`syntaxErrors`, EMPTY_EMIT path) against the PRE-repair rule 4 (a full
// ts.transpileModule with the same options and the same formatting, copied from bbd6294's architecture.testkit.ts),
// over (1) a hostile corpus of syntax-error and grammar-edge sources chosen by this reviewer, x 9 module-file
// extensions, and (2) every real module file under src/modules, each mutated at 8 deterministic positions by 4
// mutation kinds (delete a char, insert one of `( { < /`, duplicate a token-ish slice, truncate), x 3 extensions.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { MODULES_DIR, syntaxErrors } from "./architecture.testkit.ts";

function oldRule4(fileName: string, source: string): string[] {
  return (
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
}

const HOSTILE = [
  `const C = (async () => {} as any)[k];`,
  `export const a = (1;`,
  `export default interface I {} export default 1;`,
  `import x = require("x"); export = x;`,
  `export = 1; export const b = 2;`,
  `@dec export class A {}`,
  `export @dec class A {}`,
  `class A { @dec() m() {} @dec accessor x = 1; }`,
  `class A { #p = 1; static { this.#p; } } #q;`,
  `using r = open(); await using s = open();`,
  `label: label: for (;;) {}`,
  `let let = 1;`,
  `function f() { "use strict"; with (o) {} }`,
  `return 1;`,
  `new.target;`,
  `export const r = /(?<a>x)(?<a>y)/;`,
  `export const r = /[/;`,
  `export const n = 1__0 + 0x + 1e;`,
  `export const s = "\\u{110000}";`,
  `export const t = \`\${\`;`,
  `export const o = { a: 1, a: 2, __proto__: 1, __proto__: 2 };`,
  `const enum E { A = "x".length }`,
  `declare module "m" { export = 1; } namespace N.M { export const x = 1 }`,
  `abstract class A { abstract m(): void; private constructor(); }`,
  `export const v = x satisfies Y as Z!;`,
  `import type { T } from "./t.ts"; export type { T };`,
  `import defer * as ns from "./x.ts"; import source s from "./y.ts";`,
  `import json from "./a.json" with { type: "json" }; import k from "./b.json" assert { type: "json" };`,
  `export { a as "string name" } from "./x.ts";`,
  `const f = <T,>(x: T) => x; const g = <T>(x: T) => x;`,
  `const e = <div><span></div>;`,
  `const e = <a:b c:d="1" {...p} />;`,
  `const e = <>{/* c */}</>; const g = <T extends {}>(x: T) => x;`,
  `function* g() { yield = 1; } async function h() { await = 1; }`,
  `for await (const x of y) {} for (let x of async) {}`,
  `export const q = a ?? b || c;`,
  `export const q = -1 ** 2;`,
  `if (a) function f() {}`,
  `class A extends B { constructor() { super.x; } } super();`,
  `export const u = await;`,
  `﻿export const bom = 1;`,
  `export const a = 1; export const b = 2;`,
  `<<<<<<< HEAD\nexport const a = 1;\n=======\nexport const a = 2;\n>>>>>>> branch\n`,
  `#!/usr/bin/env node\nexport const x = 1;`,
  `export const x = 1; #!/bin/sh`,
  `enum E { A, B = A + 1 } declare enum D {} export declare const z: number;`,
  `export function f(this: Window, a?: number = 1, ...r?: number[]) {}`,
  `export function f(a, a) { "use strict"; }`,
  `delete x; export const y = 08; export const z = "\\08";`,
  `/** @type {number} */ export const j = 1; /** @param {*} a */ export function k(a) {}`,
  `type A<in out T> = T; export type B = typeof import("./x.ts");`,
  `export const t = <const T>(x: T) => x;`,
  `export accessor x = 1;`,
  `}{`,
  `export const a = 1; /* unterminated`,
  `export const a = 1 // \u0000 nul`,
  "",
];
const EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".d.ts"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : /\.(m|c)?(t|j)sx?$/.test(n) ? [p] : [];
  });
}

describe("SEC-R4C F-DG5-102: rule 4 (EMPTY_EMIT) equals the pre-repair full transpile", () => {
  it("hostile corpus x 9 extensions: identical diagnostics", () => {
    let cases = 0;
    let withErrors = 0;
    const diffs: string[] = [];
    for (const src of HOSTILE)
      for (const ext of EXTENSIONS) {
        const file = join(MODULES_DIR, "transformations", `zz-hostile${ext}`);
        const now = syntaxErrors(file, src);
        // The .d.ts branch never reached transpileModule, before or after (F-DG1-137/218); compare it with itself.
        const before = ext === ".d.ts" ? now : oldRule4(file, src);
        cases++;
        if (before.length > 0) withErrors++;
        if (JSON.stringify(now) !== JSON.stringify(before)) diffs.push(`${ext} ${JSON.stringify(src)}`);
      }
    console.log(`SEC-R4C hostile: ${cases} cases, ${withErrors} with errors, ${diffs.length} differences`);
    expect(diffs).toEqual([]);
    // Run 1 used `HOSTILE.length * 4` (228), a miscalibrated threshold of this probe: 218 of 513 cases have errors.
    expect(withErrors).toBeGreaterThan(HOSTILE.length * 3);
  }, 300_000);

  it("every real module file, mutated 32 ways x 3 extensions: identical diagnostics", () => {
    const files = walk(MODULES_DIR);
    let cases = 0;
    let withErrors = 0;
    const diffs: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const variants: string[] = [src];
      for (let i = 1; i <= 8; i++) {
        const p = Math.floor((src.length * i) / 9);
        variants.push(src.slice(0, p) + src.slice(p + 1));
        variants.push(src.slice(0, p) + "({</"[i % 4] + src.slice(p));
        variants.push(src.slice(0, p) + src.slice(p, p + 7) + src.slice(p));
        variants.push(src.slice(0, p));
      }
      const base = f.replace(/\.(m|c)?(t|j)sx?$/, "");
      for (const ext of [".ts", ".tsx", ".js"])
        for (const v of variants) {
          const file = `${base}${ext}`;
          const now = syntaxErrors(file, v);
          const before = oldRule4(file, v);
          cases++;
          if (before.length > 0) withErrors++;
          if (JSON.stringify(now) !== JSON.stringify(before)) diffs.push(`${file} (${v.length} chars)`);
        }
    }
    console.log(
      `SEC-R4C module mutants: ${files.length} files, ${cases} cases, ${withErrors} with errors, ${diffs.length} differences`,
    );
    expect(diffs).toEqual([]);
    expect(files.length).toBeGreaterThan(400);
  }, 1_800_000);
});
