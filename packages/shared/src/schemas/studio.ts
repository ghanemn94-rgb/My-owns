// zod mirrors of the P5 slice A Studio and config-pin components (docs/api/openapi.yaml tags `studio`, `config-pins`;
// ADR-0039 §1-§4; T-DG5-BE-A). The OpenAPI file is the source of truth; the contract test parses every success body
// with these. Also the per-element-type attribute schemas of ADR-0039 §2: `methodology_element.attributes` is never an
// unvalidated blob, every write validates it here first.
// A Studio version is configuration, not a business approval: nothing here grants or records a G1-G6 decision.
import { z } from "zod";
import { freeText, page, timestamp, uuid, version } from "./common.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

// ------------------------------------------------------------------------------------------------ kinds and types

/** The Studio configuration kinds (ADR-0039 §1; `methodology_version.config_kind`, `transformation_config_pin.kind`). */
export const CONFIG_KINDS = [
  "methodology",
  "scoring_defaults",
  "form_schema",
  "procedure",
  "automation_rule_set",
  "health_check_scheme",
] as const;
export type ConfigKind = (typeof CONFIG_KINDS)[number];
export const configKind = z.enum(CONFIG_KINDS);

/** Every element type `methodology_element.element_type` accepts (ADR-0039 §2). */
export const CONFIG_ELEMENT_TYPES = [
  "methodology_text",
  "phase",
  "gate",
  "gate_criterion",
  "mandatory_artifact",
  "checklist_item",
  "template",
  "tom_dimension",
  "approver_route",
  "reminder",
  "escalation_rule",
  "dashboard",
  "report_layout",
  "source_element",
  "scoring_weight",
  "scoring_rubric",
] as const;
export type ConfigElementType = (typeof CONFIG_ELEMENT_TYPES)[number];
export const configElementType = z.enum(CONFIG_ELEMENT_TYPES);

export const CONFIG_VERSION_STATUSES = ["draft", "published", "retired"] as const;
export const CONFIG_DRAFT_STAGES = ["editing", "preview", "review", "approved", "discarded"] as const;
export type ConfigDraftStage = (typeof CONFIG_DRAFT_STAGES)[number];
export const CONFIG_VERSION_ORIGINS = ["seed", "draft", "rollback"] as const;
export const CONFIG_ELEMENT_ORIGINS = ["source", "admin"] as const;
export const CONFIG_CHECK_RESULTS = ["pass", "warn", "fail"] as const;

/** The stable key of an element (the `StableKey` path parameter and `methodology_element.stable_key` CHECK). */
export const STABLE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/;
export const stableKey = z.string().regex(STABLE_KEY_PATTERN, "validation.key");

// ------------------------------------------------------------------------------------------------ attributes (§2)

/** A role code (an existing role is checked by the API and the database, ADR-0039 §2). */
const roleCodeRef = z.string().regex(/^[A-Z][A-Z0-9_]{0,31}$/, "validation.code");
const phaseOrGateRef = {
  gateCode: z
    .string()
    .regex(/^G[1-6]$/, "validation.code")
    .optional(),
  phaseCode: z
    .string()
    .regex(/^[a-z][a-z0-9_]{0,31}$/, "validation.code")
    .optional(),
};
/** `weightPercent` (ADR-0039 §12): a decimal string in (0, 100] with at most two decimals; never a float. */
export const WEIGHT_PERCENT_PATTERN = /^(100(\.0{1,2})?|[0-9]{1,2}(\.[0-9]{1,2})?)$/;
export const weightPercent = z
  .string()
  .regex(WEIGHT_PERCENT_PATTERN, "validation.weight_percent")
  .refine((v) => !/^0+(\.0+)?$/.test(v), "validation.weight_percent");

/** The attributes every element type accepts: labels and help text in both languages (free-text rules, rule 1). */
const common = {
  labelEn: freeText(1, 200).optional(),
  labelAr: freeText(1, 200).optional(),
  helpEn: freeText(1, 2000).optional(),
  helpAr: freeText(1, 2000).optional(),
};
const sectionKeys = z.array(stableKey).min(1).max(50);
const rubricLevel = z.strictObject({
  score: z.number().int().min(1).max(5),
  descriptorEn: freeText(1, 2000).nullable(),
  descriptorAr: freeText(1, 2000).nullable(),
});
const sourceRef = z
  .string()
  .regex(/^B[0-9]{4}$/, "validation.pattern")
  .optional();

