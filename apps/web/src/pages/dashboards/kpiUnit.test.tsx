// D-124 items 2 and 3 (T-DG4-FE-R7; ADR-0037 amendment N5): a KPI-derived dashboard value says its unit kind in
// `kpiUnit = {kind, label}`, and the web formats it from `kind` exactly as the KPI pages' `formatKpiValue` does, then
// adds the label as display text. A value with `kpiUnit` null keeps the earlier rules: the computed value gap (unit
// `ratio`) stays a fraction × 100 (F-DG4-122), and a percentage unit stays × 100 (F-DG4-125).
// The four value objects are ARCH-R7's fixtures F1–F4 (handback T-DG4-ARCH-R7 §4.3), as the API sends them after
// T-DG4-KBE-R8. Every surface that renders KPI values is checked in EN and AR: the T10 Outcomes and People & adoption
// areas, the Executive Overview, the adoption dashboard and the drill-down (value, items, inputs). The workspace header
// shows no KPI value (ADR-0037 N5 "Not carriers": its value elements are money). SYNTHETIC data.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AdoptionDashboard, DashboardItem, DashboardValue, T10Area } from "@mth/shared/schemas";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, USER_ID, mockApi, renderApp, route } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import { T0, drilldown, executiveOverview, filters, transformationDashboard } from "./dashboardFixtures.ts";
import { ValueView, formatValue, formatValueParts } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** F1: a `percentage` KPI with no label, actual 0.12. */
const F1: DashboardValue = {
  state: "value",
  value: "0.12",
  unit: "percentage",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "percentage", label: null },
};
/** F2: a `percentage` KPI labelled '% of users', actual 0.12 (`unit` carries the label: display text only). */
const F2: DashboardValue = {
  state: "value",
  value: "0.12",
  unit: "% of users",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "percentage", label: "% of users" },
};
/** F3: a `ratio` KPI with no label, actual 1.5. Its `unit` is `ratio`, like the value gap's: only `kpiUnit` differs. */
const F3: DashboardValue = {
  state: "value",
  value: "1.5",
  unit: "ratio",
  currency: null,
  reasonKey: null,
  kpiUnit: { kind: "ratio", label: null },
};
/** F4: the computed value gap 1 (planned 70, nothing validated): `kpiUnit` null, unit `ratio`, a currency. */
const F4: DashboardValue = {
  state: "value",
  value: "1",
  unit: "ratio",
  currency: "SAR",
  reasonKey: null,
  kpiUnit: null,
};

const F2_STALE: DashboardValue = { ...F2, state: "stale", reasonKey: "kpi.stale" };
const F3_UNKNOWN: DashboardValue = { ...F3, state: "unknown", value: null, reasonKey: "kpi.no_accepted_actual" };
const F1_ZERO: DashboardValue = { ...F1, state: "zero", value: "0" };
const F3_ZERO: DashboardValue = { ...F3, state: "zero", value: "0" };

const textOf = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

