// code-security-reviewer DG3 round-3 guard-bypass probe (T-DG3-REV-SEC-R3). Disposable clone ONLY ($TMPDIR/probe);
// never run in the candidate tree. Usage: node guard-bypass-probe-r3.mjs <clone-root> [form-id ...]
//
// Extends the round-2 probe (round-2/probes/guard-bypass-probe.mjs, forms O1-O6 and N1-N12 copied verbatim) with the
// run-time layer of ADR-0024 §6 and with new round-3 attempts (R*). For each form:
//   P0  evaluate.ts := original + snippet (the form is exported but never called)
//       (1) eslint on the touched file(s)                      layer 1
//       (2) fuzz.test.ts -t "engine sources contain" (unit-node) layer 2
//       (3) tsc -p packages/shared --noEmit                      informational
//       (4) vitest run --project unit-formula-nocodegen          layer 3 (the second command of `pnpm test`)
//   P1  as P0, plus `__probeHook()` as the first statement of evaluateAst: the form runs at EVALUATION time (not at
//       import), unguarded. (4) again, and (5) unit-node on the formula tests (shows the form works without the flag).
//   P2  as P1, but the hook wraps the form in try { … } catch { /* fallback */ }: the adversarial catch-and-fallback.
//       (4) again.
// A form "passes all three layers" in a placement when (1), (2) and (4) all exit 0. The files are restored from their
// original bytes afterwards (finally), and git status is printed.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !/\/probe$/.test(root)) throw new Error("refusing: pass the disposable clone $TMPDIR/probe");
const only = new Set(process.argv.slice(3));
const EVAL = `${root}/packages/shared/src/formula/evaluate.ts`;
const VALUE = `${root}/packages/shared/src/value.ts`;
const originals = { [EVAL]: readFileSync(EVAL, "utf8"), [VALUE]: readFileSync(VALUE, "utf8") };
const ENTRY = "export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {\n";
if (!originals[EVAL].includes(ENTRY)) throw new Error("evaluateAst entry not found");

