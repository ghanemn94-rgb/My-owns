// QA round-9 independent probe (qa-verifier, T-DG1-REV-QA-R9). Not part of the candidate.
// Copy to apps/api/src/ in a DISPOSABLE clone and run with:
//   pnpm vitest run --project unit-node apps/api/src/dg1-r9-default-deny-probe.test.ts --reporter=verbose
// Verifies F-DG1-129 / F-DG1-213 (and F-DG1-010's version-independence) against the frozen candidate's module lint
// WITHOUT trusting the implementer's own self-check table:
//  P1 every built-in the RUNNING Node reports (module.builtinModules + node:-only schemes) is denied unless it is in the
//     QA-held expected safe set; the safe set is accepted; bare (unprefixed) names are denied.
//  P2 every property name reachable on the RUNNING `process` object (own + prototype chain) is flagged as
//     `process.<name>` unless it is in the QA-held expected safe set; invented future members are flagged too.
//  P3 the F-DG1-129/213 routes and evasion spellings (optional chaining, call/apply, destructuring, indexing, passing,
//     globalThis, imported process object, require/import()/export-from/import-type of loader built-ins) are flagged.
//  P4 positive controls: legitimate uses of the safe set stay clean (no regression for real module code).
import { builtinModules } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bareAllowed, fileViolations, MODULES_DIR } from "./architecture.testkit.ts";

const FILE = join(MODULES_DIR, "transformations", "zz-qa-r9-planted.ts");
const v = (src: string) => fileViolations("transformations", FILE, src);

// Independently held expectation (from the round-9 assignment / D-055), not imported from the candidate.
const EXPECTED_SAFE_BUILTINS = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
const EXPECTED_SAFE_PROCESS = new Set(["env", "exit", "argv", "once"]);

const NODE_ONLY = ["sqlite", "test", "test/reporters", "sea"];
const allBuiltins = [...new Set([...builtinModules.map((b) => b.replace(/^node:/, "")), ...NODE_ONLY])].sort();

function processMemberNames(): string[] {
  const names = new Set<string>();
  for (let o: object | null = process; o; o = Object.getPrototypeOf(o))
    for (const k of Object.getOwnPropertyNames(o)) if (/^[A-Za-z_$][\w$]*$/.test(k)) names.add(k);
  return [...names].sort();
}

describe("P1 default-deny of node: built-ins (every built-in of the running Node)", () => {
  it(`enumerates ${allBuiltins.length} built-ins on Node ${process.version}`, () => {
    console.log("node", process.version, "built-ins:", allBuiltins.length);
    expect(allBuiltins.length).toBeGreaterThan(50);
  });
  const missed: string[] = [];
  const wronglyDenied: string[] = [];
  it("every non-safe built-in is denied (bareAllowed + fileViolations), every safe one is allowed", () => {
    for (const b of allBuiltins) {
      const spec = `node:${b}`;
      const out = v(`import * as x from "${spec}";\nexport const y = x;`);
      const denied = !bareAllowed(spec) && out.some((s) => s.includes(`non-allow-listed node built-in ${spec}`));
      if (EXPECTED_SAFE_BUILTINS.has(b)) {
        if (denied || out.length) wronglyDenied.push(`${spec} -> ${JSON.stringify(out)}`);
      } else if (!denied) missed.push(spec);
    }
    console.log("P1 missed (allowed but not safe):", JSON.stringify(missed));
    console.log("P1 wrongly denied (safe):", JSON.stringify(wronglyDenied));
    expect(missed).toEqual([]);
    expect(wronglyDenied).toEqual([]);
  });
  it("bare (unprefixed) built-in names are not dependencies and are denied", () => {
    for (const b of ["fs", "crypto", "child_process", "vm", "process", "inspector"])
      expect(v(`import "${b}";`).join("\n")).toContain(`imports package ${b}`);
  });
});

