// The F-DG4-126 / F-DG4-127 screens (D-122; ADR-0037 amendment N4; T-DG4-FE-R6), on ARCH-R6's contract with mocked
// responses (KBE-R7 builds the API at the same time), in English (LTR) and Arabic (RTL):
//  - the Value RAG lists one validated gap per basis and currency, each labelled with its basis; the area status is the
//    worst of them; there is never a single cross-basis gap (R3-6a would give 300 / 370 = 81 %);
//  - the per-basis gap headlines: the top-line gap beside the profit-and-cash one, labelled, a percentage (1 → 100 %);
//  - the Portfolio initiative value on its basis, labelled; `not_applicable` with its reason, never 0;
//  - a drill-down narrowed to a currency shows that currency.
// SYNTHETIC data (dashboardFixtures.ts, ARCH-R6 handback §4.3).
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardRag } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import {
  N4_INI,
  N4_VALUE_RAG,
  n4ExecutiveOverview,
  n4FinanceDashboard,
  n4TopLineGapDrilldown,
  n4TransformationDashboard,
} from "./dashboardFixtures.ts";
import { valueRagLines } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const textOf = (el: Element | null) => (el?.textContent ?? "").replace(/\s+/g, " ");

describe("valueRagLines reads ruleParams.lines defensively (ruleParams is a free object in the contract)", () => {
  it("returns each well-formed line, drops malformed ones, and keeps a missing gap null (never 0)", () => {
    const rag: DashboardRag = {
      ...N4_VALUE_RAG,
      ruleParams: {
        lines: [
          { currency: "SAR", headlineBasis: "profit_and_cash", gapRatio: "0", status: "green", reasonKey: null },
          { currency: "USD", headlineBasis: "top_line", gapRatio: null, status: "unknown", reasonKey: "x.y" },
          { currency: "SAR", headlineBasis: "everything", gapRatio: "0.81", status: "red" },
          { currency: "SAR", headlineBasis: "non_cash", gapRatio: "1", status: "purple" },
          "junk",
        ],
      },
    };
    expect(valueRagLines(rag)).toEqual([
      { currency: "SAR", headlineBasis: "profit_and_cash", gapRatio: "0", status: "green", reasonKey: null },
      { currency: "USD", headlineBasis: "top_line", gapRatio: null, status: "unknown", reasonKey: "x.y" },
    ]);
    expect(valueRagLines({ ...rag, ruleKey: "dashboard.rag.value.nothing_due" })).toBeNull();
    expect(valueRagLines({ ...rag, ruleParams: { headlineBasis: "profit_and_cash" } })).toBeNull();
  });
});

