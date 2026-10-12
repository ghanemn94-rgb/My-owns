// qa-verifier DG4 round 7 (F-DG4-148 verification), NOT part of the candidate: copied into a disposable copy at
// apps/web/src/app/ only to run. Question: does the unit-web warm-up (apps/web/test/setup.ts beforeAll) change what the
// tests exercise? The warm-up fills the module cache; it must NOT pre-resolve lazyPage, so a page's first render in a
// file still goes through React.lazy, Suspense and the shared RouteLoadingFallback.
// Method: RouteLoadingFallback is wrapped (pass-through) to count its renders.
//   S1  the first render of /transformations in this file renders the fallback at least once, then the page;
//   S2  control: a second render of the same page in the same file renders NO fallback (lazyPage's `resolved` is set
//       by the first load), so the counter really distinguishes "went through Suspense" from "rendered at once".
//   S3  the setup's warmed set covers the page module used here (so S1 ran AFTER a warm-up of that very module).
// Run with and without the warm-up (setup beforeAll removed): S1-S3 must hold in both. SYNTHETIC data.
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNIT_WEB_WARMED_PAGE_MODULES } from "../../test/setup.ts";
import { resetSessionStateForTests } from "../api/client.ts";
import { createI18n } from "../i18n/index.ts";
import { OFFICE_GRANTS, makeMe, makeTransformation, mockApi, renderApp, route } from "../test/fixtures.tsx";

const counter = vi.hoisted(() => ({ fallbackRenders: 0 }));
vi.mock("../components/RouteFallback.tsx", async (importOriginal) => {
  const original = await importOriginal<typeof import("../components/RouteFallback.tsx")>();
  function CountingRouteLoadingFallback() {
    counter.fallbackRenders += 1;
    return original.RouteLoadingFallback();
  }
  return { ...original, RouteLoadingFallback: CountingRouteLoadingFallback };
});

afterEach(() => {
  // rev2: unmount (rev1 lacked this, and React work after the file's environment teardown raised
  // "ReferenceError: window is not defined" as an unhandled error; a defect of this probe, not of the candidate).
  cleanup();
  resetSessionStateForTests();
  vi.unstubAllGlobals();
});

function api(lang: "en" | "ar") {
  return mockApi(
    route("GET", /\/api\/v1\/me$/, () => ({
      status: 200,
      body: { ...makeMe(OFFICE_GRANTS, { preferredLocale: lang }), csrfToken: "q".repeat(43) },
    })),
    route("GET", /\/api\/v1\/transformations\?/, () => ({
      status: 200,
      body: { items: [makeTransformation({ code: "TR-QA-R7", name: "QA r7 synthetic" })], nextCursor: null },
    })),
    route("GET", /./, () => ({ status: 200, body: { items: [], nextCursor: null } })),
  );
}

describe("qa-r7 F-DG4-148: the warm-up leaves React.lazy / Suspense / the shared fallback exercised", () => {
  it("S3: the warmed set includes the transformations list page module", () => {
    expect(UNIT_WEB_WARMED_PAGE_MODULES.some((p) => /\/pages\/transformations\//.test(p))).toBe(true);
  });

  it("S1: the first render of a page in this file goes through Suspense (fallback rendered), then the page", async () => {
    api("en");
    const before = counter.fallbackRenders;
    renderApp("/transformations", { i18n: createI18n("en") });
    await screen.findByText("TR-QA-R7");
    expect(counter.fallbackRenders - before).toBeGreaterThanOrEqual(1);
  });

  it("S2 (control): a second render of the same page renders at once, without the fallback", async () => {
    api("ar");
    const before = counter.fallbackRenders;
    renderApp("/transformations", { i18n: createI18n("ar") });
    await screen.findByText("TR-QA-R7");
    expect(document.documentElement.dir).toBe("rtl");
    expect(counter.fallbackRenders - before).toBe(0);
  });
});
