// DG1 round-13 domain-reviewer probe (reviewer-authored evidence; NOT part of the candidate).
// Copied into the disposable clone (commit 08cbd12, candidate 00f1498c) as apps/api/src/zz-dom-r13-probe.test.ts,
// run with vitest on Node 22 and Node 24, then removed. It checks the F-DG1-134 fix independently:
//  P1 the real module tree contains no module file outside .ts/.tsx (inventory by extension, via readdir, not walk());
//  P2 walk() over the real tree returns exactly the .ts/.tsx inventory (the broader regex changes nothing for it);
//  P3 moduleViolations() is [] for every declared module (the verdict on the real tree is unchanged);
//  P4 a file PLANTED IN A REAL MODULE DIRECTORY with each non-.ts code extension (.mts .cts .mjs .cjs .js .jsx)
//     is now picked up by moduleViolations("transformations") with the rule-5 and deep-import violations; after removal
//     the module is back to [];
//  P5 non-code files planted there (.json .md .sql .map) are still ignored;
//  P6 (observation, first run showed it) a declaration file (.d.ts — matched by the OLD regex too — or .d.mts) makes
//     moduleViolations THROW from ts.transpileModule ("Output generation failed"): the lint fails CLOSED (the
//     architecture suite would go red), it does not pass the file silently. Recorded to show the behaviour is
//     pre-existing for .d.ts and not an evasion.
import { readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES } from "./modules.ts";
import { MODULES_DIR, moduleViolations, walk } from "./architecture.testkit.ts";

const inventory = (dir: string): string[] =>
  readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? inventory(p) : [p];
  });

const EVASIVE = [
  `import * as c from "node:crypto";`,
  `import { authorize } from "../access/policy.ts";`,
  `export const f = new Map(Object.entries(c)).get("set".concat("Engine"));`,
  `export const g = typeof authorize;`,
].join("\n");

describe("DOM-R13 walk() scope probe", () => {
  it("P1 the real module tree has 0 non-.ts/.tsx files", () => {
    const all = inventory(MODULES_DIR);
    const byExt: Record<string, number> = {};
    for (const f of all) byExt[extname(f)] = (byExt[extname(f)] ?? 0) + 1;
    console.log("module-tree inventory by extension:", JSON.stringify(byExt), "total", all.length);
    expect(all.filter((f) => !/\.(ts|tsx)$/.test(f))).toEqual([]);
  });

  it("P2 walk(MODULES_DIR) equals the .ts/.tsx inventory exactly", () => {
    const inv = inventory(MODULES_DIR).filter((f) => /\.(ts|tsx)$/.test(f)).sort();
    expect(walk(MODULES_DIR).sort()).toEqual(inv);
    console.log("walk() files:", inv.length);
  });

  it("P3 moduleViolations is [] for every declared module", () => {
    const mods = Object.keys(API_MODULES) as (keyof typeof API_MODULES)[];
    const res = Object.fromEntries(mods.map((m) => [m, moduleViolations(m)]));
    console.log("modules:", mods.length, mods.join(","));
    for (const m of mods) expect(res[m], m).toEqual([]);
  });

  for (const name of ["zz-dom.mts", "zz-dom.cts", "zz-dom.mjs", "zz-dom.cjs", "zz-dom.js", "zz-dom.jsx"]) {
    it(`P4 planted ${name} in modules/transformations is linted, and removal restores []`, () => {
      const p = join(MODULES_DIR, "transformations", name);
      writeFileSync(p, EVASIVE);
      let v: string[];
      try {
        v = moduleViolations("transformations");
      } finally {
        rmSync(p, { force: true });
      }
      console.log(name, "->", v.length, "violations");
      expect(v.join("\n")).toMatch(
        new RegExp(`transformations/${name.replace(/\./g, "\\.")}: .*node:crypto namespace/default binding`),
      );
      expect(v.join("\n")).toMatch(/only access\/index\.ts is public/);
      expect(moduleViolations("transformations")).toEqual([]);
    });
  }

  it("P5 non-code files in a module dir are still ignored", () => {
    const names = ["zz-dom.json", "zz-dom.md", "zz-dom.sql", "zz-dom.mts.map"];
    for (const n of names) writeFileSync(join(MODULES_DIR, "transformations", n), EVASIVE);
    try {
      expect(moduleViolations("transformations")).toEqual([]);
    } finally {
      for (const n of names) rmSync(join(MODULES_DIR, "transformations", n), { force: true });
    }
  });

  for (const [name, src] of [
    ["zz-dom.d.ts", "export declare const x: number;"],
    ["zz-dom.d.mts", "export declare const x: number;"],
    ["zz-dom.d.mts", EVASIVE],
  ] as const) {
    it(`P6 declaration file ${name} (${src === EVASIVE ? "evasive body" : "valid declaration"}) -> lint fails closed (throws)`, () => {
      const p = join(MODULES_DIR, "transformations", name);
      writeFileSync(p, src);
      let threw = "";
      try {
        moduleViolations("transformations");
      } catch (e) {
        threw = String((e as Error).message);
      } finally {
        rmSync(p, { force: true });
      }
      console.log(name, "-> threw:", threw || "<no throw>");
      expect(threw).toMatch(/Output generation failed/);
      expect(moduleViolations("transformations")).toEqual([]);
    });
  }
});
