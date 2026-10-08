// code-security-reviewer DG3 round-4 (T-DG3-REV-SEC-R4): attacks the round-4 mechanisms of F-DG3-100 (the EvalError
// rethrow in every catch of the engine's import closure, and the internal-failure rule in fuzz.test.ts/formula.test.ts).
// Disposable clone ONLY ($TMPDIR/review-p3 at 171a0b57); never run in the candidate tree. Usage:
//   node swallow-probe.mjs <clone-root> [form-id ...]
// Harness identical to round-3 guard-layers-probe.mjs: for each form the clone's engine is modified, then
//   (1) LINT  npx eslint <modified files>                                         (ADR-0024 §6 layer 1)
//   (2) SCAN  vitest --project unit-node fuzz.test.ts -t "engine sources contain|static import closure"   (layer 2)
//   (3) RUN   vitest run --project unit-formula-nocodegen                          (layer 3, the 2nd command of pnpm test)
//   (4) CTRL  vitest run --project unit-node packages/shared/src/formula            (same tests without the flag)
// A form is refused at run time when a test fails in (3) that passes in (4). Files are restored afterwards.
//
// Every W form puts a REAL string code generation (GeneratorFunction-free: the Function constructor reached by a key
// built with String.fromCharCode, the round-3 Q2/S1 key, which passes both static layers) on the round-3 S1 path:
// tokenize.ts describe() for a disallowed character U+00C0..U+1FFF. Round 3 proved that path is exercised in the
// no-codegen process (validateFormula("été"), and 2,805 of fuzz.test.ts's own byte strings). The forms differ only in
// how the code generation's failure is handled:
//   W1  try { codegen } catch { }                     the code catches its own refusal (feature detection) -> no change
//   W2  try { codegen } finally { return; }           a finally that returns swallows the exception (no-unsafe-finally off)
//   W3  Promise.resolve().then(codegen)               the refusal becomes an UNHANDLED rejection (asynchronous)
//   W4  Promise.resolve().then(codegen).catch(() => undefined)    the rejection is swallowed by a .catch handler
//   W5  try { codegen } catch (e) { throw new Error("wrapped", { cause: e }) }   the EvalError is wrapped (cause)
//   W6  W5 at evaluation time (round-3 S3 path: evaluateAst, variable m = "50")
// Expected if the round-4 mechanisms are what ADR-0024 §6 claims: W3, W5 and W6 refused at run time (unhandled
// rejection; internal-failure rule). W1, W2 and W4 add a NEW catch that does not rethrow: they test whether the
// "every catch in the closure rethrows EvalError" rule is enforced by anything.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p3")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p3");
const only = new Set(process.argv.slice(3));
const F = {
  evaluate: `${root}/packages/shared/src/formula/evaluate.ts`,
  tokenize: `${root}/packages/shared/src/formula/tokenize.ts`,
};
const ORIG = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, readFileSync(p, "utf8")]));
const DESC_AT = "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n";
const HOOK_AT = "export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {\n";
if (!ORIG.tokenize.includes(DESC_AT)) throw new Error("describe() not found");
if (!ORIG.evaluate.includes(HOOK_AT)) throw new Error("evaluateAst signature not found");

const KEY = "String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)";
const R = "as unknown as Record<string, (s: string) => () => unknown>";
/** tokenize.ts with `helper` appended and describe() calling `__w()` for U+00C0..U+1FFF. */
const onDescribe = (helper) =>
  ORIG.tokenize.replace(DESC_AT, `${DESC_AT}  if (cp >= 0xc0 && cp < 0x2000) __w();\n`) +
  `\n// --- reviewer probe (disposable clone only) ---\n${helper}\n`;
const gen = (fn) => `void (${fn} ${R})[${KEY}]!("return 1")()`;

const FORMS = [
  ["W1", "try { codegen } catch { } (own catch, no rethrow)", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch {\n    // refused: carry on\n  }\n}`),
  }],
  ["W2", "try { codegen } finally { return; } (finally swallows)", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } finally {\n    // no-unsafe-finally is not enabled\n    return;\n  }\n}`),
  }],
  ["W3", "Promise.resolve().then(codegen) (unhandled rejection)", {
    tokenize: onDescribe(`function __w(): void {\n  void Promise.resolve().then(() => {\n    ${gen("__w")};\n  });\n}`),
  }],
  ["W4", "Promise.resolve().then(codegen).catch(() => undefined) (.catch swallows)", {
    tokenize: onDescribe(`function __w(): void {\n  void Promise.resolve()\n    .then(() => {\n      ${gen("__w")};\n    })\n    .catch(() => undefined);\n}`),
  }],
  ["W5", "try { codegen } catch (e) { throw new Error('wrapped', { cause: e }) } (wrapped EvalError)", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch (e) {\n    throw new Error("wrapped", { cause: e });\n  }\n}`),
  }],
  ["W6", "W5 at evaluation time (S3 path: m = '50')", {
    evaluate: ORIG.evaluate.replace(HOOK_AT, `${HOOK_AT}  if (checked.ast.variables.includes("m") && checked.variables.get("m")?.value === "50") {\n    try {\n      ${gen("evaluateAst")};\n    } catch (e) {\n      throw new Error("wrapped", { cause: e });\n    }\n  }\n`),
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
    const scan = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", "engine sources contain|static import closure"]);
    const run = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-formula-nocodegen"]);
    const ctrl = sh("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula"]);
    const failing = (out) =>
      new Set(out.split("\n").map((l) => /^\s*FAIL\s+\|[^|]+\|\s+(.*)$/.exec(l)?.[1]?.trim()).filter(Boolean));
    const runFails = failing(run.out);
    const ctrlFails = failing(ctrl.out);
    const flagOnly = [...runFails].filter((n) => !ctrlFails.has(n));
    // An unhandled error/rejection fails the vitest run without a failing test name: count it as a run-time refusal
    // only when the control run does not have it.
    const unhandled = (out) => /Unhandled (Rejection|Error)/.test(out);
    const runUnhandledOnly = unhandled(run.out) && !unhandled(ctrl.out) && run.code !== 0;
    const refused = [lint.code !== 0 && "lint", scan.code !== 0 && "scan", (flagOnly.length > 0 || runUnhandledOnly) && "run-time"].filter(Boolean);
    console.log(`\n=== ${id}: ${what}\n--- modified: ${files.join(", ")}`);
    console.log(`  LINT exit=${lint.code}  ${count(lint.out, /\d+:\d+\s+error/)} error line(s)`);
    for (const l of lint.out.split("\n").filter((x) => /\d+:\d+\s+error/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
    console.log(`  SCAN exit=${scan.code}  ${line(scan.out, /Tests\s+\d/)}`);
    console.log(`  RUN (unit-formula-nocodegen) exit=${run.code}  ${line(run.out, /Tests\s+\d/)}  ${line(run.out, /Errors\s+\d/)}  EvalError lines=${count(run.out, /EvalError/)}  unhandled=${unhandled(run.out)}`);
    for (const l of run.out.split("\n").filter((x) => /(FAIL|×)\s|Unhandled|wrapped|internal/.test(x)).slice(0, 6)) console.log(`      ${l.trim()}`);
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
