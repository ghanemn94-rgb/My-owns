// QA round-16 independent probe for F-DG1-137 / F-DG1-218 (REQ-S16-003). Authored by qa-verifier; not product code.
// Run by copying into apps/api/src/ of a DISPOSABLE clone: npx vitest run --project unit-node apps/api/src/qa-r16-declaration-file-probe.test.ts
// Checks, over a generated name matrix (independent of the implementer's fixed list):
//  1. isDeclarationFileName(name) agrees with TypeScript's public SourceFile.isDeclarationFile AND (when present at
//     runtime) with the @internal ts.isDeclarationFileName, for every name.
//  2. fileViolations() never throws and never yields "Debug Failure" for any name walk() would collect (CODE_FILE).
//  3. A real syntax error in every collected name surfaces as a named "<path>: unparseable source: ..." diagnostic.
//  4. The real modules tree is walked without throwing (latent: count of arbitrary-extension declaration files logged).
import ts from "typescript";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, isDeclarationFileName, MODULES_DIR, walk } from "./architecture.testkit.js";
import { readFileSync } from "node:fs";

const CODE_FILE = /\.[cm]?[jt]sx?$/; // mirrors the testkit's walk() filter (asserted below against walk on a temp dir is out of scope)
const middles = ["", ".d", ".D", ".d.css", ".d.json", ".d.ts", ".d.mts", ".d.html", ".d.d", ".d.x.y", ".d.", ".dts", ".spec.d.css"];
const finals = [".ts", ".mts", ".cts", ".tsx", ".js", ".mjs", ".cjs", ".jsx", ".d"];
const names = [...new Set(middles.flatMap((m) => finals.map((f) => `n${m}${f}`)))].concat([
  "styles.d.css.ts",
  "data.d.json.ts",
  "x.d.ts.ts",
  "a.d.tsx",
  "d.ts",
  ".d.ts",
  "a.d.css.mts",
  "a.d.css.cts",
]);
const internal = (ts as unknown as { isDeclarationFileName?: (n: string) => boolean }).isDeclarationFileName;

describe("QA r16: declaration-file classification parity with TypeScript", () => {
  it("matches public SourceFile.isDeclarationFile and the internal ts.isDeclarationFileName", () => {
    const table: string[] = [];
    for (const name of names) {
      const pub = ts.createSourceFile(name, "", ts.ScriptTarget.Latest).isDeclarationFile;
      const mine = isDeclarationFileName(name);
      expect(mine, name).toBe(pub);
      if (internal) expect(mine, `${name} (internal)`).toBe(internal(name));
      table.push(`${name}\tdecl=${mine}\tcollected=${CODE_FILE.test(name)}`);
    }
    console.log(`ts ${ts.version}; internal isDeclarationFileName present=${typeof internal === "function"}\n${table.join("\n")}`);
  });
});

describe("QA r16: no collected name crashes the lint; syntax errors are named", () => {
  const collected = names.filter((n) => CODE_FILE.test(n));
  it.each(collected)("%s", (name) => {
    const file = join(MODULES_DIR, "transformations", name);
    const where = relative(join(MODULES_DIR, ".."), file).replace(/\\/g, "/");
    const ok = isDeclarationFileName(name) ? "export declare const x: number;" : "export const x = 1;";
    expect(() => fileViolations("transformations", file, ok)).not.toThrow();
    const okV = fileViolations("transformations", file, ok).join("\n");
    expect(okV).not.toMatch(/Debug Failure/);
    expect(okV).not.toMatch(/unparseable source/);
    const broken = "export const = ;";
    expect(() => fileViolations("transformations", file, broken)).not.toThrow();
    const v = fileViolations("transformations", file, broken).join("\n");
    expect(v).not.toMatch(/Debug Failure/);
    expect(v).toContain(`${where}: unparseable source:`);
  });
});

describe("QA r16: real modules tree", () => {
  it("walks and lints every module file without throwing", () => {
    const files = walk(MODULES_DIR);
    const decl = files.filter((f) => isDeclarationFileName(basename(f)));
    const arb = decl.filter((f) => !/\.d\.[cm]?ts$/.test(f));
    const lint = () =>
      files.flatMap((f) => {
        const mod = relative(MODULES_DIR, f).split(/[\\/]/)[0] as Parameters<typeof fileViolations>[0];
        return fileViolations(mod, f, readFileSync(f, "utf8"));
      });
    expect(lint).not.toThrow();
    expect(lint()).toEqual([]);
    console.log(`modules files=${files.length} declaration=${decl.length} arbitrary-extension declaration=${arb.length}`);
  });
});
