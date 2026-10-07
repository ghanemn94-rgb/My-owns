// P3 business-case zod mirrors (kpi-benefits-engineer, T-DG3-KBE-B; ADR-0024 §1-§5; p3-work-split §3 KBE-B). Mirrors
// the docs/api/openapi.yaml components of the `business-cases` tag: BusinessCaseSections, BusinessCase(+Create, Update,
// Page), BusinessCaseValidationState, BusinessCaseLineClass, BusinessCaseLine(+Create, Update, List), MoneyTotal,
// BusinessCaseTotals and FinanceValidationRequest. The API validates requests with them and the web reuses them.
//
// Rules carried by these schemas:
//  - a line has EXACTLY ONE `class` (a string). Two classes - an array, or extra `investmentClass`/`benefitClass`
//    properties - are malformed requests (400 at `/class`, strict object). A class that does not fit `lineKind`, or a
//    `valueBasis` that does not fit the class, is a business rule (422), checked by the API with `lineClassProblem`;
//  - amounts are exact decimal strings that must fit numeric(20,4) without rounding; FTE is numeric(6,2). Unknown is
//    null, never 0 (ADR-0019);
//  - free text through `freeText` (visible content, no NUL, no lone surrogates).
import { z } from "zod";
import { currency, freeText, timestamp, uuid, version } from "./common.ts";
import { businessDate, decimal, moneyDecimal } from "./kpi.ts";
import { warning } from "./methodology.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const stamps = { version, createdAt: timestamp, createdBy: uuid, updatedAt: timestamp, updatedBy: uuid };
const atLeastOne = <T extends z.ZodRawShape>(shape: T) =>
  z.strictObject(shape).refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

// ------------------------------------------------------------------------------------------------ vocabularies

export const BUSINESS_CASE_LEVELS = ["transformation", "initiative"] as const;
export const businessCaseLevel = z.enum(BUSINESS_CASE_LEVELS);
export type BusinessCaseLevel = z.infer<typeof businessCaseLevel>;

export const BUSINESS_CASE_VALIDATION_STATES = ["unvalidated", "validated", "rejected", "stale"] as const;
export const businessCaseValidationState = z.enum(BUSINESS_CASE_VALIDATION_STATES);
export type BusinessCaseValidationState = z.infer<typeof businessCaseValidationState>;

export const DECISION_ASK_TYPES = ["funding", "policy", "resource", "prioritization"] as const;

export const INVESTMENT_CLASSES = ["capex", "opex", "internal_fte", "vendor_cost", "opportunity_cost"] as const;
export const BENEFIT_CLASSES = [
  "revenue",
  "cost_reduction",
  "cost_avoidance",
  "working_capital",
  "strategic_non_financial",
] as const;
export const BUSINESS_CASE_LINE_CLASSES = [...INVESTMENT_CLASSES, ...BENEFIT_CLASSES] as const;
export const businessCaseLineClass = z.enum(BUSINESS_CASE_LINE_CLASSES);
export type BusinessCaseLineClass = z.infer<typeof businessCaseLineClass>;
export type InvestmentClass = (typeof INVESTMENT_CLASSES)[number];
export type BenefitClass = (typeof BENEFIT_CLASSES)[number];

export const LINE_KINDS = ["investment", "benefit"] as const;
export const lineKind = z.enum(LINE_KINDS);
export type LineKind = z.infer<typeof lineKind>;

export const VALUE_BASES = [
  "revenue_uplift",
  "margin_uplift",
  "cash_saving",
  "avoided_cost",
  "working_capital_release",
  "non_financial",
  "cash",
  "non_cash",
] as const;
export const valueBasis = z.enum(VALUE_BASES);
export type ValueBasis = z.infer<typeof valueBasis>;

/**
 * ADR-0024 §2: the value bases each class allows (the DB CHECK business_case_line_value_basis says the same). Revenue
 * uplift is kept apart from margin, avoided cost from cash savings, and non-cash investment from cash investment.
 */
export const VALUE_BASIS_BY_CLASS: Readonly<Record<BusinessCaseLineClass, readonly ValueBasis[]>> = Object.freeze({
  capex: ["cash"],
  opex: ["cash"],
  vendor_cost: ["cash"],
  internal_fte: ["non_cash"],
  opportunity_cost: ["non_cash"],
  revenue: ["revenue_uplift", "margin_uplift"],
  cost_reduction: ["cash_saving"],
  cost_avoidance: ["avoided_cost"],
  working_capital: ["working_capital_release"],
  strategic_non_financial: ["non_financial"],
});

/** The kind a class belongs to (each class belongs to exactly one kind). */
export function kindOfClass(c: BusinessCaseLineClass): LineKind {
  return (INVESTMENT_CLASSES as readonly string[]).includes(c) ? "investment" : "benefit";
}

