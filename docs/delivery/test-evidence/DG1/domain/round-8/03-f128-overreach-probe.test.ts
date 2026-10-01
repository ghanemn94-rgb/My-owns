// DG1 round-8 domain-reviewer probe (reviewer-authored evidence; not part of the candidate).
// F-DG1-128 over-reach check: the module lint now bans the `test` / `node:test` SPECIFIER and the `process.execve`
// member (rule 3). Confirm
//  (a) every legitimate specifier (real module tree via the lint's own AST scanner, ordinary node: built-ins, shared
//      packages, every third-party api dependency) is still allowed;
//  (b) DIFFERENTIAL (specifiers): over a broad corpus incl. EVERY Node `builtinModules` entry (bare and node:) plus the
//      prefix-only modules, the ONLY verdict change vs the round-7 testkit (a6bdea0, copied in as zz-r7.testkit.ts) is
//      node:test (bare `test` is already rejected: a bare non-node: specifier must be a declared api dependency);
//  (c) DIFFERENTIAL (process members): over every own+prototype key of the live `process` object, the ONLY member whose
//      `process.<m>` read/call newly becomes a violation is `execve`; ordinary reads (env, cwd, hrtime, ...) stay clean;
//  (d) the import/call routes to node:test run and process.execve are violations;
//  (e) the real module tree has zero violations.
// Copied to apps/api/src/zz-dom8-probe.test.ts in the disposable clone, run, then deleted.
// Run 1 relied on builtinModules alone; Node 22's builtinModules OMITS the prefix-only modules (node:test, node:sqlite,
// node:sea), so node:test was never in the corpus and (b) saw no change (probe bug, see *.run1-probe-bug.out.txt).
// Run 2 adds them explicitly.
import { builtinModules } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { bareAllowed, fileViolations, importsOf, MODULES_DIR, moduleViolations, walk } from "./architecture.testkit.ts";
import { bareAllowed as bareAllowedR7, fileViolations as fileViolationsR7 } from "./zz-r7.testkit.ts";

const apiPkg = JSON.parse(readFileSync(join(MODULES_DIR, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const realSpecs = new Set<string>();
for (const f of walk(MODULES_DIR)) for (const s of importsOf(f)) if (!s.startsWith(".")) realSpecs.add(s);
const deps = Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/"));
const builtins = builtinModules.map((b) => b.replace(/^node:/, ""));
const corpus = [
  ...realSpecs, ...builtins, ...builtins.map((b) => `node:${b}`), "node:test/reporters", "test/reporters",
  "test", "node:test", "sqlite", "node:sqlite", "sea", "node:sea",
  "@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db", "vitest", ...deps,
];
const probeFile = join(MODULES_DIR, "platform", "zz-probe.ts");

describe("F-DG1-128 over-reach probe (domain-reviewer r8)", () => {
  it("(a) legitimate specifiers stay allowed", () => {
    const legit = [
      ...realSpecs, "node:crypto", "node:fs", "node:path", "node:url", "node:buffer", "node:events", "node:util",
      "node:timers/promises", "node:stream", "node:perf_hooks", "node:os", "node:assert",
      "@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db", ...deps,
    ].filter((s) => s !== "vitest");
    const rejected = legit.filter((s) => !bareAllowed(s));
    console.log(`real-tree bare specifiers: ${[...realSpecs].sort().join(", ")}`);
    console.log(`checked ${legit.length} legitimate specifiers; rejected: ${JSON.stringify(rejected)}`);
    expect(rejected).toEqual([]);
  });
  it("(b) specifier differential vs round-7 testkit: only node:test changes", () => {
    const changed = [...new Set(corpus)].filter((s) => bareAllowed(s) !== bareAllowedR7(s))
      .map((s) => `${s}: r7=${bareAllowedR7(s)} r8=${bareAllowed(s)}`);
    console.log(`corpus ${new Set(corpus).size} specifiers (builtinModules=${builtinModules.length}); verdict changes: ${JSON.stringify(changed)}`);
    expect(changed).toEqual(["node:test: r7=true r8=false"]);
    expect(bareAllowed("test") || bareAllowed("node:test")).toBe(false);
  });
  it("(c) process-member differential vs round-7 testkit: only execve newly flagged", () => {
    const keys = new Set<string>();
    for (let o: object | null = process; o && o !== Object.prototype; o = Object.getPrototypeOf(o))
      for (const k of Object.getOwnPropertyNames(o)) if (/^[A-Za-z_$][\w$]*$/.test(k)) keys.add(k);
    keys.add("execve");
    const newly: string[] = [];
    const flaggedBoth: string[] = [];
    for (const k of [...keys].sort()) {
      const src = `export const x = process.${k};\n`;
      const r8 = fileViolations("platform" as ApiModule, probeFile, src).length > 0;
      const r7 = fileViolationsR7("platform" as ApiModule, probeFile, src).length > 0;
      if (r8 && !r7) newly.push(k);
      if (r8 && r7) flaggedBoth.push(k);
      if (r7 && !r8) newly.push(`UNFLAGGED:${k}`);
    }
    console.log(`process members checked: ${keys.size}; newly flagged: ${JSON.stringify(newly)}; flagged in both: ${JSON.stringify(flaggedBoth)}`);
    expect(newly).toEqual(["execve"]);
    const ordinary = ["env", "cwd", "hrtime", "nextTick", "platform", "version", "pid", "uptime", "memoryUsage", "on", "emitWarning", "exitCode"];
    for (const k of ordinary)
      expect(fileViolations("platform" as ApiModule, probeFile, `export const x = process.${k};\n`)).toEqual([]);
  });
  it("(d) node:test and process.execve routes are violations", () => {
    const forms = [
      `import { run } from "node:test";`, `import { run } from "test";`, `import * as t from "node:test";`,
      `import t from "node:test";`, `import "node:test";`, `const t = require("node:test");`,
      `const t = await import("node:test");`, `export { run } from "node:test";`, `export * from "node:test";`,
      `process.execve("/bin/sh", ["sh"]);`, `process.execve?.("/bin/sh");`, `const e = process.execve;`,
      `const { execve } = process;`, `globalThis.process.execve("/bin/sh");`, `process["execve"]("/bin/sh");`,
    ];
    const missed = forms.filter((src) => fileViolations("platform" as ApiModule, probeFile, src + "\n").length === 0);
    console.log(`node:test / execve forms tested: ${forms.length}; missed: ${JSON.stringify(missed)}`);
    expect(missed).toEqual([]);
  });
  it("(e) real module tree has zero violations", () => {
    const all = (Object.keys(API_MODULES) as ApiModule[]).flatMap((m) => moduleViolations(m));
    console.log(`real module tree violations: ${all.length}`);
    expect(all).toEqual([]);
  });
});
