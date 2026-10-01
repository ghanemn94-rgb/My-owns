# Handback T-DG1-BE12: F-DG1-132 / F-DG1-215, documenting the namespace-enumeration residual (backend-workflow-engineer)

- **Stage:** DG1 (P1), round-11 repair. **Assignment:** `docs/delivery/assignments/DG1/round-11/T-DG1-BE12.md` (sha256 `b1867387…0df21`, verified).
- **Invocation:** run `DG1-T-DG1-BE12-backend-workflow-engineer-20261001T150629Z-d565c13c`, session `d565c13c-e7f2-40ad-a0e2-e9d312df0251`.
- **Base:** `HEAD` = `2a88cf90957b73895685f86c5ab2c95b5f0f30d1`. Worked offline with no `pnpm install`. Nothing committed; the orchestrator integrates.
- **Requirement:** REQ-S16-003. **Findings addressed:** F-DG1-132 and F-DG1-215 (the same route, Low, non-mandatory). Only the orchestrator or a reviewer can close them; this handback doesn't claim they're closed.
- No migrations and no API endpoints: this change touches test-only files and documentation.

## 1. Changed files

| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Comments only (no lint-logic change). Corrects the "every form" overclaims to "every SPELLED form" (rule 1 header, member-audit paragraph, `SAFE_NODE_BUILTINS` and `BANNED_PRIMITIVES` doc comments). Broadens residual (a) to cover runtime enumeration of an allow-listed built-in's namespace or default binding, naming `crypto.setEngine` explicitly. |
| `apps/api/src/architecture.test.ts` | Corrects the "rule 1, every form" overclaims (file header and the S1–S3 block comment). Adds the `it.each` self-check E1–E4, which pins the enumeration forms at **0 violations**, as the documented accepted residual (a). |
| `docs/delivery/handbacks/DG1/round-11/T-DG1-BE12-backend-workflow-engineer.md` | This handback. |

## 2. Behaviour delivered (REQ-S16-003)

1. **Overclaims corrected.** Rule 1 is now documented as catching every *spelled* form of a banned name: identifier, `.member`, `["literal"]`, destructured key, string literal, unicode escape, import/export name, and namespace `ns.setEngine`. The comments say outright that a name reached only by runtime enumeration of an allow-listed namespace isn't statically visible. These are the places where "every form" was claimed for `setEngine` or rule 1:
   - testkit rule 1 header;
   - the member-audit sentence (formerly testkit:51);
   - the `SAFE_NODE_BUILTINS` JSDoc;
   - the `BANNED_PRIMITIVES` JSDoc;
   - test file header item 3 (formerly test:15);
   - the S1–S3 block comment (formerly test:393).
2. **Residual (a) broadened.** I used the assignment's wording and added two concrete examples. Residual (a) is now runtime **data flow** the static lint can't follow. It covers any value, including the namespace or default binding of an allow-listed built-in such as `node:crypto`, that is:
   - passed to third-party or built-in readers (`Object.entries`, `Object.values`, `Map`, `Array.prototype.find`, a regex over keys, or a schema library);
   - and indexed by a key built or carried at runtime, rather than written as a banned name or a directly flagged `x[k]`.

   The text also says that `crypto.setEngine` is additionally name-banned for every spelled form, and that reaching it by enumeration is this residual. It ends with "Rules 1-2 remove every SPELLED route inside module source, not every runtime route", plus why a blanket ban isn't viable: legitimate uses of `new Map(Object.entries(x)).get(name)` in `identity/routes.ts` and `access/rules.ts`. Residuals (b) code-generation + import and (c) WebAssembly are unchanged.
3. **Self-check pinned.** New `it.each` in `the checker itself catches planted violations`, titled `F-DG1-132/215 residual (a): %s is NOT flagged (accepted static-lint residual)`. It asserts `planted("transformations", source)` equals `[]` for:
   - **E1:** `Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine")`
   - **E2:** `new Map(Object.entries(c)).get("set".concat("Engine"))`
   - **E3:** `Object.entries(c).find(([k]) => /^setEng/.test(k))![1]`
   - **E4:** `for (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) f(p)` (default import)

   A comment above it says this is the deliberate, accepted residual (a), **not** a violation case. If a future lint closes the route, the forms should move into the violation table. The S1–S3 spelled-form bans and the `node:crypto` positive control are unchanged and still green. So is the real module-tree check (`every import respects dependsOn, …`, which calls `moduleViolations`).