/** A class/kind or class/value-basis mismatch (422), or null when the triple is consistent. */
export function lineClassProblem(
  kind: LineKind,
  cls: BusinessCaseLineClass,
  basis: ValueBasis,
): { code: "business_case.line_class_mismatch" | "business_case.value_basis_mismatch"; pointer: string } | null {
  if (kindOfClass(cls) !== kind) return { code: "business_case.line_class_mismatch", pointer: "/class" };
  if (!VALUE_BASIS_BY_CLASS[cls].includes(basis))
    return { code: "business_case.value_basis_mismatch", pointer: "/valueBasis" };
  return null;
}

// ------------------------------------------------------------------------------------------------ sections

/** OpenAPI `Fte`: numeric(6,2) as a decimal string. */
export const fte = z.string().regex(/^[0-9]{1,4}(\.[0-9]{1,2})?$/, "validation.fte");

/** The ten B0085 sections (ADR-0024 §1). Every key is optional in a request; null clears a field. */
export const businessCaseSections = z.strictObject({
  strategicRationale: freeText(1, 20000).nullable().optional(),
  baselineSummary: freeText(1, 20000).nullable().optional(),
  valuePoolsSummary: freeText(1, 20000).nullable().optional(),
  interventionsSummary: freeText(1, 20000).nullable().optional(),
  investmentSummary: freeText(1, 20000).nullable().optional(),
  benefitsSummary: freeText(1, 20000).nullable().optional(),
  benefitRamp: freeText(1, 4000).nullable().optional(),
  recurrenceSummary: freeText(1, 4000).nullable().optional(),
  implementationHorizon: freeText(1, 4000).nullable().optional(),
  keyAssumptions: freeText(1, 20000).nullable().optional(),
  downsideCase: freeText(1, 8000).nullable().optional(),
  upsideCase: freeText(1, 8000).nullable().optional(),
  benefitOwnerUserId: nullableUuid.optional(),
  initiativeOwnerUserId: nullableUuid.optional(),
  financeValidatorUserId: nullableUuid.optional(),
  decisionAskTypes: z
    .array(z.enum(DECISION_ASK_TYPES))
    .refine((a) => new Set(a).size === a.length, "validation.unique_items")
    .optional(),
  decisionAskText: freeText(1, 8000).nullable().optional(),
});
export type BusinessCaseSections = z.infer<typeof businessCaseSections>;

/**
 * Section codes reported in `missingSections` (ADR-0024 §1, in B0085 order). The lighter initiative set is sections 1,
 * 4, 5, 6, 7 and 9.
 */
export const BUSINESS_CASE_SECTION_CODES = [
  "strategic_rationale",
  "baseline",
  "value_pools",
  "interventions",
  "investment",
  "benefits",
  "timing",
  "risks",
  "ownership",
  "decision_ask",
] as const;
export type BusinessCaseSectionCode = (typeof BUSINESS_CASE_SECTION_CODES)[number];
export const INITIATIVE_CASE_SECTION_CODES: readonly BusinessCaseSectionCode[] = [
  "strategic_rationale",
  "interventions",
  "investment",
  "benefits",
  "timing",
  "ownership",
];

// ------------------------------------------------------------------------------------------------ business case

/** Response: every section key present (null when empty). */
export const businessCaseSectionsView = z.strictObject({
  strategicRationale: z.string().nullable(),
  baselineSummary: z.string().nullable(),
  valuePoolsSummary: z.string().nullable(),
  interventionsSummary: z.string().nullable(),
  investmentSummary: z.string().nullable(),
  benefitsSummary: z.string().nullable(),
  benefitRamp: z.string().nullable(),
  recurrenceSummary: z.string().nullable(),
  implementationHorizon: z.string().nullable(),
  keyAssumptions: z.string().nullable(),
  downsideCase: z.string().nullable(),
  upsideCase: z.string().nullable(),
  benefitOwnerUserId: nullableUuid,
  initiativeOwnerUserId: nullableUuid,
  financeValidatorUserId: nullableUuid,
  decisionAskTypes: z.array(z.enum(DECISION_ASK_TYPES)),
  decisionAskText: z.string().nullable(),
});

export const businessCase = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  code: z.string().regex(/^BC-[0-9]{2,6}$/),
  level: businessCaseLevel,
  initiativeId: nullableUuid,
  parentCaseId: nullableUuid,
  title: z.string().min(1).max(300),
  currency,
  sections: businessCaseSectionsView,
  missingSections: z.array(z.string()),
  baselineValidation: businessCaseValidationState,
  baselineValidatedBy: nullableUuid,
  baselineValidatedAt: nullableTimestamp,
  baselineValidationNote: z.string().min(1).max(2000).nullable(),
  status: z.enum(["draft", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().min(3).max(1000).nullable(),
  ...stamps,
});
export type BusinessCase = z.infer<typeof businessCase>;

