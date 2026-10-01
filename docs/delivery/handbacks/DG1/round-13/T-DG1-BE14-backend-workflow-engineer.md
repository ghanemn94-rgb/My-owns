# Handback T-DG1-BE14 — F-DG1-134: module-lint file scope (backend-workflow-engineer)

- **Stage:** DG1, round-13 repair. **Finding:** F-DG1-134 (Low, non-mandatory, REQ-S16-003).
- **Assignment:** `docs/delivery/assignments/DG1/round-13/T-DG1-BE14.md` (sha256 `b8f81b9f…01575c8`, verified before starting).
- **Base:** `HEAD` = `e16768c`. The changes are uncommitted in the working tree; the orchestrator integrates them.
- **invocation_reference:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-BE14-backend-workflow-engineer-20261001T162159Z-62d22436","session_id":"62d22436-a244-40ba-bd3e-e7a7e497ab78"}`
- I authored this fix, so I must not verify or close F-DG1-134. Status for the orchestrator: fix ready, pending verification by a non-author.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | `walk()` now collects every buildable JS/TS file (`/\.[cm]?[jt]sx?$/`). `isTest` recognises `*.test.<any of those extensions>`. `scanSource` parses `.tsx`/`.jsx` as TSX and every other extension as TS. Header: new FILE SCOPE paragraph. |
| `apps/api/src/architecture.test.ts` | 5 new F-DG1-134 self-check cases (below). The `node:fs`/`node:os`/`node:path` test imports are extended. |
| `docs/delivery/handbacks/DG1/round-13/T-DG1-BE14-backend-workflow-engineer.md` | This handback. |

No migrations, no API endpoints and no runtime code changed. The testkit is test-only and excluded from the build.

## 2. Behaviour delivered (REQ-S16-003 / F-DG1-134)

