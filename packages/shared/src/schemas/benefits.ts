// P4 slice B zod mirrors of the KBE-D operations (kpi-benefits-engineer, T-DG4-KBE-D; ADR-0029 §1-§6, §9, §11, §12;
// p4-work-split §B.1). Mirrors docs/api/openapi.yaml 1.3.0-p4: BenefitType, BenefitValueClass, BenefitLifecycleStep,
// BenefitAmount, BenefitCountingStatus, Benefit(+Create, Update), BenefitRealized, BenefitRegisterRow(+Page),
// BenefitLifecycle(+Advance), BenefitEnabler(+Create, Page), BenefitAllocationShare, BenefitAllocations(+Replace) and
// BenefitGroup(+Create, Update, Page). The API validates requests with them and the web reuses them for its forms.
//
// Rules carried here (pure, no I/O; the API applies them before the database, which enforces them again):
//  - ONE owner: `ownerUserId` is a single uuid in a strict object. A body naming two owners (an array, or any second
//    owner property) is a malformed request: 400 urn:mth:problem:validation (REQ-PB-058 "a benefit with two owners is
//    rejected");
//  - type <-> class (REQ-S08-009): revenue uplift and margin are separate revenue classes; cash savings and avoided cost
//    are separate cost classes; they are never converted (`typeFitsClass`);
//  - the Plan outputs (REQ-PB-074): baseline, formula (not for non_financial), target and owner before Enable and
//    every later step (`missingPlanOutputs`);
//  - allocation shares are fractions (0.6 = 60 %), numeric(7,6), summed with decimal arithmetic; above 1 is refused and
//    below 1 the rest is unallocated (`allocationTotals`, REQ-S08-013);
//  - amounts are decimal strings, never JSON numbers; Unknown and n/a are never 0 (S-5, ADR-0019);
//  - free text through `freeText` (S-1).
// Nothing here validates or approves anything: Finance decisions are human decisions inside the product, unrelated
// to the engineering gates DG0-DG7.
import { z } from "zod";
import { compareDecimal, sumDecimals, toColumnString, type DecimalColumn } from "../value.ts";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, measureDecimal, moneyDecimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDate = businessDate.nullable();
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ vocabularies

export const BENEFIT_TYPES = ["revenue", "cost", "working_capital", "cx", "risk", "strategic", "other"] as const;
export const benefitType = z.enum(BENEFIT_TYPES);
export type BenefitType = z.infer<typeof benefitType>;

export const BENEFIT_VALUE_CLASSES = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
  "non_financial",
] as const;
export const benefitValueClass = z.enum(BENEFIT_VALUE_CLASSES);
export type BenefitValueClass = z.infer<typeof benefitValueClass>;

export const BENEFIT_LIFECYCLE_STEPS = ["identify", "plan", "enable", "measure", "correct", "sustain"] as const;
export const benefitLifecycleStep = z.enum(BENEFIT_LIFECYCLE_STEPS);
export type BenefitLifecycleStep = z.infer<typeof benefitLifecycleStep>;

export const BENEFIT_REALIZATION_STATES = [
  "not_enabled",
  "enabled_not_yet_measured",
  "measured_pending_validation",
  "validated",
  "sustained",
] as const;
export const benefitRealizationState = z.enum(BENEFIT_REALIZATION_STATES);
export type BenefitRealizationState = z.infer<typeof benefitRealizationState>;

export const BENEFIT_EXCLUSION_REASONS = [
  "archived",
  "parent_rollup",
  "group_counted_member_not_named",
  "group_member_not_counted",
  "overlap_duplicate",
] as const;
export const benefitExclusionReason = z.enum(BENEFIT_EXCLUSION_REASONS);
export type BenefitExclusionReason = z.infer<typeof benefitExclusionReason>;

export const CONTROL_CADENCES = ["monthly", "quarterly", "semiannual", "annual"] as const;
export const BENEFIT_RECURRENCES = ["one_off", "recurring"] as const;
export const BENEFIT_CONFIDENCES = ["H", "M", "L"] as const;
export const BENEFIT_RAG = ["green", "amber", "red"] as const;
export const BASELINE_VALIDATION_STATUSES = ["unvalidated", "validated", "rejected"] as const;

