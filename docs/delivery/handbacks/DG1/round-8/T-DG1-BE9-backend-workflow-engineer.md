# Handback T-DG1-BE9: F-DG1-128 module-lint, close node:test and process.execve (backend-workflow-engineer)

- **Stage:** DG1 (round-8 repair). **Task:** T-DG1-BE9. **Finding:** F-DG1-128 (Low, non-mandatory, REQ-S16-003).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE9-backend-workflow-engineer-20261001T132228Z-f6164169","session_id":"f6164169-dd9d-4cdb-90f9-ad170484ec1f"}`
- **Base:** `HEAD` = `c36315bce4992a3034643cea7f9cb624067953f8`. Before my edits there were no tracked changes under `apps/`. The repository top level has some pre-existing untracked dotfiles (`.bashrc`, `.idea`, …). They are not mine and I did not touch them.
- **Assignment file:** `docs/delivery/assignments/DG1/round-8/T-DG1-BE9.md`. Its sha256 `ebfc2ece…e2fd80` matches the hash I was given.
- **Environment:** Node v22.22.2, offline, using the existing `node_modules` (no install). No database was needed because this lint is static and makes no PostgreSQL calls.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Adds `test` to `LOADER_BUILTINS`, which bans both `test` and `node:test`. Adds `execve` to `PROCESS_LOADERS` (rule 3). Updates the header, the JSDoc and rule-3 text, and narrows residual (c). |
| `apps/api/src/architecture.test.ts` | Adds self-check cases R1 (`node:test` in-process run) and R2 (`process.execve`) to the F-DG1-124 `it.each` table, with 4th column `"missed"`. |

These are the only two files I edited. I changed no module source, other product code, `tools/**`, `docs/source/**`, reviews or gate records.

## 2. Behaviour delivered (REQ-S16-003 / F-DG1-128)

- **R1, `node:test`:** an import of `node:test` (or bare `test`) is now a specifier violation: `imports package node:test`. The reason is that `run({ files: [<computed path>], isolation: "none" })` loads a file from a runtime-computed path into the same process. That is a computed import with no code generation, so residual (b) does not cover it.
- **R2, global `process.execve`:** rule 3 now reports `module loader via process.execve`. It is the same class as the banned `child_process`/`cluster`. F-DG1-125 already closed the route that imports it through `node:process`.
- **Residual (c), narrowed:** the header now says the concrete loader/exec built-ins and `process.*` methods of the **pinned** Node 22.x are enumerated exhaustively. The source for that claim is the round-7 code-security sweep of `builtinModules` and `process.*`. The enumerated set is:
  - built-ins `module`, `vm`, `worker_threads`, `inspector`, `repl`, `child_process`, `cluster`, `process`, `sqlite`, `test`;
  - `process` methods `binding`, `_linkedBinding`, `dlopen`, `execve`.

  What remains in (c) is genuinely future or unknown built-ins and methods of a later Node version, plus `WebAssembly` / `node:wasi` instantiation (a wasm exec, not a JS-module loader). The rationale is unchanged: this is static defence-in-depth for ADR-0002 over human-reviewed code with a read-only production tree, not a runtime boundary. The header also notes, as deferred and outside P1, that a later hardening could switch module-source `node:` imports to a default-deny allow-list (module source uses only `node:crypto`, `node:fs`, `node:path` and `node:url`).
- **Regression guards kept unchanged:** P12 (`process.binding`), X6–X8 (`node:process`) and A1 (`node:sqlite`) all still pass.
- **Naming of the 4th column:** in the R1/R2 rows, `"missed"` means the lint as it stood just before this fix (HEAD `c36315b`), as the rows' comment says. The shared test title template still reads "round-4 lint", the same as for the A1 row.

## 3. Exact diff

