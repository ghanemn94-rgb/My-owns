// QA round-6 independent probe for F-DG1-125 (qa-verifier, T-DG1-REV-QA-R6). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with: pnpm vitest run --project unit-node apps/api/src/<this file>
// Each planted source is checked through the candidate's own fileViolations() as if it lived in
// src/modules/transformations/zz-qa-planted.ts. Expected: every route to the process object other than the global
// identifier is a specifier violation; the global form is still caught by rule 3; benign node: built-ins stay clean.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);

describe("QA r6 F-DG1-125: process-module import routes", () => {
  const caught: [string, string, RegExp][] = [
    ["Q1 namespace import node:process", `import * as p from "node:process";\np.dlopen({} as any, "/x.node");`, /node:process/],
    ["Q2 bare 'process' default import", `import p from "process";\n(p as any).binding("fs");`, /imports package process/],
    ["Q3 bare 'process' named import", `import { dlopen } from "process";\ndlopen({} as any, "/x.node");`, /imports package process/],
    ["Q4 require('node:process')", `const p = require("node:process");\np.binding("fs");`, /node:process/],
    ["Q5 dynamic import('node:process')", `const p = await import("node:process");\n(p as any).binding("fs");`, /node:process/],
    ["Q6 re-export from node:process", `export { dlopen } from "node:process";`, /node:process/],
    ["Q7 TS import-equals require", `import p = require("node:process");\n(p as any).binding("fs");`, /node:process/],
    ["Q8 side-effect import", `import "node:process";`, /node:process/],
    ["Q9 _linkedBinding via named import", `import { _linkedBinding } from "node:process";\n(_linkedBinding as any)("x");`, /node:process/],
    ["Q10 global process.dlopen (rule 3)", `(process as any).dlopen({}, "/x.node");`, /process\.dlopen/],
    ["Q11 global process._linkedBinding (rule 3)", `(process as any)._linkedBinding("x");`, /process\._linkedBinding/],
  ];
  for (const [name, src, re] of caught) {
    it(`${name} is reported`, () => {
      const out = v(src);
      expect(out.join("\n"), JSON.stringify(out)).toMatch(re);
    });
  }

  it("Q12 control: benign node: built-ins and global process.env stay clean", () => {
    expect(v(`import { randomUUID } from "node:crypto";\nconst id = randomUUID();\nconst tz = process.env.TZ;`)).toEqual([]);
  });
});
