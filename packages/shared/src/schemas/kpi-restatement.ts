// KPI restatements (ADR-0047 §2, §8, §9; REQ-S07-016; OpenAPI `KpiRestatement*`; T-DG5-KBE-E): the request and
// response mirrors of listKpiRestatements, createKpiRestatement, getKpiRestatement, getKpiRestatementReconciliation,
// submitKpiRestatement and withdrawKpiRestatement (decideKpiRestatement's body is KBE-E2's).
//
// - Values, targets and differences are decimal strings (numeric(24,6)), never JSON numbers. A reconciliation side
//   whose status is not `ok` carries no number (`value: null`): Unknown, Stale, Not computable and `none` are never
//   shown as 0 or green (ADR-0047 §9), and the difference exists only when both sides are `ok`.
// - The create body's period list is bounded here only against abuse (at most 100 ids, unique). The ADR-0047 §8
//   business refusals for an empty list (422 kpi_restatement.periods_required) and for 25 or more periods
//   (422 kpi_restatement.too_many_periods) are the API's, so a caller gets the exact code the slice ADR names.
// - A restatement decision is a business approval inside the product, never an engineering gate (DG0-DG7).
import { z } from "zod";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { decimal, kpiUnitKind } from "./kpi.ts";

export const KPI_RESTATEMENT_STATUSES = ["draft", "submitted", "approved", "rejected", "withdrawn", "applied"] as const;
/** The most periods one restatement covers (ADR-0047 §2; CHECK period_count BETWEEN 0 AND 24). */
export const KPI_RESTATEMENT_MAX_PERIODS = 24;

export const kpiRestatementStatus = z.enum(KPI_RESTATEMENT_STATUSES);

export const kpiRestatementCreate = z.strictObject({
  kpiVersionId: uuid,
  reportingPeriodIds: z
    .array(uuid)
    .max(100)
    .refine((v) => new Set(v).size === v.length, "validation.unique_items"),
  reason: freeText(3, 2000),
  changeRequestId: uuid.nullable().optional(),
});

export const kpiRestatementPeriod = z.strictObject({
  reportingPeriodId: uuid,
  periodLabel: z.string(),
});

export const kpiRestatement = z.strictObject({
  id: uuid,
  transformationId: uuid,
  kpiDefinitionId: uuid,
  kpiVersionId: uuid,
  changeRequestId: uuid.nullable(),
  reason: z.string(),
  status: kpiRestatementStatus,
  periods: z.array(kpiRestatementPeriod).max(KPI_RESTATEMENT_MAX_PERIODS),
  requestedBy: uuid,
  submittedAt: timestamp.nullable(),
  decidedBy: uuid.nullable(),
  decidedAt: timestamp.nullable(),
  decisionNote: z.string().nullable(),
  authorityPermission: z.literal("kpi_restatement.approve").nullable(),
  authorityRoleCode: z.string().nullable(),
  calculationRunId: uuid.nullable(),
  appliedAt: timestamp.nullable(),
  withdrawnAt: timestamp.nullable(),
  withdrawnBy: uuid.nullable(),
  version,
  createdAt: timestamp,
  updatedAt: timestamp,
});

export const kpiRestatementPage = z.strictObject({
  items: z.array(kpiRestatement),
  nextCursor: z.string().nullable(),
});

export const KPI_RESTATEMENT_VALUE_STATUSES = ["ok", "unknown", "stale", "not_computable"] as const;
export const KPI_RESTATEMENT_RAGS = ["green", "amber", "red", "unknown", "stale", "not_computable"] as const;

export const kpiRestatementValueBefore = z.strictObject({
  evaluationId: uuid.nullable(),
  kpiVersionId: uuid.nullable(),
  value: decimal.nullable(),
  valueStatus: z.enum([...KPI_RESTATEMENT_VALUE_STATUSES, "none"]),
  rag: z.enum([...KPI_RESTATEMENT_RAGS, "none"]),
  target: decimal.nullable(),
});

export const kpiRestatementValueAfter = z.strictObject({
  value: decimal.nullable(),
  valueStatus: z.enum(KPI_RESTATEMENT_VALUE_STATUSES),
  rag: z.enum(KPI_RESTATEMENT_RAGS),
  target: decimal.nullable(),
});

export const kpiRestatementReconciliationRow = z.strictObject({
  reportingPeriodId: uuid,
  periodLabel: z.string(),
  scopeKind: z.enum(["transformation", "business_unit", "initiative"]),
  scopeId: uuid,
  valueBasis: z.enum(["period", "cumulative"]),
  before: kpiRestatementValueBefore,
  after: kpiRestatementValueAfter,
  difference: decimal.nullable(),
  currency: currency.nullable(),
  unitKind: kpiUnitKind,
});

export const kpiRestatementReconciliation = z.strictObject({
  restatementId: uuid,
  retained: z.boolean(),
  rows: z.array(kpiRestatementReconciliationRow),
});

export type KpiRestatementStatus = z.infer<typeof kpiRestatementStatus>;
export type KpiRestatementCreate = z.infer<typeof kpiRestatementCreate>;
export type KpiRestatementPeriod = z.infer<typeof kpiRestatementPeriod>;
export type KpiRestatement = z.infer<typeof kpiRestatement>;
export type KpiRestatementPage = z.infer<typeof kpiRestatementPage>;
export type KpiRestatementValueBefore = z.infer<typeof kpiRestatementValueBefore>;
export type KpiRestatementValueAfter = z.infer<typeof kpiRestatementValueAfter>;
export type KpiRestatementReconciliationRow = z.infer<typeof kpiRestatementReconciliationRow>;
export type KpiRestatementReconciliation = z.infer<typeof kpiRestatementReconciliation>;