/**
 * ADR-0029 §1 (CHECK benefit_type_fits_class): the value classes each T14 type allows. Revenue uplift is kept apart from
 * margin, and avoided cost from cash savings (REQ-S08-009); nothing converts one class into another.
 */
export const VALUE_CLASSES_BY_TYPE: Readonly<Record<BenefitType, readonly BenefitValueClass[]>> = Object.freeze({
  revenue: ["revenue_uplift", "margin_uplift"],
  cost: ["cash_saving", "avoided_cost"],
  working_capital: ["working_capital_release"],
  risk: ["avoided_cost", "non_financial"],
  cx: ["non_financial"],
  strategic: ["non_financial"],
  other: ["non_financial"],
});

export function typeFitsClass(type: BenefitType, valueClass: BenefitValueClass): boolean {
  return VALUE_CLASSES_BY_TYPE[type].includes(valueClass);
}

/** Financial classes need a financial-statement line; `non_financial` needs an agreed KPI (REQ-S08-003). */
export function isFinancialClass(valueClass: BenefitValueClass): boolean {
  return valueClass !== "non_financial";
}

// ------------------------------------------------------------------------------------------------ lifecycle rules

/** ADR-0029 §2: the allowed one-step moves (the database trigger benefit_guard allows exactly these). */
export const LIFECYCLE_MOVES: Readonly<Record<BenefitLifecycleStep, readonly BenefitLifecycleStep[]>> = Object.freeze({
  identify: ["plan"],
  plan: ["enable"],
  enable: ["measure"],
  measure: ["correct", "sustain"],
  correct: ["measure"],
  sustain: [],
});

export function isAllowedLifecycleMove(from: BenefitLifecycleStep, to: BenefitLifecycleStep): boolean {
  return LIFECYCLE_MOVES[from].includes(to);
}

/** The `missing` vocabulary of BenefitLifecycle.steps[] (OpenAPI). */
export const LIFECYCLE_MISSING = [
  "baseline",
  "formula",
  "target",
  "owner",
  "enablers",
  "recovery_plan",
  "bau_owner",
  "control_cadence",
] as const;
export type LifecycleMissing = (typeof LIFECYCLE_MISSING)[number];

/** The fields of a benefit the lifecycle preconditions read (camelCase API names). */
export interface LifecycleFacts {
  readonly valueClass: BenefitValueClass;
  readonly ownerUserId: string | null;
  readonly baselineValue: string | null;
  readonly baselineId: string | null;
  readonly benefitFormulaId: string | null;
  readonly targetValue: string | null;
  readonly recoveryPlan: string | null;
  readonly bauOwnerUserId: string | null;
  readonly controlCadence: string | null;
  /** Number of ACTIVE enabler links (the Enable output). */
  readonly activeEnablers: number;
}

/**
 * The Plan outputs (B0121 "Baseline, formula, target, owner") that are missing. The formula is not required for a
 * non-financial benefit: its agreed KPI is the measure (CHECK benefit_plan_outputs_present).
 */
export function missingPlanOutputs(f: LifecycleFacts): LifecycleMissing[] {
  const missing: LifecycleMissing[] = [];
  if (f.baselineValue === null && f.baselineId === null) missing.push("baseline");
  if (f.benefitFormulaId === null && f.valueClass !== "non_financial") missing.push("formula");
  if (f.targetValue === null) missing.push("target");
  if (f.ownerUserId === null) missing.push("owner");
  return missing;
}

/**
 * What a benefit still lacks to ENTER `step` (ADR-0029 §2 table). identify and plan need only the profile, which every
 * stored row has. enable and later need the Plan outputs; measure also needs at least one active enabler; correct
 * needs a recovery plan; sustain needs a BAU owner and a control cadence.
 */
