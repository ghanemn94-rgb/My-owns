// code-security-reviewer DG3 round 6 (T-DG3-REV-SEC-R6): residual demonstration for ADR-0024 §6 after T-DG3-KBE-H.
// Harness copied UNCHANGED from round-5 rethrow-rule-attack-probe-2.mjs (only the header and FORMS differ); disposable
// clone ONLY (a path containing "review-p3"). Usage: node residual-probe-r6.mjs <clone-root> [form-id ...]
// Forms, on the exercised round-3 S1 path (tokenize.ts describe() for U+00C0..U+1FFF), real code generation via the
// String.fromCharCode key:
//   A3  A1 with every refused NAME assembled at run time (String.fromCharCode): Array[<"fromAsync">]([0]) and
//       p[<"then">]; no fromAsync/then/Promise identifier, literal or template. The derived rejection is handled by a 2nd
//       reaction. EXPECTED (per §6 "Self-handling forms outside the list"): passes every layer — this is the stated
//       residual (the Q1–Q5 spelling class applied to L6/L7), NOT a reason to fail.
//   A4  (control) A3 without the rejection handler: expected refused at run time (unhandled rejection), proving the
//       path runs and the code generation really happens under the flag.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p3")) throw new Error("refusing: pass a disposable clone under $TMPDIR named review-p3*");
const only = new Set(process.argv.slice(3));
const F = { tokenize: `${root}/packages/shared/src/formula/tokenize.ts` };
const ORIG = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, readFileSync(p, "utf8")]));
const DESC_AT = "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n";
if (!ORIG.tokenize.includes(DESC_AT)) throw new Error("describe() not found");

const KEY = "String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)";
const DP_KEY = "String.fromCharCode(100, 101, 102, 105, 110, 101, 80, 114, 111, 112, 101, 114, 116, 121)";
const R = "as unknown as Record<string, (s: string) => () => unknown>";
const onDescribe = (helper) =>
  ORIG.tokenize.replace(DESC_AT, `${DESC_AT}  if (cp >= 0xc0 && cp < 0x2000) __w();\n`) +
  `\n// --- reviewer probe (disposable clone only) ---\n${helper}\n`;
const gen = (fn) => `void (${fn} ${R})[${KEY}]!("return 1")()`;
const T = "(this: unknown, f?: (v: unknown) => unknown, r?: (e: unknown) => unknown) => object";
const HIJACK = (keyExpr) =>
  `const __dp = (Object as unknown as Record<string, (o: object, k: symbol, d: object) => void>)[${keyExpr}]!;\n` +
  `__dp(Error, Symbol.hasInstance, {\n  configurable: true,\n  value(this: { name: string; prototype: object }, v: unknown): boolean {\n` +
  `    return this.name !== "Eval" + "Error" && Object.prototype.isPrototypeOf.call(this.prototype, v);\n  },\n});\n`;
const GUARDED_SWALLOW = `function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n    // swallowed\n  }\n}`;
const FA = "String.fromCharCode(102, 114, 111, 109, 65, 115, 121, 110, 99)"; // "fromAsync"
const TH = "String.fromCharCode(116, 104, 101, 110)"; // "then"
const A3 = (handled) =>
  `function __w(): void {\n  const p = (Array as unknown as Record<string, (x: unknown) => object>)[${FA}]!([0]);\n` +
  `  const t = (p as unknown as Record<string, ${T}>)[${TH}]!;\n  const d = t.call(p, () => {\n    ${gen("__w")};\n  });\n` +
  (handled ? `  t.call(d, undefined, () => undefined);\n` : `  void d;\n`) + `}`;
const FORMS = [
  ["A3", "A1 with run-time-assembled fromAsync/then keys; rejection handled by a 2nd reaction (stated residual)", { tokenize: onDescribe(A3(true)) }],
  ["A4", "(control) A3 without the rejection handler: unhandled rejection", { tokenize: onDescribe(A3(false)) }],
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
    const scan = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", "engine sources contain|static import closure"]);
    const run = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-formula-nocodegen"]);
    const ctrl = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula"]);
    const failing = (out) =>
      new Set(out.split("\n").map((l) => /^\s*FAIL\s+\|[^|]+\|\s+(.*)$/.exec(l)?.[1]?.trim()).filter(Boolean));
    const runFails = failing(run.out);
    const ctrlFails = failing(ctrl.out);
    const flagOnly = [...runFails].filter((n) => !ctrlFails.has(n));
    const unhandled = (out) => /Unhandled (Rejection|Error)/.test(out);
    const runUnhandledOnly = unhandled(run.out) && !unhandled(ctrl.out) && run.code !== 0;
    const refused = [lint.code !== 0 && "lint", scan.code !== 0 && "scan", (flagOnly.length > 0 || runUnhandledOnly) && "run-time"].filter(Boolean);
    console.log(`\n=== ${id}: ${what}\n--- modified: ${files.join(", ")}`);
    console.log(`  LINT exit=${lint.code}  ${count(lint.out, /\d+:\d+\s+error/)} error line(s)`);
    for (const l of lint.out.split("\n").filter((x) => /\d+:\d+\s+error/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  SCAN exit=${scan.code}  ${line(scan.out, /Tests\s+\d/)}`);
    for (const l of scan.out.split("\n").filter((x) => /AssertionError|expected|\+ {3}"/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  RUN (unit-formula-nocodegen) exit=${run.code}  ${line(run.out, /Tests\s+\d/)}  ${line(run.out, /Errors\s+\d/)}  EvalError lines=${count(run.out, /EvalError/)}  unhandled=${unhandled(run.out)}`);
    for (const l of run.out.split("\n").filter((x) => /(FAIL|×)\s|Unhandled|EvalError/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  RUN-only failures (fail under the flag, pass without it): ${flagOnly.length}${runUnhandledOnly ? " + unhandled error only under the flag" : ""}`);
    for (const n of flagOnly.slice(0, 4)) console.log(`      ${n}`);
    console.log(`  CTRL (unit-node, formula dir, no flag) exit=${ctrl.code}  ${line(ctrl.out, /Tests\s+\d/)}  unhandled=${unhandled(ctrl.out)}`);
    for (const l of ctrl.out.split("\n").filter((x) => /(FAIL|×)\s|Error:/.test(x)).slice(0, 4)) console.log(`      ${l.trim()}`);
    const verdict = refused.length ? `REFUSED BY: ${refused.join(" + ")}` : "PASSES ALL THREE LAYERS";
    console.log(`  ==> ${verdict}`);
    summary.push(`${id.padEnd(4)} lint=${lint.code} scan=${scan.code} run=${run.code} ctrl=${ctrl.code} run-only-fails=${flagOnly.length}${runUnhandledOnly ? "+unhandled" : ""}  ${verdict}  (${what})`);
  }
} finally {
  restore();
}
const st = sh("git", ["status", "--porcelain"]);
console.log(`\n# files restored; git status --porcelain: '${st.out.trim()}'`);
console.log(`\n# SUMMARY (refused at run time = a test fails, or an unhandled error is reported, in unit-formula-nocodegen but not in the unit-node control)\n${summary.join("\n")}`);
