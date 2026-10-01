// QA round-11 independent probe (qa-verifier, T-DG1-REV-QA-R11). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with (Node 22 and Node 24):
//   npx vitest run --project unit-node apps/api/src/dg1-r11-setengine-probe.test.ts --reporter=verbose
// Verifies F-DG1-132 / F-DG1-215 as now documented by the candidate:
//  R1 every SPELLED form of `setEngine` is still flagged by rule 1 ("native loader") - independent of the
//     implementer's S1-S3 table (aliases, destructuring, escapes, template keys, export-from, dynamic import, ...).
//  R2 enumeration of the allow-listed node:crypto namespace without writing the name is NOT flagged (= the documented
//     residual (a)), and the runtime equivalent really selects crypto.setEngine (identity only; nothing is loaded).
//     Extra enumeration routes beyond the candidate's E1-E4 (Reflect.ownKeys, getOwnPropertyDescriptors, spread)
//     are checked to belong to the same class (0 violations) so the residual statement covers them.
//  R3 the residual's justification: legitimate module code really uses `new Map(Object.entries(x)).get(...)`.
//  R4 positive controls stay clean.
import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR, walk } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-r11-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);
const P = `"/nonexistent/qa.so"`;

describe("R1 every SPELLED form of setEngine is flagged (native loader)", () => {
  const forms: Array<[string, string]> = [
    ["named import", `import { setEngine } from "node:crypto";\nsetEngine(${P});`],
    ["aliased named import", `import { setEngine as s } from "node:crypto";\ns(${P});`],
    ["namespace member", `import * as c from "node:crypto";\nc.setEngine(${P});`],
    ["default-export member", `import crypto from "node:crypto";\ncrypto.setEngine(${P});`],
    ["namespace .default member", `import * as c from "node:crypto";\nc.default.setEngine(${P});`],
    ["optional chain", `import * as c from "node:crypto";\nc?.setEngine?.(${P});`],
    ["string key", `import * as c from "node:crypto";\n(c as any)["setEngine"](${P});`],
    ["template key", 'import * as c from "node:crypto";\n(c as any)[`setEngine`](' + P + ");"],
    ["unicode-escaped string key", `import * as c from "node:crypto";\n(c as any)["set\\u0045ngine"](${P});`],
    ["unicode-escaped identifier", `import * as c from "node:crypto";\n(c as any).set\\u0045ngine(${P});`],
    ["destructuring", `import * as c from "node:crypto";\nconst { setEngine } = c;\nsetEngine(${P});`],
    ["destructuring rename", `import * as c from "node:crypto";\nconst { setEngine: s } = c;\ns(${P});`],
    ["string-key destructuring", `import * as c from "node:crypto";\nconst { "setEngine": s } = c;\ns(${P});`],
    ["export-from", `export { setEngine } from "node:crypto";`],
    ["export-from rename", `export { setEngine as s } from "node:crypto";`],
    ["dynamic import", `export const f = async () => (await import("node:crypto")).setEngine(${P});`],
    ["then() destructuring", `import("node:crypto").then(({ setEngine }) => setEngine(${P}));`],
    ["'in' probe", `import * as c from "node:crypto";\nexport const has = "setEngine" in c;`],
    ["Reflect.get with literal", `import * as c from "node:crypto";\n(Reflect.get(c, "setEngine") as (p: string) => void)(${P});`],
    ["string literal in a Map key", `import * as c from "node:crypto";\n(new Map(Object.entries(c)).get("setEngine") as (p: string) => void)(${P});`],
  ];
  it.each(forms)("%s", (name, src) => {
    const out = v(src);
    console.log(`R1 ${name}: ${out.length} violation(s) ${JSON.stringify(out)}`);
    expect(out.join("\n")).toMatch(/native loader via/);
  });
});