**Rationale:** a static AST lint can't follow runtime key construction combined with property reads by third-party or built-in code. Forbidding every value use of a namespace, or every dynamic read, would break legitimate code and isn't a P1 goal. This remains static defence-in-depth for ADR-0002, not a runtime security boundary. The member audit isn't affected, since enumeration reaches an existing member and adds no new one.

## 3. Checks actually run

Environment: sandboxed shell in `/home/user/My-owns` (working tree on `2a88cf9` plus this change), Node `v24.21.0`, pnpm `10.33.0`, offline. All results below are from the final edited files.

| Command | Result |
|---|---|
| `pnpm vitest run apps/api/src/architecture.test.ts --reporter=verbose` | exit 0; 1 file, **109 passed** |
| `pnpm -r typecheck` | exit 0 (all packages `Done`) |
| `pnpm lint` (`eslint . --max-warnings=0`) | exit 0 |
| `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` | exit 0, "All matched files use Prettier code style!" |
| `pnpm test` | exit 0; **21 files, 302 tests passed** |

Vitest output (verbose, filtered to the relevant tests):

```
 ✓ |unit-node| apps/api/src/architecture.test.ts > API module boundaries (ADR-0002) > every import respects dependsOn, public surfaces and allowed packages 581ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > S1 crypto.setEngine (named import) is a violation (round-9 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > S2 crypto.setEngine (namespace import) is a violation (round-9 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > S3 crypto["setEngine"] (string key) is a violation (round-9 lint: 'missed') 1ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > F-DG1-132/215 residual (a): E1 Object.values(ns).find by fn.name is NOT flagged (accepted static-lint residual) 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > F-DG1-132/215 residual (a): E2 new Map(Object.entries(ns)).get(built key) is NOT flagged (accepted static-lint residual) 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > F-DG1-132/215 residual (a): E3 Object.entries(ns).find by regex over keys is NOT flagged (accepted static-lint residual) 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > F-DG1-132/215 residual (a): E4 for-of over Object.entries(default binding) is NOT flagged (accepted static-lint residual) 2ms
 ✓ |unit-node| apps/api/src/architecture.test.ts > the checker itself catches planted violations (self-check, incl. F-DG1-109, F-DG1-117, F-DG1-124) > F-DG1-130: only setEngine is banned - node:crypto and its other members stay allowed (positive control) 2ms
 Test Files  1 passed (1)
      Tests  109 passed (109)
```

Full suite tail:

```
 Test Files  21 passed (21)
      Tests  302 passed (302)
   Duration  8.84s (transform 1.58s, setup 0ms, collect 7.16s, tests 9.91s, environment 3.58s, prepare 1.61s)
```

## 4. Known gaps / not done

- **Nothing was run on Node 22.** No Node 22 binary is available in this sandbox. The change is comments plus a static-lint assertion that doesn't depend on the Node version, but the run evidence above is from Node 24.21.0 only.
- **The residual is documented, not closed (as the assignment requires).** `crypto.setEngine` stays reachable from module source by enumeration with 0 lint violations, and the E1–E4 self-check pins exactly that.
- I didn't re-run the runtime reproduction (native constructor via `.so`). It's out of scope, and the lint behaviour is what's pinned.
- **Other changes in the working tree are not mine.** Before and during this run, `docs/delivery/findings.json` (orchestrator status update for another finding), `docs/delivery/decisions.md`, `apps/web/**` (parallel run T-DG1-FE3) and several untracked dotfiles were modified or present. I didn't touch any of them.
- The new E1–E4 labels sit in the same `describe` as the older "E2 computed import() via variable" case. The new test titles carry a distinct `F-DG1-132/215 residual (a):` prefix, so they don't clash.

## 5. Merge instructions

No migrations, no dependencies, no runtime code change: `architecture.testkit.ts` is excluded from the build. Commit only the two source files and this handback, and don't include the unrelated working-tree changes listed above. No conflicts are expected unless another round-11 task edits the same comment blocks.

## Exact diff

