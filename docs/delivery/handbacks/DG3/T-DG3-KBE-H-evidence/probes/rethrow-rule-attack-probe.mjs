// code-security-reviewer DG3 round 5 (T-DG3-REV-SEC-R5): attacks the round-5 static EvalError-rethrow rule of
// ADR-0024 §6 (T-DG3-KBE-G: the CatchClause selector, the EvalError-identifier selector, no-unsafe-finally, the
// synchronous-engine selector, and their scan mirror in fuzz.test.ts). Disposable clone ONLY ($TMPDIR/review-p3 at
// 40c84e8 = candidate sha256:dfedd62f…); never run in the candidate tree. Usage:
//   node rethrow-rule-attack-probe.mjs <clone-root> [form-id ...]
// Harness identical to round-4 swallow-probe.mjs (sha256 d9989e67…): for each form the clone's engine is modified, then
//   (1) LINT  npx eslint <modified files>                                         (ADR-0024 §6 layer 1)
//   (2) SCAN  vitest --project unit-node fuzz.test.ts -t "engine sources contain|static import closure"   (layer 2)
//   (3) RUN   vitest run --project unit-formula-nocodegen                          (layer 3, the 2nd command of pnpm test)
//   (4) CTRL  vitest run --project unit-node packages/shared/src/formula            (same tests without the flag)
// A form is refused at run time when a test fails in (3) that passes in (4), or an unhandled error appears only in (3).
// Files are restored afterwards.
//
// Every form puts a REAL string code generation (the Function constructor reached by the String.fromCharCode key, the
// round-3 Q2/S1 key, which passes both static layers) on the round-3 S1 path: tokenize.ts describe() for a disallowed
// character U+00C0..U+1FFF. Round 4's W5 proved that path is exercised in the no-codegen process. The forms differ only
// in how the refusal is handled, WITHOUT a catch that lacks the rethrow, a finally with return/throw/break/continue, or
// any Promise/async/.then/.catch/.finally:
//   G1  generator: try { codegen } finally { yield 0; } — consumer calls .next() once and drops the iterator. The
//       exception in flight is held at the suspended yield and never resumed.
//   G2  as G1, but the consumer calls the iterator's return() after .next(): a return completion replaces the
//       pending throw completion (the "iterator return()" route).
//   G3  (control) for-of over a generator whose body generates code, loop broken: the exception propagates (no swallow).
//   E1  EventTarget listener: et.addEventListener("x", codegen); et.dispatchEvent(new Event("x")) — a listener's
//       exception is reported by the host, not thrown to the dispatcher.
//   E2  AbortController: signal.onabort = codegen; ac.abort() — the same reporting route through an event handler.
//   H1  the catch has the REQUIRED first statement, but Error[Symbol.hasInstance] is redefined at module load (through
//       Object["defineProperty"], a string-literal key) so that `e instanceof EvalError` is false; the catch then
//       swallows. Tests the claim that the shape makes the rethrow semantically certain.
//   H2  as H1, with the defineProperty key assembled at run time (String.fromCharCode): the Q1–Q5 spelling class.
//   S1  (shape) catch (e) { if (e instanceof EvalError) throw e; } with `var e` re-declared later in the block.
//   S2  (shape) `if (e instanceof EvalError) throw e;` then `else` on the NEXT if (allowed) — confirms the selector
//       only constrains the first statement; then the catch swallows non-EvalErrors (allowed by design; control).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p3")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p3");
const only = new Set(process.argv.slice(3));
const F = { tokenize: `${root}/packages/shared/src/formula/tokenize.ts` };
const ORIG = Object.fromEntries(Object.entries(F).map(([k, p]) => [k, readFileSync(p, "utf8")]));
const DESC_AT = "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n";
if (!ORIG.tokenize.includes(DESC_AT)) throw new Error("describe() not found");

const KEY = "String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114)";
const DP_KEY = "String.fromCharCode(100, 101, 102, 105, 110, 101, 80, 114, 111, 112, 101, 114, 116, 121)";
const R = "as unknown as Record<string, (s: string) => () => unknown>";
/** tokenize.ts with `helper` appended and describe() calling `__w()` for U+00C0..U+1FFF. */
const onDescribe = (helper) =>
  ORIG.tokenize.replace(DESC_AT, `${DESC_AT}  if (cp >= 0xc0 && cp < 0x2000) __w();\n`) +
  `\n// --- reviewer probe (disposable clone only) ---\n${helper}\n`;
const gen = (fn) => `void (${fn} ${R})[${KEY}]!("return 1")()`;
const HIJACK = (keyExpr) =>
  `const __dp = (Object as unknown as Record<string, (o: object, k: symbol, d: object) => void>)[${keyExpr}]!;\n` +
  `__dp(Error, Symbol.hasInstance, {\n  configurable: true,\n  value(this: { name: string; prototype: object }, v: unknown): boolean {\n` +
  `    return !this.name.startsWith("Eval") && Object.prototype.isPrototypeOf.call(this.prototype, v);\n  },\n});\n`;
const GUARDED_SWALLOW = `function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n    // swallowed\n  }\n}`;

const FORMS = [
  ["G1", "generator try { codegen } finally { yield 0; } — .next() once, iterator dropped", {
    tokenize: onDescribe(`function* __g(): Generator<number> {\n  try {\n    ${gen("__w")};\n  } finally {\n    yield 0;\n  }\n}\nfunction __w(): void {\n  void __g().next();\n}`),
  }],
  ["G2", "as G1, then iterator.return() discards the pending throw", {
    tokenize: onDescribe(`function* __g(): Generator<number> {\n  try {\n    ${gen("__w")};\n  } finally {\n    yield 0;\n  }\n}\nfunction __w(): void {\n  const it = __g();\n  it.next();\n  it.return(0);\n}`),
  }],
  ["G3", "(control) for-of over a code-generating generator, loop broken: propagates", {
    tokenize: onDescribe(`function* __g(): Generator<number> {\n  ${gen("__w")};\n  yield 0;\n}\nfunction __w(): void {\n  for (const _x of __g()) break;\n}`),
  }],
  ["E1", "EventTarget listener generates code; dispatchEvent reports, does not throw", {
    tokenize: onDescribe(`function __w(): void {\n  const et = new EventTarget();\n  et.addEventListener("x", () => {\n    ${gen("__w")};\n  });\n  et.dispatchEvent(new Event("x"));\n}`),
  }],
  ["E2", "AbortSignal onabort generates code; abort() reports, does not throw", {
    tokenize: onDescribe(`function __w(): void {\n  const ac = new AbortController();\n  ac.signal.onabort = () => {\n    ${gen("__w")};\n  };\n  ac.abort();\n}`),
  }],
  ["H1", "required catch shape, Error[Symbol.hasInstance] hijacked via Object[\"defineProperty\"] (literal key)", {
    tokenize: onDescribe(`${HIJACK('"defineProperty"')}${GUARDED_SWALLOW}`),
  }],
  ["H2", "required catch shape, Error[Symbol.hasInstance] hijacked via a run-time-assembled key (Q class)", {
    tokenize: onDescribe(`${HIJACK(DP_KEY)}${GUARDED_SWALLOW}`),
  }],
  ["S1", "required catch shape plus a later `var e` in the same block", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch (e) {\n    if (e instanceof EvalError) throw e;\n    // eslint-disable-next-line no-var\n    var e = 1;\n    void e;\n  }\n}`),
  }],
  ["S2", "(control) required first statement, then the catch converts everything else (allowed by design)", {
    tokenize: onDescribe(GUARDED_SWALLOW),
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
