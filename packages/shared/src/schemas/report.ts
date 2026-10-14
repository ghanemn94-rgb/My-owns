// P5 slice F (T-DG5-KBE-C; ADR-0045 §1-§5, §11-§12; p5-work-split §F.1): report definitions, the report document model
// (content schema version 1), the `registers` parameters and the report-snapshot API mirrors.
//
// Rules this module encodes (reviewers check them):
//  - Every value carries its `validation` (validated, provisional, unknown, stale, not_applicable). A value is null
//    EXACTLY when it is unknown or stale, and then it has a `reason` (missing, stale, not_computable): Unknown and Stale
//    never travel as 0, and a number never travels without its state (ADR-0045 §5, §12; shared rule 5).
//  - Numbers are canonical decimal strings with a unit kind (ADR-0037 N5); money states its currency; a benefit value
//    states its value basis, and one table column never mixes value bases or currencies (D-117, D-119, D-122).
//  - Labels are i18n keys (`titleKey`, `labelKey`) translated at render time; user-authored text is stored as authored.
//  - Nothing here grants or records a business approval: `approvalState` is the recorded state of the sources. Product
//    gates G1-G6 are business approvals inside the product and are unrelated to the engineering gates DG0-DG7.
import { z } from "zod";
import { DECIMAL_PATTERN } from "../value.ts";
import { benefitListQuery } from "./benefits.ts";
import { freeText, timestamp, uuid, version } from "./common.ts";
import { decisionKind, decisionStatus } from "./decision.ts";
import { businessDate, KPI_UNIT_KINDS } from "./kpi.ts";
import { tomDimensionCode } from "./methodology.ts";
import { raidEntryType, raidStatus } from "./raid.ts";

// ------------------------------------------------------------------------------------------------ closed sets

export const REPORT_DEFINITION_CODES = [
  "charter",
  "diagnostic",
  "tom",
  "business_cases",
  "roadmap",
  "registers",
  "meeting_minutes",
  "gate_pack",
  "executive_dashboard",
  "handover",
  "executive_pack",
  "meeting_pack",
] as const;
export const reportDefinitionCode = z.enum(REPORT_DEFINITION_CODES);
export type ReportDefinitionCode = z.infer<typeof reportDefinitionCode>;

export const REPORT_SUBJECT_TYPES = [
  "transformation",
  "meeting",
  "gate_instance",
  "business_case",
  "bau_handover",
] as const;
export const reportSubjectType = z.enum(REPORT_SUBJECT_TYPES);
export type ReportSubjectType = z.infer<typeof reportSubjectType>;

export const REPORT_FORMATS = ["pdf", "docx", "xlsx", "pptx", "csv"] as const;
export const REPORT_OUTPUT_KINDS = ["generated_output", "executive_pack", "meeting_pack"] as const;

/** The snapshot approval state (ADR-0045 §3): recorded facts about the sources, never an approval. */
export const REPORT_APPROVAL_STATES = [
  "approved",
  "pending",
  "not_submitted",
  "changes_requested",
  "rejected",
  "mixed",
  "not_applicable",
] as const;
export const reportApprovalState = z.enum(REPORT_APPROVAL_STATES);
export type ReportApprovalState = z.infer<typeof reportApprovalState>;
/** A source record's approval state: the same set without `mixed` (null when the record type has none). */
export const REPORT_SOURCE_APPROVAL_STATES = REPORT_APPROVAL_STATES.filter((s) => s !== "mixed") as Exclude<
  ReportApprovalState,
  "mixed"
>[];
export const reportSourceApprovalState = z.enum(
  REPORT_SOURCE_APPROVAL_STATES as [Exclude<ReportApprovalState, "mixed">, ...Exclude<ReportApprovalState, "mixed">[]],
);
export type ReportSourceApprovalState = z.infer<typeof reportSourceApprovalState>;

