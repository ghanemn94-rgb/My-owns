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

export const UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS = 5_000;

configure({ asyncUtilTimeout: UNIT_WEB_ASYNC_UTIL_TIMEOUT_MS });
