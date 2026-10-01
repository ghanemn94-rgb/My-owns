# Handback T-DG1-BE13: F-DG1-133 / F-DG1-132, node:crypto namespace-enumeration route closed (backend-workflow-engineer)

- **Stage:** DG1, round-12 repair. **Base:** `HEAD` b0d6b05afc9581c97a3efeaedd6ba96483a97525. The working tree had only pre-existing untracked dotfiles, which I did not touch.
- **Invocation:** run_id `DG1-T-DG1-BE13-backend-workflow-engineer-20261001T155010Z-c5156378`, session `c5156378-6f98-448e-abb0-38b3e8bd3914`.
- **Assignment:** `docs/delivery/assignments/DG1/round-12/T-DG1-BE13.md` (sha256 6f90a5c5…eb9d, verified).
- **Ran offline.** I did not run `pnpm install`. No migrations and no API endpoints were added: this task changes only a test-side lint.

## 1. Changed files
| File | Purpose |
|---|---|
| `apps/api/src/architecture.testkit.ts` | Adds **rule 5** (named imports only for `NAMESPACE_RESTRICTED_BUILTINS` = `crypto`, `node:crypto`) in `scanSource`/`collect`. Corrects the header, the residual (a) text and the SAFE_NODE_BUILTINS JSDoc. |
| `apps/api/src/architecture.test.ts` | Header line 3 now cites rule 5. The round-10/11 "E1–E4 NOT flagged" pin is replaced by a violation table: E1–E5 plus N1–N10, the binding forms on their own. Adds positive controls: named crypto imports, plain-object enumeration, and other built-ins' namespace imports. The S-table comment is updated. |

## 2. Behaviour delivered (REQ-S16-003; F-DG1-132, F-DG1-133)
- **Rule 5:** for `node:crypto` (and the bare `crypto`), each of these is now a violation with the message `imports the node:crypto namespace/default binding via <form>; only named imports are allowed (it carries a rule-1-banned member) (line N) bypasses the module-interface check`:
  - `import * as c`
  - `import c`
  - `import c, { x }`
  - `import { default as c }`
  - `export *`
  - `export * as c`
  - `export { default as c } from`
  - `import c = require(...)`
  - literal `import("node:crypto")`
  - literal `require("node:crypto")` (already rule 1; now also rule 5)
- **Two forms I added beyond the assignment list:** `import { default as c }` and `export { default … } from`. Each binds the module's default export, which for a built-in is the module object, so it is another enumeration route.
- **Still allowed:**
  - Named imports and renamed named imports (`import { randomBytes as rb }`, `export { randomUUID as uuid } from`).
  - Type-space `typeof import("node:crypto")`, which is erased at runtime.
  - Namespace/default imports of other allow-listed built-ins (`node:path`, `node:fs`), because they have no banned member.
- **Not changed:**
  - `import { setEngine }` and the other spelled forms are still rule-1 violations (S1–S3 still pass). S2 and S3 now also report rule 5.
  - Enumerating a **plain object** stays allowed (`new Map(Object.entries(request.cookies)).get(name)`, `new Map(Object.entries(PERMISSIONS))`). There is a new positive control for this.
- **Header corrections (F-DG1-133):**
  - The `node:crypto` enumeration route to `setEngine` is now stated as **CLOSED** by rule 5.
  - I removed the "not closable statically" wording and the `identity/routes.ts`/`access/rules.ts` "would break" citation.
  - Residual (a) is now runtime data flow over **plain objects / third-party readers** only. It notes that no allow-listed built-in namespace reaches it any more. It also says a future loader member found by the member audit means adding that built-in to `NAMESPACE_RESTRICTED_BUILTINS`.
  - Residuals (b) (node:fs code generation followed by an import) and (c) (WebAssembly) are kept.
- **Real module tree:** `moduleViolations` is zero for every module (the boundary test passed). All 5 module files that import `node:crypto` use named imports only (grep below).

## 3. Checks actually run
Commands were run from `/home/user/My-owns`, offline. Node 22 is `/opt/node22/bin` (v22.22.2) and Node 24 is `/opt/nvm/versions/node/v24.21.0/bin` (v24.21.0).

**Caution:** in this shell the default `node` on PATH is v24.21.0, so the Node 22 runs prepend `/opt/node22/bin`.

