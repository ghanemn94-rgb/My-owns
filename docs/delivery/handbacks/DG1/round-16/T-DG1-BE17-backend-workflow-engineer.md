# Handback T-DG1-BE17: F-DG1-137 + F-DG1-218 (backend-workflow-engineer)

- **Stage:** DG1, round-16 repair.
- **Base:** `HEAD` = `873f48e783b74db4544224b1819651e5fac909be`. The only commit on top of `dc1e847` is the one that adds this assignment.
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE17-backend-workflow-engineer-20261001T175821Z-9d9b2060","session_id":"9d9b2060-d40c-4c13-a9e8-6b585344e29a"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-16/T-DG1-BE17.md`. I verified sha256 `ff05931976b38ad259044756406b75a72bc5942368f18f14b92763c330f67600`.
- **Scope:**
  - No migrations and no API endpoints added.
  - No product, runtime or config code changed. Only the two permitted test-only files were edited.
  - Nothing committed. I closed neither finding: closure needs a non-author reviewer verification.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | F-DG1-137/218: the declaration-file branch in `syntaxErrors()` now uses TypeScript's own classification, through a new exported `isDeclarationFileName()`. It no longer uses the hand-rolled `DECLARATION_FILE` regex, which is removed (grep shows 0 references left in `apps/` and `packages/`). Comments cite both findings. |
| `apps/api/src/architecture.test.ts` | Two new self-checks for the arbitrary-extension forms `*.d.<ext>.ts`. They also pin the classification. `ts` is imported as `import ts from "typescript"`, the same way the testkit imports it. |

Final file hashes:
- `architecture.test.ts`: `5984fa1e74e366063b0cf929baf61ae6755fe1f9e58cf30243c86b2ca578d6e4`
- `architecture.testkit.ts`: `ed593735c73b16184d0ba820c25f1be62213bbe0bd4ca5e59f95de420e0ab13c`

## 2. Behaviour delivered (REQ-S16-003; F-DG1-137, F-DG1-218)

### Deviation from the preferred fix: I could not call `ts.isDeclarationFileName` directly

The assignment asked me to explain any concrete reason for not using `ts.isDeclarationFileName`. Here it is.

- **It does not typecheck.** In TypeScript 6.0.2 the function exists at runtime but is `@internal`, so it is absent from `typescript.d.ts`. My first version called `ts.isDeclarationFileName(fileName)` exactly as specified, and `pnpm -r typecheck` failed:
  ```
  apps/api typecheck: src/architecture.testkit.ts(481,26): error TS2339: Property 'isDeclarationFileName' does not exist on type 'typeof ts'.
  apps/api typecheck: src/architecture.test.ts(820,15): error TS2339: Property 'isDeclarationFileName' does not exist on type 'typeof ts'.
  ```
  The test pins the assignment prescribed, `expect(ts.isDeclarationFileName(...))`, fail typecheck in the same way.
- **Why I did not cast around it.** An `as unknown as {...}` cast to an internal symbol would make us depend on non-public API.
- **What I used instead.** I still did not fall back to the widened regex. The TS parser (`createSourceFile`, `typescript.js:33487`) sets the **public, typed** `SourceFile.isDeclarationFile` from `isDeclarationFileName(fileName)` and nothing else. So the new helper reads that same compiler classification through the public API:
  ```ts
  export function isDeclarationFileName(fileName: string): boolean {
    return ts.createSourceFile(fileName, "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).isDeclarationFile;
  }
  ```
  It parses an empty text: nothing is resolved, type-checked or executed. With no regex to maintain, it follows TypeScript whenever TypeScript changes.
- **Agreement check.** At runtime, `SourceFile.isDeclarationFile` and the internal `ts.isDeclarationFileName` agree on every name I probed:
  - `true` for `zz.d.ts`, `zz.d.mts`, `zz.d.cts`, `styles.d.css.ts`, `data.d.json.ts` and `x.d.ts.ts`;
  - `false` for `a.ts`, `a.d.tsx`, `a.tsx`, `a.mts` and `/abs/dir.d.x/a.ts`.

