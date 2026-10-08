// code-security-reviewer DG3 round-3 (T-DG3-REV-SEC-R3B) three-layer guard probe for F-DG3-100.
// Disposable clone ONLY ($TMPDIR/review-p3 at ce988e20); never run in the candidate tree. Usage:
//   node guard-layers-probe.mjs <clone-root> [form-id ...]
//
// For each form, the clone's engine is modified as described below, then four things run in the clone:
//   (1) LINT  : npx eslint <every modified file>                            (ADR-0024 §6 layer 1)
//   (2) SCAN  : vitest --project unit-node fuzz.test.ts -t "engine sources contain"   (layer 2)
//   (3) RUN   : vitest run --project unit-formula-nocodegen   (layer 3; the exact second command of `pnpm test`)
//   (4) CTRL  : vitest run --project unit-node packages/shared/src/formula   (control: same tests WITHOUT the flag)
// and every modified file is restored from its original bytes afterwards (git status is printed at the end).
//
// Exercising the form at EVALUATION time (not import time): unless a form says otherwise, its snippet is appended to
// evaluate.ts and a call `__rp();` is inserted as the first statement of evaluateAst(), so every evaluation the tests
// perform runs it. A form is "refused at run time" when at least one test fails in (3) that passes in (4), i.e. the
// failure is due to the flag (revision 2; revision 1 required (4) to pass outright, which the static scan and the
// globalThis.Function tripwire inside fuzz.test.ts make impossible for statically refused forms).
//
// Forms: O1-O6 (round 1) and N1-N12 (round 2) verbatim from round-2 guard-bypass-probe.mjs, except O3, which also calls
// runInThisContext so that it is a code-execution form (its static spelling is unchanged). Q* and V* are new round-3
// attempts. S1/S2 test whether the run-time layer catches a code-generating path that the tests DO exercise.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p3")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p3");
const only = new Set(process.argv.slice(3));
const F = {
  evaluate: `${root}/packages/shared/src/formula/evaluate.ts`,
  tokenize: `${root}/packages/shared/src/formula/tokenize.ts`,
  value: `${root}/packages/shared/src/value.ts`,
};
const ORIG = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, readFileSync(p, "utf8")]));
const HOOK_AT = "export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {\n";
if (!ORIG.evaluate.includes(HOOK_AT)) throw new Error("evaluateAst signature not found");

/** evaluate.ts with `snippet` appended and evaluateAst() calling `fn` first. */
const hooked = (snippet, fn) =>
  ORIG.evaluate.replace(HOOK_AT, `${HOOK_AT}  __rp();\n`) +
  `\n// --- reviewer probe (disposable clone only) ---\n${snippet}\nfunction __rp(): void {\n  void ${fn}();\n}\n`;

