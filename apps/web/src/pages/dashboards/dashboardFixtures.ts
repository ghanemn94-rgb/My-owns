// SYNTHETIC slice J responses for the dashboard, header and My Work tests (T-DG4-FE-G). Shapes follow the zod mirrors
// in packages/shared/src/schemas/dashboards.ts (OpenAPI 1.3.0-p4). No figure here is real data.
import type {
  DashboardDrilldown,
  DashboardItem,
  DashboardValue,
  ExecutiveOverview,
  FinanceDashboard,
  MyWork,
  T10Area,
  TransformationDashboard,
  WorkspaceHeader,
} from "@mth/shared/schemas";
import { ORG_ID, TR_ID, USER_ID } from "../../test/fixtures.tsx";

export const T0 = "2026-10-10T06:00:00Z";
export const KPI_ID = "01920000-0000-7000-9000-00000000a001";
export const BENEFIT_ID = "01920000-0000-7000-9000-00000000b001";
export const DECISION_ID = "01920000-0000-7000-9000-00000000d001";
export const INITIATIVE_ID = "01920000-0000-7000-9000-00000000c001";
export const PERIOD_ID = "01920000-0000-7000-9000-00000000e001";

export const v = (value: string, currency: string | null = "SAR", unit = "currency"): DashboardValue => ({
  state: value === "0" ? "zero" : "value",
  value,
  unit,
  currency,
  reasonKey: null,
});
export const unknownV = (reasonKey: string): DashboardValue => ({
  state: "unknown",
  value: null,
  unit: null,
  currency: null,
  reasonKey,
});
export const naV = (reasonKey: string): DashboardValue => ({
  state: "not_applicable",
  value: null,
  unit: "ratio",
  currency: null,
  reasonKey,
});
/** A Stale percentage: a fraction, as the API sends it (ADR-0028 §3; F-DG4-125): 0.42 reads 42 %. */
export const staleV: DashboardValue = {
  state: "stale",
  value: "0.42",
  unit: "%",
  currency: null,
  reasonKey: "kpi.stale",
};

export const filters = (over: Partial<ExecutiveOverview["appliedFilters"]> = {}) => ({
  organizationId: ORG_ID,
  transformationIds: [],
  ownerUserId: null,
  periodId: null,
  periodLabel: null,
  phase: null,
  status: null,
  windowStart: null,
  windowEnd: null,
  asOf: "2026-10-10",
  ...over,
});

const drill = (metric: string, valueClass?: string) =>
  `/api/v1/dashboard-drilldown?metric=${metric}&organizationId=${ORG_ID}${valueClass ? `&valueClass=${valueClass}` : ""}`;

function area(code: T10Area["code"], ordinal: number, over: Partial<T10Area>): T10Area {
  return {
    code,
    ordinal,
    sourceAreaEn: code === "people_adoption" ? "People & adoption" : code[0]!.toUpperCase() + code.slice(1),
    areaAr: `مجال ${ordinal}`,
    sourceWhatToShowEn: `What to show ${code}`,
    whatToShowAr: `ما يُعرض ${ordinal}`,
    sourceRagLogicEn: `RAG logic ${code}`,
    ragLogicAr: `منطق ${ordinal}`,
    arProvisional: true,
    rag: { status: "green", ruleKey: "dashboard.rag.decisions.none_open", ruleParams: {}, policySource: "default" },
    headlines: [],
    items: [],
    ...over,
  };
}

