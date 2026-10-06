// P2 Diagnose mirrors (backend-workflow-engineer; ADR-0016 §1): T01 Current-State Diagnostic rows (B0031), diagnostic
// findings by workstream, workstream outputs (REQ-PB-023). Mirrors docs/api/openapi.yaml DiagnosticItem*,
// DiagnosticFinding*, WorkstreamOutput*.
import { z } from "zod";
import { currency, freeText, uuid } from "./common.ts";
import { p2ArchiveFields, p2RecordStamps } from "./direction.ts";
import { decimal, moneyDecimal } from "./kpi.ts";

// F-DG2-150: blank (whitespace-only) free text is rejected with `validation.blank`; stored exactly as entered.
const text = freeText;
const nullableUuid = uuid.nullable();
const minOne = <T extends z.ZodRawShape>(shape: T) =>
  z
    .strictObject(shape)
    .partial()
    .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

/** T01 confidence: High / Medium / Low (B0031). Anything else is rejected (400). */
export const T01_CONFIDENCES = ["H", "M", "L"] as const;
export const t01Confidence = z.enum(T01_CONFIDENCES);

// ------------------------------------------------------------------------------------------------ T01

const diagnosticItemFields = {
  currentState: text(1, 20000).nullable(),
  evidenceBaseline: text(1, 4000).nullable(),
  baselineId: nullableUuid,
  rootCause: text(1, 20000).nullable(),
  impactText: text(1, 4000).nullable(),
  impactAmount: moneyDecimal.nullable(),
  impactCurrency: currency.nullable(),
  impactKpiDefinitionId: nullableUuid,
  confidence: t01Confidence.nullable(),
  ownerUserId: nullableUuid,
};
export const diagnosticItem = z.strictObject({
  ...p2RecordStamps,
  dimensionCode: z.string(),
  isSeeded: z.boolean(),
  ...diagnosticItemFields,
  impactAmount: decimal.nullable(),
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type DiagnosticItem = z.infer<typeof diagnosticItem>;
/** Impact in SAR is a pair: an amount needs its currency and the reverse (diagnostic_item_impact_money_pair). */
const moneyPair = (v: { impactAmount?: string | null | undefined; impactCurrency?: string | null | undefined }) =>
  (v.impactAmount ?? null) === null || (v.impactCurrency ?? null) !== null;
export const diagnosticItemCreate = z
  .strictObject({ dimensionCode: z.string(), ...diagnosticItemFields })
  .partial()
  .required({ dimensionCode: true })
  .refine(moneyPair, { message: "validation.impact_currency_required", path: ["impactCurrency"] });
export const diagnosticItemUpdate = minOne(diagnosticItemFields);
export const diagnosticItemPage = z.strictObject({ items: z.array(diagnosticItem), nextCursor: z.string().nullable() });

// ------------------------------------------------------------------------------------------------ findings

export const FINDING_KINDS = ["symptom", "root_cause", "opportunity", "observation"] as const;
export const FINDING_STATUSES = ["draft", "confirmed", "rejected", "archived"] as const;
const findingFields = {
  workstreamCode: z.string(),
  diagnosticItemId: nullableUuid,
  kind: z.enum(FINDING_KINDS),
  statement: text(1, 2000),
  detail: text(1, 20000).nullable(),
  confidence: t01Confidence.nullable(),
  ownerUserId: nullableUuid,
};
export const diagnosticFinding = z.strictObject({
  ...p2RecordStamps,
  ...findingFields,
  status: z.enum(FINDING_STATUSES),
  ...p2ArchiveFields,
});
export type DiagnosticFinding = z.infer<typeof diagnosticFinding>;
export const diagnosticFindingCreate = z
  .strictObject({ ...findingFields, status: z.enum(FINDING_STATUSES) })
  .partial()
  .required({ workstreamCode: true, kind: true, statement: true });
export const diagnosticFindingUpdate = minOne({ ...findingFields, status: z.enum(FINDING_STATUSES) });
export const diagnosticFindingPage = z.strictObject({
  items: z.array(diagnosticFinding),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ workstream outputs

export const WORKSTREAM_OUTPUT_RECORD_TYPES = [
  "diagnostic_item",
  "diagnostic_finding",
  "baseline",
  "value_pool",
  "capability",
  "journey",
  "kpi_definition",
] as const;
const workstreamOutputFields = {
  workstreamCode: z.string(),
  title: text(1, 300),
  outputKind: text(1, 100).nullable(),
  recordType: z.enum(WORKSTREAM_OUTPUT_RECORD_TYPES).nullable(),
  recordId: nullableUuid,
  evidenceId: nullableUuid,
  note: text(1, 4000).nullable(),
};
export const workstreamOutput = z.strictObject({
  ...p2RecordStamps,
  ...workstreamOutputFields,
  status: z.enum(["active", "archived"]),
  ...p2ArchiveFields,
});
export type WorkstreamOutput = z.infer<typeof workstreamOutput>;
export const workstreamOutputCreate = z
  .strictObject(workstreamOutputFields)
  .partial()
  .required({ workstreamCode: true, title: true });
export const workstreamOutputUpdate = minOne(workstreamOutputFields);
export const workstreamOutputPage = z.strictObject({
  items: z.array(workstreamOutput),
  nextCursor: z.string().nullable(),
});