| Command | Node | Result |
|---|---|---|
| `pnpm vitest run apps/api/src/architecture.test.ts` | 22.22.2 | exit 0, **122/122** passed |
| `pnpm vitest run apps/api/src/architecture.test.ts` | 24.21.0 | exit 0, **122/122** passed |
| `pnpm -r typecheck` | 22 and 24 | exit 0 |
| `pnpm lint` (`eslint . --max-warnings=0`) | 22 and 24 | exit 0 |
| `pnpm exec prettier --check apps/api/src/architecture.testkit.ts apps/api/src/architecture.test.ts` | 24 | exit 0, "All matched files use Prettier code style!" |
| `pnpm test` | 22.22.2 | exit 0, 21 files, **315/315** passed |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | 24.21.0 | exit 0, 21 files, **315/315** passed |

**The total is 315, not the 302 the assignment expected.** The difference is the 13 new cases I added in architecture.test.ts (109 → 122 tests). The old E1–E4 pin and the old positive control (5 tests) became 15 table rows (E1–E5, N1–N10) plus 3 positive controls (18 tests). No existing test was removed except the replaced pin.

### vitest output tail, Node 22
```

 Test Files  1 passed (1)
      Tests  122 passed (122)
   Start at  15:53:00
   Duration  1.88s (transform 118ms, setup 0ms, collect 559ms, tests 1.06s, environment 0ms, prepare 57ms)


pnpm test:  Test Files  21 passed (21)
pnpm test:       Tests  315 passed (315)
```

### vitest output tail, Node 24
```

 Test Files  1 passed (1)
      Tests  122 passed (122)
   Start at  15:53:03
   Duration  1.90s (transform 94ms, setup 0ms, collect 444ms, tests 1.18s, environment 0ms, prepare 69ms)


pnpm test:  Test Files  21 passed (21)
pnpm test:       Tests  315 passed (315)
```

### grep (assignment command)
```
$ grep -rnE "import \* as|import [A-Za-z]+ from \"node:crypto\"|export \* from \"node:crypto\"|import\(\"node:crypto\"\)" apps/api/src/modules
apps/api/src/modules/identity/oidc.ts:7:import * as client from "openid-client";
apps/api/src/modules/reporting/reporting.test.ts:10:import * as mod from "./index.ts";
apps/api/src/modules/workflows/workflows.test.ts:10:import * as mod from "./index.ts";
apps/api/src/modules/kpi/kpi.test.ts:10:import * as mod from "./index.ts";
```
The `import \* as` alternative also matches namespace imports of other modules. None of those matches is `node:crypto`. A narrower grep lists every crypto import in module source:
```
$ grep -rnE "from \"(node:)?crypto\"|import\(\"(node:)?crypto\"\)|require\(\"(node:)?crypto\"\)" apps/api/src/modules
apps/api/src/modules/identity/sessions.ts:7:import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
apps/api/src/modules/identity/routes.ts:3:import { randomBytes } from "node:crypto";
apps/api/src/modules/identity/oidc.ts:4:import { randomBytes } from "node:crypto";
apps/api/src/modules/platform/cursor.ts:3:import { createHash } from "node:crypto";
apps/api/src/modules/platform/idempotency.ts:4:import { createHash } from "node:crypto";
```
All five are purely named. The filter for non-named forms returned nothing (grep exit 1).

## 4. Known gaps / not done
- Residuals (a) (plain-object/third-party data flow), (b) and (c) remain as documented. This is a static defence-in-depth lint, not a runtime boundary.
- Rule 5 is keyed to the member audit. A future Node version that adds a loader member to another allow-listed built-in needs that built-in added to `NAMESPACE_RESTRICTED_BUILTINS`, as the header says.
- I did not run `node tools/gates/validate.mjs`. It is not required by this assignment, and gate records are outside my scope.
- I do not close findings myself. F-DG1-132/133 need verification by a non-author reviewer.

## 5. Merge instructions
- No migrations and no dependency changes. Only the two files above changed; no other conflicts are expected.
- `findings.json` still records F-DG1-132 as ACCEPTED_OBSERVATION under the residual (a) framing. The orchestrator may want to note that the route is now closed by this change.

