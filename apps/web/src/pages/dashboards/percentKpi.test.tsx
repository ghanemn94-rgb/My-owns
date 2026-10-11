// F-DG4-125 (DG4 round 3, domain; D-122): a percentage KPI is stored as a FRACTION (ADR-0028 §3: 0.12 = 12 %), and the
// API sends its value object as `{value: "0.12", unit: "percentage"}` (or `unit: "%"` with that unit label), because
// kpi/dashboard-facts.ts sets `unit = unit_label ?? unit_kind`. Every dashboard surface must render it as "12 %", as the
// KPI pages do (formatKpiValue), never "0.12 %". The `ratio` rendering of F-DG4-122 is unchanged (1 → 100 %).
// The value objects below are copied from the reviewer's R3-7 API response (zz-domain-r3.test.ts). SYNTHETIC data.
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdoptionDashboard, DashboardItem, DashboardValue, T10Area } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import { KPI_ID, T0, drilldown, executiveOverview, filters, transformationDashboard } from "./dashboardFixtures.ts";
import { formatValue } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** The API's own KPI value object (R3-7): a weighted_ratio 12 / 100 with an accepted actual. */
const API_PERCENTAGE: DashboardValue = {
  state: "value",
  value: "0.12",
  unit: "percentage",
  currency: null,
  reasonKey: null,
};
/** The same KPI with the unit label "%" (unit = unit_label ?? unit_kind). */
const API_PERCENT_SIGN: DashboardValue = { ...API_PERCENTAGE, unit: "%" };
/** A Stale actual of the same KPI keeps its last value, labelled Stale (areas.ts kpiActualValue). */
const API_STALE: DashboardValue = { ...API_PERCENTAGE, state: "stale", value: "0.12", reasonKey: "kpi.stale" };

describe.each(["en", "ar"] as const)("F-DG4-125 formatValue (%s): a percentage KPI is a fraction × 100", (locale) => {
  it("renders the API's {value:'0.12', unit:'percentage'} and {unit:'%'} as '12 %', never '0.12 %'", () => {
    expect(formatValue(API_PERCENTAGE, locale)).toBe("12 %");
    expect(formatValue(API_PERCENT_SIGN, locale)).toBe("12 %");
    for (const v of [API_PERCENTAGE, API_PERCENT_SIGN]) expect(formatValue(v, locale)).not.toMatch(/0\.12/);
  });

  it("keeps fractions exact (decimal.js) and keeps the locale's digits and sign", () => {
    const pct = (value: string, unit = "percentage") => formatValue({ value, unit, currency: null }, locale);
    expect(pct("1")).toBe("100 %");
    expect(pct("0.125")).toBe("12.5 %");
    expect(pct("0.1234", "%")).toBe("12.34 %");
    expect(pct("0")).toBe("0 %");
    expect(pct("-0.05")).toBe(locale === "ar" ? "‎-5 %" : "-5 %");
    // 0.1 + 0.2 in floats is 0.30000000000000004: never here.
    expect(pct("0.3")).toBe("30 %");
    // A percentage carrying a currency is still a percentage, never money.
    expect(formatValue({ value: "0.12", unit: "percentage", currency: "SAR" }, locale)).toBe("12 %");
    expect(formatValue({ value: null, unit: "percentage", currency: null }, locale)).toBeNull();
  });

  it("leaves the F-DG4-122 ratio rendering unchanged (1 → 100 %) and money as money", () => {
    expect(formatValue({ value: "1", unit: "ratio", currency: "SAR" }, locale)).toBe("100 %");
    expect(formatValue({ value: "0.25", unit: "ratio", currency: null }, locale)).toBe("25 %");
    const money = formatValue({ value: "90", unit: "currency", currency: "SAR" }, locale);
    expect(money).toMatch(locale === "en" ? /^SAR\s?90\.00$/ : /90\.00\s?ر\.س\./);
  });
});

/** A KPI item of an area, carrying the API value object. */
const kpiItem = (value: DashboardValue, code = "KPI-12"): DashboardItem => ({
  recordType: "outcome_kpi",
  recordId: KPI_ID,
  code,
  label: "Synthetic digital adoption rate",
  href: `/api/v1/transformations/${TR_ID}/kpi-definitions/${KPI_ID}/status`,
  rag: "amber",
  dueDate: null,
  value,
  ownerUserId: USER_ID,
  flags: [],
  valueBasis: null,
});