// [label, module-source plant, runtime selector equivalent (run here in the test, not in module source)]
const ENUM_FORMS: Array<[string, string, () => unknown]> = [
  [
    "E1 Object.values + name built at runtime",
    `import * as c from "node:crypto";\nconst f = Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine") as (p: string) => void;\nf(${P});`,
    () => Object.values(nodeCrypto).find((x) => typeof x === "function" && x.name === "set" + "Engine"),
  ],
  [
    "E2 Map(Object.entries) + get(concat)",
    `import * as c from "node:crypto";\n(new Map(Object.entries(c)).get("set".concat("Engine")) as (p: string) => void)(${P});`,
    () => new Map(Object.entries(nodeCrypto)).get("set".concat("Engine")),
  ],
  [
    "E3 Object.entries + regex on key",
    `import * as c from "node:crypto";\n(Object.entries(c).find(([k]) => /^setEng/.test(k))![1] as (p: string) => void)(${P});`,
    () => Object.entries(nodeCrypto).find(([k]) => /^setEng/.test(k))![1],
  ],
  [
    "E4 default binding, for-of over entries",
    `import crypto from "node:crypto";\nfor (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) (f as (p: string) => void)(${P});`,
    () => Object.entries(nodeCrypto.default).find(([k]) => k.startsWith("set") && k.endsWith("Engine"))![1],
  ],
  [
    "X1 (extra) Object.getOwnPropertyDescriptors + regex",
    `import * as c from "node:crypto";\nconst d = Object.entries(Object.getOwnPropertyDescriptors(c)).find(([k]) => /Engine$/.test(k))!;\n(d[1].value as (p: string) => void)(${P});`,
    () => Object.entries(Object.getOwnPropertyDescriptors(nodeCrypto)).find(([k]) => /Engine$/.test(k))![1].value,
  ],
  [
    "X2 (extra) spread into array of values + fn.name regex",
    `import * as c from "node:crypto";\nconst f = [...Object.values(c)].filter((x) => typeof x === "function").find((x) => /^setEng/.test((x as { name: string }).name)) as (p: string) => void;\nf(${P});`,
    () => [...Object.values(nodeCrypto)].filter((x) => typeof x === "function").find((x) => /^setEng/.test((x as { name: string }).name)),
  ],
];

// Attempt 1 (logs 08-r11-setengine-probe-v*.attempt1.log) expected X1 to be unflagged too; the lint in fact flags it
// as reflection (`.getOwnPropertyDescriptors()`), i.e. STRICTER than residual (a). That was a probe-expectation error,
// not a candidate defect; X1 now asserts the observed (safe) behaviour.
const FLAGGED_STRICTER = new Set(["X1 (extra) Object.getOwnPropertyDescriptors + regex"]);

describe("R2 enumeration reach = documented residual (a): NOT flagged, but really reaches crypto.setEngine", () => {
  it.each(ENUM_FORMS)("%s", (label, src, select) => {
    const out = v(src);
    const same = select() === nodeCrypto.setEngine;
    console.log(`R2 ${label}: lint ${out.length} violation(s) ${JSON.stringify(out)}; runtime selects crypto.setEngine: ${same}`);
    expect(same).toBe(true);
    if (FLAGGED_STRICTER.has(label)) expect(out.join("\n")).toMatch(/reflection via \.getOwnPropertyDescriptors\(\)/);
    else expect(out).toEqual([]);
  });
});

describe("R3 residual (a) justification: legitimate module code uses Map(Object.entries(...)).get(...)", () => {
  it("at least one real module file uses `new Map(Object.entries(`", () => {
    const hits = walk(MODULES_DIR)
      .filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f))
      .filter((f) => readFileSync(f, "utf8").includes("new Map(Object.entries("))
      .map((f) => f.slice(MODULES_DIR.length + 1));
    console.log(`R3 real files using new Map(Object.entries(: ${JSON.stringify(hits)}`);
    expect(hits.length).toBeGreaterThan(0);
  });
});

describe("R4 positive controls stay clean", () => {
  const ok: Array<[string, string]> = [
    ["crypto named", `import { randomUUID, createHash } from "node:crypto";\nexport const a = randomUUID() + createHash("sha256").update("x").digest("hex");`],
    ["crypto namespace", `import * as c from "node:crypto";\nexport const a = c.randomUUID();`],
    ["crypto default", `import crypto from "node:crypto";\nexport const a = crypto.createHmac("sha256", "k").update("x").digest("hex");`],
    ["Map(Object.entries) of a plain object", `const x = { a: 1 };\nexport const g = (name: string) => new Map(Object.entries(x)).get(name);`],
  ];
  it.each(ok)("%s", (_n, src) => expect(v(src)).toEqual([]));
});
