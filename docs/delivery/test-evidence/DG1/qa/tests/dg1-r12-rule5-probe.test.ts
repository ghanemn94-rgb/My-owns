// QA round-12 independent probe (qa-verifier, T-DG1-REV-QA-R12). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with (Node 22 and Node 24):
//   npx vitest run --project unit-node apps/api/src/dg1-r12-rule5-probe.test.ts --reporter=verbose
// Verifies F-DG1-132 / F-DG1-133 (rule 5: node:crypto by NAMED imports only), independent of the implementer's
// E1-E5 / N1-N10 tables:
//  P1 every namespace/default binding form of node:crypto (and bare "crypto") is a violation, including forms the
//     candidate's table does not list (string-literal "default" specifier, template-literal import(), then(),
//     default + namespace, export { default } without alias, multi-line, `with` attributes).
//  P2 the round-11 enumeration routes (E1-E4 and my round-11 extra X2) that were pinned as residual (a) are now
//     violations.
//  P3 runtime: with NAMED imports only, crypto.setEngine is not reachable by enumerating the value graph of any named
//     export of node:crypto (BFS over own properties, depth 4); the module object itself is not a named export.
//  P4 positive controls stay clean: named imports (incl. aliases, `type`), re-export of a named member, type-only
//     `typeof import()`, plain-object enumeration, namespace import of another allow-listed built-in.
//  P5 the real module tree: every file has 0 violations, and every node:crypto import in module source is named-only.
//  P6 rule 1 regression: spelled setEngine forms are still flagged as native loader.
import * as nodeCrypto from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fileViolations, MODULES_DIR, walk } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-r12-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);
const RULE5 = /namespace\/default binding via/;
const P = `"/nonexistent/qa.so"`;

describe("P1 every namespace/default binding of node:crypto is a rule-5 violation", () => {
  const forms: Array<[string, string]> = [
    ["namespace import", `import * as c from "node:crypto";`],
    ["default import", `import c from "node:crypto";`],
    ["default + named", `import c, { randomUUID } from "node:crypto";\nexport const u = randomUUID;`],
    ["default + namespace", `import c, * as d from "node:crypto";`],
    ["{ default as c }", `import { default as c } from "node:crypto";`],
    ["{ randomUUID, default as c }", `import { randomUUID, default as c } from "node:crypto";`],
    ['{ "default" as c } (string-literal specifier)', `import { "default" as c } from "node:crypto";`],
    ["export *", `export * from "node:crypto";`],
    ["export * as c", `export * as c from "node:crypto";`],
    ["export { default } (no alias)", `export { default } from "node:crypto";`],
    ["export { default as c }", `export { default as c } from "node:crypto";`],
    ['export { "default" as c }', `export { "default" as c } from "node:crypto";`],
    ["import = require", `import c = require("node:crypto");`],
    ["dynamic import literal", `export const f = async () => await import("node:crypto");`],
    ["dynamic import template literal", "export const f = async () => await import(`node:crypto`);"],
    ["dynamic import .then", `import("node:crypto").then((m) => Object.keys(m));`],
    ["require literal", `const c = require("node:crypto");`],
    ["bare 'crypto' namespace", `import * as c from "crypto";`],
    ["bare 'crypto' default", `import c from "crypto";`],
    ["multi-line namespace", `import\n  *\n  as\n  c\n  from\n  "node:crypto";`],
    ["import with attributes", `import c from "node:crypto" with { type: "js" };`],
  ];
  it.each(forms)("%s", (name, src) => {
    const out = v(src);
    console.log(`P1 ${name}: ${out.length} violation(s) ${JSON.stringify(out)}`);
    expect(out.length).toBeGreaterThan(0);
    // Every form must be caught. Where rule 5 is the reason, the message must say so. The bare `crypto` spelling and
    // `require` are also caught by other rules (non-dependency / banned loader name); that is acceptable.
    if (!/^bare|^require/.test(name)) expect(out.join("\n")).toMatch(RULE5);
  });
});

describe("P2 the round-11 residual (a) enumeration routes are now violations", () => {
  const routes: Array<[string, string]> = [
    [
      "E1 Object.values + fn.name",
      `import * as c from "node:crypto";\nconst f = Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine") as (p: string) => void;\nf(${P});`,
    ],
    [
      "E2 Map(Object.entries).get(built key)",
      `import * as c from "node:crypto";\n(new Map(Object.entries(c)).get("set".concat("Engine")) as (p: string) => void)(${P});`,
    ],
    [
      "E3 Object.entries + regex",
      `import * as c from "node:crypto";\n(Object.entries(c).find(([k]) => /^setEng/.test(k))![1] as (p: string) => void)(${P});`,
    ],
    [
      "E4 for-of over default binding",
      `import crypto from "node:crypto";\nfor (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) (f as (p: string) => void)(${P});`,
    ],
    [
      "X2 spread of values + fn.name regex",
      `import * as c from "node:crypto";\nconst fs = [...Object.values(c)];\n(fs.find((f) => typeof f === "function" && /Engine$/.test(f.name) && f.name.startsWith("set")) as (p: string) => void)(${P});`,
    ],
    [
      "X3 dynamic import + enumerate",
      `export const f = async () => { const m = await import("node:crypto"); return Object.values(m).find((x) => typeof x === "function" && x.name === "set" + "Engine"); };`,
    ],
    [
      "X4 { default as c } + enumerate",
      `import { default as c } from "node:crypto";\nexport const g = new Map(Object.entries(c)).get("set".concat("Engine"));`,
    ],
  ];
  it.each(routes)("%s", (name, src) => {
    const out = v(src);
    console.log(`P2 ${name}: ${out.length} violation(s) ${JSON.stringify(out)}`);
    expect(out.join("\n")).toMatch(RULE5);
  });
});

