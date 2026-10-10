// T-DG4-FE-R2: the shared fallback of the route-level code splitting (app/router.tsx lazyPage). While a page's chunk
// loads: one translated status (role="status", polite), no number and no status colour, in both languages; a chunk
// that fails to load: a translated error with a reload, never a blank main area.
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import { afterEach, describe, expect, it } from "vitest";
import { lazyPage } from "../app/router.tsx";
import { createI18n } from "../i18n/index.ts";
import { RouteLoadFailed, RouteLoadingFallback } from "./RouteFallback.tsx";

afterEach(cleanup);

function inLocale(locale: "ar" | "en", ui: ReactNode) {
  const i18n = createI18n(locale);
  return { i18n, ...render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>) };
}

describe.each(["en", "ar"] as const)("route fallback (%s)", (locale) => {
  it("is one polite status with the translated label, no number and no status colour", () => {
    const { i18n, container } = inLocale(locale, <RouteLoadingFallback />);
    const status = screen.getByRole("status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.textContent).toBe(i18n.t("common.state.loadingPage"));
    expect(i18n.t("common.state.loadingPage")).not.toBe("common.state.loadingPage");
    // Never mistakable for data: no digit (Latin or Arabic-Indic) and no status class (success, warning, RAG, chips).
    expect(container.textContent).not.toMatch(/[0-9٠-٩]/);
    expect(container.innerHTML).not.toMatch(/success|green|rag|chip|badge|warning/i);
    // The page's first screen is reserved, so the footer does not jump while the chunk arrives.
    expect((container.firstElementChild as HTMLElement).style.minBlockSize).toBe("60vh");
  });

  it("a chunk that fails to load shows a translated error with a reload", () => {
    const { i18n } = inLocale(locale, <RouteLoadFailed />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(i18n.t("common.state.pageLoadFailed"));
    expect(screen.getByRole("button", { name: i18n.t("common.action.retry") })).toBeTruthy();
  });

  it("lazyPage shows the fallback until the page's module resolves, then the page with its props", async () => {
    let release!: (page: (p: { label: string }) => ReactNode) => void;
    const module = new Promise<(p: { label: string }) => ReactNode>((resolve) => (release = resolve));
    const Page = lazyPage<{ label: string }>(() => module);
    const { i18n } = inLocale(locale, <Page label="synthetic" />);
    expect(screen.getByRole("status").textContent).toBe(i18n.t("common.state.loadingPage"));
    expect(screen.queryByRole("heading")).toBeNull();
    await act(async () => release(({ label }) => <h1>{label}</h1>));
    expect((await screen.findByRole("heading", { level: 1 })).textContent).toBe("synthetic");
    expect(screen.queryByRole("status")).toBeNull();
    // load() resolves to the page component itself (the seam tests compare it with the fixed file and export).
    expect(await Page.load()).toBe(await module);
  });

  it("lazyPage shows the load error, not a blank area, when the chunk cannot be fetched", async () => {
    const Page = lazyPage<object>(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));
    const { i18n } = inLocale(locale, <Page />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(i18n.t("common.state.pageLoadFailed"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