- **Broaden and scan, as the assignment prefers.** `walk()` matches `.ts .tsx .mts .cts .js .jsx .mjs .cjs`. `moduleViolations` therefore applies rules 1–5 plus the boundary and package checks to all of them. A `.mts`/`.cts`/`.mjs`/`.cjs`/`.js`/`.jsx` module file no longer evades the lint. I found no concrete reason the broaden-and-scan approach breaks: the TS parser handles JS, and the real tree has no such files.
- **`isTest`** is `/\.test\.[cm]?[jt]sx?$/`, so a `kpi.test.mts` gets the same vitest and testkit allowance as `kpi.test.ts`. A non-test file of any extension does not get it (tested).
- **Additional, within the permitted files: ScriptKind by extension.** Broadening the scan to `.jsx` exposed a parse problem that already existed for `.tsx`. `scanSource` always parsed with `ScriptKind.TS`, but `syntaxErrors` (rule 4, `ts.transpileModule`) infers JSX from the file name. A JSX file therefore got a mis-parsed AST that rule 4 did not flag. Concrete miss reproduced at base: in a `.tsx` module file, `export const X = () => <div>a'b {require("node:vm")}</div>;` gave **0 violations**. The TS parse reads the apostrophe in the JSX text as the start of a string literal, which swallows the `require`. `scanSource` now uses TSX for `.tsx`/`.jsx` and TS for everything else, so `.ts` behaviour is unchanged. The same source now gives `imports non-allow-listed node built-in node:vm`. I included this because a broadened scan that mis-parses the newly scanned `.jsx` would only half-close the file-scope hole. **Reviewers may treat it as a separate item.** It doesn't change the real tree (no `.tsx` under `apps/api/src`).
- **Effect on the real tree:** none. `find apps/api/src/modules -type f ! -name '*.ts' ! -name '*.tsx'` is empty. `moduleViolations` over all module dirs is still `[]`. The package-direction tests also call `walk()` (packages/*/src, apps/web/src, apps/worker/src). Those trees contain no `.[cm]?[jt]sx?` files other than `.ts`/`.tsx` either (checked with `find … -regex '.*\.[cm]?[jt]sx?$' ! -name '*.ts' ! -name '*.tsx'`, empty), and those suites stay green.

### New self-check cases (`architecture.test.ts`, in "the checker itself catches planted violations")
1. `walk() collects every buildable JS/TS file (.[cm]?[jt]sx?), incl. nested ones, and no other file`: a temp dir (`mkdtempSync(tmpdir())`, removed in `finally`) with `nested/zz-planted.<8 exts>` plus `README.md`, `data.json`, `schema.sql`, `x.tsbuildinfo`, `y.mts.map`. `walk` returns exactly the 8 code files.
2. `a planted non-.ts module file (zz-planted.mts etc.) is linted like a .ts one, end to end`: walk(temp dir) → `fileViolations("transformations", MODULES_DIR/transformations/<name>, source)`, which is the same pipeline as `moduleViolations` without writing into the real tree. Every one of the 8 files is seen and flagged with both the rule-5 `node:crypto` namespace violation and the deep `../access/policy.ts` import violation.
3. `zz-planted.mts via fileViolations yields the rule-5 and deep-import violations`: exactly 2 violations, the case the assignment requested.
4. `JSX in a .tsx/.jsx module file is parsed as JSX…`: the swallowed `require("node:vm")` case is flagged, and a JSX file with a deep import gives exactly that one violation.
5. `*.test.<ext> is a test for every extension…`: `kpi.test.<ext>` importing vitest and the testkit gives `[]`. `kpi.<ext>` gives `imports package vitest` plus `composition root`.

## 3. Exact diff

```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index af2d269..78cce18 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -20,8 +20,18 @@
 //  5. the declared module graph has a cycle, or audit/access depend on a business module;
 //  6. the package dependency direction is broken (db -> config, shared; config -> shared; shared -> none;
 //     apps/web never imports @mth/db or @mth/config).
-import { existsSync, readdirSync, statSync } from "node:fs";
-import { join, relative, resolve } from "node:path";
+import {
+  existsSync,
+  mkdirSync,
+  mkdtempSync,
+  readdirSync,
+  readFileSync,
+  rmSync,
+  statSync,
+  writeFileSync,
+} from "node:fs";
+import { tmpdir } from "node:os";
+import { basename, join, relative, resolve } from "node:path";
 import { describe, expect, it } from "vitest";
 import {
   bareAllowed,
@@ -677,6 +687,89 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     );
   });
 
+  // F-DG1-134: walk() used to collect only /\.(ts|tsx)$/, so a module file named .mts/.cts/.mjs/.cjs/.js/.jsx evaded
+  // every rule and the boundary check (a .mts file typechecks and ships in dist as .mjs). Now every buildable JS/TS
+  // module file is scanned.
+  const CODE_EXTS = ["ts", "tsx", "mts", "cts", "js", "jsx", "mjs", "cjs"] as const;
+  const EVASIVE = [
+    `import * as c from "node:crypto";`,
+    `import { authorize } from "../access/policy.ts";`,
+    `export const f = new Map(Object.entries(c)).get("set".concat("Engine")) as unknown;`,
+    `export const g = typeof authorize;`,
+  ].join("\n");
+
+  it("F-DG1-134: walk() collects every buildable JS/TS file (.[cm]?[jt]sx?), incl. nested ones, and no other file", () => {
+    const dir = mkdtempSync(join(tmpdir(), "mth-walk-"));
+    try {
+      mkdirSync(join(dir, "nested"));
+      for (const ext of CODE_EXTS) writeFileSync(join(dir, "nested", `zz-planted.${ext}`), EVASIVE);
+      for (const other of ["README.md", "data.json", "schema.sql", "x.tsbuildinfo", "y.mts.map"])
+        writeFileSync(join(dir, other), "");
+      expect(
+        walk(dir)
+          .map((f) => relative(dir, f))
+          .sort(),
+      ).toEqual(CODE_EXTS.map((ext) => join("nested", `zz-planted.${ext}`)).sort());
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
+  it("F-DG1-134: a planted non-.ts module file (zz-planted.mts etc.) is linted like a .ts one, end to end", () => {
+    // moduleViolations = walk(module dir) -> fileViolations(each file); a temp dir stands in for the module directory
+    // so nothing is written into the real tree. Before the fix this list was [] for every extension except ts/tsx.
+    const dir = mkdtempSync(join(tmpdir(), "mth-walk-"));
+    try {
+      for (const ext of CODE_EXTS) writeFileSync(join(dir, `zz-planted.${ext}`), EVASIVE);
+      const seen = walk(dir).map((f) => ({
+        name: basename(f),
+        v: fileViolations(
+          "transformations",
+          join(MODULES_DIR, "transformations", basename(f)),
+          readFileSync(f, "utf8"),
+        ),
+      }));
+      expect(seen.map((s) => s.name).sort()).toEqual(CODE_EXTS.map((ext) => `zz-planted.${ext}`).sort());
+      for (const { name, v } of seen) {
+        expect(v.join("\n"), name).toMatch(/imports the node:crypto namespace\/default binding/);
+        expect(v.join("\n"), name).toMatch(/only access\/index\.ts is public/);
+      }
+    } finally {
+      rmSync(dir, { recursive: true, force: true });
+    }
+  });
+
+  it("F-DG1-134: zz-planted.mts via fileViolations yields the rule-5 and deep-import violations", () => {
+    const v = fileViolations("transformations", join(MODULES_DIR, "transformations", "zz-planted.mts"), EVASIVE);
+    expect(v).toHaveLength(2);
+    expect(v.join("\n")).toMatch(/imports the node:crypto namespace\/default binding/);
+    expect(v.join("\n")).toMatch(/only access\/index\.ts is public/);
+  });
+
+  it("F-DG1-134: JSX in a .tsx/.jsx module file is parsed as JSX, so its imports are still seen and not mis-parsed", () => {
+    const jsx = `import { authorize } from "../access/policy.ts";\nexport const X = () => <div>{typeof authorize}</div>;`;
+    // Under a TS-kind parse the apostrophe in the JSX text opened a string literal that swallowed `require(...)`.
+    const swallowed = `export const X = () => <div>a'b {require("node:vm")}</div>;`;
+    for (const name of ["zz-planted.tsx", "zz-planted.jsx"]) {
+      expect(planted("transformations", swallowed, name).join("\n"), name).toMatch(
+        /imports non-allow-listed node built-in node:vm/,
+      );
+      expect(planted("transformations", jsx, name), name).toEqual([
+        `modules/transformations/${name}: imports ../access/policy.ts; only access/index.ts is public`,
+      ]);
+    }
+  });
+
+  it("F-DG1-134: *.test.<ext> is a test for every extension (vitest/testkit allowance), other files are not", () => {
+    const src = `import { describe } from "vitest";\nimport { moduleViolations } from "../../architecture.testkit.ts";`;
+    for (const ext of CODE_EXTS) {
+      expect(planted("kpi", src, `kpi.test.${ext}`), ext).toEqual([]);
+      expect(planted("kpi", src, `kpi.${ext}`).join("\n"), ext).toMatch(
+        /imports package vitest[\s\S]*composition root/,
+      );
+    }
+  });
+
   it("scanSource reports what it saw (paths resolve relative to the planted file)", () => {
     const rel = relative(MODULES_DIR, resolve(join(MODULES_DIR, "transformations"), "../access/policy.ts"));
     expect(rel.split("/")).toEqual(["access", "policy.ts"]);
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 3d1b427..315cb00 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -1,6 +1,10 @@
 // Module dependency-lint (ADR-0002), shared by architecture.test.ts and every module's own suite (D-048). Test-only:
 // excluded from the build (tsconfig.build.json `*.testkit.ts`) and never imported by runtime code.
 //
+// FILE SCOPE (F-DG1-134): walk() collects EVERY buildable JS/TS module file, `/\.[cm]?[jt]sx?$/` (.ts .tsx .mts .cts
+// .js .jsx .mjs .cjs), so no module code evades the lint by its extension (a `.mts` file typechecks and ships in dist as
+// `.mjs`). All of them get the same rules 1-5 and boundary checks; `.tsx`/`.jsx` are parsed as TSX, the rest as TS (a
+// superset of JS); `*.test.<ext>` is a test.
 // It walks the TypeScript AST of each file (F-DG1-109: `ts.preProcessFile` saw only literal specifiers) and reports:
 //  - every static import / export-from / `import x = require()` / type-only import specifier, and every
 //    `import("...")` / `require("...")` with a string-literal specifier - each checked against the module boundary;
@@ -164,11 +168,21 @@ const NUMERIC_OPERATORS = new Set([
 /** Composition-root files a module's OWN TEST may read: the declarative module map and this lint (D-048). */
 const TEST_SUPPORT_FILES = new Set(["modules.ts", "architecture.testkit.ts"]);
 
+/**
+ * F-DG1-134: every buildable JS/TS module file - .ts .tsx .mts .cts .js .jsx .mjs .cjs. Matching only .ts/.tsx let a
+ * `.mts` module file (typechecks under NodeNext + allowImportingTsExtensions, ships in dist as `.mjs`) evade every rule
+ * and the boundary check. `*.test.<ext>` of any of these is a test (TEST_FILE).
+ */
+const CODE_FILE = /\.[cm]?[jt]sx?$/;
+const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;
+/** JSX-capable files are parsed as TSX (a TS-kind parse of JSX text such as `a'b {require(x)}` swallows code). */
+const scriptKindOf = (fileName: string) => (/\.[jt]sx$/.test(fileName) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
+
 export function walk(dir: string): string[] {
   if (!existsSync(dir)) return [];
   return readdirSync(dir).flatMap((name) => {
     const p = join(dir, name);
-    return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(name) ? [p] : [];
+    return statSync(p).isDirectory() ? walk(p) : CODE_FILE.test(name) ? [p] : [];
   });
 }
 
@@ -290,7 +304,7 @@ function occurrence(node: ts.Identifier | ts.PrivateIdentifier | ts.StringLitera
 
 /** Parse `source` (as if it were `fileName`) and collect what it loads. */
 export function scanSource(fileName: string, source: string): ScanResult {
-  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
+  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, scriptKindOf(fileName));
   const specifiers: string[] = [];
   const evasions: string[] = [];
   const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
@@ -444,7 +458,7 @@ function syntaxErrors(fileName: string, source: string): string[] {
 export function fileViolations(mod: ApiModule, file: string, source: string): string[] {
   const violations: string[] = [];
   const where = relative(SRC, file);
-  const isTest = file.endsWith(".test.ts");
+  const isTest = TEST_FILE.test(file);
   const allowedDeps = new Set<string>(API_MODULES[mod].dependsOn);
   const { specifiers, evasions } = scanSource(file, source);
   for (const e of [...syntaxErrors(file, source), ...evasions])
```

## 4. Checks actually run

Environment: Linux sandbox, offline, existing `node_modules` (no `pnpm install`). Node 22 = `/opt/node22/bin/node` **v22.22.2**. Node 24 = `/opt/nvm/versions/node/v24.21.0/bin/node` **v24.21.0**. Note: the shell's default `node` was v24.21.0, so I put `/opt/node22/bin` first on PATH explicitly for every "Node 22" run.

### Before the fix (new tests added, testkit unchanged): Node 22, `pnpm vitest run apps/api/src/architecture.test.ts` → exit 1
```
   × … > F-DG1-134: walk() collects every buildable JS/TS file (.[cm]?[jt]sx?), incl. nested ones, and no other file
   × … > F-DG1-134: a planted non-.ts module file (zz-planted.mts etc.) is linted like a .ts one, end to end
   × … > F-DG1-134: *.test.<ext> is a test for every extension (vitest/testkit allowance), other files are not
AssertionError: expected [ 'nested/zz-planted.ts', …(1) ] to deeply equal [ 'nested/zz-planted.cjs', …(7) ]
AssertionError: expected [ 'zz-planted.ts', 'zz-planted.tsx' ] to deeply equal [ 'zz-planted.cjs', …(7) ]
-   "zz-planted.cjs",
-   "zz-planted.cts",
-   "zz-planted.js",
-   "zz-planted.jsx",
-   "zz-planted.mjs",
-   "zz-planted.mts",
    "zz-planted.ts",
    "zz-planted.tsx",
AssertionError: tsx: expected [ …(2) ] to deeply equal []        (isTest was .test.ts only)
      Tests  3 failed | 124 passed (127)
```
In other words, before the fix `walk()` skipped `zz-planted.mts` (and the other 5 extensions), so `moduleViolations` saw nothing for them. After the fix, every one of them is flagged (case 2).

Before the ScriptKind sub-fix (`scanSource` temporarily reverted to `ts.ScriptKind.TS` and then restored; Node 22, `-t "JSX in a"`) → exit 1:
```
   × … > F-DG1-134: JSX in a .tsx/.jsx module file is parsed as JSX, so its imports are still seen and not mis-parsed
AssertionError: zz-planted.tsx: expected '' to match /imports non-allow-listed node built-i…/
      Tests  1 failed | 126 skipped (127)
```

### After: `pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose`
Node 22 (v22.22.2) → exit 0:
```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 580ms
 ✓ … > F-DG1-134: walk() collects every buildable JS/TS file (.[cm]?[jt]sx?), incl. nested ones, and no other file 4ms
 ✓ … > F-DG1-134: a planted non-.ts module file (zz-planted.mts etc.) is linted like a .ts one, end to end 23ms
 ✓ … > F-DG1-134: zz-planted.mts via fileViolations yields the rule-5 and deep-import violations 2ms
 ✓ … > F-DG1-134: JSX in a .tsx/.jsx module file is parsed as JSX, so its imports are still seen and not mis-parsed 8ms
 ✓ … > F-DG1-134: *.test.<ext> is a test for every extension (vitest/testkit allowance), other files are not 29ms
      Tests  127 passed (127)
```
Node 24 (v24.21.0) → exit 0:
```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 557ms
 ✓ … > F-DG1-134: walk() collects every buildable JS/TS file (.[cm]?[jt]sx?), incl. nested ones, and no other file 2ms
 ✓ … > F-DG1-134: a planted non-.ts module file (zz-planted.mts etc.) is linted like a .ts one, end to end 25ms
 ✓ … > F-DG1-134: zz-planted.mts via fileViolations yields the rule-5 and deep-import violations 3ms
 ✓ … > F-DG1-134: JSX in a .tsx/.jsx module file is parsed as JSX, so its imports are still seen and not mis-parsed 9ms
 ✓ … > F-DG1-134: *.test.<ext> is a test for every extension (vitest/testkit allowance), other files are not 24ms
      Tests  127 passed (127)
```
(The suite went from 122 cases (round 12, per F-DG1-134 reproduction) to 127 = 122 + 5 new F-DG1-134 cases.)

### Other checks (Node 22 unless stated)
| Command | Result |
|---|---|
| `pnpm -r typecheck` | exit 0 (`packages/db … Done`, `apps/api typecheck: Done`, `apps/worker typecheck: Done`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0, no output |
| `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` | exit 0, "All matched files use Prettier code style!" |
| `pnpm test` (Node v22.22.2) | exit 0: `Test Files  21 passed (21)` / `Tests  320 passed (320)` |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` (v24.21.0) | exit 0: `Test Files  21 passed (21)` / `Tests  320 passed (320)` |
| `find apps/api/src/modules -type f ! -name '*.ts' ! -name '*.tsx'` | empty output, exit 0: there are no non-ts/tsx module files in the real tree |

## 5. Known gaps / notes
- The temp-dir tests write under `os.tmpdir()` (honours `$TMPDIR`) and always clean up. Nothing is written into `src/modules`.
- `.d.ts`/`.d.mts`/`.d.cts` declaration files were already matched by `.ts` and are now also matched by `.mts`/`.cts`. They get linted like any other file, which is conservative. None exist under `src/modules`.
- Not included: other loadable extensions such as `.json` (an import of `./x.json` is still checked as a specifier by the importer) and `.node`/`.wasm` (binary). Plain `.json` files and binaries are not scannable code, so they are out of scope for this lint. A `.node` addon is reachable only through `require`/`process.dlopen`, which rules 1 and 3 already ban.
- **Not my change:** `docs/delivery/findings.json` was modified in the working tree at 16:22:41Z during this run. The change is the F-DG1-216 entry going to `FIXED_PENDING_VERIFICATION`, presumably by the orchestrator. I didn't touch it.
- The ScriptKind sub-fix (section 2) goes beyond the strict wording "change the extension test", but it's within the two permitted files. Reviewers can judge it separately.

## 6. Merge instructions
None special. No migrations, no dependency changes, and only the two test-only files change. Apply the diff above on `e16768c`; no conflicts expected.
