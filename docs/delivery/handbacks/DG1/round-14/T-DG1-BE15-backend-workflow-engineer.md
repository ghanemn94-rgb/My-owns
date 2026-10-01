# Handback T-DG1-BE15: F-DG1-135 (backend-workflow-engineer)

- **Stage:** DG1 (P1), round-14 repair. **Base:** `HEAD` = `fb1c151afe5227fffb20877b38533b1100cc8659` (verified before any edit).
- **Invocation:** `DG1-T-DG1-BE15-backend-workflow-engineer-20261001T165233Z-6cbaa757` (session `6cbaa757-931b-4b91-afa7-c88911da2cd8`).
- **Assignment:** `docs/delivery/assignments/DG1/round-14/T-DG1-BE15.md`. Its sha256 matched `85bc51f4…7328d1`.
- Ran offline. No `pnpm install`. No migrations and no API endpoints: this is a test-only lint change.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Narrows `TEST_FILE` to `/\.test\.tsx?$/`. Updates the header note and the `CODE_FILE` doc comment to describe the new test classification. |
| `apps/api/src/architecture.test.ts` | Replaces the pinned F-DG1-134 case that asserted `*.test.<any ext>` is a test. Adds an explicit `zz.test.mts` vs `zz.test.ts` case. |

No other files were edited apart from this handback.

## 2. Behaviour delivered (F-DG1-135, REQ-S16-003)

**Rationale.** The lint now treats a file as a test only if the build also treats it as one:

- `tsconfig.build.json` excludes only `*.test.ts`, `*.test.tsx` and `*.testkit.ts`.
- vitest collects only `apps/api/src/**/*.test.ts`.

A `*.test.mts`, `.test.cts`, `.test.js`, `.test.jsx`, `.test.mjs` or `.test.cjs` file is never run as a test and is compiled into `dist`. So it must not get the test-only exemptions, which are:

- importing the composition-root files `modules.ts` and `architecture.testkit.ts`;
- importing `vitest`.

**Result:**

- `TEST_FILE = /\.test\.tsx?$/`. Only `.test.ts` and `.test.tsx` get the test allowances.
- `CODE_FILE = /\.[cm]?[jt]sx?$/` and `walk()` are unchanged. Every buildable file is still scanned. A `*.test.mts` is now scanned as an ordinary module file and gets the full boundary rules.
- Real `.test.ts` module suites keep their exemptions. The real tree contains only `.test.ts` module test files (see the `find` below), so it behaves exactly as before. `moduleViolations` is still zero, and the real-tree boundary test passes.

### Exact diff