/** Six areas, one per value state: Outcomes Unknown, Value zero, Portfolio n/a, Dependencies stale, Decisions red. */
export function sixAreas(): T10Area[] {
  return [
    area("outcomes", 1, {
      rag: { status: "unknown", ruleKey: "dashboard.rag.outcomes.trajectory", ruleParams: {}, policySource: "default" },
      headlines: [
        {
          metric: "outcomes.area",
          labelKey: "dashboard.headline.outcome_kpis",
          value: unknownV("kpi.no_accepted_actual"),
          period: null,
          drilldownHref: drill("outcomes.area"),
          headlineBasis: null,
        },
      ],
      items: [
        {
          recordType: "outcome_kpi",
          recordId: KPI_ID,
          code: "KPI-01",
          label: "Synthetic churn rate",
          href: `/api/v1/transformations/${TR_ID}/kpi-definitions/${KPI_ID}/status`,
          rag: "unknown",
          dueDate: null,
          value: unknownV("kpi.no_accepted_actual"),
          ownerUserId: USER_ID,
          flags: ["calculated_unknown"],
          valueBasis: null,
        },
      ],
    }),
    area("value", 2, {
      rag: {
        status: "not_applicable",
        ruleKey: "dashboard.rag.value.nothing_due",
        ruleParams: {},
        policySource: "configured",
      },
      headlines: [
        {
          metric: "value.validated",
          labelKey: "dashboard.headline.value_validated_profit_and_cash",
          value: v("0"),
          period: null,
          drilldownHref: drill("value.validated"),
          headlineBasis: "profit_and_cash",
        },
        {
          metric: "value.gap",
          labelKey: "dashboard.headline.value_gap_profit_and_cash",
          value: naV("dashboard.value.nothing_planned"),
          period: null,
          drilldownHref: drill("value.gap"),
          headlineBasis: "profit_and_cash",
        },
      ],
    }),
    area("portfolio", 3, {
      rag: {
        status: "not_applicable",
        ruleKey: "dashboard.rag.portfolio.none",
        ruleParams: {},
        policySource: "default",
      },
    }),
    area("dependencies", 4, {
      rag: {
        status: "stale",
        ruleKey: "dashboard.rag.dependencies.needed_by_critical_path",
        ruleParams: {},
        policySource: "default",
      },
      headlines: [
        {
          metric: "dependencies.open",
          labelKey: "dashboard.headline.open_dependencies",
          value: staleV,
          period: null,
          drilldownHref: drill("dependencies.open"),
          headlineBasis: null,
        },
      ],
    }),
    area("decisions", 5, {
      rag: { status: "red", ruleKey: "dashboard.rag.decisions.overdue", ruleParams: {}, policySource: "default" },
      headlines: [
        {
          metric: "decisions.overdue",
          labelKey: "dashboard.headline.overdue_decisions",
          value: v("1", null, "decision"),
          period: null,
          drilldownHref: drill("decisions.overdue"),
          headlineBasis: null,
        },
      ],
      items: [
        {
          recordType: "executive_decision",
          recordId: DECISION_ID,
          code: "ED-01",
          label: "Synthetic funding ask",
          href: `/api/v1/transformations/${TR_ID}/executive-decisions/${DECISION_ID}`,
          rag: "red",
          dueDate: "2026-10-09",
          value: null,
          ownerUserId: USER_ID,
          flags: ["overdue"],
          valueBasis: null,
        },
      ],
    }),
    area("people_adoption", 6, {
      rag: {
        status: "unknown",
        ruleKey: "dashboard.rag.adoption.no_indicators",
        ruleParams: {},
        policySource: "default",
      },
    }),
  ];
}

export function transformationDashboard(): TransformationDashboard {
  return {
    transformationId: TR_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    timezone: "Asia/Riyadh",
    appliedFilters: filters({ transformationIds: [TR_ID] }),
    areas: sixAreas(),
  };
}

export function executiveOverview(): ExecutiveOverview {
  return {
    organizationId: ORG_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    appliedFilters: filters(),
    transformationCount: 1,
    areas: sixAreas(),
    transformations: [
      {
        transformationId: TR_ID,
        code: "TR-0001",
        name: "Synthetic retail transformation",
        areaStatuses: sixAreas().map((a) => ({ code: a.code, status: a.rag.status })),
      },
    ],
  };
}

