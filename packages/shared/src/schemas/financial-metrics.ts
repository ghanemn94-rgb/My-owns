// P5 slice G zod mirrors (kpi-benefits-engineer, T-DG5-KBE-F; ADR-0047 §4, §5, §9; p5-work-split §G.3) of the
// docs/api/openapi.yaml components of the `formula-previews` and `financial-metrics` tags: FormulaPreviewRequest/Result
// (+ Unit, Outcome, EdgeCase, Problem, ExampleInput), FinancialMetricSettings, FinancialMetricEnablement,
// FinancialMetricAssumptions, CashFlowRow, BusinessCaseCashFlows(+Put), FinancialMetrics(+Page).
//
// Rules carried by these schemas:
//  - every amount, rate and metric is an exact decimal string; a metric that is not shown or not computable is null
//    with its reason, never 0; the discount rate is a decimal fraction per period (0.100000 = 10 %);
//  - request amounts must fit numeric(20,4) and be >= 0 (400 otherwise; no silent rounding); the period rules (no gap,
//    at most 121 rows) and the discount-rate range are the API's 422 business refusals (ADR-0047 §8);
//  - free text through `freeText`;
//  - NPV, ROI and payback are an extension, not a playbook requirement: every settings and metrics body has
//    `extension: true`.
import { z } from "zod";
import { compareDecimal } from "../value.ts";
import { currency, freeText, timestamp, uuid } from "./common.ts";
import {
  benefitFormulaExampleCode,
  formulaExpression,
  formulaKind,
  formulaPeriod,
  formulaVariableInput,
} from "./benefit-formula.ts";
import { decimal, moneyDecimal } from "./kpi.ts";

const nullableUuid = uuid.nullable();
const nullableTimestamp = timestamp.nullable();
const nullableDecimal = decimal.nullable();

// ------------------------------------------------------------------------------------------------ formula preview

/** At most 30 named inputs (JSON Schema `maxProperties: 30`). */
const previewInputs = z
  .record(z.string(), nullableDecimal)
  .refine((v) => Object.keys(v).length <= 30, "validation.max_properties");

export const formulaPreviewExampleInput = z.strictObject({
  label: freeText(1, 100),
  inputs: previewInputs,
});
export type FormulaPreviewExampleInput = z.infer<typeof formulaPreviewExampleInput>;

/**
 * Either `exampleCode` (a seeded B0087 example) or `expression` with `variables`; not both, not neither (400
 * `validation.invalid` at /expression or /variables: an existing translated key; a specific one is proposed in the
 * KBE-F handback).
 */
export const formulaPreviewRequest = z
  .strictObject({
    exampleCode: benefitFormulaExampleCode.optional(),
    expression: formulaExpression.optional(),
    variables: z.array(formulaVariableInput).max(30).optional(),
    examples: z.array(formulaPreviewExampleInput).max(10).optional(),
    edgeCases: z.boolean().optional(),
  })
  .refine((v) => (v.exampleCode === undefined) !== (v.expression === undefined), {
    message: "validation.invalid",
    path: ["expression"],
  })
  .refine((v) => v.exampleCode === undefined || v.variables === undefined, {
    message: "validation.invalid",
    path: ["variables"],
  });
export type FormulaPreviewRequest = z.infer<typeof formulaPreviewRequest>;

export const formulaPreviewUnit = z.strictObject({
  kind: formulaKind.nullable(),
  currency: currency.nullable(),
  period: formulaPeriod.nullable(),
  unitLabel: z.string().nullable(),
});
export type FormulaPreviewUnit = z.infer<typeof formulaPreviewUnit>;

export const FORMULA_PREVIEW_STATUSES = ["ok", "not_computable"] as const;
export const formulaPreviewStatus = z.enum(FORMULA_PREVIEW_STATUSES);

export const formulaPreviewOutcome = z.strictObject({
  label: z.string(),
  inputs: z.record(z.string(), nullableDecimal),
  status: formulaPreviewStatus,
  result: nullableDecimal,
  reasonCode: z.string().nullable(),
});
export type FormulaPreviewOutcome = z.infer<typeof formulaPreviewOutcome>;

export const FORMULA_PREVIEW_EDGE_CASES = ["zero", "missing", "negative"] as const;
export const formulaPreviewEdgeCase = z.strictObject({
  variable: z.string(),
  case: z.enum(FORMULA_PREVIEW_EDGE_CASES),
  status: formulaPreviewStatus,
  result: nullableDecimal,
  reasonCode: z.string().nullable(),
});
export type FormulaPreviewEdgeCase = z.infer<typeof formulaPreviewEdgeCase>;

export const formulaPreviewProblem = z.strictObject({
  code: z.string(),
  message: z.string(),
  pointer: z.string().nullable(),
});

export const formulaPreviewResult = z.strictObject({
  valid: z.boolean(),
  errors: z.array(formulaPreviewProblem),
  unit: formulaPreviewUnit,
  examples: z.array(formulaPreviewOutcome),
  edgeCases: z.array(formulaPreviewEdgeCase),
  engineVersion: z.string(),
});
export type FormulaPreviewResult = z.infer<typeof formulaPreviewResult>;