/** ADR-0045 §5: the validation label of every value. */
export const REPORT_VALIDATIONS = ["validated", "provisional", "unknown", "stale", "not_applicable"] as const;
export const reportValidation = z.enum(REPORT_VALIDATIONS);
export type ReportValidation = z.infer<typeof reportValidation>;
/** Why a value has no number (ADR-0045 §3). */
export const REPORT_VALUE_REASONS = ["missing", "stale", "not_computable"] as const;
export const reportValueReason = z.enum(REPORT_VALUE_REASONS);
export type ReportValueReason = z.infer<typeof reportValueReason>;

/** The unit kind of a decimal value: the KPI unit kinds of ADR-0037 N5 (`currency` for money). */
export const reportUnitKind = z.enum(KPI_UNIT_KINDS);
export type ReportUnitKind = z.infer<typeof reportUnitKind>;

/**
 * The value basis of a number (D-117, D-119, D-122): a column holds one basis only. `planned` is a plan figure,
 * `submitted` a value awaiting Finance validation (pending), `validated` and `sustained` Finance-validated realized
 * value, `baseline`/`target` the reference points, `actual` a KPI actual.
 */
export const REPORT_VALUE_BASES = [
  "planned",
  "forecast",
  "submitted",
  "validated",
  "sustained",
  "baseline",
  "target",
  "actual",
] as const;
export const reportValueBasis = z.enum(REPORT_VALUE_BASES);
export type ReportValueBasis = z.infer<typeof reportValueBasis>;

export const REPORT_SECTION_KINDS = ["fields", "table", "text", "metrics", "list"] as const;
export const REPORT_VALUE_TYPES = ["text", "decimal", "date", "timestamp", "code", "count"] as const;

/** Section and record keys (the `report_snapshot_source.section_key` / `record_type` patterns of 0080). */
export const reportSectionKey = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const reportRecordType = z.string().regex(/^[a-z][a-z0-9_]{1,63}$/);
/** An i18n key (dot/underscore separated lower-case segments). */
export const reportI18nKey = z.string().regex(/^[a-z][a-zA-Z0-9_]*(\.[a-zA-Z0-9_]+)+$/);

/** At most 5,000 rows per table section (ADR-0045 §1); above it generation is refused with 422 report.too_large. */
export const REPORT_MAX_TABLE_ROWS = 5000;
/** At most 10 MiB of canonical JSON content (ADR-0045 §1). */
export const REPORT_MAX_CONTENT_BYTES = 10 * 1024 * 1024;
/** At most 8 KiB of parameters (the 0080 CHECK on `report_snapshot.parameters`). */
export const REPORT_MAX_PARAMETER_BYTES = 8192;
export const REPORT_CONTENT_SCHEMA_VERSION = 1;

// ------------------------------------------------------------------------------------------------ values

const stateFields = {
  validation: reportValidation,
  reason: reportValueReason.nullable(),
};

/**
 * Unknown and stale: no value, with a reason. Validated and provisional: a value, no reason. Not applicable: no reason,
 * and a value only when the field has one (null is "n/a", e.g. the money value of an unmonetised non-financial benefit).
 */
function stateRule(v: { value: unknown; validation: ReportValidation; reason: ReportValueReason | null }): boolean {
  if (v.validation === "unknown" || v.validation === "stale") return v.value === null && v.reason !== null;
  if (v.validation === "not_applicable") return v.reason === null;
  return v.value !== null && v.reason === null;
}
const STATE_RULE_MESSAGE = "report.value_state";

