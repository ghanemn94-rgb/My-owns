// P4 slice E mirrors of the corrective-action cases, their signals and the configured severity and persistence rules
// (backend-workflow-engineer, T-DG4-BE-D2; ADR-0031 §5, §6, §10, §11; OpenAPI 1.3.0-p4 CorrectiveCase*,
// CorrectiveSignal*, CorrectiveActionRule*). REQ-PB-085, REQ-S12-016.
//
// Besides the HTTP mirrors, this file holds the parts of the rule that the API (raid/corrective-rules.ts) and the worker
// (apps/worker/src/handlers/raid.ts) must share, because the worker imports no API code (ADR-0002 rule 5):
//  - the ADR-0031 §5.2 default rules (one per source kind);
//  - the off-track reading of a KPI RAG under a rule's severity, and the consecutive-count rule of §5.4 step 3
//    (pure functions, unit-tested in corrective.test.ts);
//  - the payload shapes the four consumers accept (the KPI event's shape is KBE-C's kpiDeviationEvaluatedV1).
// An Unknown period (KPI RAG unknown/stale/not_computable, benefit offTrack null) is never off track and never
// recovered: it ends a run and never closes a case (ADR-0031 §5.4, §13). Nothing here is a business approval.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate } from "./kpi.ts";
import { KPI_RAGS } from "./kpi-actuals.ts";
import { KPI_SCOPE_KINDS } from "./kpi-versions.ts";

const nullableUuid = uuid.nullable();
const nullableDate = businessDate.nullable();
const nullableTimestamp = timestamp.nullable();

export const CORRECTIVE_SOURCE_KINDS = [
  "kpi_deviation",
  "benefit_variance",
  "adoption_check",
  "control_check",
  "value_review",
] as const;
export type CorrectiveSourceKind = (typeof CORRECTIVE_SOURCE_KINDS)[number];
/** The four event-driven kinds (a rule exists only for these; the worker alone creates their cases). */
export const CORRECTIVE_RULE_KINDS = ["kpi_deviation", "benefit_variance", "adoption_check", "control_check"] as const;
export type CorrectiveRuleKind = (typeof CORRECTIVE_RULE_KINDS)[number];
export const CORRECTIVE_CASE_STATUSES = ["open", "in_progress", "closed"] as const;
export const CORRECTIVE_SIGNAL_OUTCOMES = ["recorded", "case_created", "case_updated", "rule_disabled"] as const;
export const CORRECTIVE_MIN_RAGS = ["amber", "red"] as const;
export type CorrectiveMinRag = (typeof CORRECTIVE_MIN_RAGS)[number];

export const correctiveSourceKind = z.enum(CORRECTIVE_SOURCE_KINDS);
export const correctiveRuleKind = z.enum(CORRECTIVE_RULE_KINDS);
export const correctiveCaseStatus = z.enum(CORRECTIVE_CASE_STATUSES);

// ------------------------------------------------------------------------------------------------ HTTP mirrors

/** OpenAPI `CorrectiveCase`. `createdBy` is null for a worker case (its audit actor is the service). */
export const correctiveCase = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^CA-[0-9]{2,6}$/),
  sourceKind: correctiveSourceKind,
  sourceScopeKey: z.string().min(1).max(200),
  kpiDefinitionId: nullableUuid,
  kpiScopeKind: z.enum(KPI_SCOPE_KINDS).nullable(),
  kpiScopeId: nullableUuid,
  benefitId: nullableUuid,
  benefitLifecycleStep: z.string().nullable(),
  sourceRecordType: z.string().nullable(),
  sourceRecordId: nullableUuid,
  title: z.string().min(1).max(500),
  recoveryPlan: z.string().min(1).max(8000).nullable(),
  ownerUserId: nullableUuid,
  ownerStatus: z.enum(["assigned", "unassigned"]),
  followUpDate: nullableDate,
  followUpUnknownReason: z.enum(["calendar_not_configured"]).nullable(),
  status: correctiveCaseStatus,
  consecutiveOffTrack: z.number().int().min(0).nullable(),
  signalCount: z.number().int().min(0),
  lastSignalAt: nullableTimestamp,
  closedAt: nullableTimestamp,
  closedBy: nullableUuid,
  closureNote: z.string().min(3).max(2000).nullable(),
  createdSource: z.enum(["api", "worker"]),
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type CorrectiveCase = z.infer<typeof correctiveCase>;
export const correctiveCasePage = page(correctiveCase);

