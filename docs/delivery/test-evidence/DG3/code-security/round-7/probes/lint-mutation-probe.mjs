// code-security-reviewer DG3 round 7 (T-DG3-REV-SEC-R7): F-DG3-280 mutation probe. Runs ONLY in a disposable clone
// (argv[2]); every edited file is restored afterwards and `git status --porcelain` is printed at the end.
// For each mutation of eslint.config.js it runs the candidate's ESLint.lintText test (vitest --project unit-node,
// fuzz.test.ts, -t on the test title) and records PASS (mutation survived: no test fails) or FAIL (mutation caught).
//   control      : unmutated config, candidate test                        -> expect PASS (test green)
//   M1           : drop "ForOfStatement[await=true]" from the async selector -> expect FAIL (caught)
//   M2           : drop the "PrivateIdentifier[...]" part of the L6/L7 name selector -> expect FAIL (caught)
//   M1-pre, M2-pre: the same mutations, with the PRE-REPAIR fuzz.test.ts (c40232b0) -> expect PASS (the round-6 gap)
//   ABL-*        : (informational) every top-level selector part of every string-literal selector in FORMULA_SYNTAX and
//                  FORMULA_SOURCE_SYNTAX removed one at a time (a single-part selector is replaced by a never-matching
//                  node type), candidate test; reports which parts the test pins.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const root = process.argv[2];
const only = process.argv[3]; // "core" to skip the ablation
const CFG = `${root}/eslint.config.js`;
const TEST = `${root}/packages/shared/src/formula/fuzz.test.ts`;
const origCfg = readFileSync(CFG, "utf8");
const origTest = readFileSync(TEST, "utf8");
const preTest = execFileSync("git", ["-C", root, "show", "c40232b0:packages/shared/src/formula/fuzz.test.ts"], { encoding: "utf8" });
const TITLE_NEW = "ESLint refuses the round-5 handler forms";
function runTest(label) {
  const r = spawnSync("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", TITLE_NEW, "--reporter=verbose"], { cwd: root, encoding: "utf8" });
  const out = (r.stdout ?? "") + (r.stderr ?? "");
  const tests = (out.match(/Tests\s+[^\n]*/) ?? ["?"])[0];
  const fails = [...out.matchAll(/AssertionError: ([^\n]*)/g)].map((m) => m[1]).slice(0, 3);
  console.log(`${label}\texit=${r.status}\t${r.status === 0 ? "PASS(survived)" : "FAIL(caught)"}\t${tests}${fails.length ? "\t" + fails.join(" | ") : ""}`);
  return r.status;
}
function mutate(from, to) {
  if (!origCfg.includes(from)) throw new Error(`mutation anchor not found: ${from}`);
  writeFileSync(CFG, origCfg.replace(from, to));
}
const M1 = [", ForOfStatement[await=true]", ""];
const M2 = ["PrivateIdentifier[name=/^(then|catch|finally|fromAsync|asyncIterator)$/], ", ""];
const results = {};
try {
  console.log(`# lint-mutation-probe; node ${process.version}; root ${root}; head ${execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
  results.control = runTest("control (candidate config, candidate test)");
  mutate(...M1); results.M1 = runTest("M1 (no ForOfStatement[await=true]), candidate test");
  mutate(...M2); results.M2 = runTest("M2 (no PrivateIdentifier part), candidate test");
  writeFileSync(TEST, preTest);
  writeFileSync(CFG, origCfg);
  results.preControl = runTest("control-pre (candidate config, PRE-REPAIR test c40232b0)");
  mutate(...M1); results.M1pre = runTest("M1-pre (no ForOfStatement[await=true]), PRE-REPAIR test");
  mutate(...M2); results.M2pre = runTest("M2-pre (no PrivateIdentifier part), PRE-REPAIR test");
  writeFileSync(TEST, origTest);
  writeFileSync(CFG, origCfg);
  if (only !== "core") {
    const start = origCfg.indexOf("const FORMULA_SYNTAX = [");
    const end = origCfg.indexOf("];", origCfg.indexOf("const FORMULA_SOURCE_SYNTAX = ["));
    const region = origCfg.slice(start, end);
    const sels = [...region.matchAll(/selector:\s*\n?\s*"([^"]*)"/g)].map((m) => m[1]);
    let n = 0;
    for (const s of sels) {
      const parts = []; let depth = 0, cur = "", inRe = false;
      for (let i = 0; i < s.length; i++) { const c = s[i];
        if (c === "/" && s[i - 1] === "=") inRe = true; else if (c === "/" && inRe && s[i - 1] !== "\\") inRe = false;
        if (!inRe && (c === "(" || c === "[")) depth++; if (!inRe && (c === ")" || c === "]")) depth--;
        if (c === "," && depth === 0 && !inRe) { parts.push(cur.trim()); cur = ""; } else cur += c; }
      parts.push(cur.trim());
      for (let k = 0; k < parts.length; k++) {
        const rest = parts.filter((_, j) => j !== k);
        const mutated = rest.length ? rest.join(", ") : "NeverMatchingNodeType";
        const full = origCfg.slice(0, start) + region.replace(`"${s}"`, `"${mutated}"`) + origCfg.slice(end);
        writeFileSync(CFG, full); n++;
        runTest(`ABL-${n}\t${parts[k].slice(0, 110)}`);
      }
    }
    writeFileSync(CFG, origCfg);
  }
} finally {
  writeFileSync(CFG, origCfg); writeFileSync(TEST, origTest);
  console.log(`# restored; git status --porcelain: '${execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()}'`);
}
const ok = results.control === 0 && results.M1 !== 0 && results.M2 !== 0 && results.preControl === 0 && results.M1pre === 0 && results.M2pre === 0;
console.log(`# VERDICT core: ${ok ? "AS EXPECTED (control green, M1/M2 caught by the repaired test, survived the pre-repair test)" : "UNEXPECTED"}`);
process.exit(ok ? 0 : 1);