### Other parts of the fix

- `syntaxErrors()` now branches on `isDeclarationFileName(fileName)`. Every name the compiler treats as a declaration file goes to the existing `declarationSyntaxErrors()`, so none reaches `ts.transpileModule`.
- I left `declarationSyntaxErrors()` unchanged. It still uses `ScriptKind.TS`, which is correct for every declaration form because declaration files are never TSX.
- `CODE_FILE` and `walk()` are unchanged.

### New self-checks (`architecture.test.ts`)

1. **`F-DG1-137/F-DG1-218: an arbitrary-extension declaration file (*.d.<ext>.ts) is linted without throwing`**
   - **Classification pinned** two ways: by the public `ts.createSourceFile(name, "").isDeclarationFile` and by the testkit's `isDeclarationFileName`.
     - Expected `true`: `zz.d.ts`, `zz.d.mts`, `zz.d.cts`, `styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts`.
     - Expected `false`: `a.ts`, `a.mts`, `a.tsx`, `a.d.tsx`, `zz-planted.mts`, `dir.d.x/a.ts`.
   - **Lint behaviour.** For each of `styles.d.css.ts`, `data.d.json.ts` and `x.d.ts.ts` under `modules/transformations/`:
     - `fileViolations(..., "export declare const x: number;")` does not throw and returns `[]`.
     - `"export declare const x: = ;"` does not throw. It yields the **named** `modules/transformations/<name>: unparseable source: Type expected. (line 1)…` and never matches `/Debug Failure/`.
2. **`F-DG1-137/F-DG1-218: a planted styles.d.css.ts in a module directory is walked and linted end to end`**
   - A temp directory holds a broken `styles.d.css.ts`.
   - `walk()` collects it.
   - Running `fileViolations` over the walked files does not throw, gives the named `unparseable source: Type expected.` diagnostic, and never gives `Debug Failure`.
3. **Existing tests.** The existing F-DG1-217 tests (`.d.ts`/`.d.mts`/`.d.cts`, plus the planted `.d.ts`) are unchanged and still green.

### Red-before-green (negative controls, run and then reverted)

- **(a) `HEAD`'s testkit with the new tests:** 2 failed and 130 passed. Both failures were `expected [Function] to not throw an error but 'Error: Debug Failure. Output generati…' was thrown`.
- **(b) The fixed testkit with only the branch reverted to `/\.d\.[cm]?ts$/.test(fileName)`:** the same 2 tests failed (`Tests 2 failed | 130 passed (132)`).
- I restored the fix afterwards. `grep` confirms `const diagnostics = isDeclarationFileName(fileName)`.

## 3. Before/after probe (TypeScript 6.0.2; Node v24.21.0; throwaway files, deleted after use)

**Before** (`HEAD` testkit, via a throwaway vitest file calling `fileViolations`, plus a plain `node` probe):
```
ts 6.0.2
zz.d.ts isDeclarationFileName= true /\.d\.[cm]?ts$/= true transpileModule: THROWS: Debug Failure. Output generation failed
styles.d.css.ts isDeclarationFileName= true /\.d\.[cm]?ts$/= false transpileModule: THROWS: Debug Failure. Output generation failed
data.d.json.ts isDeclarationFileName= true /\.d\.[cm]?ts$/= false transpileModule: THROWS: Debug Failure. Output generation failed
x.d.ts.ts isDeclarationFileName= true /\.d\.[cm]?ts$/= false transpileModule: THROWS: Debug Failure. Output generation failed
a.ts isDeclarationFileName= false /\.d\.[cm]?ts$/= false transpileModule: ok

PROBE zz.d.ts "export declare const x: number;" -> []
PROBE zz.d.ts "export declare const x: = ;" -> ["modules/transformations/zz.d.ts: unparseable source: Type expected. (line 1) bypasses the module-interface check","modules/transformations/zz.d.ts: unparseable source: Expression expected. (line 1) bypasses the module-interface check"]
PROBE styles.d.css.ts "export declare const x: number;" -> THROWS: Debug Failure. Output generation failed
PROBE styles.d.css.ts "export declare const x: = ;" -> THROWS: Debug Failure. Output generation failed
PROBE data.d.json.ts "export declare const x: number;" -> THROWS: Debug Failure. Output generation failed
PROBE data.d.json.ts "export declare const x: = ;" -> THROWS: Debug Failure. Output generation failed
PROBE x.d.ts.ts "export declare const x: number;" -> THROWS: Debug Failure. Output generation failed
PROBE x.d.ts.ts "export declare const x: = ;" -> THROWS: Debug Failure. Output generation failed
```

