// DG1 round-16 domain-reviewer probe (reviewer-authored evidence; NOT part of the candidate).
// Copied into the disposable clone (commit 13418b8, candidate 56f3eb88) as apps/api/src/zz-dom-r16-probe.test.ts,
// run with vitest on Node 22 and Node 24, then removed. Independent end-to-end check of F-DG1-137 / F-DG1-218 on disk
// (real files planted in src/modules/kpi, linted through the public moduleViolations() entry point, which uses walk()):
//  D1 moduleViolations() is [] for every declared module on the real tree (no change in verdict);
//  D2 a planted kpi/zz-dom16.<form> with a deep cross-module TYPE import is REPORTED (scanned, not skipped), no throw;
//  D3 a planted declaration file importing ../../modules.ts (composition root) is reported;
//  D4 a planted broken declaration file yields a named 'unparseable source' diagnostic naming the file, no 'Debug Failure';
//  D5 a clean declaration file yields no violation, and after removal kpi is back to [];
//  D6 a NON-declaration look-alike (zz-dom16.dx.ts, zz-dom16.d.tsx is not collected? -> checked as ordinary code) with a
//     deep import is still reported (no over-broad bypass).
// Forms: the classic .d.ts/.d.mts/.d.cts plus allowArbitraryExtensions .d.css.ts/.d.json.ts/.d.ts.ts/.d.html.ts.
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { MODULES_DIR, moduleViolations } from "./architecture.testkit.ts";

const KPI = join(MODULES_DIR, "kpi");
const FORMS = ["d.ts", "d.mts", "d.cts", "d.css.ts", "d.json.ts", "d.ts.ts", "d.html.ts"] as const;
const planted: string[] = [];
const plant = (name: string, src: string) => {
  const p = join(KPI, name);
  writeFileSync(p, src);
  planted.push(p);
};
afterEach(() => {
  while (planted.length) rmSync(planted.pop()!, { force: true });
});

describe("DOM-R16 arbitrary-extension declaration-file (F-DG1-137/218) probe", () => {
  it("D1 moduleViolations is [] for every module on the real tree", () => {
    const mods = Object.keys(API_MODULES) as ApiModule[];
    console.log("modules checked:", mods.join(", "));
    for (const m of mods) expect(moduleViolations(m), m).toEqual([]);
  });

  for (const ext of FORMS) {
    const name = `zz-dom16.${ext}`;
    it(`D2 planted kpi/${name} deep TYPE import is reported, no throw`, () => {
      plant(name, `import type { Actor } from "../access/policy.ts";\nexport type A = Actor;\n`);
      let v: string[] = [];
      expect(() => (v = moduleViolations("kpi"))).not.toThrow();
      console.log(ext, "D2:", JSON.stringify(v));
      expect(v.some((s) => s.includes(name) && s.includes("../access/policy.ts"))).toBe(true);
    });

    it(`D3 planted kpi/${name} importing the composition root is reported`, () => {
      plant(name, `import type { API_MODULES } from "../../modules.ts";\nexport type M = typeof API_MODULES;\n`);
      let v: string[] = [];
      expect(() => (v = moduleViolations("kpi"))).not.toThrow();
      console.log(ext, "D3:", JSON.stringify(v));
      expect(v.some((s) => s.includes(name) && s.includes("modules.ts"))).toBe(true);
    });

    it(`D4 planted broken kpi/${name} yields a named unparseable-source diagnostic`, () => {
      plant(name, "export declare const x: = ;\n");
      let v: string[] = [];
      expect(() => (v = moduleViolations("kpi"))).not.toThrow();
      const s = v.join("\n");
      console.log(ext, "D4:", JSON.stringify(v));
      expect(s).toMatch(new RegExp(`${name.replace(/\./g, "\\.")}: unparseable source`));
      expect(s).not.toMatch(/Debug Failure/);
    });

    it(`D5 clean kpi/${name} yields no violation; removal restores []`, () => {
      plant(name, "export declare const x: number;\n");
      expect(moduleViolations("kpi")).toEqual([]);
      rmSync(planted.pop()!, { force: true });
      expect(moduleViolations("kpi")).toEqual([]);
    });
  }

  it("D6 a non-declaration look-alike (zz-dom16.dx.ts) with a deep import is still reported", () => {
    plant("zz-dom16.dx.ts", `import { x } from "../access/policy.ts";\nexport const y = x;\n`);
    const v = moduleViolations("kpi");
    console.log("D6:", JSON.stringify(v));
    expect(v.some((s) => s.includes("zz-dom16.dx.ts") && s.includes("../access/policy.ts"))).toBe(true);
  });
});
