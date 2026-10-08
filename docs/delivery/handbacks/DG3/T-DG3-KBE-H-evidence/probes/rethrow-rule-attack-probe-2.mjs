// code-security-reviewer DG3 round 5 (T-DG3-REV-SEC-R5): second set of attacks on the round-5 static EvalError-rethrow
// rule (ADR-0024 §6), written after the first probe. Same harness as rethrow-rule-attack-probe.mjs and round-4
// swallow-probe.mjs; disposable clone ONLY ($TMPDIR/review-p3 at 40c84e8). Usage:
//   node rethrow-rule-attack-probe-2.mjs <clone-root> [form-id ...]
// Forms (each on the exercised round-3 S1 path, tokenize.ts describe() for U+00C0..U+1FFF, real code generation via the
// String.fromCharCode key):
//   A1  asynchrony without the refused spellings: a promise from Array.fromAsync([0]) (no `Promise` identifier), its
//       `then` read by DESTRUCTURING (`const { then: t } = p`, neither a `.then` member nor `["then"]`), the code
//       generation in the fulfilment reaction, and the derived promise's rejection handled by a second t.call(…).
//   A2  A1 without the rejection handler: the refusal becomes an unhandled rejection (control: refused at run time).
//   F1  mirror check: `finally { const s = "}"; return; }` — no-unsafe-finally refuses it; does the scan's brace
//       matcher (blockAt) see the return after a "}" inside a string?
//   F2  mirror check: the required catch with a type annotation, `catch (e: unknown) { if (e instanceof EvalError)
//       throw e; }` — lint allows it; does the scan?
//   H3  first-probe H1 corrected: the required catch shape, and Error[Symbol.hasInstance] redefined at module load through
//       Object["defineProperty"] (string-literal key) to return false for EXACTLY the class named "Eval"+"Error" (H1 used
//       startsWith("Eval"), which also broke the engine's own EvalFailure checks, so its result was inconclusive).
//   H4  as H3 with the defineProperty key assembled at run time (String.fromCharCode): the Q1–Q5 spelling class.
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

const FORMS = [
  ["A1", "Array.fromAsync promise + destructured then; reaction generates code; rejection handled by a 2nd then", {
    tokenize: onDescribe(`function __w(): void {\n  const p = Array.fromAsync([0]) as unknown as { then: ${T} };\n  const { then: t } = p;\n  const d = t.call(p, () => {\n    ${gen("__w")};\n  });\n  t.call(d, undefined, () => undefined);\n}`),
  }],
  ["A2", "(control) A1 without the rejection handler: unhandled rejection", {
    tokenize: onDescribe(`function __w(): void {\n  const p = Array.fromAsync([0]) as unknown as { then: ${T} };\n  const { then: t } = p;\n  t.call(p, () => {\n    ${gen("__w")};\n  });\n}`),
  }],
  ["F1", "mirror: finally { const s = \"}\"; return; } (no-unsafe-finally vs the scan's brace matcher)", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } finally {\n    const s = "}";\n    void s;\n    return;\n  }\n}`),
  }],
  ["F2", "mirror: required catch with a type annotation, catch (e: unknown)", {
    tokenize: onDescribe(`function __w(): void {\n  try {\n    ${gen("__w")};\n  } catch (e: unknown) {\n    if (e instanceof EvalError) throw e;\n  }\n}`),
  }],
  ["H3", "required catch shape; Error[Symbol.hasInstance] hijacked (exact name) via Object[\"defineProperty\"] (literal key)", {
    tokenize: onDescribe(`${HIJACK('"defineProperty"')}${GUARDED_SWALLOW}`),
  }],
  ["H4", "required catch shape; Error[Symbol.hasInstance] hijacked (exact name) via a run-time-assembled key (Q class)", {
    tokenize: onDescribe(`${HIJACK(DP_KEY)}${GUARDED_SWALLOW}`),
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
