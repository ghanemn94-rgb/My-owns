// T-DG3-KBE-E run-time layer probe (implementer's harness; NOT a reviewer file). Disposable clone only.
// Usage: node runtime-layer-probe.mjs <clone-root containing review-p2>
// For each reviewer form (snippets extracted verbatim from the reviewer's guard-bypass-probe.mjs FORMS table), append the
// snippet to evaluate.ts (as the reviewer's probe does), write a temporary test that CALLS the snippet's export, and run
// it (a) in the no-codegen project and (b) in unit-node as a control. The test asserts that the form ran without
// throwing, so "exit 1 + threw EvalError" in (a) means the run-time layer fails the engine's tests for that form.
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
const root = process.argv[2];
if (!root || !root.includes("review-p2")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p2");
const file = `${root}/packages/shared/src/formula/evaluate.ts`;
const testFile = `${root}/packages/shared/src/formula/zz-runtime-probe.test.ts`;
const original = readFileSync(file, "utf8");
const R = `as unknown as Record<string, (s: string) => () => unknown>`;
const FORMS = [
  ["O1", "Reflect.construct(Function, …)", `export const __o1 = (): unknown => Reflect.construct(Function, ["return 1"]);`],
  [
    "O2",
    "globalThis['ev'+'al']",
    `export const __o2 = (): unknown => (globalThis as unknown as Record<string, (s: string) => unknown>)["ev" + "al"]!("1");`,
  ],
  [
    "O3",
    "createRequire(import.meta.url)('vm')",
    `import { createRequire } from "node:module";\nexport const __o3 = (): unknown => createRequire(import.meta.url)("vm");`,
  ],
  ["O4", "Reflect.apply(Function, …)", `export const __o4 = (): unknown => Reflect.apply(Function, null, ["return 1"]);`],
  [
    "O5",
    "computed ['constructor'] on a generator prototype",
    `export const __o5 = (): unknown => (Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => unknown>)["constructor"]!("yield 1");`,
  ],
  ["O6", "alias F = Function", `const __F = Function;\nexport const __o6 = (): unknown => __F("return 1");`],
  [
    "N1",
    "computed member with an identifier key: f[k] where k = 'constructor'",
    `const __k1 = "constructor";\nexport const __n1 = (): unknown => ((() => 0) ${R})[__k1]!("return 6*7")();`,
  ],
  [
    "N2",
    "computed member with a concatenated key: f['con' + 'structor']",
    `export const __n2 = (): unknown => ((() => 0) ${R})["con" + "structor"]!("return 6*7")();`,
  ],
  [
    "N3",
    "Object.getOwnPropertyDescriptor(fnProto, 'constructor').value",
    `export const __n3 = (): unknown =>\n  (Object.getOwnPropertyDescriptor(Object.getPrototypeOf(() => 0), "constructor")!.value as (s: string) => () => unknown)("return 6*7")();`,
  ],
  [
    "N4",
    "destructuring with a computed identifier key: const { [k]: C } = generator prototype",
    `const __k4 = "constructor";\nconst { [__k4]: __C4 } = Object.getPrototypeOf(function* () {}) as Record<string, (s: string) => () => Iterator<unknown>>;\nexport const __n4 = (): unknown => __C4!("yield 6*7")().next().value;`,
  ],
  [
    "N5",
    "AsyncFunction through the prototype, key built with join",
    `const __k5 = ["con", "structor"].join("");\nexport const __n5 = (): unknown => (Object.getPrototypeOf(async () => 0) as Record<string, (s: string) => () => Promise<unknown>>)[__k5]!("return 6*7")();`,
  ],
  [
    "N6",
    "tagged template on the constructor reached by an identifier key",
    "const __k6 = \"constructor\";\nexport const __n6 = (): unknown => ((() => 0) as unknown as Record<string, (s: TemplateStringsArray) => () => unknown>)[__k6]!`return 6*7`();",
  ],
  [
    "N7",
    "Node 'global' indexing: global['ev'+'al']",
    `declare const global: Record<string, (s: string) => unknown>;\nexport const __n7 = (): unknown => global["ev" + "al"]!("6*7");`,
  ],
  [
    "N8",
    "browser 'self' indexing: self['ev'+'al']",
    `declare const self: Record<string, (s: string) => unknown>;\nexport const __n8 = (): unknown => self["ev" + "al"]!("6*7");`,
  ],
  [
    "N9",
    "process.getBuiltinModule('node:vm').runInThisContext",
    `declare const process: { getBuiltinModule(id: string): { runInThisContext(code: string): unknown } };\nexport const __n9 = (): unknown => process.getBuiltinModule("node:vm").runInThisContext("6*7");`,
  ],
  [
    "N10",
    "static import of node:inspector, Runtime.evaluate",
    `import { Session } from "node:inspector";\nexport const __n10 = (): void => {\n  const s = new Session();\n  s.connect();\n  s.post("Runtime.evaluate", { expression: "6*7" }, () => undefined);\n};`,
  ],
  [
    "N11",
    "static import of node:repl",
    `import * as __repl from "node:repl";\nexport const __n11 = (): unknown => __repl.start;`,
  ],
  [
    "N12",
    "import.meta.resolve (resolves a specifier; loads and runs nothing)",
    `export const __n12 = (): unknown => import.meta.resolve("node:vm");`,
  ],
];
const testSource = (name) => `import { expect, it } from "vitest";
import * as ev from "./evaluate.ts";
it("runtime probe ${name}", async () => {
  const fn = (ev as unknown as Record<string, () => unknown>)["${name}"]!;
  let outcome: string;
  try {
    const v = await fn();
    outcome = "returned " + (typeof v === "function" ? "a function" : JSON.stringify(v));
  } catch (e) {
    outcome = "threw " + (e as Error).name + ": " + (e as Error).message;
  }
  console.log("RUNTIME-OUTCOME " + outcome);
  expect(outcome.startsWith("threw"), outcome).toBe(false);
});
`;
const sh = (args) => {
  const r = spawnSync("pnpm", args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 << 20 });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  const m = out.match(/RUNTIME-OUTCOME (.*)/);
  return { code: r.status, outcome: m ? m[1].trim() : `(no outcome line) ${out.split("\n").filter((l) => /Error|error/.test(l)).slice(0, 2).join(" | ")}` };
};
const rows = [];
try {
  for (const [id, what, snippet] of FORMS) {
    const name = `__${id.toLowerCase()}`;
    writeFileSync(file, `${original}\n// --- runtime probe ${id} (disposable clone only) ---\n${snippet}\n`);
    writeFileSync(testFile, testSource(name));
    const ng = sh(["vitest", "run", "--project", "unit-formula-nocodegen", "packages/shared/src/formula/zz-runtime-probe.test.ts"]);
    const ctl = sh(["vitest", "run", "--project", "unit-node", "packages/shared/src/formula/zz-runtime-probe.test.ts"]);
    console.log(`\n=== ${id}: ${what}\n  no-codegen project: exit=${ng.code}  ${ng.outcome}\n  unit-node control:  exit=${ctl.code}  ${ctl.outcome}`);
    rows.push(`${id.padEnd(4)} nocodegen exit=${ng.code} [${ng.outcome.slice(0, 90)}] | control exit=${ctl.code} [${ctl.outcome.slice(0, 60)}]`);
  }
} finally {
  writeFileSync(file, original);
  rmSync(testFile, { force: true });
}
const st = spawnSync("git", ["status", "--porcelain", "packages/shared"], { cwd: root, encoding: "utf8" });
console.log(`\n# evaluate.ts restored, probe test removed; git status packages/shared: '${st.stdout.trim()}'`);
console.log(`\n# SUMMARY\n${rows.join("\n")}`);