## Exact diff
```diff
diff --git a/apps/api/src/architecture.test.ts b/apps/api/src/architecture.test.ts
index 39d5d94..af2d269 100644
--- a/apps/api/src/architecture.test.ts
+++ b/apps/api/src/architecture.test.ts
@@ -12,8 +12,9 @@
 //     syntactic form, and any computed key that is not a literal (a constructed key can spell any of them); since
 //     D-055 (F-DG1-129/213), any member of the global process outside the allow-list (process.kill, _debugProcess,
 //     execve, binding, ...) - default-deny, independent of the Node version; since F-DG1-130, the native-loader
-//     member `setEngine` of the allow-listed node:crypto (rule 1, every SPELLED form; reaching it by runtime
-//     enumeration of the namespace is the accepted residual (a), pinned by a self-check, F-DG1-132/215);
+//     member `setEngine` of the allow-listed node:crypto (rule 1, every SPELLED form); and since F-DG1-132/133,
+//     any namespace/default binding of node:crypto (rule 5, named imports only), which closes the route of reaching
+//     setEngine by runtime enumeration of the namespace;
 //  4. a module directory is not in the module map, a P1 module has no index.ts, or a §16 business module has no
 //     test suite of its own (A12, D-048);
 //  5. the declared module graph has a cycle, or audit/access depend on a business module;
@@ -392,7 +393,7 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
   it.each([
     // F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object (native loader) although `node:crypto`
     // itself is allow-listed (default-deny covers modules, not members). Rule 1 now bans the `setEngine` name in every
-    // SPELLED form (enumeration without the name is residual (a), pinned below). "missed" here = 0 violations with
+    // SPELLED form (enumeration without the name is closed by rule 5, below). "missed" here = 0 violations with
     // the round-9 lint (HEAD 8ec95a6; handback T-DG1-BE11). Importing node:crypto stays allowed (D-055 positive
     // control below).
     [
@@ -527,39 +528,106 @@ describe("the checker itself catches planted violations (self-check, incl. F-DG1
     expect(planted("transformations", allowed)).toEqual([]);
   });
 
-  // F-DG1-132 / F-DG1-215 - ACCEPTED RESIDUAL (a), deliberately NOT a violation case. Rule 1 bans `setEngine` only
-  // where the name is SPELLED. These forms reach `crypto.setEngine` at runtime by ENUMERATING the allow-listed
-  // node:crypto namespace/default binding with a key built at runtime (Object.values/Object.entries/Map/find/regex);
-  // a static AST lint cannot follow that data flow, and banning namespace-as-value use or Object.entries/Map lookups
-  // would break legitimate module code. See residual (a) in the architecture.testkit.ts header. This test pins the
-  // current behaviour (0 violations) so the gap is visible and deliberate; if a future lint closes the route, move
-  // these forms into the violation table above.
+  // F-DG1-132 / F-DG1-133 - rule 5, NAMED IMPORTS ONLY for node:crypto. Rule 1 bans `setEngine` only where the name
+  // is SPELLED; the forms E1-E5 reached `crypto.setEngine` at runtime by ENUMERATING the node:crypto namespace/default
+  // binding with a key built at runtime. Each needs such a binding, so each is now a violation AT THE IMPORT. The
+  // fourth column is the round-11 lint's result ("missed" = 0 violations, pinned then as residual (a)).
   it.each([
     [
       "E1 Object.values(ns).find by fn.name",
       `import * as c from "node:crypto";\nconst f = Object.values(c).find((x) => typeof x === "function" && x.name === "set" + "Engine") as (p: string) => void;\nf("/tmp/x.so");`,
+      /node:crypto namespace\/default binding via import \* as/,
+      "missed",
     ],
     [
       "E2 new Map(Object.entries(ns)).get(built key)",
       `import * as c from "node:crypto";\n(new Map(Object.entries(c)).get("set".concat("Engine")) as (p: string) => void)("/tmp/x.so");`,
+      /node:crypto namespace\/default binding via import \* as/,
+      "missed",
     ],
     [
       "E3 Object.entries(ns).find by regex over keys",
       `import * as c from "node:crypto";\n(Object.entries(c).find(([k]) => /^setEng/.test(k))![1] as (p: string) => void)("/tmp/x.so");`,
+      /node:crypto namespace\/default binding via import \* as/,
+      "missed",
     ],
     [
       "E4 for-of over Object.entries(default binding)",
       `import crypto from "node:crypto";\nconst p = "/tmp/x.so";\nfor (const [k, f] of Object.entries(crypto)) if (k.startsWith("set") && k.endsWith("Engine")) (f as (p: string) => void)(p);`,
+      /node:crypto namespace\/default binding via a default import/,
+      "missed",
+    ],
+    [
+      "E5 dynamic import() then enumerate",
+      `const c = await import("node:crypto");\n(new Map(Object.entries(c)).get("set".concat("Engine")) as (p: string) => void)("/tmp/x.so");`,
+      /node:crypto namespace\/default binding via a dynamic import\(\)/,
+      "missed",
+    ],
+    // The binding forms on their own (no enumeration needed for the violation).
+    ["N1 namespace import", `import * as c from "node:crypto";`, /via import \* as/, "missed"],
+    ["N2 default import", `import c from "node:crypto";`, /via a default import/, "missed"],
+    [
+      "N3 default + named import",
+      `import c, { randomUUID } from "node:crypto";`,
+      /node:crypto namespace\/default binding via a default import/,
+      "missed",
+    ],
+    ["N4 named default import", `import { default as c } from "node:crypto";`, /via import \{ default \}/, "missed"],
+    [
+      "N5 export star",
+      `export * from "node:crypto";`,
+      /node:crypto namespace\/default binding via export \*/,
+      "missed",
+    ],
+    ["N6 export star as", `export * as c from "node:crypto";`, /via export \* as/, "missed"],
+    ["N7 re-export default", `export { default as c } from "node:crypto";`, /via export \{ default \}/, "missed"],
+    ["N8 import-equals require", `import c = require("node:crypto");`, /via import = require\(\)/, "missed"],
+    [
+      "N9 dynamic import() literal",
+      `const c = await import("node:crypto");`,
+      /node:crypto namespace\/default binding via a dynamic import\(\)/,
+      "missed",
     ],
-  ])("F-DG1-132/215 residual (a): %s is NOT flagged (accepted static-lint residual)", (_case, source) => {
-    expect(planted("transformations", source)).toEqual([]);
+    [
+      "N10 require() literal",
+      `const c = require("node:crypto");`,
+      /node:crypto namespace\/default binding via require\(\)/,
+      "caught",
+    ],
+  ])("F-DG1-132/133 rule 5: %s is a violation (round-11 lint: $3)", (_case, source, message, _before) => {
+    const v = planted("transformations", source);
+    expect(v.length, `${_case}: ${JSON.stringify(v)}`).toBeGreaterThan(0);
+    expect(v.join("\n")).toMatch(message);
   });
 
-  it("F-DG1-130: only setEngine is banned - node:crypto and its other members stay allowed (positive control)", () => {
+  it("F-DG1-130/132: named node:crypto imports and their members stay allowed (positive control)", () => {
     const allowed = [
       `import { randomUUID, createHash } from "node:crypto";`,
-      `import * as nodeCrypto from "node:crypto";`,
-      `export const id = randomUUID() + nodeCrypto.randomUUID() + createHash("sha256").update("x").digest("hex");`,
+      `import { type Hash, randomBytes as rb } from "node:crypto";`,
+      `export { randomUUID as uuid } from "node:crypto";`,
+      `type C = typeof import("node:crypto");`,
+      `export const id = randomUUID() + createHash("sha256").update("x").digest("hex") + rb(4).toString("hex");`,
+    ].join("\n");
+    expect(planted("transformations", allowed)).toEqual([]);
+  });
+
+  it("F-DG1-133: enumerating a PLAIN object stays allowed (identity/routes.ts, access/rules.ts idiom)", () => {
+    const allowed = [
+      `export function cookie(request: { cookies: Record<string, string> }, name: string) {`,
+      `  return new Map(Object.entries(request.cookies)).get(name);`,
+      `}`,
+      `const PERMISSIONS = { read: ["a"], write: ["b"] } as const;`,
+      `export const byName = new Map(Object.entries(PERMISSIONS));`,
+      `export const vals = Object.values(PERMISSIONS).flat();`,
+    ].join("\n");
+    expect(planted("transformations", allowed)).toEqual([]);
+  });
+
+  it("rule 5 applies only to node:crypto: namespace/default imports of other allow-listed built-ins stay allowed", () => {
+    const allowed = [
+      `import * as path from "node:path";`,
+      `import fs from "node:fs";`,
+      `export const j = path.join("a") + typeof fs;`,
     ].join("\n");
     expect(planted("transformations", allowed)).toEqual([]);
   });
diff --git a/apps/api/src/architecture.testkit.ts b/apps/api/src/architecture.testkit.ts
index 6cd11c9..3d1b427 100644
--- a/apps/api/src/architecture.testkit.ts
+++ b/apps/api/src/architecture.testkit.ts
@@ -18,8 +18,8 @@
 // lint now forbids the building blocks themselves; every way to reach a primitive needs one of them:
 //  1. BANNED NAMES, in every SPELLED form outside type positions - identifier, `.member`, `["key"]`, string
 //     literal anywhere (`Reflect.get(fn, "constructor")`), object/destructuring key, import/export name, unicode
-//     escape, namespace member `ns.name` (F-DG1-132/215: a name that is never written - only reached by runtime
-//     enumeration of an allow-listed namespace - is NOT statically visible; that is residual (a) below):
+//     escape, namespace member `ns.name` (a name that is never written is not statically visible; for the one
+//     banned MEMBER of an allow-listed built-in, `crypto.setEngine`, the enumeration route is closed by rule 5):
 //     code evaluation  eval, Function, AsyncFunction, GeneratorFunction, AsyncGeneratorFunction, constructor
 //     module loaders   require, createRequire, getBuiltinModule, mainModule, _load
 //     native loader    setEngine (F-DG1-130: `crypto.setEngine(path)` dlopen()s an arbitrary shared object, whose
@@ -42,6 +42,14 @@
 //     Rule 3 covers the GLOBAL `process`; an IMPORTED process object (`import p from "node:process"`, a namespace or
 //     a named `{ dlopen }` import) is closed by the specifier check instead (`node:process` is not allow-listed).
 //  4. FAIL CLOSED: a file with a syntax error is a violation (the AST the rules see would not be the code written).
+//  5. NAMED IMPORTS ONLY for an allow-listed built-in that carries a rule-1-banned member (NAMESPACE_RESTRICTED_BUILTINS,
+//     today only `node:crypto`, because of `setEngine`; F-DG1-132/133). Without a namespace or default binding the
+//     module object never becomes a value in module source, so it cannot be enumerated (`Object.entries(c)`,
+//     `Object.values(c).find(...)`, `new Map(Object.entries(c)).get(runtimeKey)`) to reach the banned member without
+//     spelling it. Flagged: `import * as c`, `import c` (also `import c, { x }`), `import { default as c }`,
+//     `export *` / `export * as c` / `export { default } from`, `import c = require(...)`, and a literal-specifier
+//     `import("node:crypto")` / `require("node:crypto")` (both yield the namespace). Named imports
+//     (`import { randomUUID, createHash } from "node:crypto"`) stay allowed; `import { setEngine }` is rule 1.
 // Both built-in checks are allow-lists, not enumerations of known-bad routes, so they do not depend on the Node
 // version the lint runs on (production targets Node 24, the supported floor is Node 22.18+): a new built-in or
 // `process` member is denied until someone deliberately reviews it and adds it here. Nothing is executed.
@@ -50,28 +58,27 @@
 // MEMBER AUDIT (Node v22.22.2 / OpenSSL 3.5.5, every own property of node:{crypto, fs, fs/promises, os, path, url,
 // util} plus the namespaces fs.promises, path.posix/win32, util.types, crypto.webcrypto/subtle; handback
 // T-DG1-BE11): the ONLY member that loads, evaluates or executes code or loads a native object is
-// `crypto.setEngine`, which rule 1 now bans in every SPELLED form (identifier, `.member`, `["literal"]`, destructured,
+// `crypto.setEngine`, which rule 1 bans in every SPELLED form (identifier, `.member`, `["literal"]`, destructured,
 // string literal, unicode escape, namespace `ns.setEngine`); reaching it by runtime ENUMERATION of the `node:crypto`
-// namespace/default binding, without writing the name, is residual (a) (F-DG1-132/215). Name matches checked and
-// cleared by hand:
+// namespace/default binding, without writing the name, is CLOSED by rule 5 (named imports only: no such binding can
+// exist in module source; F-DG1-132/133). Name matches checked and cleared by hand:
 // `os.loadavg` (system-load averages, not a loader); `fs.open*`/`opendir`/`truncate` (file I/O); `util.debug`/
 // `debuglog`/`inspect` (logging/formatting, no debugger); `util.types.isModuleNamespaceObject`/`isNativeError`
 // (type predicates). `crypto.setFips(bool)` only toggles the OpenSSL FIPS provider named by the OpenSSL config, not a
 // caller-supplied path. No member of fs/promises, os, path, url or util exposes a code loader; `node:fs` writing a
 // file that is then `import()`ed is residual (b). A later Node version can add a loader MEMBER to an allowed module:
 // re-run the audit when the Node floor or target changes, and ban any such member here.
-// Residual limits (stated and ACCEPTED, not closable statically):
-//  (a) runtime DATA FLOW the static lint cannot follow (F-DG1-132/215): a value - including the namespace or default
-//      binding of an allow-listed built-in (e.g. `node:crypto`) - passed to third-party or built-in readers
-//      (`Object.entries`/`Object.values`/`Map`/`Array.prototype.find`/a regex over keys, a schema library given
-//      `Object.fromEntries([[k, ...]])`) and indexed by a key built or carried at runtime, rather than written as a
-//      banned name or a directly-flagged `x[k]` computed member. The one native-loader member among the allow-listed
-//      built-ins (`crypto.setEngine`) is additionally name-banned (rule 1, every spelled form); reaching it by
-//      enumeration, e.g. `new Map(Object.entries(c)).get("set".concat("Engine"))` or
-//      `Object.values(c).find((f) => f.name === "set" + "Engine")`, is this residual (pinned, not flagged, by the
-//      architecture.test.ts self-check). Rules 1-2 remove every SPELLED route inside module source, not every
-//      runtime route; banning all namespace-as-value use or all dynamic reads would break legitimate code
-//      (`new Map(Object.entries(x)).get(name)` in identity/routes.ts, access/rules.ts).
+// Residual limits (stated and ACCEPTED by choice: this is a defence-in-depth lint over human-reviewed code):
+//  (a) runtime DATA FLOW over PLAIN OBJECTS and third-party readers: a plain object or a third-party value passed to
+//      readers (`Object.entries`/`Object.values`/`Map`/`Array.prototype.find`/a regex over keys, a schema library
+//      given `Object.fromEntries([[k, ...]])`) and indexed by a key built or carried at runtime, rather than written
+//      as a banned name or a directly-flagged `x[k]` computed member. Enumerating plain objects is legitimate module
+//      code (`new Map(Object.entries(request.cookies)).get(name)`) and stays allowed. No allow-listed built-in
+//      NAMESPACE reaches this residual any more: the only one with a loader member (`node:crypto`, `setEngine`) can
+//      no longer be namespace- or default-bound (rule 5, F-DG1-132/133), so the former enumeration route
+//      (`new Map(Object.entries(c)).get("set".concat("Engine"))`, `Object.values(c).find(...)`) is a violation at the
+//      import. If the member audit ever finds a loader member in another allow-listed built-in, add that built-in to
+//      NAMESPACE_RESTRICTED_BUILTINS as well as banning the member name.
 //  (b) F-DG1-127: runtime code GENERATION followed by a dynamic import of a literal same-module path (an allowed
 //      built-in such as `node:fs` writes a file, then `import("./local.mjs")`): the specifier is a legal own-module
 //      path and the bytes exist only at runtime, so the lint never sees them. Irreducible for a static lint;
@@ -98,13 +105,20 @@ const SHARED_ALLOWED = new Set(["@mth/shared", "@mth/shared/schemas", "@mth/conf
  * what module source imports (crypto, fs, path, url) plus the read/utility built-ins fs/promises, os and util. Per the
  * member audit in the header (F-DG1-130), they expose no member that loads, evaluates or executes code, opens a
  * debugger, or loads native objects EXCEPT `crypto.setEngine` (a native loader), which rule 1 bans in every SPELLED
- * form (reaching it by runtime enumeration of the namespace is residual (a)); residuals (a)-(c)
+ * form and rule 5 keeps unreachable by enumeration (named imports only for node:crypto); residuals (a)-(c)
  * of the header still apply (`node:fs` code generation + import is (b)). NEVER add a code-loading, exec,
  * native or debug built-in (module, vm, worker_threads, inspector, repl, child_process, cluster, process, sqlite, test,
  * wasi, v8, net, http, https, dgram, async_hooks, ...): those routes were closed one by one by F-DG1-109/117/125/127/128
  * and are now denied by default. Network I/O belongs to the composition root, not module source.
  */
 const SAFE_NODE_BUILTINS: ReadonlySet<string> = new Set(["crypto", "fs", "fs/promises", "os", "path", "url", "util"]);
+/**
+ * Rule 5 (F-DG1-132/133): allow-listed built-ins that carry a rule-1-banned member (node:crypto -> setEngine) may be
+ * imported through NAMED imports only, so their namespace/default object never becomes an enumerable value. The bare
+ * `crypto` spelling is listed too (it is already a violation as a non-dependency; listed so the rule does not depend
+ * on that).
+ */
+const NAMESPACE_RESTRICTED_BUILTINS: ReadonlySet<string> = new Set(["crypto", "node:crypto"]);
 /** F-DG1-124: dynamic-code primitives, banned in every SPELLED form (rule 1), by the kind of bypass they give. */
 const BANNED_PRIMITIVES: ReadonlyMap<string, string> = new Map([
   ...["eval", "Function", "AsyncFunction", "GeneratorFunction", "AsyncGeneratorFunction", "constructor"].map(
@@ -281,28 +295,61 @@ export function scanSource(fileName: string, source: string): ScanResult {
   const evasions: string[] = [];
   const at = (n: ts.Node) => `line ${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`;
 
+  /** Rule 5: a namespace/default binding of a built-in that carries a banned member (it could be enumerated). */
+  const restricted = (spec: string, node: ts.Node, form: string): void => {
+    if (NAMESPACE_RESTRICTED_BUILTINS.has(spec))
+      evasions.push(
+        `imports the ${spec} namespace/default binding via ${form}; only named imports are allowed ` +
+          `(it carries a rule-1-banned member) (${at(node)})`,
+      );
+  };
+  /** `default` as an import/export specifier name binds the module's default export (the module object). */
+  const bindsDefault = (elements: readonly (ts.ImportSpecifier | ts.ExportSpecifier)[]): boolean =>
+    elements.some((e) => (e.propertyName ?? e.name).text === "default");
+
   /** Specifiers (checked against the boundary) are collected everywhere, types included: `import("x").T`. */
   const collect = (node: ts.Node): void => {
     if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
       const spec = literalText(node.moduleSpecifier);
-      if (spec !== null) specifiers.push(spec);
+      if (spec !== null) {
+        specifiers.push(spec);
+        if (ts.isImportDeclaration(node)) {
+          const clause = node.importClause;
+          if (clause?.name) restricted(spec, node, "a default import");
+          const nb = clause?.namedBindings;
+          if (nb && ts.isNamespaceImport(nb)) restricted(spec, node, "import * as");
+          if (nb && ts.isNamedImports(nb) && bindsDefault(nb.elements)) restricted(spec, node, "import { default }");
+        } else {
+          const ec = node.exportClause;
+          if (!ec) restricted(spec, node, "export *");
+          else if (ts.isNamespaceExport(ec)) restricted(spec, node, "export * as");
+          else if (bindsDefault(ec.elements)) restricted(spec, node, "export { default }");
+        }
+      }
     } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
       const spec = literalText(node.moduleReference.expression);
-      if (spec !== null) specifiers.push(spec);
-      else evasions.push(`computed import-equals require (${at(node)})`);
+      if (spec !== null) {
+        specifiers.push(spec);
+        restricted(spec, node, "import = require()");
+      } else evasions.push(`computed import-equals require (${at(node)})`);
     } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
+      // Type space only (`typeof import("node:crypto")` is erased), so rule 5 does not apply.
       const spec = literalText(node.argument.literal);
       if (spec !== null) specifiers.push(spec);
     } else if (ts.isCallExpression(node)) {
       const callee = node.expression;
       if (callee.kind === ts.SyntaxKind.ImportKeyword) {
         const spec = literalText(node.arguments[0]);
-        if (spec !== null) specifiers.push(spec);
-        else evasions.push(`computed import() specifier (${at(node)})`);
+        if (spec !== null) {
+          specifiers.push(spec);
+          restricted(spec, node, "a dynamic import()");
+        } else evasions.push(`computed import() specifier (${at(node)})`);
       } else if (ts.isIdentifier(callee) && callee.text === "require") {
         const spec = literalText(node.arguments[0]);
-        if (spec !== null) specifiers.push(spec);
-        else evasions.push(`computed require() specifier (${at(node)})`);
+        if (spec !== null) {
+          specifiers.push(spec);
+          restricted(spec, node, "require()");
+        } else evasions.push(`computed require() specifier (${at(node)})`);
       }
     }
   };
```
