// DG1 round-4 code-security re-test of F-DG1-121 (T-DG1-REV-SEC-R4). Copied by plant-f121.sh into a DISPOSABLE clone as
// apps/api/src/zz-plant-f121.test.ts; never part of the candidate. For every variant it prints whether the candidate's
// module lint (architecture.testkit.ts scanSource) reports an evasion. Expected: every LOADER variant is reported; the
// clean controls are not.
import { describe, expect, it } from "vitest";
import { scanSource } from "./architecture.testkit.ts";

const LOADERS: Record<string, string> = {
  // the four round-3 (F-DG1-121) aliased forms
  "r3-alias-const": `export async function x() { const C = (async () => {}).constructor; return C("s", "return import(s)")("../transformations/routes.ts"); }`,
  "r3-destructure": `export async function x() { const { constructor: F } = (async () => {}); return F("s", "return import(s)")("x"); }`,
  "r3-reflect-construct": `export async function x() { return Reflect.construct((async () => {}).constructor, ["s", "return import(s)"])("x"); }`,
  "r3-getPrototypeOf": `export async function x() { const P = Object.getPrototypeOf(async function () {}).constructor; return P("s", "return import(s)")("x"); }`,
  // additional round-4 variants
  "r4-assign-pattern": `export async function x() { let F: any; ({ constructor: F } = (async () => {})); return F("s","return import(s)")("x"); }`,
  "r4-reflect-get-literal": `export async function x() { const F = Reflect.get(async () => {}, "constructor"); return F("s","return import(s)")("x"); }`,
  "r4-computed-concat-key": `export async function x() { const f: any = async () => {}; const F = f["constr" + "uctor"]; return F("s","return import(s)")("x"); }`,
  "r4-reflect-get-concat": `export async function x() { const F = Reflect.get(async () => {}, "constr".concat("uctor")); return F("s","return import(s)")("x"); }`,
  "r4-template-key": "export async function x() { const k = `constr${'uctor'}`; const f: any = async () => {}; return f[k]('s','return import(s)')('x'); }",
  "r4-descriptor-scan": `export async function x() { const p = Object.getPrototypeOf(async () => {}); const n = Object.getOwnPropertyNames(p).find((s) => s.startsWith("constr"))!; return (p as any)[n]("s","return import(s)")("x"); }`,
};
const CLEAN: Record<string, string> = {
  "class-ctor-decl": `export class A { constructor(public n: number) {} }`,
  "plain-code": `export function add(a: number, b: number) { return a + b; }`,
};

describe("F-DG1-121 plants (round 4)", () => {
  it("reports every loader variant, and no clean control", () => {
    const missed: string[] = [];
    for (const [k, src] of Object.entries(LOADERS)) {
      const r = scanSource("modules/access/zz-planted.ts", src);
      console.log(`${r.evasions.length ? "CAUGHT " : "MISSED "} ${k}  ${JSON.stringify(r.evasions)}`);
      if (!r.evasions.length) missed.push(k);
    }
    for (const [k, src] of Object.entries(CLEAN)) {
      const r = scanSource("modules/access/zz-clean.ts", src);
      console.log(`${r.evasions.length ? "FALSE-POSITIVE" : "clean  "} ${k}  ${JSON.stringify(r.evasions)}`);
      expect(r.evasions, k).toEqual([]);
    }
    expect(missed).toEqual([]);
  });
});
