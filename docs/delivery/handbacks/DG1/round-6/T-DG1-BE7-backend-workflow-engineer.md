# Handback T-DG1-BE7 — F-DG1-125 module-lint native-loader import bypass (backend-workflow-engineer)

- Stage: DG1 (P1), round-6 repair. Base: `HEAD` 3037ce2722bbfd94786a7468be8ad94cd9fab6c1 (working tree; nothing committed).
- invocation_reference: `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE7-backend-workflow-engineer-20261001T120924Z-8edb3c8f","session_id":"8edb3c8f-40e4-44f8-8032-521f7481e241"}`
- Assignment: `docs/delivery/assignments/DG1/round-6/T-DG1-BE7.md` (sha256 d448be96…7c33ac, verified).
- Migrations: none. API endpoints added: none (test-only lint change).

## 1. Changed files
- `apps/api/src/architecture.testkit.ts` — adds `process` / `node:process` to `LOADER_BUILTINS`, so `bareAllowed()` returns `false` and any import of the process module from module source is the specifier violation `imports package node:process` (or `process`). The header doc (list of banned built-ins, and rule 3's description) and the `LOADER_BUILTINS` JSDoc now say so. Rule 3 (`PROCESS_LOADERS`, `root === "process"`) is unchanged.
- `apps/api/src/architecture.test.ts` — adds self-checks X6, X7 and X8 to the F-DG1-124 `it.each` table (4th column `"missed"`), each asserting `/imports package node:process/`. P12 (global `process.binding`) is kept unchanged as the regression guard for the global form.

## 2. Behaviour delivered (REQ-S16-003, F-DG1-125)
- `import proc from "node:process"; proc.dlopen(...)` (X6), `(proc as any).binding("fs")` (X7) and `import { dlopen } from "node:process"` (X8) are now violations. Before, they produced zero violations. The fix closes default, namespace and named imports at once, because each of them needs an `import … from "node:process"|"process"` specifier. The same holds for `export … from`, `import x = require("process")` and literal `import("node:process")`, because they all go through the same specifier check.
- Before/after evidence: I added the tests first and ran them against the unchanged testkit. X6, X7 and X8 all failed with `expected 0 to be greater than 0` (violations `[]`): 3 failed, 74 passed. After the testkit change, all 77 pass.
- Legitimate-use cost: none. No module source imports process (grep below).

## 3. Checks actually run (local, offline, node_modules present, no pnpm install)

### Before the fix (tests added, testkit unchanged)
`pnpm vitest run apps/api/src/architecture.test.ts`
```
AssertionError: X7 node:process default import .binding: []: expected 0 to be greater than 0
AssertionError: X8 node:process named import dlopen: []: expected 0 to be greater than 0
 Test Files  1 failed (1)
      Tests  3 failed | 74 passed (77)
```

### After the fix
`pnpm vitest run apps/api/src/architecture.test.ts` → exit 0
```
 ✓ |unit-node| apps/api/src/architecture.test.ts (77 tests) 912ms
   ✓ API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages  526ms
 Test Files  1 passed (1)
      Tests  77 passed (77)
```
`pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose` (relevant lines):
```
 ✓ ... API module boundaries (ADR-0002) > has only mapped module directories, and every P1 module has a public index.ts
 ✓ ... API module boundaries (ADR-0002) > the six §16 business modules all exist, each with its own test suite (A12; D-048)
 ✓ ... API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 549ms
 ✓ ... API module boundaries (ADR-0002) > the declared module graph is acyclic, and audit/access depend on no business module
 ✓ ... self-check ... > P12 process.binding is a violation (round-4 lint: 'missed')
 ✓ ... self-check ... > X6 node:process default import .dlopen is a violation (round-4 lint: 'missed')
 ✓ ... self-check ... > X7 node:process default import .binding is a violation (round-4 lint: 'missed')
 ✓ ... self-check ... > X8 node:process named import dlopen is a violation (round-4 lint: 'missed')
      Tests  77 passed (77)
```
The "every import respects …" test is the real-module-tree check. It asserts zero `moduleViolations` for every module.

`pnpm --filter @mth/api run typecheck` → exit 0
```
> @mth/api@0.1.0 typecheck /home/user/My-owns/apps/api
> tsc -p tsconfig.json
```
`pnpm exec eslint apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` → exit 0, no output.
`pnpm exec prettier --check <both files>` → "All matched files use Prettier code style!"

`grep -rn "node:process\|from \"process\"" apps packages --include=*.ts --include=*.tsx --exclude-dir=node_modules`: matches occur only in the two edited lint files (comments and the X6–X8 plant strings). With those two files excluded, `grep -rn 'from "node:process"\|from "process"\|require("process")' …` returns no match (exit 1). Module source has no import of process, so the real tree stays green.

## 4. Known gaps / not done
- None for F-DG1-125. The residual limit stated in the testkit header (runtime data flow into third-party keyed readers) is unchanged and out of scope.
- The table's 4th-column label reads "round-4 lint: $3". For X6–X8, "missed" means missed by the lint before this fix (HEAD 3037ce2), as I verified above.
- Not mine: `docs/delivery/decisions.md` and `docs/delivery/findings.json` were already modified in the working tree before I started. I did not touch them.
- An author never closes their own finding: a non-author reviewer must verify F-DG1-125.

## 5. Merge instructions
- No migrations and no ordering constraints. Only the two test-only files changed. `*.testkit.ts` is excluded from the build.

## Exact diff
```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index 5ca71ee..da23056 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -313,6 +313,26 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       /unparseable source: '\)' expected/,
       "missed",
     ],
+    // F-DG1-125: an import of the process module aliased it past rule 3 (which only knows the global identifier
+    // `process`). Importing `process` / `node:process` is now itself a specifier violation (LOADER_BUILTINS).
+    [
+      "X6 node:process default import .dlopen",
+      `import proc from "node:process";\nproc.dlopen({ exports: {} } as any, "/tmp/x.node");`,
+      /imports package node:process/,
+      "missed",
+    ],
+    [
+      "X7 node:process default import .binding",
+      `import proc from "node:process";\nconst fs = (proc as any).binding("fs");`,
+      /imports package node:process/,
+      "missed",
+    ],
+    [
+      "X8 node:process named import dlopen",
+      `import { dlopen } from "node:process";\ndlopen({ exports: {} } as any, "/tmp/x.node");`,
+      /imports package node:process/,
+      "missed",
+    ],
     // Prior forms (F-DG1-117/121), still caught: regression guards for the blanket rules.
     ["P17 module.constructor", `const M = module.constructor;`, /module used as a value[\s\S]*\.constructor/, "caught"],
     [
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 54e671d..d9592d5 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -6,7 +6,8 @@
 //    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
 //  - a computed `import(expr)` / `require(expr)` (the target cannot be checked), and any import of the built-ins that
 //    hand out a loader or evaluate code (`module`, `vm`, `worker_threads`, `inspector`, `repl`, `child_process`,
-//    `cluster`; with or without `node:`).
+//    `cluster`, `process`; with or without `node:`). F-DG1-125: importing `process` / `node:process` is itself banned
+//    (an imported binding aliases the process object past rule 3; the global is a Node global, no module imports it).
 //
 // F-DG1-124 - BLANKET BAN of the dynamic-code-loading primitives in module source. F-DG1-117 and F-DG1-121 matched
 // ever more spellings of the same thing (`.constructor()`, aliased `.constructor`, destructured `constructor`, ...)
@@ -29,6 +30,8 @@
 //  3. RUNTIME ROOTS `process`, `globalThis`, `global`: used other than as `root.member` (aliased, passed,
 //     destructured), indexed at all (`process["x"]`), `globalThis.<root|primitive>`, and the native loaders
 //     `process.binding` / `process._linkedBinding` / `process.dlopen`; the CommonJS free variable `module` as a value.
+//     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
+//     a named `{ dlopen }` import) is closed by the specifier check instead, which bans `process`/`node:process`.
 //  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
 // Nothing is executed. Residual limit (stated, not closable statically): a string computed at RUNTIME and handed to
 // third-party code that itself reads `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`) is
@@ -47,11 +50,23 @@ const apiPkg = JSON.parse(readFileSync(join(SRC, "../package.json"), "utf8")) as
 };
 const THIRD_PARTY = new Set(Object.keys(apiPkg.dependencies).filter((d) => !d.startsWith("@mth/")));
 const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/config", "@mth/db"]);
-/** Built-ins that hand out an unchecked loader or evaluate code; a module never needs them. */
+/**
+ * Built-ins that hand out an unchecked loader or evaluate code; a module never needs them. F-DG1-125: `process` too -
+ * an imported process object (default, namespace or named `{ dlopen }`/`{ binding }`) is a local binding that rule 3's
+ * `process.<loader>` check cannot see, so the import itself is the violation. The global `process` stays under rule 3.
+ */
 const LOADER_BUILTINS = new Set(
-  ["module", "vm", "worker_threads", "inspector", "inspector/promises", "repl", "child_process", "cluster"].flatMap(
-    (b) => [b, `node:${b}`],
-  ),
+  [
+    "module",
+    "vm",
+    "worker_threads",
+    "inspector",
+    "inspector/promises",
+    "repl",
+    "child_process",
+    "cluster",
+    "process",
+  ].flatMap((b) => [b, `node:${b}`]),
 );
 /** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
 const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
```
