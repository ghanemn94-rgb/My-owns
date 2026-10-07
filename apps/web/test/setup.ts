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
import { afterAll, afterEach } from "vitest";
import { assertNoReactWarnings, installReactWarningGuard } from "./react-warning-guard.ts";

export const UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 5_000;

configure({ asyncUtilTimeout: UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS });

// F-DG2-430: a React "Cannot update a component ... while rendering a different component" or act() warning fails the
// test that printed it (see test/react-warning-guard.ts for the exact patterns). Other console.error output is
// forwarded untouched and never fails a test. This file's afterEach is registered before any test file's hooks, and
// Vitest runs afterEach hooks in reverse order, so the check runs last: after Testing Library's cleanup (unmount), so a
// warning printed while unmounting is caught too. afterAll catches one printed after the last test of a file.
installReactWarningGuard();
afterEach(() => assertNoReactWarnings("during this test"));
afterAll(() => assertNoReactWarnings("after the last test of this file"));
