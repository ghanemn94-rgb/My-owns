# Handback T-DG1-BE8: F-DG1-127 (backend-workflow-engineer)

- **Stage:** DG1, round-7 repair. **Task:** T-DG1-BE8. **Finding:** F-DG1-127 (Low, non-mandatory, REQ-S16-003).
- **Invocation:** run `DG1-T-DG1-BE8-backend-workflow-engineer-20261001T124849Z-690ad555`, session `690ad555-1ba2-4c9f-aae8-e54f57479933`.
- **Base:** `HEAD` = `108e997b5a3e91bbee042edec5e1e732cb492664`. Worked offline; `pnpm install` was not run. Node v22.22.2.
- No migrations, no API endpoints, and no module source or product runtime code changed. The two files edited are test-only: `*.testkit.ts` is excluded from the build.

## 1. Changed files
| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Adds `sqlite` to `LOADER_BUILTINS`, which bans both `sqlite` and `node:sqlite` (A1). Documents the accepted residuals of the static lint (A2 and the enumerated-denylist class), with the rationale. |
| `apps/api/src/architecture.test.ts` | Adds the A1 self-check row to the F-DG1-124 `it.each` table, with 4th column `"missed"`. Adds a comment saying A2 is the stated residual and is not a violation case. |

## 2. Behaviour delivered (REQ-S16-003 / F-DG1-127)
- **A1 is closed.** Any import of `sqlite` or `node:sqlite` in module source is now a specifier violation (`imports package node:sqlite`). `bareAllowed()` returns false for any `LOADER_BUILTINS` member before the generic `node:` allowance. This matches the `process.dlopen` closure from F-DG1-125. It costs nothing legitimate: persistence is `@mth/db`/PostgreSQL (ADR-0003), and no source file imports sqlite (see the grep below).
- **A2 is documented, not banned.** The testkit header's "Residual limit" note is now "Residual limits (stated and ACCEPTED, not closable statically)":
  - (a) the existing runtime-key data-flow residual;
  - (b) runtime code generation followed by a dynamic import of a literal same-module path. `node:fs` is deliberately not banned, with the reason given;
  - (c) the loader/eval denylist is enumerated (rule-1 primitives, rule-3 roots/loaders, `LOADER_BUILTINS`) and can't be proven exhaustive (a future Node built-in, `WebAssembly` instantiation, …).
  
  The note gives the rationale: the lint is static defence-in-depth for the ADR-0002 boundaries, run against human-reviewed code with a read-only production source tree. It is **not** a runtime security boundary.
- **Regression guards are unchanged and still pass:** P12 (global `process.binding`) and X6–X8 (F-DG1-125).
- No A2 "violation" case was added, as the assignment instructs.