export function drilldown(): DashboardDrilldown {
  return {
    metric: "value.validated",
    appliedFilters: filters(),
    value: v("1233.43"),
    period: { start: "2026-01-01", end: "2026-03-31", asOf: "2026-03-31", label: "2026-Q1" },
    calculation: {
      ruleKey: "dashboard.value.gap_ratio",
      expression: "(plannedToDate - validatedToDate) / plannedToDate",
      inputs: [{ name: "validatedToDate", value: v("1233.43"), recordType: null, recordId: null }],
      rounding: null,
    },
    items: [
      {
        recordType: "benefit",
        recordId: BENEFIT_ID,
        code: "BEN-01",
        label: "Synthetic cost saving",
        href: `/api/v1/transformations/${TR_ID}/benefits/${BENEFIT_ID}`,
        value: v("1233.43"),
        period: null,
      },
    ],
    evidence: [
      {
        evidenceId: "01920000-0000-7000-9000-00000000f001",
        title: "Synthetic Finance sign-off",
        verificationStatus: "verified",
        recordType: "benefit_measurement",
        recordId: BENEFIT_ID,
      },
    ],
    nextCursor: null,
    headlineBasis: "profit_and_cash",
    currency: null,
  };
}

export function financeDashboard(): FinanceDashboard {
  return {
    organizationId: ORG_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    appliedFilters: filters(),
    // D-117 (F-DG4-121): gross sums margin uplift, cash saving and working capital release only, so with revenue
    // uplift alone it is a known 0; revenue uplift is shown beside gross, never in it.
    // ADR-0037 amendment K1 item 5 (KBE-R4): every class line drills by its state's metric and `valueClass`; a gross
    // line by its state's metric; a net line keeps null (a derived difference, drilled through its two inputs).
    lines: [
      {
        valueClass: "revenue_uplift",
        state: "planned",
        currency: "SAR",
        total: v("1500"),
        drilldownHref: drill("value.planned", "revenue_uplift"),
      },
      {
        valueClass: "revenue_uplift",
        state: "validated",
        currency: "SAR",
        total: v("900"),
        drilldownHref: drill("value.validated", "revenue_uplift"),
      },
      {
        valueClass: "revenue_uplift",
        state: "rejected",
        currency: "SAR",
        total: v("0"),
        drilldownHref: drill("value.rejected", "revenue_uplift"),
      },
      {
        valueClass: "gross",
        state: "planned",
        currency: "SAR",
        total: v("0"),
        drilldownHref: drill("value.planned"),
      },
      {
        valueClass: "gross",
        state: "validated",
        currency: "SAR",
        total: v("0"),
        drilldownHref: drill("value.validated"),
      },
      {
        valueClass: "net",
        state: "validated",
        currency: "SAR",
        total: unknownV("benefit.cost_amount_missing"),
        drilldownHref: null,
      },
    ],
    headlines: [
      {
        metric: "finance.pending_validation",
        labelKey: "dashboard.finance.pending_validation",
        value: v("1", null, "measurement"),
        period: null,
        drilldownHref: drill("finance.pending_validation"),
        headlineBasis: null,
      },
      {
        metric: "value.investment",
        labelKey: "dashboard.value.investment",
        value: v("400"),
        period: null,
        drilldownHref: drill("value.investment"),
        headlineBasis: null,
      },
    ],
    pendingValidationCount: 1,
    nonFinancialCount: 2,
    transformations: [],
  };
}

/** A header with every element Unknown (no North Star, sponsor, lead, KPI or benefit; the gate port unavailable). */
export function unknownHeader(): WorkspaceHeader {
  return {
    transformationId: TR_ID,
    code: "TR-0001",
    name: "Synthetic retail transformation",
    phase: { currentPhase: "design", mode: "modular", entryPhase: "design" },
    gateReadiness: {
      state: "unknown",
      gateCode: null,
      status: null,
      inheritedApproval: null,
      missingMandatoryCount: null,
      ready: null,
    },
    northStar: { state: "unknown", statement: null, status: null },
    owners: { sponsor: null, lead: null },
    outcomeHealth: {
      rag: { status: "unknown", ruleKey: "dashboard.rag.outcomes.none", ruleParams: {}, policySource: "default" },
      counts: [],
    },
    benefits: { state: "unknown", planned: [], validated: [], benefitCount: 0, nonFinancialCount: 0, headlines: [] },
    keyDecisions: { items: [], overdueCount: 0 },
    nextActions: { items: [], missingMandatoryCount: null },
  };
}

