// code-security-reviewer DG3 round-2 guard-bypass probe (T-DG3-REV-SEC-R2). Disposable clone ONLY ($TMPDIR/review-p2);
// never run in the candidate tree. Usage: node guard-bypass-probe.mjs <clone-root>
//
// For each form: evaluate.ts := original + "\n" + snippet; then run, in the clone,
//   (1) eslint on evaluate.ts            (the ESLint override for packages/shared/src/formula/**)
//   (2) the engine's own source-scan test (fuzz.test.ts -t "engine sources contain")
//   (3) tsc on packages/shared           (informational only: typecheck is not one of the two guards)
// and restore evaluate.ts from the original bytes afterwards. A form "passes both guards" when (1) and (2) exit 0.
// SUPPLEMENT: X1-X3 are forms the fix claims to refuse, checked independently (generated from guard-bypass-probe.mjs).
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const root = process.argv[2];
if (!root || !root.includes("review-p2")) throw new Error("refusing: pass the disposable clone $TMPDIR/review-p2");
const file = `${root}/packages/shared/src/formula/evaluate.ts`;
const original = readFileSync(file, "utf8");

const R = `as unknown as Record<string, (s: string) => () => unknown>`;
const FORMS = [
  [
    "X1",
    "plain destructuring { constructor } of a generator prototype",
    `const { constructor: __X1 } = Object.getPrototypeOf(function* () {}) as { constructor: (s: string) => () => Iterator<unknown> };\nexport const __x1 = (): unknown => __X1("yield 1")().next().value;`,
  ],
  [
    "X2",
    "Object.getOwnPropertyDescriptors(fnProto).constructor.value",
    `export const __x2 = (): unknown =>\n  (Object.getOwnPropertyDescriptors(Object.getPrototypeOf(() => 0)) as unknown as Record<string, { value: (s: string) => () => unknown }>).constructor!.value("return 1")();`,
  ],
  [
    "X3",
    "globalThis.Function",
    `export const __x3 = (): unknown => (globalThis as unknown as Record<string, (s: string) => () => unknown>).Function!("return 1")();`,
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
