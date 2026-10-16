// The International Roaming dataset's benefit register (ADR-0050 §4; p5-work-split §J.3; T-DG5-KBE-H; ADR-0029,
// ADR-0030; B0121, B0123): the three B0147 chain benefits, each with a DISTINCT financial classification (M0346)
//   B01 revenue / revenue_uplift   "Revenue uplift"      measured by K1 attach rate     formula BF-01
//   B02 cost / avoided_cost        "CX + care cost"      measured by K2 complaint rate  formula BF-02
//   B03 revenue / margin_uplift    "Margin improvement"  measured by K3 cost per MB     formula BF-03
// and the SHARED BENEFIT of M0348: B01 is allocated to two initiatives (70 % pass redesign, 20 % proactive comms; the
// remaining 10 % is shown as unallocated). Totals count B01 once, never its allocations (REQ-PB-058).
// Each benefit reaches its step through the B0121 lifecycle (Identify -> Plan -> Enable -> Measure; B02 stays at
// Enable), with its enabler link to its initiative. The planned and forecast series (benefit_plan_value) and the
// measurements (benefit_measurement, with the benefit_calculation lineage and the inputs bound to the accepted KPI
// actual versions) are kept apart: a planned or forecast value never counts as measured, submitted or validated value.
// The Finance decisions on the measurements (two validated, one pending) are in finance.ts.
//
// EVERY NUMBER IS SYNTHETIC (B0144, M0339). Decimal strings only. The planned, forecast and measured amounts and
// the calculation lineage are literals (this package may not import the formula engine, ADR-0002 rule 5); the tests
// recompute every one of them with the engine (@mth/shared/calc) from the formula version and the KPI values:
// packages/db/test/integration/demo-numbers-spec.test.ts from the dataset, and demo-numbers.test.ts from the stored rows.
import { sql } from "kysely";
import type { Tx } from "../../pool.ts";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import { actualIds, demoActual, roundingRecord } from "./actuals.ts";
import { caseLineId, DEMO_FORMULA_RESULT_TYPE, demoCaseLine, demoFormula, type DemoFormula } from "./business-cases.ts";
import {
  DEMO_ANCHORS,
  demoKpi,
  FORMULA_ENGINE_VERSION,
  ID_BLOCK,
  KBE_H_FIRST_ORDER,
  kbeId,
  scoped,
  seedUpdate,
  stamps,
  SYNTHETIC_NOTE,
  when,
  type DemoKpi,
} from "./kpis.ts";

export interface DemoPlanValue {
  readonly kind: "planned" | "forecast";
  readonly start: string;
  readonly end: string;
  /** The KPI value the amount assumes (the trajectory point for planned; the forecast assumption for forecast). */
  readonly kpiValue: string;
  /** Literal SAR amount = the formula with its KPI variable set to kpiValue. */
  readonly amount: string;
  readonly note: string;
}

export interface DemoMeasurement {
  readonly key: string;
  readonly no: number;
  /** The benefit's measurement number (1, 2, ...). */
  readonly measurementNo: number;
  /** The accepted KPI actual whose value feeds the formula's KPI variable (same period). */
  readonly actual: string;
  readonly start: string;
  readonly end: string;
  /** Literal SAR amount (numeric(20,4), canonical) = the formula with the KPI variable set to the accepted value. */
  readonly amount: string;
  readonly submittedAt: string;
  /** The Finance outcome recorded in finance.ts: validated (approved) or pending (queued). */
  readonly finance: "validated" | "pending";
  readonly decidedAt: string | null;
}

export interface DemoBenefit {
  readonly key: "revenue_uplift" | "care_cost_avoidance" | "margin_improvement";
  readonly no: number;
  readonly id: string;
  readonly code: string;
  readonly title: string;
  readonly description: string;
  readonly benefitType: "revenue" | "cost";
  readonly valueClass: "revenue_uplift" | "avoided_cost" | "margin_uplift";
  readonly financialStatementLine: string;
  readonly kpi: DemoKpi["key"];
  readonly formula: DemoFormula["key"];
  readonly caseLine: string;
  readonly baselineUnit: string;
  readonly counterfactual: string;
  readonly driverKey: string;
  readonly driverUnits: string;
  readonly populationKey: string;
  readonly plannedValue: string;
  readonly confidence: "H" | "M" | "L";
  readonly assumptions: string;
  readonly finalStep: "enable" | "measure";
  readonly enabler: keyof typeof DEMO_ANCHORS.initiatives;
  /** The allocation set 1 (shares are fractions; the rest is unallocated), or none. */
  readonly allocations: readonly {
    readonly initiative: keyof typeof DEMO_ANCHORS.initiatives;
    readonly share: string;
    readonly basis: string;
  }[];
  /** Whether Finance validates the baseline (finance.ts). */
  readonly baselineValidated: boolean;
  readonly planValues: readonly DemoPlanValue[];
  readonly measurements: readonly DemoMeasurement[];
}

