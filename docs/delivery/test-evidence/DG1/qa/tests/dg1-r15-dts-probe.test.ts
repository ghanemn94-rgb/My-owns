// QA round-15 independent probe for F-DG1-217 (qa-verifier; review-time test, NOT part of the candidate).
// Usage (disposable clone only): cp this file to apps/api/src/ and run
//   npx vitest run --project unit-node apps/api/src/dg1-r15-dts-probe.test.ts --reporter=verbose
// It plants declaration files INTO THE REAL module directory and calls the production entry point moduleViolations()
// (walk() -> readFileSync -> fileViolations, the same path architecture.test.ts uses for the real-tree check).
// Every planted file is removed in afterEach; the real tree is re-checked as zero afterwards.
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { MODULES_DIR, moduleFiles, moduleViolations } from "./architecture.testkit.ts";

const MOD = "transformations" as const;
const DIR = join(MODULES_DIR, MOD);
const NESTED = join(DIR, "zz-qa-r15-nested");
const planted: string[] = [];
const plant = (dir: string, name: string, src: string) => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, src);
  planted.push(p);
  return p;
};
afterEach(() => {
  for (const p of planted.splice(0)) rmSync(p, { force: true });
  rmSync(NESTED, { recursive: true, force: true });
});
afterAll(() => {
  expect(moduleViolations(MOD)).toEqual([]);
});

const DECL_EXTS = ["d.ts", "d.mts", "d.cts"] as const;

describe("QA r15 F-DG1-217: module declaration files are linted end to end without throwing (real tree)", () => {
  it("baseline: the real transformations module tree lints to zero violations", () => {
    expect(moduleViolations(MOD)).toEqual([]);
  });

  it.each(DECL_EXTS)("planted zz-qa-r15.%s (valid, no imports) is walked and yields no violation, no throw", (ext) => {
    plant(DIR, `zz-qa-r15-ok.${ext}`, "export declare const x: number;\nexport interface Y { a: string }\n");
    expect(moduleFiles(MOD).some((f) => f.endsWith(`zz-qa-r15-ok.${ext}`))).toBe(true);
    expect(() => moduleViolations(MOD)).not.toThrow();
    expect(moduleViolations(MOD)).toEqual([]);
  });

  it.each(DECL_EXTS)("planted nested zz-qa-r15.%s with a deep cross-module TYPE import is flagged", (ext) => {
    plant(NESTED, `zz-qa-r15-deep.${ext}`, `import type { Actor } from "../../access/policy.ts";\nexport type A = Actor;\n`);
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r15-deep\\.${ext.replace(".", "\\.")}: imports \\.\\./\\.\\./access/policy\\.ts`));
  });

  it.each(DECL_EXTS)("planted zz-qa-r15.%s with an inline import() type query to a deep path is flagged", (ext) => {
    plant(DIR, `zz-qa-r15-q.${ext}`, `export declare const a: import("../access/policy.ts").Actor;\n`);
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r15-q\\.${ext.replace(".", "\\.")}: .*access/policy\\.ts`));
  });

  it.each(DECL_EXTS)("planted zz-qa-r15.%s with a syntax error yields a named unparseable diagnostic, never Debug Failure", (ext) => {
    plant(DIR, `zz-qa-r15-bad.${ext}`, "export declare function f(: number;\n");
    expect(() => moduleViolations(MOD)).not.toThrow();
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r15-bad\\.${ext.replace(".", "\\.")}: unparseable source`));
    expect(v).not.toMatch(/Debug Failure/);
  });

  it.each(DECL_EXTS)("planted zz-qa-r15.%s importing a forbidden package (node:child_process) is flagged", (ext) => {
    plant(DIR, `zz-qa-r15-cp.${ext}`, `import type { ChildProcess } from "node:child_process";\nexport type C = ChildProcess;\n`);
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r15-cp\\.${ext.replace(".", "\\.")}: .*child_process`));
  });

  // Edge (exploratory): TypeScript also treats arbitrary-extension declaration files (foo.d.css.ts, TS >= 5.0
  // allowArbitraryExtensions) as declaration files. Recorded as observed behaviour.
  it("edge: planted zz-qa-r15.d.css.ts (arbitrary-extension declaration file) does not crash the lint", () => {
    plant(DIR, "zz-qa-r15-arb.d.css.ts", "declare const s: { [k: string]: string };\nexport default s;\n");
    expect(() => moduleViolations(MOD)).not.toThrow();
  });
});
