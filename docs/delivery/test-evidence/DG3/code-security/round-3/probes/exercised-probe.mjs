// code-security-reviewer DG3 round-3 (T-DG3-REV-SEC-R3B): proves that the S1 and S3 code-generating paths of
// guard-layers-probe.mjs ARE exercised by the formula tests in the no-codegen process, and that the engine's own
// catch-all turns the EvalError into an ordinary `formula.syntax` problem that fuzz.test.ts accepts.
// Disposable clone ONLY ($TMPDIR/review-p3). Usage: node exercised-probe.mjs <clone-root>
// Applies the S1 (tokenize.ts) and S3 (evaluate.ts) edits byte-for-byte as in guard-layers-probe.mjs, adds a probe test
// file that replays fuzz.test.ts's own seeded inputs (same PRNG, seeds, VARS and alphabet), runs it together with
// fuzz.test.ts and the canary in the exact `unit-formula-nocodegen` invocation, then restores everything.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p3")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p3");
const dir = `${root}/packages/shared/src/formula`;
const tokP = `${dir}/tokenize.ts`;
const evP = `${dir}/evaluate.ts`;
const testP = `${dir}/zz-sec-r3-exercised.test.ts`;
const tok = readFileSync(tokP, "utf8");
const ev = readFileSync(evP, "utf8");
const HOOK_AT = "export function evaluateAst(checked: CheckedFormula, inputs: FormulaInputs = {}): FormulaEvaluation {\n";
const tok2 = tok.replace(
  "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n",
  "function describe(c: string): string {\n  const cp = c.codePointAt(0) ?? 0;\n  if (cp >= 0xc0 && cp < 0x2000) {\n    const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n    return (describe as unknown as Record<string, (s: string) => () => string>)[k]!(\"return 'U+' + \" + JSON.stringify(cp.toString(16)))();\n  }\n",
);
const ev2 = ev.replace(
  HOOK_AT,
  `${HOOK_AT}  if (checked.ast.variables.includes("m") && checked.variables.get("m")?.value === "50") {\n    const k = String.fromCharCode(99, 111, 110, 115, 116, 114, 117, 99, 116, 111, 114);\n    void (evaluateAst as unknown as Record<string, (s: string) => () => unknown>)[k]!("return 1")();\n  }\n`,
);
if (tok2 === tok || ev2 === ev) throw new Error("edit did not apply");

const TEST = String.raw`import { describe, expect, it } from "vitest";
import { evaluateFormula, validateFormula, type FormulaVariable } from "./index.ts";
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const VARS: FormulaVariable[] = [
  { name: "a", kind: "number", period: "none", value: "2" },
  { name: "b", kind: "number", period: "none", value: "0" },
  { name: "c", kind: "count", period: "year", value: "100000" },
  { name: "f", kind: "fraction", period: "none", value: "0.12" },
  { name: "m", kind: "currency", currency: "SAR", period: "month", value: "50" },
  { name: "s", kind: "currency", currency: "SAR", period: "none", value: "12.50" },
  { name: "u", kind: "currency", currency: "USD", period: "none", value: null },
];
const isEvalErr = (e: { params?: Record<string, string> } | undefined) =>
  e?.params?.["reason"] === "internal" && e?.params?.["detail"] === "EvalError";
describe("reviewer probe: S1/S3 paths run under the flag and are swallowed", () => {
  it("runs in the no-codegen process", () => {
    expect(process.execArgv).toContain("--disallow-code-generation-from-strings");
  });
  it("S1: 'été' and the fuzz byte strings reach the code-generating describe() path", () => {
    const v = validateFormula("été", [{ name: "a", kind: "number", period: "none", value: "1" }]);
    console.log("[probe] S1 validateFormula('été') ->", JSON.stringify(v.ok ? "ok" : v.errors[0]));
    const r = rng(0x5eed_f00d);
    let hits = 0;
    for (let i = 0; i < 10_000; i++) {
      const len = Math.floor(r() * 81);
      let s = "";
      for (let j = 0; j < len; j++) s += String.fromCharCode(Math.floor(r() * 256));
      const out = validateFormula(s, VARS);
      if (!out.ok && isEvalErr(out.errors[0] as never)) hits++;
    }
    console.log("[probe] S1 fuzz byte strings (seed 0x5eedf00d, 10000): EvalError swallowed as formula.syntax/internal in", hits);
    expect(hits).toBeGreaterThan(0);
  });
  it("S3: the grammar-alphabet fuzz reaches the evaluation-time code-generating path", () => {
    const atoms = ["a","b","c","f","m","s","u","x","0","1","2.5","0.000","+","-","*","/","×","÷","(",")",","," ","min","max","abs","to_period","year","month","quarter","**",";","'","\n"];
    const r = rng(42);
    let hits = 0;
    let codes = new Set<string>();
    for (let i = 0; i < 20_000; i++) {
      const len = 1 + Math.floor(r() * 16);
      let s = "";
      for (let j = 0; j < len; j++) s += atoms[Math.floor(r() * atoms.length)]!;
      const e = evaluateFormula(s, VARS);
      if (isEvalErr(e.errors[0] as never)) {
        hits++;
        codes.add(String(e.errorCode));
      }
    }
    console.log("[probe] S3 grammar fuzz (seed 42, 20000): EvalError swallowed in", hits, "evaluations; errorCode(s) reported:", [...codes].join(","));
    expect(hits).toBeGreaterThan(0);
  });
});
`;

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 256 << 20 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
let res;
try {
  writeFileSync(tokP, tok2);
  writeFileSync(evP, ev2);
  writeFileSync(testP, TEST);
  res = sh("pnpm", [
    "exec", "vitest", "run", "--project", "unit-formula-nocodegen", "--reporter=verbose",
    "packages/shared/src/formula/zz-sec-r3-exercised.test.ts",
    "packages/shared/src/formula/fuzz.test.ts",
    "packages/shared/src/formula/codegen.nocodegen.test.ts",
  ]);
} finally {
  writeFileSync(tokP, tok);
  writeFileSync(evP, ev);
  rmSync(testP, { force: true });
}
console.log(`# command: pnpm exec vitest run --project unit-formula-nocodegen --reporter=verbose zz-sec-r3-exercised.test.ts fuzz.test.ts codegen.nocodegen.test.ts`);
console.log(res.out.split("\n").filter((l) => /\[probe\]|✓|×|Test Files|Tests\s|FAIL|Error/.test(l)).join("\n"));
console.log(`# vitest exit_status: ${res.code}`);
console.log(`# restored; git status --porcelain: '${sh("git", ["status", "--porcelain"]).out.trim()}'`);