describe.each(["en", "ar"] as const)("N5 formatValue (%s): a KPI value is formatted from kpiUnit.kind", (locale) => {
  it("formats ARCH-R7's four fixtures: 12 %, 12 % of users, 1.5, 100 %", () => {
    expect(formatValue(F1, locale)).toBe("12 %");
    expect(formatValue(F2, locale)).toBe("12 % of users");
    expect(formatValue(F3, locale)).toBe("1.5");
    expect(formatValue(F4, locale)).toBe("100 %");
    // The negative assertions of ARCH-R7 §4.3.
    expect(formatValue(F2, locale)).not.toContain("0.12");
    expect(formatValue(F3, locale)).not.toContain("%");
    expect(formatValue(F3, locale)).not.toBe("150 %");
    expect(formatValue(F4, locale)).not.toMatch(/SAR|ر\.س/);
  });

  it("splits the number from the label, so the label can be isolated on its own (bidi)", () => {
    expect(formatValueParts(F1, locale)).toEqual({ number: "12 %", label: null });
    expect(formatValueParts(F2, locale)).toEqual({ number: "12", label: "% of users" });
    expect(formatValueParts(F3, locale)).toEqual({ number: "1.5", label: null });
    expect(formatValueParts(F4, locale)).toEqual({ number: "100 %", label: null });
    expect(formatValueParts(F3_UNKNOWN, locale)).toBeNull();
  });

  it("applies N5's percentage label rule: '%' is always shown and the label never changes the × 100", () => {
    const pct = (label: string | null, value = "0.12") =>
      formatValue({ ...F1, value, unit: label ?? "percentage", kpiUnit: { kind: "percentage", label } }, locale);
    for (const plain of ["%", "percent", "percentage", " Percentage ", "PERCENT"]) expect(pct(plain)).toBe("12 %");
    expect(pct("% of users")).toBe("12 % of users");
    expect(pct("of users")).toBe("12 % of users");
    expect(pct("من المستخدمين")).toBe("12 % من المستخدمين");
    expect(pct(null, "0.125")).toBe("12.5 %");
    expect(pct(null, "0")).toBe("0 %");
    expect(pct("% of users", "1")).toBe("100 % of users");
  });

  it("formats ratio, count, duration, score and other as decimals with their label, never × 100", () => {
    const kpi = (kind: "ratio" | "count" | "duration" | "score" | "other", label: string | null, value = "1.5") =>
      formatValue({ ...F3, value, unit: label ?? kind, kpiUnit: { kind, label } }, locale);
    expect(kpi("ratio", null, "0.25")).toBe("0.25");
    expect(kpi("ratio", "x")).toBe("1.5 x");
    expect(kpi("count", "calls", "1200")).toBe("1,200 calls");
    expect(kpi("duration", "days", "2.5")).toBe("2.5 days");
    expect(kpi("score", null, "4.12345")).toBe("4.1235");
    expect(kpi("other", "NPS points", "42")).toBe("42 NPS points");
    // A ratio KPI whose label is '%' is still a ratio: the label never decides the scaling (N5 item 3).
    expect(kpi("ratio", "%", "0.12")).toBe("0.12 %");
  });

  it("formats a currency KPI as money without its label; without a currency, as `other`", () => {
    const money = formatValue(
      { ...F3, value: "90", unit: "SAR k", currency: "SAR", kpiUnit: { kind: "currency", label: "SAR k" } },
      locale,
    );
    expect(money).toMatch(locale === "en" ? /^SAR\s?90\.00$/ : /90\.00\s?ر\.س\./);
    expect(money).not.toContain("SAR k");
    expect(
      formatValue(
        { ...F3, value: "90", unit: "currency", currency: null, kpiUnit: { kind: "currency", label: null } },
        locale,
      ),
    ).toBe("90");
  });

  it("keeps today's rules when kpiUnit is null or absent (F-DG4-122, F-DG4-125)", () => {
    expect(formatValue({ value: "1", unit: "ratio", currency: "SAR", kpiUnit: null }, locale)).toBe("100 %");
    expect(formatValue({ value: "0.12", unit: "percentage", currency: null, kpiUnit: null }, locale)).toBe("12 %");
    expect(formatValue({ value: "0.12", unit: "%", currency: null }, locale)).toBe("12 %");
    const money = formatValue({ value: "90", unit: "currency", currency: "SAR", kpiUnit: null }, locale);
    expect(money).toMatch(locale === "en" ? /^SAR\s?90\.00$/ : /90\.00\s?ر\.س\./);
    expect(formatValue({ value: "3", unit: "initiative", currency: null, kpiUnit: null }, locale)).toBe("3");
  });
});

describe.each(["en", "ar"] as const)("N5 ValueView (%s): states keep their rendering", (locale) => {
  const i18n = createI18n(locale);
  const t = i18n.t;
  const view = (value: DashboardValue) =>
    render(
      <I18nextProvider i18n={i18n}>
        <ValueView value={value} />
      </I18nextProvider>,
    ).container;

  it("isolates the number left-to-right, and number and label together in one auto-direction isolate", () => {
    const c = view(F2);
    expect(textOf(c)).toBe("12 % of users");
    const group = c.querySelector("bdi[data-value-text]")!;
    expect(group.hasAttribute("dir")).toBe(false);
    expect(group.querySelector("bdi[dir='ltr']")?.textContent).toBe("12");
    // The label is not an isolate of its own: it decides the group's direction (Latin LTR, Arabic RTL).
    const label = group.querySelector("[data-unit-label]")!;
    expect(label.tagName).toBe("SPAN");
    expect(label.textContent).toBe("% of users");
    cleanup();
    // Without a label, the number is the only (LTR) isolate.
    const plain = view(F3);
    expect(plain.querySelector("bdi[data-value-text]")).toBeNull();
    expect(plain.querySelector(".amount > bdi[dir='ltr']")?.textContent).toBe("1.5");
  });

  it("Stale F2 shows the Stale chip and '12 % of users' as the last known value", () => {
    const c = view(F2_STALE);
    expect(c.querySelector("[data-value-state='stale']")).not.toBeNull();
    expect(textOf(c)).toContain(t("dashboards.state.stale"));
    expect(textOf(c)).toContain(`${t("dashboards.state.lastKnown")}: 12 % of users`);
    expect(textOf(c)).not.toContain("0.12");
  });

  it("Unknown F3 shows Unknown with its reason and no number", () => {
    const c = view(F3_UNKNOWN);
    expect(c.querySelector("[data-value-state='unknown']")).not.toBeNull();
    expect(textOf(c)).toContain(t("dashboards.state.unknown"));
    expect(textOf(c)).not.toMatch(/\d/);
  });

  it("a zero F1 reads '0 %' and a zero F3 reads '0', each with the Zero label", () => {
    const z1 = view(F1_ZERO);
    expect(z1.querySelector("[data-value-state='zero'] .amount")?.textContent).toBe("0 %");
    expect(textOf(z1)).toContain(t("dashboards.state.zero"));
    cleanup();
    const z3 = view(F3_ZERO);
    expect(z3.querySelector("[data-value-state='zero'] .amount")?.textContent).toBe("0");
    expect(textOf(z3)).toContain(t("dashboards.state.zero"));
  });
});

