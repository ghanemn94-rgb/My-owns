// P4 slice H mirrors of change control (backend-workflow-engineer, T-DG4-BE-L; ADR-0036; OpenAPI 1.3.0-p4
// ChangeControlPolicy*, ChangeRequest*, ImpactItem, ImpactPreview, ImpactAssessment*). REQ-S04-014, REQ-S07-015,
// REQ-S09-010, REQ-S16-018 (ChangeRequest), REQ-PB-065 (the change-request routing half).
//
// - A change request is decided by a person through the canonical approval (approval type `change_request`); nothing
//   here approves anything, and nothing touches the engineering gates DG0-DG7.
// - `proposedChange` is validated per kind (ADR-0036 §2) by `proposedChangeSchema`: every changed field is
//   `{ from, to }`; decimals are strings (never JSON numbers); an optional `effectiveFrom` business date names when the
//   change takes effect (a past date is a retrospective restatement, refused 422 in DG4).
// - Materiality (ADR-0036 §3) is the pure `materialityOf`: decimal.js for ratios, the working-day calendar for dates.
//   No threshold (no policy row, or NULL) means every change is material; Unknown is never "not material".
import { Decimal } from "decimal.js";
import { z } from "zod";
import { computeWorkingDaySlip } from "../schedule/working-day-slip.ts";
import type { WorkingCalendar } from "../time/working-days.ts";
import { currency, freeText, page, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

// ------------------------------------------------------------------------------------------------ enums

export const CHANGE_KINDS = [
  "business_scope",
  "baseline",
  "target",
  "tom",
  "cost",
  "benefit_logic",
  "kpi_definition",
  "schedule_rebaseline",
  "budget_rebaseline",
] as const;
export const changeKind = z.enum(CHANGE_KINDS);
export type ChangeKind = z.infer<typeof changeKind>;

export const CHANGE_SUBJECT_TYPES = [
  "charter",
  "kpi_definition",
  "outcome_kpi",
  "tom_canvas_cell",
  "initiative",
  "benefit_formula",
  "milestone",
  "budget_line",
] as const;
export const changeSubjectType = z.enum(CHANGE_SUBJECT_TYPES);
export type ChangeSubjectType = z.infer<typeof changeSubjectType>;

export const CHANGE_REQUEST_STATUSES = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export const changeRequestStatus = z.enum(CHANGE_REQUEST_STATUSES);
export type ChangeRequestStatus = z.infer<typeof changeRequestStatus>;

export const proposedRecordType = z.enum(["kpi_version", "benefit_formula_version"]);

/** Which subjects each kind names (the 0052 CHECK change_request_kind_subject, ADR-0036 §2). */
export const KIND_SUBJECTS: ReadonlyMap<ChangeKind, readonly ChangeSubjectType[]> = new Map<
  ChangeKind,
  readonly ChangeSubjectType[]
>([
  ["business_scope", ["charter", "initiative"]],
  ["baseline", ["kpi_definition", "outcome_kpi"]],
  ["target", ["kpi_definition", "outcome_kpi"]],
  ["kpi_definition", ["kpi_definition"]],
  ["tom", ["tom_canvas_cell"]],
  ["cost", ["initiative", "budget_line"]],
  ["benefit_logic", ["benefit_formula"]],
  ["schedule_rebaseline", ["milestone"]],
  ["budget_rebaseline", ["budget_line"]],
]);

export function kindAppliesTo(kind: ChangeKind, subjectType: ChangeSubjectType): boolean {
  return (KIND_SUBJECTS.get(kind) ?? []).includes(subjectType);
}

// ------------------------------------------------------------------------------------------------ refusals (ADR-0036 §10)

/** The exact English texts of ADR-0036 §10 (S-11); the code is the i18n key. */
export const CHANGE_CONTROL_REFUSALS = {
  "change_request.kind_subject_mismatch": "This kind of change does not apply to that record.",
  "change_request.subject_not_approved":
    "Only an approved record goes through change control; edit the draft directly.",
  "change_request.already_open": "This record already has an open change request ({code}).",
  "change_request.reason_required": "A reason is required for a change request.",
  "change_request.proposed_change_invalid": "The proposed change does not match the fields of this kind of change.",
  "change_request.not_editable": "Only a draft change request, or one returned for changes, can be edited.",
  "change_request.not_submittable": "Only a draft change request, or one returned for changes, can be submitted.",
  "change_request.not_withdrawable": "A decided change request cannot be withdrawn.",
  "change_request.subject_moved":
    "The record changed after this request was submitted; withdraw it and raise a new one.",
  "change_request.retrospective_not_supported":
    "A retrospective restatement is not supported; changes take effect from now on.",
  "change_request.not_requester": "Only the requester or the transformation lead can change this request.",
  "kpi_version.change_request_required":
    "This KPI already has an active version; changing its definition, baseline or target needs an approved change request.",
  "milestone.rebaseline_requires_change_request":
    "This date change exceeds the material threshold; raise a change request to rebaseline it.",
  "budget_line.rebaseline_requires_change_request":
    "This budget change exceeds the material threshold; raise a change request to rebaseline it.",
  "change_control.threshold_invalid": "Thresholds are a number of working days from 0 to 250 and a ratio from 0 to 10.",
} as const;
export type ChangeControlRefusalCode = keyof typeof CHANGE_CONTROL_REFUSALS;

// ------------------------------------------------------------------------------------------------ policy

/** OpenAPI `ChangeControlPolicy` (version 0 and null stamps when none is configured). */
export const changeControlPolicy = z.strictObject({
  transformationId: uuid,
  materialDateShiftWorkingDays: z.number().int().min(0).max(250).nullable(),
  materialBudgetChangeRatio: decimal.nullable(),
  note: z.string().min(1).max(2000).nullable(),
  version: z.number().int().min(0),
  updatedAt: nullableTimestamp,
  updatedBy: nullableUuid,
});
export type ChangeControlPolicy = z.infer<typeof changeControlPolicy>;

/**
 * OpenAPI `ChangeControlPolicyUpdate`. The range checks are the API's 422 `change_control.threshold_invalid` (ADR-0036
 * §10), so the shape accepts any integer and any decimal here.
 */
export const changeControlPolicyUpdate = z.strictObject({
  materialDateShiftWorkingDays: z.number().int().nullable(),
  materialBudgetChangeRatio: decimal.nullable(),
  note: freeText(1, 2000).nullable().optional(),
});
export type ChangeControlPolicyUpdate = z.infer<typeof changeControlPolicyUpdate>;

/** The ratio range 0..10 with at most 6 fraction digits (numeric(9,6)). */
export function ratioInRange(value: string): boolean {
  if (!/^[0-9]{1,2}(\.[0-9]{1,6})?$/.test(value)) return false;
  const d = new Decimal(value);
  return d.gte(0) && d.lte(10);
}

// ------------------------------------------------------------------------------------------------ proposed change

const textChange = z.strictObject({ from: z.string().max(20000).nullable(), to: freeText(1, 20000).nullable() });
const decimalChange = z.strictObject({ from: decimal.nullable(), to: decimal.nullable() });
const dateChange = z.strictObject({ from: businessDate.nullable(), to: businessDate });
const effectiveFrom = businessDate.optional();

const atLeastOne = (keys: readonly string[]) => (v: Record<string, unknown>) => {
  const present = new Map(Object.entries(v));
  return keys.some((k) => present.get(k) !== undefined);
};

/** The KPI-version fields a baseline/target/definition change may name (ADR-0027 version content). */
export const KPI_VERSION_CHANGE_FIELDS = [
  "baselineValue",
  "baselineDate",
  "targetValue",
  "targetDate",
  "formulaExpression",
  "calculationMethod",
  "aggregationRule",
  "definitionText",
  "dataSource",
  "polarity",
] as const;

const KPI_CHANGE_KEYS: ReadonlySet<string> = new Set<string>([...KPI_VERSION_CHANGE_FIELDS, "effectiveFrom"]);
const fromTo = z.strictObject({ from: z.unknown(), to: z.unknown() });
/** `{ field: { from, to } }` over the KPI-version fields, plus an optional `effectiveFrom` business date. */
const kpiVersionChange = z.record(z.string(), z.unknown()).superRefine((v, ctx) => {
  for (const [k, x] of Object.entries(v)) {
    const ok = !KPI_CHANGE_KEYS.has(k)
      ? false
      : k === "effectiveFrom"
        ? businessDate.safeParse(x).success
        : fromTo.safeParse(x).success;
    if (!ok) ctx.addIssue({ code: "custom", path: [k], message: "validation.proposed_change" });
  }
});

/**
 * The zod shape of `proposedChange` for a kind and subject (ADR-0036 §2), or null when the kind does not apply to the
 * subject. Every member is `{ from, to }`; at least one changed field is required.
 */
export function proposedChangeSchema(kind: ChangeKind, subjectType: ChangeSubjectType): z.ZodType | null {
  if (!kindAppliesTo(kind, subjectType)) return null;
  switch (kind) {
    case "business_scope": {
      const keys = subjectType === "charter" ? ["scopeIn", "scopeOut"] : ["scopeIn", "scopeOut", "name", "objective"];
      const shape =
        subjectType === "charter"
          ? { scopeIn: textChange.optional(), scopeOut: textChange.optional(), effectiveFrom }
          : {
              scopeIn: textChange.optional(),
              scopeOut: textChange.optional(),
              name: z.strictObject({ from: z.string().nullable(), to: freeText(1, 200) }).optional(),
              objective: textChange.optional(),
              effectiveFrom,
            };
      return z.strictObject(shape).refine(atLeastOne(keys));
    }
    case "baseline":
    case "target":
    case "kpi_definition":
      if (subjectType === "outcome_kpi")
        return z
          .strictObject({
            baselineValue: decimalChange.optional(),
            targetValue: decimalChange.optional(),
            targetDate: dateChange.optional(),
            effectiveFrom,
          })
          .refine(atLeastOne(["baselineValue", "targetValue", "targetDate"]));
      return kpiVersionChange.refine((v) => Object.keys(v).some((k) => k !== "effectiveFrom"));
    case "tom":
      return z.strictObject({ targetDesign: textChange, effectiveFrom });
    case "cost":
    case "budget_rebaseline":
      return z.strictObject({ budgetAmount: decimalChange, currency, effectiveFrom });
    case "benefit_logic":
      return z.strictObject({
        fromVersionNo: z.number().int().min(1).nullable(),
        toVersionNo: z.number().int().min(1),
        effectiveFrom,
      });
    case "schedule_rebaseline":
      return z.strictObject({ approvedDate: dateChange, effectiveFrom });
  }
}

// ------------------------------------------------------------------------------------------------ change requests

/** OpenAPI `ChangeRequestCreate` (also the body of previewChangeImpact). */
export const changeRequestCreate = z.strictObject({
  changeKind,
  subjectType: changeSubjectType,
  subjectId: uuid,
  subjectVersion: z.number().int().min(1),
  proposedRecordType: proposedRecordType.optional(),
  proposedRecordId: uuid.optional(),
  proposedChange: z
    .record(z.string(), z.unknown())
    .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 20, "validation.proposed_change_size"),
  reason: freeText(3, 4000),
});
export type ChangeRequestCreate = z.infer<typeof changeRequestCreate>;