const R = `as unknown as Record<string, (s: string) => () => unknown>`;
// [id, description, snippet appended to evaluate.ts, name of the exported function, optional {value: snippet appended to value.ts}]
const FORMS = [
  ["O1", "Reflect.construct(Function, …)", `export const __o1 = (): unknown => Reflect.construct(Function, ["return 1"]);`, "__o1"],
  [
    "O2",
    "globalThis['ev'+'al']",
    `export const __o2 = (): unknown => (globalThis as unknown as Record<string, (s: string) => unknown>)["ev" + "al"]!("1");`,
    "__o2",
  ],
  [
    "O3",
    "createRequire(import.meta.url)('vm')",
    `import { createRequire } from "node:module";\nexport const __o3 = (): unknown => (createRequire(import.meta.url)("vm") as { runInThisContext(c: string): unknown }).runInThisContext("6*7");`,
    "__o3",
  ],
  ["O4", "Reflect.apply(Function, …)", `export const __o4 = (): unknown => Reflect.apply(Function, null, ["return 1"]);`, "__o4"],
  [
    "O5",
    "computed ['constructor'] on a generator prototype",
    `export const __o5 = (): unknown => (Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => unknown>)["constructor"]!("yield 1");`,
    "__o5",
  ],
  ["O6", "alias F = Function", `const __F = Function;\nexport const __o6 = (): unknown => __F("return 1");`, "__o6"],
  [
    "N1",
    "computed member with an identifier key: f[k] where k = 'constructor'",
    `const __k1 = "constructor";\nexport const __n1 = (): unknown => ((() => 0) ${R})[__k1]!("return 6*7")();`,
    "__n1",
  ],
  [
    "N2",
    "computed member with a concatenated key: f['con' + 'structor']",
    `export const __n2 = (): unknown => ((() => 0) ${R})["con" + "structor"]!("return 6*7")();`,
    "__n2",
  ],
  [
    "N3",
    "Object.getOwnPropertyDescriptor(fnProto, 'constructor').value",
    `export const __n3 = (): unknown =>\n  (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor")!.value as (s: string) => () => unknown)("return 6*7")();`,
    "__n3",
  ],
  [
    "N4",
    "destructuring with a computed identifier key: const { [k]: C } = generator prototype",
    `const __k4 = "constructor";\nconst { [__k4]: __C4 } = Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => () => Iterator<unknown>>;\nexport const __n4 = (): unknown => __C4!("yield 6*7")().next().value;`,
    "__n4",
  ],
  [
    "N5",
    "AsyncFunction through the prototype, key built with join",
    `const __k5 = ["con", "structor"].join("");\nexport const __n5 = (): unknown => (Object.getPrototypeOf(async () => 0) as Record<string, (s: string) => () => Promise<unknown>>)[__k5]!("return 6*7")();`,
    "__n5",
  ],
  [
    "N6",
    "tagged template on the constructor reached by an identifier key",
    "const __k6 = \"constructor\";\nexport const __n6 = (): unknown => ((() => 0) as unknown as Record<string, (s: TemplateStringsArray) => () => unknown>)[__k6]!`return 6*7`();",
    "__n6",
  ],
  [
    "N7",
    "Node 'global' indexing: global['ev'+'al']",
    `declare const global: Record<string, (s: string) => unknown>;\nexport const __n7 = (): unknown => global["ev" + "al"]!("6*7");`,
    "__n7",
  ],
  [
    "N8",
    "browser 'self' indexing: self['ev'+'al']",
    `declare const self: Record<string, (s: string) => unknown>;\nexport const __n8 = (): unknown => self["ev" + "al"]!("6*7");`,
    "__n8",
  ],
  [
    "N9",
    "process.getBuiltinModule('node:vm').runInThisContext",
    `declare const process: { getBuiltinModule(id: string): { runInThisContext(code: string): unknown } };\nexport const __n9 = (): unknown => process.getBuiltinModule("node:vm").runInThisContext("6*7");`,
    "__n9",
  ],
  [
    "N10",
    "static import of node:inspector, Runtime.evaluate",
    `import { Session } from "node:inspector";\nexport const __n10 = (): void => {\n  const s = new Session();\n  s.connect();\n  s.post("Runtime.evaluate", { expression: "6*7" }, () => undefined);\n};`,
    "__n10",
  ],
  ["N11", "static import of node:repl", `import * as __repl from "node:repl";\nexport const __n11 = (): unknown => __repl.start;`, "__n11"],
  [
    "N12",
    "import.meta.resolve (resolves a specifier; loads and runs nothing)",
    `export const __n12 = (): unknown => import.meta.resolve("node:vm");`,
    "__n12",
  ],
  // ---- round-3 attempts
  [
    "R1",
    "ADR-stated residual: ordinary function variable f, key joined from non-'constructor' literals, f[k](code)",
    `const __f1 = (): number => 0;\nconst __r1k = ["con", "struc", "tor"].join("");\nexport const __r1 = (): unknown => (__f1 ${R})[__r1k]!("return 6*7")();`,
    "__r1",
  ],
  [
    "R2",
    "key from String.fromCharCode on Decimal (a function) itself",
    `const __r2k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\nexport const __r2 = (): unknown => (Decimal ${R})[__r2k]!("return 6*7")();`,
    "__r2",
  ],
  [
    "R3",
    "TypeScript import-equals require: import vm = require('node:vm')",
    `import __vm = require("node:vm");\nexport const __r3 = (): unknown => __vm.runInThisContext("6*7");`,
    "__r3",
  ],
  [
    "R4",
    "re-export namespace of node:vm: export * as v from 'node:vm'",
    `export * as __r4ns from "node:vm";\nexport const __r4 = (): unknown => 0;`,
    "__r4",
  ],
  [
    "R5",
    "transitive: allowlisted ../value.ts (outside the formula guard) imports node:vm; the engine calls its helper",
    `import { __valueRun } from "../value.ts";\nexport const __r5 = (): unknown => __valueRun("6*7");`,
    "__r5",
    { value: `import { runInThisContext as __rit } from "node:vm";\nexport const __valueRun = (c: string): unknown => __rit(c);` },
  ],
  [
    "R6",
    "transitive: allowlisted ../value.ts uses new Function; the engine calls its helper",
    `import { __valueFn } from "../value.ts";\nexport const __r6 = (): unknown => __valueFn("return 6*7");`,
    "__r6",
    // eslint has no-new-func only in the formula block; value.ts gets the generic rules
    { value: `export const __valueFn = (c: string): unknown => new Function(c)();` },
  ],
  [
    "R7",
    "WebAssembly.Module from bytes (not JS code generation; listed for completeness)",
    `export const __r7 = (): unknown => new WebAssembly.Module(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));`,
    "__r7",
  ],
];

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 << 20 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const pick = (out, re, max = 12) =>
  out
    .split("\n")
    .filter((l) => re.test(l))
    .slice(0, max)
    .map((l) => `      ${l.trim()}`)
    .join("\n");
