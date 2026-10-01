// DG1 round-3 code-security plant for F-DG1-117 (module dependency-lint, obfuscated loaders).
// Copied by plant-f117.sh into a DISPOSABLE clone as apps/api/src/zz-plant-f117.test.ts (never into the candidate).
// Each planted source lives (virtually) in src/modules/access/ and reaches module `transformations` internals,
// which access may not import. A case "is caught" when fileViolations() reports at least one violation.
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { fileViolations as current } from "./architecture.testkit.ts";
import { fileViolations as round2 } from "./architecture.testkit.round2.ts";

const SRC = dirname(fileURLToPath(import.meta.url));
const FILE = join(SRC, "modules/access/zz-planted.ts");
const T = `"../transformations/routes.ts"`;

const fixed: Record<string, string> = {
  "getBuiltinModule computed member": `const m = (process as any)["get" + "BuiltinModule"]("module"); m.createRequire(import.meta.url)(${T});`,
  "getBuiltinModule direct": `const m = process.getBuiltinModule("module"); m.createRequire(import.meta.url)(${T});`,
  "new Function": `await new Function("s", "return import(s)")(${T});`,
  "process alias": `const p = process; const m = (p as any)["getBuiltin" + "Module"]("module");`,
  "globalThis computed": `const m = (globalThis as any)["pro" + "cess"].getBuiltinModule("module");`,
};
const residual: Record<string, string> = {
  "constructor via alias (AsyncFunction)": `const C = (async () => {}).constructor as any; await C("s", "return import(s)")(${T});`,
  "constructor via destructuring": `const { constructor: F } = (async () => {}) as any; await F("s", "return import(s)")(${T});`,
  "constructor via Reflect.construct": `const f = Reflect.construct((async () => {}).constructor, ["s", "return import(s)"]); await f(${T});`,
  "constructor via getPrototypeOf": `const AF = Object.getPrototypeOf(async function () {}).constructor; await AF("s", "return import(s)")(${T});`,
};

describe("F-DG1-117 plants", () => {
  for (const [name, src] of Object.entries(fixed)) {
    it(`FIXED form is caught now: ${name}`, () => {
      const v = current("access", FILE, src);
      console.log(`[current] ${name}: ${v.length} violation(s) ${JSON.stringify(v)}`);
      expect(v.length).toBeGreaterThan(0);
    });
    it(`FIXED form was missed by the round-2 lint (fail-before): ${name}`, () => {
      const v = round2("access", FILE, src);
      console.log(`[round2] ${name}: ${v.length} violation(s) ${JSON.stringify(v)}`);
      expect(v.length).toBe(0);
    });
  }
  for (const [name, src] of Object.entries(residual)) {
    it(`RESIDUAL probe (records the outcome; passes either way): ${name}`, () => {
      const v = current("access", FILE, src);
      console.log(`[current] RESIDUAL ${name}: ${v.length === 0 ? "MISSED" : "caught"} ${JSON.stringify(v)}`);
      expect(Array.isArray(v)).toBe(true);
    });
  }
});
