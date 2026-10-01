# Handback T-DG1-BE16: F-DG1-136 + F-DG1-217 (backend-workflow-engineer)

- **Stage:** DG1, round-15 repair. **Base:** `HEAD` = `cc6fbe3e7a57677358732a759479360bea880acd` (verified with `git rev-parse HEAD` before editing).
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE16-backend-workflow-engineer-20261001T172702Z-24e706e9","session_id":"24e706e9-4d4e-4165-ab77-ca8eec56ce77"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-15/T-DG1-BE16.md` (sha256 `458ca717…cacbae`, verified).
- No migrations, no API endpoints added. No product or runtime code changed. I closed neither finding myself: closure needs a non-author reviewer verification.

## 1. Changed files

| File | Purpose |
|---|---|
| `vitest.config.ts` | F-DG1-136: the integration project now has `hookTimeout: 30_000` (same as `testTimeout`), with a comment citing F-DG1-136. |
| `apps/api/src/architecture.testkit.ts` | F-DG1-217: `syntaxErrors()` handles declaration files safely. `.d.ts`, `.d.mts` and `.d.cts` files get syntactic diagnostics without emit, so the lint no longer calls `transpileModule`, which crashed on these names. |
| `apps/api/src/architecture.test.ts` | F-DG1-217: two self-checks that pin the chosen behaviour (declaration files are scanned, not skipped). |

## 2. Behaviour delivered

### F-DG1-136 (REQ-S19-004)
- In the integration project, hooks now get 30 000 ms instead of vitest's default 10 000 ms.
- That covers the `afterAll` teardown in `access-derived-race.test.ts`: DDL, then `api.close()`, then `dropScratchDatabase()`, which has its own internal wait of up to 10 s.
- I left `dropScratchDatabase`'s internal budget unchanged and did not weaken the test.

### F-DG1-217 (REQ-S16-003): the preferred "scan safely" approach
- **New pattern:** `DECLARATION_FILE = /\.d\.[cm]?ts$/`.
- **For a declaration file**, `syntaxErrors()` now calls `declarationSyntaxErrors()`. That builds a one-file `ts.createProgram` using:
  - an in-memory `CompilerHost`;
  - `noLib: true`, `noResolve: true` and `types: []`, so nothing is type-checked, resolved, emitted or executed;
  - the public `program.getSyntacticDiagnostics(sf)`.
- I avoided the internal, untyped `SourceFile.parseDiagnostics` on purpose.
- **Every other file** still goes through the same `ts.transpileModule` path as before, so non-declaration behaviour is unchanged.
- **Result:**
  - `walk()` still collects `.d.ts` files.
  - `scanSource` still checks their imports against the boundary rules, including `import type` imports.
  - A real syntax error in one of them now surfaces as the named diagnostic `unparseable source: … (line N) bypasses the module-interface check` instead of an internal `Debug Failure`.

### Self-checks added (`architecture.test.ts`)
1. **`F-DG1-217: a module declaration file (.d.ts/.d.mts/.d.cts) is linted without throwing, imports still checked`**. For each of `zz.d.ts`, `zz.d.mts` and `zz.d.cts` under `modules/transformations/`:
   - `fileViolations("transformations", …, "export declare const x: number;")` does not throw and returns `[]`.
   - A deep cross-module **type** import (`import type { Actor } from "../access/policy.ts"`) is flagged exactly as `imports ../access/policy.ts; only access/index.ts is public`.
   - `export declare const x: = ;` does not throw. It yields `unparseable source: Type expected. (line 1) bypasses the module-interface check`, and the output never contains `Debug Failure`.
2. **`F-DG1-217: a planted .d.ts in a module directory is walked and linted end to end without throwing`**. A temp directory holds a `zz.d.ts`. `walk()` finds it, and running `fileViolations` over the walked files gives exactly the deep-import violation.

**Red-before-green check:** I temporarily restored `HEAD`'s `architecture.testkit.ts` and ran the suite. Both new tests failed with `Error: Debug Failure. Output generation failed`. I then put the fix back. Output excerpt:
```
× … F-DG1-217: a module declaration file (.d.ts/.d.mts/.d.cts) is linted without throwing, imports still checked
  → zz.d.ts: expected [Function] to not throw an error but 'Error: Debug Failure. Output generati…' was thrown
× … F-DG1-217: a planted .d.ts in a module directory is walked and linted end to end without throwing
  → Debug Failure. Output generation failed
```

**Standalone reproduction before the fix** (TypeScript 6.0.2):
- `ts.transpileModule(src, { fileName: "zz.d.ts" | "zz.d.mts" })` threw `Debug Failure. Output generation failed`, for both valid and broken source.
- The same sources parse fine with `createSourceFile`. The broken one gives `Type expected.` and `Expression expected.`.

