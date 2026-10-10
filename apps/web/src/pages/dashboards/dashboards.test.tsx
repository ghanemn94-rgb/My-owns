// Slice J screens (T-DG4-FE-G; p4-work-split §J+K JK.7; ADR-0037) with stubbed responses, in English (LTR) and Arabic
// (RTL). SYNTHETIC data only.
//  - REQ-PB-062 / REQ-S13-003: the six Template 10 areas render from the response's seeded labels (Arabic provisional,
//    the English source beside it); zero, Unknown, Stale and n/a are distinct states and never 0 or green; a headline
//    opens the drill-down with its value, period, calculation, contributing records and evidence.
//  - REQ-S13-001 / REQ-S13-002: the organization-wide dashboards send organizationId and the chosen filters; the
//    window and as-of date are shown; Finance shows per-class lines, gross/net and non-financial as n/a.
//  - REQ-S03-011: the header's eight elements, each Unknown where the data is missing; the one-click RAID link.
//  - REQ-S03-008: My Work's sections, totals, a draft labelled "not submitted" and the upcoming deadlines.
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createI18n } from "../../i18n/index.ts";
import { ORG_ID, TR_ID, mockApi, renderApp, route, type Handler } from "../../test/fixtures.tsx";
import { TRP, esc, json, p4Handlers } from "../my-work/p4fixtures.ts";
import {
  BENEFIT_ID,
  drilldown,
  executiveOverview,
  financeDashboard,
  knownHeader,
  myWork,
  transformationDashboard,
  unknownHeader,
} from "./dashboardFixtures.ts";
import { withPage } from "./api.ts";
import { formatValue, keyText, webPathOf } from "./ui.tsx";

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

/** Records every GET url the screen sends (to check the filters reach the server). */
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

describe("webPathOf maps API record paths to web routes", () => {
  it("keeps the transformation from the path and needs context for initiatives and business cases", () => {
    const T = `/api/v1/transformations/${TR_ID}`;
    expect(webPathOf(`${T}/kpi-definitions/${BENEFIT_ID}/status`)).toBe(`/transformations/${TR_ID}/kpis/${BENEFIT_ID}`);
    expect(webPathOf(`${T}/benefits/${BENEFIT_ID}`)).toBe(`/transformations/${TR_ID}/benefits/${BENEFIT_ID}`);
    expect(webPathOf(`${T}/actions/${BENEFIT_ID}`)).toBe(`/transformations/${TR_ID}/action-register/${BENEFIT_ID}`);
    expect(webPathOf(`${T}/outcomes/${BENEFIT_ID}`)).toBe(`/transformations/${TR_ID}/define`);
    expect(webPathOf(`/api/v1/initiatives/${BENEFIT_ID}`)).toBeNull();
    expect(webPathOf(`/api/v1/initiatives/${BENEFIT_ID}`, TR_ID)).toBe(
      `/transformations/${TR_ID}/initiatives/${BENEFIT_ID}`,
    );
    expect(webPathOf(`/transformations/${TR_ID}/kpis/x/actuals`)).toBe(`/transformations/${TR_ID}/kpis/x/actuals`);
    expect(webPathOf("https://example.invalid/x")).toBeNull();
  });

  it("pages a drill-down href by merging limit and cursor into its own query string (one '?')", () => {
    const href = `/api/v1/dashboard-drilldown?metric=value.validated&organizationId=${TR_ID}`;
    expect(withPage(href, null)).toBe(`${href}&limit=25`);
    const next = withPage(href, "abc");
    expect(next.split("?")).toHaveLength(2);
    expect(new URLSearchParams(next.split("?")[1]).get("cursor")).toBe("abc");
  });

  it("formats ratios as percent and never turns a missing value into 0", () => {
    expect(formatValue({ value: "0.125", unit: "ratio", currency: null }, "en")).toBe("12.5 %");
    expect(formatValue({ value: null, unit: "ratio", currency: null }, "en")).toBeNull();
    expect(formatValue({ value: "1500", unit: "currency", currency: "SAR" }, "en")).toMatch(/1,500/);
  });
});