export function knownHeader(): WorkspaceHeader {
  return {
    ...unknownHeader(),
    phase: { currentPhase: "define", mode: "end_to_end", entryPhase: null },
    gateReadiness: {
      state: "known",
      gateCode: "G2",
      status: "not_submitted",
      inheritedApproval: null,
      missingMandatoryCount: 3,
      ready: false,
    },
    northStar: { state: "known", statement: "Synthetic: the simplest telco to do business with", status: "current" },
    owners: { sponsor: { userId: USER_ID, displayName: "Synthetic Sponsor" }, lead: null },
    benefits: {
      state: "known",
      planned: [{ currency: "SAR", value: v("1000") }],
      validated: [{ currency: "SAR", value: v("0") }],
      benefitCount: 1,
      nonFinancialCount: 1,
      headlines: [],
    },
    keyDecisions: {
      items: [sixAreas()[4]!.items[0]!],
      overdueCount: 1,
    },
  };
}

export function myWork(): MyWork {
  const kpiItem = {
    section: "missing_updates" as const,
    source: "work_item" as const,
    recordType: "work_item",
    recordId: "01920000-0000-7000-9000-0000000aa001",
    kind: "kpi_update_due",
    code: "2026-05",
    label: null,
    messageKey: "kpi.update_due",
    messageParams: { kpiName: "Synthetic churn rate", periodLabel: "2026-05" },
    transformationId: TR_ID,
    href: `/transformations/${TR_ID}/kpis/${KPI_ID}/actuals`,
    dueDate: "2026-06-10",
    overdue: true,
  };
  const draft = {
    section: "drafts" as const,
    source: "draft" as const,
    recordType: "business_case",
    recordId: "01920000-0000-7000-9000-0000000bb001",
    kind: null,
    code: "BC-01",
    label: "Synthetic case",
    messageKey: null,
    messageParams: null,
    transformationId: TR_ID,
    href: `/api/v1/business-cases/01920000-0000-7000-9000-0000000bb001`,
    dueDate: null,
    overdue: false,
  };
  const sections = (["assigned_actions", "drafts", "reviews", "approvals", "missing_updates", "other"] as const).map(
    (s) => ({
      section: s,
      total: s === "missing_updates" || s === "drafts" ? 1 : 0,
      items: s === "missing_updates" ? [kpiItem] : s === "drafts" ? [draft] : [],
      nextCursor: null,
    }),
  );
  return {
    userId: USER_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    horizonWorkingDays: 10,
    sections,
    upcomingDeadlines: [kpiItem],
  };
}

export { PERIOD_ID as SYN_PERIOD_ID, INITIATIVE_ID as SYN_INITIATIVE_ID };

/**
 * The F-DG4-121 reproduction (domain round 1, DOM-GROSS) as the D-117 rule computes it: planned revenue uplift 300,
 * margin uplift 70, cash saving 20, avoided cost 45 SAR; gross = 90 (profit and cash classes), net = 90 − 0 = 90.
 * SYNTHETIC.
 */
export function grossBasisFinanceDashboard(): FinanceDashboard {
  const base = financeDashboard();
  const cls = (valueClass: string, state: "planned" | "validated", value: string) => ({
    valueClass,
    state,
    currency: "SAR",
    total: v(value),
    drilldownHref: drill(`value.${state}`, valueClass),
  });
  return {
    ...base,
    lines: [
      cls("revenue_uplift", "planned", "300"),
      cls("margin_uplift", "planned", "70"),
      cls("cash_saving", "planned", "20"),
      cls("avoided_cost", "planned", "45"),
      cls("revenue_uplift", "validated", "0"),
      { valueClass: "gross", state: "planned", currency: "SAR", total: v("90"), drilldownHref: drill("value.planned") },
      {
        valueClass: "gross",
        state: "validated",
        currency: "SAR",
        total: v("0"),
        drilldownHref: drill("value.validated"),
      },
      { valueClass: "net", state: "planned", currency: "SAR", total: v("90"), drilldownHref: null },
      { valueClass: "net", state: "validated", currency: "SAR", total: v("0"), drilldownHref: null },
    ],
  };
}

