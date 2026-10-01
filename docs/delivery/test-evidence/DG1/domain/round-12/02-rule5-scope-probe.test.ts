// DG1 round-12 domain-reviewer probe (independent; not part of the candidate). Copied into the disposable clone as
// apps/api/src/zz-dom-r12-probe.test.ts, run on Node 22 and Node 24, then removed. Checks rule 5 scope: only
// node:crypto namespace/default bindings are flagged; named imports and other allow-listed built-ins are unaffected;
// plain-object enumeration (residual (a)) stays allowed; the real module tree has zero violations.
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { fileViolations, MODULES_DIR, moduleViolations } from "./architecture.testkit.ts";

const scan = (src: string, mod: ApiModule = "identity") => fileViolations(mod, join(MODULES_DIR, mod, "probe.ts"), src);

describe("rule 5 does not over-reach", () => {
  it.each([
    ["named crypto, many members", `import { randomUUID, createHash, createHmac, timingSafeEqual, randomBytes, scryptSync, webcrypto } from "node:crypto";\nexport const x = [randomUUID, createHash, createHmac, timingSafeEqual, randomBytes, scryptSync, webcrypto];`],
    ["named crypto, aliased", `import { createHash as h } from "node:crypto";\nexport const y = h("sha256");`],
    ["type-only typeof import crypto", `export type C = typeof import("node:crypto");`],
    ["re-export named crypto", `export { randomUUID } from "node:crypto";`],
    ["re-export named crypto as default (binds a function, not the module)", `export { randomUUID as default } from "node:crypto";`],
    ["ns fs", `import * as fs from "node:fs";\nexport const a = Object.keys(fs);`],
    ["default fs", `import fs from "node:fs";\nexport const a = typeof fs;`],
    ["ns fs/promises", `import * as fsp from "node:fs/promises";\nexport const a = fsp;`],
    ["default os", `import os from "node:os";\nexport const a = Object.entries(os);`],
    ["ns path", `import * as path from "node:path";\nexport const a = path.join("a");`],
    ["ns url", `import * as url from "node:url";\nexport const a = url;`],
    ["ns util", `import * as util from "node:util";\nexport const a = util.inspect;`],
    ["dynamic import path", `export const p = await import("node:path");`],
    ["export * from path", `export * from "node:path";`],
    ["plain object enumeration (cookies)", `export function c(r: { cookies: Record<string, string> }, n: string) { return new Map(Object.entries(r.cookies)).get(n); }`],
    ["plain object enumeration (permissions)", `const P = { a: 1 } as const;\nexport const m = new Map(Object.entries(P));`],
  ])("allowed: %s", (_n, src) => {
    expect(scan(src)).toEqual([]);
  });
});

describe("rule 5 closes the enumeration route", () => {
  it.each([
    ["ns import", `import * as c from "node:crypto";`],
    ["default import", `import c from "node:crypto";`],
    ["default+named", `import c, { randomUUID } from "node:crypto";`],
    ["{ default as c }", `import { default as c } from "node:crypto";`],
    ["{ \"default\" as c } (string-literal name)", `import { "default" as c } from "node:crypto";`],
    ["export *", `export * from "node:crypto";`],
    ["export * as", `export * as c from "node:crypto";`],
    ["export { default }", `export { default } from "node:crypto";`],
    ["import = require", `import c = require("node:crypto");`],
    ["dynamic import literal", `export const c = await import("node:crypto");`],
    ["dynamic import template literal", "export const c = await import(`node:crypto`);"],
    ["dynamic import .then enumerate", `import("node:crypto").then((m) => new Map(Object.entries(m)).get("set".concat("Engine")));`],
    ["require literal", `const c = require("node:crypto");`],
    ["bare crypto ns", `import * as c from "crypto";`],
    ["computed dynamic import", `const s = "node:" + "crypto";\nexport const c = await import(s);`],
  ])("flagged: %s", (_n, src) => {
    expect(scan(src).length).toBeGreaterThan(0);
  });
});

describe("real module tree", () => {
  it("every module has zero violations", () => {
    for (const mod of Object.keys(API_MODULES) as ApiModule[]) expect(moduleViolations(mod), mod).toEqual([]);
  });
});