## 3. Exact diff
```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index da23056..13e9b79 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -333,6 +333,15 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
       /imports package node:process/,
       "missed",
     ],
+    // F-DG1-127 A1: node:sqlite's loadExtension loads a native shared object (same class as process.dlopen), so
+    // `sqlite` / `node:sqlite` is in LOADER_BUILTINS. A2 (write a file with node:fs, then `import("./gen.mjs")`) is
+    // NOT a case here: it is the stated, accepted residual of this static lint (architecture.testkit.ts header).
+    [
+      "A1 node:sqlite loadExtension",
+      `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/tmp/x.so");`,
+      /imports package node:sqlite/,
+      "missed",
+    ],
     // Prior forms (F-DG1-117/121), still caught: regression guards for the blanket rules.
     ["P17 module.constructor", `const M = module.constructor;`, /module used as a value[\s\S]*\.constructor/, "caught"],
     [
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index d9592d5..b48e639 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -6,8 +6,9 @@
 //    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
 //  - a computed `import(expr)` / `require(expr)` (the target cannot be checked), and any import of the built-ins that
 //    hand out a loader or evaluate code (`module`, `vm`, `worker_threads`, `inspector`, `repl`, `child_process`,
-//    `cluster`, `process`; with or without `node:`). F-DG1-125: importing `process` / `node:process` is itself banned
-//    (an imported binding aliases the process object past rule 3; the global is a Node global, no module imports it).
+//    `cluster`, `process`, `sqlite`; with or without `node:`). F-DG1-125: importing `process` / `node:process` is
+//    itself banned (an imported binding aliases the process object past rule 3; the global is a Node global, no module
+//    imports it). F-DG1-127: `sqlite` / `node:sqlite` (`loadExtension` loads a native shared object).
 //
 // F-DG1-124 - BLANKET BAN of the dynamic-code-loading primitives in module source. F-DG1-117 and F-DG1-121 matched
 // ever more spellings of the same thing (`.constructor()`, aliased `.constructor`, destructured `constructor`, ...)
@@ -33,9 +34,20 @@
 //     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
 //     a named `{ dlopen }` import) is closed by the specifier check instead, which bans `process`/`node:process`.
 //  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
-// Nothing is executed. Residual limit (stated, not closable statically): a string computed at RUNTIME and handed to
-// third-party code that itself reads `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`) is
-// data flow the lint cannot follow; rules 1-2 remove every syntactic route inside module source.
+// Nothing is executed. Residual limits (stated and ACCEPTED, not closable statically):
+//  (a) a string computed at RUNTIME and handed to third-party code that itself reads `input[key]` (e.g. a schema
+//      library given `Object.fromEntries([[k, ...]])`) is data flow the lint cannot follow; rules 1-2 remove every
+//      syntactic route inside module source.
+//  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (write a file,
+//      e.g. with `node:fs`, then `import("./local.mjs")`): the specifier is a legal own-module path and the bytes
+//      exist only at runtime, so the lint never sees them. `node:fs` is deliberately NOT banned (tests read files and
+//      a module may legitimately read files; a write-API-only ban would be brittle).
+//  (c) the loader/eval denylist is ENUMERATED (rule-1 primitives, rule-3 roots and loaders, LOADER_BUILTINS) and
+//      cannot be proven exhaustive over every host capability that could load or generate code at runtime (a future
+//      Node built-in, `WebAssembly` instantiation, ...). Known native loaders are closed as found (`process.dlopen`
+//      F-DG1-125, `node:sqlite` loadExtension F-DG1-127).
+// Rationale: this is static defence-in-depth for the ADR-0002 module boundaries, enforced against human-reviewed code
+// that runs with a read-only production source tree; it is NOT a runtime security boundary.
 import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
 import { dirname, join, relative, resolve } from "node:path";
 import { fileURLToPath } from "node:url";
@@ -54,6 +66,8 @@ const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/conf
  * Built-ins that hand out an unchecked loader or evaluate code; a module never needs them. F-DG1-125: `process` too -
  * an imported process object (default, namespace or named `{ dlopen }`/`{ binding }`) is a local binding that rule 3's
  * `process.<loader>` check cannot see, so the import itself is the violation. The global `process` stays under rule 3.
+ * F-DG1-127: `sqlite` too - `new DatabaseSync(p, { allowExtension: true }).loadExtension(so)` loads a native shared
+ * object (the `process.dlopen` class); a module never needs SQLite (persistence is `@mth/db`/PostgreSQL, ADR-0003).
  */
 const LOADER_BUILTINS = new Set(
   [
@@ -66,6 +80,7 @@ const LOADER_BUILTINS = new Set(
     "child_process",
     "cluster",
     "process",
+    "sqlite",
   ].flatMap((b) => [b, `node:${b}`]),
 );
 /** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
```

## 4. Checks actually run (environment: this working tree, offline, Linux sandbox, Node v22.22.2)

### 4.1 A1 before the fix
The A1 row was added to the test table first, before the testkit change. Command: `pnpm vitest run apps/api/src/architecture.test.ts -t "A1"`. **Result: FAIL, as expected (0 violations).**
```
 FAIL  |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > A1 node:sqlite loadExtension is a violation (round-4 lint: 'missed')
AssertionError: A1 node:sqlite loadExtension: []: expected 0 to be greater than 0
 ❯ apps/api/src/architecture.test.ts:361:56
 Test Files  1 failed (1)
      Tests  1 failed | 1 passed | 76 skipped (78)
```

### 4.2 After the fix: the whole architecture suite
Command: `pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose`. **Result: exit 0, 78/78 passed.** This includes the real-module-tree check, which reports zero `moduleViolations`.
```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > the six §16 business modules all exist, each with its own test suite (A12; D-048) 5ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 562ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > P12 process.binding is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X6 node:process default import .dlopen is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X7 node:process default import .binding is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > X8 node:process named import dlopen is a violation (round-4 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > A1 node:sqlite loadExtension is a violation (round-4 lint: 'missed') 1ms
 Test Files  1 passed (1)
      Tests  78 passed (78)
```

### 4.3 Typecheck, lint and format
- `pnpm --filter @mth/api run typecheck` (runs `tsc -p tsconfig.json`): **exit 0**, no errors.
- `pnpm exec eslint apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts`: **exit 0**, no output.
- `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts`: **exit 0**, "All matched files use Prettier code style!"

### 4.4 No source imports sqlite
Command: `grep -rn "node:sqlite\|from \"sqlite\"" apps packages`. Every match is in the two lint files: comments in the testkit, plus the A1 planted source string and its regex in the test. No real import exists.
```
apps/api/src/architecture.testkit.ts:11://    imports it). F-DG1-127: `sqlite` / `node:sqlite` (`loadExtension` loads a native shared object).
apps/api/src/architecture.testkit.ts:48://      F-DG1-125, `node:sqlite` loadExtension F-DG1-127).
apps/api/src/architecture.test.ts:336:    // F-DG1-127 A1: node:sqlite's loadExtension loads a native shared object (same class as process.dlopen), so
apps/api/src/architecture.test.ts:337:    // `sqlite` / `node:sqlite` is in LOADER_BUILTINS. A2 (write a file with node:fs, then `import("./gen.mjs")`) is
apps/api/src/architecture.test.ts:340:      "A1 node:sqlite loadExtension",
apps/api/src/architecture.test.ts:341:      `import { DatabaseSync } from "node:sqlite";\nnew DatabaseSync(":memory:", { allowExtension: true }).loadExtension("/tmp/x.so");`,
apps/api/src/architecture.test.ts:342:      /imports package node:sqlite/,
```
The same grep with those two files filtered out (`| grep -v "apps/api/src/architecture\.test\(kit\)\?\.ts"`) exits 1, meaning no matches.

## 5. Known gaps / not done
- A2 and the general enumerated-denylist class remain open by design. They are documented as the **accepted** residual of a static lint, and they can't be closed syntactically. Closing F-DG1-127 as an accepted observation, if that is the outcome, needs the reviewer's and release-auditor's sidecars. This handback does not close it.
- Cosmetic: the `it.each` title template reads "(round-4 lint: $3)". For A1, "missed" means the lint at the base `108e997` missed it, which is shown in §4.1. I kept the existing title wording unchanged so the scope stays minimal.
- No database, migrations or endpoints are involved, so no PostgreSQL integration tests were relevant to this task.

## 6. Merge instructions
- No migrations to run and no ordering constraints. The change is confined to the two test-only files above, so no conflicts are expected unless another round-7 task edits the same `it.each` table or the testkit header.