## 3. Checks actually run (sandbox, offline, no `pnpm install`)

| Command | Environment | Result |
|---|---|---|
| `pnpm vitest run apps/api/src/architecture.test.ts` | Node v24.21.0 | exit 0. `Test Files 1 passed (1)`, `Tests 130 passed (130)`, including both new F-DG1-217 tests. The real-tree test `every import respects dependsOn…` passes, so `moduleViolations` does not throw for any module. |
| same, with `HEAD`'s testkit (red check) | Node v24.21.0 | 2 failed, as expected (output excerpt above). Fix restored afterwards. |
| `QA_PG_PORT=54917 tests/qa/support/with-pg.sh pnpm test:integration` | disposable PostgreSQL 16.13 cluster (created and deleted by the helper on a unique port), Node v24.21.0 | exit 0. `Test Files 19 passed (19)`, `Tests 200 passed (200)`. `access-derived-race.test.ts (4 tests) 613ms`. `grep -c "Hook timed out"` → `0`. |
| `pnpm -r typecheck` | Node v24.21.0 | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | Node v24.21.0 | exit 0 |
| `pnpm exec prettier --check vitest.config.ts apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` | Node v24.21.0 | exit 0. "All matched files use Prettier code style!" |
| `PATH=/opt/node22/bin:$PATH pnpm test` | Node v22.22.2 | exit 0. `Test Files 21 passed (21)`, `Tests 323 passed (323)`. `architecture.test.ts (130 tests)` ✓ |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | Node v24.21.0 | exit 0. `Test Files 21 passed (21)`, `Tests 323 passed (323)`. `architecture.test.ts (130 tests)` ✓ |

Integration output tail:
```
qa disposable cluster: PostgreSQL 16.13 (Ubuntu 16.13-0ubuntu0.24.04.1) on x86_64-pc-linux-gnu, compiled by gcc (Ubuntu 13.3.0-6ubuntu2~24.04.1) 13.3.0, 64-bit
 ✓ |integration| apps/api/test/integration/access-derived-race.test.ts (4 tests) 613ms
 …
 Test Files  19 passed (19)
      Tests  200 passed (200)
   Duration  23.98s
```

## 4. Known gaps / not done
- **F-DG1-136 is not proven under load.** The teardown was not under contention in this run (613 ms for the whole file). So this run shows there is no regression and no hook timeout, but it does not reproduce the slow-runner case from round 14. The fix gives the hook a 30 s budget, compared with the helper's internal wait of at most 10 s.
- **Node 22 for `pnpm test`:** the environment's default `node` is v24.21.0, so I ran the Node 22 check with `/opt/node22/bin` (v22.22.2) prepended to `PATH`. Typecheck, lint, prettier and the integration run used Node 24.
- Only syntactic checks run for declaration files. Ambient-context grammar errors that need the checker (for example an initializer in a `declare`) are not reported. This matches the rest of rule 4, which is syntax-only by design.

## 5. Merge instructions
- No migrations, no new dependencies, no ordering constraints.
- The change touches only the three files above. The working tree's untracked dotfiles (`.bashrc` and similar) were already there and are not mine.

