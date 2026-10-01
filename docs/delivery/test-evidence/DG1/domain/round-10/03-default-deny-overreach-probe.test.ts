// DG1 round-10 domain-reviewer probe (candidate 18fee1617d617cfd, commit 265af7e). Copied into a DISPOSABLE clone at
// apps/api/src/zz-dom-r10-probe.test.ts and run with vitest; never part of the candidate.
// Purpose: (1) the D-055 default-deny allow-lists and the F-DG1-130 `setEngine` ban do not over-reach (no legitimate
// import/member in the real module tree is rejected; ordinary node:crypto use - randomUUID, createHash, createHmac,
// randomBytes, timingSafeEqual, webcrypto - stays allowed); (2) crypto.setEngine is denied in every syntactic form;
// (3) the loader/debug/exec class stays denied (no regression); (4) an independent AST inventory backs D-055's
// corrected usage statement (4 of 7 built-ins: crypto/fs/path/url; zero process members).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { bareAllowed, fileViolations, MODULES_DIR, moduleViolations, walk } from "./architecture.testkit.ts";
import { API_MODULES, type ApiModule } from "./modules.ts";

const mods = Object.keys(API_MODULES) as ApiModule[];

/** Independent AST inventory (not the testkit's scanner) of node: specifiers and process.<member> in module source. */
function inventory() {
  const specs = new Map<string, number>();
  const members = new Map<string, number>();
  let processIdents = 0;
  for (const m of mods)
    for (const f of walk(join(MODULES_DIR, m))) {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) && /^(node:)/.test(n.text)) specs.set(n.text, (specs.get(n.text) ?? 0) + 1);
        if (ts.isIdentifier(n) && n.text === "process") processIdents++;
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "process")
          members.set(n.name.text, (members.get(n.name.text) ?? 0) + 1);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  return { specs, members, processIdents };
}

describe("DG1 r10 domain probe: default-deny + setEngine ban over-reach", () => {
  it("real module tree: zero violations in every module", () => {
    for (const m of mods) expect(moduleViolations(m), m).toEqual([]);
  });

  it("inventory: D-055's corrected usage statement (4 of 7 built-ins, no process member)", () => {
    const { specs, members, processIdents } = inventory();
    const bare = [...new Set([...specs.keys()].map((s) => s.replace(/^node:/, "")))].sort();
    console.log("node: specifiers in src/modules/**:", JSON.stringify([...specs]));
    console.log("distinct built-ins:", JSON.stringify(bare), "process identifiers:", processIdents, "members:", JSON.stringify([...members]));
    for (const s of specs.keys()) expect(bareAllowed(s), s).toBe(true);
    expect(bare).toEqual(["crypto", "fs", "path", "url"]);
    expect(members.size).toBe(0);
  });

  const file = join(MODULES_DIR, "transformations", "zz-probe.ts");
  const v = (src: string) => fileViolations("transformations", file, src);

  it("positive controls: ordinary module code (incl. legitimate node:crypto members) stays clean", () => {
    const ok = [
      `import { randomUUID, createHash } from "node:crypto"; export const id = randomUUID() + createHash("sha256").update("x").digest("hex");`,
      `import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"; export const h = (k: string, a: Buffer, b: Buffer) => createHmac("sha256", k).update(randomBytes(8)).digest("hex") + String(timingSafeEqual(a, b));`,
      `import * as nodeCrypto from "node:crypto"; export const u = nodeCrypto.randomUUID(); export const w = nodeCrypto.webcrypto.getRandomValues(new Uint8Array(4));`,
      `import crypto from "node:crypto"; export const g = crypto.getHashes().length;`,
      `import { readFile } from "node:fs/promises"; export const r = readFile;`,
      `import { fileURLToPath } from "node:url"; import { join } from "node:path"; export const p = join(fileURLToPath(import.meta.url), "x");`,
      `import { inspect } from "node:util"; import { EOL } from "node:os"; export const s = inspect({}) + EOL;`,
      `export const tz = process.env.TZ ?? "Asia/Riyadh";`,
      `export const a = process.argv.slice(2); process.once("SIGTERM", () => process.exit(0));`,
      `import { Decimal } from "decimal.js"; export const d = new Decimal("1.10").plus("2.20").toFixed(2);`,
      `export const engineName = "Transformation engine"; export function setEngineLabel(x: string) { return x; }`,
    ];
    for (const src of ok) {
      const out = v(src);
      console.log("ALLOW?", JSON.stringify(src.slice(0, 80)), "->", JSON.stringify(out));
      expect(out, src).toEqual([]);
    }
  });

  it("F-DG1-130: crypto.setEngine is denied in every form I could write", () => {
    const bad = [
      `import { setEngine } from "node:crypto"; setEngine("/x.so");`,
      `import { setEngine as se } from "node:crypto"; se("/x.so");`,
      `import * as c from "node:crypto"; c.setEngine("/x.so");`,
      `import c from "node:crypto"; (c as any)["setEngine"]("/x.so");`,
      `import c from "node:crypto"; const { setEngine } = c; setEngine("/x.so");`,
      `import c from "node:crypto"; const { setEngine: s2 } = c; s2("/x.so");`,
      `import c from "node:crypto"; const k = "setEn" + "gine"; (c as any)[k]("/x.so");`,
      "import c from \"node:crypto\"; (c as any)[`setEngine`](\"/x.so\");",
      `export { setEngine } from "node:crypto";`,
      `const c = await import("node:crypto"); c.setEngine("/x.so");`,
    ];
    for (const src of bad) {
      const out = v(src);
      console.log("DENY?", JSON.stringify(src), "->", out.length, JSON.stringify(out));
      expect(out.length, src).toBeGreaterThan(0);
    }
  });

  it("no regression: loader / debugger / exec / native / network routes are still denied", () => {
    const bad = [
      `process.kill(process.pid, "SIGUSR1");`,
      `process._debugProcess(process.pid);`,
      `process.getBuiltinModule("vm");`,
      `process.execve("/bin/sh", []);`,
      `process.dlopen({ exports: {} }, "x.node");`,
      `import "node:inspector";`,
      `import "node:inspector/promises";`,
      `import "node:wasi";`,
      `import "node:v8";`,
      `import "node:net";`,
      `import "node:http";`,
      `import "node:test/reporters";`,
      `import "node:sqlite";`,
      `import "node:vm";`,
      `import "node:child_process";`,
      `import "node:some-future-builtin";`,
      `import "fs";`,
      `eval("1");`,
    ];
    for (const src of bad) {
      const out = v(src);
      console.log("DENY?", JSON.stringify(src), "->", out.length, JSON.stringify(out));
      expect(out.length, src).toBeGreaterThan(0);
    }
  });
});