// ------------------------------------------------------------------------------------------------ surfaces

const ID = {
  f1: "01920000-0000-7000-9000-0000000a0f01",
  f2: "01920000-0000-7000-9000-0000000a0f02",
  f3: "01920000-0000-7000-9000-0000000a0f03",
  f2Stale: "01920000-0000-7000-9000-0000000a0f12",
} as const;

const kpiItem = (recordId: string, code: string, value: DashboardValue): DashboardItem => ({
  recordType: "outcome_kpi",
  recordId,
  code,
  label: `Synthetic KPI ${code}`,
  href: `/api/v1/transformations/${TR_ID}/kpi-definitions/${recordId}/status`,
  rag: "amber",
  dueDate: null,
  value,
  ownerUserId: USER_ID,
  flags: [],
  valueBasis: null,
});

/** Outcomes: F1 and F3; People & adoption: F2 and a Stale F2; Value: the F4 gap headline. */
function n5Areas(): T10Area[] {
  return transformationDashboard().areas.map((a) => {
    if (a.code === "outcomes") return { ...a, items: [kpiItem(ID.f1, "KPI-F1", F1), kpiItem(ID.f3, "KPI-F3", F3)] };
    if (a.code === "people_adoption")
      return {
        ...a,
        items: [
          { ...kpiItem(ID.f2, "KPI-F2", F2), recordType: "adoption_metric_link" },
          { ...kpiItem(ID.f2Stale, "KPI-F2S", F2_STALE), recordType: "adoption_metric_link" },
        ],
      };
    if (a.code === "value")
      return {
        ...a,
        headlines: a.headlines.map((h) => (h.metric === "value.gap" ? { ...h, value: F4 } : h)),
      };
    return a;
  });
}

/** The expected text of each KPI item, by record id. */
const EXPECTED: [string, string][] = [
  [ID.f1, "12 %"],
  [ID.f3, "1.5"],
  [ID.f2, "12 % of users"],
];

function expectAreaValues(root: ParentNode, expected: [string, string][] = EXPECTED) {
  for (const [id, text] of expected) {
    const amount = root.querySelector(`tr[data-item='${id}'] [data-value-state='value'] .amount`);
    expect(textOf(amount), id).toBe(text);
  }
  const stale = root.querySelector(`tr[data-item='${ID.f2Stale}'] [data-value-state='stale']`)!;
  expect(textOf(stale)).toContain("12 % of users");
  if (expected.some(([id]) => id === ID.f3))
    expect(textOf(root.querySelector(`tr[data-item='${ID.f3}']`))).not.toContain("%");
  for (const [id] of [...expected, [ID.f2Stale]])
    expect(textOf(root.querySelector(`tr[data-item='${id}']`))).not.toContain("0.12");
}

function adoption(): AdoptionDashboard {
  const area = n5Areas().find((a) => a.code === "people_adoption")!;
  const row = (templateKey: string, value: DashboardValue) => ({
    kpiDefinitionId: ID.f1,
    templateKey,
    targetKind: "transformation" as const,
    targetId: TR_ID,
    rag: "amber" as const,
    value,
    drilldownHref: `/api/v1/dashboard-drilldown?metric=adoption.indicators&organizationId=${ORG_ID}`,
  });
  return {
    organizationId: ORG_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    appliedFilters: filters(),
    area,
    indicators: [row("n5_f1_rate", F1), row("n5_f2_rate", F2), row("n5_f3_ratio", F3)],
    openInterventionCount: 0,
    transformations: [],
  };
}

