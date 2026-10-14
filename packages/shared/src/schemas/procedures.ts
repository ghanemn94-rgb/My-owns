// zod mirrors of the P5 slice C procedure-definition components (docs/api/openapi.yaml tag `procedures`: ProcedureCode,
// ProcedureInputField, ProcedureStepDefinition(Input), ProcedureDefinition(Input), ProcedureDefinitionPage,
// ProcedureValidationReport; ADR-0042 §1-§2, §10; T-DG5-BE-F, p5-work-split §C.1). The OpenAPI file is the source of
// truth; the contract test parses every success body with these. Also the pure step-condition evaluator of ADR-0042 §2
// (decimal.js on decimal strings; shared rule 5), used by the builder preview and by the instance engine (BE-F2).
// A procedure definition is configuration: an approval step NAMES the business role that decides through the canonical
// approval (ADR-0026); nothing here grants or records a G1-G6 decision, and nothing touches DG0-DG7.
import { Decimal } from "decimal.js";
import { z } from "zod";
import { FIELD_TYPES } from "../forms/field-types.ts";
import { freeText, roleCode, timestamp, uuid } from "./common.ts";
import { businessDate } from "./kpi.ts";

/** OpenAPI `ProcedureCode` (CHECK on procedure_definition.code). */
export const PROCEDURE_CODE_PATTERN = /^[a-z][a-z0-9_]{2,47}$/;
export const procedureCode = z.string().regex(PROCEDURE_CODE_PATTERN, "validation.pattern");
export const PROCEDURE_STEP_KEY_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;
export const PROCEDURE_INPUT_KEY_PATTERN = /^[a-z][a-zA-Z0-9_]{0,39}$/;
export const PROCEDURE_PARALLEL_GROUP_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;
export const PROCEDURE_TRIGGER_EVENT_PATTERN = /^[a-z_]+\.[a-z_.]+$/;

export const PROCEDURE_TRIGGER_KINDS = ["manual", "event", "schedule"] as const;
export const PROCEDURE_SCOPE_LEVELS = ["organization", "transformation"] as const;
export const PROCEDURE_APPROVAL_MODES = ["none", "any", "sequential", "parallel"] as const;
export const PROCEDURE_COMPLETION_RULES = ["all_steps_closed", "all_steps_closed_and_outputs_linked"] as const;
export const PROCEDURE_STEP_KINDS = ["task", "approval"] as const;
export const PROCEDURE_CONDITION_OPERATORS = [
  "eq",
  "neq",
  "in",
  "gt",
  "gte",
  "lt",
  "lte",
  "present",
  "absent",
] as const;
export type ProcedureConditionOperator = (typeof PROCEDURE_CONDITION_OPERATORS)[number];
/** OpenAPI `ProcedureOutputRecordType` (CHECK on both procedure tables; ADR-0042 §3). */
export const PROCEDURE_OUTPUT_RECORD_TYPES = [
  "transformation",
  "charter",
  "baseline",
  "kpi_actual",
  "tom_canvas_cell",
  "approval",
  "ranking_snapshot",
  "gate_submission",
  "change_request",
  "finance_validation",
  "decision",
  "bau_handover",
  "evidence",
] as const;
export const PROCEDURE_OUTPUT_MODES = ["create", "advance", "link"] as const;

const text = (max: number) => freeText(1, max);
const nullableText = (max: number) => freeText(1, max).nullable();
const unique = (xs: readonly unknown[]) => new Set(xs).size === xs.length;

/** OpenAPI `ProcedureInputField`: one input, with one of the eleven field types (ADR-0041 §3). */
export const procedureInputField = z.strictObject({
  key: z.string().regex(PROCEDURE_INPUT_KEY_PATTERN, "validation.pattern"),
  fieldType: z.enum(FIELD_TYPES),
  labelEn: text(200),
  labelAr: text(200),
  required: z.boolean(),
  helpEn: nullableText(2000).optional(),
  helpAr: nullableText(2000).optional(),
  options: z.array(text(200)).max(100).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});
export type ProcedureInputField = z.infer<typeof procedureInputField>;

export const procedureStepCondition = z.strictObject({
  inputKey: z.string().min(1).max(40),
  operator: z.enum(PROCEDURE_CONDITION_OPERATORS),
  value: z.unknown().optional(),
});
export type ProcedureStepCondition = z.infer<typeof procedureStepCondition>;
export const procedureStepOutput = z.strictObject({
  recordType: z.enum(PROCEDURE_OUTPUT_RECORD_TYPES),
  mode: z.enum(PROCEDURE_OUTPUT_MODES),
});

