// Unit tests of the executive-pack assembler's pure mapping (T-DG5-KBE-D; ADR-0045 §5, §6, §12; REQ-S09-011;
// p5-work-split §F.3). Worked fixtures: every DashboardValue state, every value metric's basis and label, the area RAG
// statuses, the field keys. No database. Unknown and Stale never travel as 0 and never as green; value bases and
// currencies stay apart (D-117, D-119, D-122). All values are SYNTHETIC.
import { reportValue, type DashboardHeadline, type DashboardValue } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { assembledCodes, assemblerOf } from "../assembler.ts";
import {
  dashboardReportValue,
  headlineFields,
  headlineState,
  headlineValueBasis,
  ragValue,
  subjectSlug,
} from "./executive-pack.ts";

const dv = (o: Partial<DashboardValue>): DashboardValue => ({
  state: "value",
  value: null,
  unit: null,
  currency: null,
  reasonKey: null,
  kpiUnit: null,
  ...o,
});
const hl = (
  metric: DashboardHeadline["metric"],
  value: DashboardValue,
  basis: DashboardHeadline["headlineBasis"] = null,
) =>
  ({
    metric,
    labelKey: `dashboard.headline.${metric.replace(".", "_")}${basis === null ? "" : `_${basis}`}`,
    value,
    period: null,
    drilldownHref: "/api/v1/dashboard-drilldown?metric=x",
    headlineBasis: basis,
  }) as DashboardHeadline;

describe("registry (p5-work-split §F.3)", () => {
  it("registers executive_pack under its own code; it takes no settings", () => {
    expect(assemblerOf("executive_pack")?.code).toBe("executive_pack");
    expect(assembledCodes()).toContain("executive_pack");
    const a = assemblerOf("executive_pack")!;
    expect(a.parseParameters({})).toEqual({});
    expect(a.parseParameters(undefined)).toEqual({});
    expect(() => a.parseParameters({ register: "raid" })).toThrow(
      expect.objectContaining({ code: "report.parameters_invalid" }),
    );
  });
});

describe("ADR-0045 §5 rule 1: the label and basis of each value headline", () => {
  it("planned is a plan figure (n/a), forecast and submitted are provisional, validated is validated", () => {
    expect(headlineState("value.planned").validation).toBe("not_applicable");
    expect(headlineState("value.forecast").validation).toBe("provisional");
    expect(headlineState("value.submitted").validation).toBe("provisional");
    expect(headlineState("value.validated").validation).toBe("validated");
    for (const m of ["value.gap", "value.investment", "outcomes.area", "portfolio.initiatives", "dependencies.open"])
      expect(headlineState(m).validation, m).toBe("not_applicable");
  });

  it("the value basis follows the state; non-value metrics carry none", () => {
    expect(["value.planned", "value.forecast", "value.submitted", "value.validated"].map(headlineValueBasis)).toEqual([
      "planned",
      "forecast",
      "submitted",
      "validated",
    ]);
    expect(headlineValueBasis("value.gap")).toBeNull();
    expect(headlineValueBasis("value.investment")).toBeNull();
    expect(headlineValueBasis("decisions.open")).toBeNull();
  });
});

