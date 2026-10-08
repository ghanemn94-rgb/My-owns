// P3 T09 benefit-formula zod mirrors (kpi-benefits-engineer, T-DG3-KBE-C; ADR-0024 §5-§6; p3-work-split §3 KBE-C).
// Mirrors the docs/api/openapi.yaml components of the `benefit-formulas` tag: FormulaKind, FormulaPeriod,
// FormulaVariable, FormulaCheckRequest/Result, BenefitFormula(+Create, Update, Page), BenefitFormulaVersion(+Create,
// List), BenefitCalculation(+Create, Page) and BenefitFormulaExample(+List). The API validates requests with them
// (400 when a body breaks one of these schemas) and the web reuses them.
//
// Rules carried by these schemas:
//  - the expression is checked here only for its length in Unicode code points (the JSON Schema `maxLength` unit,
//    ADR-0024 §6 item 7); the grammar and the type rules are the engine's (`@mth/shared/calc`), answered with 422;
//  - percentages are fractions (0.12 for 12%), every value is an exact decimal string; Unknown is null, never 0;
//  - confidence is exactly H, M or L (anything else is 400; the DB CHECK says the same);
//  - free text through `freeText` (visible content, no NUL, no lone surrogates).
import { z } from "zod";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal } from "./kpi.ts";
import { warning } from "./methodology.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();

// ------------------------------------------------------------------------------------------------ vocabularies

export const BENEFIT_FORMULA_KINDS = [
  "fraction",
  "fraction_delta",
  "percent_change",
  "count",
  "currency",
  "quantity",
  "number",
] as const;
export const formulaKind = z.enum(BENEFIT_FORMULA_KINDS);
export const BENEFIT_FORMULA_PERIODS = ["none", "month", "quarter", "year"] as const;
export const formulaPeriod = z.enum(BENEFIT_FORMULA_PERIODS);
export const T09_CONFIDENCE = ["H", "M", "L"] as const;
export const t09Confidence = z.enum(T09_CONFIDENCE);
export const BENEFIT_FORMULA_EXAMPLE_CODES = ["revenue_uplift", "cost_reduction"] as const;
export const benefitFormulaExampleCode = z.enum(BENEFIT_FORMULA_EXAMPLE_CODES);
export type BenefitFormulaExampleCode = z.infer<typeof benefitFormulaExampleCode>;
export const FORMULA_VALIDATION_STATUSES = ["unvalidated", "validated", "rejected"] as const;
export const formulaValidationStatus = z.enum(FORMULA_VALIDATION_STATUSES);
export type FormulaValidationStatus = z.infer<typeof formulaValidationStatus>;

/** The B0087 marker every example carries (REQ-PB-057); the web translates it, the API marks `isIllustrative`. */
export const ILLUSTRATIVE_MARKER_EN = "Illustrative calculation, synthetic values";

/** Length in Unicode code points (JSON Schema `maxLength`), not UTF-16 units. */
const codePoints = (v: string): number => [...v].length;
export const formulaExpression = z
  .string()
  .refine((v) => codePoints(v) >= 1, "validation.too_short")
  .refine((v) => codePoints(v) <= 2000, "validation.too_long");

// ------------------------------------------------------------------------------------------------ variables

/** Request `FormulaVariable`: name pattern, kind and period enums, a decimal value or null (Unknown). */
export const formulaVariableInput = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/, "validation.formula_variable_name"),
  kind: formulaKind,
  unit: freeText(1, 50).nullable().optional(),
  currency: currency.nullable().optional(),
  period: formulaPeriod,
  value: decimal.nullable().optional(),
  description: freeText(1, 1000).nullable().optional(),
  source: freeText(1, 500).nullable().optional(),
});
export type FormulaVariableInput = z.infer<typeof formulaVariableInput>;

/** Response `FormulaVariable`: every key present (null when empty). */
export const formulaVariable = z.strictObject({
  name: z.string().regex(/^[a-z][a-z0-9_]{0,47}$/),
  kind: formulaKind,
  unit: z.string().min(1).max(50).nullable(),
  currency: currency.nullable(),
  period: formulaPeriod,
  value: decimal.nullable(),
  description: z.string().min(1).max(1000).nullable(),
  source: z.string().min(1).max(500).nullable(),
});
export type FormulaVariableView = z.infer<typeof formulaVariable>;

// ------------------------------------------------------------------------------------------------ check (validate)

export const formulaCheckRequest = z.strictObject({
  expression: formulaExpression,
  variables: z.array(formulaVariableInput).max(30),
});
export type FormulaCheckRequest = z.infer<typeof formulaCheckRequest>;

export const formulaCheckResult = z.strictObject({
  valid: z.boolean(),
  resultKind: formulaKind.nullable(),
  resultUnit: z.string().nullable(),
  resultCurrency: z.string().nullable(),
  resultPeriod: formulaPeriod.nullable(),
  result: decimal.nullable(),
  errors: z.array(warning),
});
export type FormulaCheckResult = z.infer<typeof formulaCheckResult>;

// ------------------------------------------------------------------------------------------------ versions

export const benefitFormulaVersionCreate = z.strictObject({
  expression: formulaExpression,
  variables: z.array(formulaVariableInput).max(30),
  changeNote: freeText(1, 2000).optional(),
});
export type BenefitFormulaVersionCreate = z.infer<typeof benefitFormulaVersionCreate>;