const stepFields = {
  stepKey: z.string().regex(PROCEDURE_STEP_KEY_PATTERN, "validation.pattern"),
  ordinal: z.number().int().min(1).max(99),
  stepKind: z.enum(PROCEDURE_STEP_KINDS),
  nameEn: text(200),
  nameAr: text(200),
  responsibleRoleCode: roleCode,
  slaWorkingDays: z.number().int().min(1).max(250),
};

/** OpenAPI `ProcedureStepDefinitionInput`. */
export const procedureStepDefinitionInput = z.strictObject({
  ...stepFields,
  parallelGroup: z.string().regex(PROCEDURE_PARALLEL_GROUP_PATTERN, "validation.pattern").nullable().optional(),
  instructionsEn: nullableText(2000).optional(),
  instructionsAr: nullableText(2000).optional(),
  approvalRoleCode: roleCode.nullable().optional(),
  condition: procedureStepCondition.nullable().optional(),
  requiredInputKeys: z.array(z.string().min(1).max(40)).max(50).refine(unique, "validation.unique_items").optional(),
  evidenceRequired: z.boolean().optional(),
  output: procedureStepOutput.nullable().optional(),
  skippable: z.boolean().optional(),
});
export type ProcedureStepDefinitionInput = z.infer<typeof procedureStepDefinitionInput>;

const triggerSchema = z.strictObject({
  kind: z.enum(PROCEDURE_TRIGGER_KINDS),
  event: z.string().regex(PROCEDURE_TRIGGER_EVENT_PATTERN, "validation.pattern").nullable().optional(),
  descriptionEn: text(1000),
  descriptionAr: text(1000),
});
const scopeSchema = z.strictObject({
  level: z.enum(PROCEDURE_SCOPE_LEVELS),
  descriptionEn: text(1000),
  descriptionAr: text(1000),
});
const approvalSchema = z.strictObject({
  mode: z.enum(PROCEDURE_APPROVAL_MODES),
  roleCodes: z.array(roleCode).max(6).refine(unique, "validation.unique_items"),
});
const escalationSchema = z.strictObject({ roleCode, afterWorkingDays: z.number().int().min(1).max(250) }).nullable();
const completionSchema = z.strictObject({
  rule: z.enum(PROCEDURE_COMPLETION_RULES),
  descriptionEn: text(1000),
  descriptionAr: text(1000),
});
const roleList = z.array(roleCode).min(1).max(14).refine(unique, "validation.unique_items");

/**
 * OpenAPI `ProcedureDefinitionInput`. `trigger` and `completion` are optional in the SHAPE so that a definition missing
 * either is refused with 422 procedure_definition.trigger_required / completion_required (ADR-0042 §1, §10), not 400.
 * Step keys and input keys are unique within a definition (400 validation.unique_items).
 */
export const procedureDefinitionInput = z.strictObject({
  nameEn: text(200),
  nameAr: text(200),
  purposeEn: text(2000),
  purposeAr: text(2000),
  trigger: triggerSchema.optional(),
  scope: scopeSchema,
  prerequisitesEn: nullableText(2000).optional(),
  prerequisitesAr: nullableText(2000).optional(),
  inputSchema: z
    .array(procedureInputField)
    .max(50)
    .refine((xs) => new Set(xs.map((x) => x.key)).size === xs.length, "validation.unique_items")
    .optional(),
  launchRoleCodes: roleList,
  responsibleRoleCodes: roleList,
  slaWorkingDays: z.number().int().min(1).max(250),
  validationRulesEn: text(2000),
  validationRulesAr: text(2000),
  approval: approvalSchema,
  escalation: escalationSchema.optional(),
  expectedOutputsEn: text(2000),
  expectedOutputsAr: text(2000),
  completion: completionSchema.optional(),
  exceptionsEn: nullableText(2000).optional(),
  exceptionsAr: nullableText(2000).optional(),
  effectiveFrom: businessDate,
  ordinal: z.number().int().min(1).max(999).optional(),
  steps: z
    .array(procedureStepDefinitionInput)
    .max(99)
    .refine((xs) => new Set(xs.map((x) => x.stepKey)).size === xs.length, "validation.unique_items"),
});
export type ProcedureDefinitionInput = z.infer<typeof procedureDefinitionInput>;

// ------------------------------------------------------------------------------------------------ responses

const outText = (max: number) => z.string().min(1).max(max);
const outNullable = (max: number) => z.string().min(1).max(max).nullable();