describe("dashboardReportValue: every DashboardValue state (ADR-0045 §12)", () => {
  it("money keeps its decimal string, currency and basis; a forecast is provisional", () => {
    const v = dashboardReportValue(dv({ value: "1250000.50", unit: "currency", currency: "SAR" }), "value.forecast");
    expect(v).toEqual({
      type: "decimal",
      value: "1250000.50",
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "forecast",
      validation: "provisional",
      reason: null,
    });
    expect(reportValue.safeParse(v).success).toBe(true);
  });

  it("a validated zero is a known 0 (state zero), validated, not Unknown", () => {
    const v = dashboardReportValue(
      dv({ state: "zero", value: "0", unit: "currency", currency: "SAR" }),
      "value.validated",
    );
    expect(v).toMatchObject({ value: "0", validation: "validated", valueBasis: "validated" });
  });

  it("Unknown money has no number and is never 0: not computable with a reason key, missing without", () => {
    const a = dashboardReportValue(
      dv({ state: "unknown", unit: "currency", currency: "SAR", reasonKey: "benefit.value_amount_missing" }),
      "value.validated",
    );
    expect(a).toMatchObject({ type: "decimal", value: null, validation: "unknown", reason: "not_computable" });
    const b = dashboardReportValue(dv({ state: "unknown", unit: "currency", currency: "SAR" }), "value.planned");
    expect(b).toMatchObject({ value: null, validation: "unknown", reason: "missing" });
    for (const x of [a, b]) expect(reportValue.safeParse(x).success).toBe(true);
  });

  it("Stale has no number; not_applicable has none either", () => {
    expect(dashboardReportValue(dv({ state: "stale", unit: "ratio" }), "value.gap")).toMatchObject({
      type: "decimal",
      unitKind: "ratio",
      value: null,
      validation: "stale",
      reason: "stale",
    });
    const na = dashboardReportValue(
      dv({ state: "not_applicable", unit: "currency", reasonKey: "dashboard.value.no_financial_benefit" }),
      "value.validated",
    );
    expect(na).toMatchObject({ value: null, validation: "not_applicable", reason: null });
    expect(reportValue.safeParse(na).success).toBe(true);
  });

  it("a ratio (the value gap) stays a decimal ratio with no basis", () => {
    expect(dashboardReportValue(dv({ value: "0.250000", unit: "ratio" }), "value.gap")).toMatchObject({
      type: "decimal",
      unitKind: "ratio",
      value: "0.250000",
      valueBasis: null,
      currency: null,
      validation: "not_applicable",
    });
  });

  it("a count stays an integer count; an unknown count has no number", () => {
    expect(dashboardReportValue(dv({ value: "7", unit: "initiative" }), "portfolio.initiatives")).toEqual({
      type: "count",
      value: 7,
      validation: "not_applicable",
      reason: null,
    });
    expect(
      dashboardReportValue(dv({ state: "zero", value: "0", unit: "dependency" }), "dependencies.open"),
    ).toMatchObject({ type: "count", value: 0 });
    expect(dashboardReportValue(dv({ state: "unknown", unit: "decision" }), "decisions.open")).toMatchObject({
      type: "count",
      value: null,
      validation: "unknown",
    });
  });

  it("a KPI-derived value keeps its unit kind", () => {
    expect(
      dashboardReportValue(dv({ value: "0.125", kpiUnit: { kind: "percentage", label: "%" } }), "outcomes.kpi_status"),
    ).toMatchObject({ type: "decimal", unitKind: "percentage", value: "0.125" });
  });
});

describe("ragValue: Unknown and Stale are never green", () => {
  it("green, amber, red and not_applicable are recorded codes; unknown and stale carry no code", () => {
    for (const s of ["green", "amber", "red", "not_applicable"] as const)
      expect(ragValue(s)).toMatchObject({ type: "code", value: s, labelKey: `report.rag_status.${s}` });
    expect(ragValue("unknown")).toMatchObject({ value: null, labelKey: null, validation: "unknown" });
    expect(ragValue("stale")).toMatchObject({ value: null, labelKey: null, validation: "stale" });
    for (const s of ["green", "amber", "red", "unknown", "stale", "not_applicable"] as const)
      expect(reportValue.safeParse(ragValue(s)).success, s).toBe(true);
  });
});

describe("headlineFields and subjectSlug: stable, unique keys", () => {
  it("one field per headline, keyed by metric, basis and currency, never merging two currencies or bases", () => {
    const fields = headlineFields([
      hl("value.validated", dv({ value: "10", unit: "currency", currency: "SAR" }), "profit_and_cash"),
      hl("value.validated", dv({ value: "4", unit: "currency", currency: "USD" }), "profit_and_cash"),
      hl("value.validated", dv({ value: "3", unit: "currency", currency: "SAR" }), "top_line"),
      hl("portfolio.initiatives", dv({ value: "2", unit: "initiative" })),
    ]);
    expect(fields.map((f) => f.key)).toEqual([
      "value_validated_profit_and_cash_sar",
      "value_validated_profit_and_cash_usd",
      "value_validated_top_line_sar",
      "portfolio_initiatives",
    ]);
    expect(fields.map((f) => (f.value as { currency?: string | null }).currency ?? null)).toEqual([
      "SAR",
      "USD",
      "SAR",
      null,
    ]);
    // A repeated headline gets a numbered key (never a silent overwrite).
    const twice = headlineFields([
      hl("decisions.open", dv({ value: "1", unit: "decision" })),
      hl("decisions.open", dv({ value: "1", unit: "decision" })),
    ]);
    expect(twice.map((f) => f.key)).toEqual(["decisions_open", "decisions_open_2"]);
    for (const f of [...fields, ...twice]) expect(f.key).toMatch(/^[a-z][a-z0-9_]{0,63}$/);
  });

  it("subjectSlug makes section-key-safe slugs", () => {
    expect(subjectSlug("WS-01")).toBe("ws_01");
    expect(subjectSlug("  Roaming / Digital ")).toBe("roaming_digital");
    expect(subjectSlug("---")).toBe("subject");
  });
});