export function missingFor(step: BenefitLifecycleStep, f: LifecycleFacts): LifecycleMissing[] {
  if (step === "identify" || step === "plan") return [];
  const missing = missingPlanOutputs(f);
  if (step === "measure" && f.activeEnablers === 0) missing.push("enablers");
  if (step === "correct" && f.recoveryPlan === null) missing.push("recovery_plan");
  if (step === "sustain") {
    if (f.bauOwnerUserId === null) missing.push("bau_owner");
    if (f.controlCadence === null) missing.push("control_cadence");
  }
  return missing;
}

/** The English list of missing Plan outputs for the 422 benefit.plan_outputs_missing detail ("baseline, formula"). */
export function planOutputsText(missing: readonly LifecycleMissing[]): string {
  return missing.filter((m) => m === "baseline" || m === "formula" || m === "target" || m === "owner").join(", ");
}

/**
 * REQ-S08-002 (ADR-0029 §2, §4): a delivered enabler is never realized value. The state comes from the value counts
 * and the enablers only: sustained or validated values first; any live measurement means it was measured; otherwise
 * `enabled_not_yet_measured` when every active enabler (at least one) is delivered, else `not_enabled`.
 */
export function realizationStateOf(input: {
  readonly sustainedCount: number;
  readonly validatedCount: number;
  readonly liveMeasurements: number;
  readonly activeEnablers: number;
  readonly deliveredEnablers: number;
}): BenefitRealizationState {
  if (input.sustainedCount > 0) return "sustained";
  if (input.validatedCount > 0) return "validated";
  if (input.liveMeasurements > 0) return "measured_pending_validation";
  if (input.activeEnablers > 0 && input.deliveredEnablers === input.activeEnablers) return "enabled_not_yet_measured";
  return "not_enabled";
}

// ------------------------------------------------------------------------------------------------ allocation rules

/**
 * Allocation shares are numeric(7,6) fractions: at most one integer digit and six fraction digits. (`checkDecimal`
 * reads only precision and scale; the `name` label is the closest existing column family.)
 */
export const SHARE_COLUMN: DecimalColumn = Object.freeze({ name: "measure", precision: 7, scale: 6 });

/** A share as sent: an exact decimal string with at most 6 fraction digits (400 otherwise). Range is a 422 rule. */
export const shareDecimal = decimal.refine(
  (v) => /^-?[0-9]+(\.[0-9]{1,6})?$/.test(v),
  "validation.decimal_share_scale",
);

/** 0 < share <= 1 (ADR-0029 §5, CHECK benefit_allocation_share_check). */
export function shareInRange(share: string): boolean {
  return compareDecimal(share, "0") > 0 && compareDecimal(share, "1") <= 0;
}

/** The allocation total and the unallocated rest (1 - total), both formatted as numeric(7,6), exact decimals. */
export function allocationTotals(shares: readonly string[]): {
  readonly allocatedShare: string;
  readonly unallocatedShare: string;
  readonly overHundred: boolean;
} {
  const total = sumDecimals(shares);
  const overHundred = compareDecimal(total, "1") > 0;
  const rest = sumDecimals(["1", total.startsWith("-") ? total.slice(1) : `-${total}`]);
  return {
    allocatedShare: overHundred ? total : toColumnString(total, SHARE_COLUMN),
    unallocatedShare: overHundred ? "0.000000" : toColumnString(rest, SHARE_COLUMN),
    overHundred,
  };
}

/** "110" for a total of "1.1" (the {totalPercent} of benefit_allocation.over_100), exact. */
export function percentText(fraction: string): string {
  const [intPart, fracPart = ""] = fraction.replace(/^-/, "").split(".");
  const padded = `${fracPart}00`;
  const whole = `${intPart === "0" ? "" : intPart}${padded.slice(0, 2)}`.replace(/^0+(?=[0-9])/, "") || "0";
  const rest = padded.slice(2).replace(/0+$/, "");
  return `${fraction.startsWith("-") ? "-" : ""}${whole}${rest === "" ? "" : `.${rest}`}`;
}

// ------------------------------------------------------------------------------------------------ request bodies