**After** (fixed testkit). `ts.transpileModule` itself still throws on `styles.d.css.ts`, but the lint path no longer calls it:
```
PROBE transpileModule(styles.d.css.ts) -> THROWS: Debug Failure. Output generation failed
PROBE zz.d.ts "export declare const x: number;" -> []
PROBE zz.d.ts "export declare const x: = ;" -> ["modules/transformations/zz.d.ts: unparseable source: Type expected. (line 1) bypasses the module-interface check","modules/transformations/zz.d.ts: unparseable source: Expression expected. (line 1) bypasses the module-interface check"]
PROBE styles.d.css.ts "export declare const x: number;" -> []
PROBE styles.d.css.ts "export declare const x: = ;" -> ["modules/transformations/styles.d.css.ts: unparseable source: Type expected. (line 1) bypasses the module-interface check","modules/transformations/styles.d.css.ts: unparseable source: Expression expected. (line 1) bypasses the module-interface check"]
PROBE data.d.json.ts "export declare const x: number;" -> []
PROBE data.d.json.ts "export declare const x: = ;" -> ["modules/transformations/data.d.json.ts: unparseable source: Type expected. (line 1) bypasses the module-interface check","modules/transformations/data.d.json.ts: unparseable source: Expression expected. (line 1) bypasses the module-interface check"]
PROBE x.d.ts.ts "export declare const x: number;" -> []
PROBE x.d.ts.ts "export declare const x: = ;" -> ["modules/transformations/x.d.ts.ts: unparseable source: Type expected. (line 1) bypasses the module-interface check","modules/transformations/x.d.ts.ts: unparseable source: Expression expected. (line 1) bypasses the module-interface check"]
```

## 4. Checks actually run (sandbox, offline, no `pnpm install`), all on the final file state above

| Command | Environment | Result |
|---|---|---|
| `pnpm vitest run apps/api/src/architecture.test.ts` | Node v24.21.0 | exit 0. `Test Files 1 passed (1)`, `Tests 132 passed (132)`, which is 130 + 2 new. The real-tree test `every import respects dependsOn…` passes, so `moduleViolations` does not throw for any module file. |
| `pnpm -r typecheck` | Node v24.21.0 | exit 0. `apps/worker typecheck: Done`, `apps/api typecheck: Done`. (The first attempt with `ts.isDeclarationFileName` failed with TS2339; see §2.) |
| `pnpm lint` (`eslint . --max-warnings=0`) | Node v24.21.0 | exit 0 |
| `pnpm exec prettier --check apps/api/src/architecture.test.ts apps/api/src/architecture.testkit.ts` | Node v24.21.0 | exit 0. `All matched files use Prettier code style!` |
| `PATH=/opt/node22/bin:$PATH pnpm test` | Node v22.22.2 (`pnpm exec node --version`) | exit 0. `Test Files 21 passed (21)`, `Tests 325 passed (325)` |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | Node v24.21.0 | exit 0. `Test Files 21 passed (21)`, `Tests 325 passed (325)` |

Integration and database tests were not run. The assignment says they are not needed because both edits are test-only.

## 5. Known gaps / not done

- **Assignment deviation.** I did not call `ts.isDeclarationFileName` directly because it is not in TypeScript's public typings (TS2339). I used the public `SourceFile.isDeclarationFile`, which the compiler computes with that same function. The pinning test asserts on that public property and on the testkit helper instead of `ts.isDeclarationFileName`. The orchestrator or reviewers should confirm they accept this.
- **No other gaps.** Both findings stay open until a non-author reviewer verifies them.

