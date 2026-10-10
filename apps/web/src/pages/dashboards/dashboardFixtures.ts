// SYNTHETIC slice J responses for the dashboard, header and My Work tests (T-DG4-FE-G). Shapes follow the zod mirrors
// in packages/shared/src/schemas/dashboards.ts (OpenAPI 1.3.0-p4). No figure here is real data.
import type {
  DashboardDrilldown,
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
export const staleV: DashboardValue = {
  state: "stale",
  value: "42",
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
          labelKey: "dashboard.headline.value_validated",
          value: v("0"),
          period: null,
          drilldownHref: drill("value.validated"),
        },
        {
          metric: "value.gap",
          labelKey: "dashboard.headline.value_gap",
          value: naV("dashboard.value.nothing_planned"),
          period: null,
          drilldownHref: drill("value.gap"),
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
  };
}

export function financeDashboard(): FinanceDashboard {
  return {
    organizationId: ORG_ID,
    generatedAt: T0,
    businessDate: "2026-10-10",
    appliedFilters: filters(),
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
        total: v("1500"),
        drilldownHref: drill("value.planned"),
      },
      {
        valueClass: "gross",
        state: "validated",
        currency: "SAR",
        total: v("900"),
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
      },
      {
        metric: "value.investment",
        labelKey: "dashboard.value.investment",
        value: v("400"),
        period: null,
        drilldownHref: drill("value.investment"),
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
    benefits: { state: "unknown", planned: [], validated: [], benefitCount: 0, nonFinancialCount: 0 },
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