const write = (evalText, valueExtra) => {
  writeFileSync(EVAL, evalText);
  writeFileSync(VALUE, valueExtra ? `${originals[VALUE]}\n// --- reviewer probe (disposable clone only) ---\n${valueExtra}\n` : originals[VALUE]);
};
const NOCODEGEN = ["vitest", "run", "--project", "unit-formula-nocodegen"];
const UNIT_FORMULA = ["vitest", "run", "--project", "unit-node", "packages/shared/src/formula/"];
const TEST_LINES = /Test Files|Tests +\d|EvalError|FAIL |×|Error:/;

const summary = [];
try {
  for (const [id, what, snippet, fn, extra] of FORMS) {
    if (only.size && !only.has(id)) continue;
    const appended = `${originals[EVAL]}\n// --- reviewer probe ${id} (disposable clone only) ---\n${snippet}\n`;
    console.log(`\n=== ${id}: ${what}\n--- snippet (evaluate.ts):\n${snippet}`);
    if (extra?.value) console.log(`--- snippet (value.ts):\n${extra.value}`);

    // P0: exported, never called
    write(appended, extra?.value);
    const lintFiles = ["packages/shared/src/formula/evaluate.ts", ...(extra?.value ? ["packages/shared/src/value.ts"] : [])];
    const lint = sh("npx", ["eslint", ...lintFiles]);
    const scan = sh("pnpm", ["vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", "engine sources contain"]);
    const tsc = sh("npx", ["tsc", "-p", "packages/shared", "--noEmit"]);
    const rt0 = sh("pnpm", NOCODEGEN);
    console.log(`  [P0] eslint exit=${lint.code}\n${pick(lint.out, /error|problem/)}`);
    console.log(`  [P0] source-scan exit=${scan.code}\n${pick(scan.out, /AssertionError|\+ +"|Tests +\d/)}`);
    console.log(`  [P0] tsc (informational) exit=${tsc.code}\n${pick(tsc.out, /error TS/, 4)}`);
    console.log(`  [P0] unit-formula-nocodegen exit=${rt0.code}\n${pick(rt0.out, TEST_LINES)}`);

    // P1: called at evaluation time, unguarded
    const hooked = appended.replace(ENTRY, `${ENTRY}  __probeHook();\n`) + `const __probeHook = (): void => {\n  void ${fn}();\n};\n`;
    write(hooked, extra?.value);
    const rt1 = sh("pnpm", NOCODEGEN);
    const un1 = sh("pnpm", UNIT_FORMULA);
    console.log(`  [P1] unit-formula-nocodegen exit=${rt1.code}\n${pick(rt1.out, TEST_LINES)}`);
    console.log(`  [P1] unit-node formula tests (no flag; informational) exit=${un1.code}\n${pick(un1.out, TEST_LINES, 6)}`);

    // P2: called at evaluation time, inside a local catch-and-fallback
    const fallback =
      appended.replace(ENTRY, `${ENTRY}  __probeHook();\n`) +
      `const __probeHook = (): void => {\n  try {\n    void ${fn}();\n  } catch {\n    // fallback: the AST walker below\n  }\n};\n`;
    write(fallback, extra?.value);
    const rt2 = sh("pnpm", NOCODEGEN);
    console.log(`  [P2] unit-formula-nocodegen exit=${rt2.code}\n${pick(rt2.out, TEST_LINES)}`);

    const s = lint.code !== 0 ? "lint" : "";
    const layers = (rt) =>
      [lint.code !== 0 && "lint", scan.code !== 0 && "scan", rt.code !== 0 && "run-time"].filter(Boolean).join("+") || "NONE (passes all three)";
    const line = `${id.padEnd(4)} eslint=${lint.code} scan=${scan.code} tsc=${tsc.code} | nocodegen P0=${rt0.code} P1=${rt1.code} P2=${rt2.code} | unit-node P1=${un1.code} | refused by: P0 ${layers(rt0)}; P1 ${layers(rt1)}; P2 ${layers(rt2)}  (${what})`;
    void s;
    console.log(`  ==> ${line}`);
    summary.push(line);
  }
} finally {
  writeFileSync(EVAL, originals[EVAL]);
  writeFileSync(VALUE, originals[VALUE]);
}
const st = sh("git", ["status", "--porcelain", "packages/shared"]);
console.log(`\n# evaluate.ts and value.ts restored; git status packages/shared: '${st.out.trim()}'`);
console.log(`\n# SUMMARY\n${summary.join("\n")}`);