/** Per element type, the shape of `methodology_element.attributes` (ADR-0039 §2). */
export const CONFIG_ELEMENT_ATTRIBUTES = {
  methodology_text: z.strictObject({
    ...common,
    bodyEn: freeText(1, 20000).optional(),
    bodyAr: freeText(1, 20000).optional(),
  }),
  phase: z.strictObject(common),
  gate: z.strictObject({
    ...common,
    defaultApproverRoleCode: roleCodeRef.optional(),
    submissionEnabled: z.boolean().optional(),
  }),
  gate_criterion: z.strictObject({ ...common, mandatory: z.boolean().optional() }),
  mandatory_artifact: z.strictObject({ ...common, ...phaseOrGateRef, mandatory: z.boolean().optional() }),
  checklist_item: z.strictObject({ ...common, ...phaseOrGateRef, mandatory: z.boolean().optional() }),
  template: z.strictObject(common),
  tom_dimension: z.strictObject(common),
  approver_route: z
    .strictObject({
      ...common,
      approverRoleCode: roleCodeRef.optional(),
      approverRoleCodes: z.array(roleCodeRef).min(1).max(10).optional(),
      mode: z.enum(["any", "sequential", "parallel"]).optional(),
    })
    .refine((v) => (v.approverRoleCode === undefined) !== (v.approverRoleCodes === undefined), {
      message: "validation.required",
      path: ["approverRoleCode"],
    }),
  reminder: z.strictObject({
    ...common,
    offsetWorkingDays: z.number().int().min(0).max(250).optional(),
    recipientRoleCode: roleCodeRef.optional(),
  }),
  escalation_rule: z.strictObject({
    ...common,
    offsetWorkingDays: z.number().int().min(0).max(250).optional(),
    recipientRoleCode: roleCodeRef.optional(),
  }),
  dashboard: z.strictObject({ ...common, sections: sectionKeys.optional() }),
  report_layout: z.strictObject({ ...common, sections: sectionKeys.optional() }),
  source_element: z.strictObject(common),
  // The seeded v1 rows (0062) also carry `sourceLabelEn`, `sourceRef` and (risk/compliance) `optional`.
  scoring_weight: z.strictObject({
    ...common,
    weightPercent,
    sourceLabelEn: freeText(1, 200).optional(),
    sourceRef,
  }),
  scoring_rubric: z.strictObject({
    ...common,
    levels: z
      .array(rubricLevel)
      .length(5)
      .refine((l) => l.every((x, i) => x.score === i + 1), "validation.pattern"),
    sourceRef,
    optional: z.boolean().optional(),
  }),
} as const satisfies Record<ConfigElementType, z.ZodType>;

/** The element types each configuration kind accepts (the database trigger `methodology_element_guard`'s list). */
export const ELEMENT_TYPES_BY_KIND: Readonly<Record<ConfigKind, readonly ConfigElementType[]>> = {
  methodology: [
    "methodology_text",
    "phase",
    "gate",
    "gate_criterion",
    "mandatory_artifact",
    "checklist_item",
    "template",
    "tom_dimension",
    "approver_route",
    "reminder",
    "escalation_rule",
    "dashboard",
    "report_layout",
    "source_element",
  ],
  scoring_defaults: ["scoring_weight", "scoring_rubric"],
  form_schema: [],
  procedure: [],
  automation_rule_set: [],
  health_check_scheme: [],
};

// ------------------------------------------------------------------------------------------------ definition

/**
 * True when every number inside `value` is an integer (ADR-0039 §1: "numbers in definitions and attributes are
 * integers; decimals are strings"), so the canonical JSON of the content hash is exact and never depends on float
 * formatting. Depth-bounded (32) so a hostile body cannot exhaust the stack.
 */
export function onlyIntegerNumbers(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (typeof value === "number") return Number.isSafeInteger(value);
  if (Array.isArray(value)) return value.every((v) => onlyIntegerNumbers(v, depth + 1));
  if (value !== null && typeof value === "object")
    return Object.values(value).every((v) => onlyIntegerNumbers(v, depth + 1));
  return true;
}

