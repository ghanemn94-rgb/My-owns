// P4 slice B zod mirrors of the KBE-D2 operations (kpi-benefits-engineer, T-DG4-KBE-D2; ADR-0029 §7, §8, §10, §11;
// p4-work-split §B.2). Mirrors docs/api/openapi.yaml 1.3.0-p4: BenefitOverlap(+Create, Resolve, Page),
// BenefitScenario(+Create, Update, Page), BenefitScenarioValue(+Create, Update) and BenefitValuationMethod(+Create,
// Decision, Page). The API validates requests with them and the web reuses them for its forms.
//
// Pure rules carried here (no I/O; the API applies them before the database, which enforces them again):
//  - the overlap rule (ADR-0029 §7): two benefits with the same driver key and overlapping realization windows overlap
//    on {driver, period}, plus `population` when both carry the same population key. A missing window bound counts as
//    open-ended, so a benefit without a window overlaps every window (`overlapOf`);
//  - an overlap pair is stored in id order (`orderedPair`; CHECK benefit_overlap_pair_order);
//  - valuation-method decisions (ADR-0029 §8): proposed -> approved | rejected, approved -> retired
//    (`valuationDecisionAllowed`); a rejection needs a note;
//  - scenario values are never actuals (REQ-S08-018): every value returned carries its scenario `kind` label;
//  - amounts are decimal strings, never JSON numbers (S-5); free text through `freeText` (S-1).
// Nothing here validates or approves anything: Finance decisions are human decisions inside the product, unrelated to
// the engineering gates DG0-DG7.
import { z } from "zod";
import { compareDecimal } from "../value.ts";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, measureDecimal, moneyDecimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDate = businessDate.nullable();
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ overlaps

export const BENEFIT_OVERLAP_DIMENSIONS = ["driver", "population", "period"] as const;
export const benefitOverlapDimension = z.enum(BENEFIT_OVERLAP_DIMENSIONS);
export type BenefitOverlapDimension = z.infer<typeof benefitOverlapDimension>;
export const BENEFIT_OVERLAP_RESOLUTIONS = ["no_economic_overlap", "duplicate"] as const;

/** The two benefit ids in the order the database stores them (uuid byte order = lowercase hex string order). */
export function orderedPair(a: string, b: string): readonly [string, string] {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x < y ? [x, y] : [y, x];
}

/** The overlap keys and window of one benefit (null = not set; a missing window bound is open-ended). */
export interface OverlapKeys {
  readonly driverKey: string | null;
  readonly populationKey: string | null;
  readonly realizationStart: string | null;
  readonly realizationEnd: string | null;
}

const laterOf = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a > b ? a : b;
const earlierOf = (a: string | null, b: string | null): string | null =>
  a === null ? b : b === null ? a : a < b ? a : b;

/**
 * The intersection of two realization windows, or null when they are disjoint. Dates are ISO "YYYY-MM-DD" strings, so
 * string order is date order; a null bound is open-ended (a benefit without a window overlaps every window).
 */
export function windowIntersection(
  a: Pick<OverlapKeys, "realizationStart" | "realizationEnd">,
  b: Pick<OverlapKeys, "realizationStart" | "realizationEnd">,
): { readonly start: string | null; readonly end: string | null } | null {
  const start = laterOf(a.realizationStart, b.realizationStart);
  const end = earlierOf(a.realizationEnd, b.realizationEnd);
  if (start !== null && end !== null && start > end) return null;
  return { start, end };
}

/**
 * The overlap rule of ADR-0029 §7: null when the two benefits do not overlap by rule; otherwise the dimensions and the
 * overlapping window. Same driver key (both set) and intersecting windows give {driver, period}; the same population key
 * (both set) adds `population`. Dimensions are returned in the canonical order driver, population, period.
 */
