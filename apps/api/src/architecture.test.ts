// Architecture test (ADR-0002). Parses every import (including type-only, re-exports, dynamic import() and require)
// with the AST lint in architecture.testkit.ts and fails when:
//  1. a module imports anything other than its own files, the index.ts of a module in its `dependsOn`, the shared
//     packages (@mth/shared, @mth/config, @mth/db), an ALLOW-LISTED node: built-in or a third-party dependency of
//     @mth/api (D-055: every other node: built-in is denied by default);
//  2. a module reaches into the composition root (server.ts, main.ts, index.ts, modules.ts) - except that a module's
//     own *.test.ts may read the module map and the lint itself;
//  3. a module evades the check: computed import()/require() specifiers, createRequire, or node:module (F-DG1-109);
//     process.getBuiltinModule / computed members of process or globalThis, Function/eval/.constructor() code
//     evaluation, or node:vm / worker_threads (F-DG1-117); and, since F-DG1-124, ANY occurrence of a dynamic-code
//     primitive name (eval, Function & co., constructor, require, createRequire, Reflect, getPrototypeOf, ...) in any
//     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them); since
//     D-055 (F-DG1-129/213), any member of the global process outside the allow-list (process.kill, _debugProcess,
//     execve, binding, ...) - default-deny, independent of the Node version;
//  4. a module directory is not in the module map, a P1 module has no index.ts, or a §16 business module has no
//     test suite of its own (A12, D-048);
//  5. the declared module graph has a cycle, or audit/access depend on a business module;
//  6. the package dependency direction is broken (db -> config, shared; config -> shared; shared -> none;
//     apps/web never imports @mth/db or @mth/config).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  bareAllowed,
  fileViolations,
  importsOf,
  MODULES_DIR,
  moduleViolations,
  scanSource,
  SRC,
  walk,
} from "./architecture.testkit.ts";
import { API_MODULES, P1_MODULES, P1_SCAFFOLD_MODULES, SECTION16_MODULES, type ApiModule } from "./modules.ts";

const REPO = resolve(SRC, "../../..");

describe("API module boundaries (ADR-0002)", () => {
  const moduleDirs = readdirSync(MODULES_DIR).filter((d) => statSync(join(MODULES_DIR, d)).isDirectory());

  it("has only mapped module directories, and every P1 module has a public index.ts", () => {
    expect(moduleDirs.filter((d) => !(d in API_MODULES))).toEqual([]);
    for (const m of P1_MODULES) expect(existsSync(join(MODULES_DIR, m, "index.ts")), m).toBe(true);
    expect([...moduleDirs].sort()).toEqual([...P1_MODULES].sort());
  });

  it("the six §16 business modules all exist, each with its own test suite (A12; D-048)", () => {
    // A module's suite = a *.test.ts in its own directory, or an integration suite named after it.
    const integrationDir = join(SRC, "../test/integration");
    const suitesOf = (m: ApiModule) => [
      ...walk(join(MODULES_DIR, m)).filter((f) => f.endsWith(".test.ts")),
      ...walk(integrationDir).filter((f) => f.endsWith(".test.ts") && relative(integrationDir, f).startsWith(m)),
    ];
    expect(Object.keys(SECTION16_MODULES)).toHaveLength(6);
    for (const [area, mods] of Object.entries(SECTION16_MODULES)) {
      for (const m of mods) {
        expect(P1_MODULES, `${area}: ${m} is a P1 module`).toContain(m);
        expect(suitesOf(m).length, `${area}: ${m} has its own test suite`).toBeGreaterThan(0);
      }
    }
    for (const m of P1_SCAFFOLD_MODULES) expect(existsSync(join(MODULES_DIR, m, `${m}.test.ts`)), m).toBe(true);
  });

  it("every import respects dependsOn, public surfaces and allowed packages", () => {
    expect((moduleDirs as ApiModule[]).flatMap((m) => moduleViolations(m))).toEqual([]);
  });

  it("the declared module graph is acyclic, and audit/access depend on no business module", () => {
    const state = new Map<string, "visiting" | "done">();
    const visit = (m: string, path: string[]): void => {
      if (state.get(m) === "done") return;
      if (state.get(m) === "visiting") throw new Error(`cycle: ${[...path, m].join(" -> ")}`);
      state.set(m, "visiting");
      for (const d of API_MODULES[m as ApiModule].dependsOn) visit(d, [...path, m]);
      state.set(m, "done");
    };
    for (const m of Object.keys(API_MODULES)) expect(() => visit(m, [])).not.toThrow();
    expect(API_MODULES.audit.dependsOn).toEqual(["platform"]);
    expect([...API_MODULES.access.dependsOn].sort()).toEqual(["audit", "platform"]);
    expect(API_MODULES.platform.dependsOn).toEqual([]);
  });
});

