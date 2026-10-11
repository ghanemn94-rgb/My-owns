// F-DG4-122 and the F-DG4-123 screens (T-DG4-FE-R5; D-119; ADR-0037 / ADR-0030 amendment N3) with stubbed responses
// shaped by ARCH-R5's contract members (`headlineBasis`, `WorkspaceHeader.benefits.headlines`), in English (LTR) and
// Arabic (RTL). SYNTHETIC data only: the domain reviewer's world, planned revenue uplift 300, margin uplift 70, cash
// saving 20 and avoided cost 45 SAR, nothing validated.
//  - REQ-PB-062 / REQ-S13-003 / REQ-S03-009 / REQ-S03-011 / REQ-S08-009: on T10's Value area, the Executive Overview,
//    the Finance dashboard and the workspace header, the value headlines name their basis (profit and cash: 90); the
//    top-line (300) and non-cash (45) headlines sit beside them, labelled and never summed (435 appears nowhere);
//    a not_applicable profit-and-cash headline shows its reason, never 0 or green; every headline drills as sent.
//  - F-DG4-122: the value gap {unit: "ratio", currency: "SAR", value: "1"} reads "100 %", never "SAR 1.00".
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { TR_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import {
  d119Drilldown,
  d119ExecutiveOverview,
  d119FinanceDashboard,
  d119Header,
  d119TransformationDashboard,
  type D119Variant,
} from "./dashboardFixtures.ts";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function recorder(): { urls: string[]; handler: Handler } {
  const urls: string[] = [];
  return {
    urls,
    handler: (req) => {
      urls.push(req.url);
      return undefined;
    },
  };
}

/** The drill-down stub answers per basis, read from the request's valueClass (as the contract says). */
const drillRoute = route("GET", /\/api\/v1\/dashboard-drilldown\?/, (req) => {
  const cls = new URLSearchParams(req.url.split("?")[1]).get("valueClass");
  return json(
    d119Drilldown(cls === "revenue_uplift" ? "top_line" : cls === "avoided_cost" ? "non_cash" : "profit_and_cash"),
  );
});

type Surface = "t10" | "overview" | "finance" | "header";
const SURFACES: readonly Surface[] = ["t10", "overview", "finance", "header"];

function mount(surface: Surface, locale: "en" | "ar", variant: D119Variant, rec: Handler) {
  const routes =
    surface === "t10"
      ? [route("GET", new RegExp(`${esc(TRP)}/dashboard`), () => json(d119TransformationDashboard(variant)))]
      : surface === "overview"
        ? [route("GET", /\/api\/v1\/overview\?/, () => json(d119ExecutiveOverview(variant)))]
        : surface === "finance"
          ? [route("GET", /\/api\/v1\/dashboards\/finance\?/, () => json(d119FinanceDashboard(variant)))]
          : [route("GET", new RegExp(`${esc(TRP)}/summary$`), () => json(d119Header(variant)))];
  mockApi(rec, ...p4Handlers(locale, [], [...routes, drillRoute]));
  const path =
    surface === "t10"
      ? `/transformations/${TR_ID}/dashboard`
      : surface === "overview"
        ? "/executive-overview"
        : surface === "finance"
          ? "/dashboards/finance"
          : `/transformations/${TR_ID}`;
  renderApp(path, { i18n: createI18n(locale) });
}

/** The container of the value headlines on each surface. */
async function headlineScope(surface: Surface): Promise<HTMLElement> {
  const sel =
    surface === "finance"
      ? "#finance-headlines"
      : surface === "header"
        ? "[data-element='benefits']"
        : "section[data-area='value']";
  await waitFor(() => expect(document.querySelector(`${sel} [data-headline-basis]`)).not.toBeNull());
  return document.querySelector(sel) as HTMLElement;
}

const item = (scope: HTMLElement, metric: string, basis: string) =>
  scope.querySelector<HTMLElement>(`[data-metric='${metric}'][data-headline-basis='${basis}']`);

describe.each(["en", "ar"] as const)("Value headlines by basis (D-119; F-DG4-122/123) (%s)", (locale) => {
  const t = createI18n(locale).t;
  const label = (key: string) => t(`dashboards.headline.${key.replace(/\./g, "__")}`);

  it.each(SURFACES)(
    "%s: profit-and-cash headlines labelled with their basis; top line and non-cash beside, labelled, never summed; the gap reads 100 %",
    async (surface) => {
      mount(surface, locale, "main", recorder().handler);
      const scope = await headlineScope(surface);
      // Profit and cash: 90, labelled with the basis (label text + basis chip).
      const planned = item(scope, "value.planned", "profit_and_cash")!;
      expect(planned.textContent).toContain(label("dashboard.headline.value_planned_profit_and_cash"));
      expect(planned.querySelector("[data-basis-chip='profit_and_cash']")!.textContent).toBe(
        t("dashboards.basis.profit_and_cash"),
      );
      expect(planned.querySelector("[data-value]")!.getAttribute("data-value")).toBe("90");
      expect(planned.closest("[data-not-summed]")).toBeNull();
      // Top line 300 and non-cash 45: their own group, introduced as "beside, never added", each labelled.
      const beside = scope.querySelector<HTMLElement>("[data-headlines-beside][data-not-summed='true']")!;
      expect(beside).not.toBeNull();
      const top = item(beside, "value.planned", "top_line")!;
      const nonCash = item(beside, "value.planned", "non_cash")!;
      expect(top.textContent).toContain(label("dashboard.headline.value_planned_top_line"));
      expect(nonCash.textContent).toContain(label("dashboard.headline.value_planned_non_cash"));
      expect(top.querySelector("[data-basis-chip='top_line']")!.textContent).toBe(t("dashboards.basis.top_line"));
      expect(nonCash.querySelector("[data-basis-chip='non_cash']")!.textContent).toBe(t("dashboards.basis.non_cash"));
      expect(top.querySelector("[data-value]")!.getAttribute("data-value")).toBe("300");
      expect(nonCash.querySelector("[data-value]")!.getAttribute("data-value")).toBe("45");
      expect(scope.querySelector("[data-beside-note]")!.textContent).toContain(t("dashboards.basis.besideNote"));
      // Nothing beside is in the profit-and-cash list, and nothing adds them up.
      expect(scope.querySelector("[data-headlines] [data-headline-basis='top_line']")).toBeNull();
      expect(scope.querySelector("[data-headlines] [data-headline-basis='non_cash']")).toBeNull();
      expect(document.body.textContent).not.toMatch(/435/);
      // The five retired A2 labels are never shown, nor the neutral fallback for a value headline.
      for (const h of scope.querySelectorAll("[data-headline-basis] dt"))
        expect(h.textContent).not.toContain(t("dashboards.headline.other"));
      // F-DG4-122: the ratio gap with a currency reads "100 %", never money (not on the header: it has no gap).
      if (surface !== "header") {
        const gap = item(scope, "value.gap", "profit_and_cash")!;
        expect(gap.textContent).toContain(label("dashboard.headline.value_gap_profit_and_cash"));
        expect(gap.querySelector("[data-value-state='value'] .amount")!.textContent).toBe("100 %");
        expect(gap.textContent).not.toMatch(/SAR|ر\.س|1\.00/);
      }
      // Arabic basis labels are marked provisional (code table rows 207-235 are proposals).
      expect(scope.querySelectorAll("[data-provisional='basis']")).toHaveLength(locale === "ar" ? 1 : 0);
    },
  );

  it.each(SURFACES)(
    "%s: every headline drills as the contract says (profit and cash without valueClass; top line revenue_uplift; non-cash avoided_cost)",
    async (surface) => {
      const rec = recorder();
      mount(surface, locale, "main", rec.handler);
      const scope = await headlineScope(surface);
      const cases = [
        ["profit_and_cash", null, "90"],
        ["top_line", "revenue_uplift", "300"],
        ["non_cash", "avoided_cost", "45"],
      ] as const;
      for (const [basis, valueClass, amount] of cases) {
        rec.urls.length = 0;
        fireEvent.click(scope.querySelector(`[data-drill='value.planned'][data-drill-basis='${basis}']`)!);
        const dialog = await screen.findByRole("dialog");
        await waitFor(() => expect(dialog.querySelector(`[data-drill-basis-of='${basis}']`)).not.toBeNull());
        expect(dialog.querySelector("[data-drill-value] [data-value]")!.getAttribute("data-value")).toBe(amount);
        expect(dialog.querySelector(`[data-drill-basis-of='${basis}']`)!.textContent).toContain(
          t(`dashboards.basis.classes.${basis}`),
        );
        expect(dialog.querySelector(`[data-calculation='dashboard.value.sum_planned_${basis}']`)).not.toBeNull();
        const drillUrl = rec.urls.find((u) => u.startsWith("/api/v1/dashboard-drilldown?metric=value.planned"))!;
        expect(drillUrl).toBeDefined();
        expect(new URLSearchParams(drillUrl.split("?")[1]).get("valueClass")).toBe(valueClass);
        fireEvent.click(within(dialog).getByRole("button", { name: t("dashboards.drill.close") }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }
    },
  );

  it.each(SURFACES)(
    "%s: a not_applicable profit-and-cash headline shows its reason, never 0 or green; top line and non-cash still shown",
    async (surface) => {
      mount(surface, locale, "na", recorder().handler);
      const scope = await headlineScope(surface);
      const metrics = surface === "header" ? ["value.planned", "value.validated"] : ["value.planned", "value.gap"];
      for (const m of metrics) {
        const na = item(scope, m, "profit_and_cash")!.querySelector("[data-value-state='not_applicable']")!;
        expect(na, m).not.toBeNull();
        expect(na.textContent).toContain(t("dashboards.state.not_applicable"));
        expect(na.textContent).toContain(t("dashboards.reason.dashboard__value__no_profit_and_cash_benefit"));
        expect(na.textContent).not.toMatch(/\d/);
        expect(na.querySelector("[data-rag='green']")).toBeNull();
      }
      if (surface === "t10" || surface === "overview") {
        const area = document.querySelector("section[data-area='value']")!;
        expect(area.getAttribute("data-area-rag")).toBe("not_applicable");
        expect(
          area.querySelector("[data-rule='dashboard.rag.value.no_profit_and_cash_benefit']")!.textContent,
        ).toContain(t("dashboards.rule.dashboard__rag__value__no_profit_and_cash_benefit"));
      }
      expect(item(scope, "value.planned", "top_line")!.querySelector("[data-value]")!.getAttribute("data-value")).toBe(
        "300",
      );
      expect(item(scope, "value.planned", "non_cash")!.querySelector("[data-value]")!.getAttribute("data-value")).toBe(
        "45",
      );
      expect(scope.querySelector("[data-rag='green']")).toBeNull();
    },
  );

  it("the code-table keys (rows 207-230) are translated, Arabic is Arabic; rows 231-235 are retired", () => {
    const keys = [
      ...["planned", "forecast", "submitted", "validated"].flatMap((s) =>
        ["profit_and_cash", "top_line", "non_cash"].map(
          (b) => `dashboards.headline.dashboard__headline__value_${s}_${b}`,
        ),
      ),
      "dashboards.headline.dashboard__headline__value_gap_profit_and_cash",
      "dashboards.reason.dashboard__value__no_profit_and_cash_benefit",
      "dashboards.rule.dashboard__rag__value__no_profit_and_cash_benefit",
      ...["planned", "forecast", "submitted", "validated", "measured", "rejected", "sustained"].map(
        (s) => `dashboards.rule.dashboard__value__sum_${s}_profit_and_cash`,
      ),
      "dashboards.rule.dashboard__rag__value__validated_gap",
      "dashboards.rule.dashboard__value__gap_ratio",
      "dashboards.basis.profit_and_cash",
      "dashboards.basis.top_line",
      "dashboards.basis.non_cash",
      "dashboards.basis.besideNote",
      "dashboards.basis.arProvisional",
    ];
    expect(keys).toHaveLength(29); // rows 207-230 (24 keys) + the five web basis texts
    for (const k of keys) {
      expect(t(k, { defaultValue: "" }), k).not.toBe("");
      if (locale === "ar") expect(t(k), k).toMatch(/[؀-ۿ]/);
    }
    for (const s of ["planned", "forecast", "submitted", "validated", "gap"])
      expect(t(`dashboards.headline.dashboard__headline__value_${s}`, { defaultValue: "" })).toBe("");
    if (locale === "en") {
      expect(t("dashboards.headline.dashboard__headline__value_planned_top_line")).toBe(
        "Planned revenue uplift (top line; not in profit and cash)",
      );
      expect(t("dashboards.rule.dashboard__value__gap_ratio")).toBe(
        "Value gap (profit and cash) = (planned due to date - validated) / planned due to date, over margin uplift, cash saving and working-capital release.",
      );
    } else {
      expect(t("dashboards.headline.dashboard__headline__value_planned_profit_and_cash")).toBe(
        "القيمة المخططة (الربح والنقد)",
      );
    }
  });
});