const textValue = z.strictObject({
  type: z.literal("text"),
  value: z.string().max(20000).nullable(),
  authored: z.enum(["user", "system"]),
  ...stateFields,
});
const decimalValue = z.strictObject({
  type: z.literal("decimal"),
  value: z.string().regex(DECIMAL_PATTERN).nullable(),
  unitKind: reportUnitKind,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  valueBasis: reportValueBasis.nullable(),
  ...stateFields,
});
const dateValue = z.strictObject({ type: z.literal("date"), value: businessDate.nullable(), ...stateFields });
const timestampValue = z.strictObject({ type: z.literal("timestamp"), value: timestamp.nullable(), ...stateFields });
const codeValue = z.strictObject({
  type: z.literal("code"),
  value: z.string().min(1).max(100).nullable(),
  labelKey: reportI18nKey.nullable(),
  ...stateFields,
});
const countValue = z.strictObject({
  type: z.literal("count"),
  value: z.number().int().min(0).nullable(),
  ...stateFields,
});

export const reportValue = z
  .discriminatedUnion("type", [textValue, decimalValue, dateValue, timestampValue, codeValue, countValue])
  .refine(stateRule, STATE_RULE_MESSAGE)
  .refine((v) => v.type !== "decimal" || v.unitKind !== "currency" || v.value === null || v.currency !== null, {
    message: "report.currency_required",
  });
export type ReportValue = z.infer<typeof reportValue>;

// ------------------------------------------------------------------------------------------------ sections

export const reportRecordRef = z.strictObject({
  recordType: reportRecordType,
  recordId: uuid,
  recordVersion: version,
});
export type ReportRecordRef = z.infer<typeof reportRecordRef>;

export const reportField = z.strictObject({ key: reportSectionKey, labelKey: reportI18nKey, value: reportValue });
export type ReportField = z.infer<typeof reportField>;

export const reportColumn = z.strictObject({
  key: reportSectionKey,
  labelKey: reportI18nKey,
  valueKind: z.enum(REPORT_VALUE_TYPES),
  unitKind: reportUnitKind.nullable(),
});
export type ReportColumn = z.infer<typeof reportColumn>;

export const reportRow = z.strictObject({
  recordType: reportRecordType,
  recordId: uuid,
  recordVersion: version,
  cells: z.array(reportValue),
});
export type ReportRow = z.infer<typeof reportRow>;

export const reportTotal = z.strictObject({
  columnKey: reportSectionKey,
  formula: z.literal("sum"),
  value: reportValue,
});
export type ReportTotal = z.infer<typeof reportTotal>;

const sectionBase = {
  key: reportSectionKey,
  titleKey: reportI18nKey,
  sources: z.array(reportRecordRef),
};

const fieldsSection = z.strictObject({ ...sectionBase, kind: z.literal("fields"), fields: z.array(reportField) });
const metricsSection = z.strictObject({ ...sectionBase, kind: z.literal("metrics"), fields: z.array(reportField) });
const textSection = z.strictObject({ ...sectionBase, kind: z.literal("text"), text: reportValue });
const listSection = z.strictObject({
  ...sectionBase,
  kind: z.literal("list"),
  items: z.array(z.strictObject({ record: reportRecordRef.nullable(), value: reportValue })),
  emptyKey: reportI18nKey.nullable(),
});
const tableSection = z
  .strictObject({
    ...sectionBase,
    kind: z.literal("table"),
    columns: z.array(reportColumn).min(1),
    rows: z.array(reportRow).max(REPORT_MAX_TABLE_ROWS),
    totals: z.array(reportTotal),
    emptyKey: reportI18nKey.nullable(),
  })
  .superRefine((s, ctx) => {
    const kinds = new Map(s.columns.map((c) => [c.key, c] as const));
    s.rows.forEach((r, i) => {
      if (r.cells.length !== s.columns.length) {
        ctx.addIssue({ code: "custom", message: "report.row_width", path: ["rows", i, "cells"] });
        return;
      }
      r.cells.forEach((cell, j) => {
        if (cell.type !== s.columns[j]!.valueKind)
          ctx.addIssue({ code: "custom", message: "report.cell_kind", path: ["rows", i, "cells", j] });
      });
    });
    // One unit kind and one value basis per decimal column (never mixed: D-117, D-119, D-122). Each cell states its own
    // currency; a column with a total must also hold one currency, because currencies are never summed.
    const totalled = new Set(s.totals.map((t) => t.columnKey));
    s.columns.forEach((c, j) => {
      if (c.valueKind !== "decimal") return;
      const seen = { currency: new Set<string>(), basis: new Set<string>(), unit: new Set<string>() };
      for (const r of s.rows) {
        const cell = r.cells[j];
        if (cell === undefined || cell.type !== "decimal") continue;
        seen.unit.add(cell.unitKind);
        seen.basis.add(cell.valueBasis ?? "-");
        if (cell.currency !== null) seen.currency.add(cell.currency);
      }
      if (seen.unit.size > 1 || seen.basis.size > 1 || (totalled.has(c.key) && seen.currency.size > 1))
        ctx.addIssue({ code: "custom", message: "report.column_mixed", path: ["columns", j] });
    });
    for (const t of s.totals)
      if (!kinds.has(t.columnKey) || kinds.get(t.columnKey)!.valueKind !== "decimal")
        ctx.addIssue({ code: "custom", message: "report.total_column", path: ["totals"] });
  });

