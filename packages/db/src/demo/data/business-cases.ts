// The International Roaming dataset's business case and T09 benefit formulas (ADR-0050 §4; p5-work-split §J.3;
// T-DG5-KBE-H; ADR-0024; B0085, B0087). Three formulas, one per B0147 chain, in the restricted formula language of the
// DG3 engine (packages/shared/src/formula, reused unchanged), each with ONE Finance-validated version (finance.ts):
//   BF-01 revenue uplift   "Δ attach × customers × ARPU" (the B0087 revenue example's shape)
//         (measured_attach_rate - baseline_attach_rate) * travelling_customers * pass_arpu
//   BF-02 avoided care cost  Δ complaint rate × customers × cost per complaint
//         (baseline_complaint_rate - measured_complaint_rate) * travelling_customers * cost_per_complaint
//   BF-03 margin improvement "Volume × Δ unit cost" (the B0087 cost example's shape)
//         roaming_data_mb * (baseline_cost_per_mb - measured_cost_per_mb)
// Each result is SAR per month. The `measured_*` variable is the one fed by the benefit's measurement KPI (benefit
// .measurement_kpi_variable); its stored value is the target, so the version's preview is the monthly run-rate at
// target. The transformation-level case (all ten B0085 sections) has one benefit line per formula, each classified
// once (revenue uplift, avoided cost, margin uplift: never converted into each other, REQ-S08-009) at the annual
// run-rate (12 × the monthly preview), and four investment lines kept apart by class (cash capex, opex and vendor
// cost; non-cash internal FTE), so gross benefit, implementation cost and net are never mixed (value bases, D-117).
//
// T-DG5-BE-X2 (D-172; F-DG5-120, F-DG5-122): G4 reads an initiative-level case per initiative of the approved
// portfolio (ADR-0024 §1, the lighter set: rationale, interventions, investment, benefits, timing, ownership; investment
// and benefits each need >= 1 active line). The three initiative cases BC-02..BC-04 (INI-01..INI-03) therefore carry the
// existing lines of their chain: each B0147 chain's benefit line and the cash investment that delivers it. The internal
// team line stays on the transformation case. The transformation case's totals read its own lines and those of its
// active initiative cases BY REFERENCE (kpi/totals.ts), so splitting the lines changes no figure: the same seven lines,
// the same amounts, the same gross, cost and net (the tests pin them unchanged).
//
// EVERY NUMBER IS SYNTHETIC (B0144, M0339). Decimal strings only; fractions for rates. The formula previews, result
// types and line amounts are literals (this package may not import the formula engine, ADR-0002 rule 5); the tests
// recompute every one of them with the engine (@mth/shared/calc): packages/db/test/integration/demo-numbers-spec.test.ts
// from the dataset, and demo-numbers.test.ts from the stored rows.
import { createHash } from "node:crypto";
import type { DemoDatasetModule, DemoSeedContext } from "../seed.ts";
import {
  DEMO_ANCHORS,
  FORMULA_ENGINE_VERSION,
  ID_BLOCK,
  KBE_H_FIRST_ORDER,
  kbeId,
  scoped,
  seedUpdate,
  stamps,
  SYNTHETIC_NOTE,
  when,
} from "./kpis.ts";

/** A typed variable of the restricted formula language (the engine's FormulaVariable, with its T09 description). */
export interface DemoFormulaVariable {
  readonly name: string;
  readonly kind: "fraction" | "count" | "currency";
  readonly period: "none" | "month";
  readonly unit?: string;
  readonly currency?: string;
  /** Decimal string: the stored value of the version. */
  readonly value: string;
  readonly description: string;
  readonly source: string;
}

/** The engine's result type of every formula here (SAR per month; the engine's typecheck, asserted by the tests). */
export const DEMO_FORMULA_RESULT_TYPE = {
  kind: "currency",
  currency: "SAR",
  period: "month",
  unit: null,
} as const;

export interface DemoFormula {
  readonly key: "revenue_uplift" | "care_cost_avoidance" | "margin_improvement";
  readonly no: number;
  readonly id: string;
  readonly versionId: string;
  readonly code: string;
  readonly benefitName: string;
  readonly baselineDriver: string;
  readonly changeAssumption: string;
  readonly ramp: string;
  readonly confidence: "H" | "M" | "L";
  readonly expression: string;
  readonly variables: readonly DemoFormulaVariable[];
  /** The variable fed by the measurement KPI's accepted actuals (benefit.measurement_kpi_variable). */
  readonly kpiVariable: string;
  /** Literal: the engine's result with the stored values (SAR per month at target). */
  readonly previewResult: string;
}