## 6. Merge instructions

- Test-only change to two files. No migrations, no ordering constraints and no expected conflicts.
- Not committed: the orchestrator integrates it.

## 7. Exact diff (`git diff apps/api/src/` against `HEAD` 873f48e)

```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index 3411209..0905a5b 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -32,11 +32,13 @@ import {
 } from "node:fs";
 import { tmpdir } from "node:os";
 import { basename, join, relative, resolve } from "node:path";
+import ts from "typescript";
 import { describe, expect, it } from "vitest";
 import {
   bareAllowed,
   fileViolations,
   importsOf,
+  isDeclarationFileName,
   MODULES_DIR,
   moduleViolations,
   scanSource,
@@ -812,6 +814,57 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     }
   });
 
+  it("F-DG1-137/F-DG1-218: an arbitrary-extension declaration file (*.d.<ext>.ts) is linted without throwing", () => {
+    // The declaration-file branch follows TypeScript's own classification, not a hand-rolled regex. Pin it, so a
+    // refactor that drops it (or a TS release that changes it) is caught here. ts.isDeclarationFileName is
+    // @internal (not in the public typings); the public SourceFile.isDeclarationFile carries its result.
+    const tsSays = (name: string) => ts.createSourceFile(name, "", ts.ScriptTarget.Latest).isDeclarationFile;
+    for (const name of ["zz.d.ts", "zz.d.mts", "zz.d.cts", "styles.d.css.ts", "data.d.json.ts", "x.d.ts.ts"]) {
+      expect(tsSays(name), name).toBe(true);
+      expect(isDeclarationFileName(name), name).toBe(true);
+    }
+    for (const name of ["a.ts", "a.mts", "a.tsx", "a.d.tsx", "zz-planted.mts", "dir.d.x/a.ts"]) {
+      expect(tsSays(name), name).toBe(false);
+      expect(isDeclarationFileName(name), name).toBe(false);
+    }
+    const at = (name: string) => join(MODULES_DIR, "transformations", name);
+    // Before the fix these failed the /\.d\.[cm]?ts$/ guard, reached ts.transpileModule and threw
+    // "Debug Failure. Output generation failed" with no file name in the message.
+    for (const name of ["styles.d.css.ts", "data.d.json.ts", "x.d.ts.ts"]) {
+      const ok = "export declare const x: number;";
+      expect(() => fileViolations("transformations", at(name), ok), name).not.toThrow();
+      expect(fileViolations("transformations", at(name), ok), name).toEqual([]);
+      const broken = "export declare const x: = ;";
+      expect(() => fileViolations("transformations", at(name), broken), name).not.toThrow();
+      const v = fileViolations("transformations", at(name), broken).join("\n");
+      expect(v, name).toMatch(
+        new RegExp(
+          `modules/transformations/${name.replace(/\./g, "\\.")}: unparseable source: Type expected\\. \\(line 1\\)`,
+        ),
+      );
+      expect(v, name).not.toMatch(/Debug Failure/);
+    }
+  });
+
+  it("F-DG1-137/F-DG1-218: a planted styles.d.css.ts in a module directory is walked and linted end to end", () => {
+    const dir = mkdtempSync(join(tmpdir(), "mth-dxts-"));
+    try {
+      writeFileSync(join(dir, "styles.d.css.ts"), "export declare const x: = ;");
+      const files = walk(dir);
+      expect(files.map((f) => basename(f))).toEqual(["styles.d.css.ts"]);
+      const run = () =>
+        files.flatMap((f) =>
+          fileViolations("transformations", join(MODULES_DIR, "transformations", basename(f)), readFileSync(f, "utf8")),
+        );
+      expect(run).not.toThrow();
+      const v = run().join("\n");
+      expect(v).toMatch(/modules\/transformations\/styles\.d\.css\.ts: unparseable source: Type expected\./);
+      expect(v).not.toMatch(/Debug Failure/);
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
   it("F-DG1-217: a planted .d.ts in a module directory is walked and linted end to end without throwing", () => {
     const dir = mkdtempSync(join(tmpdir(), "mth-dts-"));
     try {
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index a9a04d5..d64ef60 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -441,16 +441,27 @@ export function scanSource(fileName: string, source: string): ScanResult {
   return { specifiers, evasions: [...new Set(evasions)] };
 }
 
-/** A declaration file (.d.ts/.d.mts/.d.cts): TypeScript parses it with isDeclarationFile = true. */
-const DECLARATION_FILE = /\.d\.[cm]?ts$/;
+/**
+ * F-DG1-137 / F-DG1-218: is `fileName` a declaration file, by TypeScript's OWN classification (no hand-rolled regex
+ * to keep in sync): `.d.ts`/`.d.mts`/`.d.cts` AND the `allowArbitraryExtensions` form `<name>.d.<ext>.ts`
+ * (`styles.d.css.ts`, `data.d.json.ts`, `x.d.ts.ts`). `ts.isDeclarationFileName` is the function the compiler uses,
+ * but it is `@internal` (absent from the public typings, so `tsc` rejects it); the parser assigns its result to the
+ * PUBLIC `SourceFile.isDeclarationFile` from the file name alone, so read it from an empty parse (no text, nothing
+ * resolved or executed).
+ */
+export function isDeclarationFileName(fileName: string): boolean {
+  return ts.createSourceFile(fileName, "", ts.ScriptTarget.Latest, false, ts.ScriptKind.TS).isDeclarationFile;
+}
 
 /**
  * F-DG1-217: `ts.transpileModule` emits, and emitting a declaration-file name throws an internal
- * `Debug Failure. Output generation failed` - so a module `.d.ts` crashed the lint instead of being checked. For a
- * declaration file, take the syntactic diagnostics WITHOUT emit through the public API: a one-file program (no lib, no
- * resolution, nothing type-checked or executed) and `getSyntacticDiagnostics`. The file is still scanned by
- * `scanSource` (its type imports stay boundary-checked), and a real syntax error still surfaces as a named
- * `unparseable source` diagnostic.
+ * `Debug Failure. Output generation failed` - so a module `.d.ts` crashed the lint instead of being checked.
+ * F-DG1-137 / F-DG1-218: every name TypeScript classifies as a declaration file (`isDeclarationFileName` above,
+ * incl. `*.d.<ext>.ts`) comes here, never to `transpileModule`. For a declaration file (any form - never TSX, so
+ * `ScriptKind.TS` is right for all of them), take the syntactic diagnostics WITHOUT emit through the public API: a
+ * one-file program (no lib, no resolution, nothing type-checked or executed) and `getSyntacticDiagnostics`. The file
+ * is still scanned by `scanSource` (its type imports stay boundary-checked), and a real syntax error still surfaces as
+ * a named `unparseable source` diagnostic.
  */
 function declarationSyntaxErrors(fileName: string, source: string): readonly ts.Diagnostic[] {
   const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
@@ -473,9 +484,12 @@ function declarationSyntaxErrors(fileName: string, source: string): readonly ts.
  * Rule 4, fail closed: syntax errors in a module file. On a syntax error the parser's recovery can turn code into
  * something else (`(async () => {} as any)[k]` reads `[k]` as a binding pattern), so the rules would inspect a
  * different program from the one written. Syntactic diagnostics only (no type check, nothing executed).
+ * F-DG1-137 / F-DG1-218: the declaration-file branch follows TypeScript's own classification
+ * (`isDeclarationFileName`, i.e. `SourceFile.isDeclarationFile`; incl. `allowArbitraryExtensions` `*.d.<ext>.ts`),
+ * so no declaration-file name ever reaches `ts.transpileModule`.
  */
 function syntaxErrors(fileName: string, source: string): string[] {
-  const diagnostics = DECLARATION_FILE.test(fileName)
+  const diagnostics = isDeclarationFileName(fileName)
     ? declarationSyntaxErrors(fileName, source)
     : (ts.transpileModule(source, {
         fileName,
```
