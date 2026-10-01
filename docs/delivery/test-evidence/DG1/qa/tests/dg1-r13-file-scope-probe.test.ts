// QA round-13 independent probe for F-DG1-134 (qa-verifier; review-time test, NOT part of the candidate).
// Usage (disposable clone only): cp this file to apps/api/src/ and run
//   npx vitest run --project unit-node apps/api/src/dg1-r13-file-scope-probe.test.ts --reporter=verbose
// Unlike the implementer's self-check (which plants into a mkdtemp dir and calls fileViolations with a synthetic path),
// this probe plants files INTO THE REAL module directory and calls the production entry point moduleViolations(),
// i.e. the exact walk()->readFileSync->fileViolations path that architecture.test.ts uses for the real-tree check.
// Every planted file is removed in afterEach, and the real tree is re-checked as zero afterwards.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MODULES_DIR, moduleFiles, moduleViolations } from "./architecture.testkit.ts";

const MOD = "transformations" as const;
const DIR = join(MODULES_DIR, MOD);
const NESTED = join(DIR, "zz-qa-r13-nested");
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

const EXTS = ["mts", "cts", "js", "jsx", "mjs", "cjs", "ts", "tsx"] as const;

describe("QA r13 F-DG1-134: real-tree moduleViolations() lints every buildable extension", () => {
  it("baseline: the real module tree is zero and contains only .ts files", () => {
    expect(moduleViolations(MOD)).toEqual([]);
    expect(moduleFiles(MOD).every((f) => f.endsWith(".ts"))).toBe(true);
  });

  it.each(EXTS)("a planted zz-qa-r13.%s with a deep import + vm require is flagged", (ext) => {
    plant(DIR, `zz-qa-r13.${ext}`, `import { authorize } from "../access/policy.ts";\nexport const a = authorize;`);
    plant(NESTED, `zz-qa-r13-b.${ext}`, `const vm = require("node:vm");\nmodule.exports = vm;`);
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r13\\.${ext}: imports \\.\\./access/policy\\.ts; only access/index\\.ts is public`));
    expect(v).toMatch(new RegExp(`zz-qa-r13-b\\.${ext}: imports non-allow-listed node built-in node:vm`));
  });

  it.each(EXTS)("a planted .%s using a rule-3 process member and rule-5 crypto namespace is flagged", (ext) => {
    plant(DIR, `zz-qa-r13-p.${ext}`, `import * as c from "node:crypto";\nexport const k = process.kill; export const z = c;`);
    const v = moduleViolations(MOD);
    expect(v.length, v.join("\n")).toBeGreaterThanOrEqual(2);
    expect(v.join("\n")).toMatch(/namespace\/default binding/);
    expect(v.join("\n")).toMatch(/process\.kill/);
  });

  it("cross-module import of a non-.ts public index (../access/index.mts) is still rejected", () => {
    plant(DIR, "zz-qa-r13-i.mts", `export * from "../access/index.mts";`);
    expect(moduleViolations(MOD).join("\n")).toMatch(/only access\/index\.ts is public/);
  });

  it("a .test.mts in a module may use vitest (test allowance) but a non-test .mts may not", () => {
    plant(DIR, "zz-qa-r13.test.mts", `import { it } from "vitest";\nit("x", () => {});`);
    expect(moduleViolations(MOD)).toEqual([]);
    plant(DIR, "zz-qa-r13-v.mts", `import { it } from "vitest";\nexport const t = it;`);
    expect(moduleViolations(MOD).join("\n")).toMatch(/imports package vitest/);
  });

  it("non-code files (.json/.md/.map/.d.ts.map) are not walked and add no violation", () => {
    for (const n of ["zz-qa-r13.json", "zz-qa-r13.md", "zz-qa-r13.mts.map"]) plant(DIR, n, "{}");
    expect(moduleViolations(MOD)).toEqual([]);
    expect(moduleFiles(MOD).some((f) => f.startsWith("zz-qa-r13"))).toBe(false);
  });

  it("cleanup: after the probes the real module tree is zero again and has no planted file", () => {
    expect(readdirSync(DIR).some((n) => n.startsWith("zz-qa-r13"))).toBe(false);
    expect(moduleViolations(MOD)).toEqual([]);
  });
});