const PLANNED = "Planned from the approved KPI trajectory (synthetic).";

export const DEMO_BENEFITS: readonly DemoBenefit[] = [
  {
    key: "revenue_uplift",
    no: 1,
    id: kbeId(ID_BLOCK.benefit, 1),
    code: "B01",
    title: "Roaming revenue uplift",
    description:
      "Additional roaming pass revenue from a higher attach rate after the pass redesign and digital activation " +
      "(chain 1: low activation -> revenue uplift). " +
      SYNTHETIC_NOTE,
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    financialStatementLine: "Revenue - international roaming",
    kpi: "attach_rate",
    formula: "revenue_uplift",
    caseLine: "benefit.revenue_uplift",
    baselineUnit: "fraction",
    counterfactual: "Without the redesign the attach rate stays at the May 2026 baseline of 18 % (synthetic).",
    driverKey: "roaming.attach_rate",
    driverUnits: "travelling customers",
    populationKey: "roaming.travelling_customers",
    plannedValue: "7128000",
    confidence: "M",
    assumptions: "220,000 travelling customers per month; pass ARPU 45 SAR (synthetic).",
    finalStep: "measure",
    enabler: "passRedesign",
    allocations: [
      {
        initiative: "passRedesign",
        share: "0.7",
        basis: "Pass redesign and digital activation drive most activations (synthetic).",
      },
      {
        initiative: "proactiveComms",
        share: "0.2",
        basis: "Proactive welcome messages prompt activation on arrival (synthetic).",
      },
    ],
    baselineValidated: true,
    planValues: [
      { kind: "planned", start: "2026-07-01", end: "2026-07-31", kpiValue: "0.2", amount: "198000", note: PLANNED },
      { kind: "planned", start: "2026-08-01", end: "2026-08-31", kpiValue: "0.21", amount: "297000", note: PLANNED },
      { kind: "planned", start: "2026-09-01", end: "2026-09-30", kpiValue: "0.22", amount: "396000", note: PLANNED },
      {
        kind: "forecast",
        start: "2026-09-01",
        end: "2026-09-30",
        kpiValue: "0.195",
        amount: "148500",
        note: "Forecast: the August attach rate plus 0.5 pp (synthetic assumption).",
      },
    ],
    measurements: [
      {
        key: "revenue_uplift.2026-07",
        no: 1,
        measurementNo: 1,
        actual: "attach_rate.2026-07",
        start: "2026-07-01",
        end: "2026-07-31",
        amount: "222750",
        submittedAt: "2026-08-04T07:00:00Z",
        finance: "validated",
        decidedAt: "2026-08-12T08:00:00Z",
      },
      {
        key: "revenue_uplift.2026-08",
        no: 3,
        measurementNo: 2,
        actual: "attach_rate.2026-08",
        start: "2026-08-01",
        end: "2026-08-31",
        amount: "99000",
        submittedAt: "2026-09-01T05:45:00Z",
        finance: "pending",
        decidedAt: null,
      },
    ],
  },
  {
    key: "care_cost_avoidance",
    no: 2,
    id: kbeId(ID_BLOCK.benefit, 2),
    code: "B02",
    title: "Avoided roaming care cost",
    description:
      "Care cost avoided by fewer roaming complaints after proactive communications and QoS monitoring (chain 2: " +
      "high complaints -> CX + care cost). Avoided cost, not a cash saving. " +
      SYNTHETIC_NOTE,
    benefitType: "cost",
    valueClass: "avoided_cost",
    financialStatementLine: "Opex - customer care (avoided cost)",
    kpi: "complaint_rate",
    formula: "care_cost_avoidance",
    caseLine: "benefit.care_cost_avoidance",
    baselineUnit: "fraction",
    counterfactual: "Without proactive communications the complaint rate stays at 3.5 % (synthetic).",
    driverKey: "roaming.complaint_rate",
    driverUnits: "travelling customers",
    populationKey: "roaming.travelling_customers.care",
    plannedValue: "1584000",
    confidence: "M",
    assumptions: "220,000 travelling customers per month; 60 SAR per complaint (synthetic).",
    finalStep: "enable",
    enabler: "proactiveComms",
    allocations: [],
    baselineValidated: false,
    planValues: [
      { kind: "planned", start: "2026-07-01", end: "2026-07-31", kpiValue: "0.032", amount: "39600", note: PLANNED },
      { kind: "planned", start: "2026-08-01", end: "2026-08-31", kpiValue: "0.03", amount: "66000", note: PLANNED },
      { kind: "planned", start: "2026-09-01", end: "2026-09-30", kpiValue: "0.029", amount: "79200", note: PLANNED },
    ],
    measurements: [],
  },
  {
    key: "margin_improvement",
    no: 3,
    id: kbeId(ID_BLOCK.benefit, 3),
    code: "B03",
    title: "Roaming wholesale margin improvement",
    description:
      "Wholesale margin from a lower partner cost per MB after partner optimization and analytics (chain 3: partner " +
      "cost pressure -> margin improvement). Margin uplift, kept apart from revenue uplift. " +
      SYNTHETIC_NOTE,
    benefitType: "revenue",
    valueClass: "margin_uplift",
    financialStatementLine: "Gross margin - roaming wholesale",
    kpi: "cost_per_mb",
    formula: "margin_improvement",
    caseLine: "benefit.margin_improvement",
    baselineUnit: "SAR per MB",
    counterfactual: "Without renegotiation the partner cost stays at 0.012 SAR per MB (synthetic).",
    driverKey: "roaming.partner_cost_per_mb",
    driverUnits: "MB of roaming data",
    populationKey: "roaming.data_volume",
    plannedValue: "1920000",
    confidence: "H",
    assumptions: "80,000,000 MB of roaming data per month (synthetic).",
    finalStep: "measure",
    enabler: "partnerOptimization",
    allocations: [],
    baselineValidated: true,
    planValues: [
      { kind: "planned", start: "2026-07-01", end: "2026-07-31", kpiValue: "0.0115", amount: "40000", note: PLANNED },
      { kind: "planned", start: "2026-08-01", end: "2026-08-31", kpiValue: "0.011", amount: "80000", note: PLANNED },
      { kind: "planned", start: "2026-09-01", end: "2026-09-30", kpiValue: "0.0105", amount: "120000", note: PLANNED },
    ],
    measurements: [
      {
        key: "margin_improvement.2026-07",
        no: 2,
        measurementNo: 1,
        actual: "cost_per_mb.2026-07",
        start: "2026-07-01",
        end: "2026-07-31",
        amount: "80000",
        submittedAt: "2026-08-04T07:30:00Z",
        finance: "validated",
        decidedAt: "2026-08-12T08:30:00Z",
      },
    ],
  },
];

