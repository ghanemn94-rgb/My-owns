// code-security-reviewer DG3 round 7: supplementary ablation (informational) for the selectors lint-mutation-probe.mjs did
// not ablate cleanly: (a) the 6-part computed-key selector, whose `Literal[raw=/^[\"']/]` part contains an escaped quote
// that broke that probe's string extraction (its ABL-22 was a config syntax error, NOT a caught mutation); (b) the two
// template-literal selectors (CatchClause rethrow, host names). Each part is removed by exact text replacement; before each
// run the mutated config is imported (node --input-type=module) to prove it is syntactically valid. Disposable clone only.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const root = process.argv[2];
const CFG = `${root}/eslint.config.js`;
const orig = readFileSync(CFG, "utf8");
const T = "ESLint refuses the round-5 handler forms";
const FN = "/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/";
const ck = [
  "MemberExpression[computed=true] > BinaryExpression.property Literal[raw=/^[\\\"']/]",
  "MemberExpression[computed=true] > TemplateLiteral.property[expressions.length>0]",
  `MemberExpression[computed=true][object.type=${FN}]`,
  `MemberExpression[computed=true][object.expression.type=${FN}]`,
  `MemberExpression[computed=true][object.expression.expression.type=${FN}]`,
  `MemberExpression[computed=true][object.expression.expression.expression.type=${FN}]`,
];
const muts = ck.map((p, i) => [`computed-key part ${i + 1}: ${p.slice(0, 90)}`, i === 0 ? p + ", " : ", " + p, ""]);
muts.push(["CatchClause rethrow selector -> NeverMatchingNodeType", "`CatchClause:not(${CATCH_RETHROWS_EVAL_ERROR})`", '"NeverMatchingNodeType"']);
muts.push(["host-names selector -> NeverMatchingNodeType", '`Identifier[name=/^(${FORMULA_HOST_NAMES.join("|")})$/]`', '"NeverMatchingNodeType"']);
try {
  console.log(`# lint-ablation-2; node ${process.version}; root ${root}; head ${execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
  for (const [label, from, to] of muts) {
    if (!orig.includes(from)) { console.log(`${label}\tANCHOR-NOT-FOUND`); continue; }
    writeFileSync(CFG, orig.replace(from, to));
    const imp = spawnSync("node", ["--input-type=module", "-e", `await import(${JSON.stringify("file://" + CFG + "?x=" + Date.now())})`], { cwd: root, encoding: "utf8" });
    if (imp.status !== 0) { console.log(`${label}\tCONFIG-INVALID\t${(imp.stderr || "").split("\n").find((l) => /Error/.test(l))}`); continue; }
    const r = spawnSync("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "-t", T, "--reporter=verbose"], { cwd: root, encoding: "utf8" });
    const out = r.stdout + r.stderr;
    const fails = [...out.matchAll(/AssertionError: ([^\n]*)/g)].map((m) => m[1]).slice(0, 2);
    console.log(`${label}\tconfig-valid\texit=${r.status}\t${r.status === 0 ? "PASS(survived)" : "FAIL(caught)"}\t${(out.match(/Tests\s+[^\n]*/) ?? ["?"])[0]}${fails.length ? "\t" + fails.join(" | ") : ""}`);
  }
} finally {
  writeFileSync(CFG, orig);
  console.log(`# restored; git status --porcelain: '${execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()}'`);
}