```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index 13e9b79..db34be0 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -342,6 +342,23 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       /imports package node:sqlite/,
       "missed",
     ],
+    // F-DG1-128: the last two concrete loader/exec routes of the pinned Node version (round-7 builtinModules +
+    // process.* sweep). R1: node:test `run({ files, isolation: "none" })` imports a runtime-computed path IN-PROCESS
+    // (a loader built-in, no code generation), so `test` / `node:test` is in LOADER_BUILTINS. R2: the global
+    // `process.execve` replaces the process with an arbitrary executable (the child_process/cluster class), so
+    // `execve` is in PROCESS_LOADERS (rule 3). "missed" = 0 violations before this fix.
+    [
+      "R1 node:test in-process run",
+      `import { run } from "node:test";\nconst p = ["../access/", "policy.ts"].join("");\nfor await (const _ of run({ files: [new URL(p, import.meta.url).pathname], isolation: "none" })) {}`,
+      /imports package node:test/,
+      "missed",
+    ],
+    [
+      "R2 process.execve",
+      `process.execve("/bin/sh", ["sh", "-c", "id"]);`,
+      /module loader via process\.execve/,
+      "missed",
+    ],
     // Prior forms (F-DG1-117/121), still caught: regression guards for the blanket rules.
     ["P17 module.constructor", `const M = module.constructor;`, /module used as a value[\s\S]*\.constructor/, "caught"],
     [
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index b48e639..3b08d75 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -6,9 +6,10 @@
 //    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
 //  - a computed `import(expr)` / `require(expr)` (the target cannot be checked), and any import of the built-ins that
 //    hand out a loader or evaluate code (`module`, `vm`, `worker_threads`, `inspector`, `repl`, `child_process`,
-//    `cluster`, `process`, `sqlite`; with or without `node:`). F-DG1-125: importing `process` / `node:process` is
-//    itself banned (an imported binding aliases the process object past rule 3; the global is a Node global, no module
-//    imports it). F-DG1-127: `sqlite` / `node:sqlite` (`loadExtension` loads a native shared object).
+//    `cluster`, `process`, `sqlite`, `test`; with or without `node:`). F-DG1-125: importing `process` /
+//    `node:process` is itself banned (an imported binding aliases the process object past rule 3; the global is a Node
+//    global, no module imports it). F-DG1-127: `sqlite` / `node:sqlite` (`loadExtension` loads a native shared
+//    object). F-DG1-128: `test` / `node:test` (`run({ files, isolation: "none" })` imports a computed path in-process).
 //
 // F-DG1-124 - BLANKET BAN of the dynamic-code-loading primitives in module source. F-DG1-117 and F-DG1-121 matched
 // ever more spellings of the same thing (`.constructor()`, aliased `.constructor`, destructured `constructor`, ...)
@@ -30,7 +31,9 @@
 //     (a Map returns only what was put in it and never reaches the prototype chain).
 //  3. RUNTIME ROOTS `process`, `globalThis`, `global`: used other than as `root.member` (aliased, passed,
 //     destructured), indexed at all (`process["x"]`), `globalThis.<root|primitive>`, and the native loaders
-//     `process.binding` / `process._linkedBinding` / `process.dlopen`; the CommonJS free variable `module` as a value.
+//     `process.binding` / `process._linkedBinding` / `process.dlopen`, and the exec method `process.execve`
+//     (F-DG1-128: replaces the process with an arbitrary executable, the child_process/cluster class); the CommonJS
+//     free variable `module` as a value.
 //     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
 //     a named `{ dlopen }` import) is closed by the specifier check instead, which bans `process`/`node:process`.
 //  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
@@ -42,10 +45,16 @@
 //      e.g. with `node:fs`, then `import("./local.mjs")`): the specifier is a legal own-module path and the bytes
 //      exist only at runtime, so the lint never sees them. `node:fs` is deliberately NOT banned (tests read files and
 //      a module may legitimately read files; a write-API-only ban would be brittle).
-//  (c) the loader/eval denylist is ENUMERATED (rule-1 primitives, rule-3 roots and loaders, LOADER_BUILTINS) and
-//      cannot be proven exhaustive over every host capability that could load or generate code at runtime (a future
-//      Node built-in, `WebAssembly` instantiation, ...). Known native loaders are closed as found (`process.dlopen`
-//      F-DG1-125, `node:sqlite` loadExtension F-DG1-127).
+//  (c) the loader/eval denylist is ENUMERATED (rule-1 primitives, rule-3 roots and loaders, LOADER_BUILTINS). For
+//      the PINNED Node version (22.x) the concrete loader/exec built-ins and `process.*` methods are now enumerated
+//      exhaustively, as validated by the round-7 code-security sweep of `builtinModules` + `process.*` (F-DG1-128):
+//      built-ins module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test; and
+//      process.binding, _linkedBinding, dlopen, execve (closed as found: `process.dlopen` F-DG1-125, `node:sqlite`
+//      loadExtension F-DG1-127, `node:test` run / `process.execve` F-DG1-128). Residual (c) is therefore narrowed to
+//      genuinely FUTURE/UNKNOWN built-ins or `process.*` methods of a later Node version, and `WebAssembly` /
+//      `node:wasi` instantiation (a wasm exec, not a JS-module loader). A later hardening could switch module-source
+//      `node:` imports to a default-deny allow-list (module source uses only node:crypto/fs/path/url); that is
+//      deferred (bigger blast radius, not P1).
 // Rationale: this is static defence-in-depth for the ADR-0002 module boundaries, enforced against human-reviewed code
 // that runs with a read-only production source tree; it is NOT a runtime security boundary.
 import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
@@ -68,6 +77,9 @@ const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/conf
  * `process.<loader>` check cannot see, so the import itself is the violation. The global `process` stays under rule 3.
  * F-DG1-127: `sqlite` too - `new DatabaseSync(p, { allowExtension: true }).loadExtension(so)` loads a native shared
  * object (the `process.dlopen` class); a module never needs SQLite (persistence is `@mth/db`/PostgreSQL, ADR-0003).
+ * F-DG1-128: `test` too - `run({ files: [<computed path>], isolation: "none" })` loads and runs a file named by a
+ * runtime-computed path in the SAME process (a computed import without code generation). No runtime module uses
+ * `node:test` (tests use vitest).
  */
 const LOADER_BUILTINS = new Set(
   [
@@ -81,6 +93,7 @@ const LOADER_BUILTINS = new Set(
     "cluster",
     "process",
     "sqlite",
+    "test",
   ].flatMap((b) => [b, `node:${b}`]),
 );
 /** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
@@ -102,8 +115,11 @@ const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
 ]);
 /** Global objects through which the runtime (and its loaders) can be reached. */
 const RUNTIME_ROOTS = new Set(["process", "globalThis", "global"]);
-/** Native-code loaders on `process` (rule 3). */
-const PROCESS_LOADERS = new Set(["binding", "_linkedBinding", "dlopen"]);
+/**
+ * Native-code loaders and the exec method on `process` (rule 3). F-DG1-128: `execve` replaces the process with an
+ * arbitrary executable (the class of the banned `child_process` / `cluster`).
+ */
+const PROCESS_LOADERS = new Set(["binding", "_linkedBinding", "dlopen", "execve"]);
 /** Binary operators whose result is always a number/bigint, so the key can never spell a property name. */
 const NUMERIC_OPERATORS = new Set([
   ts.SyntaxKind.MinusToken,
```

