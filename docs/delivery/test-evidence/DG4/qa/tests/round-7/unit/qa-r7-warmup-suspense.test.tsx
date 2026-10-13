// qa-verifier DG4 round 7 (T-DG4-REV-QA-R7B), F-DG4-148 verification: the unit-web setup's warm-up (apps/web/test/setup.ts)
// imports every page module before a file's tests. This probe checks that the warm-up does NOT change what a page render
// goes through: a lazyPage whose module is ALREADY in the worker's module cache still renders the shared Suspense fallback
// first (one polite status, translated), and only then the page; and the router's own lazy pages are not marked resolved
// by the warm-up (their load() is still the first call). Lives OUTSIDE the frozen candidate; copied into a disposable copy
// at apps/web/src/components/ only to run. EN (LTR) and AR (RTL). SYNTHETIC content.
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { UNIT_WEB_WARMED_PAGE_MODULES } from "../../test/setup.ts";
import { lazyPage } from "../app/router.tsx";
import { createI18n } from "../i18n/index.ts";

afterEach(cleanup);

describe.each(["en", "ar"] as const)("QA-R7 warm-up keeps Suspense (%s)", (locale) => {
  it("the warm-up ran before this test: AreaPages.tsx is in the warmed set", () => {
    expect(UNIT_WEB_WARMED_PAGE_MODULES).toContain("../src/pages/AreaPages.tsx");
  });

  it("a lazyPage over a WARMED module still shows the fallback on its first render, then the page", async () => {
    const t0 = performance.now();
    const warm = await import("../pages/AreaPages.tsx");
    const importMs = performance.now() - t0;
    expect(typeof warm.AboutPage).toBe("function");
    const Page = lazyPage<{ label: string }>(() =>
      import("../pages/AreaPages.tsx").then(() => ({ label }: { label: string }) => <h1>{label}</h1>),
    );
    const i18n = createI18n(locale);
    render(
      <I18nextProvider i18n={i18n}>
        <div dir={locale === "ar" ? "rtl" : "ltr"}>
          <Page label="synthetic page" />
        </div>
      </I18nextProvider>,
    );
    // Synchronously after the first render: the Suspense fallback, not the page (React.lazy suspended).
    const status = screen.getByRole("status");
    expect(status.textContent).toBe(i18n.t("common.state.loadingPage"));
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => {
      await Promise.resolve();
    });
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("synthetic page");
    expect(screen.queryByRole("status")).toBeNull();
    // Recorded for the log: the re-import of a warmed module is served from the cache.
    process.stderr.write(`[qa-r7] ${locale}: warmed re-import ${importMs.toFixed(1)} ms\n`);
  });
});

describe("QA-R7 the router's lazy pages are not pre-resolved by the warm-up", () => {
  it("router.tsx's lazy pages still render through Suspense: none is resolved before its first load()", async () => {
    const src = (await import("../app/router.tsx?raw")).default as string;
    // The warm-up uses import.meta.glob loaders, never lazyPage's once(); resolved is only set by once().
    const setup = (await import("../../test/setup.ts?raw")).default as string;
    const code = setup.replace(/^\s*\/\/.*$/gm, ""); // code only, comments removed
    expect(code).not.toMatch(/lazyPage|preloadRoute|router\.tsx/);
    expect(code).toMatch(/import\.meta\.glob\(/);
    expect(src).toMatch(/useState<ComponentType<P>>\(\(\) => resolved \?\? Lazy\)/);
  });
});

export type { ReactNode };