export const businessCaseCreate = z.strictObject({
  transformationId: uuid,
  level: businessCaseLevel,
  initiativeId: uuid.optional(),
  title: freeText(1, 300),
  currency: currency.optional(),
  sections: businessCaseSections.optional(),
});
export type BusinessCaseCreate = z.infer<typeof businessCaseCreate>;

export const businessCaseUpdate = atLeastOne({
  title: freeText(1, 300).optional(),
  sections: businessCaseSections.optional(),
});
export type BusinessCaseUpdate = z.infer<typeof businessCaseUpdate>;

export const businessCasePage = z.strictObject({ items: z.array(businessCase), nextCursor: z.string().nullable() });

/** Query of GET /business-cases. */
export const businessCaseListQuery = z.strictObject({
  transformationId: uuid,
  level: businessCaseLevel.optional(),
  includeArchived: z.stringbool().default(false),
});

/** OpenAPI `FinanceValidationRequest` (baseline validation by FIN). */
export const financeValidationRequest = z.strictObject({
  result: z.enum(["validated", "rejected"]),
  note: freeText(1, 2000),
});
export type FinanceValidationRequest = z.infer<typeof financeValidationRequest>;

// ------------------------------------------------------------------------------------------------ lines

export const businessCaseLine = z.strictObject({
  id: uuid,
  organizationId: uuid,
  transformationId: uuid,
  businessCaseId: uuid,
  lineKind,
  class: businessCaseLineClass,
  valueBasis,
  title: z.string().min(1).max(300),
  description: z.string().min(1).max(4000).nullable(),
  amount: decimal.nullable(),
  currency,
  fte: fte.nullable(),
  periodStart: businessDate.nullable(),
  periodEnd: businessDate.nullable(),
  recurrence: z.enum(["one_off", "recurring"]).nullable(),
  benefitFormulaId: nullableUuid,
  ownerUserId: nullableUuid,
  status: z.enum(["active", "archived"]),
  archivedAt: nullableTimestamp,
  archivedBy: nullableUuid,
  archiveReason: z.string().min(3).max(1000).nullable(),
  ...stamps,
});
export type BusinessCaseLine = z.infer<typeof businessCaseLine>;

export const businessCaseLineCreate = z.strictObject({
  lineKind,
  class: businessCaseLineClass,
  valueBasis,
  title: freeText(1, 300),
  description: freeText(1, 4000).optional(),
  amount: moneyDecimal.nullable().optional(),
  currency,
  fte: fte.optional(),
  periodStart: businessDate.optional(),
  periodEnd: businessDate.optional(),
  recurrence: z.enum(["one_off", "recurring"]).optional(),
  benefitFormulaId: uuid.optional(),
  ownerUserId: uuid.optional(),
});
export type BusinessCaseLineCreate = z.infer<typeof businessCaseLineCreate>;

export const businessCaseLineUpdate = atLeastOne({
  title: freeText(1, 300).optional(),
  description: freeText(1, 4000).nullable().optional(),
  amount: moneyDecimal.nullable().optional(),
  fte: fte.nullable().optional(),
  periodStart: businessDate.nullable().optional(),
  periodEnd: businessDate.nullable().optional(),
  recurrence: z.enum(["one_off", "recurring"]).nullable().optional(),
  benefitFormulaId: nullableUuid.optional(),
  ownerUserId: nullableUuid.optional(),
});
export type BusinessCaseLineUpdate = z.infer<typeof businessCaseLineUpdate>;

export const businessCaseLineList = z.strictObject({ items: z.array(businessCaseLine) });

// ------------------------------------------------------------------------------------------------ totals

/** One currency's total. `amount` null = Unknown (every counted line is Unknown), never "0". */
export const moneyTotal = z.strictObject({
  currency,
  amount: decimal.nullable(),
  unknownLineCount: z.number().int().min(0),
  lineCount: z.number().int().min(0),
});
export type MoneyTotal = z.infer<typeof moneyTotal>;

const moneyTotals = z.array(moneyTotal);

export const businessCaseTotals = z.strictObject({
  businessCaseId: uuid,
  includedCaseIds: z.array(uuid),
  grossBenefits: moneyTotals,
  grossBenefitsByClass: z.record(z.string(), moneyTotals),
  grossBenefitsByValueBasis: z.record(z.string(), moneyTotals),
  implementationCost: moneyTotals,
  implementationCostCash: moneyTotals,
  implementationCostNonCash: moneyTotals,
  netValue: moneyTotals,
  nonFinancialBenefitCount: z.number().int().min(0),
  warnings: z.array(warning),
});
export type BusinessCaseTotals = z.infer<typeof businessCaseTotals>;
