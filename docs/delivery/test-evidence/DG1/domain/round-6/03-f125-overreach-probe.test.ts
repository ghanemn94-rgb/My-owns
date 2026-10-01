// DG1 round-6 domain-reviewer probe (reviewer-authored evidence; not part of the candidate).
// F-DG1-125 over-reach check: the module lint now bans the `process` / `node:process` SPECIFIER. Confirm
//  (a) every legitimate specifier the real module tree uses, plus other ordinary node: built-ins, the shared packages and
//      every third-party api dependency, is still allowed;
//  (b) a module's ordinary use of the GLOBAL `process.env.X` is still not a violation (rule 3 unchanged);
//  (c) every import route of the process module (default, namespace, named, side-effect, require, dynamic import,
//      with and without `node:`) is now a violation;
//  (d) the real module tree still has zero violations.
// Copied to apps/api/src/zz-dom6-probe.test.ts in the disposable clone, run, then deleted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { bareAllowed, fileViolations, importsOf, MODULES_DIR, moduleViolations, walk } from "./architecture.testkit.ts";

const apiPkg = JSON.parse(readFileSync(join(MODULES_DIR, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const realSpecs = new Set<string>();
// AST-based (the lint's own scanner), so string literals are not mistaken for imports (a first regex-based draft of this
// probe harvested a regex literal from a source string; that was a probe bug, not a candidate defect).
for (const f of walk(MODULES_DIR)) for (const s of importsOf(f)) if (!s.startsWith(".")) realSpecs.add(s);

describe("F-DG1-125 over-reach probe (domain-reviewer r6)", () => {
  it("(a) legitimate specifiers stay allowed", () => {
    const legit = [
      ...realSpecs,
      "node:crypto", "node:fs", "node:path", "node:url", "node:buffer", "node:events", "node:util",
      "node:timers/promises", "node:stream", "node:perf_hooks", "node:os", "node:assert",
      "@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db",
      ...Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/")),
    ].filter((s) => s !== "vitest");
    const rejected = legit.filter((s) => !bareAllowed(s));
    console.log(`real-tree bare specifiers: ${[...realSpecs].sort().join(", ")}`);
    console.log(`checked ${legit.length} legitimate specifiers; rejected: ${JSON.stringify(rejected)}`);
    expect(rejected).toEqual([]);
  });
  it("(b) the global process.env read in module source is still fine", () => {
    const file = join(MODULES_DIR, "platform", "zz-probe.ts");
    const v = fileViolations("platform" as ApiModule, file, `export const tz = process.env.TZ ?? "Asia/Riyadh";\n`);
    console.log(`global process.env violations: ${JSON.stringify(v)}`);
    expect(v).toEqual([]);
  });
  it("(c) every import route of the process module is a violation", () => {
    const file = join(MODULES_DIR, "platform", "zz-probe.ts");
    const forms = [
      `import proc from "node:process";`, `import proc from "process";`,
      `import * as proc from "node:process";`, `import { env } from "node:process";`,
      `import "node:process";`, `const p = require("process");`, `const p = await import("node:process");`,
      `export { dlopen } from "node:process";`,
    ];
    const missed = forms.filter((src) => fileViolations("platform" as ApiModule, file, src + "\n").length === 0);
    console.log(`process import forms tested: ${forms.length}; missed: ${JSON.stringify(missed)}`);
    expect(missed).toEqual([]);
  });
  it("(d) the real module tree has zero violations", () => {
    const all = (Object.keys(API_MODULES) as ApiModule[]).flatMap((m) => moduleViolations(m));
    console.log(`real module tree violations: ${all.length}`);
    expect(all).toEqual([]);
  });
});