export function overlapOf(
  a: OverlapKeys,
  b: OverlapKeys,
): {
  readonly dimensions: readonly BenefitOverlapDimension[];
  readonly start: string | null;
  readonly end: string | null;
} | null {
  if (a.driverKey === null || b.driverKey === null || a.driverKey !== b.driverKey) return null;
  const window = windowIntersection(a, b);
  if (window === null) return null;
  const samePopulation = a.populationKey !== null && a.populationKey === b.populationKey;
  return {
    dimensions: samePopulation ? ["driver", "population", "period"] : ["driver", "period"],
    start: window.start,
    end: window.end,
  };
}

/** Dimensions sorted into the canonical order (driver, population, period), duplicates removed. */
export function canonicalDimensions(dims: readonly BenefitOverlapDimension[]): BenefitOverlapDimension[] {
  return BENEFIT_OVERLAP_DIMENSIONS.filter((d) => dims.includes(d));
}

export const benefitOverlapStatusQuery = z.strictObject({
  status: z.enum(["open", "resolved"]).optional(),
});

/** OpenAPI BenefitOverlapCreate: a user-raised warning between two benefits of the transformation. */
export const benefitOverlapCreate = z.strictObject({
  benefitAId: uuid,
  benefitBId: uuid,
  dimensions: z
    .array(benefitOverlapDimension)
    .min(1)
    .max(3)
    .refine((d) => new Set(d).size === d.length, "validation.unique_items"),
});
export type BenefitOverlapCreate = z.infer<typeof benefitOverlapCreate>;

/**
 * OpenAPI BenefitOverlapResolve. `excludedBenefitId` (required for a duplicate) and `note` (required) are checked as the
 * ADR-0029 §11 422 rules `benefit_overlap.excluded_required` / `benefit_overlap.note_required`, so the parser accepts
 * their absence and the service answers with the exact refusal (a present note still needs 3-4000 visible characters).
 */
export const benefitOverlapResolve = z.strictObject({
  resolution: z.enum(BENEFIT_OVERLAP_RESOLUTIONS),
  excludedBenefitId: uuid.optional(),
  note: freeText(3, 4000).optional(),
});
export type BenefitOverlapResolve = z.infer<typeof benefitOverlapResolve>;