const SAR = "SAR";

export const DEMO_FORMULAS: readonly DemoFormula[] = [
  {
    key: "revenue_uplift",
    no: 1,
    id: kbeId(ID_BLOCK.benefitFormula, 1),
    versionId: kbeId(ID_BLOCK.formulaVersion, 1),
    code: "BF-01",
    benefitName: "Revenue uplift",
    baselineDriver: "Travelling customers × attach rate × pass ARPU",
    changeAssumption: "Attach +6 pp (18 % to 24 %) by December 2026",
    ramp: "Q3-Q4",
    confidence: "M",
    expression: "(measured_attach_rate - baseline_attach_rate) * travelling_customers * pass_arpu",
    variables: [
      {
        name: "measured_attach_rate",
        kind: "fraction",
        period: "none",
        value: "0.24",
        description: "Attach rate; the target here, the accepted KPI actual in a measurement",
        source: "KPI Attach rate / activation (synthetic)",
      },
      {
        name: "baseline_attach_rate",
        kind: "fraction",
        period: "none",
        value: "0.18",
        description: "Baseline attach rate (May 2026)",
        source: "Synthetic baseline",
      },
      {
        name: "travelling_customers",
        kind: "count",
        period: "month",
        unit: "customers",
        value: "220000",
        description: "Travelling customers per month (planning population)",
        source: "Synthetic planning assumption",
      },
      {
        name: "pass_arpu",
        kind: "currency",
        currency: SAR,
        period: "none",
        value: "45",
        description: "Average revenue per roaming pass",
        source: "Synthetic planning assumption",
      },
    ],
    kpiVariable: "measured_attach_rate",
    previewResult: "594000",
  },
  {
    key: "care_cost_avoidance",
    no: 2,
    id: kbeId(ID_BLOCK.benefitFormula, 2),
    versionId: kbeId(ID_BLOCK.formulaVersion, 2),
    code: "BF-02",
    benefitName: "CX + care cost",
    baselineDriver: "Travelling customers × complaint rate × cost per complaint",
    changeAssumption: "Complaint rate -1 pp (3.5 % to 2.5 %) by December 2026",
    ramp: "Q3-Q4",
    confidence: "M",
    expression: "(baseline_complaint_rate - measured_complaint_rate) * travelling_customers * cost_per_complaint",
    variables: [
      {
        name: "baseline_complaint_rate",
        kind: "fraction",
        period: "none",
        value: "0.035",
        description: "Baseline complaint rate (May 2026)",
        source: "Synthetic baseline",
      },
      {
        name: "measured_complaint_rate",
        kind: "fraction",
        period: "none",
        value: "0.025",
        description: "Complaint rate; the target here, the accepted KPI actual in a measurement",
        source: "KPI Complaint rate (synthetic)",
      },
      {
        name: "travelling_customers",
        kind: "count",
        period: "month",
        unit: "customers",
        value: "220000",
        description: "Travelling customers per month (planning population)",
        source: "Synthetic planning assumption",
      },
      {
        name: "cost_per_complaint",
        kind: "currency",
        currency: SAR,
        period: "none",
        value: "60",
        description: "Fully loaded care cost per roaming complaint",
        source: "Synthetic planning assumption",
      },
    ],
    kpiVariable: "measured_complaint_rate",
    previewResult: "132000",
  },
  {
    key: "margin_improvement",
    no: 3,
    id: kbeId(ID_BLOCK.benefitFormula, 3),
    versionId: kbeId(ID_BLOCK.formulaVersion, 3),
    code: "BF-03",
    benefitName: "Margin improvement",
    baselineDriver: "Roaming data volume × partner cost per MB",
    changeAssumption: "Partner cost per MB -16.7 % (0.012 to 0.010 SAR) by October 2026",
    ramp: "Q3-Q4",
    confidence: "H",
    expression: "roaming_data_mb * (baseline_cost_per_mb - measured_cost_per_mb)",
    variables: [
      {
        name: "roaming_data_mb",
        kind: "count",
        period: "month",
        unit: "MB",
        value: "80000000",
        description: "Roaming data volume per month (planning volume)",
        source: "Synthetic planning assumption",
      },
      {
        name: "baseline_cost_per_mb",
        kind: "currency",
        currency: SAR,
        period: "none",
        value: "0.012",
        description: "Baseline partner wholesale cost per MB (May 2026)",
        source: "Synthetic baseline",
      },
      {
        name: "measured_cost_per_mb",
        kind: "currency",
        currency: SAR,
        period: "none",
        value: "0.01",
        description: "Partner cost per MB; the target here, the accepted KPI actual in a measurement",
        source: "KPI Cost/MB, margin (synthetic)",
      },
    ],
    kpiVariable: "measured_cost_per_mb",
    previewResult: "160000",
  },
];