// ------------------------------------------------------------------------------------------------ D-119 (F-DG4-122/123)

/**
 * The value headlines of ADR-0037 / ADR-0030 amendment N3 (D-119) for the domain reviewer's world (F-DG4-122/123):
 * planned revenue uplift 300, margin uplift 70, cash saving 20 and avoided cost 45 SAR, nothing validated. The
 * profit-and-cash planned value is 90 (= 70 + 20), the top-line 300 and the non-cash 45 sit beside it; the value gap is
 * the ratio 1 (unit `ratio`, carrying the block's currency, exactly as the API sends it), so it reads "100 %".
 * Variant "na" (no margin uplift or cash saving benefit): every profit-and-cash headline and the gap are n/a with
 * `dashboard.value.no_profit_and_cash_benefit`; top line and non-cash are still shown. SYNTHETIC; 435 is nowhere.
 */
export type D119Variant = "main" | "na";

type Headline = T10Area["headlines"][number];
const hl = (
  metric: "value.planned" | "value.validated" | "value.gap",
  basis: "profit_and_cash" | "top_line" | "non_cash",
  value: DashboardValue,
): Headline => {
  const state = metric.slice("value.".length);
  const valueClass = basis === "top_line" ? "revenue_uplift" : basis === "non_cash" ? "avoided_cost" : undefined;
  return {
    metric,
    labelKey: `dashboard.headline.value_${state}_${basis}`,
    value,
    period: null,
    drilldownHref: drill(metric, valueClass),
    headlineBasis: basis,
  };
};
const naPc = (unit: string): DashboardValue => ({
  state: "not_applicable",
  value: null,
  unit,
  currency: null,
  reasonKey: "dashboard.value.no_profit_and_cash_benefit",
});

export function d119Headlines(variant: D119Variant = "main"): Headline[] {
  const pc =
    variant === "main"
      ? [
          hl("value.planned", "profit_and_cash", v("90")),
          hl("value.validated", "profit_and_cash", v("0")),
          hl("value.gap", "profit_and_cash", v("1", "SAR", "ratio")),
        ]
      : [
          hl("value.planned", "profit_and_cash", naPc("currency")),
          hl("value.validated", "profit_and_cash", naPc("currency")),
          hl("value.gap", "profit_and_cash", naPc("ratio")),
        ];
  return [
    ...pc,
    hl("value.planned", "top_line", v("300")),
    hl("value.validated", "top_line", v("0")),
    hl("value.planned", "non_cash", v("45")),
    hl("value.validated", "non_cash", v("0")),
  ];
}

function d119ValueArea(variant: D119Variant): T10Area {
  const base = sixAreas()[1]!;
  return {
    ...base,
    rag:
      variant === "main"
        ? {
            status: "red",
            ruleKey: "dashboard.rag.value.validated_gap",
            // ADR-0037 amendment N4 item 1: one line per basis and currency, never summed; the status is the worst.
            ruleParams: {
              amberRatio: "0.05",
              redRatio: "0.15",
              lines: [
                { currency: "SAR", headlineBasis: "profit_and_cash", gapRatio: "1", status: "red", reasonKey: null },
                { currency: "SAR", headlineBasis: "top_line", gapRatio: "1", status: "red", reasonKey: null },
                { currency: "SAR", headlineBasis: "non_cash", gapRatio: "1", status: "red", reasonKey: null },
              ],
            },
            policySource: "default",
          }
        : {
            status: "not_applicable",
            ruleKey: "dashboard.rag.value.no_profit_and_cash_benefit",
            ruleParams: {},
            policySource: "default",
          },
    headlines: d119Headlines(variant),
  };
}

