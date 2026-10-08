// code-security-reviewer DG3 round 7 (informational): each selector part that SURVIVED the lintText test alone
// (lint-mutation-probe.log ABL-* PASS rows, lint-ablation-2.log PASS rows) is removed again and the WHOLE fuzz.test.ts
// runs (unit-node: the config-presence test, the lintText test, the scan, the closure test). A part that still survives is
// pinned by no unit-node test of fuzz.test.ts. Exact text removal; the mutated config is imported first to prove it is
// valid. Disposable clone only; restored afterwards.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
const root = process.argv[2];
const CFG = `${root}/eslint.config.js`;
const orig = readFileSync(CFG, "utf8");
const FN = "/^(ArrowFunctionExpression|FunctionExpression|ClassExpression)$/";
// [label, exact text to remove/replace, replacement]
const M = [
  ["parseFloat", `selector: "CallExpression[callee.name='parseFloat']"`, `selector: "NeverMatchingNodeType"`, 2],
  ["WithStatement", `"WithStatement"`, `"NeverMatchingNodeType"`],
  ["timers .property part", `, CallExpression[callee.property.name=/^(setTimeout|setInterval|setImmediate|execScript)$/]`, ``],
  ["CallExpression .constructor()", `CallExpression[callee.property.name='constructor'], `, ``],
  ["NewExpression .constructor()", `, NewExpression[callee.property.name='constructor']`, ``],
  ["Identifier Function", `selector: "Identifier[name='Function']"`, `selector: "NeverMatchingNodeType"`],
  ["computed [constructor|Function]", `MemberExpression[computed=true][property.value=/^(constructor|Function)$/], `, ``],
  ["computed template [constructor|Function]", `, MemberExpression[computed=true][property.type='TemplateLiteral'][property.quasis.0.value.cooked=/^(constructor|Function)$/]`, ``],
  ["MemberExpression .constructor", `"MemberExpression[property.name='constructor'], `, `"`],
  ["ObjectPattern key.name constructor", `ObjectPattern > Property[key.name='constructor'], `, ``],
  ["ObjectPattern key.value constructor", `, ObjectPattern > Property[key.value='constructor']`, ``],
  ["require .property part", `, CallExpression[callee.property.name=/^(require|createRequire)$/]`, ``],
  ["Identifier createRequire", `, Identifier[name='createRequire']`, ``],
  ["Reflect member", `selector: "MemberExpression[object.name='Reflect']"`, `selector: "NeverMatchingNodeType"`],
  ["TemplateElement constructor", `, TemplateElement[value.cooked='constructor']`, ``],
  ["Identifier constructor", `, Identifier[name='constructor']:not(MethodDefinition[kind='constructor'] > Identifier.key)`, ``],
  ["prototype reflection", `"Identifier[name=/^(getPrototypeOf|setPrototypeOf|getOwnPropertyDescriptors?|defineProperty|defineProperties|__proto__|__lookupGetter__|__lookupSetter__|__defineGetter__|__defineSetter__)$/]"`, `"NeverMatchingNodeType"`],
  ["computed-key part 1 (string concat)", `MemberExpression[computed=true] > BinaryExpression.property Literal[raw=/^[\\"']/], `, ``],
  ["computed-key part 2 (template w/ expr)", `, MemberExpression[computed=true] > TemplateLiteral.property[expressions.length>0]`, ``],
  ["computed-key part 3", `, MemberExpression[computed=true][object.type=${FN}]`, ``],
  ["computed-key part 4", `, MemberExpression[computed=true][object.expression.type=${FN}]`, ``],
  ["computed-key part 5", `, MemberExpression[computed=true][object.expression.expression.type=${FN}]`, ``],
  ["computed-key part 6", `, MemberExpression[computed=true][object.expression.expression.expression.type=${FN}]`, ``],
  ["host names", '`Identifier[name=/^(${FORMULA_HOST_NAMES.join("|")})$/]`', `"NeverMatchingNodeType"`],
  [":function[async=true]", `, :function[async=true]`, ``],
  ["member .then/.catch/.finally", `, MemberExpression[property.name=/^(then|catch|finally)$/]`, ``],
  ["computed ['then'] member", `, MemberExpression[computed=true][property.value=/^(then|catch|finally)$/]`, ``],
];
try {
  console.log(`# lint-ablation-full; node ${process.version}; root ${root}; head ${execFileSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8" }).trim()}`);
  for (const [label, from, to] of M) {
    const count = orig.split(from).length - 1;
    if (count !== 1) { console.log(`${label}\tANCHOR-COUNT=${count}`); continue; }
    writeFileSync(CFG, orig.replace(from, to));
    const imp = spawnSync("node", ["--input-type=module", "-e", `await import(${JSON.stringify("file://" + CFG + "?x=" + Date.now())})`], { cwd: root, encoding: "utf8" });
    if (imp.status !== 0) { console.log(`${label}\tCONFIG-INVALID`); continue; }
    const r = spawnSync("pnpm", ["exec", "vitest", "run", "--project", "unit-node", "packages/shared/src/formula/fuzz.test.ts", "--reporter=verbose"], { cwd: root, encoding: "utf8" });
    const out = r.stdout + r.stderr;
    const failed = [...out.matchAll(/^\s+×\s+(.*?)(\s\d+ms)?$/gm)].map((m) => m[1].slice(0, 70));
    console.log(`${label}\texit=${r.status}\t${r.status === 0 ? "SURVIVED-ALL" : "CAUGHT"}\t${(out.match(/Tests\s+[^\n]*/) ?? ["?"])[0]}${failed.length ? "\t" + failed.join(" | ") : ""}`);
  }
} finally {
  writeFileSync(CFG, orig);
  console.log(`# restored; git status --porcelain: '${execFileSync("git", ["-C", root, "status", "--porcelain"], { encoding: "utf8" }).trim()}'`);
}