export const reportSection = z.union([fieldsSection, metricsSection, textSection, listSection, tableSection]);
export type ReportSection = z.infer<typeof reportSection>;
export type ReportTableSection = z.infer<typeof tableSection>;

// ------------------------------------------------------------------------------------------------ document

export const reportPeriodRef = z.strictObject({
  id: uuid,
  label: z.string().min(1).max(32),
  start: businessDate,
  end: businessDate,
});

/** The document model, content schema version 1 (ADR-0045 §3; OpenAPI `ReportDocument`). */
export const reportDocument = z.strictObject({
  schemaVersion: z.literal(REPORT_CONTENT_SCHEMA_VERSION),
  definitionCode: reportDefinitionCode,
  transformation: z.strictObject({ id: uuid, code: z.string().min(1).max(64), name: z.string().min(1).max(400) }),
  subject: z.strictObject({
    type: reportSubjectType,
    id: uuid,
    code: z.string().min(1).max(64).nullable(),
    label: z.string().min(1).max(400),
  }),
  period: reportPeriodRef.nullable(),
  asOf: timestamp,
  methodology: z.strictObject({ versionId: uuid, key: z.string().min(1).max(120), versionNo: version }),
  approvalState: reportApprovalState,
  sections: z.array(reportSection),
});
export type ReportDocument = z.infer<typeof reportDocument>;

// ------------------------------------------------------------------------------------------------ registers parameters

/**
 * The `registers` parameters (ADR-0045 §1): one register and the filters of its DG2-DG4 list route (the same members
 * as the route's query, without cursor and limit; booleans as JSON booleans, because the parameters are a JSON object).
 */
export const REPORT_REGISTERS = ["raid", "benefits", "kpis", "decisions", "dependencies", "actions"] as const;
export const reportRegister = z.enum(REPORT_REGISTERS);
export type ReportRegister = z.infer<typeof reportRegister>;