describe("the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124)", () => {
  const planted = (mod: ApiModule, source: string, name = "planted.ts") =>
    fileViolations(mod, join(MODULES_DIR, mod, name), source);

  it.each([
    ["A static deep import", `import { authorize } from "../access/policy.ts";`, /only access\/index\.ts is public/],
    [
      "A2 type-only deep import",
      `import type { Grant } from "../access/rules.ts";`,
      /only access\/index\.ts is public/,
    ],
    ["B dynamic import, literal", `const m = await import("../access/policy.ts");`, /only access\/index\.ts is public/],
    ["B2 dynamic import, template literal", "const m = await import(`../access/policy.ts`);", /only access\/index/],
    ["C re-export", `export * from "../access/rules.ts";`, /only access\/index\.ts is public/],
    [
      "D createRequire",
      `import { createRequire } from "node:module";\nconst p = createRequire(import.meta.url)("../access/policy.ts");`,
      /createRequire .* bypasses the module-interface check/,
    ],
    [
      "D2 node:module itself",
      `import * as m from "node:module";`,
      /imports non-allow-listed node built-in node:module/,
    ],
    [
      "D3 createRequire via namespace",
      `import mod from "module";\nconst r = mod.createRequire(import.meta.url);`,
      /module loader via \.createRequire\(\) .* bypasses/,
    ],
    [
      "E computed import()",
      "const p = 'policy';\nconst m = await import(`../access/${p}.ts`);",
      /computed import\(\) specifier .* bypasses/,
    ],
    ["E2 computed import() via variable", `const s = "../access/policy.ts";\nawait import(s);`, /computed import\(\)/],
    ["F require literal", `const p = require("../access/policy.ts");`, /only access\/index\.ts is public/],
    ["F2 require computed", `const p = require(["..", "access", "policy.ts"].join("/"));`, /computed require\(\)/],
    ["G import-equals require", `import p = require("../access/policy.ts");`, /only access\/index\.ts is public/],
    ["H import type()", `let g: import("../access/rules.ts").Grant;`, /only access\/index\.ts is public/],
    [
      "I composition root",
      `import { buildServer } from "../../server.ts";`,
      /outside src\/modules \(composition root\)/,
    ],
    ["J undeclared module (via its index)", `import { x } from "../reporting/index.ts";`, /may not import module/],
    ["K unknown package", `import x from "left-pad";`, /imports package left-pad/],
    // F-DG1-117: obfuscated loaders (process.getBuiltinModule with computed members, code evaluation).
    [
      "L getBuiltinModule + computed member",
      `const m = (process.getBuiltinModule("node:module") as any)["create" + "Require"](import.meta.url)("../access/policy.ts");`,
      /module loader via \.getBuiltinModule\(\) .* bypasses the module-interface check/,
    ],
    [
      "L2 computed member of process",
      `const g = (process as any)["getBuiltin" + "Module"]("node:module");`,
      /computed member of process .* bypasses/,
    ],
    [
      "L3 loader name as a string key",
      `const g = (proc as any)["getBuiltinModule"];`,
      /module loader via \["getBuiltinModule"\] .* bypasses/,
    ],
    ["L4 process aliased", `const p: any = process;\nconst g = p[k];`, /process used as a value .* bypasses/],
    ["L5 process destructured", `const { env, ...rest } = process;`, /process used as a value/],
    [
      "L6 computed member of globalThis",
      `const p = (globalThis as any)["pro" + "cess"];`,
      /computed member of globalThis/,
    ],
    ["L7 globalThis.process", `const g = globalThis.process.env;`, /globalThis\.process .* bypasses/],
    [
      "M new Function dynamic import",
      `const m = new Function("s", "return import(s)")("../access/policy.ts");`,
      /code evaluation via Function .* bypasses/,
    ],
    [
      "M2 Function() call",
      `const m = Function("return import('../access/policy.ts')")();`,
      /code evaluation via Function/,
    ],
    ["M3 Function aliased", `const F = Function;\nnew F("return 1");`, /code evaluation via Function/],
    ["M4 globalThis.Function", `const F = globalThis.Function;`, /code evaluation via \.Function/],
    ["M5 eval", `const m = eval("import('../access/policy.ts')");`, /code evaluation via eval/],
    [
      "M6 AsyncFunction via .constructor",
      `const m = (async () => {}).constructor("return import('../access/policy.ts')")();`,
      /code evaluation via \.constructor\(\)/,
    ],
    ["M7 ['constructor'] member", `const C = (() => 0)["constructor"];`, /code evaluation via \["constructor"\]/],
    // F-DG1-121: the Function/AsyncFunction/GeneratorFunction constructor reached through an ALIASED `.constructor`
    // (round-3 code-security plants first; each was missed by the round-3 lint).
    [
      "N1 AsyncFunction via aliased .constructor",
      `const C = (async () => {}).constructor as any;\nawait C("s", "return import(s)")("../access/policy.ts");`,
      /code evaluation via \.constructor \(aliased\)/,
    ],
    [
      "N2 constructor destructured",
      `const { constructor: F } = (async () => {}) as any;\nawait F("s", "return import(s)")("../access/policy.ts");`,
      /code evaluation via a destructured constructor/,
    ],
    [
      "N3 Reflect.construct of .constructor",
      `const f = Reflect.construct((async () => {}).constructor, ["s", "return import(s)"]);\nawait f("../access/policy.ts");`,
      /code evaluation via \.constructor \(aliased\)/,
    ],
    [
      "N4 getPrototypeOf(...).constructor aliased",
      `const AF = Object.getPrototypeOf(async function () {}).constructor;\nawait AF("s", "return import(s)")("../access/policy.ts");`,
      /code evaluation via \.constructor \(aliased\)/,
    ],
    [
      "N5 generator constructor, shorthand destructuring",
      `const { constructor } = function* () {} as any;\nconstructor("return import('../access/policy.ts')")().next();`,
      /code evaluation via a destructured constructor/,
    ],
    [
      "N6 destructuring assignment with a string key",
      `let G: any;\n({ "constructor": G } = async function* () {});`,
      /code evaluation via constructor as an object key/,
    ],
    [
      "N7 computed constructor key in a binding pattern",
      `const { ["constructor"]: H } = (() => 0) as any;`,
      /code evaluation via a destructured constructor/,
    ],
    [
      "N8 constructor key as a string value",
      `const C = Reflect.get(async () => {}, "constructor");`,
      /code evaluation via the "constructor" key as a value/,
    ],
    ["M8 node:vm", `import vm from "node:vm";`, /imports non-allow-listed node built-in node:vm/],
    ["M9 worker_threads", `import { Worker } from "worker_threads";`, /imports package worker_threads/],
  ])("%s is a violation", (_case, source, message) => {
    const v = planted("transformations", source);
    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
    expect(v.join("\n")).toMatch(message);
  });

  // F-DG1-124: blanket ban. The third column records what the round-4 lint (HEAD e080c0d) did with the same plant:
  // "missed" = no violation at all; "caught" = flagged (a prior form, kept as a regression guard). Verified by
  // running this table against the round-4 lint (handback T-DG1-BE6).
  it.each([
    [
      'P1 constructed key f["constr" + "uctor"]',
      `const f = async () => {};\nconst C = (f as any)["constr" + "uctor"];\nawait C("s", "return import(s)")("../access/policy.ts");`,
      /computed member with a non-literal key/,
      "missed",
    ],
    [
      'P2 Reflect.get(fn, "constructor")',
      `const C = Reflect.get(async () => {}, "constructor");\nawait C("s", "return import(s)")("../access/policy.ts");`,
      /reflection via Reflect /,
      "caught",
    ],
    [
      "P3 Reflect.get with a constructed key",
      `const C = Reflect.get(async () => {}, "constr".concat("uctor"));\nawait C("s", "return import(s)")("../access/policy.ts");`,
      /reflection via Reflect /,
      "missed",
    ],
    [
      "P4 constructed key held in a variable",
      `const k = ["constr", "uctor"].join("");\nconst C = ((async () => {}) as any)[k];`,
      /computed member with a non-literal key/,
      "missed",
    ],
    [
      "P5 template-literal key",
      "const C = ((async () => {}) as any)[`constr${'uctor'}`];",
      /non-literal key/,
      "missed",
    ],
    [
      "P6 optional-chain constructed key",
      `const C = ((async () => {}) as any)?.["constr" + "uctor"];`,
      /non-literal/,
      "missed",
    ],
    [
      "P7 constructed key in a destructuring pattern",
      `const k = "constr" + "uctor";\nconst { [k]: C } = (async () => {}) as any;`,
      /computed property name with a non-literal key/,
      "missed",
    ],
    [
      "P8 descriptors: the constructor without its name",
      `const d = Object.getOwnPropertyDescriptors(Object.getPrototypeOf(async () => {}));\nconst C = Object.values(d)[0]!.value;`,
      /reflection via \.getOwnPropertyDescriptors\(\)/,
      "missed",
    ],
    [
      "P9 own property names, then a variable key",
      `const proto = Object.getPrototypeOf(async () => {});\nconst k = Object.getOwnPropertyNames(proto)[0]!;\nconst C = proto[k];`,
      /reflection via \.getOwnPropertyNames\(\)[\s\S]*non-literal key/,
      "missed",
    ],
    ["P10 __proto__", `const P = ((async () => {}) as any).__proto__;`, /reflection via \.__proto__/, "missed"],
    [
      "P11 loader name as a string handed to a helper",
      `declare function pick(o: unknown, k: string): any;\nconst r = pick(lib, "createRequire");`,
      /module loader via the "createRequire" key as a value/,
      "missed",
    ],
    [
      "P12 process.binding",
      `const fs = (process as any).binding("fs");`,
      /non-allow-listed process\.binding member/,
      "missed",
    ],
    [
      "P13 node:inspector (in-process evaluation)",
      `import { Session } from "node:inspector";`,
      /non-allow-listed node built-in node:inspector/,
      "missed",
    ],
    [
      "P14 node:child_process",
      `import { execFileSync } from "node:child_process";`,
      /non-allow-listed node built-in node:child_process/,
      "missed",
    ],
    [
      "P15 look-alike member o.eval (was an allowed form)",
      `const o = { eval: (s: string) => s };\no.eval("x");`,
      /code evaluation via \.eval\(\)/,
      "missed",
    ],
    [
      "P16 constructor as an object key, fed to a keyed reader (was an allowed form)",
      `declare const shape: (s: object) => { parse(v: unknown): any };\nconst C = shape({ constructor: 1 }).parse(Object.getPrototypeOf(async () => {}));`,
      /code evaluation via constructor as an object key/,
      "missed",
    ],
    [
      "P20 a syntax error fails closed (parser recovery hid P4's key)",
      `const k = "constr" + "uctor";\nconst C = (async () => {} as any)[k];`,
      /unparseable source: '\)' expected/,
      "missed",
    ],
    // F-DG1-125: an import of the process module aliased it past rule 3 (which only knows the global identifier
    // `process`). Importing `process` / `node:process` is now itself a specifier violation (D-055: not allow-listed).
    [
      "X6 node:process default import .dlopen",
      `import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`,
      /imports non-allow-listed node built-in node:process/,
      "missed",
    ],
    [
      "X7 node:process default import .binding",
      `import proc from "node:process";\nconst fs = (proc as any).binding("fs");`,
      /imports non-allow-listed node built-in node:process/,
      "missed",
    ],
    [
      "X8 node:process named import dlopen",
      `import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");`,
      /imports non-allow-listed node built-in node:process/,
      "missed",
    ],
    // F-DG1-127 A1: node:sqlite's loadExtension loads a native shared object (same class as process.dlopen), so
    // `node:sqlite` is denied (D-055: not allow-listed). A2 (write a file with node:fs, then `import("./gen.mjs")`) is
    // NOT a case here: it is the stated, accepted residual of this static lint (architecture.testkit.ts header).
    [
      "A1 node:sqlite loadExtension",
      `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/tmp/x.so");`,
      /imports non-allow-listed node built-in node:sqlite/,
      "missed",
    ],
    // F-DG1-128: the last two concrete loader/exec routes of the pinned Node version (round-7 builtinModules +
    // process.* sweep). R1: node:test `run({ files, isolation: "none" })` imports a runtime-computed path IN-PROCESS
    // (a loader built-in, no code generation), now denied by default (D-055). R2: the global
    // `process.execve` replaces the process with an arbitrary executable (the child_process/cluster class), so
    // `execve` is denied by default (D-055, rule 3). "missed" = 0 violations before this fix.
    [
      "R1 node:test in-process run",
      `import { run } from "node:test";\nconst p = ["../access/", "policy.ts"].join("");\nfor await (const _ of run({ files: [new URL(p, import.meta.url).pathname], isolation: "none" })) {}`,
      /imports non-allow-listed node built-in node:test/,
      "missed",
    ],
    [
      "R2 process.execve",
      `process.execve("/bin/sh", ["sh", "-c", "id"]);`,
      /non-allow-listed process\.execve member/,
      "missed",
    ],
    // Prior forms (F-DG1-117/121), still caught: regression guards for the blanket rules.
    ["P17 module.constructor", `const M = module.constructor;`, /module used as a value[\s\S]*\.constructor/, "caught"],
    [
      "P18 aliased AsyncFunction constructor (F-DG1-121 N1)",
      `const C = (async () => {}).constructor as any;\nawait C("s", "return import(s)")("../access/policy.ts");`,
      /code evaluation via \.constructor \(aliased\)/,
      "caught",
    ],
    [
      "P19 new Function (F-DG1-117 M)",
      `new Function("s", "return import(s)");`,
      /code evaluation via Function /,
      "caught",
    ],
  ])("%s is a violation (round-4 lint: $3)", (_case, source, message, _before) => {
    const v = planted("transformations", source);
    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
    expect(v.join("\n")).toMatch(message);
  });

  // D-055 / F-DG1-129, F-DG1-213, F-DG1-010: DEFAULT-DENY for node: built-ins and process.* members. The third column
  // records what the round-8 lint (HEAD ed43620, denylists LOADER_BUILTINS / PROCESS_LOADERS) did with the same plant:
  // "missed" = 0 violations; "caught" = flagged by the old denylist (kept as a regression guard).
  it.each([
    [
      "DD1 process.kill(self, SIGUSR1) starts the inspector (F-DG1-129 N1)",
      `process.kill(process.pid, "SIGUSR1");`,
      /non-allow-listed process\.kill member/,
      "missed",
    ],
    [
      "DD2 process._debugProcess(self) (F-DG1-129 N2 / F-DG1-213 D2)",
      `process._debugProcess(process.pid);`,
      /non-allow-listed process\._debugProcess member/,
      "missed",
    ],
    [
      "DD3 process._kill",
      `(process as any)._kill(process.pid, 10);`,
      /non-allow-listed process\._kill member/,
      "missed",
    ],
    [
      "DD4 F-DG1-213 D1 full route as module source",
      `process._debugProcess(process.pid);\nconst l = await (await fetch("http://127.0.0.1:9229/json/list")).json();\nconst ws = new WebSocket(l[0].webSocketDebuggerUrl);\nws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "1" } }));`,
      /non-allow-listed process\._debugProcess member/,
      "missed",
    ],
    ["DD5 process.execve", `process.execve("/bin/sh", ["sh"]);`, /non-allow-listed process\.execve member/, "caught"],
    ["DD6 process.binding", `(process as any).binding("fs");`, /non-allow-listed process\.binding member/, "caught"],
    [
      "DD7 process.dlopen",
      `process.dlopen({ exports: {} } as any, "/tmp/x.node");`,
      /process\.dlopen member/,
      "caught",
    ],
    ["DD8 process.abort", `process.abort();`, /non-allow-listed process\.abort member/, "missed"],
    [
      "DD9 optional-chained process?.kill",
      `process?.kill(process.pid, "SIGUSR1");`,
      /non-allow-listed process\.kill member/,
      "missed",
    ],
    [
      "DD10 node:inspector",
      `import { Session } from "node:inspector";`,
      /imports non-allow-listed node built-in node:inspector/,
      "caught",
    ],
    [
      "DD11 node:inspector/promises",
      `import { Session } from "node:inspector/promises";`,
      /non-allow-listed node built-in node:inspector\/promises/,
      "caught",
    ],
    [
      "DD12 node:sqlite",
      `import { DatabaseSync } from "node:sqlite";`,
      /imports non-allow-listed node built-in node:sqlite/,
      "caught",
    ],
    [
      "DD13 node:test",
      `import { run } from "node:test";`,
      /imports non-allow-listed node built-in node:test/,
      "caught",
    ],
    ["DD14 node:vm", `import vm from "node:vm";`, /imports non-allow-listed node built-in node:vm/, "caught"],
    [
      "DD15 node:worker_threads",
      `import { Worker } from "node:worker_threads";`,
      /imports non-allow-listed node built-in node:worker_threads/,
      "caught",
    ],
    ["DD16 node:wasi", `import { WASI } from "node:wasi";`, /non-allow-listed node built-in node:wasi/, "missed"],
    ["DD17 node:v8", `import v8 from "node:v8";`, /non-allow-listed node built-in node:v8/, "missed"],
    ["DD18 node:http", `import { request } from "node:http";`, /non-allow-listed node built-in node:http/, "missed"],
    ["DD19 node:net", `import { connect } from "node:net";`, /non-allow-listed node built-in node:net/, "missed"],
    [
      "DD20 a built-in a later Node version might add",
      `const x = await import("node:some-future-builtin");`,
      /non-allow-listed node built-in node:some-future-builtin/,
      "missed",
    ],
  ])("%s is a violation (default-deny; round-8 lint: $3)", (_case, source, message, _before) => {
    const v = planted("transformations", source);
    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
    expect(v.join("\n")).toMatch(message);
  });

  it("default-deny keeps the allow-listed built-ins and process members clean (D-055 positive controls)", () => {
    const allowed = [
      `import { randomUUID } from "node:crypto";`,
      `import { readFileSync } from "node:fs";`,
      `import { readFile } from "node:fs/promises";`,
      `import { join } from "node:path";`,
      `import { pathToFileURL } from "node:url";`,
      `import { EOL } from "node:os";`,
      `import { inspect } from "node:util";`,
      `const e = process.env.X;`,
      `const argv = process.argv;`,
      `process.once("SIGTERM", () => process.exit(0));`,
      `if (!e) process.exit(1);`,
      `export const id = randomUUID() + readFileSync(join("a", "b"), "utf8") + pathToFileURL("/x").href;`,
    ].join("\n");
    expect(planted("transformations", allowed)).toEqual([]);
  });

  it("allowed forms stay clean (public index of a declared dependency, shared packages, own files)", () => {
    const clean = [
      `import { authorize } from "../access/index.ts";`,
      `import type { Grant } from "../access/index.ts";`,
      `const a = await import("../access/index.ts");`,
      `import { sql } from "@mth/db";`,
      `import { randomBytes } from "node:crypto";`,
      `import { toTransformation } from "./repository.ts";`,
      `export { x } from "./routes.ts";`,
      // F-DG1-117 rules must not flag ordinary code: member reads of process, look-alike property names, types.
      `const tz = process.env.TZ;`,
      `const n = (process as NodeJS.Process).env.TZ;`,
      `const o = { process: 1, env: 2 };\nconst e = o.process + o.env;`,
      `let t: typeof process.env | undefined;`,
      `class K { constructor() {} }\nconst k = new K();`,
      // A class's own constructor declaration and type positions stay clean (F-DG1-121, F-DG1-124).
      `class P { constructor(private readonly n: number) {} }`,
      `interface I { constructor: string; eval(): void; require: boolean }`,
      `type R = typeof Reflect;\nlet k: "constructor" | "getPrototypeOf" = "x" as never;`,
      // F-DG1-124 rule 2 allows keys it can read: literals and numeric-by-construction expressions.
      `const xs = [1, 2];\nconst last = xs[xs.length - 1];\nconst first = xs[0];\nconst h = { a: 1 }["a"];`,
      `const m = new Map([["a", 1]]);\nconst v = m.get(String(xs));`,
      `const mod = { module: "kpi" };\nconst n = mod.module;`,
    ].join("\n");
    expect(planted("transformations", clean)).toEqual([]);
  });

  it("a module's own test may read the module map and the lint, but its runtime files may not", () => {
    const src = `import { API_MODULES } from "../../modules.ts";\nimport { moduleViolations } from "../../architecture.testkit.ts";`;
    expect(planted("kpi", src, "kpi.test.ts")).toEqual([]);
    expect(planted("kpi", src, "index.ts").join("\n")).toMatch(/composition root/);
    expect(planted("kpi", `import { buildServer } from "../../server.ts";`, "kpi.test.ts").join("\n")).toMatch(
      /composition root/,
    );
  });

  it("a scaffold may not reach a business module it does not declare (reporting -> workflows)", () => {
    expect(planted("reporting", `import { PRODUCT_GATES } from "../workflows/index.ts";`).join("\n")).toMatch(
      /module reporting may not import module workflows/,
    );
    expect(planted("access", `import { KPI_MODULE } from "../kpi/index.ts";`).join("\n")).toMatch(
      /module access may not import module kpi/,
    );
  });

  it("scanSource reports what it saw (paths resolve relative to the planted file)", () => {
    const rel = relative(MODULES_DIR, resolve(join(MODULES_DIR, "transformations"), "../access/policy.ts"));
    expect(rel.split("/")).toEqual(["access", "policy.ts"]);
    expect(scanSource("x.ts", `import "a"; export * from "b"; await import("c"); require("d");`).specifiers).toEqual([
      "a",
      "b",
      "c",
      "d",
    ]);
    expect(bareAllowed("@mth/web")).toBe(false);
    expect(bareAllowed("fastify")).toBe(true);
    expect(bareAllowed("node:module")).toBe(false);
    // D-055 default-deny: allow-listed node: built-ins pass, everything else (incl. unknown future ones) does not.
    expect(bareAllowed("node:crypto")).toBe(true);
    expect(bareAllowed("node:fs/promises")).toBe(true);
    expect(bareAllowed("node:inspector")).toBe(false);
    expect(bareAllowed("node:http")).toBe(false);
    expect(bareAllowed("node:some-future-builtin")).toBe(false);
    expect(bareAllowed("fs")).toBe(false);
  });
});

