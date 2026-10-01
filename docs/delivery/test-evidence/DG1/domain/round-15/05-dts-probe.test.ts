// DG1 round-15 domain-reviewer probe (reviewer-authored evidence; NOT part of the candidate).
// Copied into the disposable clone (commit f27b5a6, candidate 76d8b304) as apps/api/src/zz-dom-r15-probe.test.ts,
// run with vitest on Node 22 and Node 24, then removed. Independent end-to-end check of F-DG1-217 on disk
// (real files planted in src/modules/kpi, linted through the public moduleViolations() entry point):
//  D1 moduleViolations() is [] for every declared module on the real tree (no change in verdict);
//  D2 a planted kpi/zz-dom15.d.ts / .d.mts / .d.cts with a deep cross-module TYPE import is reported (scanned, not skipped)
//     and moduleViolations() does not throw;
//  D3 a planted declaration file importing ../../modules.ts (composition root) is reported;
//  D4 a planted declaration file with a syntax error yields a named 'unparseable source' diagnostic, no 'Debug Failure';
//  D5 a clean declaration file yields no violation, and after removal kpi is back to [].
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { MODULES_DIR, moduleViolations } from "./architecture.testkit.ts";

const KPI = join(MODULES_DIR, "kpi");
const EXTS = ["d.ts", "d.mts", "d.cts"] as const;
const planted: string[] = [];
const plant = (name: string, src: string) => {
  const p = join(KPI, name);
  writeFileSync(p, src);
  planted.push(p);
};
afterEach(() => {
  while (planted.length) rmSync(planted.pop()!, { force: true });
});

describe("DOM-R15 declaration-file (F-DG1-217) probe", () => {
  it("D1 moduleViolations is [] for every module on the real tree", () => {
    const mods = Object.keys(API_MODULES) as ApiModule[];
    console.log("modules checked:", mods.join(", "));
    for (const m of mods) expect(moduleViolations(m), m).toEqual([]);
  });

  for (const ext of EXTS) {
    it(`D2 planted kpi/zz-dom15.${ext} deep TYPE import is reported, no throw`, () => {
      plant(`zz-dom15.${ext}`, `import type { Actor } from "../access/policy.ts";\nexport type A = Actor;\n`);
      let v: string[] = [];
      expect(() => (v = moduleViolations("kpi"))).not.toThrow();
      console.log(ext, "D2:", JSON.stringify(v));
      expect(v.some((s) => s.includes(`zz-dom15.${ext}`) && s.includes("../access/policy.ts"))).toBe(true);
    });

    it(`D3 planted kpi/zz-dom15.${ext} importing the composition root is reported`, () => {
      plant(`zz-dom15.${ext}`, `import type { API_MODULES } from "../../modules.ts";\nexport type M = typeof API_MODULES;\n`);
      const v = moduleViolations("kpi");
      console.log(ext, "D3:", JSON.stringify(v));
      expect(v.some((s) => s.includes(`zz-dom15.${ext}`) && s.includes("modules.ts"))).toBe(true);
    });

    it(`D4 planted broken kpi/zz-dom15.${ext} yields a named unparseable-source diagnostic`, () => {
      plant(`zz-dom15.${ext}`, "export declare const x: = ;\n");
      let v: string[] = [];
      expect(() => (v = moduleViolations("kpi"))).not.toThrow();
      const s = v.join("\n");
      console.log(ext, "D4:", JSON.stringify(v));
      expect(s).toMatch(/unparseable source/);
      expect(s).not.toMatch(/Debug Failure/);
    });

    it(`D5 clean kpi/zz-dom15.${ext} yields no violation; removal restores []`, () => {
      plant(`zz-dom15.${ext}`, "export declare const x: number;\n");
      expect(moduleViolations("kpi")).toEqual([]);
      rmSync(planted.pop()!, { force: true });
      expect(moduleViolations("kpi")).toEqual([]);
    });
  }
});
