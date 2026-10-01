// F-DG1-124 re-test (code-security-reviewer, DG1 round 5). Copied into a DISPOSABLE clone at
// apps/api/src/zz-plant-f124-r5.test.ts and run with the candidate's own vitest project (unit-node). Not part of the
// candidate. Each probe is planted as src/modules/transformations/planted.ts through the candidate's fileViolations().
// It records what the lint does; the expectations below are the lint's DOCUMENTED claims (architecture.testkit.ts
// header: rules 1-4 "remove every syntactic route inside module source"; rule 3 bans the native loaders
// process.binding / process._linkedBinding / process.dlopen).
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const plant = (source: string) =>
  fileViolations("transformations", join(MODULES_DIR, "transformations", "planted.ts"), source);

describe("F-DG1-124 required plants (assignment): must be violations", () => {
  it.each([
    [
      'R1 f["constr"+"uctor"]',
      `const f = async () => {};\nconst F = (f as any)["constr" + "uctor"];\nF("s", "return import(s)")("../access/policy.ts");`,
    ],
    [
      'R2 Reflect.get(fn,"constructor")',
      `const fn = async () => {};\nconst F = Reflect.get(fn, "constructor");\nF("s", "return import(s)")("../access/policy.ts");`,
    ],
    [
      'R3 Reflect.get(fn, "constr".concat("uctor"))',
      `const fn = async () => {};\nconst F = Reflect.get(fn, "constr".concat("uctor"));`,
    ],
  ])("%s", (_n, src) => {
    const v = plant(src);
    console.log(`[required] ${_n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
    expect(v.length).toBeGreaterThan(0);
  });
});

describe("reviewer probes of the blanket ban (recorded, then asserted against the documented claim)", () => {
  const probes: [string, string][] = [
    ["X1 unicode-escaped identifier Fun\\u0063tion", "const F = Fun\\u0063tion;\nF('return 1');"],
    ["X2 unicode-escaped member .constr\\u0075ctor", "const C = (async () => {}).constr\\u0075ctor;"],
    ["X3 escaped string key", 'const C = (async () => {} as any)["constr\\u0075ctor"];'],
    ["X4 tagged template String.raw`constructor`", "const k = String.raw`constructor`;"],
    ["X5 globalThis destructured", "const { process: p } = globalThis;"],
    ["X6 node:process default import, .dlopen", 'import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");'],
    ["X7 node:process default import, .binding", 'import proc from "node:process";\nconst fsb = (proc as any).binding("fs");'],
    ["X8 node:process named import dlopen", 'import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");'],
    ["X9 process.binding via optional chain", 'const b = (process as any)?.binding("fs");'],
    ["X10 class computed member", "const k = String(1);\nclass Q { static [k] = 1 }"],
    ["X11 Object.values of descriptors", "const v = Object.values(Object.getOwnPropertyDescriptors(Object));"],
    ["X12 with numeric-looking but string key k+0", 'const k = "constr";\nconst C = (f as any)[k + 0];'],
  ];
  it.each(probes)("%s", (n, src) => {
    const v = plant(src);
    console.log(`[probe] ${n}: ${v.length} violation(s): ${JSON.stringify(v)}`);
    expect(v.length, `${n} is not flagged`).toBeGreaterThan(0);
  });
});