/** OpenAPI `ChangeRequestUpdate` (at least one member). */
export const changeRequestUpdate = z
  .strictObject({
    proposedRecordId: uuid.optional(),
    proposedChange: z
      .record(z.string(), z.unknown())
      .refine((o) => Object.keys(o).length >= 1 && Object.keys(o).length <= 20, "validation.proposed_change_size")
      .optional(),
    reason: freeText(3, 4000).optional(),
    subjectVersion: z.number().int().min(1).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type ChangeRequestUpdate = z.infer<typeof changeRequestUpdate>;

/** OpenAPI `ChangeRequest`. */
export const changeRequest = z.strictObject({
  id: uuid,
  transformationId: uuid,
  code: z.string().regex(/^CR-[0-9]{2,}$/),
  changeKind,
  subjectType: changeSubjectType,
  subjectId: uuid,
  subjectVersion: z.number().int().min(1),
  proposedRecordType: proposedRecordType.nullable(),
  proposedRecordId: nullableUuid,
  proposedChange: z.record(z.string(), z.unknown()),
  reason: z.string().min(3).max(4000),
  origin: z.enum(["manual", "automatic"]),
  materiality: z.enum(["material", "not_material"]).nullable(),
  materialityBasis: z.record(z.string(), z.unknown()).nullable(),
  routePartyCode: z.string().nullable(),
  decisionRightId: nullableUuid,
  approvalId: nullableUuid,
  status: changeRequestStatus,
  raisedBy: uuid,
  submittedBy: nullableUuid,
  submittedAt: nullableTimestamp,
  currentImpactAssessmentId: nullableUuid,
  decidedAt: nullableTimestamp,
  appliedAt: nullableTimestamp,
  appliedRecordType: z.string().nullable(),
  appliedRecordId: nullableUuid,
  appliedVersion: z.number().int().min(1).nullable(),
  withdrawnAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type ChangeRequest = z.infer<typeof changeRequest>;
export const changeRequestPage = page(changeRequest);

// ------------------------------------------------------------------------------------------------ impact

export const IMPACT_ITEM_TYPES = [
  "outcome",
  "kpi",
  "benefit",
  "gate",
  "report",
  "formula",
  "initiative",
  "milestone",
  "business_case",
  "budget_line",
] as const;
export const IMPACT_EFFECTS = ["value_changes", "recalculation", "reapproval_required", "informational"] as const;

/** OpenAPI `ImpactItem`. */
export const impactItem = z.strictObject({
  ordinal: z.number().int().min(1),
  itemType: z.enum(IMPACT_ITEM_TYPES),
  recordType: z.string().nullable(),
  recordId: nullableUuid,
  recordCode: z.string().min(1).max(50).nullable(),
  label: z.string().min(1).max(300),
  effect: z.enum(IMPACT_EFFECTS),
  gateSubmissionId: nullableUuid,
  gateDecisionId: nullableUuid,
  detail: z.record(z.string(), z.unknown()),
});
export type ImpactItem = z.infer<typeof impactItem>;

/** OpenAPI `ImpactPreview`. */
export const impactPreview = z.strictObject({
  materiality: z.enum(["material", "not_material"]),
  materialityBasis: z.record(z.string(), z.unknown()),
  items: z.array(impactItem),
  hiddenItemCount: z.number().int().min(0),
});
export type ImpactPreview = z.infer<typeof impactPreview>;

/** OpenAPI `ImpactAssessment`. */
export const impactAssessment = z.strictObject({
  id: uuid,
  transformationId: uuid,
  changeRequestId: uuid,
  changeRequestVersion: z.number().int().min(1),
  itemCount: z.number().int().min(0),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  assessedAt: timestamp,
  assessedBy: uuid,
  items: z.array(impactItem),
});
export type ImpactAssessment = z.infer<typeof impactAssessment>;
export const impactAssessmentPage = page(impactAssessment);

// ------------------------------------------------------------------------------------------------ materiality (ADR-0036 §3)

export interface MaterialityPolicy {
  /** null = no threshold: every date change is material. */
  readonly materialDateShiftWorkingDays: number | null;
  /** Decimal string fraction; null = no threshold: every cost change is material. */
  readonly materialBudgetChangeRatio: string | null;
}

export interface Materiality {
  readonly materiality: "material" | "not_material";
  readonly basis: Record<string, unknown>;
}

/** A schedule shift in working days between the approved and the proposed date (ADR-0025 calendar). */
export function dateShiftMateriality(
  fromDate: string | null,
  toDate: string,
  calendar: WorkingCalendar | null,
  threshold: number | null,
): Materiality {
  const slip = computeWorkingDaySlip(fromDate, toDate, calendar);
  if (slip.status !== "known")
    return {
      materiality: "material",
      basis: { rule: "date_shift", shiftWorkingDays: null, reason: slip.reason, threshold },
    };
  const shift = Math.abs(slip.value);
  if (threshold === null)
    return {
      materiality: "material",
      basis: { rule: "date_shift", shiftWorkingDays: shift, threshold: null, reason: "no_threshold" },
    };
  return {
    materiality: shift > threshold ? "material" : "not_material",
    basis: { rule: "date_shift", shiftWorkingDays: shift, threshold, reason: null },
  };
}

/** A budget change ratio |to − from| / |from| in decimal.js; Unknown or zero `from` is material, never a ratio of 0. */
export function budgetChangeMateriality(from: string | null, to: string | null, threshold: string | null): Materiality {
  if (from === null || to === null || new Decimal(from).isZero())
    return {
      materiality: "material",
      basis: {
        rule: "budget_ratio",
        ratio: null,
        threshold,
        reason: from === null || to === null ? "unknown_value" : "zero_base",
      },
    };
  const ratio = new Decimal(to).minus(from).abs().dividedBy(new Decimal(from).abs());
  const ratioText = ratio.toDecimalPlaces(6, Decimal.ROUND_HALF_UP).toFixed(6);
  if (threshold === null)
    return {
      materiality: "material",
      basis: { rule: "budget_ratio", ratio: ratioText, threshold: null, reason: "no_threshold" },
    };
  return {
    materiality: ratio.gt(new Decimal(threshold)) ? "material" : "not_material",
    basis: { rule: "budget_ratio", ratio: ratioText, threshold, reason: null },
  };
}