## 4. Checks actually run

All commands ran from the repository root, on Node v22.22.2, offline.

### 4.1 `pnpm vitest run apps/api/src/architecture.test.ts`, BEFORE the fix

I added the R1/R2 rows first and left the testkit unchanged. Output excerpt:

```
   × the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R1 node:test in-process run is a violation (round-4 lint: 'missed') 7ms
     → R1 node:test in-process run: []: expected 0 to be greater than 0
   × the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R2 process.execve is a violation (round-4 lint: 'missed') 2ms
     → R2 process.execve: []: expected 0 to be greater than 0
⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯
 FAIL  |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R1 node:test in-process run is a violation (round-4 lint: 'missed')
AssertionError: R1 node:test in-process run: []: expected 0 to be greater than 0
 FAIL  |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R2 process.execve is a violation (round-4 lint: 'missed')
AssertionError: R2 process.execve: []: expected 0 to be greater than 0
 Test Files  1 failed (1)
      Tests  2 failed | 78 passed (80)
```

The exit status was not captured because output was piped through `tee`. Vitest reported 1 failed file and 2 failed tests. Both plants produced **0 violations** (`[]`), which reproduces F-DG1-128.

### 4.2 `pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose`, AFTER the fix

```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > has only mapped module directories, and every P1 module has a public index.ts 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > the six §16 business modules all exist, each with its own test suite (A12; D-048) 3ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 540ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > the declared module graph is acyclic, and audit/access depend on no business module 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > P12 process.binding is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X6 node:process default import .dlopen is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X7 node:process default import .binding is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X8 node:process named import dlopen is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > A1 node:sqlite loadExtension is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R1 node:test in-process run is a violation (round-4 lint: 'missed') 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > R2 process.execve is a violation (round-4 lint: 'missed') 1ms
      Tests  80 passed (80)
   Start at  13:23:24
   Duration  1.83s (transform 100ms, setup 0ms, collect 585ms, tests 959ms, environment 0ms, prepare 59ms)

```