const title = freeText(1, 300);
const keyPattern = z.string().regex(/^[a-z0-9][a-z0-9_.:-]{0,99}$/, "validation.key");
const kpiVariable = z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "validation.variable_name");

/** Profile fields common to create and update (all optional; create adds its required ones). */
const profileShape = {
  financeValidatorUserId: nullableUuid.optional(),
  financeValidationRequired: z.boolean().optional(),
  financialStatementLine: freeText(1, 200).nullable().optional(),
  measurementKpiDefinitionId: nullableUuid.optional(),
  measurementKpiVariable: kpiVariable.nullable().optional(),
  businessCaseLineId: nullableUuid.optional(),
  benefitFormulaId: nullableUuid.optional(),
  baselineId: nullableUuid.optional(),
  baselineValue: measureDecimal.nullable().optional(),
  baselineUnit: freeText(1, 50).nullable().optional(),
  baselineDate: nullableDate.optional(),
  counterfactual: freeText(1, 4000).nullable().optional(),
  driverKey: keyPattern.nullable().optional(),
  driverUnits: freeText(1, 100).nullable().optional(),
  populationKey: keyPattern.nullable().optional(),
  targetValue: measureDecimal.nullable().optional(),
  targetDate: nullableDate.optional(),
  realizationStart: nullableDate.optional(),
  realizationEnd: nullableDate.optional(),
  recurrence: z.enum(BENEFIT_RECURRENCES).nullable().optional(),
  plannedValue: moneyDecimal.nullable().optional(),
  valuationMethodId: nullableUuid.optional(),
  measurementSource: freeText(1, 500).nullable().optional(),
  confidence: z.enum(BENEFIT_CONFIDENCES).nullable().optional(),
  assumptions: freeText(1, 8000).nullable().optional(),
  parentBenefitId: nullableUuid.optional(),
  benefitGroupId: nullableUuid.optional(),
};

/**
 * OpenAPI BenefitCreate: a benefit at Identify. Strict: a second owner (any unknown property, or an array as
 * ownerUserId) is 400 (REQ-PB-058 single-owner rule).
 */
export const benefitCreate = z.strictObject({
  title,
  description: freeText(1, 8000),
  benefitType,
  valueClass: benefitValueClass,
  ownerUserId: uuid,
  currency,
  ...profileShape,
});
export type BenefitCreate = z.infer<typeof benefitCreate>;

/** OpenAPI BenefitUpdate (minProperties 1). The step, baseline validation and allocations have their own operations. */
export const benefitUpdate = atLeastOne({
  title: title.optional(),
  description: freeText(1, 8000).optional(),
  benefitType: benefitType.optional(),
  valueClass: benefitValueClass.optional(),
  ownerUserId: uuid.optional(),
  currency: currency.optional(),
  ...profileShape,
  recoveryPlan: freeText(1, 8000).nullable().optional(),
  bauOwnerUserId: nullableUuid.optional(),
  controlCadence: z.enum(CONTROL_CADENCES).nullable().optional(),
  statusRag: z.enum(BENEFIT_RAG).nullable().optional(),
  statusRagNote: freeText(1, 2000).nullable().optional(),
});
export type BenefitUpdate = z.infer<typeof benefitUpdate>;

export const benefitLifecycleAdvance = z.strictObject({
  toStep: benefitLifecycleStep,
  note: freeText(1, 2000).optional(),
});
export type BenefitLifecycleAdvance = z.infer<typeof benefitLifecycleAdvance>;

export const benefitEnablerCreate = z.strictObject({
  initiativeId: uuid,
  deliverableId: nullableUuid.optional(),
  capabilityId: nullableUuid.optional(),
  note: freeText(1, 2000).optional(),
});
export type BenefitEnablerCreate = z.infer<typeof benefitEnablerCreate>;

export const benefitAllocationShare = z.strictObject({
  initiativeId: uuid,
  share: shareDecimal,
  basis: freeText(1, 1000).nullable().optional(),
});
export type BenefitAllocationShare = z.infer<typeof benefitAllocationShare>;

