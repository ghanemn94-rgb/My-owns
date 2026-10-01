# Handback T-DG1-FE3 — F-DG1-214 (unit-web suite fails on Node 24)

- **Agent:** frontend-ux-engineer
- **Invocation:** `{"kind":"claude-code-cli-session","run_id":"DG1-T-DG1-FE3-frontend-ux-engineer-20261001T150629Z-49722b06","session_id":"49722b06-d7ec-41e0-93cf-6b312f9ccb54"}`
- **Assignment:** `docs/delivery/assignments/DG1/round-11/T-DG1-FE3.md` (sha256 `cc5b3940…63949c`, verified)
- **Base:** `HEAD` = `2a88cf90957b73895685f86c5ab2c95b5f0f30d1`
- **Stage:** DG1 round-11 repair. I fixed only F-DG1-214 (Medium, REQ-DLV-033). The finding stays open until a non-author reviewer verifies the fix.

## 1. Changed files (web test harness only)

| File | Purpose |
|---|---|
| `apps/web/test/jsdom-native-abort-environment.ts` (new) | A custom Vitest environment. It wraps the built-in `jsdom` environment and then restores Node's native `AbortController`/`AbortSignal` globals. |
| `apps/web/vitest.config.ts` | The `unit-web` project now uses `environment: "./test/jsdom-native-abort-environment.ts"` instead of `"jsdom"`, with a comment explaining why. |
| `apps/web/tsconfig.json` | Adds `"test"` to `include` so `pnpm -r typecheck` also typechecks the new harness file. This doesn't change the emitted product: `noEmit`, and Vite builds from `index.html`/`src`. |

I didn't touch any product, runtime, API, other package, `tools/**`, `docs/source/**`, review or gate file. No test was skipped, disabled or altered. Both Node legs still run.

### Exact diff

```diff
--- a/apps/web/vitest.config.ts
+++ b/apps/web/vitest.config.ts
@@ -7,7 +7,9 @@ export default mergeConfig(
   defineProject({
     test: {
       name: "unit-web",
-      environment: "jsdom",
+      // jsdom, with Node's native AbortController/AbortSignal so react-router's request signal is accepted by
+      // Node's `Request` on Node 24 as well as Node 22 (F-DG1-214; see test/jsdom-native-abort-environment.ts).
+      environment: "./test/jsdom-native-abort-environment.ts",
       include: ["src/**/*.test.{ts,tsx}"],
     },
   }),
--- a/apps/web/tsconfig.json
+++ b/apps/web/tsconfig.json
-  "include": ["src", "vite.config.ts", "vitest.config.ts"]
+  "include": ["src", "test", "vite.config.ts", "vitest.config.ts"]
```

New file `apps/web/test/jsdom-native-abort-environment.ts` (core):

```ts
import { builtinEnvironments, type Environment } from "vitest/environments";
const ABORT_GLOBALS = ["AbortController", "AbortSignal"] as const;
const jsdomWithNativeAbort: Environment = {
  name: "jsdom-native-abort",
  transformMode: "web",
  async setup(global, options) {
    // Captured before jsdom populates the global object, i.e. Node's native constructors (same realm as Request).
    const native = ABORT_GLOBALS.map((key) => [key, Object.getOwnPropertyDescriptor(global, key)] as const);
    const jsdomEnv = await builtinEnvironments.jsdom.setup(global, options);
    for (const [key, descriptor] of native) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
    }
    return jsdomEnv;
  },
};
export default jsdomWithNativeAbort;
```

### Rationale

- **The cause.** Vitest 3.2.4's jsdom `setup()` calls `populateGlobal(global, dom.window)`, and that list includes `AbortController` and `AbortSignal`. `Request` and `fetch` are not in jsdom, so they stay Node's (undici). react-router 7.9.0 builds `new Request(url, { signal })` with a jsdom signal. undici 7 on Node 24 checks `instanceof` against the native `AbortSignal` and rejects it.
- **The fix.** The environment takes the native property descriptors before jsdom's setup runs, then puts them back afterwards. The abort primitives and `Request` now share one realm, which is how a browser behaves.
- **What stays the same.** jsdom's `document`, `window`, events, storage and the rest are unchanged. Teardown is still jsdom's own: it deletes the keys it populated and restores the originals, so nothing leaks between files.
- **Alternatives I didn't use.** I chose a custom environment over snapshotting the constructors in `vite.config.ts`/`vitest.config.ts`. The config loads in the main process, but tests run in worker forks or threads, so a snapshot taken there doesn't reach the test realm.

## 2. Behaviour delivered

- **REQ-DLV-033 / F-DG1-214:** the unit-web suite passes on both Node 22 and Node 24, with the same tests and the same assertions. The 12 tests that failed on Node 24 now pass. They include the F-DG1-004 and F-DG1-210 regression tests.

## 3. Checks actually run

