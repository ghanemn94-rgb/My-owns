// DG1 round-14 domain-reviewer probe (reviewer-authored evidence; NOT part of the candidate).
// Copied into the disposable clone (commit 985d0fa, candidate dd747fe1) as apps/api/src/zz-dom-r14-probe.test.ts,
// run with vitest on Node 22 and Node 24, then removed. It checks the F-DG1-135 fix independently, end to end on disk:
//  Q1 every real module test file is *.test.ts (inventory by readdir, not walk());
//  Q2 moduleViolations() is [] for every declared module (verdict on the real tree unchanged);
//  Q3 real module test files that import vitest still get the allowance (none of them appears in a violation);
//  Q4 a PLANTED kpi/zz-dom14.test.mts importing vitest and ../../modules.ts is reported by moduleViolations("kpi");
//     the same content as kpi/zz-dom14.test.ts is not; after removal kpi is back to [];
//  Q5 the same holds for .test.js / .test.cts / .test.mjs / .test.cjs / .test.jsx.
// (v2: the first run failed Q2 only because of a probe bug - API_MODULES is an object keyed by module, not an array.)
import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { MODULES_DIR, moduleViolations } from "./architecture.testkit.ts";

const inventory = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? inventory(p) : [p];
  });

const SRC = `import { it } from "vitest";\nimport { API_MODULES } from "../../modules.ts";\nexport const t = [it, API_MODULES];\n`;

describe("DOM-R14 test-classification probe", () => {
  it("Q1 every real module test file is .test.ts", () => {
    const tests = inventory(MODULES_DIR).filter((f) => /\.test\./.test(f));
    console.log("real module test files:", tests.map((f) => f.slice(MODULES_DIR.length + 1)).join(", "));
    expect(tests.length).toBeGreaterThan(0);
    expect(tests.filter((f) => !f.endsWith(".test.ts"))).toEqual([]);
  });

  it("Q2/Q3 moduleViolations is [] for every module; real tests importing vitest keep their allowance", () => {
    const mods = Object.keys(API_MODULES) as ApiModule[];
    console.log("modules checked:", mods.join(", "));
    for (const m of mods) expect(moduleViolations(m), m).toEqual([]);
    const vitestUsers = inventory(MODULES_DIR).filter(
      (f) => f.endsWith(".test.ts") && /from "vitest"/.test(readFileSync(f, "utf8")),
    );
    console.log("real module tests importing vitest:", vitestUsers.length);
    expect(vitestUsers.length).toBeGreaterThan(0);
  });

  for (const ext of ["mts", "js", "cts", "mjs", "cjs", "jsx"]) {
    it(`Q4/Q5 planted kpi/zz-dom14.test.${ext} is a violation; .test.ts with same content is not`, () => {
      const bad = join(MODULES_DIR, "kpi", `zz-dom14.test.${ext}`);
      const ok = join(MODULES_DIR, "kpi", "zz-dom14.test.ts");
      try {
        writeFileSync(bad, SRC);
        const v = moduleViolations("kpi");
        console.log(`.test.${ext} ->`, JSON.stringify(v));
        expect(v.join("\n")).toMatch(/zz-dom14\.test\.\w+: imports package vitest/);
        expect(v.join("\n")).toMatch(/zz-dom14\.test\.\w+: imports \.\.\/\.\.\/modules\.ts outside src\/modules/);
        rmSync(bad);
        writeFileSync(ok, SRC);
        expect(moduleViolations("kpi")).toEqual([]);
      } finally {
        rmSync(bad, { force: true });
        rmSync(ok, { force: true });
      }
      expect(moduleViolations("kpi")).toEqual([]);
    });
  }
});