export function demoBenefit(key: DemoBenefit["key"]): DemoBenefit {
  const b = DEMO_BENEFITS.find((x) => x.key === key);
  if (b === undefined) throw new Error(`demo seed: no benefit ${key}`);
  return b;
}

export const measurementId = (m: DemoMeasurement): string => kbeId(ID_BLOCK.benefitMeasurement, m.no);
export const calculationId = (m: DemoMeasurement): string => kbeId(ID_BLOCK.benefitCalculation, m.no);

/** The accepted KPI value (ratio, stored at numeric(24,6)) that a measurement binds to its KPI variable. */
export function measuredKpiValue(m: DemoMeasurement): string {
  return demoActual(m.actual).evaluation.value;
}

const BENEFITS_CREATED_AT = "2026-05-29T07:00:00Z";
const BENEFITS_PLANNED_AT = "2026-06-02T07:00:00Z";
const BENEFITS_ENABLED_AT = "2026-06-15T07:00:00Z";
const BENEFITS_MEASURE_AT = "2026-07-02T07:00:00Z";

async function seedBenefit(ctx: DemoSeedContext, b: DemoBenefit): Promise<void> {
  const { bo, fin } = DEMO_ANCHORS.users;
  const k = demoKpi(b.kpi);
  const f = demoFormula(b.formula);
  const created = when(ctx, BENEFITS_CREATED_AT);
  await ctx.insert("benefit", `kbe.benefit.${b.key}`, {
    id: b.id,
    ...scoped(),
    code: b.code,
    title: b.title,
    description: b.description,
    benefit_type: b.benefitType,
    value_class: b.valueClass,
    owner_user_id: bo,
    finance_validator_user_id: fin,
    finance_validation_required: true,
    financial_statement_line: b.financialStatementLine,
    measurement_kpi_definition_id: k.definitionId,
    measurement_kpi_variable: f.kpiVariable,
    business_case_line_id: caseLineId(demoCaseLine(b.caseLine)),
    benefit_formula_id: f.id,
    baseline_value: k.baselineValue,
    baseline_unit: b.baselineUnit,
    baseline_date: k.baselineDate,
    counterfactual: b.counterfactual,
    baseline_validation_status: "unvalidated",
    driver_key: b.driverKey,
    driver_units: b.driverUnits,
    population_key: b.populationKey,
    target_value: k.targetValue,
    target_date: k.targetDate,
    realization_start: "2026-07-01",
    realization_end: "2027-06-30",
    recurrence: "recurring",
    currency: "SAR",
    planned_value: b.plannedValue,
    measurement_source: `Accepted actuals of the KPI "${k.name}" (synthetic)`,
    confidence: b.confidence,
    assumptions: b.assumptions,
    allocation_set_no: 0,
    lifecycle_step: "identify",
    status: "active",
    version: 1,
    ...stamps(created, bo),
  });
  const planned = when(ctx, BENEFITS_PLANNED_AT);
  await seedUpdate(ctx, "benefit", b.id, "step", { lifecycle_step: "plan" }, planned, bo);
  if (b.allocations.length > 0) {
    await seedUpdate(ctx, "benefit", b.id, "allocate", { allocation_set_no: 1 }, planned, bo);
    let n = 0;
    for (const a of b.allocations) {
      n += 1;
      await ctx.insert("benefit_allocation", `kbe.benefit.${b.key}.allocation.1.${a.initiative.toLowerCase()}`, {
        id: kbeId(ID_BLOCK.benefitAllocation, b.no * 0x100 + n),
        ...scoped(),
        benefit_id: b.id,
        set_no: 1,
        initiative_id: DEMO_ANCHORS.initiatives[a.initiative],
        share: a.share,
        basis: a.basis,
        created_at: planned,
        created_by: bo,
      });
    }
  }
  let n = 0;
  for (const p of b.planValues) {
    n += 1;
    await ctx.insert("benefit_plan_value", `kbe.benefit.${b.key}.${p.kind}.${p.start}`, {
      id: kbeId(ID_BLOCK.benefitPlanValue, b.no * 0x100 + n),
      ...scoped(),
      benefit_id: b.id,
      value_kind: p.kind,
      period_start: p.start,
      period_end: p.end,
      amount: p.amount,
      kpi_value: p.kpiValue,
      currency: "SAR",
      note: p.note,
      version: 1,
      ...stamps(planned, bo),
    });
  }
  const enabled = when(ctx, BENEFITS_ENABLED_AT);
  await seedUpdate(ctx, "benefit", b.id, "step", { lifecycle_step: "enable" }, enabled, bo);
  await ctx.insert("benefit_enabler", `kbe.benefit.${b.key}.enabler.${b.enabler.toLowerCase()}`, {
    id: kbeId(ID_BLOCK.benefitEnabler, b.no),
    ...scoped(),
    benefit_id: b.id,
    initiative_id: DEMO_ANCHORS.initiatives[b.enabler],
    deliverable_id: null,
    capability_id: null,
    note: "The initiative that must be delivered before this benefit can appear (B0121 Enable).",
    status: "active",
    version: 1,
    ...stamps(enabled, bo),
  });
  if (b.finalStep === "measure")
    await seedUpdate(ctx, "benefit", b.id, "step", { lifecycle_step: "measure" }, when(ctx, BENEFITS_MEASURE_AT), bo);
  for (const m of b.measurements) await seedMeasurement(ctx, b, f, m);
}