const withValueArea = (areas: T10Area[], variant: D119Variant) =>
  areas.map((a) => (a.code === "value" ? d119ValueArea(variant) : a));

export function d119TransformationDashboard(variant: D119Variant = "main"): TransformationDashboard {
  const d = transformationDashboard();
  return { ...d, areas: withValueArea(d.areas, variant) };
}

export function d119ExecutiveOverview(variant: D119Variant = "main"): ExecutiveOverview {
  const d = executiveOverview();
  const areas = withValueArea(d.areas, variant);
  return {
    ...d,
    areas,
    transformations: d.transformations.map((r) => ({
      ...r,
      areaStatuses: areas.map((a) => ({ code: a.code, status: a.rag.status })),
    })),
  };
}

export function d119FinanceDashboard(variant: D119Variant = "main"): FinanceDashboard {
  const base = grossBasisFinanceDashboard();
  return { ...base, headlines: [...d119Headlines(variant), ...base.headlines] };
}

export function d119Header(variant: D119Variant = "main"): WorkspaceHeader {
  const h = knownHeader();
  const all = d119Headlines(variant).filter((x) => x.metric !== "value.gap");
  return {
    ...h,
    benefits: {
      ...h.benefits,
      planned: [{ currency: "SAR", value: variant === "main" ? v("90") : naPc("currency") }],
      validated: [{ currency: "SAR", value: variant === "main" ? v("0") : naPc("currency") }],
      benefitCount: variant === "main" ? 4 : 2,
      headlines: all,
    },
  };
}

/** The drill-down of a headline of the given basis (the contract's `headlineBasis` member). */
export function d119Drilldown(basis: "profit_and_cash" | "top_line" | "non_cash"): DashboardDrilldown {
  const amount = basis === "profit_and_cash" ? "90" : basis === "top_line" ? "300" : "45";
  const d = drilldown();
  return {
    ...d,
    metric: "value.planned",
    value: v(amount),
    calculation: { ruleKey: `dashboard.value.sum_planned_${basis}`, expression: null, inputs: [], rounding: null },
    headlineBasis: basis,
  };
}

// ------------------------------------------------------------------------------------------------ D-122 (F-DG4-126/127)

/**
 * ADR-0037 amendment N4 (D-122), the round-3 domain reviewer's R3-6a world as ARCH-R6 §4.3 computes it: margin uplift
 * 70 planned and validated 70; revenue uplift 300 planned, nothing validated (SAR). The profit-and-cash gap is 0
 * (Green), the top-line gap is 1 (Red), and the Value RAG is the worst: Red. A single cross-basis gap would be
 * 300 / 370 = 81 %; it is never computed or shown. The Portfolio area is ARCH-R6's ranking world: INI-B (margin 70)
 * first, INI-A (revenue uplift only) `not_applicable` with its reason, INI-C (nothing allocated) Unknown. SYNTHETIC.
 */
export const N4_INI = {
  b: "01920000-0000-7000-9000-0000000c0b01",
  a: "01920000-0000-7000-9000-0000000c0a01",
  c: "01920000-0000-7000-9000-0000000c0c01",
} as const;

const drillN4 = (metric: string, valueClass: string | null, currency: string | null) =>
  `${drill(metric, valueClass ?? undefined)}${currency ? `&currency=${currency}` : ""}`;

export function n4ValueHeadlines(): Headline[] {
  const h = (
    metric: "value.planned" | "value.validated" | "value.gap",
    basis: "profit_and_cash" | "top_line",
    value: DashboardValue,
  ): Headline => ({
    ...hl(metric, basis, value),
    drilldownHref: drillN4(metric, basis === "top_line" ? "revenue_uplift" : null, "SAR"),
  });
  return [
    h("value.planned", "profit_and_cash", v("70")),
    h("value.validated", "profit_and_cash", v("70")),
    h("value.gap", "profit_and_cash", v("0", "SAR", "ratio")),
    h("value.planned", "top_line", v("300")),
    h("value.validated", "top_line", v("0")),
    h("value.gap", "top_line", v("1", "SAR", "ratio")),
  ];
}

