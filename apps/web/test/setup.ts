// Web unit-test setup (test harness only), wired into apps/web/vitest.config.ts as `setupFiles`.
//
// F-DG2-220: Testing Library's async utilities (`findBy*`, `waitFor`) default to a 1000 ms timeout. Many unit-web tests
// render the whole app (router, GET /me, the page's queries) against a scripted API and then wait for a control. Under
// full-suite parallel load that chain alone can take more than 1 s (p2-blank-forms.test.tsx failed once on Node 24 with
// "Unable to find role=button ..." while the Diagnose page was still loading). The page did load; the wait was just too
// short. Every async utility in the unit-web project therefore gets 5000 ms of headroom.
//
// The per-test timeout (`testTimeout: 20_000` in apps/web/vitest.config.ts) stays well above this, so
// a wait that really never resolves still fails with Testing Library's own message ("Unable to find ...") rather than
// a bare "Test timed out". Explicit per-call `{ timeout }` options and per-test timeouts still take precedence.
import { configure } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";
import { assertNoReactWarnings, installReactWarningGuard } from "./react-warning-guard.ts";

export const UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 5_000;

configure({ asyncUtilTimeout: UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS });

// F-DG4-148 (D-131): the lazily loaded page modules are warmed before a file's first test. app/router.tsx loads every
// page with a dynamic import() on first use (T-DG4-FE-R2, D-111). In a test, that dynamic import is the first time the
// file's worker transforms and evaluates the page and its module graph, and it ran INSIDE the first test's 5 s findBy*
// wait. Under CPU contention (a load of 13 or more on the review machine) that one-off module load alone exceeded the
// wait, so the first render of a page in a file failed with "Unable to find ..." while every later render passed.
// The warm-up imports the page modules once per file, before its tests, in a hook with its own budget:
//  - the files: every non-test module under src/pages, by glob, a superset of the 81 that router.tsx imports lazily
//    (a page added there later is covered without editing this list);
//  - it only fills the module cache. It does not call lazyPage's load(), so a render still goes through React.lazy,
//    Suspense and the shared fallback exactly as before; the import resolves from the cache;
//  - no assertion wait (UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS) and no test timeout changes. The budget below applies to this
//    hook alone, so a module that really fails to load still fails the file, with a hook error that names the cause.
// The budget was sized from measurements (handback T-DG4-FE-R10): MTH_UNIT_WEB_WARMUP_REPORT=1 prints each file's warm-up time.
export const UNIT_WEB_PAGE_WARMUP_TIMEOUT_MS = 60_000;
const PAGE_MODULES = import.meta.glob(["../src/pages/**/*.tsx", "!../src/pages/**/*.test.tsx"]);
export const UNIT_WEB_WARMED_PAGE_MODULES = Object.keys(PAGE_MODULES);

beforeAll(async (suite) => {
  const started = performance.now();
  await Promise.all(Object.values(PAGE_MODULES).map((load) => load()));
  if (process.env["MTH_UNIT_WEB_WARMUP_REPORT"] === "1") {
    process.stderr.write(`[unit-web warm-up] ${Math.round(performance.now() - started)} ms ${suite.name}\n`);
  }
}, UNIT_WEB_PAGE_WARMUP_TIMEOUT_MS);

// F-DG2-430: a React "Cannot update a component ... while rendering a different component" or act() warning fails the
// test that printed it (see test/react-warning-guard.ts for the exact patterns). Other console.error output is
// forwarded untouched and never fails a test. This file's afterEach is registered before any test file's hooks, and
// Vitest runs afterEach hooks in reverse order, so the check runs last: after Testing Library's cleanup (unmount), so a
// warning printed while unmounting is caught too. afterAll catches one printed after the last test of a file.
installReactWarningGuard();
afterEach(() => assertNoReactWarnings("during this test"));
afterAll(() => assertNoReactWarnings("after the last test of this file"));