describe("package dependency direction (ADR-0002 rule 5)", () => {
  const workspaceImports = (dir: string) =>
    walk(join(REPO, dir)).flatMap((f) =>
      importsOf(f)
        .filter((s) => s.startsWith("@mth/"))
        .map((s) => `${relative(REPO, f)} -> ${s}`),
    );

  it("packages/db imports only @mth/config and @mth/shared", () => {
    expect(workspaceImports("packages/db/src").filter((l) => !/-> @mth\/(config|shared)(\/schemas)?$/.test(l))).toEqual(
      [],
    );
  });
  it("packages/config imports only @mth/shared", () => {
    expect(workspaceImports("packages/config/src").filter((l) => !/-> @mth\/shared(\/schemas)?$/.test(l))).toEqual([]);
  });
  it("packages/shared imports no workspace package", () => {
    expect(workspaceImports("packages/shared/src")).toEqual([]);
  });
  it("apps/web never imports @mth/db or @mth/config (browser bundle, no secrets)", () => {
    expect(workspaceImports("apps/web/src").filter((l) => /-> @mth\/(db|config)/.test(l))).toEqual([]);
  });
  it("apps/worker imports no API code", () => {
    const deep = walk(join(REPO, "apps/worker/src")).flatMap((f) =>
      importsOf(f).filter((s) => s.includes("apps/api") || s.startsWith("@mth/api")),
    );
    expect(deep).toEqual([]);
  });
});