export const N4_VALUE_RAG: T10Area["rag"] = {
  status: "red",
  ruleKey: "dashboard.rag.value.validated_gap",
  ruleParams: {
    amberRatio: "0.05",
    redRatio: "0.15",
    lines: [
      { currency: "SAR", headlineBasis: "profit_and_cash", gapRatio: "0", status: "green", reasonKey: null },
      { currency: "SAR", headlineBasis: "top_line", gapRatio: "1", status: "red", reasonKey: null },
    ],
  },
  policySource: "default",
};

const initiative = (id: string, code: string, label: string, value: DashboardValue): DashboardItem => ({
  recordType: "initiative",
  recordId: id,
  code,
  label,
  href: `/api/v1/initiatives/${id}`,
  rag: "green",
  dueDate: null,
  value,
  ownerUserId: USER_ID,
  flags: [],
  valueBasis: "profit_and_cash",
});

export function n4PortfolioItems(): DashboardItem[] {
  return [
    initiative(N4_INI.b, "INI-B", "Synthetic margin initiative", v("70")),
    initiative(N4_INI.a, "INI-A", "Synthetic revenue initiative", {
      state: "not_applicable",
      value: null,
      unit: "currency",
      currency: "SAR",
      reasonKey: "dashboard.portfolio.no_profit_and_cash_allocation",
    }),
    initiative(N4_INI.c, "INI-C", "Synthetic unallocated initiative", {
      state: "unknown",
      value: null,
      unit: "currency",
      currency: null,
      reasonKey: "dashboard.portfolio.no_allocated_value",
    }),
  ];
}

function n4Areas(): T10Area[] {
  return sixAreas().map((a) =>
    a.code === "value"
      ? { ...a, rag: N4_VALUE_RAG, headlines: n4ValueHeadlines() }
      : a.code === "portfolio"
        ? {
            ...a,
            rag: {
              status: "green",
              ruleKey: "dashboard.rag.portfolio.milestone_outcome",
              ruleParams: {},
              policySource: "default",
            },
            items: n4PortfolioItems(),
          }
        : a,
  );
}

export function n4TransformationDashboard(): TransformationDashboard {
  return { ...transformationDashboard(), areas: n4Areas() };
}

export function n4ExecutiveOverview(): ExecutiveOverview {
  const areas = n4Areas();
  const d = executiveOverview();
  return {
    ...d,
    areas,
    transformations: d.transformations.map((r) => ({
      ...r,
      areaStatuses: areas.map((a) => ({ code: a.code, status: a.rag.status })),
    })),
  };
}

export function n4FinanceDashboard(): FinanceDashboard {
  const base = financeDashboard();
  return { ...base, headlines: [...n4ValueHeadlines(), ...base.headlines] };
}

/** The top-line gap drill-down of R3-6a (ARCH-R6 §4.3): basis top line, SAR, the ratio 1, the revenue planned line. */
export function n4TopLineGapDrilldown(): DashboardDrilldown {
  const d = drilldown();
  return {
    ...d,
    metric: "value.gap",
    value: v("1", "SAR", "ratio"),
    calculation: {
      ruleKey: "dashboard.value.gap_ratio_top_line",
      expression: "(plannedToDate - validatedToDate) / plannedToDate",
      inputs: [
        { name: "planned_SAR", value: v("300"), recordType: null, recordId: null },
        { name: "validated_SAR", value: v("0"), recordType: null, recordId: null },
      ],
      rounding: null,
    },
    items: [{ ...d.items[0]!, code: "BEN-02", label: "Synthetic revenue uplift", value: v("300") }],
    headlineBasis: "top_line",
    currency: "SAR",
  };
}