export const benefitAllocationsReplace = z.strictObject({
  allocations: z.array(benefitAllocationShare).max(100),
});
export type BenefitAllocationsReplace = z.infer<typeof benefitAllocationsReplace>;

export const benefitGroupCreate = z.strictObject({
  title,
  description: freeText(1, 4000).optional(),
});
export type BenefitGroupCreate = z.infer<typeof benefitGroupCreate>;

export const benefitGroupUpdate = atLeastOne({
  title: title.optional(),
  description: freeText(1, 4000).nullable().optional(),
  countedBenefitId: nullableUuid.optional(),
});
export type BenefitGroupUpdate = z.infer<typeof benefitGroupUpdate>;

export const benefitListQuery = z.strictObject({
  lifecycleStep: benefitLifecycleStep.optional(),
  status: z.enum(["active", "archived"]).optional(),
});

// ------------------------------------------------------------------------------------------------ response bodies

export const benefitAmount = z.strictObject({
  status: z.enum(["known", "unknown", "not_applicable"]),
  amount: decimal.nullable(),
  currency: currency.nullable(),
  reason: z.string().nullable(),
});
export type BenefitAmount = z.infer<typeof benefitAmount>;

export const benefitCountingStatus = z.strictObject({
  counted: z.boolean(),
  exclusionReason: benefitExclusionReason.nullable(),
  overlapOpen: z.boolean(),
});
export type BenefitCountingStatus = z.infer<typeof benefitCountingStatus>;

export const benefit = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^B[0-9]{2,6}$/),
  title: z.string(),
  description: z.string(),
  benefitType,
  valueClass: benefitValueClass,
  ownerUserId: uuid,
  financeValidatorUserId: nullableUuid,
  financeValidationRequired: z.boolean(),
  financialStatementLine: z.string().nullable(),
  measurementKpiDefinitionId: nullableUuid,
  measurementKpiVariable: z.string().nullable(),
  businessCaseLineId: nullableUuid,
  benefitFormulaId: nullableUuid,
  baselineId: nullableUuid,
  baselineValue: decimal.nullable(),
  baselineUnit: z.string().nullable(),
  baselineDate: nullableDate,
  counterfactual: z.string().nullable(),
  baselineValidationStatus: z.enum(BASELINE_VALIDATION_STATUSES),
  baselineValidatedBy: nullableUuid,
  baselineValidatedAt: nullableTimestamp,
  baselineValidationNote: z.string().nullable(),
  driverKey: z.string().nullable(),
  driverUnits: z.string().nullable(),
  populationKey: z.string().nullable(),
  targetValue: decimal.nullable(),
  targetDate: nullableDate,
  realizationStart: nullableDate,
  realizationEnd: nullableDate,
  recurrence: z.enum(BENEFIT_RECURRENCES).nullable(),
  currency,
  plannedValue: decimal.nullable(),
  valuationMethodId: nullableUuid,
  measurementSource: z.string().nullable(),
  confidence: z.enum(BENEFIT_CONFIDENCES).nullable(),
  assumptions: z.string().nullable(),
  parentBenefitId: nullableUuid,
  benefitGroupId: nullableUuid,
  allocationSetNo: z.number().int().min(0),
  lifecycleStep: benefitLifecycleStep,
  recoveryPlan: z.string().nullable(),
  bauOwnerUserId: nullableUuid,
  controlCadence: z.enum(CONTROL_CADENCES).nullable(),
  statusRag: z.enum(BENEFIT_RAG).nullable(),
  statusRagNote: z.string().nullable(),
  realizationState: benefitRealizationState,
  counting: benefitCountingStatus,
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type Benefit = z.infer<typeof benefit>;

export const benefitKpiActual = z.strictObject({
  status: z.enum(["known", "unknown", "stale", "not_applicable"]),
  value: decimal.nullable(),
  reason: z.string().nullable(),
});
export type BenefitKpiActual = z.infer<typeof benefitKpiActual>;

export const benefitRealized = z.strictObject({
  validated: benefitAmount,
  validatedCount: z.number().int().min(0),
  sustained: benefitAmount,
  sustainedCount: z.number().int().min(0),
  pending: benefitAmount,
  pendingCount: z.number().int().min(0),
  kpiActual: benefitKpiActual,
});
export type BenefitRealized = z.infer<typeof benefitRealized>;