export const benefitFormulaVersion = z.strictObject({
  id: uuid,
  formulaId: uuid,
  versionNo: z.number().int().min(1),
  expression: z.string().min(1),
  expressionSha256: z.string().regex(/^[0-9a-f]{64}$/),
  variables: z.array(formulaVariable),
  resultKind: formulaKind,
  resultUnit: z.string().nullable(),
  resultCurrency: z.string().nullable(),
  resultPeriod: formulaPeriod,
  previewResult: decimal.nullable(),
  engineVersion: z.string(),
  changeNote: z.string().min(1).max(2000).nullable(),
  validationStatus: formulaValidationStatus,
  validatedBy: nullableUuid,
  validatedAt: nullableTimestamp,
  validationNote: z.string().min(1).max(2000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
});
export type BenefitFormulaVersion = z.infer<typeof benefitFormulaVersion>;

export const benefitFormulaVersionList = z.strictObject({ items: z.array(benefitFormulaVersion) });

// ------------------------------------------------------------------------------------------------ T09 row

export const benefitFormula = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: z.string().regex(/^BF-[0-9]{2,6}$/),
  benefitName: z.string().min(1).max(300),
  baselineDriver: z.string().min(1).max(1000).nullable(),
  changeAssumption: z.string().min(1).max(1000).nullable(),
  ramp: z.string().min(1).max(100).nullable(),
  confidence: t09Confidence.nullable(),
  ownerUserId: nullableUuid,
  currentVersionNo: z.number().int().min(1).nullable(),
  currentVersion: benefitFormulaVersion.nullable(),
  isIllustrative: z.boolean(),
  exampleCode: benefitFormulaExampleCode.nullable(),
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().min(3).max(1000).nullable(),
  version,
  createdAt: timestamp,
  createdBy: uuid,
  updatedAt: timestamp,
  updatedBy: uuid,
});
export type BenefitFormula = z.infer<typeof benefitFormula>;

export const benefitFormulaCreate = z.strictObject({
  transformationId: uuid,
  benefitName: freeText(1, 300),
  baselineDriver: freeText(1, 1000).optional(),
  changeAssumption: freeText(1, 1000).optional(),
  ramp: freeText(1, 100).optional(),
  confidence: t09Confidence.optional(),
  ownerUserId: uuid.optional(),
  fromExample: benefitFormulaExampleCode.optional(),
  initialVersion: benefitFormulaVersionCreate.optional(),
});
export type BenefitFormulaCreate = z.infer<typeof benefitFormulaCreate>;

export const benefitFormulaUpdate = z
  .strictObject({
    benefitName: freeText(1, 300).optional(),
    baselineDriver: freeText(1, 1000).nullable().optional(),
    changeAssumption: freeText(1, 1000).nullable().optional(),
    ramp: freeText(1, 100).nullable().optional(),
    confidence: t09Confidence.nullable().optional(),
    ownerUserId: nullableUuid.optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
export type BenefitFormulaUpdate = z.infer<typeof benefitFormulaUpdate>;

export const benefitFormulaPage = z.strictObject({ items: z.array(benefitFormula), nextCursor: z.string().nullable() });

/** Query of GET /benefit-formulas. */
export const benefitFormulaListQuery = z.strictObject({
  transformationId: uuid,
  includeArchived: z.stringbool().default(false),
});

// ------------------------------------------------------------------------------------------------ calculations

export const benefitCalculationCreate = z.strictObject({
  inputs: z
    .record(z.string(), decimal)
    .refine((v) => Object.keys(v).length <= 30, "validation.max_properties")
    .optional(),
  assumptions: freeText(1, 4000).optional(),
  periodStart: businessDate.optional(),
  periodEnd: businessDate.optional(),
});
export type BenefitCalculationCreate = z.infer<typeof benefitCalculationCreate>;

export const benefitCalculation = z.strictObject({
  id: uuid,
  formulaVersionId: uuid,
  inputs: z.record(z.string(), formulaVariable),
  assumptions: z.string().min(1).max(4000).nullable(),
  periodStart: businessDate.nullable(),
  periodEnd: businessDate.nullable(),
  outcome: z.enum(["ok", "error"]),
  result: decimal.nullable(),
  resultKind: formulaKind,
  resultUnit: z.string().nullable(),
  resultCurrency: z.string().nullable(),
  resultPeriod: formulaPeriod,
  errorCode: z
    .string()
    .regex(/^formula\.[a-z_]{1,48}$/)
    .nullable(),
  rounded: z.boolean(),
  engineVersion: z.string(),
  computedAt: timestamp,
  computedBy: uuid,
});
export type BenefitCalculation = z.infer<typeof benefitCalculation>;

export const benefitCalculationPage = z.strictObject({
  items: z.array(benefitCalculation),
  nextCursor: z.string().nullable(),
});

// ------------------------------------------------------------------------------------------------ examples

export const benefitFormulaExample = z.strictObject({
  code: benefitFormulaExampleCode,
  ordinal: z.number().int(),
  sourceBenefitEn: z.string(),
  sourceBaselineDriverEn: z.string(),
  sourceChangeAssumptionEn: z.string(),
  sourceFormulaEn: z.string(),
  sourceRampEn: z.string(),
  sourceConfidence: t09Confidence,
  benefitAr: z.string(),
  baselineDriverAr: z.string(),
  changeAssumptionAr: z.string(),
  formulaAr: z.string(),
  expression: z.string(),
  variables: z.array(formulaVariable),
  resultKind: formulaKind,
  resultCurrency: z.string().nullable(),
  resultPeriod: formulaPeriod,
  exampleResult: decimal,
  isIllustrative: z.literal(true),
  sourceRef: z.string(),
});
export type BenefitFormulaExample = z.infer<typeof benefitFormulaExample>;

export const benefitFormulaExampleList = z.strictObject({ items: z.array(benefitFormulaExample).length(2) });