/** OpenAPI `CorrectiveCaseCreate`: a person's case for a Value Review finding (B0093). */
export const correctiveCaseCreate = z.strictObject({
  findingRef: freeText(1, 150),
  title: freeText(1, 500),
  recoveryPlan: freeText(1, 8000).nullable().optional(),
  ownerUserId: uuid,
  followUpDate: businessDate,
});
export type CorrectiveCaseCreate = z.infer<typeof correctiveCaseCreate>;

/** OpenAPI `CorrectiveCaseUpdate` (minProperties 1). Closing is `closeCorrectiveCase`. */
export const correctiveCaseUpdate = z
  .strictObject({
    title: freeText(1, 500).optional(),
    recoveryPlan: freeText(1, 8000).nullable().optional(),
    ownerUserId: uuid.optional(),
    followUpDate: businessDate.optional(),
    status: z.enum(["open", "in_progress"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type CorrectiveCaseUpdate = z.infer<typeof correctiveCaseUpdate>;

/** OpenAPI `CorrectiveCaseClose`. */
export const correctiveCaseClose = z.strictObject({ closureNote: freeText(3, 2000) });

/** OpenAPI `CorrectiveSignal`: one consumed source event (append-only lineage). */
export const correctiveSignal = z.strictObject({
  id: uuid,
  sourceKind: correctiveRuleKind,
  sourceEventKey: z.string(),
  periodKey: z.string(),
  periodStart: nullableDate,
  periodEnd: nullableDate,
  observedRag: z.enum(KPI_RAGS).nullable(),
  offTrack: z.boolean().nullable(),
  rulePersistence: z.number().int().nullable(),
  consecutiveOffTrack: z.number().int().nullable(),
  outcome: z.enum(CORRECTIVE_SIGNAL_OUTCOMES),
  correctiveCaseId: nullableUuid,
  receivedAt: timestamp,
});
export type CorrectiveSignal = z.infer<typeof correctiveSignal>;
export const correctiveSignalPage = page(correctiveSignal);

/** OpenAPI `CorrectiveActionRule`; `isDefault` = no stored row, the §5.2 default applies (id and version null). */
export const correctiveActionRule = z.strictObject({
  id: nullableUuid,
  sourceKind: correctiveRuleKind,
  minKpiRag: z.enum(CORRECTIVE_MIN_RAGS).nullable(),
  persistenceCycles: z.number().int().min(1).max(12),
  followUpWorkingDays: z.number().int().min(1).max(60),
  enabled: z.boolean(),
  isDefault: z.boolean(),
  version: z.number().int().min(1).nullable(),
});
export type CorrectiveActionRule = z.infer<typeof correctiveActionRule>;
export const correctiveActionRulePage = page(correctiveActionRule);

const persistenceCycles = z.number().int().min(1).max(12);
const followUpWorkingDays = z.number().int().min(1).max(60);

/** OpenAPI `CorrectiveActionRuleCreate`. */
export const correctiveActionRuleCreate = z.strictObject({
  sourceKind: correctiveRuleKind,
  minKpiRag: z.enum(CORRECTIVE_MIN_RAGS).nullable().optional(),
  persistenceCycles,
  followUpWorkingDays,
  enabled: z.boolean().optional(),
});
export type CorrectiveActionRuleCreate = z.infer<typeof correctiveActionRuleCreate>;

/** OpenAPI `CorrectiveActionRuleUpdate` (minProperties 1); the source kind is the path and never changes. */
export const correctiveActionRuleUpdate = z
  .strictObject({
    minKpiRag: z.enum(CORRECTIVE_MIN_RAGS).nullable().optional(),
    persistenceCycles: persistenceCycles.optional(),
    followUpWorkingDays: followUpWorkingDays.optional(),
    enabled: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type CorrectiveActionRuleUpdate = z.infer<typeof correctiveActionRuleUpdate>;

// ------------------------------------------------------------------------------------------------ the rule (ADR-0031 §5)

/** The parts of a rule the engine needs. */
export interface CorrectiveRuleSettings {
  readonly sourceKind: CorrectiveRuleKind;
  readonly minKpiRag: CorrectiveMinRag | null;
  readonly persistenceCycles: number;
  readonly followUpWorkingDays: number;
  readonly enabled: boolean;
}

/** ADR-0031 §5.2 defaults, used when a transformation stores no rule for the kind (D-093 (3)). */
export const CORRECTIVE_RULE_DEFAULTS: Readonly<Record<CorrectiveRuleKind, CorrectiveRuleSettings>> = Object.freeze({
  kpi_deviation: {
    sourceKind: "kpi_deviation",
    minKpiRag: "red",
    persistenceCycles: 2,
    followUpWorkingDays: 5,
    enabled: true,
  },
  benefit_variance: {
    sourceKind: "benefit_variance",
    minKpiRag: null,
    persistenceCycles: 1,
    followUpWorkingDays: 5,
    enabled: true,
  },
  adoption_check: {
    sourceKind: "adoption_check",
    minKpiRag: null,
    persistenceCycles: 1,
    followUpWorkingDays: 5,
    enabled: true,
  },
  control_check: {
    sourceKind: "control_check",
    minKpiRag: null,
    persistenceCycles: 1,
    followUpWorkingDays: 5,
    enabled: true,
  },
});

/** The ADR-0031 §5.2 default rule of one kind. */
export function correctiveRuleDefault(kind: CorrectiveRuleKind): CorrectiveRuleSettings {
  switch (kind) {
    case "kpi_deviation":
      return CORRECTIVE_RULE_DEFAULTS.kpi_deviation;
    case "benefit_variance":
      return CORRECTIVE_RULE_DEFAULTS.benefit_variance;
    case "adoption_check":
      return CORRECTIVE_RULE_DEFAULTS.adoption_check;
    case "control_check":
      return CORRECTIVE_RULE_DEFAULTS.control_check;
  }
}

/**
 * ADR-0031 §5.4: the off-track reading of a KPI's calculated RAG. Under severity `red` only red is off track; under
 * `amber`, amber and red are. Green is on track (false); unknown, stale and not_computable are Unknown (null).
 */
export function kpiOffTrack(calculatedRag: string, minKpiRag: CorrectiveMinRag): boolean | null {
  if (calculatedRag === "red") return true;
  if (calculatedRag === "amber") return minKpiRag === "amber";
  if (calculatedRag === "green") return false;
  return null;
}

/** One stored or incoming signal as the consecutive count sees it. */
export interface SeriesSignal {
  readonly periodKey: string;
  /** YYYY-MM-DD, or null when the source has no period dates. */
  readonly periodStart: string | null;
  /** Comparable receipt order (larger = later), e.g. epoch milliseconds or a sequence. */
  readonly receivedOrder: number;
  readonly offTrack: boolean | null;
}

/**
 * ADR-0031 §5.4 step 3: take the latest-received signal of each period, order the periods by start date descending,
 * and count the leading off-track ones. A period that is on track (false) or Unknown (null) ends the run.
 */
export function consecutiveOffTrack(signals: readonly SeriesSignal[]): number {
  const latest = new Map<string, SeriesSignal>();
  for (const s of signals) {
    const seen = latest.get(s.periodKey);
    if (seen === undefined || s.receivedOrder >= seen.receivedOrder) latest.set(s.periodKey, s);
  }
  const ordered = [...latest.values()].sort((a, b) => {
    const as = a.periodStart ?? "";
    const bs = b.periodStart ?? "";
    if (as !== bs) return as < bs ? 1 : -1;
    return b.receivedOrder - a.receivedOrder;
  });
  let count = 0;
  for (const s of ordered) {
    if (s.offTrack !== true) break;
    count += 1;
  }
  return count;
}

// ------------------------------------------------------------------------------------------------ consumed payloads

/**
 * benefit.variance_evaluated v1 as ADR-0030 §6 / ADR-0031 §5.4 name it. KBE-E (the producer) was not merged when this
 * consumer was written, so the shape is loose: the fields the rule needs are required, the rest optional, and extra
 * fields are kept in the signal's payload. `offTrack` null = Unknown.
 */
export const benefitVarianceEvaluatedPayload = z.looseObject({
  benefitId: uuid,
  measurementId: uuid.optional(),
  periodStart: businessDate,
  periodEnd: businessDate,
  plannedAmount: z.string().nullable().optional(),
  measuredAmount: z.string().nullable().optional(),
  variance: z.string().nullable().optional(),
  offTrack: z.boolean().nullable(),
});
export type BenefitVarianceEvaluatedPayload = z.infer<typeof benefitVarianceEvaluatedPayload>;

/**
 * adoption.check_failed and control_check.failed v1: the ADR-0031 §5.4 producer contract (ARCH-06 adopts it; D-093
 * (4)). Idempotency key `<event type>:<checkId>`.
 */
export const checkFailedPayload = z.strictObject({
  checkId: uuid,
  checkRecordType: z.string().regex(/^[a-z][a-z0-9_]{1,62}$/),
  transformationId: uuid,
  ownerUserId: nullableUuid,
  subjectLabel: z.string().min(1).max(500),
  failedAt: timestamp,
  businessDate,
});
export type CheckFailedPayload = z.infer<typeof checkFailedPayload>;
