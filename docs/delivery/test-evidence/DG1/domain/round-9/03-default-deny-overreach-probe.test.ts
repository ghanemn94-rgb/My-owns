// DG1 round-9 domain-reviewer probe (candidate 05915c32b3f5c5b2, commit 273d21f). Copied into a DISPOSABLE clone at
// apps/api/src/zz-dom-r9-probe.test.ts and run with vitest; never part of the candidate.
// Purpose: confirm the D-055 default-deny allow-lists do not over-reach (no legitimate import/member in the real module
// tree is rejected; ordinary module patterns stay allowed) and that the loader/debug/exec class is denied.
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
  for (const m of mods)
    for (const f of walk(join(MODULES_DIR, m))) {
      const sf = ts.createSourceFile(f, readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true);
      const visit = (n: ts.Node): void => {
        if (ts.isStringLiteral(n) && /^(node:)/.test(n.text)) specs.set(n.text, (specs.get(n.text) ?? 0) + 1);
        if (ts.isPropertyAccessExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === "process")
          members.set(n.name.text, (members.get(n.name.text) ?? 0) + 1);
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
  return { specs, members };
}

describe("DG1 r9 domain probe: default-deny over-reach", () => {
  it("real module tree: zero violations in every module", () => {
    for (const m of mods) expect(moduleViolations(m), m).toEqual([]);
  });

  it("inventory: every node: specifier and process member used in module source is allow-listed", () => {
    const { specs, members } = inventory();
    console.log("node: specifiers in src/modules/**:", JSON.stringify([...specs]));
    console.log("process.<member> in src/modules/**:", JSON.stringify([...members]));
    for (const s of specs.keys()) expect(bareAllowed(s), s).toBe(true);
    for (const mem of members.keys()) expect(["env", "exit", "argv", "once"]).toContain(mem);
  });

  const file = join(MODULES_DIR, "transformations", "zz-probe.ts");
  const v = (src: string) => fileViolations("transformations", file, src);

  it("positive controls: ordinary module code stays clean", () => {
    const ok = [
      `import { randomUUID, createHash } from "node:crypto"; export const id = randomUUID();`,
      `import { readFile } from "node:fs/promises"; export const r = readFile;`,
      `import { fileURLToPath } from "node:url"; import { join } from "node:path"; export const p = join(fileURLToPath(import.meta.url), "x");`,
      `import { inspect } from "node:util"; import { EOL } from "node:os"; export const s = inspect({}) + EOL;`,
      `export const tz = process.env.TZ ?? "Asia/Riyadh";`,
      `export const a = process.argv.slice(2); process.once("SIGTERM", () => process.exit(0));`,
      `import { Decimal } from "decimal.js"; export const d = new Decimal("1.10").plus("2.20").toFixed(2);`,
    ];
    for (const src of ok) {
      const out = v(src);
      console.log("ALLOW?", JSON.stringify(src.slice(0, 70)), "->", JSON.stringify(out));
    }
  });

  it("negative controls: loader / debugger / exec / native / network routes are denied", () => {
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
      `import "node:some-future-builtin";`,
      `import "fs";`,
    ];
    for (const src of bad) {
      const out = v(src);
      console.log("DENY?", JSON.stringify(src), "->", out.length, JSON.stringify(out));
      expect(out.length, src).toBeGreaterThan(0);
    }
  });
});
