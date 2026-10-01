// QA round-14 independent probe for F-DG1-135 (qa-verifier; review-time test, NOT part of the candidate).
// Usage (disposable clone only): cp this file to apps/api/src/ and run
//   npx vitest run --project unit-node apps/api/src/dg1-r14-test-classification-probe.test.ts --reporter=verbose
// It plants files INTO THE REAL module directory and calls the production entry point moduleViolations() (the same
// walk()->readFileSync->fileViolations path architecture.test.ts uses for the real-tree check), not a synthetic path.
// Every planted file is removed in afterEach, and the real tree is re-checked as zero afterwards.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { MODULES_DIR, fileViolations, moduleFiles, moduleViolations } from "./architecture.testkit.ts";

const MOD = "transformations" as const;
const DIR = join(MODULES_DIR, MOD);
const NESTED = join(DIR, "zz-qa-r14-nested");
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

const VITEST = `import { it } from "vitest";\nexport const t = it;`;
const MODULES_MAP = `import { API_MODULES } from "../../modules.ts";\nexport const m = API_MODULES;`;
const TESTKIT = `import { walk } from "../../architecture.testkit.ts";\nexport const w = walk;`;
const NON_TEST_EXTS = ["mts", "cts", "js", "jsx", "mjs", "cjs"] as const;

describe("QA r14 F-DG1-135: only build-excluded *.test.ts/*.test.tsx get the test allowance (real tree)", () => {
  it("baseline: the real module tree is zero and every real test file is *.test.ts", () => {
    expect(moduleViolations(MOD)).toEqual([]);
    const tests = moduleFiles(MOD).filter((f) => /\.test\./.test(f));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.every((f) => f.endsWith(".test.ts")), tests.join(",")).toBe(true);
  });

  it.each(NON_TEST_EXTS)("planted zz-qa-r14.test.%s importing vitest / modules.ts / testkit is flagged (non-test)", (ext) => {
    plant(DIR, `zz-qa-r14-v.test.${ext}`, VITEST);
    plant(DIR, `zz-qa-r14-m.test.${ext}`, MODULES_MAP);
    plant(NESTED, `zz-qa-r14-k.test.${ext}`, TESTKIT.replace("../../", "../../../"));
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(new RegExp(`zz-qa-r14-v\\.test\\.${ext}: imports package vitest`));
    expect(v).toMatch(new RegExp(`zz-qa-r14-m\\.test\\.${ext}: imports \\.\\./\\.\\./modules\\.ts outside src/modules`));
    expect(v).toMatch(new RegExp(`zz-qa-r14-k\\.test\\.${ext}: imports .*architecture\\.testkit\\.ts outside src/modules`));
  });

  it.each(NON_TEST_EXTS)("planted zz-qa-r14.test.%s still gets rules 1-5 (process member, crypto namespace)", (ext) => {
    plant(DIR, `zz-qa-r14-p.test.${ext}`, `import * as c from "node:crypto";\nexport const k = process.kill; export const z = c;`);
    const v = moduleViolations(MOD).join("\n");
    expect(v).toMatch(/process\.kill/);
    expect(v).toMatch(/namespace\/default binding/);
  });

  it.each(["ts", "tsx"] as const)("planted zz-qa-r14.test.%s importing vitest / modules.ts / testkit is allowed", (ext) => {
    plant(DIR, `zz-qa-r14-v.test.${ext}`, VITEST);
    plant(DIR, `zz-qa-r14-m.test.${ext}`, MODULES_MAP);
    plant(DIR, `zz-qa-r14-k.test.${ext}`, TESTKIT);
    expect(moduleViolations(MOD)).toEqual([]);
  });

  it.each(["ts", "tsx"] as const)("a real-test file *.test.%s still gets the boundary rules for everything else", (ext) => {
    plant(DIR, `zz-qa-r14-x.test.${ext}`, `import { authorize } from "../access/policy.ts";\nexport const a = authorize;`);
    expect(moduleViolations(MOD).join("\n")).toMatch(/only access\/index\.ts is public/);
  });

  it("near-miss names are NOT tests: .test.ts.mts, .TEST.ts, test.ts (no dot), .tests.ts, .test.mts", () => {
    for (const name of ["zz.test.ts.mts", "zz.TEST.ts", "zztest.ts", "zz.tests.ts", "zz.test.mts"])
      expect(fileViolations(MOD, join(DIR, name), VITEST), name).toEqual([
        `modules/${MOD}/${name}: imports package vitest`,
      ]);
  });

  // QA r14 observation (pre-existing since r5, outside F-DG1-135): a declaration-file name makes ts.transpileModule
  // in syntaxErrors() throw "Debug Failure. Output generation failed" - fail-closed (the lint crashes red), but an
  // opaque crash instead of a diagnostic. Pinned here so the behaviour is recorded, not asserted as desirable.
  it.each(["zz.d.ts", "zz.d.mts", "zz.test.d.ts"])("OBSERVATION: fileViolations on %s throws (fail-closed crash)", (name) => {
    expect(() => fileViolations(MOD, join(DIR, name), `export declare const x: number;`)).toThrow(/Debug Failure/);
  });

  it("cleanup: after the probes the real module tree is zero again and has no planted file", () => {
    expect(readdirSync(DIR).some((n) => n.startsWith("zz-qa-r14"))).toBe(false);
    expect(moduleViolations(MOD)).toEqual([]);
  });
});