describe.each(["en", "ar"] as const)("Dashboards (%s)", (locale) => {
  const t = createI18n(locale).t;

  it("transformation dashboard: six areas, distinct value states, provisional Arabic, drill-down", async () => {
    const rec = recorder();
    mockApi(
      rec.handler,
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", new RegExp(`${esc(TRP)}/dashboard`), () => json(transformationDashboard())),
          route("GET", /\/api\/v1\/dashboard-drilldown\?/, () => json(drilldown())),
        ],
      ),
    );
    renderApp(`/transformations/${TR_ID}/dashboard`, { i18n: createI18n(locale) });
    const outcomes = await screen.findByRole("region", { name: locale === "ar" ? "مجال 1" : "Outcomes" });
    expect(document.querySelectorAll("section[data-area]")).toHaveLength(6);
    expect(document.querySelector("[data-tab='dashboard']")?.getAttribute("aria-current")).toBe("page");
    // Unknown: never a number, never green
    const unknownHeadline = outcomes.querySelector("[data-metric='outcomes.area'] [data-value-state='unknown']")!;
    expect(unknownHeadline.textContent).toContain(t("dashboards.state.unknown"));
    expect(unknownHeadline.textContent).not.toMatch(/\d/);
    expect(outcomes.getAttribute("data-area-rag")).toBe("unknown");
    // zero is a known value, labelled as such; n/a is its own state with its reason
    const value = document.querySelector("section[data-area='value']")!;
    expect(value.querySelector("[data-metric='value.validated'] [data-value-state='zero']")!.textContent).toContain(
      t("dashboards.state.zero"),
    );
    const na = value.querySelector("[data-metric='value.gap'] [data-value-state='not_applicable']")!;
    expect(na.textContent).toContain(t("dashboards.state.not_applicable"));
    expect(na.textContent).toContain(t("dashboards.reason.dashboard__value__nothing_planned"));
    expect(value.querySelector("[data-policy-source='configured']")).not.toBeNull();
    // stale keeps its last value, labelled Stale
    const stale = document.querySelector("section[data-area='dependencies'] [data-value-state='stale']")!;
    expect(stale.textContent).toContain(t("dashboards.state.stale"));
    expect(stale.getAttribute("data-value")).toBe("42");
    // Decisions red with the overdue ask listed and linked to its web page
    const decisions = document.querySelector("section[data-area='decisions']")!;
    expect(decisions.getAttribute("data-area-rag")).toBe("red");
    expect(within(decisions as HTMLElement).getByText(t("dashboards.flag.overdue"))).toBeTruthy();
    expect(decisions.querySelector("a[data-record-href]")!.getAttribute("href")).toMatch(/\/executive-decisions\//);
    // Arabic labels are marked provisional, with the English source
    if (locale === "ar") expect(document.querySelectorAll("[data-provisional='true']").length).toBe(6);
    else expect(document.querySelectorAll("[data-provisional='true']").length).toBe(0);
    // drill-down: value, period, calculation, contributing benefit and evidence
    fireEvent.click(document.querySelector("section[data-area='value'] [data-drill='value.validated']")!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText("Synthetic cost saving", { exact: false });
    expect(dialog.querySelector("[data-drill-value] [data-value-state='value']")).not.toBeNull();
    expect(dialog.querySelector("[data-calculation='dashboard.value.gap_ratio']")).not.toBeNull();
    expect(within(dialog).getByText("Synthetic Finance sign-off")).toBeTruthy();
    expect(dialog.querySelector("a[data-record-href]")!.getAttribute("href")).toBe(
      `/transformations/${TR_ID}/benefits/${BENEFIT_ID}`,
    );
    await waitFor(() =>
      expect(
        rec.urls.some(
          (u) => u.startsWith("/api/v1/dashboard-drilldown?metric=value.validated") && u.split("?").length === 2,
        ),
      ).toBe(true),
    );
    expect(document.body.textContent).not.toMatch(/\bDG[0-7]\b/);
  });

  it("Executive Overview: organizationId and the period filter reach the server; window and as-of shown", async () => {
    const rec = recorder();
    mockApi(
      rec.handler,
      ...p4Handlers(
        locale,
        [],
        [
          route("GET", /\/api\/v1\/overview\?/, () => json(executiveOverview())),
          route("GET", /\/reporting-periods/, () =>
            json({
              items: [
                {
                  id: "01920000-0000-7000-9000-00000000e001",
                  organizationId: ORG_ID,
                  frequency: "quarterly",
                  periodLabel: "2026-Q1",
                  periodStart: "2026-01-01",
                  periodEnd: "2026-03-31",
                  lengthDays: 90,
                  basis: "calendar",
                  weekCount: null,
                  updateDueDate: null,
                  status: "closed",
                  openedAt: null,
                  closedAt: null,
                  version: 1,
                  createdAt: "2026-01-01T00:00:00Z",
                  updatedAt: "2026-01-01T00:00:00Z",
                },
              ],
              nextCursor: null,
            }),
          ),
        ],
      ),
    );
    renderApp("/executive-overview", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.overview.count", { count: 1 }));
    expect(rec.urls.some((u) => u.startsWith(`/api/v1/overview?organizationId=${ORG_ID}`))).toBe(true);
    expect(document.querySelector("[data-asof='2026-10-10']")).not.toBeNull();
    expect(document.querySelectorAll("[data-row] [data-rag]")).toHaveLength(6);
    const period = (await screen.findByLabelText(t("dashboards.filter.period"))) as HTMLSelectElement;
    await waitFor(() => expect(period.options.length).toBe(2));
    fireEvent.change(period, { target: { value: "01920000-0000-7000-9000-00000000e001" } });
    await waitFor(() =>
      expect(
        rec.urls.some(
          (u) => u.includes("/api/v1/overview?") && u.includes("periodId=01920000-0000-7000-9000-00000000e001"),
        ),
      ).toBe(true),
    );
    expect(document.querySelector("[data-chip='period']")!.textContent).toContain("2026-Q1");
  });

  it("Finance dashboard: per-class lines, gross and net, an Unknown net is never 0, non-financial is n/a", async () => {
    mockApi(
      ...p4Handlers(locale, [], [route("GET", /\/api\/v1\/dashboards\/finance\?/, () => json(financeDashboard()))]),
    );
    renderApp("/dashboards/finance", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.finance.pendingCount", { count: 1 }));
    const nonFin = document.querySelector("[data-non-financial-count='2']")!;
    expect(nonFin.querySelector("[data-value-state='not_applicable']")).not.toBeNull();
    const perClass = document.querySelector("#finance-lines")!;
    expect(perClass.querySelectorAll("[data-line-state]")).toHaveLength(3);
    expect(perClass.querySelector("[data-value-state='zero']")).not.toBeNull();
    const net = document.querySelector("#finance-net")!;
    const unknownNet = net.querySelector("[data-value-state='unknown']")!;
    expect(unknownNet.textContent).toContain(t("dashboards.state.unknown"));
    expect(unknownNet.textContent).not.toMatch(/\d/);
    expect(within(net as HTMLElement).getByText(t("dashboards.valueClass.net"))).toBeTruthy();
  });

  it("Finance dashboard drill-downs (ADR-0037 K1): every class line drills by valueClass; a net line is gross − implementation cost with its two inputs, never a drillable total", async () => {
    const rec = recorder();
    mockApi(
      ...p4Handlers(
        locale,
        [],
        [
          rec.handler,
          route("GET", /\/api\/v1\/dashboards\/finance\?/, () => json(financeDashboard())),
          route("GET", /\/api\/v1\/dashboard-drilldown\?/, () => json(drilldown())),
        ],
      ),
    );
    renderApp("/dashboards/finance", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.finance.pendingCount", { count: 1 }));
    const perClass = document.querySelector("#finance-lines")!;
    // every class line, of every state (rejected included), carries its drill-down; none says "no drill-down"
    for (const st of ["planned", "validated", "rejected"])
      expect(perClass.querySelector(`[data-drill-line='revenue_uplift-${st}-SAR']`), st).not.toBeNull();
    expect(perClass.textContent).not.toContain(t("dashboards.finance.noDrill"));
    const net = document.querySelector("#finance-net")!;
    expect(net.querySelector("[data-drill-line='gross-planned-SAR']")).not.toBeNull();
    expect(net.querySelector("[data-drill-line='gross-validated-SAR']")).not.toBeNull();
    // the net line: the formula and two input links, never its own drill-down
    expect(net.querySelector("[data-drill-line^='net-']")).toBeNull();
    const inputs = net.querySelector("[data-net-inputs='validated-SAR']")!;
    expect(inputs.textContent).toContain(t("dashboards.finance.netFormula"));
    expect(inputs.querySelector("[data-net-input='gross']")!.textContent).toContain(t("dashboards.finance.netGross"));
    expect(inputs.querySelector("[data-net-input='investment']")!.textContent).toContain(
      t("dashboards.finance.implementationCost"),
    );
    const drillUrl = async (button: Element) => {
      const before = rec.urls.length;
      fireEvent.click(button);
      const dialog = await screen.findByRole("dialog");
      let url = "";
      await waitFor(() => {
        url = rec.urls.slice(before).find((u) => u.startsWith("/api/v1/dashboard-drilldown?")) ?? "";
        expect(url).not.toBe("");
      });
      fireEvent.click(within(dialog).getByRole("button", { name: t("dashboards.drill.close") }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      return new URLSearchParams(url.split("?")[1]);
    };
    const rejected = await drillUrl(perClass.querySelector("[data-drill-line='revenue_uplift-rejected-SAR']")!);
    expect([rejected.get("metric"), rejected.get("valueClass")]).toEqual(["value.rejected", "revenue_uplift"]);
    const gross = await drillUrl(inputs.querySelector("[data-net-input='gross']")!);
    expect([gross.get("metric"), gross.get("valueClass")]).toEqual(["value.validated", null]);
    const cost = await drillUrl(inputs.querySelector("[data-net-input='investment']")!);
    expect([cost.get("metric"), cost.get("valueClass")]).toEqual(["value.investment", null]);
  });

  it("the value-state rule keys (rows 187-193), the slip reasons (197-200) and the KPI-status rules (201-206) are translated", () => {
    const rules = [
      ...["planned", "forecast", "submitted", "validated", "measured", "rejected", "sustained", "investment"].map(
        (s) => `dashboard.value.sum_${s}`,
      ),
      ...["green", "amber", "red", "unknown", "stale", "not_computable"].map((s) => `dashboard.kpi.${s}`),
    ];
    const reasons = ["approved_date_missing", "forecast_date_missing", "calendar_not_configured", "range_too_long"].map(
      (r) => `dashboard.portfolio.slip_${r}`,
    );
    const other = { rule: t("dashboards.rule.other"), reason: t("dashboards.reason.other") };
    for (const [group, keys] of [
      ["rule", rules],
      ["reason", reasons],
    ] as const)
      for (const k of keys) {
        const text = keyText(t, group, k);
        expect(text, k).not.toBe(other[group]);
        expect(text, k).not.toBe("");
        if (locale === "ar") expect(text, k).toMatch(/[؀-ۿ]/);
      }
    if (locale === "en") {
      expect(keyText(t, "rule", "dashboard.value.sum_rejected")).toBe(
        "Rejected value = the sum of the values Finance rejected in the period.",
      );
      expect(keyText(t, "reason", "dashboard.portfolio.slip_range_too_long")).toBe(
        "Unknown: the slip spans more working days than can be counted.",
      );
      expect(keyText(t, "rule", "dashboard.kpi.not_computable")).toBe("KPI status: not computable.");
    }
  });

  it("workspace header: every element Unknown where data is missing; one click opens the RAID register", async () => {
    mockApi(
      ...p4Handlers(
        locale,
        ["transformation.update"],
        [route("GET", new RegExp(`${esc(TRP)}/summary$`), () => json(unknownHeader()))],
      ),
    );
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
    const header = await screen.findByRole("region", { name: t("transformations.workspace.title") });
    await waitFor(() => expect(header.querySelector("[data-element='northStar']")).not.toBeNull());
    for (const el of ["gateReadiness", "northStar", "outcomeHealth", "benefits"]) {
      const cell = header.querySelector(`[data-element='${el}']`)!;
      expect(cell.querySelector("[data-health='unknown'], [data-rag='unknown']"), el).not.toBeNull();
      expect(cell.querySelector("[data-rag='green']"), el).toBeNull();
    }
    expect(header.querySelectorAll("[data-element='owners'] [data-health='unknown']")).toHaveLength(2);
    expect(header.querySelector("[data-element='keyDecisions'] [data-decisions-empty]")).not.toBeNull();
    expect(header.querySelector("[data-element='nextActions'] [data-health='unknown']")).not.toBeNull();
    expect(header.querySelector("[aria-current='step']")!.textContent).toContain(t("transformations.phase.design"));
    const raid = header.querySelector("[data-header-link='raid']")!;
    expect(raid.getAttribute("href")).toBe(`/transformations/${TR_ID}/raid`);
    expect(raid.textContent).toBe(t("dashboards.header.link.raid"));
  });

  it("workspace header: known elements show their values; a known 0 validated value is 'Known zero', not Unknown", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", new RegExp(`${esc(TRP)}/summary$`), () => json(knownHeader()))]));
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
    const header = await screen.findByRole("region", { name: t("transformations.workspace.title") });
    await waitFor(() => expect(header.querySelector("[data-gate='G2']")).not.toBeNull());
    expect(header.querySelector("[data-missing-mandatory='3']")!.textContent).toBe(
      t("dashboards.header.gateMissing", { count: 3 }),
    );
    expect(header.querySelector("[data-element='northStar'] q")!.textContent).toContain("Synthetic");
    expect(header.querySelector("[data-owner='sponsor']")!.textContent).toContain("Synthetic Sponsor");
    expect(header.querySelector("[data-owner='lead'] [data-health='unknown']")).not.toBeNull();
    expect(header.querySelector("[data-benefit-validated='SAR'] [data-value-state='zero']")).not.toBeNull();
    expect(header.querySelector("[data-overdue-decisions='1']")).not.toBeNull();
  });

  it("workspace header unavailable: every element is Unknown, with a retry (never a guessed value)", async () => {
    mockApi(...p4Handlers(locale, []));
    renderApp(`/transformations/${TR_ID}`, { i18n: createI18n(locale) });
    const header = await screen.findByRole("region", { name: t("transformations.workspace.title") });
    await waitFor(() => expect(header.querySelector("[data-state='header-unavailable']")).not.toBeNull());
    expect(header.querySelectorAll("[data-element] [data-health='unknown']")).toHaveLength(7);
  });

  it("My Work: sections with totals, the KPI update under Missing updates, a draft labelled not submitted, deadlines", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/me\/work$/, () => json(myWork()))]));
    renderApp("/my-work", { i18n: createI18n(locale) });
    const missing = await screen.findByRole("region", { name: t("dashboards.myWork.section.missing_updates") });
    const link = within(missing).getByRole("link", { name: /Synthetic churn rate/ });
    expect(link.getAttribute("href")).toMatch(/\/kpis\/.+\/actuals$/);
    expect(missing.querySelector("[data-overdue='true']")).not.toBeNull();
    const drafts = screen.getByRole("region", { name: t("dashboards.myWork.section.drafts") });
    expect(within(drafts).getByText(t("dashboards.myWork.draftLabel"))).toBeTruthy();
    expect(document.querySelector("[data-section-total='1'][data-section-total]")).not.toBeNull();
    expect(document.querySelectorAll("[data-deadline]")).toHaveLength(1);
    // The work-item and inbox sections of FE-A stay on the page.
    expect(screen.getByRole("region", { name: t("myWork.items.title") })).toBeTruthy();
  });

  it("the dashboards hub lists the six dashboards and /dashboards/executive opens the Executive Overview", async () => {
    mockApi(...p4Handlers(locale, [], [route("GET", /\/api\/v1\/overview\?/, () => json(executiveOverview()))]));
    renderApp("/dashboards", { i18n: createI18n(locale) });
    await screen.findByRole("heading", { level: 1, name: t("dashboards.hub.title") });
    expect(document.querySelectorAll("[data-dashboard-kind]")).toHaveLength(6);
    cleanup();
    renderApp("/dashboards/executive", { i18n: createI18n(locale) });
    await screen.findByText(t("dashboards.overview.count", { count: 1 }));
  });

  it("every catalogue key of the dashboards is translated (Arabic is Arabic)", () => {
    const keys = [
      "dashboards.rule.dashboard__rag__decisions__overdue",
      "dashboards.reason.dashboard__value__no_financial_benefit",
      "dashboards.headline.dashboard__headline__value_validated",
      "dashboards.valueClass.non_financial_valued",
      "dashboards.lineState.submitted",
      "problems.dashboard__period_not_found",
      "problems.dashboard__owner_not_found",
      "problems.dashboard__metric_subject_mismatch",
      "problems.dashboard__workstream_archived",
      "problems.dashboard_rag_policy__threshold_order",
    ];
    for (const k of keys) {
      expect(t(k, { defaultValue: "" }), k).not.toBe("");
      if (locale === "ar") expect(t(k), k).toMatch(/[؀-ۿ]/);
    }
    if (locale === "en")
      expect(t("dashboards.rule.dashboard__rag__decisions__overdue")).toBe(
        "Decisions: at least one open decision is past its decision date.",
      );
  });
});