describe.each(["en", "ar"] as const)("N4 value screens (D-122; F-DG4-126/127) (%s)", (locale) => {
  const t = createI18n(locale).t;

  it.each(["t10", "overview"] as const)(
    "%s: the Value RAG shows each basis's gap with its own status; the area is the worst (Red); no cross-basis gap",
    async (surface) => {
      mockApi(
        ...p4Handlers(
          locale,
          [],
          [
            route("GET", new RegExp(`${esc(TRP)}/dashboard`), () => json(n4TransformationDashboard())),
            route("GET", /\/api\/v1\/overview\?/, () => json(n4ExecutiveOverview())),
          ],
        ),
      );
      renderApp(surface === "t10" ? `/transformations/${TR_ID}/dashboard` : "/executive-overview", {
        i18n: createI18n(locale),
      });
      await waitFor(() =>
        expect(document.querySelector("section[data-area='value'] [data-value-rag-lines]")).not.toBeNull(),
      );
      const value = document.querySelector<HTMLElement>("section[data-area='value']")!;
      expect(value.getAttribute("data-area-rag")).toBe("red");
      const lines = value.querySelector<HTMLElement>("[data-value-rag-lines]")!;
      expect(lines.getAttribute("data-value-rag-lines")).toBe("2");
      const pc = lines.querySelector("[data-rag-line-basis='profit_and_cash']")!;
      const top = lines.querySelector("[data-rag-line-basis='top_line']")!;
      // Each gap labelled with its basis, in its currency, as a percentage, with its own status (icon + text).
      expect(textOf(pc.querySelector("[data-basis-chip]"))).toBe(t("dashboards.basis.profit_and_cash"));
      expect(textOf(top.querySelector("[data-basis-chip]"))).toBe(t("dashboards.basis.top_line"));
      expect(pc.getAttribute("data-rag-line-currency")).toBe("SAR");
      expect(textOf(pc)).toContain("0 %");
      expect(textOf(top)).toContain("100 %");
      expect(textOf(pc.querySelector("[data-rag]"))).toContain(t("dashboards.rag.green"));
      expect(textOf(top.querySelector("[data-rag]"))).toContain(t("dashboards.rag.red"));
      // The worst line sets the area status, and the note says so; gaps never added across bases.
      expect(top.getAttribute("data-worst")).toBe("true");
      expect(pc.hasAttribute("data-worst")).toBe(false);
      expect(textOf(lines)).toContain(t("dashboards.basis.ragLinesNote"));
      expect(textOf(value.querySelector("[data-rule]"))).toContain(
        t("dashboards.rule.dashboard__rag__value__validated_gap"),
      );
      // Never a single cross-basis gap: 300 / 370 = 0.81.
      expect(textOf(document.body)).not.toMatch(/81(\.\d+)? %/);
      expect(document.querySelector("[data-value^='0.81']")).toBeNull();
      // The per-basis gap headlines: profit and cash in the main list, top line beside it, labelled, never summed.
      const pcGap = value.querySelector(
        "[data-headlines] [data-metric='value.gap'][data-headline-basis='profit_and_cash']",
      )!;
      const topGap = value.querySelector(
        "[data-headlines-beside][data-not-summed='true'] [data-metric='value.gap'][data-headline-basis='top_line']",
      )!;
      expect(textOf(pcGap)).toContain("0 %");
      expect(textOf(topGap)).toContain(t("dashboards.headline.dashboard__headline__value_gap_top_line"));
      expect(textOf(topGap.querySelector("[data-basis-chip]"))).toBe(t("dashboards.basis.top_line"));
      expect(textOf(topGap)).toContain("100 %");
      // Arabic proposals are marked provisional on screen: one note per area, none in English.
      expect(value.querySelectorAll("[data-provisional='basis']")).toHaveLength(locale === "ar" ? 1 : 0);
    },
  );

  it("T10 Portfolio: the value column names the profit-and-cash basis; n/a shows its reason, never 0; Unknown stays Unknown", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [route("GET", new RegExp(`${esc(TRP)}/dashboard`), () => json(n4TransformationDashboard()))],
      ),
    );
    renderApp(`/transformations/${TR_ID}/dashboard`, { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("[data-area-items='portfolio']")).not.toBeNull());
    const table = document.querySelector<HTMLElement>("[data-area-items='portfolio']")!;
    const header = table.querySelector("[data-value-column-basis='profit_and_cash']")!;
    expect(textOf(header)).toBe(t("dashboards.basis.portfolioValue"));
    const row = (id: string) => table.querySelector<HTMLElement>(`tr[data-item='${id}']`)!;
    // Ranked by the server: INI-B (70) first, INI-A (n/a) after, INI-C (Unknown) last; the order is kept.
    expect([...table.querySelectorAll("tbody tr")].map((r) => r.getAttribute("data-item"))).toEqual([
      N4_INI.b,
      N4_INI.a,
      N4_INI.c,
    ]);
    const b = row(N4_INI.b);
    expect(b.querySelector("[data-value]")!.getAttribute("data-value")).toBe("70");
    expect(b.querySelector("[data-item-basis='profit_and_cash'] [data-basis-chip='profit_and_cash']")).not.toBeNull();
    const a = row(N4_INI.a);
    const na = a.querySelector("[data-value-state='not_applicable']")!;
    expect(textOf(na)).toContain(t("dashboards.state.not_applicable"));
    expect(textOf(na)).toContain(t("dashboards.reason.dashboard__portfolio__no_profit_and_cash_allocation"));
    expect(a.querySelector("[data-value]")).toBeNull();
    expect(textOf(a.querySelector("[data-item-basis]"))).not.toMatch(/\d/);
    const c = row(N4_INI.c);
    expect(textOf(c.querySelector("[data-value-state='unknown']"))).toContain(t("dashboards.state.unknown"));
    expect(textOf(c.querySelector("[data-item-basis]"))).not.toMatch(/\d/);
    // 435 (the five-class sum) is nowhere.
    expect(textOf(document.body)).not.toMatch(/435/);
  });

  it("Finance: the top-line gap headline sits beside, labelled; its drill-down shows its basis and currency (SAR)", async () => {
    const urls: string[] = [];
    mockApi(
      (req) => {
        urls.push(req.url);
        return undefined;
      },
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /\/api\/v1\/dashboards\/finance\?/, () => json(n4FinanceDashboard())),
          route("GET", /\/api\/v1\/dashboard-drilldown\?/, () => json(n4TopLineGapDrilldown())),
        ],
      ),
    );
    renderApp("/dashboards/finance", { i18n: createI18n(locale) });
    await waitFor(() => expect(document.querySelector("#finance-headlines [data-headlines-beside]")).not.toBeNull());
    const beside = document.querySelector<HTMLElement>("#finance-headlines [data-headlines-beside]")!;
    const gap = beside.querySelector<HTMLElement>("[data-metric='value.gap'][data-headline-basis='top_line']")!;
    expect(textOf(gap)).toContain(t("dashboards.headline.dashboard__headline__value_gap_top_line"));
    expect(textOf(gap)).toContain("100 %");
    within(gap).getByRole("button").click();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelector("[data-drill-currency]")).not.toBeNull());
    // The href is followed as sent: its basis class and its currency.
    const sent = urls.find((u) => u.startsWith("/api/v1/dashboard-drilldown?metric=value.gap"))!;
    const q = new URLSearchParams(sent.split("?")[1]);
    expect(q.get("valueClass")).toBe("revenue_uplift");
    expect(q.get("currency")).toBe("SAR");
    expect(dialog.querySelector("[data-drill-currency]")!.getAttribute("data-drill-currency")).toBe("SAR");
    expect(textOf(dialog.querySelector("[data-drill-currency]"))).toBe("SAR");
    expect(dialog.querySelector("[data-drill-basis-of='top_line']")).not.toBeNull();
    expect(textOf(dialog.querySelector("[data-drill-value]"))).toContain("100 %");
    expect(textOf(dialog.querySelector("[data-calculation]"))).toContain(
      t("dashboards.rule.dashboard__value__gap_ratio_top_line"),
    );
  });
});
