// DG1 round-11 domain-reviewer probe (reviewer-authored, NOT part of the candidate; copied into a disposable clone as
// apps/api/src/zz-dom-r11-probe.test.ts and run there). Purpose: check D-055's wording that the default-deny
// "structurally closes the module-IMPORT and process-MEMBER loader/exec classes" against spelled syntactic forms,
// and record which forms fall to the stated residual (a) runtime data-flow.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const run = (src: string) => fileViolations("transformations", join(MODULES_DIR, "transformations", "zz.ts"), src);
const cases: Array<[string, string]> = [
  ["P1 process.kill", `process.kill(process.pid, "SIGUSR1");`],
  ["P2 destructure const {kill} = process", `const { kill } = process; kill(1, "SIGUSR1");`],
  ["P3 globalThis.process.kill", `globalThis.process.kill(1, "SIGUSR1");`],
  ["P4 process['_debugProcess'] literal key", `process["_debugProcess"](1);`],
  ["P5 alias const p = process; p.kill", `const p = process; p.kill(1, "SIGUSR1");`],
  ["P6 Reflect.get(process, built key)", `(Reflect.get(process, "ki" + "ll") as any)(1);`],
  ["P7 Object.values(process).find", `(Object.entries(process).find(([k]) => k.startsWith("_debug"))![1] as any)(1);`],
  ["M1 import node:child_process", `import { exec } from "node:child_process"; exec("id");`],
  ["M2 dynamic import literal node:vm", `await import("node:vm");`],
  ["M3 require-less createRequire via node:module", `import { createRequire } from "node:module";`],
  ["OK1 process.env read (allowed)", `const x = process.env.FOO;`],
  ["OK2 node:crypto randomUUID (allowed)", `import { randomUUID } from "node:crypto"; randomUUID();`],
];
describe("dom-r11 process/module form probe", () => {
  it.each(cases)("%s", (name, src) => {
    const v = run(src);
    console.log(`${name} => ${v.length} violation(s)${v.length ? ": " + v[0] : ""}`);
    expect(Array.isArray(v)).toBe(true);
  });
});
