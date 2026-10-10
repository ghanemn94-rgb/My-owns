// P4 slice J mirrors of KBE-G (kpi-benefits-engineer, T-DG4-KBE-G; ADR-0037; p4-work-split §J+K JK.4; OpenAPI 1.3.0-p4
// T10Area, DashboardValue, DashboardHeadline, DashboardItem, DashboardFilters, TransformationDashboard,
// ExecutiveOverview, WorkstreamDashboard, DashboardDrilldown, DashboardRagPolicy*). REQ-PB-062, REQ-PB-063, REQ-PB-064,
// REQ-S03-009, REQ-S13-001 (executive, transformation, workstream), REQ-S13-002, REQ-S13-003.
//
// - Dashboards are read models computed on every request; nothing here stores a figure or a RAG status.
// - Every amount, ratio and KPI value is a decimal string (never a JSON number). Unknown, Stale and not_applicable are
//   states with a reason key; they are never 0 and never green (M0159).
// - The default T10 thresholds (DASHBOARD_RAG_DEFAULTS) are ADR-0037 §3's labelled interpretation (D-106 (a)): no
//   source gives them, so they are defaults an organization can configure, and every response names its policySource.
// - Product gates G1-G6 are business approvals inside the product; nothing here reads or writes DG0-DG7.
import { Decimal } from "decimal.js";
import { z } from "zod";
import { PHASES, TRANSFORMATION_STATUSES } from "../constants.ts";
import { freeText, timestamp, uuid } from "./common.ts";
import { gateInheritedApproval } from "./gate.ts";
import { businessDate, decimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();

// ------------------------------------------------------------------------------------------------ enums

/** OpenAPI `RagStatus` (ADR-0037 §3). */
export const RAG_STATUSES = ["green", "amber", "red", "unknown", "stale", "not_applicable"] as const;
export type RagStatus = (typeof RAG_STATUSES)[number];
export const ragStatus = z.enum(RAG_STATUSES);

/** OpenAPI `T10AreaCode`, in Template 10 order (B0095). */
export const T10_AREA_CODES = [
  "outcomes",
  "value",
  "portfolio",
  "dependencies",
  "decisions",
  "people_adoption",
] as const;
export type T10AreaCode = (typeof T10_AREA_CODES)[number];
export const t10AreaCode = z.enum(T10_AREA_CODES);

/** OpenAPI `DashboardMetric` (ADR-0037 §5). */
export const DASHBOARD_METRICS = [
  "outcomes.kpi_status",
  "outcomes.area",
  "value.planned",
  "value.forecast",
  "value.validated",
  "value.submitted",
  "value.investment",
  "value.gap",
  "portfolio.initiatives",
  "dependencies.open",
  "decisions.open",
  "decisions.overdue",
  "adoption.indicators",
  "finance.pending_validation",
] as const;
export type DashboardMetric = (typeof DASHBOARD_METRICS)[number];
export const dashboardMetric = z.enum(DASHBOARD_METRICS);

/** OpenAPI `DashboardValue.state` (ADR-0037 §5): value and zero are known; unknown and not_applicable carry no value. */
export const DASHBOARD_VALUE_STATES = ["value", "zero", "unknown", "stale", "not_applicable"] as const;
export type DashboardValueState = (typeof DASHBOARD_VALUE_STATES)[number];

// ------------------------------------------------------------------------------------------------ shapes

/** OpenAPI `DashboardValue`. */
export const dashboardValue = z.strictObject({
  state: z.enum(DASHBOARD_VALUE_STATES),
  value: decimal.nullable(),
  unit: z.string().nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  reasonKey: z.string().nullable(),
});
export type DashboardValue = z.infer<typeof dashboardValue>;

/** OpenAPI `DashboardPeriod`. */
export const dashboardPeriod = z.strictObject({
  start: nullableDate,
  end: nullableDate,
  asOf: businessDate,
  label: z.string().nullable(),
});
export type DashboardPeriod = z.infer<typeof dashboardPeriod>;

/** OpenAPI `DashboardRag`. */
export const dashboardRag = z.strictObject({
  status: ragStatus,
  ruleKey: z.string(),
  ruleParams: z.record(z.string(), z.unknown()),
  policySource: z.enum(["default", "configured"]),
});
export type DashboardRag = z.infer<typeof dashboardRag>;

/** OpenAPI `DashboardHeadline`. */
export const dashboardHeadline = z.strictObject({
  metric: dashboardMetric,
  labelKey: z.string(),
  value: dashboardValue,
  period: dashboardPeriod.nullable(),
  drilldownHref: z.string(),
});
export type DashboardHeadline = z.infer<typeof dashboardHeadline>;

/** OpenAPI `DashboardItem`. */
export const dashboardItem = z.strictObject({
  recordType: z.string(),
  recordId: uuid,
  code: z.string().nullable(),
  label: z.string().nullable(),
  href: z.string(),
  rag: ragStatus.nullable(),
  dueDate: nullableDate,
  value: dashboardValue.nullable(),
  ownerUserId: nullableUuid,
  flags: z.array(z.string()),
});
export type DashboardItem = z.infer<typeof dashboardItem>;

/** OpenAPI `T10Area`. */
export const t10Area = z.strictObject({
  code: t10AreaCode,
  ordinal: z.number().int().min(1).max(6),
  sourceAreaEn: z.string(),
  areaAr: z.string(),
  sourceWhatToShowEn: z.string(),
  whatToShowAr: z.string(),
  sourceRagLogicEn: z.string(),
  ragLogicAr: z.string(),
  arProvisional: z.boolean(),
  rag: dashboardRag,
  headlines: z.array(dashboardHeadline),
  items: z.array(dashboardItem),
});
export type T10Area = z.infer<typeof t10Area>;

/** OpenAPI `DashboardFilters`. */
export const dashboardFilters = z.strictObject({
  organizationId: uuid,
  transformationIds: z.array(uuid),
  ownerUserId: nullableUuid,
  periodId: nullableUuid,
  periodLabel: z.string().nullable(),
  phase: z.enum(PHASES).nullable(),
  status: z.enum(TRANSFORMATION_STATUSES).nullable(),
  windowStart: nullableDate,
  windowEnd: nullableDate,
  asOf: businessDate,
});
export type DashboardFilters = z.infer<typeof dashboardFilters>;

/** OpenAPI `AreaStatus`. */
export const areaStatus = z.strictObject({ code: t10AreaCode, status: ragStatus });

/** OpenAPI `DashboardTransformationRow`. */
export const dashboardTransformationRow = z.strictObject({
  transformationId: uuid,
  code: z.string(),
  name: z.string(),
  areaStatuses: z.array(areaStatus),
});
export type DashboardTransformationRow = z.infer<typeof dashboardTransformationRow>;

const sixAreas = z.array(t10Area).min(6).max(6);

/** OpenAPI `TransformationDashboard`. */
export const transformationDashboard = z.strictObject({
  transformationId: uuid,
  generatedAt: timestamp,
  businessDate,
  timezone: z.string(),
  appliedFilters: dashboardFilters,
  areas: sixAreas,
});
export type TransformationDashboard = z.infer<typeof transformationDashboard>;

/** OpenAPI `ExecutiveOverview` (= the executive dashboard, ADR-0037 §2, §8; D-106 (c)). */
export const executiveOverview = z.strictObject({
  organizationId: uuid,
  generatedAt: timestamp,
  businessDate,
  appliedFilters: dashboardFilters,
  transformationCount: z.number().int().min(0),
  areas: sixAreas,
  transformations: z.array(dashboardTransformationRow),
});
export type ExecutiveOverview = z.infer<typeof executiveOverview>;

/** OpenAPI `WorkstreamDashboard`. */
export const workstreamDashboard = z.strictObject({
  workstreamId: uuid,
  transformationId: uuid,
  code: z.string(),
  name: z.string(),
  generatedAt: timestamp,
  businessDate,
  appliedFilters: dashboardFilters,
  areas: sixAreas,
});
export type WorkstreamDashboard = z.infer<typeof workstreamDashboard>;

/** OpenAPI `DrilldownItem`. */
export const drilldownItem = z.strictObject({
  recordType: z.string(),
  recordId: uuid,
  code: z.string().nullable(),
  label: z.string().nullable(),
  href: z.string(),
  value: dashboardValue.nullable(),
  period: dashboardPeriod.nullable(),
});
export type DrilldownItem = z.infer<typeof drilldownItem>;

/** OpenAPI `DrilldownInput`. */
export const drilldownInput = z.strictObject({
  name: z.string(),
  value: dashboardValue,
  recordType: z.string().nullable(),
  recordId: nullableUuid,
});
export type DrilldownInput = z.infer<typeof drilldownInput>;

/** OpenAPI `DrilldownEvidence`. */
export const drilldownEvidence = z.strictObject({
  evidenceId: uuid,
  title: z.string(),
  verificationStatus: z.string(),
  recordType: z.string(),
  recordId: uuid,
});
export type DrilldownEvidence = z.infer<typeof drilldownEvidence>;

/** OpenAPI `DrilldownCalculation`. */
export const drilldownCalculation = z.strictObject({
  ruleKey: z.string(),
  expression: z.string().nullable(),
  inputs: z.array(drilldownInput),
  rounding: z.record(z.string(), z.unknown()).nullable(),
});

/** OpenAPI `DashboardDrilldown`. */
export const dashboardDrilldown = z.strictObject({
  metric: dashboardMetric,
  appliedFilters: dashboardFilters,
  value: dashboardValue,
  period: dashboardPeriod.nullable(),
  calculation: drilldownCalculation,
  items: z.array(drilldownItem),
  evidence: z.array(drilldownEvidence),
  nextCursor: z.string().nullable(),
});
export type DashboardDrilldown = z.infer<typeof dashboardDrilldown>;

// ------------------------------------------------------------------------------------------------ RAG policy

/**
 * The documented defaults of ADR-0037 §3 (D-106 (a): labelled defaults, configurable). Ratios are decimal fractions
 * (0.05 = 5 %), never floats; working days use the organization's business calendar.
 */
export const DASHBOARD_RAG_DEFAULTS = Object.freeze({
  valueGapAmberRatio: "0.05",
  valueGapRedRatio: "0.15",
  milestoneSlipAmberWorkingDays: 1,
  milestoneSlipRedWorkingDays: 10,
  dependencyDueSoonWorkingDays: 10,
  decisionDueSoonWorkingDays: 3,
  topInitiativeCount: 10,
  deadlineHorizonWorkingDays: 10,
});

/** OpenAPI `DashboardRagPolicyValues` (the effective thresholds). */
export const dashboardRagPolicyValues = z.strictObject({
  valueGapAmberRatio: decimal,
  valueGapRedRatio: decimal,
  milestoneSlipAmberWorkingDays: z.number().int().min(0).max(250),
  milestoneSlipRedWorkingDays: z.number().int().min(0).max(250),
  dependencyDueSoonWorkingDays: z.number().int().min(0).max(250),
  decisionDueSoonWorkingDays: z.number().int().min(0).max(250),
  topInitiativeCount: z.number().int().min(1).max(50),
  deadlineHorizonWorkingDays: z.number().int().min(1).max(250),
});
export type DashboardRagPolicyValues = z.infer<typeof dashboardRagPolicyValues>;

/** OpenAPI `DashboardRagPolicy` (version 0 and null stamps when none is configured). */
export const dashboardRagPolicy = z.strictObject({
  organizationId: uuid,
  policySource: z.enum(["default", "configured"]),
  valueGapAmberRatio: decimal.nullable(),
  valueGapRedRatio: decimal.nullable(),
  milestoneSlipAmberWorkingDays: z.number().int().min(0).max(250).nullable(),
  milestoneSlipRedWorkingDays: z.number().int().min(0).max(250).nullable(),
  dependencyDueSoonWorkingDays: z.number().int().min(0).max(250).nullable(),
  decisionDueSoonWorkingDays: z.number().int().min(0).max(250).nullable(),
  topInitiativeCount: z.number().int().min(1).max(50).nullable(),
  deadlineHorizonWorkingDays: z.number().int().min(1).max(250).nullable(),
  note: z.string().nullable(),
  effective: dashboardRagPolicyValues,
  version: z.number().int().min(0),
  updatedAt: timestamp.nullable(),
  updatedBy: nullableUuid,
});
export type DashboardRagPolicy = z.infer<typeof dashboardRagPolicy>;

/** A ratio 0..1 with at most 6 fraction digits (numeric(9,6)); outside it is a 400 validation (ADR-0037 §13). */
export function dashboardRatioInRange(value: string): boolean {
  if (!/^[0-9](\.[0-9]{1,6})?$/.test(value)) return false;
  const d = new Decimal(value);
  return d.gte(0) && d.lte(1);
}

const ratio = decimal.refine(dashboardRatioInRange, "validation.ratio_range");
const days = z.number().int().min(0).max(250);

/** OpenAPI `DashboardRagPolicyUpdate`. A member left out keeps its stored value; null means "use the default". */
export const dashboardRagPolicyUpdate = z.strictObject({
  valueGapAmberRatio: ratio.nullable().optional(),
  valueGapRedRatio: ratio.nullable().optional(),
  milestoneSlipAmberWorkingDays: days.nullable().optional(),
  milestoneSlipRedWorkingDays: days.nullable().optional(),
  dependencyDueSoonWorkingDays: days.nullable().optional(),
  decisionDueSoonWorkingDays: days.nullable().optional(),
  topInitiativeCount: z.number().int().min(1).max(50).nullable().optional(),
  deadlineHorizonWorkingDays: z.number().int().min(1).max(250).nullable().optional(),
  note: freeText(1, 2000).nullable().optional(),
});
export type DashboardRagPolicyUpdate = z.infer<typeof dashboardRagPolicyUpdate>;

// ------------------------------------------------------------------------------------------------ refusals (S-11)

/** The exact English texts of ADR-0037 §13 (problem `code`s are i18n keys; the web translates them). */
export const DASHBOARD_REFUSALS = {
  "dashboard.period_not_found": "The reporting period does not exist in this organization.",
  "dashboard.owner_not_found": "The owner is not a user of this organization.",
  "dashboard.metric_subject_mismatch": "This drill-down needs a record of the kind the metric is about.",
  "dashboard.workstream_archived": "This workstream is archived; open its transformation's dashboard instead.",
  "dashboard_rag_policy.threshold_order": "The amber threshold cannot be beyond the red threshold.",
} as const;
export type DashboardRefusalCode = keyof typeof DASHBOARD_REFUSALS;

// ------------------------------------------------------------------------------------------------ KBE-G2 shapes

// P4 slice J mirrors of KBE-G2 (kpi-benefits-engineer, T-DG4-KBE-G2; ADR-0037 §2, §7, §9; p4-work-split §J+K JK.5;
// OpenAPI 1.3.0-p4 FinanceValueLine, FinanceDashboard, AdoptionIndicatorRow, AdoptionDashboard, MyWorkSection,
// MyWorkItem, MyWorkSectionPage, MyWork, UserRef, CurrencyValue, WorkspaceHeader). REQ-S03-008, REQ-S03-011,
// REQ-S13-001 (Finance, adoption and personal work dashboards). Read models only: nothing here is stored.

/** The value states of a Finance line (ADR-0030 §6): a total is always for ONE state, never states added together. */
export const FINANCE_LINE_STATES = [
  "planned",
  "forecast",
  "measured",
  "submitted",
  "validated",
  "rejected",
  "sustained",
] as const;
export type FinanceLineState = (typeof FINANCE_LINE_STATES)[number];

const currencyCode = z.string().regex(/^[A-Z]{3}$/);

/** OpenAPI `FinanceValueLine`. */
export const financeValueLine = z.strictObject({
  valueClass: z.string(),
  state: z.enum(FINANCE_LINE_STATES),
  currency: currencyCode,
  total: dashboardValue,
  drilldownHref: z.string().nullable(),
});
export type FinanceValueLine = z.infer<typeof financeValueLine>;

/** OpenAPI `FinanceDashboard`. */
export const financeDashboard = z.strictObject({
  organizationId: uuid,
  generatedAt: timestamp,
  businessDate,
  appliedFilters: dashboardFilters,
  lines: z.array(financeValueLine),
  headlines: z.array(dashboardHeadline),
  pendingValidationCount: z.number().int().min(0),
  nonFinancialCount: z.number().int().min(0),
  transformations: z.array(dashboardTransformationRow),
});
export type FinanceDashboard = z.infer<typeof financeDashboard>;

/** OpenAPI `AdoptionIndicatorRow`. */
export const adoptionIndicatorRow = z.strictObject({
  kpiDefinitionId: uuid,
  templateKey: z.string(),
  targetKind: z.string(),
  targetId: nullableUuid,
  rag: ragStatus,
  value: dashboardValue,
  drilldownHref: z.string(),
});
export type AdoptionIndicatorRow = z.infer<typeof adoptionIndicatorRow>;

/** OpenAPI `AdoptionDashboard`. */
export const adoptionDashboard = z.strictObject({
  organizationId: uuid,
  generatedAt: timestamp,
  businessDate,
  appliedFilters: dashboardFilters,
  area: t10Area,
  indicators: z.array(adoptionIndicatorRow),
  openInterventionCount: z.number().int().min(0),
  transformations: z.array(dashboardTransformationRow),
});
export type AdoptionDashboard = z.infer<typeof adoptionDashboard>;

/** OpenAPI `MyWorkSection` (M0100; ADR-0037 §7), in display order. */
export const MY_WORK_SECTIONS = [
  "assigned_actions",
  "drafts",
  "reviews",
  "approvals",
  "missing_updates",
  "other",
] as const;
export type MyWorkSection = (typeof MY_WORK_SECTIONS)[number];
export const myWorkSection = z.enum(MY_WORK_SECTIONS);

/** OpenAPI `MyWorkItem`. */
export const myWorkItem = z.strictObject({
  section: myWorkSection,
  source: z.enum(["work_item", "action_item", "draft"]),
  recordType: z.string(),
  recordId: uuid,
  kind: z.string().nullable(),
  code: z.string().nullable(),
  label: z.string().nullable(),
  messageKey: z.string().nullable(),
  messageParams: z.record(z.string(), z.unknown()).nullable(),
  transformationId: nullableUuid,
  href: z.string(),
  dueDate: nullableDate,
  overdue: z.boolean(),
});
export type MyWorkItem = z.infer<typeof myWorkItem>;

/** OpenAPI `MyWorkSectionPage`. */
export const myWorkSectionPage = z.strictObject({
  section: myWorkSection,
  total: z.number().int().min(0),
  items: z.array(myWorkItem),
  nextCursor: z.string().nullable(),
});
export type MyWorkSectionPage = z.infer<typeof myWorkSectionPage>;

/** OpenAPI `MyWork` (the caller's own items only). */
export const myWork = z.strictObject({
  userId: uuid,
  generatedAt: timestamp,
  businessDate,
  horizonWorkingDays: z.number().int().min(1),
  sections: z.array(myWorkSectionPage),
  upcomingDeadlines: z.array(myWorkItem),
});
export type MyWork = z.infer<typeof myWork>;

/** OpenAPI `UserRef`. */
export const userRef = z.strictObject({ userId: uuid, displayName: z.string() });
export type UserRef = z.infer<typeof userRef>;

/** OpenAPI `CurrencyValue`. */
export const currencyValue = z.strictObject({ currency: currencyCode, value: dashboardValue });
export type CurrencyValue = z.infer<typeof currencyValue>;

/** The live gate readiness `WorkflowsReadPort.gateReadiness` returns (ADR-0037 §1 item 3, §9). */
export interface WorkspaceGateReadiness {
  readonly gateCode: string;
  readonly status: string;
  readonly inheritedApproval: z.infer<typeof gateInheritedApproval> | null;
  readonly missingMandatoryCount: number;
  readonly ready: boolean;
}

const knownOrUnknown = z.enum(["known", "unknown"]);

/** OpenAPI `WorkspaceHeader`: the eight elements of M0114, each with an explicit Unknown (REQ-S03-011). */
export const workspaceHeader = z.strictObject({
  transformationId: uuid,
  code: z.string(),
  name: z.string(),
  phase: z.strictObject({
    currentPhase: z.enum(PHASES),
    mode: z.enum(["end_to_end", "modular"]),
    entryPhase: z.enum(PHASES).nullable(),
  }),
  gateReadiness: z.strictObject({
    state: knownOrUnknown,
    gateCode: z.string().nullable(),
    status: z.string().nullable(),
    inheritedApproval: gateInheritedApproval.nullable(),
    missingMandatoryCount: z.number().int().min(0).nullable(),
    ready: z.boolean().nullable(),
  }),
  northStar: z.strictObject({
    state: knownOrUnknown,
    statement: z.string().nullable(),
    status: z.string().nullable(),
  }),
  owners: z.strictObject({ sponsor: userRef.nullable(), lead: userRef.nullable() }),
  outcomeHealth: z.strictObject({
    rag: dashboardRag,
    counts: z.array(z.strictObject({ status: ragStatus, count: z.number().int().min(0) })),
  }),
  benefits: z.strictObject({
    state: knownOrUnknown,
    planned: z.array(currencyValue),
    validated: z.array(currencyValue),
    benefitCount: z.number().int().min(0),
    nonFinancialCount: z.number().int().min(0),
  }),
  keyDecisions: z.strictObject({ items: z.array(dashboardItem).max(5), overdueCount: z.number().int().min(0) }),
  nextActions: z.strictObject({
    items: z.array(myWorkItem).max(5),
    missingMandatoryCount: z.number().int().min(0).nullable(),
  }),
});
export type WorkspaceHeader = z.infer<typeof workspaceHeader>;