const R = `as unknown as Record<string, (s: string) => () => unknown>`;
/** [id, description, { evaluate?, tokenize?, value? } file contents] */
const FORMS = [
  ["O1", "Reflect.construct(Function, …)", { evaluate: hooked(`export const __o1 = (): unknown => Reflect.construct(Function, ["return 1"]);`, "__o1") }],
  ["O2", "globalThis['ev'+'al']", { evaluate: hooked(`export const __o2 = (): unknown => (globalThis as unknown as Record<string, (s: string) => unknown>)["ev" + "al"]!("1");`, "__o2") }],
  ["O3", "createRequire(import.meta.url)('vm').runInThisContext", { evaluate: hooked(`import { createRequire } from "node:module";\nexport const __o3 = (): unknown => (createRequire(import.meta.url)("vm") as { runInThisContext(s: string): unknown }).runInThisContext("6*7");`, "__o3") }],
  ["O4", "Reflect.apply(Function, …)", { evaluate: hooked(`export const __o4 = (): unknown => Reflect.apply(Function, null, ["return 1"]);`, "__o4") }],
  ["O5", "computed ['constructor'] on a generator prototype", { evaluate: hooked(`export const __o5 = (): unknown => (Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => unknown>)["constructor"]!("yield 1");`, "__o5") }],
  ["O6", "alias F = Function", { evaluate: hooked(`const __F = Function;\nexport const __o6 = (): unknown => __F("return 1");`, "__o6") }],
  ["N1", "f[k], k = 'constructor'", { evaluate: hooked(`const __k1 = "constructor";\nexport const __n1 = (): unknown => ((() => 0) ${R})[__k1]!("return 6*7")();`, "__n1") }],
  ["N2", "f['con' + 'structor']", { evaluate: hooked(`export const __n2 = (): unknown => ((() => 0) ${R})["con" + "structor"]!("return 6*7")();`, "__n2") }],
  ["N3", "getOwnPropertyDescriptor(fnProto, 'constructor').value", { evaluate: hooked(`export const __n3 = (): unknown =>\n  (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor")!.value as (s: string) => () => unknown)("return 6*7")();`, "__n3") }],
  ["N4", "const { [k]: C } = generator prototype", { evaluate: hooked(`const __k4 = "constructor";\nconst { [__k4]: __C4 } = Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => () => Iterator<unknown>>;\nexport const __n4 = (): unknown => __C4!("yield 6*7")().next().value;`, "__n4") }],
  ["N5", "AsyncFunction via prototype, join-built key", { evaluate: hooked(`const __k5 = ["con", "structor"].join("");\nexport const __n5 = (): unknown => (Object.getPrototypeOf(async () => 0) as Record<string, (s: string) => () => Promise<unknown>>)[__k5]!("return 6*7")();`, "__n5") }],
  ["N6", "tagged template f[k]`…`", { evaluate: hooked("const __k6 = \"constructor\";\nexport const __n6 = (): unknown => ((() => 0) as unknown as Record<string, (s: TemplateStringsArray) => () => unknown>)[__k6]!`return 6*7`();", "__n6") }],
  ["N7", "global['ev'+'al']", { evaluate: hooked(`declare const global: Record<string, (s: string) => unknown>;\nexport const __n7 = (): unknown => global["ev" + "al"]!("6*7");`, "__n7") }],
  ["N8", "self['ev'+'al'] (browser form)", { evaluate: hooked(`declare const self: Record<string, (s: string) => unknown>;\nexport const __n8 = (): unknown => self["ev" + "al"]!("6*7");`, "__n8") }],
  ["N9", "process.getBuiltinModule('node:vm').runInThisContext", { evaluate: hooked(`declare const process: { getBuiltinModule(id: string): { runInThisContext(code: string): unknown } };\nexport const __n9 = (): unknown => process.getBuiltinModule("node:vm").runInThisContext("6*7");`, "__n9") }],
  ["N10", "node:inspector Runtime.evaluate", { evaluate: hooked(`import { Session } from "node:inspector";\nexport const __n10 = (): void => {\n  const s = new Session();\n  s.connect();\n  s.post("Runtime.evaluate", { expression: "6*7" }, () => undefined);\n  s.disconnect();\n};`, "__n10") }],
  ["N11", "static import of node:repl", { evaluate: hooked(`import * as __repl from "node:repl";\nexport const __n11 = (): unknown => __repl.start;`, "__n11") }],
  ["N12", "import.meta.resolve (loads nothing)", { evaluate: hooked(`export const __n12 = (): unknown => import.meta.resolve("node:vm");`, "__n12") }],
  // ---- new round-3 attempts at the static class (ordinary function variable + key from a value no static rule sees)
  ["Q1", "key harvested: Object.getOwnPropertyNames(Object.prototype) -> 'constructor'; fnVar[k]", { evaluate: hooked(`function __q1f(): void {}\nexport const __q1 = (): unknown => {\n  const k = Object.getOwnPropertyNames(Object.prototype).find((n) => n.length === 11 && n.startsWith("co"))!;\n  return (__q1f as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 6*7")();\n};`, "__q1") }],
  ["Q2", "key from String.fromCharCode(numbers); fnVar[k]", { evaluate: hooked(`function __q2f(): void {}\nexport const __q2 = (): unknown => {\n  const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n  return (__q2f as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 6*7")();\n};`, "__q2") }],
  ["Q3", "key from atob('Y29uc3RydWN0b3I=')", { evaluate: hooked(`function __q3f(): void {}\nexport const __q3 = (): unknown =>\n  (__q3f as unknown as Record<string, (s: string) => () => unknown>)[atob("Y29uc3RydWN0b3I=")]!("return 6*7")();`, "__q3") }],
  ["Q4", "key from decodeURIComponent('%63onstructor')", { evaluate: hooked(`function __q4f(): void {}\nexport const __q4 = (): unknown =>\n  (__q4f as unknown as Record<string, (s: string) => () => unknown>)[decodeURIComponent("%63onstructor")]!("return 6*7")();`, "__q4") }],
  ["Q5", "key reversed: 'rotcurtsnoc'.split('').reverse().join('')", { evaluate: hooked(`function __q5f(): void {}\nexport const __q5 = (): unknown => {\n  const k = "rotcurtsnoc".split("").reverse().join("");\n  return (__q5f as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 6*7")();\n};`, "__q5") }],
  // ---- the allowlisted ../value.ts is outside every formula rule: put the code generation there, called by the engine
  ["V1", "node:vm in the allowlisted ../value.ts (checkDecimal runs vm.runInThisContext)", {
    value: ORIG.value.replace('import { Decimal } from "decimal.js";', 'import { Decimal } from "decimal.js";\nimport { runInThisContext } from "node:vm";')
      .replace("export function checkDecimal(input: unknown, column?: DecimalColumn): DecimalCheck {\n", "export function checkDecimal(input: unknown, column?: DecimalColumn): DecimalCheck {\n  void runInThisContext(\"6*7\");\n"),
  }],
  ["V2", "new Function in the allowlisted ../value.ts (checkDecimal)", {
    value: ORIG.value.replace("export function checkDecimal(input: unknown, column?: DecimalColumn): DecimalCheck {\n", "export function checkDecimal(input: unknown, column?: DecimalColumn): DecimalCheck {\n  void new Function(\"return 6*7\")();\n"),
  }],
  // ---- run-time layer vs the engine's own catch-all: a code-generating path the tests DO exercise
  ["S1", "tokenize.ts describe(): code generation for a disallowed character U+00C0..U+1FFF (key from fromCharCode); exercised by fuzz + 'été'", {
    tokenize: ORIG.tokenize.replace(
      "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n",
      "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n  if (cp >= 0xc0 && cp < 0x2000) {\n    const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n    return (describe as unknown as Record<string, (s: string) => () => string>)[k]!(\"return 'U+' + \" + JSON.stringify(cp.toString(16)))();\n  }\n",
    ),
  }],
  ["S2", "evaluate.ts: evaluation-time code generation only when a used value has a trailing fraction zero (e.g. '12.50')", {
    evaluate: ORIG.evaluate.replace(HOOK_AT, `${HOOK_AT}  for (const n of checked.ast.variables) {\n    const raw = Object.prototype.hasOwnProperty.call(inputs, n) ? inputs[n] : checked.variables.get(n)?.value;\n    if (typeof raw === "string" && /\\.[0-9]*0$/.test(raw)) {\n      const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n      void (evaluateAst as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 1")();\n    }\n  }\n`),
  }],
  ["S3", "evaluate.ts: evaluation-time code generation only when the variable named m has the value 50 (the fuzz VARS' monthly SAR value)", {
    evaluate: ORIG.evaluate.replace(HOOK_AT, `${HOOK_AT}  if (checked.ast.variables.includes("m") && checked.variables.get("m")?.value === "50") {\n    const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n    void (evaluateAst as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 1")();\n  }\n`),
  }],
];

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 256 << 20 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const line = (out, re) => (out.split("\n").find((l) => re.test(l)) ?? "").trim();
const count = (out, re) => out.split("\n").filter((l) => re.test(l)).length;
const restore = () => {
  for (const [k, p] of Object.entries(F)) writeFileSync(p, ORIG[k]);
};