export const raidRegisterFilters = z.strictObject({
  type: raidEntryType.optional(),
  status: raidStatus.optional(),
  ownerUserId: uuid.optional(),
});
export const benefitsRegisterFilters = benefitListQuery;
export const kpisRegisterFilters = z.strictObject({ includeArchived: z.boolean().optional() });
export const decisionsRegisterFilters = z.strictObject({
  kind: decisionKind.optional(),
  status: decisionStatus.optional(),
  tomDimensionCode: tomDimensionCode.optional(),
});
export const dependenciesRegisterFilters = z.strictObject({
  initiativeId: uuid.optional(),
  includeArchived: z.boolean().optional(),
});
export const actionsRegisterFilters = z.strictObject({
  sourceKind: z.enum(["workshop", "raid_entry", "dependency", "corrective_case", "none"]).optional(),
  ownerUserId: uuid.optional(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  overdue: z.boolean().optional(),
});

export const registersReportParameters = z.discriminatedUnion("register", [
  z.strictObject({ register: z.literal("raid"), filters: raidRegisterFilters.default({}) }),
  z.strictObject({ register: z.literal("benefits"), filters: benefitsRegisterFilters.default({}) }),
  z.strictObject({ register: z.literal("kpis"), filters: kpisRegisterFilters.default({}) }),
  z.strictObject({ register: z.literal("decisions"), filters: decisionsRegisterFilters.default({}) }),
  z.strictObject({ register: z.literal("dependencies"), filters: dependenciesRegisterFilters.default({}) }),
  z.strictObject({ register: z.literal("actions"), filters: actionsRegisterFilters.default({}) }),
]);
export type RegistersReportParameters = z.infer<typeof registersReportParameters>;

/** Outputs other than `registers` take no settings (an empty object). */
export const emptyReportParameters = z.strictObject({});

// ------------------------------------------------------------------------------------------------ requests

export const reportGenerate = z.strictObject({
  subjectId: uuid.optional(),
  reportingPeriodId: uuid.optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
});
export type ReportGenerate = z.infer<typeof reportGenerate>;

export const reportSnapshotIssue = z.strictObject({ note: freeText(1, 1000).nullable().optional() });
export const reportSnapshotReason = z.strictObject({ reason: freeText(3, 1000) });

// ------------------------------------------------------------------------------------------------ responses

export const reportDefinition = z.strictObject({
  code: reportDefinitionCode,
  ordinal: z.number().int().min(1),
  outputKind: z.enum(REPORT_OUTPUT_KINDS),
  subjectType: reportSubjectType,
  needsReportingPeriod: z.boolean(),
  formats: z.array(z.enum(REPORT_FORMATS)).min(1).max(5),
  labelEn: z.string(),
  labelAr: z.string(),
  descriptionEn: z.string(),
  descriptionAr: z.string(),
  sourceRef: z.string(),
  playbookRef: z.string().nullable(),
});
export type ReportDefinition = z.infer<typeof reportDefinition>;
export const reportDefinitionList = z.strictObject({ items: z.array(reportDefinition) });

export const liveReport = z.strictObject({ snapshotId: z.null(), document: reportDocument });
export type LiveReport = z.infer<typeof liveReport>;

export const REPORT_SNAPSHOT_STATUSES = ["generated", "issued", "superseded", "discarded"] as const;
export const reportSnapshotStatus = z.enum(REPORT_SNAPSHOT_STATUSES);

export const reportSnapshotSummary = z.strictObject({
  id: uuid,
  transformationId: uuid,
  definitionCode: reportDefinitionCode,
  subjectType: reportSubjectType,
  subjectId: uuid,
  reportingPeriodId: uuid.nullable(),
  periodLabel: z.string().nullable(),
  periodStart: businessDate.nullable(),
  periodEnd: businessDate.nullable(),
  asOf: timestamp,
  methodologyVersionId: uuid,
  approvalState: reportApprovalState,
  provisionalValueCount: z.number().int().min(0),
  unknownValueCount: z.number().int().min(0),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  seriesId: uuid,
  reissueOfId: uuid.nullable(),
  reissueReason: z.string().min(3).max(1000).nullable(),
  status: reportSnapshotStatus,
  issueVersion: z.number().int().min(1).nullable(),
  issuedAt: timestamp.nullable(),
  issuedBy: uuid.nullable(),
  issueNote: z.string().min(1).max(1000).nullable(),
  supersededAt: timestamp.nullable(),
  supersededById: uuid.nullable(),
  discardedAt: timestamp.nullable(),
  discardedBy: uuid.nullable(),
  discardReason: z.string().min(3).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
});
export type ReportSnapshotSummary = z.infer<typeof reportSnapshotSummary>;

export const reportSnapshot = reportSnapshotSummary.extend({
  parameters: z.record(z.string(), z.unknown()),
  content: reportDocument,
});
export type ReportSnapshot = z.infer<typeof reportSnapshot>;

export const reportSnapshotPage = z.strictObject({
  items: z.array(reportSnapshotSummary),
  nextCursor: z.string().nullable(),
});

export const reportSnapshotSource = z.strictObject({
  id: uuid,
  sectionKey: z.string(),
  recordType: z.string(),
  recordId: uuid,
  recordVersion: z.number().int().min(1),
  recordUpdatedAt: timestamp.nullable(),
  approvalState: reportSourceApprovalState.nullable(),
  validationState: reportValidation,
});
export type ReportSnapshotSource = z.infer<typeof reportSnapshotSource>;
export const reportSnapshotSourcePage = z.strictObject({
  items: z.array(reportSnapshotSource),
  nextCursor: z.string().nullable(),
});

export const REPORT_VERSION_KINDS = [
  "methodology_version",
  "config_version",
  "kpi_version",
  "formula_version",
  "weight_set",
  "calculation_engine",
  "scoring_scheme",
] as const;
export const reportVersionKind = z.enum(REPORT_VERSION_KINDS);
export type ReportVersionKind = z.infer<typeof reportVersionKind>;

export const reportSnapshotVersion = z.strictObject({
  versionKind: reportVersionKind,
  referenceId: uuid.nullable(),
  referenceKey: z.string(),
  versionLabel: z.string(),
});
export type ReportSnapshotVersion = z.infer<typeof reportSnapshotVersion>;
export const reportSnapshotVersionList = z.strictObject({ items: z.array(reportSnapshotVersion) });

export const reportSnapshotEvidenceItem = z.strictObject({
  sectionKey: z.string(),
  evidenceId: uuid,
  contentId: uuid.nullable(),
  contentRevision: z.number().int().min(1).nullable(),
  contentSha256: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  reviewStatus: z.enum(["unverified", "verified", "rejected"]),
});
export type ReportSnapshotEvidenceItem = z.infer<typeof reportSnapshotEvidenceItem>;
export const reportSnapshotEvidencePage = z.strictObject({
  items: z.array(reportSnapshotEvidenceItem),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ outbox

/**
 * `report_snapshot.issued` v1 (ADR-0045 §10), consumed by slice G's restatement flow (ADR-0047). The payload schema
 * lives here; its registration in OUTBOX_EVENT_SCHEMAS and its worker queue are added together with the consumer
 * (KBE-E), and the API writes the event only once it is registered (see reporting/reports/snapshots.ts).
 */
export const reportSnapshotIssuedV1 = z.strictObject({
  snapshotId: uuid,
  definitionCode: reportDefinitionCode,
  transformationId: uuid,
  seriesId: uuid,
  issueVersion: z.number().int().min(1),
});
export type ReportSnapshotIssuedV1 = z.infer<typeof reportSnapshotIssuedV1>;

// ------------------------------------------------------------------------------------------------ counting

/** ADR-0045 §5: provisional values count rules 1-4; unknown (and stale, which shows no current number) count rule 5. */
export function countReportValues(sections: readonly ReportSection[]): { provisional: number; unknown: number } {
  let provisional = 0;
  let unknown = 0;
  const visit = (v: ReportValue) => {
    if (v.validation === "provisional") provisional += 1;
    else if (v.validation === "unknown" || v.validation === "stale") unknown += 1;
  };
  for (const s of sections) {
    switch (s.kind) {
      case "fields":
      case "metrics":
        s.fields.forEach((f) => visit(f.value));
        break;
      case "text":
        visit(s.text);
        break;
      case "list":
        s.items.forEach((i) => visit(i.value));
        break;
      case "table":
        s.rows.forEach((r) => r.cells.forEach(visit));
        s.totals.forEach((t) => visit(t.value));
        break;
    }
  }
  return { provisional, unknown };
}