export const benefitRegisterRow = z.strictObject({
  id: uuid,
  code: z.string(),
  title: z.string(),
  benefitType,
  valueClass: benefitValueClass,
  baseline: z.strictObject({
    value: decimal.nullable(),
    unit: z.string().nullable(),
    date: nullableDate,
    baselineId: nullableUuid,
    validationStatus: z.enum(BASELINE_VALIDATION_STATUSES),
  }),
  target: z.strictObject({ value: decimal.nullable(), date: nullableDate }),
  valueSar: benefitAmount,
  realized: benefitRealized,
  ownerUserId: uuid,
  evidenceCount: z.number().int().min(0),
  latestEvidenceIds: z.array(uuid).max(5),
  status: z.enum(["green", "amber", "red", "unknown"]),
  lifecycleStep: benefitLifecycleStep,
  realizationState: benefitRealizationState,
  counting: benefitCountingStatus,
  currency,
  version,
  // ARCH-08 / BE-M (D-106 (d)): the initiatives of the benefit's current allocation set. Inline, because
  // schemas/traceability.ts imports from this file (importing its initiativeRef here would be circular).
  initiatives: z.array(z.strictObject({ id: uuid, code: z.string(), name: z.string() })).optional(),
});
export type BenefitRegisterRow = z.infer<typeof benefitRegisterRow>;
export const benefitRegisterPage = z.strictObject({
  items: z.array(benefitRegisterRow),
  nextCursor: z.string().nullable(),
});

export const benefitLifecycle = z.strictObject({
  benefitId: uuid,
  currentStep: benefitLifecycleStep,
  steps: z
    .array(
      z.strictObject({
        code: benefitLifecycleStep,
        ordinal: z.number().int().min(1).max(6),
        stepEn: z.string(),
        questionEn: z.string(),
        outputEn: z.string(),
        stepAr: z.string(),
        questionAr: z.string(),
        outputAr: z.string(),
        arIsProvisional: z.boolean(),
        preconditionsMet: z.boolean(),
        missing: z.array(z.enum(LIFECYCLE_MISSING)),
      }),
    )
    .length(6),
  history: z.array(
    z.strictObject({
      fromStep: benefitLifecycleStep.nullable(),
      toStep: benefitLifecycleStep,
      benefitVersion: z.number().int().min(1),
      occurredAt: timestamp,
      actorUserId: uuid,
    }),
  ),
});
export type BenefitLifecycle = z.infer<typeof benefitLifecycle>;

export const benefitEnabler = z.strictObject({
  id: uuid,
  benefitId: uuid,
  initiativeId: uuid,
  deliverableId: nullableUuid,
  capabilityId: nullableUuid,
  note: z.string().nullable(),
  delivered: z.boolean(),
  status: z.enum(["active", "removed"]),
  removedAt: nullableTimestamp,
  removedBy: nullableUuid,
  removeReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitEnabler = z.infer<typeof benefitEnabler>;
export const benefitEnablerPage = z.strictObject({ items: z.array(benefitEnabler), nextCursor: z.string().nullable() });

export const benefitAllocations = z.strictObject({
  benefitId: uuid,
  setNo: z.number().int().min(0),
  allocations: z.array(z.strictObject({ initiativeId: uuid, share: decimal, basis: z.string().nullable().optional() })),
  allocatedShare: decimal,
  unallocatedShare: decimal,
});
export type BenefitAllocations = z.infer<typeof benefitAllocations>;

export const benefitGroup = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^BG-[0-9]{2,6}$/),
  title: z.string(),
  description: z.string().nullable(),
  countedBenefitId: nullableUuid,
  memberBenefitIds: z.array(uuid),
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
});
export type BenefitGroup = z.infer<typeof benefitGroup>;
export const benefitGroupPage = z.strictObject({ items: z.array(benefitGroup), nextCursor: z.string().nullable() });
