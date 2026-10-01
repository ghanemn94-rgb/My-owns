// QA round-7 independent probe for F-DG1-127 (qa-verifier, T-DG1-REV-QA-R7). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with: pnpm vitest run --project unit-node apps/api/src/<this file>
// Each planted source is checked through the candidate's own fileViolations() as if it lived in
// src/modules/transformations/zz-qa-planted.ts. Expected: every syntactic route to the sqlite built-in (bare or node:)
// is a specifier violation; the previously closed routes (process, vm, module) remain closed; benign built-ins stay clean.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bareAllowed, fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);

describe("QA r7 F-DG1-127: sqlite-module import routes", () => {
  const caught: [string, string, RegExp][] = [
    ["S1 named import node:sqlite", `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/x.so");`, /node:sqlite/],
    ["S2 bare 'sqlite' named import", `import { DatabaseSync } from "sqlite";\nnew DatabaseSync(":memory:");`, /imports package sqlite/],
    ["S3 namespace import node:sqlite", `import * as s from "node:sqlite";\nnew s.DatabaseSync(":memory:");`, /node:sqlite/],
    ["S4 default import node:sqlite", `import s from "node:sqlite";\n(s as any).DatabaseSync;`, /node:sqlite/],
    ["S5 require('node:sqlite')", `const s = require("node:sqlite");\nnew s.DatabaseSync(":memory:");`, /node:sqlite/],
    ["S6 dynamic import('node:sqlite')", `const s = await import("node:sqlite");\nnew s.DatabaseSync(":memory:");`, /node:sqlite/],
    ["S7 re-export from node:sqlite", `export { DatabaseSync } from "node:sqlite";`, /node:sqlite/],
    ["S8 TS import-equals require", `import s = require("node:sqlite");\n(s as any).DatabaseSync;`, /node:sqlite/],
    ["S9 side-effect import", `import "node:sqlite";`, /node:sqlite/],
    ["S10 type-only import is still a specifier", `import type { DatabaseSync } from "node:sqlite";\nexport type D = DatabaseSync;`, /node:sqlite/],
    ["S11 export * from sqlite", `export * from "sqlite";`, /sqlite/],
    ["R1 regression: node:process still banned", `import { dlopen } from "node:process";`, /node:process/],
    ["R2 regression: node:vm still banned", `import vm from "node:vm";`, /node:vm/],
    ["R3 regression: global process.dlopen (rule 3)", `(process as any).dlopen({}, "/x.node");`, /process\.dlopen/],
  ];
  for (const [name, src, re] of caught) {
    it(`${name} is reported`, () => {
      const out = v(src);
      expect(out.join("\n"), JSON.stringify(out)).toMatch(re);
    });
  }

  it("bareAllowed() rejects sqlite and node:sqlite", () => {
    expect(bareAllowed("sqlite")).toBe(false);
    expect(bareAllowed("node:sqlite")).toBe(false);
  });

  it("C1 control: benign node: built-ins and process.env stay clean", () => {
    expect(v(`import { randomUUID } from "node:crypto";\nimport { join } from "node:path";\nconst id = randomUUID() + join("a", "b");\nconst tz = process.env.TZ;`)).toEqual([]);
  });
});