describe("P3 runtime: setEngine is not reachable from the value graph of any NAMED export", () => {
  it("BFS (depth 4) over own properties of every named export never meets crypto.setEngine or the module object", () => {
    const target = (nodeCrypto as Record<string, unknown>)["set" + "Engine"];
    expect(typeof target).toBe("function");
    const mod = nodeCrypto as Record<string, unknown>;
    const def = mod["default"];
    const named = Object.keys(mod).filter((k) => k !== "default" && k !== "set" + "Engine");
    const hits: string[] = [];
    const seen = new Set<unknown>();
    const queue: Array<[unknown, string, number]> = named.map((k) => [mod[k], k, 0]);
    let visited = 0;
    while (queue.length) {
      const [val, path, d] = queue.shift()!;
      if (val === null || (typeof val !== "object" && typeof val !== "function")) continue;
      if (seen.has(val)) continue;
      seen.add(val);
      visited++;
      if (val === target || val === mod || val === def) {
        hits.push(path);
        continue;
      }
      if (d >= 4) continue;
      for (const key of Reflect.ownKeys(val as object)) {
        let child: unknown;
        try {
          child = (val as Record<PropertyKey, unknown>)[key as string];
        } catch {
          continue;
        }
        queue.push([child, `${path}.${String(key)}`, d + 1]);
      }
    }
    console.log(`P3 named exports=${named.length} objects visited=${visited} hits=${JSON.stringify(hits)}`);
    expect(hits).toEqual([]);
  });
});

describe("P4 positive controls stay clean", () => {
  const ok: Array<[string, string]> = [
    ["named imports", `import { randomUUID, createHash } from "node:crypto";\nexport const id = randomUUID() + createHash("sha256").update("x").digest("hex");`],
    ["aliased named + type", `import { type Hash, randomBytes as rb } from "node:crypto";\nexport const r = (h?: Hash) => rb(4).toString("hex") + String(h);`],
    ["re-export a named member", `export { randomUUID as uuid } from "node:crypto";`],
    ["typeof import type", `type C = typeof import("node:crypto");\nexport type K = keyof C;`],
    ["plain object enumeration (cookies idiom)", `export function cookie(r: { cookies: Record<string, string> }, n: string) {\n  return new Map(Object.entries(r.cookies)).get(n);\n}`],
    ["namespace of node:path", `import * as path from "node:path";\nexport const j = path.join("a", "b");`],
    ["default of node:fs", `import fs from "node:fs";\nexport const t = typeof fs;`],
  ];
  it.each(ok)("%s", (name, src) => {
    const out = v(src);
    console.log(`P4 ${name}: ${JSON.stringify(out)}`);
    expect(out).toEqual([]);
  });
});

describe("P5 the real module tree", () => {
  const files = walk(MODULES_DIR).filter((f) => /\.(ts|tsx|mts|cts)$/.test(f));
  it("every module file is clean and imports node:crypto by named imports only", () => {
    let cryptoFiles = 0;
    const bad: string[] = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      const mod = f.slice(MODULES_DIR.length + 1).split("/")[0] as Parameters<typeof fileViolations>[0];
      const out = fileViolations(mod, f, src);
      if (out.length) bad.push(`${f}: ${JSON.stringify(out)}`);
      const lines = src.split("\n").filter((l) => /["'](node:)?crypto["']/.test(l));
      if (lines.length) cryptoFiles++;
      for (const l of lines) if (!/^\s*import\s+(type\s+)?\{[^}]*\}\s+from\s+["']node:crypto["'];?\s*$/.test(l)) bad.push(`${f}: non-named crypto import line: ${l}`);
    }
    console.log(`P5 module files=${files.length} files importing node:crypto=${cryptoFiles} problems=${bad.length}`);
    for (const b of bad) console.log(`P5 ${b}`);
    expect(bad).toEqual([]);
    expect(cryptoFiles).toBeGreaterThan(0);
  });
});

describe("P6 rule 1 regression: spelled setEngine is still a native-loader violation", () => {
  const forms: Array<[string, string]> = [
    ["named import", `import { setEngine } from "node:crypto";\nsetEngine(${P});`],
    ["aliased named import", `import { setEngine as s } from "node:crypto";\ns(${P});`],
    ["export-from", `export { setEngine } from "node:crypto";`],
    ["unicode-escaped named import", `import { set\\u0045ngine as s } from "node:crypto";\ns(${P});`],
  ];
  it.each(forms)("%s", (name, src) => {
    const out = v(src);
    console.log(`P6 ${name}: ${JSON.stringify(out)}`);
    expect(out.join("\n")).toMatch(/native loader via/);
  });
});