/** One submitted measurement with its calculation lineage (benefit_calculation + inputs), as the API records it. */
async function seedMeasurement(
  ctx: DemoSeedContext,
  b: DemoBenefit,
  f: DemoFormula,
  m: DemoMeasurement,
): Promise<void> {
  const { bo } = DEMO_ANCHORS.users;
  const a = demoActual(m.actual);
  const aIds = actualIds(a);
  if (a.period !== m.start.slice(0, 7)) throw new Error(`demo seed: ${m.key} binds an actual of another period`);
  const kpiValue = measuredKpiValue(m);
  const submitted = when(ctx, m.submittedAt);
  const calcInputs: Record<string, unknown> = {};
  for (const v of f.variables) {
    const fromKpi = v.name === f.kpiVariable;
    calcInputs[v.name] = {
      name: v.name,
      kind: v.kind,
      unit: v.unit ?? null,
      currency: v.currency ?? null,
      period: v.period,
      value: fromKpi ? kpiValue : v.value,
      description: v.description,
      source: fromKpi ? `KPI actual ${aIds.actual} value 1` : v.source,
    };
  }
  // The formula result (SAR per month) is the measured amount: every amount here is whole riyals, so the one storage
  // rounding to numeric(24,6) and the money rounding to numeric(20,4) change nothing (the tests assert both).
  const rounding = roundingRecord(m.amount, m.amount);
  const resultType = DEMO_FORMULA_RESULT_TYPE;
  await ctx.insert("benefit_calculation", `kbe.benefit.${m.key}.calculation`, {
    id: calculationId(m),
    ...scoped(),
    formula_version_id: f.versionId,
    inputs: JSON.stringify(calcInputs),
    assumptions: b.assumptions,
    period_start: m.start,
    period_end: m.end,
    outcome: "ok",
    result: m.amount,
    result_kind: resultType.kind,
    result_unit: resultType.unit,
    result_currency: resultType.currency,
    result_period: resultType.period,
    error_code: null,
    rounded: false,
    rounding: JSON.stringify(rounding),
    engine_version: FORMULA_ENGINE_VERSION,
    computed_at: submitted,
    computed_by: bo,
  });
  const id = measurementId(m);
  await ctx.insert("benefit_measurement", `kbe.benefit.${m.key}`, {
    id,
    ...scoped(),
    benefit_id: b.id,
    measurement_no: m.measurementNo,
    kind: "measurement",
    corrects_measurement_id: null,
    source: "manual",
    calculation_run_id: null,
    benefit_calculation_id: calculationId(m),
    formula_version_id: f.versionId,
    period_start: m.start,
    period_end: m.end,
    amount: m.amount,
    kpi_value: null,
    currency: "SAR",
    missing_reason: null,
    attribution: `Attributed to the enabling initiative per the allocation in force; counterfactual: ${b.counterfactual}`,
    assumptions: b.assumptions,
    status: "submitted",
    validated_amount: null,
    submitted_by: bo,
    submitted_at: submitted,
    decided_by: null,
    decided_at: null,
    reason: null,
    version: 1,
    ...stamps(submitted, bo),
  });
  let n = 0;
  for (const v of f.variables) {
    n += 1;
    const fromKpi = v.name === f.kpiVariable;
    await ctx.insert("benefit_measurement_input", `kbe.benefit.${m.key}.input.${v.name}`, {
      id: kbeId(ID_BLOCK.measurementInput, m.no * 0x100 + n),
      ...scoped(),
      measurement_id: id,
      variable_name: v.name,
      kpi_actual_id: fromKpi ? aIds.actual : null,
      kpi_value_no: fromKpi ? 1 : null,
      value: fromKpi ? kpiValue : v.value!,
      period_start: m.start,
      period_end: m.end,
      created_at: submitted,
      created_by: bo,
    });
  }
}

/** Module: each benefit through its lifecycle, with its allocations, plan values, enabler and measurements. */
export const BENEFITS_MODULE: DemoDatasetModule = {
  key: "kbe.benefits",
  order: KBE_H_FIRST_ORDER + 30,
  async seed(ctx) {
    for (const b of DEMO_BENEFITS) await seedBenefit(ctx, b);
  },
};

/**
 * Coverage condition `benefit.shared` (ADR-0050 §5 "one benefit allocated to at least two initiatives"; for BE-T's
 * named line in coverage.ts): active benefits of the transformation whose allocation set in force
 * (benefit.allocation_set_no) names at least two initiatives.
 */
export async function countSharedBenefits(tx: Tx, transformationId: string): Promise<number> {
  const r = await sql<{ n: string }>`
    SELECT count(*)::text AS n FROM benefit b
     WHERE b.transformation_id = ${transformationId}::uuid AND b.status = 'active' AND b.allocation_set_no >= 1
       AND (SELECT count(DISTINCT a.initiative_id) FROM benefit_allocation a
             WHERE a.benefit_id = b.id AND a.set_no = b.allocation_set_no) >= 2`.execute(tx);
  return Number(r.rows[0]!.n);
}