/** A version's `definition`: a JSON object whose numbers are integers (decimals are strings). */
export const configDefinition = z
  .record(z.string(), z.unknown())
  .refine((v) => onlyIntegerNumbers(v), "validation.decimal");

// ------------------------------------------------------------------------------------------------ versions

export const configCheckSummary = z.strictObject({
  checkRunId: uuid,
  result: z.enum(CONFIG_CHECK_RESULTS),
  createdAt: timestamp,
});
export type ConfigCheckSummary = z.infer<typeof configCheckSummary>;

export const configVersion = z.strictObject({
  id: uuid,
  configKind,
  key: z.string(),
  versionNo: z.number().int().min(1),
  status: z.enum(CONFIG_VERSION_STATUSES),
  draftStage: z.enum(CONFIG_DRAFT_STAGES).nullable(),
  origin: z.enum(CONFIG_VERSION_ORIGINS),
  basedOnVersionId: nullableUuid,
  rollbackOfVersionId: nullableUuid,
  titleEn: z.string().min(1).max(200),
  titleAr: z.string().min(1).max(200),
  changeSummary: z.string().min(1).max(4000).nullable(),
  definition: z.record(z.string(), z.unknown()),
  contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
  isNewestPublished: z.boolean(),
  latestChecks: z.strictObject({
    preview: configCheckSummary.nullable(),
    compatibility: configCheckSummary.nullable(),
    sourceCoverage: configCheckSummary.nullable(),
  }),
  pendingReviewId: nullableUuid,
  reviewRequired: z.boolean(),
  publishedAt: nullableTimestamp,
  publishedBy: nullableUuid,
  discardedAt: nullableTimestamp,
  version,
  createdAt: timestamp,
  createdBy: nullableUuid,
  updatedAt: timestamp,
  updatedBy: nullableUuid,
});
export type ConfigVersion = z.infer<typeof configVersion>;
export const configVersionPage = page(configVersion);

export const configVersionListQuery = z.strictObject({
  kind: configKind.optional(),
  status: z.enum(CONFIG_VERSION_STATUSES).optional(),
});

export const configDraftCreate = z.strictObject({
  basedOnVersionId: uuid,
  titleEn: freeText(1, 200).optional(),
  titleAr: freeText(1, 200).optional(),
  changeSummary: freeText(1, 4000).optional(),
});
export type ConfigDraftCreate = z.infer<typeof configDraftCreate>;

export const configDraftUpdate = z
  .strictObject({
    titleEn: freeText(1, 200).optional(),
    titleAr: freeText(1, 200).optional(),
    changeSummary: freeText(1, 4000).nullable().optional(),
    definition: configDefinition.optional(),
  })
  .refine((v) => Object.values(v).some((x) => x !== undefined), "validation.empty_update");
export type ConfigDraftUpdate = z.infer<typeof configDraftUpdate>;

// ------------------------------------------------------------------------------------------------ elements

export const configElement = z.strictObject({
  elementType: configElementType,
  stableKey: z.string(),
  origin: z.enum(CONFIG_ELEMENT_ORIGINS),
  removed: z.boolean(),
  ordinal: z.number().int().min(1).nullable(),
  sourceRef: z.string().nullable(),
  catalogueAttributes: z.record(z.string(), z.unknown()),
  attributes: z.record(z.string(), z.unknown()),
  overridden: z.boolean(),
});
export type ConfigElement = z.infer<typeof configElement>;
export const configElementPage = page(configElement);

// ------------------------------------------------------------------------------------------------ pins

export const configPin = z.strictObject({
  kind: configKind,
  versionId: uuid,
  key: z.string(),
  versionNo: z.number().int().min(1),
  pinned: z.boolean(),
  lastMigrationId: nullableUuid,
  pinnedAt: nullableTimestamp,
  version: z.number().int().min(1).nullable(),
});
export type ConfigPin = z.infer<typeof configPin>;
export const configPinList = z.strictObject({ items: z.array(configPin) });

export const configPinHistoryEntry = z.strictObject({
  id: uuid,
  kind: z.string(),
  fromVersionId: uuid,
  toVersionId: uuid,
  migrationId: uuid,
  pinVersion: z.number().int().min(2),
  createdAt: timestamp,
  createdBy: uuid,
});
export type ConfigPinHistoryEntry = z.infer<typeof configPinHistoryEntry>;
export const configPinHistoryPage = page(configPinHistoryEntry);