describe("P2 default-deny of process.<member> (every member of the running process object)", () => {
  const names = processMemberNames();
  it(`flags every non-safe member of process (${names.length} names) and no safe one`, () => {
    const missed: string[] = [];
    const wronglyFlagged: string[] = [];
    for (const n of names) {
      const out = v(`export const z = process.${n};`);
      if (EXPECTED_SAFE_PROCESS.has(n)) {
        if (out.length) wronglyFlagged.push(`${n} -> ${JSON.stringify(out)}`);
      } else if (out.length === 0) missed.push(n);
    }
    console.log("P2 process member names:", names.length, "missed:", JSON.stringify(missed));
    console.log("P2 wrongly flagged (safe):", JSON.stringify(wronglyFlagged));
    expect(names).toEqual(expect.arrayContaining(["kill", "_kill", "_debugProcess", "binding", "dlopen"]));
    expect(missed).toEqual([]);
    expect(wronglyFlagged).toEqual([]);
  });
  it("members a later Node might add are denied by default", () => {
    for (const n of ["futureLoader", "loadAddon", "evalScript", "spawnSync"])
      expect(v(`process.${n}("x");`).join("\n")).toContain(`non-allow-listed process.${n} member`);
  });
});

describe("P3 F-DG1-129 / F-DG1-213 routes and evasion spellings are flagged", () => {
  const plants: [string, string][] = [
    ["R1 process.kill(pid,'SIGUSR1')", `process.kill(process.pid, "SIGUSR1");`],
    ["R2 process._debugProcess(pid)", `process._debugProcess(process.pid);`],
    ["R3 process._kill", `process._kill(process.pid, 10);`],
    ["R4 optional chain process?.kill", `process?.kill(process.pid, "SIGUSR1");`],
    ["R5 process.kill.call", `process.kill.call(process, process.pid, "SIGUSR1");`],
    ["R6 Function.prototype.apply route", `Reflect.apply(process.kill, process, [process.pid, "SIGUSR1"]);`],
    ["R7 destructured", `const { kill } = process;\nkill(1, "SIGUSR1");`],
    ["R8 indexed", `process["kill"](process.pid, "SIGUSR1");`],
    ["R9 passed to Reflect.get", `Reflect.get(process, "_debugProcess")(1);`],
    ["R10 aliased", `const p = process;\np.kill(1, "SIGUSR1");`],
    ["R11 globalThis.process", `globalThis.process.kill(1, "SIGUSR1");`],
    ["R12 import default node:process", `import p from "node:process";\np.kill(1, "SIGUSR1");`],
    ["R13 import named node:process", `import { kill } from "node:process";\nkill(1, "SIGUSR1");`],
    ["R14 require node:inspector", `const i = require("node:inspector");\ni.open();`],
    ["R15 dynamic import node:child_process", `await import("node:child_process");`],
    ["R16 export-from node:vm", `export * from "node:vm";`],
    ["R17 type-only import node:worker_threads", `import type { Worker } from "node:worker_threads";\nexport type W = Worker;`],
    ["R18 import type node:v8", `export type H = import("node:v8").HeapInfo;`],
    ["R19 node:wasi", `import { WASI } from "node:wasi";\nexport const w = WASI;`],
    ["R20 node:net (network I/O in module source)", `import net from "node:net";\nexport const n = net;`],
    ["R21 process.getBuiltinModule", `process.getBuiltinModule("node:vm");`],
    ["R22 process.execve", `process.execve("/bin/sh", ["sh"]);`],
    ["R23 process.on (not in safe set)", `process.on("message", () => {});`],
  ];
  for (const [name, src] of plants) {
    it(`${name}: flagged`, () => {
      const out = v(src);
      console.log(name, "violations =", JSON.stringify(out));
      expect(out.length).toBeGreaterThan(0);
    });
  }
});

describe("P4 positive controls: legitimate module code stays clean", () => {
  const clean: [string, string][] = [
    ["C1 node:crypto", `import { randomUUID } from "node:crypto";\nexport const id = randomUUID();`],
    ["C2 node:fs + node:path", `import { readFileSync } from "node:fs";\nimport { join } from "node:path";\nexport const r = () => readFileSync(join("a", "b"), "utf8");`],
    ["C3 node:fs/promises", `import { readFile } from "node:fs/promises";\nexport const r = readFile;`],
    ["C4 node:os / node:url / node:util", `import os from "node:os";\nimport { fileURLToPath } from "node:url";\nimport { inspect } from "node:util";\nexport const x = [os.EOL, fileURLToPath, inspect];`],
    ["C5 process.env read", `export const tz = process.env.MTH_TZ ?? "Asia/Riyadh";`],
    ["C6 process.exit / once / argv", `process.once("SIGTERM", () => process.exit(0));\nexport const a = process.argv.length;`],
  ];
  for (const [name, src] of clean) {
    it(`${name}: clean`, () => {
      const out = v(src);
      console.log(name, "violations =", JSON.stringify(out));
      expect(out).toEqual([]);
    });
  }
});