export function demoFormula(key: DemoFormula["key"]): DemoFormula {
  const f = DEMO_FORMULAS.find((x) => x.key === key);
  if (f === undefined) throw new Error(`demo seed: no formula ${key}`);
  return f;
}

export interface DemoCaseLine {
  readonly key: string;
  readonly no: number;
  readonly lineKind: "investment" | "benefit";
  readonly investmentClass: "capex" | "opex" | "internal_fte" | "vendor_cost" | null;
  readonly benefitClass: "revenue" | "cost_avoidance" | null;
  readonly valueBasis: "revenue_uplift" | "margin_uplift" | "avoided_cost" | "cash" | "non_cash";
  readonly title: string;
  /** Literal; for a benefit line = 12 × the formula's monthly preview (annual run-rate at target). */
  readonly amount: string;
  readonly fte: string | null;
  readonly recurrence: "one_off" | "recurring";
  readonly formula: DemoFormula["key"] | null;
  /** The case that holds the line: null = the transformation case BC-01, else the initiative case of that chain. */
  readonly initiativeCase: DemoInitiativeCase["key"] | null;
}

export const DEMO_CASE_ID = kbeId(ID_BLOCK.businessCase, 1);

/** One initiative-level business case (ADR-0024 §1 lighter set), linked to BC-01 and to one B0147 initiative. */
export interface DemoInitiativeCase {
  readonly key: "activation" | "complaints" | "partner";
  readonly no: number;
  readonly id: string;
  readonly code: string;
  readonly initiativeId: string;
  readonly initiativeCode: "INI-01" | "INI-02" | "INI-03";
  readonly title: string;
  readonly strategicRationale: string;
  readonly baselineSummary: string;
  readonly interventionsSummary: string;
  readonly investmentSummary: string;
  readonly benefitsSummary: string;
  /** The cash investment the funding decision approves (the case's cash investment lines; decimal string). */
  readonly fundingAmount: string;
}

const INI = DEMO_ANCHORS.initiatives;