/** The `outcomes.kpi_status` drill-down of the ratio KPI: the value F3, the items F1/F2/F3, the `actual` input F2. */
function kpiDrill() {
  const d = drilldown();
  const item = (recordId: string, code: string, value: DashboardValue) => ({
    ...d.items[0]!,
    recordType: "kpi_actual",
    recordId,
    code,
    value,
  });
  return {
    ...d,
    metric: "outcomes.kpi_status",
    value: F3,
    calculation: {
      ruleKey: "dashboard.kpi.actual",
      expression: null,
      inputs: [{ name: "actual", value: F2, recordType: null, recordId: null }],
      rounding: null,
    },
    items: [item(ID.f1, "KPI-F1", F1), item(ID.f2, "KPI-F2", F2), item(ID.f3, "KPI-F3", F3)],
    headlineBasis: null,
    currency: null,
  };
}

describe.each(["en", "ar"] as const)("N5 surfaces (%s): every KPI value is formatted by its kind", (locale) => {
  const t = createI18n(locale).t;

  it("T10: Outcomes (F1, F3), People & adoption (F2, Stale F2), the F4 gap, and the KPI drill-down", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/dashboard`), () =>
            json({ ...transformationDashboard(), areas: n5Areas() }),
          ),
          route("GET", /\/api\/v1\/dashboard-drilldown\?/, () => json(kpiDrill())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/dashboard`, { i18n: createI18n(locale) });
    const outcomes = await screen.findByRole("region", { name: locale === "ar" ? "مجال 1" : "Outcomes" });
    const main = document.querySelector("main")!;
    expectAreaValues(main);
    // The value gap (computed ratio, kpiUnit null) stays a percentage, never money.
    const gap = document.querySelector("section[data-area='value'] [data-value='1'] .amount");
    expect(textOf(gap)).toBe("100 %");
    expect(textOf(document.querySelector("section[data-area='value'] [data-value='1']"))).not.toMatch(/SAR|ر\.س/);
    // The drill-down: its value (F3), the inputs (F2) and the items (F1, F2, F3).
    within(outcomes as HTMLElement)
      .getAllByRole("button", { name: new RegExp(t("dashboards.drill.open")) })[0]!
      .click();
    const dialog = await screen.findByRole("dialog");
    await waitFor(() =>
      expect(
        dialog.querySelectorAll("[data-drill-items] tr[data-value], [data-drill-items] [data-value]").length,
      ).toBeGreaterThan(0),
    );
    expect(textOf(dialog.querySelector("[data-drill-value] .amount"))).toBe("1.5");
    expect(textOf(dialog.querySelector("[data-inputs] .amount"))).toBe("12 % of users");
    const items = [...dialog.querySelectorAll("[data-drill-items] [data-value-state='value'] .amount")].map(textOf);
    expect(items).toEqual(["12 %", "12 % of users", "1.5"]);
    expect(textOf(dialog)).not.toContain("0.12");
    expect(textOf(dialog)).not.toContain("150 %");
  });

  it("Executive Overview: the Outcomes and People & adoption areas", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [route("GET", /\/api\/v1\/overview\?/, () => json({ ...executiveOverview(), areas: n5Areas() }))],
      ),
    );
    renderApp("/executive-overview", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.overview.count", { count: 1 }));
    expectAreaValues(document.querySelector("main")!);
    expect(textOf(document.querySelector("main"))).not.toContain("150 %");
  });

  it("the adoption dashboard: each indicator row and the area items", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/dashboards\/adoption/, () => json(adoption()))]));
    renderApp("/dashboards/adoption", { i18n: createI18n(locale) });
    const rowText = async (key: string) => textOf((await screen.findByText(key)).closest("tr"));
    expect(await rowText("n5_f1_rate")).toContain("12 %");
    expect(await rowText("n5_f2_rate")).toContain("12 % of users");
    const f3 = await rowText("n5_f3_ratio");
    expect(f3).toContain("1.5");
    expect(f3).not.toContain("%");
    // The adoption dashboard's area is People & adoption only: F2 and the Stale F2.
    expectAreaValues(document.querySelector("main")!, [[ID.f2, "12 % of users"]]);
    expect(textOf(document.body)).not.toContain("0.12");
    expect(textOf(document.body)).not.toContain("150 %");
  });
});