// ------------------------------------------------------------------------------------------------ settings

export const FINANCIAL_METRIC_METHODOLOGIES = ["discounted_net_cash_flow"] as const;
export const FINANCIAL_METRIC_TIMINGS = ["end_of_period", "beginning_of_period"] as const;
export const financialMetricTiming = z.enum(FINANCIAL_METRIC_TIMINGS);
export const FINANCIAL_METRIC_PERIOD_BASES = ["annual", "quarterly", "monthly"] as const;
export const financialMetricPeriodBasis = z.enum(FINANCIAL_METRIC_PERIOD_BASES);

export const financialMetricSettings = z.strictObject({
  enabled: z.boolean(),
  methodology: z.enum(FINANCIAL_METRIC_METHODOLOGIES),
  methodologyNote: z.string().nullable(),
  timing: financialMetricTiming.nullable(),
  periodBasis: financialMetricPeriodBasis.nullable(),
  discountRate: nullableDecimal,
  assumptionsSetBy: nullableUuid,
  assumptionsSetAt: nullableTimestamp,
  enabledChangedBy: nullableUuid,
  enabledChangedAt: nullableTimestamp,
  extension: z.literal(true),
  version: z.number().int().min(0),
});
export type FinancialMetricSettings = z.infer<typeof financialMetricSettings>;

export const financialMetricEnablement = z.strictObject({ enabled: z.boolean() });
export type FinancialMetricEnablement = z.infer<typeof financialMetricEnablement>;

/** Request body; the discount-rate RANGE ([0, 1], at most 6 decimals) is the API's 422 discount_rate_invalid. */
export const financialMetricAssumptions = z.strictObject({
  methodologyNote: freeText(3, 2000),
  timing: financialMetricTiming,
  periodBasis: financialMetricPeriodBasis,
  discountRate: nullableDecimal,
});
export type FinancialMetricAssumptions = z.infer<typeof financialMetricAssumptions>;

/** The assumptions as a response names them (stored text; no free-text re-validation of stored rows). */
export const financialMetricAssumptionsView = z.strictObject({
  methodologyNote: z.string().min(3).max(2000),
  timing: financialMetricTiming,
  periodBasis: financialMetricPeriodBasis,
  discountRate: nullableDecimal,
});
export type FinancialMetricAssumptionsView = z.infer<typeof financialMetricAssumptionsView>;

// ------------------------------------------------------------------------------------------------ cash flows

const cashFlowAmount = moneyDecimal.refine((v) => compareDecimal(v, "0") >= 0, "validation.decimal_non_negative");

export const cashFlowRowInput = z.strictObject({
  periodIndex: z.number().int().min(0).max(120),
  outflow: cashFlowAmount,
  inflow: cashFlowAmount,
  note: freeText(1, 500).nullable().optional(),
});
export type CashFlowRowInput = z.infer<typeof cashFlowRowInput>;

export const cashFlowRow = z.strictObject({
  periodIndex: z.number().int().min(0).max(120),
  outflow: decimal,
  inflow: decimal,
  note: z.string().min(1).max(500).nullable().optional(),
});
export type CashFlowRow = z.infer<typeof cashFlowRow>;

export const businessCaseCashFlows = z.strictObject({
  businessCaseId: uuid,
  currency,
  revision: z.number().int().min(0),
  basisNote: z.string().nullable(),
  rows: z.array(cashFlowRow).max(121),
  version: z.number().int().min(0),
  updatedAt: nullableTimestamp,
});
export type BusinessCaseCashFlows = z.infer<typeof businessCaseCashFlows>;

export const businessCaseCashFlowsPut = z.strictObject({
  basisNote: freeText(1, 2000).nullable().optional(),
  rows: z.array(cashFlowRowInput).min(1).max(121),
});
export type BusinessCaseCashFlowsPut = z.infer<typeof businessCaseCashFlowsPut>;

// ------------------------------------------------------------------------------------------------ metrics

export const FINANCIAL_METRICS_STATUSES = ["shown", "disabled", "assumptions_missing", "cash_flows_missing"] as const;
export type FinancialMetricsStatus = (typeof FINANCIAL_METRICS_STATUSES)[number];

export const financialMetrics = z.strictObject({
  businessCaseId: uuid,
  status: z.enum(FINANCIAL_METRICS_STATUSES),
  currency,
  npv: nullableDecimal,
  npvReason: z.enum(["discount_rate_missing", "not_shown"]).nullable(),
  roi: nullableDecimal,
  roiReason: z.enum(["not_computable", "not_shown"]).nullable(),
  paybackPeriodIndex: z.number().int().nullable(),
  paybackReason: z.enum(["not_reached", "not_computable", "not_shown"]).nullable(),
  assumptions: financialMetricAssumptionsView.nullable(),
  cashFlowRevision: z.number().int().nullable(),
  extension: z.literal(true),
});
export type FinancialMetrics = z.infer<typeof financialMetrics>;

export const financialMetricsPage = z.strictObject({
  items: z.array(financialMetrics),
  nextCursor: z.string().nullable(),
});
export type FinancialMetricsPage = z.infer<typeof financialMetricsPage>;