**Environment.** I ran everything offline, with no `pnpm install`, from the repository root. The binaries were Node 22 = `/opt/node22/bin/node` (v22.22.2) and Node 24 = `/opt/nvm/versions/node/v24.21.0/bin/node` (v24.21.0).

**PATH note.** In this sandbox the default `PATH` resolves `node` to **v24.21.0**, not 22. So I set the "Node 22" runs explicitly with `PATH=/opt/node22/bin:$PATH`. The assignment says "Node 22 (default)", so this differs from it.

### Before the fix: Node 24 (`HEAD`, unmodified harness)

`PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm vitest run --project unit-web` → **exit 1**

```
   × bilingual shell > redirects to sign-in when there is no session
   × transformations > lists transformations with a sortable code column and removable filter chips
   × transformations > edit: a 409 writes nothing, shows compare, and re-applies on the current version
   × after create (F-DG1-004) > shows the created record when the server lets the creator read it
   × after create (F-DG1-004) > explains, in English, that the draft was created but cannot be opened (server 404), instead of 'Not found'
   × after create (F-DG1-004) > explains the same in Arabic (RTL), using the glossary term for Transformation
   × after create (F-DG1-004) > treats a 403 for the just-created record the same way
   × truly out-of-scope records keep the correct localized message > router state for a different id does not turn a 404 into the created message
   × effective permissions refresh after create (F-DG1-210) > English: Edit, Archive and the audit trail appear after create, without a reload
   × effective permissions refresh after create (F-DG1-210) > Arabic (RTL): the same controls and the audit trail appear after create, without a reload
   × effective permissions refresh after create (F-DG1-210) > does not over-grant: if the refreshed server answer adds nothing, Archive and the audit trail stay hidden
   × effective permissions refresh after create (F-DG1-210) > a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)
 ❯ node_modules/.pnpm/react-router@7.9.0_.../react-router/dist/development/chunk-VHEBI3C5.js:6690:22
 Test Files  2 failed | 6 passed (8)
      Tests  12 failed | 98 passed (110)
     Errors  11 errors
```

The output contained 13 `Expected signal` occurrences, all from the `RequestInit: Expected signal ("AbortSignal {}") to be an instance of AbortSignal` TypeError.

### After the fix

| Command | Runtime | Exit | Result |
|---|---|---|---|
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm vitest run --project unit-web` | Node 24.21.0 | 0 | `Test Files 8 passed (8)`, `Tests 110 passed (110)`; 0 `Expected signal` occurrences |
| `PATH=/opt/nvm/versions/node/v24.21.0/bin:$PATH pnpm test` | Node 24.21.0 | 0 | `Test Files 21 passed (21)`, `Tests 302 passed (302)`; 0 `Expected signal` occurrences |
| `PATH=/opt/node22/bin:$PATH pnpm vitest run --project unit-web` | Node 22.22.2 | 0 | `Test Files 8 passed (8)`, `Tests 110 passed (110)` |
| `PATH=/opt/node22/bin:$PATH pnpm test` | Node 22.22.2 | 0 | `Test Files 21 passed (21)`, `Tests 302 passed (302)` |
| `pnpm -r typecheck` | Node 22.22.2 | 0 | api, worker, web (`apps/web typecheck: Done`, now including `test/`) and packages: all Done |
| `pnpm lint` | Node 22.22.2 | 0 | `eslint . --max-warnings=0`: no output |
| `pnpm format:check` | Node 22.22.2 | 0 | `All matched files use Prettier code style!` |

Node 24 unit-web tail, after the fix:

```
   ✓ effective permissions refresh after create (F-DG1-210) > Arabic (RTL): the same controls and the audit trail appear after create, without a reload  402ms
   ✓ effective permissions refresh after create (F-DG1-210) > a failed /me refresh never blocks the navigation; the UI stays fail-safe (no controls offered)  3126ms
 Test Files  8 passed (8)
      Tests  110 passed (110)
```

**Not run (outside scope):**
- **Integration project.** It needs `TEST_DATABASE_ADMIN_URL` and doesn't touch the web harness.
- **Playwright screenshots.** There's no visible UI change, so no screenshots apply.

## 4. Known gaps / not done

- **No visual change.** This is a test-harness-only fix, so there are no screenshots.
- **Other uncommitted changes in the tree.** The working tree had changes I didn't make and didn't touch: `apps/api/src/architecture.test.ts`, `apps/api/src/architecture.testkit.ts` and `docs/delivery/findings.json`. The `pnpm test` runs above include the state of those files as they were in the tree.
- **Node 22 PATH.** As noted in §3, Node 22 isn't the sandbox default here. CI's Node 22 leg is unaffected.
- **Verification.** F-DG1-214 still needs verification by a non-author reviewer.

## 5. Merge instructions

- There are no migrations and no dependency changes, and the lockfile is untouched.
- Merge the three files listed in §1. Nothing depends on merge order.
- **Possible conflict:** another task that edits `apps/web/vitest.config.ts` or `apps/web/tsconfig.json` in the same round.