export const benefitOverlap = z.strictObject({
  id: uuid,
  transformationId: uuid,
  benefitAId: uuid,
  benefitBId: uuid,
  dimensions: z.array(benefitOverlapDimension).min(1),
  driverKey: z.string().nullable(),
  populationKey: z.string().nullable(),
  overlapStart: nullableDate,
  overlapEnd: nullableDate,
  detectedBy: z.enum(["rule", "user"]),
  status: z.enum(["open", "resolved"]),
  resolution: z.enum(BENEFIT_OVERLAP_RESOLUTIONS).nullable(),
  excludedBenefitId: nullableUuid,
  resolutionNote: z.string().nullable(),
  resolvedBy: nullableUuid,
  resolvedAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitOverlap = z.infer<typeof benefitOverlap>;
export const benefitOverlapPage = z.strictObject({ items: z.array(benefitOverlap), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ scenarios

export const BENEFIT_SCENARIO_KINDS = ["base", "upside", "downside"] as const;
export const benefitScenarioKind = z.enum(BENEFIT_SCENARIO_KINDS);
export type BenefitScenarioKind = z.infer<typeof benefitScenarioKind>;

export const benefitScenarioCreate = z.strictObject({
  kind: benefitScenarioKind,
  title: freeText(1, 300),
  assumptions: freeText(1, 8000).optional(),
  businessCaseId: nullableUuid.optional(),
});
export type BenefitScenarioCreate = z.infer<typeof benefitScenarioCreate>;

export const benefitScenarioUpdate = atLeastOne({
  title: freeText(1, 300).optional(),
  assumptions: freeText(1, 8000).nullable().optional(),
  archiveReason: freeText(3, 1000).optional(),
});
export type BenefitScenarioUpdate = z.infer<typeof benefitScenarioUpdate>;

/** True when the period ends on or after it starts (ISO dates compare as strings). */
export function periodInOrder(periodStart: string, periodEnd: string): boolean {
  return periodEnd >= periodStart;
}

export const benefitScenarioValueCreate = z.strictObject({
  benefitId: uuid,
  periodStart: businessDate,
  periodEnd: businessDate,
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  note: freeText(1, 2000).optional(),
});
export type BenefitScenarioValueCreate = z.infer<typeof benefitScenarioValueCreate>;

export const benefitScenarioValueUpdate = atLeastOne({
  periodStart: businessDate.optional(),
  periodEnd: businessDate.optional(),
  amount: moneyDecimal.nullable().optional(),
  kpiValue: measureDecimal.nullable().optional(),
  note: freeText(1, 2000).nullable().optional(),
});
export type BenefitScenarioValueUpdate = z.infer<typeof benefitScenarioValueUpdate>;

/** A scenario value, always labelled with its scenario kind; never an actual (REQ-S08-018). */
export const benefitScenarioValue = z.strictObject({
  id: uuid,
  scenarioId: uuid,
  scenarioKind: benefitScenarioKind,
  benefitId: uuid,
  periodStart: businessDate,
  periodEnd: businessDate,
  amount: decimal.nullable(),
  kpiValue: decimal.nullable(),
  currency,
  note: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitScenarioValue = z.infer<typeof benefitScenarioValue>;

export const benefitScenario = z.strictObject({
  id: uuid,
  transformationId: uuid,
  businessCaseId: nullableUuid,
  kind: benefitScenarioKind,
  title: z.string(),
  assumptions: z.string().nullable(),
  values: z.array(benefitScenarioValue),
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitScenario = z.infer<typeof benefitScenario>;
export const benefitScenarioPage = z.strictObject({
  items: z.array(benefitScenario),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ valuation methods

export const VALUATION_METHOD_TYPES = ["cx", "risk", "strategic", "other"] as const;
export const VALUATION_METHOD_STATUSES = ["proposed", "approved", "rejected", "retired"] as const;
export type ValuationMethodStatus = (typeof VALUATION_METHOD_STATUSES)[number];
export const VALUATION_METHOD_DECISIONS = ["approved", "rejected", "retired"] as const;
export type ValuationMethodDecision = (typeof VALUATION_METHOD_DECISIONS)[number];

/**
 * ADR-0029 §8 (trigger benefit_valuation_method_guard): approve or reject only a proposed method; retire only an
 * approved one. Every other move is refused.
 */
export function valuationDecisionAllowed(status: ValuationMethodStatus, decision: ValuationMethodDecision): boolean {
  if (decision === "retired") return status === "approved";
  return status === "proposed";
}

/** A unit value is a non-negative money decimal (CHECK unit_value >= 0). */
const unitValue = moneyDecimal.refine((v) => compareDecimal(v, "0") >= 0, "validation.decimal_non_negative");

export const benefitValuationMethodCreate = z.strictObject({
  name: freeText(1, 300),
  method: freeText(1, 8000),
  appliesToType: z.enum(VALUATION_METHOD_TYPES),
  kpiDefinitionId: nullableUuid.optional(),
  unitValue: unitValue.nullable().optional(),
  currency,
});
export type BenefitValuationMethodCreate = z.infer<typeof benefitValuationMethodCreate>;

export const benefitValuationMethodDecision = z.strictObject({
  decision: z.enum(VALUATION_METHOD_DECISIONS),
  note: freeText(1, 2000).optional(),
});
export type BenefitValuationMethodDecisionBody = z.infer<typeof benefitValuationMethodDecision>;

export const benefitValuationMethod = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^VM-[0-9]{2,6}$/),
  name: z.string(),
  method: z.string(),
  appliesToType: z.enum(VALUATION_METHOD_TYPES),
  kpiDefinitionId: nullableUuid,
  unitValue: decimal.nullable(),
  currency,
  status: z.enum(VALUATION_METHOD_STATUSES),
  decidedBy: nullableUuid,
  decidedAt: nullableTimestamp,
  decisionNote: z.string().nullable(),
  retiredAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitValuationMethod = z.infer<typeof benefitValuationMethod>;
export const benefitValuationMethodPage = z.strictObject({
  items: z.array(benefitValuationMethod),
  nextCursor: z.string().nullable(),
});