export const DEMO_INITIATIVE_CASES: readonly DemoInitiativeCase[] = [
  {
    key: "activation",
    no: 2,
    id: kbeId(ID_BLOCK.businessCase, 2),
    code: "BC-02",
    initiativeId: INI.passRedesign,
    initiativeCode: "INI-01",
    title: "INI-01 Pass redesign + digital activation: initiative business case (synthetic)",
    strategicRationale:
      "Low activation -> Proposition + journey -> attach rate / activation (B0147). " + SYNTHETIC_NOTE,
    baselineSummary: "May 2026 baseline: attach rate 18 % of 220,000 travelling customers per month. " + SYNTHETIC_NOTE,
    interventionsSummary: "Roaming pass architecture redesign and one-tap digital activation in the app.",
    investmentSummary: "Cash: capex 2,400,000 SAR for the digital roaming activation platform.",
    benefitsSummary: "Revenue uplift 7,128,000 SAR at the annual run-rate at target (formula BF-01).",
    fundingAmount: "2400000",
  },
  {
    key: "complaints",
    no: 3,
    id: kbeId(ID_BLOCK.businessCase, 3),
    code: "BC-03",
    initiativeId: INI.proactiveComms,
    initiativeCode: "INI-02",
    title: "INI-02 Proactive comms + QoS monitoring: initiative business case (synthetic)",
    strategicRationale: "High complaints -> Journey + service assurance -> complaint rate (B0147). " + SYNTHETIC_NOTE,
    baselineSummary: "May 2026 baseline: complaint rate 3.5 %, 60 SAR per complaint. " + SYNTHETIC_NOTE,
    interventionsSummary: "Proactive pre-travel and in-trip communications, and roaming QoS monitoring.",
    investmentSummary: "Cash: opex 360,000 SAR for proactive communications and QoS monitoring.",
    benefitsSummary: "Avoided care cost 1,584,000 SAR at the annual run-rate at target (formula BF-02).",
    fundingAmount: "360000",
  },
  {
    key: "partner",
    no: 4,
    id: kbeId(ID_BLOCK.businessCase, 4),
    code: "BC-04",
    initiativeId: INI.partnerOptimization,
    initiativeCode: "INI-03",
    title: "INI-03 Partner optimization: initiative business case (synthetic)",
    strategicRationale:
      "Partner cost pressure -> Partner model + analytics -> cost/MB, margin (B0147). " + SYNTHETIC_NOTE,
    baselineSummary: "May 2026 baseline: partner cost 0.012 SAR per MB on 80,000,000 MB per month. " + SYNTHETIC_NOTE,
    interventionsSummary: "Partner renegotiation for the highest-cost partners, backed by partner usage analytics.",
    investmentSummary: "Cash: vendor cost 900,000 SAR for the partner analytics service.",
    benefitsSummary: "Margin uplift 1,920,000 SAR at the annual run-rate at target (formula BF-03).",
    fundingAmount: "900000",
  },
];

export function demoInitiativeCase(key: DemoInitiativeCase["key"]): DemoInitiativeCase {
  const c = DEMO_INITIATIVE_CASES.find((x) => x.key === key);
  if (c === undefined) throw new Error(`demo seed: no initiative case ${key}`);
  return c;
}

/** The id of the case that holds a line. */
export const caseIdOfLine = (l: DemoCaseLine): string =>
  l.initiativeCase === null ? DEMO_CASE_ID : demoInitiativeCase(l.initiativeCase).id;

export const DEMO_CASE_LINES: readonly DemoCaseLine[] = [
  {
    key: "benefit.revenue_uplift",
    no: 1,
    lineKind: "benefit",
    investmentClass: null,
    benefitClass: "revenue",
    valueBasis: "revenue_uplift",
    title: "Revenue uplift (annual run-rate at target)",
    amount: "7128000",
    fte: null,
    recurrence: "recurring",
    formula: "revenue_uplift",
    initiativeCase: "activation",
  },
  {
    key: "benefit.care_cost_avoidance",
    no: 2,
    lineKind: "benefit",
    investmentClass: null,
    benefitClass: "cost_avoidance",
    valueBasis: "avoided_cost",
    title: "CX + care cost: avoided care cost (annual run-rate at target)",
    amount: "1584000",
    fte: null,
    recurrence: "recurring",
    formula: "care_cost_avoidance",
    initiativeCase: "complaints",
  },
  {
    key: "benefit.margin_improvement",
    no: 3,
    lineKind: "benefit",
    investmentClass: null,
    benefitClass: "revenue",
    valueBasis: "margin_uplift",
    title: "Margin improvement (annual run-rate at target)",
    amount: "1920000",
    fte: null,
    recurrence: "recurring",
    formula: "margin_improvement",
    initiativeCase: "partner",
  },
  {
    key: "investment.activation_platform",
    no: 4,
    lineKind: "investment",
    investmentClass: "capex",
    benefitClass: null,
    valueBasis: "cash",
    title: "Digital roaming activation platform",
    amount: "2400000",
    fte: null,
    recurrence: "one_off",
    formula: null,
    initiativeCase: "activation",
  },
  {
    key: "investment.proactive_comms",
    no: 5,
    lineKind: "investment",
    investmentClass: "opex",
    benefitClass: null,
    valueBasis: "cash",
    title: "Proactive roaming communications and QoS monitoring",
    amount: "360000",
    fte: null,
    recurrence: "recurring",
    formula: null,
    initiativeCase: "complaints",
  },
  {
    key: "investment.partner_analytics",
    no: 6,
    lineKind: "investment",
    investmentClass: "vendor_cost",
    benefitClass: null,
    valueBasis: "cash",
    title: "Partner analytics service",
    amount: "900000",
    fte: null,
    recurrence: "recurring",
    formula: null,
    initiativeCase: "partner",
  },
  {
    key: "investment.internal_team",
    no: 7,
    lineKind: "investment",
    investmentClass: "internal_fte",
    benefitClass: null,
    valueBasis: "non_cash",
    title: "Internal transformation team (non-cash)",
    amount: "1170000",
    fte: "6.5",
    recurrence: "recurring",
    formula: null,
    initiativeCase: null,
  },
];

