// code-security-reviewer DG3 round-2 guard-bypass probe (T-DG3-REV-SEC-R2). Disposable clone ONLY ($TMPDIR/review-p2);
// never run in the candidate tree. Usage: node guard-bypass-probe.mjs <clone-root>
//
// For each form: evaluate.ts := original + "\n" + snippet; then run, in the clone,
//   (1) eslint on evaluate.ts            (the ESLint override for packages/shared/src/formula/**)
//   (2) the engine's own source-scan test (fuzz.test.ts -t "engine sources contain")
//   (3) tsc on packages/shared           (informational only: typecheck is not one of the two guards)
// and restore evaluate.ts from the original bytes afterwards. A form "passes both guards" when (1) and (2) exit 0.
// O1-O6 are the round-1 F-DG3-100 bypasses (must now FAIL both guards). N1-N12 are new attempts at the same class.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p2")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p2");
const file = `${root}/packages/shared/src/formula/evaluate.ts`;
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

const sh = (cmd, args) => {
  const r = spawnSync(cmd, args, { cwd: root, encoding: "utf8", env: process.env, maxBuffer: 64 << 20 });
  return { code: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
};
const pick = (out, re) =>
  out
    .split("\n")
    .filter((l) => re.test(l))
    .map((l) => `      ${l.trim()}`)
    .join("\n");

const summary = [];
try {
  for (const [id, what, snippet] of FORMS) {
    writeFileSync(file, `${original}\n// --- reviewer probe ${id} (disposable clone only) ---\n${snippet}\n`);
    const lint = sh("npx", ["eslint", "packages/shared/src/formula/evaluate.ts"]);
    const scan = sh("pnpm", [
      "vitest",
      "run",
      "--project",
      "unit-node",
      "packages/shared/src/formula/fuzz.test.ts",
      "-t",
      "engine sources contain",
    ]);
    const tsc = sh("npx", ["tsc", "-p", "packages/shared", "--noEmit"]);
    const lintBlocks = lint.code !== 0;
    const scanBlocks = scan.code !== 0;
    const verdict = lintBlocks && scanBlocks ? "BLOCKED BY BOTH" : lintBlocks || scanBlocks ? "BLOCKED BY ONE" : "PASSES BOTH GUARDS";
    console.log(`\n=== ${id}: ${what}\n--- snippet:\n${snippet}`);
    console.log(`  eslint exit=${lint.code}\n${pick(lint.out, /error|problem/)}`);
    console.log(`  source-scan exit=${scan.code}\n${pick(scan.out, /AssertionError|Expected|\+ +"|Tests +\d|FAIL|✓|×/)}`);
    console.log(`  tsc (informational) exit=${tsc.code}\n${pick(tsc.out, /error TS/)}`);
    console.log(`  ==> ${verdict}`);
    summary.push(`${id.padEnd(4)} eslint=${lint.code} scan=${scan.code} tsc=${tsc.code}  ${verdict}  (${what})`);
  }
} finally {
  writeFileSync(file, original);
}
const st = sh("git", ["status", "--porcelain", "packages/shared"]);
console.log(`\n# evaluate.ts restored; git status packages/shared: '${st.out.trim()}'`);
console.log(`\n# SUMMARY\n${summary.join("\n")}`);
