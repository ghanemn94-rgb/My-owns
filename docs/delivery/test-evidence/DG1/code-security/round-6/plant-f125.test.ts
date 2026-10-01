// F-DG1-125 re-test (code-security-reviewer, DG1 round 6). Copied into a DISPOSABLE clone at
// apps/api/src/zz-plant-f125-r6.test.ts and run with the candidate's own vitest project (unit-node). Not part of the
// candidate. Each probe is planted as src/modules/transformations/planted.ts through the candidate's fileViolations().
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bareAllowed, fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const plant = (source: string) =>
  fileViolations("transformations", join(MODULES_DIR, "transformations", "planted.ts"), source);

describe("bareAllowed on the process specifiers", () => {
  it.each(["process", "node:process"])("%s -> false", (s) => {
    console.log(`[bareAllowed] ${s} = ${bareAllowed(s)}`);
    expect(bareAllowed(s)).toBe(false);
  });
  it("control: an ordinary built-in stays allowed", () => {
    expect(bareAllowed("node:crypto")).toBe(true);
  });
});

describe("F-DG1-125 required plants (assignment): every form must be a process-specifier violation", () => {
  const probes: [string, string][] = [
    ["R1 default import .dlopen", `import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["R2 default import (proc as any).binding", `import proc from "node:process";\nconst fsb = (proc as any).binding("fs");`],
    ["R3 named import dlopen", `import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["R4 namespace import .dlopen", `import * as proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["R5 import-equals require", `import x = require("node:process");\nx.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["R6 await import()", `const p = await import("node:process");\np.default.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    // bare `process` specifier (without node:) in the same forms
    ["R7 bare 'process' default import", `import proc from "process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["R8 bare 'process' named binding", `import { binding } from "process";\nbinding("fs");`],
    ["R9 bare 'process' dynamic import", `const p = await import("process");`],
  ];
  it.each(probes)("%s", (n, src) => {
    const v = plant(src);
    console.log(`[required] ${n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
    expect(v.some((m) => /imports package (node:)?process\b/.test(m)), `${n} is not a process-specifier violation`).toBe(
      true,
    );
  });
});

describe("reviewer extra probes (other spellings of the same route)", () => {
  const probes: [string, string][] = [
    ["E1 re-export * from node:process", `export * from "node:process";`],
    ["E2 re-export { dlopen } from node:process", `export { dlopen } from "node:process";`],
    ["E3 import { default as p }", `import { default as p } from "node:process";\np.dlopen({} as any, "x");`],
    ["E4 template-literal dynamic import", "const p = await import(`node:process`);"],
    ["E5 type-only import (erased, still flagged by specifier)", `import type P from "node:process";\nexport type Q = typeof P;`],
    ["E6 import attributes", `import proc from "node:process" with { type: "js" };\nproc.dlopen({} as any, "x");`],
    ["E7 side-effect import", `import "node:process";`],
  ];
  it.each(probes)("%s", (n, src) => {
    const v = plant(src);
    console.log(`[extra] ${n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
    expect(v.length, `${n} is not flagged`).toBeGreaterThan(0);
  });
});

describe("global-process controls (rule 3 unchanged) and legal uses", () => {
  it.each([
    ["G1 P12 global process.binding", `const b = (process as any).binding("fs");`],
    ["G2 global process.dlopen", `process.dlopen({ exports: {} } as any, "/tmp/x.node");`],
    ["G3 global process._linkedBinding", `(process as any)._linkedBinding("x");`],
    ["G4 alias of the global", `const p = process;\np.dlopen({} as any, "x");`],
    ["G5 globalThis.process", `globalThis.process.dlopen({} as any, "x");`],
    ["G6 destructured dlopen from global", `const { dlopen } = process;`],
  ])("%s is a violation", (n, src) => {
    const v = plant(src);
    console.log(`[global] ${n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
    expect(v.length).toBeGreaterThan(0);
  });
  it("L1 ordinary global process.env read stays legal", () => {
    const v = plant(`export const tz = process.env.TZ ?? "Asia/Riyadh";`);
    console.log(`[legal] L1: ${JSON.stringify(v)}`);
    expect(v).toEqual([]);
  });
});

// Adjacent native-code routes not named by F-DG1-125: recorded (console) and NOT asserted, so the run reports what the
// lint does. Assessed in the review narrative.
describe("adjacent routes (recorded only)", () => {
  it.each([
    [
      "A1 node:sqlite loadExtension (native shared-library load)",
      `import { DatabaseSync } from "node:sqlite";\nconst db = new DatabaseSync(":memory:", { allowExtension: true });\ndb.loadExtension("/tmp/x.so");`,
    ],
    [
      "A2 node:fs write then literal relative import inside own module",
      `import { writeFileSync } from "node:fs";\nwriteFileSync(new URL("./gen.mjs", import.meta.url), "export default 1");\nawait import("./gen.mjs");`,
    ],
  ])("%s", (n, src) => {
    const v = plant(src);
    console.log(`[adjacent] ${n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
  });
});