export const caseLineId = (l: DemoCaseLine): string => kbeId(ID_BLOCK.businessCaseLine, l.no);

export function demoCaseLine(key: string): DemoCaseLine {
  const l = DEMO_CASE_LINES.find((x) => x.key === key);
  if (l === undefined) throw new Error(`demo seed: no business-case line ${key}`);
  return l;
}

const FORMULAS_CREATED_AT = "2026-05-26T07:00:00Z";
const CASE_CREATED_AT = "2026-05-27T07:00:00Z";

async function seedFormula(ctx: DemoSeedContext, f: DemoFormula): Promise<void> {
  const { bo } = DEMO_ANCHORS.users;
  const at = when(ctx, FORMULAS_CREATED_AT);
  const resultType = DEMO_FORMULA_RESULT_TYPE;
  await ctx.insert("benefit_formula", `kbe.formula.${f.key}`, {
    id: f.id,
    ...scoped(),
    code: f.code,
    benefit_name: f.benefitName,
    baseline_driver: f.baselineDriver,
    change_assumption: f.changeAssumption,
    ramp: f.ramp,
    confidence: f.confidence,
    owner_user_id: bo,
    current_version_no: null,
    is_illustrative: true,
    example_code: null,
    status: "active",
    version: 1,
    ...stamps(at, bo),
  });
  await ctx.insert("benefit_formula_version", `kbe.formula.${f.key}.v1`, {
    id: f.versionId,
    ...scoped(),
    formula_id: f.id,
    version_no: 1,
    expression: f.expression,
    expression_sha256: createHash("sha256").update(f.expression, "utf8").digest("hex"),
    result_kind: resultType.kind,
    result_unit: resultType.unit,
    result_currency: resultType.currency,
    result_period: resultType.period,
    preview_result: f.previewResult,
    engine_version: FORMULA_ENGINE_VERSION,
    change_note: "Initial version (synthetic demonstration).",
    validation_status: "unvalidated",
    version: 1,
    ...stamps(at, bo),
  });
  let ordinal = 0;
  for (const v of f.variables) {
    ordinal += 1;
    await ctx.insert("benefit_formula_variable", `kbe.formula.${f.key}.v1.${v.name}`, {
      id: kbeId(ID_BLOCK.formulaVariable, f.no * 0x100 + ordinal),
      ...scoped(),
      formula_version_id: f.versionId,
      ordinal,
      name: v.name,
      kind: v.kind,
      unit: v.unit ?? null,
      currency: v.currency ?? null,
      period: v.period,
      value: v.value,
      description: v.description,
      source: v.source,
      created_at: at,
      created_by: bo,
    });
  }
  await seedUpdate(ctx, "benefit_formula", f.id, "update", { current_version_no: 1 }, at, bo);
}