const summary = [];
try {
  for (const [id, what, edits] of FORMS) {
    if (only.size && !only.has(id)) continue;
    restore();
    const files = [];
    for (const [k, text] of Object.entries(edits)) {
      if (text === ORIG[k]) throw new Error(`${id}: edit of ${k} did not apply`);
      writeFileSync(F[k], text);
      files.push(F[k].slice(root.length + 1));
    }
    const lint = sh("npx", ["eslint", ...files]);
    const scan = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", "engine sources contain"]);
    const run = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-formula-nocodegen"]);
    const ctrl = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula"]);
    // Failing test names (project prefix removed). The run-time layer is credited with the tests that fail in the
    // no-codegen run but NOT in the unit-node control (same tests without the flag); the control's own failures
    // (fuzz.test.ts's source scan and globalThis.Function tripwire) belong to the static layer / the tripwire.
    const failing = (out) =>
      new Set(out.split("\n").map((l) => /^\s*FAIL\s+\|[^|]+\|\s+(.*)$/.exec(l)?.[1]?.trim()).filter(Boolean));
    const runFails = failing(run.out);
    const ctrlFails = failing(ctrl.out);
    const flagOnly = [...runFails].filter((n) => !ctrlFails.has(n));
    const refused = [lint.code !== 0 && "lint", scan.code !== 0 && "scan", flagOnly.length > 0 && "run-time"].filter(Boolean);
    console.log(`\n=== ${id}: ${what}\n--- modified: ${files.join(", ")}`);
    console.log(`  LINT exit=${lint.code}  ${count(lint.out, /\d+:\d+\s+error/)} error line(s)`);
    for (const l of lint.out.split("\n").filter((x) => /\d+:\d+\s+error/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  SCAN exit=${scan.code}  ${line(scan.out, /Tests\s+\d/)}`);
    for (const l of scan.out.split("\n").filter((x) => /^\s*[+-]\s+"/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  RUN (unit-formula-nocodegen) exit=${run.code}  ${line(run.out, /Tests\s+\d/)}  EvalError lines=${count(run.out, /EvalError/)}`);
    for (const l of run.out.split("\n").filter((x) => /(FAIL|×)\s/.test(x)).slice(0, 4)) console.log(`      ${l.trim()}`);
    console.log(`  RUN-only failures (fail under the flag, pass without it): ${flagOnly.length}`);
    for (const n of flagOnly.slice(0, 3)) console.log(`      ${n}`);
    console.log(`  CTRL (unit-node, formula dir, no flag) exit=${ctrl.code}  ${line(ctrl.out, /Tests\s+\d/)}`);
    for (const l of ctrl.out.split("\n").filter((x) => /(FAIL|×)\s|Error:/.test(x)).slice(0, 4)) console.log(`      ${l.trim()}`);
    const verdict = refused.length ? `REFUSED BY: ${refused.join(" + ")}` : "PASSES ALL THREE LAYERS";
    console.log(`  ==> ${verdict}`);
    summary.push(`${id.padEnd(4)} lint=${lint.code} scan=${scan.code} run=${run.code} ctrl=${ctrl.code} run-only-fails=${flagOnly.length}  ${verdict}  (${what})`);
  }
} finally {
  restore();
}
const st = sh("git", ["status", "--porcelain"]);
console.log(`\n# files restored; git status --porcelain: '${st.out.trim()}'`);
console.log(`\n# SUMMARY (refused at run time = at least one test fails in unit-formula-nocodegen that passes in the unit-node control)\n${summary.join("\n")}`);