/** OpenAPI `ProcedureStepDefinition` (response). */
export const procedureStepDefinition = z.strictObject({
  stepKey: z.string().regex(PROCEDURE_STEP_KEY_PATTERN),
  ordinal: z.number().int().min(1).max(99),
  parallelGroup: z.string().regex(PROCEDURE_PARALLEL_GROUP_PATTERN).nullable(),
  stepKind: z.enum(PROCEDURE_STEP_KINDS),
  nameEn: outText(200),
  nameAr: outText(200),
  instructionsEn: outNullable(2000),
  instructionsAr: outNullable(2000),
  responsibleRoleCode: roleCode,
  approvalRoleCode: roleCode.nullable(),
  slaWorkingDays: z.number().int().min(1).max(250),
  condition: procedureStepCondition.nullable(),
  requiredInputKeys: z.array(z.string()).max(50),
  evidenceRequired: z.boolean(),
  output: procedureStepOutput.nullable(),
  skippable: z.boolean(),
  removed: z.boolean(),
});
export type ProcedureStepDefinition = z.infer<typeof procedureStepDefinition>;

/** OpenAPI `ProcedureDefinition` (response). */
export const procedureDefinition = z.strictObject({
  id: uuid,
  code: procedureCode,
  methodologyVersionId: uuid,
  versionNo: z.number().int().min(1),
  versionStatus: z.enum(["draft", "published", "retired"]),
  origin: z.enum(["source", "admin"]),
  removed: z.boolean(),
  productDefaults: z.boolean(),
  sourceRef: z.string().nullable(),
  nameEn: outText(200),
  nameAr: outText(200),
  purposeEn: outText(2000),
  purposeAr: outText(2000),
  trigger: z.strictObject({
    kind: z.enum(PROCEDURE_TRIGGER_KINDS),
    event: z.string().regex(PROCEDURE_TRIGGER_EVENT_PATTERN).nullable(),
    descriptionEn: outText(1000),
    descriptionAr: outText(1000),
  }),
  scope: z.strictObject({
    level: z.enum(PROCEDURE_SCOPE_LEVELS),
    descriptionEn: outText(1000),
    descriptionAr: outText(1000),
  }),
  prerequisitesEn: outNullable(2000),
  prerequisitesAr: outNullable(2000),
  inputSchema: z.array(procedureInputField).max(50),
  launchRoleCodes: z.array(roleCode).min(1).max(14),
  responsibleRoleCodes: z.array(roleCode).min(1).max(14),
  slaWorkingDays: z.number().int().min(1).max(250),
  validationRulesEn: outText(2000),
  validationRulesAr: outText(2000),
  approval: z.strictObject({ mode: z.enum(PROCEDURE_APPROVAL_MODES), roleCodes: z.array(roleCode).max(6) }),
  escalation: z.strictObject({ roleCode, afterWorkingDays: z.number().int().min(1).max(250) }).nullable(),
  expectedOutputsEn: outText(2000),
  expectedOutputsAr: outText(2000),
  completion: z.strictObject({
    rule: z.enum(PROCEDURE_COMPLETION_RULES),
    descriptionEn: outText(1000),
    descriptionAr: outText(1000),
  }),
  exceptionsEn: outNullable(2000),
  exceptionsAr: outNullable(2000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ordinal: z.number().int().min(1).max(999),
  steps: z.array(procedureStepDefinition),
  version: z.number().int().min(1),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type ProcedureDefinition = z.infer<typeof procedureDefinition>;

export const procedureDefinitionPage = z.strictObject({
  items: z.array(procedureDefinition),
  nextCursor: z.string().nullable(),
});

/** OpenAPI `ProcedureValidationReport`: every finding of a definition body; `valid` when there is none. */
export const procedureValidationFinding = z.strictObject({
  code: z.string(),
  pointer: z.string(),
  message: z.string(),
});
export type ProcedureValidationFinding = z.infer<typeof procedureValidationFinding>;
export const procedureValidationReport = z.strictObject({
  valid: z.boolean(),
  findings: z.array(procedureValidationFinding),
});
export type ProcedureValidationReport = z.infer<typeof procedureValidationReport>;

/** listProcedureDefinitions / getProcedureDefinition query (`ConfigVersionIdQuery`, `IncludeRemovedQuery`). */
export const procedureDefinitionReadQuery = z.strictObject({ versionId: uuid.optional() });
export const procedureDefinitionListQuery = z.strictObject({
  versionId: uuid.optional(),
  includeRemoved: z.stringbool({ truthy: ["true"], falsy: ["false"] }).default(false),
});

// ------------------------------------------------------------------------------------------------ conditions

/** The ADR-0042 §10 refusal codes of the definition builder, with their exact English texts (rule 15). */
export const PROCEDURE_DEFINITION_MESSAGES = {
  "procedure_definition.trigger_required": "A procedure needs a trigger.",
  "procedure_definition.completion_required": "A procedure needs a completion condition.",
  "procedure_definition.steps_required": "A procedure needs at least one step.",
  "procedure_definition.parallel_group_invalid":
    "Steps that run in parallel must share a position and a parallel group.",
  "procedure_definition.condition_invalid": "A step condition must use a declared input and a valid operator.",
  "procedure_definition.input_unknown": "A step needs an input the procedure does not declare.",
  "procedure_definition.input_schema_invalid": "An input definition is not valid for its field type.",
  "procedure_definition.role_not_allowed":
    "An administrator role or the auditor cannot run, approve or receive escalations of a procedure.",
  "procedure_definition.approval_step_invalid":
    "An approval step needs a business approver role and cannot be skipped.",
  "procedure_definition.source_protected": "Seeded procedures can be edited but not deleted.",
  "procedure_definition.code_invalid":
    "A procedure code is 3 to 48 lowercase letters, digits or underscores, starting with a letter.",
} as const;
export type ProcedureDefinitionCode = keyof typeof PROCEDURE_DEFINITION_MESSAGES;
const DEFINITION_MESSAGES: ReadonlyMap<string, string> = new Map(Object.entries(PROCEDURE_DEFINITION_MESSAGES));
/** The exact English text of an ADR-0042 §10 definition code. */
export function procedureDefinitionMessage(code: ProcedureDefinitionCode): string {
  return DEFINITION_MESSAGES.get(code) ?? code;
}

/** A decimal string as the KBE-B validators store it (no exponent, optional sign and fraction). */
const DECIMAL_STRING = /^-?\d{1,30}(\.\d{1,30})?$/;
const NUMERIC_TYPES: ReadonlySet<string> = new Set(["number", "currency", "percentage"]);

/** A currency input value is `{ amount, currencyCode }`; its amount is the compared number. */
function numericOf(value: unknown): Decimal | null {
  const raw =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as { amount?: unknown }).amount
        : undefined;
  return typeof raw === "string" && DECIMAL_STRING.test(raw) ? new Decimal(raw) : null;
}

/**
 * Whether a condition is well-formed for an input of `fieldType` (ADR-0042 §2): `present`/`absent` take no value; `in`
 * takes a non-empty list of strings; `gt`/`gte`/`lt`/`lte` take a decimal string and a number, currency or percentage
 * input; `eq`/`neq` take a string or a boolean. Numbers are never JSON floats (shared rule 5).
 */
export function conditionShapeValid(c: ProcedureStepCondition, fieldType: string): boolean {
  const v = c.value;
  switch (c.operator) {
    case "present":
    case "absent":
      return v === undefined || v === null;
    case "in":
      return Array.isArray(v) && v.length > 0 && v.length <= 100 && v.every((x) => typeof x === "string");
    case "gt":
    case "gte":
    case "lt":
    case "lte":
      return NUMERIC_TYPES.has(fieldType) && typeof v === "string" && DECIMAL_STRING.test(v);
    case "eq":
    case "neq":
      return typeof v === "string" || typeof v === "boolean";
  }
}

const isAbsent = (v: unknown) => v === undefined || v === null || (typeof v === "string" && v.length === 0);

/**
 * Evaluates a step condition against the instance input values (ADR-0042 §2, §11): true runs the step, false makes it
 * `not_applicable`. A missing input is never defaulted (to 0 or "no"): only `absent` holds on it, every comparison is
 * false. Numeric comparisons use decimal.js on decimal strings.
 */
export function evaluateStepCondition(
  c: Pick<ProcedureStepCondition, "inputKey" | "operator" | "value">,
  inputs: Readonly<Record<string, unknown>>,
): boolean {
  const actual = Object.prototype.hasOwnProperty.call(inputs, c.inputKey)
    ? new Map(Object.entries(inputs)).get(c.inputKey)
    : undefined;
  if (c.operator === "absent") return isAbsent(actual);
  if (c.operator === "present") return !isAbsent(actual);
  if (isAbsent(actual)) return false;
  switch (c.operator) {
    case "eq":
      return actual === c.value;
    case "neq":
      return actual !== c.value;
    case "in":
      return Array.isArray(c.value) && c.value.includes(actual);
    default: {
      const a = numericOf(actual);
      const b = numericOf(c.value);
      if (a === null || b === null) return false;
      const cmp = a.comparedTo(b);
      return c.operator === "gt" ? cmp > 0 : c.operator === "gte" ? cmp >= 0 : c.operator === "lt" ? cmp < 0 : cmp <= 0;
    }
  }
}