async function seedCase(ctx: DemoSeedContext): Promise<void> {
  const { tl, bo, fin, wl } = DEMO_ANCHORS.users;
  const at = when(ctx, CASE_CREATED_AT);
  await ctx.insert("business_case", "kbe.business_case.transformation", {
    id: DEMO_CASE_ID,
    ...scoped(),
    code: "BC-01",
    level: "transformation",
    initiative_id: null,
    parent_case_id: null,
    title: "International Roaming transformation business case (synthetic)",
    currency: SAR,
    strategic_rationale: "Make international roaming effortless, trusted and economically accretive. " + SYNTHETIC_NOTE,
    baseline_summary:
      "May 2026 baseline: attach rate 18 %, complaint rate 3.5 %, partner cost 0.012 SAR per MB. " + SYNTHETIC_NOTE,
    value_pools_summary:
      "Revenue from activation, avoided care cost from fewer complaints, wholesale margin from partner cost.",
    interventions_summary:
      "Pass redesign + digital activation; proactive comms + QoS monitoring; partner optimization.",
    investment_summary:
      "Cash: capex 2,400,000 SAR, opex 360,000 SAR, vendor cost 900,000 SAR. Non-cash: 6.5 internal FTE (1,170,000 SAR).",
    benefits_summary:
      "Annual run-rate at target: revenue uplift 7,128,000 SAR; avoided care cost 1,584,000 SAR; margin uplift " +
      "1,920,000 SAR. Each is a separate value basis and is never added to another basis or to costs.",
    benefit_ramp: "Monthly ramp from July 2026 to the December 2026 targets.",
    recurrence_summary: "Recurring benefits; the activation platform is a one-off investment.",
    implementation_horizon: "July 2026 to June 2027.",
    key_assumptions:
      "220,000 travelling customers and 80,000,000 MB of roaming data per month; pass ARPU 45 SAR; 60 SAR per " +
      "complaint. All assumptions are synthetic and must be replaced with validated company data (B0144).",
    downside_case: "Attach rate reaches 21 % only; partner renegotiation slips one quarter.",
    upside_case: "Attach rate reaches 26 %; partner cost reaches 0.0095 SAR per MB.",
    benefit_owner_user_id: bo,
    initiative_owner_user_id: wl,
    finance_validator_user_id: fin,
    decision_ask_types: ["funding"],
    decision_ask_text: "Fund the activation platform and the partner analytics service (synthetic demonstration).",
    baseline_validation_status: "unvalidated",
    status: "draft",
    version: 1,
    ...stamps(at, tl),
  });
  // The initiative cases (ADR-0024 §1 lighter set), created with the transformation case by its author (the TL), each
  // linked to BC-01 and to its initiative; the demo Finance user is their validator (roaming-portfolio.ts validates
  // their baselines; never the author).
  for (const c of DEMO_INITIATIVE_CASES)
    await ctx.insert("business_case", `kbe.business_case.initiative.${c.key}`, {
      id: c.id,
      ...scoped(),
      code: c.code,
      level: "initiative",
      initiative_id: c.initiativeId,
      parent_case_id: DEMO_CASE_ID,
      title: c.title,
      currency: SAR,
      strategic_rationale: c.strategicRationale,
      baseline_summary: c.baselineSummary,
      interventions_summary: c.interventionsSummary,
      investment_summary: c.investmentSummary,
      benefits_summary: c.benefitsSummary,
      benefit_ramp: "Monthly ramp from July 2026 to the December 2026 targets.",
      recurrence_summary: "Recurring benefit; the investment is approved once.",
      implementation_horizon: "July 2026 to December 2026.",
      initiative_owner_user_id: wl,
      finance_validator_user_id: fin,
      decision_ask_types: ["funding"],
      decision_ask_text: `Fund ${c.initiativeCode}: ${c.investmentSummary} (synthetic demonstration).`,
      baseline_validation_status: "unvalidated",
      status: "draft",
      version: 1,
      ...stamps(at, tl),
    });
  for (const l of DEMO_CASE_LINES) {
    await ctx.insert("business_case_line", `kbe.business_case.line.${l.key}`, {
      id: caseLineId(l),
      ...scoped(),
      business_case_id: caseIdOfLine(l),
      line_kind: l.lineKind,
      investment_class: l.investmentClass,
      benefit_class: l.benefitClass,
      value_basis: l.valueBasis,
      title: l.title,
      description: SYNTHETIC_NOTE,
      amount: l.amount,
      currency: SAR,
      fte: l.fte,
      period_start: "2026-07-01",
      period_end: "2027-06-30",
      recurrence: l.recurrence,
      benefit_formula_id: l.formula === null ? null : demoFormula(l.formula).id,
      owner_user_id: l.lineKind === "benefit" ? bo : wl,
      status: "active",
      version: 1,
      ...stamps(at, tl),
    });
  }
}

/** Module: the formulas (each with its version and variables), then the case and its lines. */
export const BUSINESS_CASES_MODULE: DemoDatasetModule = {
  key: "kbe.business_cases",
  order: KBE_H_FIRST_ORDER + 20,
  async seed(ctx) {
    for (const f of DEMO_FORMULAS) await seedFormula(ctx, f);
    await seedCase(ctx);
  },
};