Vitest reported **1 file passed and 80/80 tests passed**. A separate re-run without `tee` (`pnpm vitest run apps/api/src/architecture.test.ts`) exited with status **0**. The real module-tree check passes: "every import respects dependsOn, public surfaces and allowed packages" asserts that `moduleViolations` is `[]` for every module. So the new bans produce no false positives in the module source.

### 4.3 Module suites that reuse the lint (D-048)

Command: `pnpm vitest run apps/api/src/modules/reporting/reporting.test.ts apps/api/src/modules/workflows/workflows.test.ts apps/api/src/modules/kpi/kpi.test.ts`

```
 Test Files  3 passed (3)
      Tests  14 passed (14)
```

### 4.4 Typecheck, eslint, prettier

```
$ pnpm --filter @mth/api run typecheck
> @mth/api@0.1.0 typecheck /home/user/My-owns/apps/api
> tsc -p tsconfig.json
typecheck exit=0
$ pnpm exec eslint apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts
eslint exit=0
$ pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts
Checking formatting...
All matched files use Prettier code style!
prettier exit=0
```

### 4.5 `grep -rn "node:test\|process.execve" apps packages --exclude-dir=node_modules`

The only matches are in the two edited files: comments in the testkit, and comments plus the planted source strings of R1/R2 in the test. There are no matches in module or runtime source. A separate grep for a bare `from "test"` / `require("test")` returned no matches (exit 1), so banning bare `test` costs nothing in practice.

## 5. Known gaps / not done

- Per the assignment, I did not update `docs/delivery/decisions.md` (D-053). Its residual (c) wording still needs to be brought in line with the narrowed header text. That belongs to the orchestrator or decision owner, because this assignment's file scope excludes that file.
- The "exhaustive for pinned Node 22.x" claim relies on the round-7 reviewer's sweep (F-DG1-128 evidence). I did not repeat that sweep.
- I did not apply the default-deny `node:` allow-list. It is only noted in the header, as deferred.
- Closing F-DG1-128 needs a non-author reviewer verification. I do not close my own finding.

## 6. Merge instructions

- There are no migrations, API endpoints or dependency changes. These are test-only files: `*.testkit.ts` is excluded from the build.
- The change applies cleanly on `c36315b`. No conflicts are expected unless another round-8 task edits the same `it.each` table or the testkit header.