```diff
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -4,7 +4,11 @@
 // FILE SCOPE (F-DG1-134): walk() collects EVERY buildable JS/TS module file, `/\.[cm]?[jt]sx?$/` (.ts .tsx .mts .cts
 // .js .jsx .mjs .cjs), so no module code evades the lint by its extension (a `.mts` file typechecks and ships in dist as
 // `.mjs`). All of them get the same rules 1-5 and boundary checks; `.tsx`/`.jsx` are parsed as TSX, the rest as TS (a
-// superset of JS); `*.test.<ext>` is a test.
+// superset of JS).
+// TEST CLASSIFICATION (F-DG1-135): the test-only allowances (importing `modules.ts`/`architecture.testkit.ts`, and
+// `vitest`) apply ONLY to `*.test.ts`/`*.test.tsx` (TEST_FILE) - exactly the test extensions tsconfig.build.json
+// excludes. Any other test-looking file (`*.test.mts`, `*.test.js`, ...) is not run by vitest and ships in dist, so it
+// is a NON-test module file: still scanned by walk(), with the full boundary rules and no test exemption.
@@ -171,10 +175,12 @@ const TEST_SUPPORT_FILES = new Set(["modules.ts", "architecture.testkit.ts"]);
 /**
  * F-DG1-134: every buildable JS/TS module file - .ts .tsx .mts .cts .js .jsx .mjs .cjs. Matching only .ts/.tsx let a
  * `.mts` module file (typechecks under NodeNext + allowImportingTsExtensions, ships in dist as `.mjs`) evade every rule
- * and the boundary check. `*.test.<ext>` of any of these is a test (TEST_FILE).
+ * and the boundary check.
+ * F-DG1-135: only `*.test.ts`/`*.test.tsx` is a test (TEST_FILE) - the extensions tsconfig.build.json excludes. A
+ * `*.test.mts`/`.test.js`/... is never run as a test yet compiles into dist, so it gets the full boundary rules.
  */
 const CODE_FILE = /\.[cm]?[jt]sx?$/;
-const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
+const TEST_FILE = /\.test\.tsx?$/;

--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -760,16 +760,37 @@
-  it("F-DG1-134: *.test.<ext> is a test for every extension (vitest/testkit allowance), other files are not", () => {
+  it("F-DG1-135: only *.test.ts/*.test.tsx (build-excluded) get the test allowance; *.test.mts etc. get full rules", () => {
     const src = `import { describe } from "vitest";\nimport { moduleViolations } from "../../architecture.testkit.ts";`;
+    // .test.ts/.test.tsx are excluded from the build (tsconfig.build.json), so the vitest/testkit allowance applies.
+    for (const ext of ["ts", "tsx"]) expect(planted("kpi", src, `kpi.test.${ext}`), ext).toEqual([]);
+    // Every other test-looking extension is never run as a test and ships in dist: a plain module file.
+    for (const ext of CODE_EXTS.filter((e) => e !== "ts" && e !== "tsx")) {
+      expect(planted("kpi", src, `kpi.test.${ext}`).join("\n"), ext).toMatch(
+        /imports package vitest[\s\S]*composition root/,
+      );
+    }
     for (const ext of CODE_EXTS) {
-      expect(planted("kpi", src, `kpi.test.${ext}`), ext).toEqual([]);
       expect(planted("kpi", src, `kpi.${ext}`).join("\n"), ext).toMatch(
         /imports package vitest[\s\S]*composition root/,
       );
     }
   });

+  it("F-DG1-135: zz.test.mts importing ../../modules.ts or vitest is a violation; zz.test.ts doing so is allowed", () => {
+    const at = (name: string) => join(MODULES_DIR, "kpi", name);
+    const modulesImport = `import { API_MODULES } from "../../modules.ts";\nexport const n = API_MODULES;`;
+    const vitestImport = `import { it } from "vitest";\nexport const t = it;`;
+    expect(fileViolations("kpi", at("zz.test.mts"), modulesImport)).toEqual([
+      "modules/kpi/zz.test.mts: imports ../../modules.ts outside src/modules (composition root)",
+    ]);
+    expect(fileViolations("kpi", at("zz.test.mts"), vitestImport)).toEqual([
+      "modules/kpi/zz.test.mts: imports package vitest",
+    ]);
+    expect(fileViolations("kpi", at("zz.test.ts"), modulesImport)).toEqual([]);
+    expect(fileViolations("kpi", at("zz.test.ts"), vitestImport)).toEqual([]);
+  });
```

## 3. Checks actually run

All checks ran in the working tree at base `fb1c151` plus the two-file diff, offline. Node 22 = `/opt/node22/bin` (v22.22.2). Node 24 = `/opt/nvm/versions/node/v24.21.0/bin` (v24.21.0).

| Command | Node | Result |
|---|---|---|
| `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` | 24 | exit 0. "All matched files use Prettier code style!" |
| `pnpm vitest run apps/api/src/architecture.test.ts` | 24 | exit 0. 1 file, **128 passed (128)** |
| `pnpm vitest run apps/api/src/architecture.test.ts` | 22 | exit 0. 1 file, **128 passed (128)**. This includes the real-tree check "every import respects dependsOn, public surfaces and allowed packages". |
| `pnpm -r typecheck` | 22 | exit 0. shared, web, config, db, api and worker all reported "Done". |
| `pnpm lint` (`eslint . --max-warnings=0`) | 22 | exit 0. No output. |
| `pnpm test` | 22 | exit 0. **Test Files 21 passed (21), Tests 321 passed (321)** |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | 24 | exit 0. **Test Files 21 passed (21), Tests 321 passed (321)** |
| `find apps/api/src/modules -name '*.test.*' ! -name '*.test.ts'` | n/a | **empty output**, exit 0. There are 7 `*.test.ts` files under `apps/api/src/modules`. |

Output tail of `pnpm vitest run apps/api/src/architecture.test.ts` (Node 22):

```
 ✓ |unit-node| apps/api/src/architecture.test.ts (128 tests) 1100ms
   ✓ API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages  529ms
 Test Files  1 passed (1)
      Tests  128 passed (128)
```

Output tail of `pnpm test` (Node 22):

```
 Test Files  21 passed (21)
      Tests  321 passed (321)
   Start at  16:53:39
   Duration  9.17s
exit 0
```

Output tail of `pnpm test` (Node 24):

```
 Test Files  21 passed (21)
      Tests  321 passed (321)
   Start at  16:53:53
   Duration  8.44s
exit 0
```

The architecture suite went from 127 to 128 tests because of the one added case. The other pinned case was rewritten in place.

## 4. Known gaps / not done

- None for F-DG1-135.
- Nothing outside the two permitted files was changed.
- No review, gate or findings records were touched. Closing F-DG1-135 is for a non-author reviewer.

## 5. Merge instructions

- No migrations, no new endpoints and no dependency changes. Merge the two-file diff as is. No conflicts are expected.