/** The six areas with a percentage KPI in Outcomes (unit 'percentage') and People & adoption (unit '%', and Stale). */
function percentAreas(): T10Area[] {
  return transformationDashboard().areas.map((a) =>
    a.code === "outcomes"
      ? { ...a, items: [kpiItem(API_PERCENTAGE)] }
      : a.code === "people_adoption"
        ? { ...a, items: [kpiItem(API_PERCENT_SIGN, "KPI-13"), kpiItem(API_STALE, "KPI-14")] }
        : a,
  );
}

function adoption(): AdoptionDashboard {
  const area = percentAreas().find((a) => a.code === "people_adoption")!;
  return {
    organizationId: ORG_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    appliedFilters: filters(),
    area,
    indicators: [
      {
        kpiDefinitionId: KPI_ID,
        templateKey: "usage_rate",
        targetKind: "transformation",
        targetId: TR_ID,
        rag: "amber",
        value: API_PERCENTAGE,
        drilldownHref: `/api/v1/dashboard-drilldown?metric=adoption.indicator&organizationId=${ORG_ID}`,
      },
    ],
    openInterventionCount: 0,
    transformations: [],
  };
}

/** The KPI drill-down: the headline and its item carry the API's percentage value object. */
function kpiDrill() {
  const d = drilldown();
  return {
    ...d,
    metric: "outcomes.area",
    value: API_PERCENTAGE,
    calculation: { ruleKey: "dashboard.kpi.actual", expression: null, inputs: [], rounding: null },
    items: [{ ...d.items[0]!, recordType: "outcome_kpi", code: "KPI-12", value: API_PERCENT_SIGN }],
    headlineBasis: null,
    currency: null,
  };
}

const textOf = (el: Element) => (el.textContent ?? "").replace(/\s+/g, " ");

describe.each(["en", "ar"] as const)("F-DG4-125 surfaces (%s): every percentage KPI reads 12 %", (locale) => {
  const t = createI18n(locale).t;

  it("T10: the Outcomes and People & adoption items, the Stale last value, and the drill-down", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/dashboard`), () =>
            json({ ...transformationDashboard(), areas: percentAreas() }),
          ),
          route("GET", /\/api\/v1\/dashboard-drilldown\?/, () => json(kpiDrill())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/dashboard`, { i18n: createI18n(locale) });
    const outcomes = await screen.findByRole("region", { name: locale === "ar" ? "مجال 1" : "Outcomes" });
    const people = document.querySelector("section[data-area='people_adoption']")!;
    const values = [outcomes, people].flatMap((s) => [...s.querySelectorAll("[data-value='0.12']")]);
    expect(values).toHaveLength(3);
    for (const v of values) {
      expect(textOf(v)).toContain("12 %");
      expect(textOf(v)).not.toContain("0.12");
    }
    // The Stale actual keeps its last value, labelled Stale, also scaled.
    const stale = people.querySelector("[data-value-state='stale']")!;
    expect(textOf(stale)).toContain(t("dashboards.state.stale"));
    expect(textOf(stale)).toContain("12 %");
    // The drill-down of the Outcomes headline: the value and the item.
    within(outcomes as HTMLElement)
      .getAllByRole("button", { name: new RegExp(t("dashboards.drill.open")) })[0]!
      .click();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() => expect(dialog.querySelectorAll("[data-value='0.12']")).toHaveLength(2));
    for (const v of dialog.querySelectorAll("[data-value='0.12']")) expect(textOf(v)).toContain("12 %");
    expect(textOf(dialog)).not.toContain("0.12");
  });

  it("Executive Overview: the Outcomes and People & adoption areas", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [route("GET", /\/api\/v1\/overview\?/, () => json({ ...executiveOverview(), areas: percentAreas() }))],
      ),
    );
    renderApp("/executive-overview", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.overview.count", { count: 1 }));
    const values = [...document.querySelectorAll("[data-value='0.12']")];
    expect(values.length).toBeGreaterThanOrEqual(3);
    for (const v of values) expect(textOf(v)).toContain("12 %");
    expect(textOf(document.querySelector("main") ?? document.body)).not.toMatch(/0\.12\s?%/);
  });

  it("the adoption dashboard: the indicator row and the area items", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/dashboards\/adoption/, () => json(adoption()))]));
    renderApp("/dashboards/adoption", { i18n: createI18n(locale) });
    const row = await screen.findByText("usage_rate");
    const tr = row.closest("tr")!;
    expect(textOf(tr)).toContain("12 %");
    expect(textOf(tr)).not.toContain("0.12");
    expect(textOf(document.body)).not.toMatch(/0\.12\s?%/);
  });
});
