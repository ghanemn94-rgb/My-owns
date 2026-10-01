// DG1 round-7 domain-reviewer probe (reviewer-authored evidence; not part of the candidate).
// F-DG1-127 over-reach check: the module lint now bans the `sqlite` / `node:sqlite` SPECIFIER. Confirm
//  (a) every legitimate specifier (real module tree via the lint's own AST scanner, ordinary node: built-ins, shared
//      packages, every third-party api dependency) is still allowed;
//  (b) DIFFERENTIAL: over a broad specifier corpus, the ONLY verdict changes vs the round-6 testkit (0026a7b, copied in
//      as zz-r6.testkit.ts) are `sqlite` and `node:sqlite` (allowed -> rejected); nothing else is newly rejected;
//  (c) every import route of the sqlite module is a violation;
//  (d) the real module tree has zero violations; global process.env read still fine.
// Copied to apps/api/src/zz-dom7-probe.test.ts in the disposable clone, run, then deleted.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { API_MODULES, type ApiModule } from "./modules.ts";
import { bareAllowed, fileViolations, importsOf, MODULES_DIR, moduleViolations, walk } from "./architecture.testkit.ts";
import { bareAllowed as bareAllowedR6 } from "./zz-r6.testkit.ts";

const apiPkg = JSON.parse(readFileSync(join(MODULES_DIR, "../../package.json"), "utf8")) as {
  dependencies: Record<string, string>;
};
const realSpecs = new Set<string>();
for (const f of walk(MODULES_DIR)) for (const s of importsOf(f)) if (!s.startsWith(".")) realSpecs.add(s);
const deps = Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/"));
const builtins = [
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "crypto", "dgram", "diagnostics_channel",
  "dns", "events", "fs", "fs/promises", "http", "http2", "https", "inspector", "module", "net", "os", "path",
  "perf_hooks", "process", "querystring", "readline", "repl", "sqlite", "stream", "string_decoder", "test", "timers",
  "timers/promises", "tls", "trace_events", "tty", "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
];
const corpus = [
  ...realSpecs, ...builtins, ...builtins.map((b) => `node:${b}`),
  "sqlite3", "better-sqlite3", "node:sqlite3", "sqlite/x", "@mth/shared", "@mth/shared/schemas", "@mth/config",
  "@mth/db", ...deps,
];

describe("F-DG1-127 over-reach probe (domain-reviewer r7)", () => {
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
  it("(b) differential vs round-6 testkit: only sqlite/node:sqlite change", () => {
    const changed = [...new Set(corpus)].filter((s) => bareAllowed(s) !== bareAllowedR6(s))
      .map((s) => `${s}: r6=${bareAllowedR6(s)} r7=${bareAllowed(s)}`);
    console.log(`corpus ${new Set(corpus).size} specifiers; verdict changes: ${JSON.stringify(changed)}`);
    // Run 1 expected both spellings to flip; bare `sqlite` was ALREADY rejected in r6 (a bare non-node: specifier must
    // be a declared api dependency), so only `node:sqlite` flips. Probe expectation bug, not a candidate defect.
    expect(changed).toEqual(["node:sqlite: r6=true r7=false"]);
    expect(bareAllowed("sqlite") || bareAllowed("node:sqlite")).toBe(false);
  });
  it("(c) every import route of the sqlite module is a violation", () => {
    const file = join(MODULES_DIR, "platform", "zz-probe.ts");
    const forms = [
      `import { DatabaseSync } from "node:sqlite";`, `import { DatabaseSync } from "sqlite";`,
      `import * as s from "node:sqlite";`, `import s from "node:sqlite";`, `import "node:sqlite";`,
      `const s = require("node:sqlite");`, `const s = await import("node:sqlite");`,
      `export { DatabaseSync } from "node:sqlite";`, `export * from "sqlite";`,
    ];
    const missed = forms.filter((src) => fileViolations("platform" as ApiModule, file, src + "\n").length === 0);
    console.log(`sqlite import forms tested: ${forms.length}; missed: ${JSON.stringify(missed)}`);
    expect(missed).toEqual([]);
  });
  it("(d) real module tree has zero violations; global process.env read still fine", () => {
    const all = (Object.keys(API_MODULES) as ApiModule[]).flatMap((m) => moduleViolations(m));
    const file = join(MODULES_DIR, "platform", "zz-probe.ts");
    const v = fileViolations("platform" as ApiModule, file, `export const tz = process.env.TZ ?? "Asia/Riyadh";\n`);
    console.log(`real module tree violations: ${all.length}; global process.env violations: ${JSON.stringify(v)}`);
    expect(all).toEqual([]);
    expect(v).toEqual([]);
  });
});