## Exact diff
```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index a72bc64..3411209 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -791,6 +791,44 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(fileViolations("kpi", at("zz.test.ts"), vitestImport)).toEqual([]);
   });
 
+  it("F-DG1-217: a module declaration file (.d.ts/.d.mts/.d.cts) is linted without throwing, imports still checked", () => {
+    const at = (name: string) => join(MODULES_DIR, "transformations", name);
+    // Before the fix syntaxErrors() ran ts.transpileModule on a declaration-file name and it threw
+    // "Debug Failure. Output generation failed", so moduleViolations() errored instead of reporting.
+    for (const name of ["zz.d.ts", "zz.d.mts", "zz.d.cts"]) {
+      expect(() => fileViolations("transformations", at(name), "export declare const x: number;"), name).not.toThrow();
+      expect(fileViolations("transformations", at(name), "export declare const x: number;"), name).toEqual([]);
+      // Chosen behaviour: declaration files are scanned (not skipped), so a deep cross-module TYPE import is flagged.
+      const deepType = `import type { Actor } from "../access/policy.ts";\nexport declare const a: Actor;`;
+      expect(fileViolations("transformations", at(name), deepType), name).toEqual([
+        `modules/transformations/${name}: imports ../access/policy.ts; only access/index.ts is public`,
+      ]);
+      // A genuine syntax error surfaces as a named diagnostic, never as an internal compiler assertion.
+      const broken = "export declare const x: = ;";
+      expect(() => fileViolations("transformations", at(name), broken), name).not.toThrow();
+      const v = fileViolations("transformations", at(name), broken).join("\n");
+      expect(v, name).toMatch(/unparseable source: Type expected\. \(line 1\) bypasses the module-interface check/);
+      expect(v, name).not.toMatch(/Debug Failure/);
+    }
+  });
+
+  it("F-DG1-217: a planted .d.ts in a module directory is walked and linted end to end without throwing", () => {
+    const dir = mkdtempSync(join(tmpdir(), "mth-dts-"));
+    try {
+      writeFileSync(join(dir, "zz.d.ts"), `import type { Actor } from "../access/policy.ts";\nexport type A = Actor;`);
+      const files = walk(dir);
+      expect(files.map((f) => basename(f))).toEqual(["zz.d.ts"]);
+      const v = files.flatMap((f) =>
+        fileViolations("transformations", join(MODULES_DIR, "transformations", basename(f)), readFileSync(f, "utf8")),
+      );
+      expect(v).toEqual([
+        "modules/transformations/zz.d.ts: imports ../access/policy.ts; only access/index.ts is public",
+      ]);
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
   it("scanSource reports what it saw (paths resolve relative to the planted file)", () => {
     const rel = relative(MODULES_DIR, resolve(join(MODULES_DIR, "transformations"), "../access/policy.ts"));
     expect(rel.split("/")).toEqual(["access", "policy.ts"]);
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 8da47b9..a9a04d5 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -441,17 +441,47 @@ export function scanSource(fileName: string, source: string): ScanResult {
   return { specifiers, evasions: [...new Set(evasions)] };
 }
 
+/** A declaration file (.d.ts/.d.mts/.d.cts): TypeScript parses it with isDeclarationFile = true. */
+const DECLARATION_FILE = /\.d\.[cm]?ts$/;
+
+/**
+ * F-DG1-217: `ts.transpileModule` emits, and emitting a declaration-file name throws an internal
+ * `Debug Failure. Output generation failed` - so a module `.d.ts` crashed the lint instead of being checked. For a
+ * declaration file, take the syntactic diagnostics WITHOUT emit through the public API: a one-file program (no lib, no
+ * resolution, nothing type-checked or executed) and `getSyntacticDiagnostics`. The file is still scanned by
+ * `scanSource` (its type imports stay boundary-checked), and a real syntax error still surfaces as a named
+ * `unparseable source` diagnostic.
+ */
+function declarationSyntaxErrors(fileName: string, source: string): readonly ts.Diagnostic[] {
+  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
+  const options: ts.CompilerOptions = { noLib: true, noResolve: true, types: [] };
+  const host: ts.CompilerHost = {
+    getSourceFile: (name) => (name === fileName ? sf : undefined),
+    getDefaultLibFileName: () => "lib.d.ts",
+    writeFile: () => {},
+    getCurrentDirectory: () => dirname(fileName),
+    getCanonicalFileName: (name) => name,
+    useCaseSensitiveFileNames: () => true,
+    getNewLine: () => "\n",
+    fileExists: (name) => name === fileName,
+    readFile: (name) => (name === fileName ? source : undefined),
+  };
+  return ts.createProgram([fileName], options, host).getSyntacticDiagnostics(sf);
+}
+
 /**
  * Rule 4, fail closed: syntax errors in a module file. On a syntax error the parser's recovery can turn code into
  * something else (`(async () => {} as any)[k]` reads `[k]` as a binding pattern), so the rules would inspect a
  * different program from the one written. Syntactic diagnostics only (no type check, nothing executed).
  */
 function syntaxErrors(fileName: string, source: string): string[] {
-  const { diagnostics = [] } = ts.transpileModule(source, {
-    fileName,
-    reportDiagnostics: true,
-    compilerOptions: { jsx: ts.JsxEmit.Preserve },
-  });
+  const diagnostics = DECLARATION_FILE.test(fileName)
+    ? declarationSyntaxErrors(fileName, source)
+    : (ts.transpileModule(source, {
+        fileName,
+        reportDiagnostics: true,
+        compilerOptions: { jsx: ts.JsxEmit.Preserve },
+      }).diagnostics ?? []);
   return diagnostics
     .filter((d) => d.category === ts.DiagnosticCategory.Error)
     .map((d) => {
diff --git a/vitest.config.ts b/vitest.config.ts
index fff1f10..b2b0530 100644
--- a/vitest.config.ts
+++ b/vitest.config.ts
@@ -47,6 +47,9 @@ export default defineConfig({
           poolOptions: { forks: { singleFork: true } },
           fileParallelism: false,
           testTimeout: 30_000,
+          // F-DG1-136: hooks get the same budget as tests. A teardown afterAll (DDL + api.close() + dropScratchDatabase(),
+          // which itself waits up to 10s for other backends to disconnect) must not hit vitest's default 10_000 ms hookTimeout.
+          hookTimeout: 30_000,
         },
       },
     ],
```