```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index 3d65ef8..39d5d94 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -12,7 +12,8 @@
 //     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them); since
 //     D-055 (F-DG1-129/213), any member of the global process outside the allow-list (process.kill, _debugProcess,
 //     execve, binding, ...) - default-deny, independent of the Node version; since F-DG1-130, the native-loader
-//     member `setEngine` of the allow-listed node:crypto (rule 1, every form);
+//     member `setEngine` of the allow-listed node:crypto (rule 1, every SPELLED form; reaching it by runtime
+//     enumeration of the namespace is the accepted residual (a), pinned by a self-check, F-DG1-132/215);
 //  4. a module directory is not in the module map, a P1 module has no index.ts, or a §16 business module has no
 //     test suite of its own (A12, D-048);
 //  5. the declared module graph has a cycle, or audit/access depend on a business module;
@@ -391,8 +392,9 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
   it.each([
     // F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object (native loader) although `node:crypto`
     // itself is allow-listed (default-deny covers modules, not members). Rule 1 now bans the `setEngine` name in every
-    // form. "missed" here = 0 violations with the round-9 lint (HEAD 8ec95a6; handback T-DG1-BE11). Importing
-    // node:crypto stays allowed (D-055 positive control below).
+    // SPELLED form (enumeration without the name is residual (a), pinned below). "missed" here = 0 violations with
+    // the round-9 lint (HEAD 8ec95a6; handback T-DG1-BE11). Importing node:crypto stays allowed (D-055 positive
+    // control below).
     [
       "S1 crypto.setEngine (named import)",
       `import { setEngine } from "node:crypto";\nsetEngine("/tmp/x.so");`,
@@ -525,6 +527,34 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(planted("transformations", allowed)).toEqual([]);
   });
 
+  // F-DG1-132 / F-DG1-215 - ACCEPTED RESIDUAL (a), deliberately NOT a violation case. Rule 1 bans `setEngine` only
+  // where the name is SPELLED. These forms reach `crypto.setEngine` at runtime by ENUMERATING the allow-listed
+  // node:crypto namespace/default binding with a key built at runtime (Object.values/Object.entries/Map/find/regex);
+  // a static AST lint cannot follow that data flow, and banning namespace-as-value use or Object.entries/Map lookups
+  // would break legitimate module code. See residual (a) in the architecture.testkit.ts header. This test pins the
+  // current behaviour (0 violations) so the gap is visible and deliberate; if a future lint closes the route, move
+  // these forms into the violation table above.
+  it.each([
+    [
+      "E1 Object.values(ns).find by fn.name",
+      `import * as c from "node:crypto";\nconst f = Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine") as (p: string) => void;\nf("/tmp/x.so");`,
+    ],
+    [
+      "E2 new Map(Object.entries(ns)).get(built key)",
+      `import * as c from "node:crypto";\n(new Map(Object.entries(c)).get("set".concat("Engine")) as (p: string) => void)("/tmp/x.so");`,
+    ],
+    [
+      "E3 Object.entries(ns).find by regex over keys",
+      `import * as c from "node:crypto";\n(Object.entries(c).find(([k]) => /^setEng/.test(k))![1] as (p: string) => void)("/tmp/x.so");`,
+    ],
+    [
+      "E4 for-of over Object.entries(default binding)",
+      `import crypto from "node:crypto";\nconst p = "/tmp/x.so";\nfor (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) (f as (p: string) => void)(p);`,
+    ],
+  ])("F-DG1-132/215 residual (a): %s is NOT flagged (accepted static-lint residual)", (_case, source) => {
+    expect(planted("transformations", source)).toEqual([]);
+  });
+
   it("F-DG1-130: only setEngine is banned - node:crypto and its other members stay allowed (positive control)", () => {
     const allowed = [
       `import { randomUUID, createHash } from "node:crypto";`,
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 1109418..6cd11c9 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -16,8 +16,10 @@
 // and a constructed key (`f["constr" + "uctor"]`, `Reflect.get(fn, "constr".concat("uctor"))`) still got through.
 // P1 module code has no legitimate need to load or evaluate code at runtime, so instead of recognising patterns the
 // lint now forbids the building blocks themselves; every way to reach a primitive needs one of them:
-//  1. BANNED NAMES, in EVERY syntactic form outside type positions - identifier, `.member`, `["key"]`, string
-//     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name:
+//  1. BANNED NAMES, in every SPELLED form outside type positions - identifier, `.member`, `["key"]`, string
+//     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name, unicode
+//     escape, namespace member `ns.name` (F-DG1-132/215: a name that is never written - only reached by runtime
+//     enumeration of an allow-listed namespace - is NOT statically visible; that is residual (a) below):
 //     code evaluation  eval, Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, constructor
 //     module loaders   require, createRequire, getBuiltinModule, mainModule, _load
 //     native loader    setEngine (F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object, whose
@@ -48,7 +50,10 @@
 // MEMBER AUDIT (Node v22.22.2 / OpenSSL 3.5.5, every own property of node:{crypto, fs, fs/promises, os, path, url,
 // util} plus the namespaces fs.promises, path.posix/win32, util.types, crypto.webcrypto/subtle; handback
 // T-DG1-BE11): the ONLY member that loads, evaluates or executes code or loads a native object is
-// `crypto.setEngine`, which rule 1 now bans in every form. Name matches checked and cleared by hand:
+// `crypto.setEngine`, which rule 1 now bans in every SPELLED form (identifier, `.member`, `["literal"]`, destructured,
+// string literal, unicode escape, namespace `ns.setEngine`); reaching it by runtime ENUMERATION of the `node:crypto`
+// namespace/default binding, without writing the name, is residual (a) (F-DG1-132/215). Name matches checked and
+// cleared by hand:
 // `os.loadavg` (system-load averages, not a loader); `fs.open*`/`opendir`/`truncate` (file I/O); `util.debug`/
 // `debuglog`/`inspect` (logging/formatting, no debugger); `util.types.isModuleNamespaceObject`/`isNativeError`
 // (type predicates). `crypto.setFips(bool)` only toggles the OpenSSL FIPS provider named by the OpenSSL config, not a
@@ -56,9 +61,17 @@
 // file that is then `import()`ed is residual (b). A later Node version can add a loader MEMBER to an allowed module:
 // re-run the audit when the Node floor or target changes, and ban any such member here.
 // Residual limits (stated and ACCEPTED, not closable statically):
-//  (a) runtime DATA FLOW: a string computed at runtime and handed to third-party code that itself reads
-//      `input[key]` (e.g. a schema library given `Object.fromEntries([[k, ...]])`); rules 1-2 remove every syntactic
-//      route inside module source.
+//  (a) runtime DATA FLOW the static lint cannot follow (F-DG1-132/215): a value - including the namespace or default
+//      binding of an allow-listed built-in (e.g. `node:crypto`) - passed to third-party or built-in readers
+//      (`Object.entries`/`Object.values`/`Map`/`Array.prototype.find`/a regex over keys, a schema library given
+//      `Object.fromEntries([[k, ...]])`) and indexed by a key built or carried at runtime, rather than written as a
+//      banned name or a directly-flagged `x[k]` computed member. The one native-loader member among the allow-listed
+//      built-ins (`crypto.setEngine`) is additionally name-banned (rule 1, every spelled form); reaching it by
+//      enumeration, e.g. `new Map(Object.entries(c)).get("set".concat("Engine"))` or
+//      `Object.values(c).find((f) => f.name === "set" + "Engine")`, is this residual (pinned, not flagged, by the
+//      architecture.test.ts self-check). Rules 1-2 remove every SPELLED route inside module source, not every
+//      runtime route; banning all namespace-as-value use or all dynamic reads would break legitimate code
+//      (`new Map(Object.entries(x)).get(name)` in identity/routes.ts, access/rules.ts).
 //  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (an allowed
 //      built-in such as `node:fs` writes a file, then `import("./local.mjs")`): the specifier is a legal own-module
 //      path and the bytes exist only at runtime, so the lint never sees them. Irreducible for a static lint;
@@ -84,14 +97,15 @@ const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/conf
  * D-055 DEFAULT-DENY allow-list of `node:` built-ins (without the prefix) that module source may import. Seeded from
  * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. Per the
  * member audit in the header (F-DG1-130), they expose no member that loads, evaluates or executes code, opens a
- * debugger, or loads native objects EXCEPT `crypto.setEngine` (a native loader), which rule 1 bans; residuals (a)-(c)
+ * debugger, or loads native objects EXCEPT `crypto.setEngine` (a native loader), which rule 1 bans in every SPELLED
+ * form (reaching it by runtime enumeration of the namespace is residual (a)); residuals (a)-(c)
  * of the header still apply (`node:fs` code generation + import is (b)). NEVER add a code-loading, exec,
  * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
  * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
  * and are now denied by default. Network I/O belongs to the composition root, not module source.
  */
 const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
-/** F-DG1-124: dynamic-code primitives, banned in every syntactic form (rule 1), by the kind of bypass they give. */
+/** F-DG1-124: dynamic-code primitives, banned in every SPELLED form (rule 1), by the kind of bypass they give. */
 const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
   ...["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "constructor"].map(
     (n) => [n, "code evaluation"] as const,
```
