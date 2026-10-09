// SYNTHETIC fixtures of the benefits and Finance validation screens (T-DG4-FE-C). No real person, organization,
// benefit or Finance decision.
import { TR_ID, USER_ID } from "../../test/fixtures.tsx";
import { OTHER_USER } from "../../test/p2fixtures.ts";
import type {
  Benefit,
  BenefitAllocations,
  BenefitLifecycle,
  BenefitMeasurement,
  BenefitRegisterRow,
  BenefitScenario,
  BenefitTotals,
  BenefitValues,
  FinanceValidation,
} from "./api.ts";

export const T0 = "2026-10-01T09:00:00Z";
export const BENEFIT_ID = "01920000-0000-7000-9000-00000000b001";
export const CX_BENEFIT_ID = "01920000-0000-7000-9000-00000000b002";
export const INITIATIVE_A = "01920000-0000-7000-9000-00000000c001";
export const INITIATIVE_B = "01920000-0000-7000-9000-00000000c002";
export const MEASUREMENT_ID = "01920000-0000-7000-9000-00000000d001";
export const FV_ID = "01920000-0000-7000-9000-00000000e001";

const known = (amount: string) => ({ status: "known" as const, amount, currency: "SAR", reason: null });

export function registerRow(over: Partial<BenefitRegisterRow> = {}): BenefitRegisterRow {
  return {
    id: BENEFIT_ID,
    code: "B01",
    title: "Synthetic churn reduction",
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    baseline: { value: "1000000", unit: "SAR", date: "2026-01-01", baselineId: null, validationStatus: "validated" },
    target: { value: "1200000", date: "2027-12-31" },
    valueSar: known("10000000.0000"),
    realized: {
      validated: known("240000.5000"),
      validatedCount: 1,
      sustained: known("0.0000"),
      sustainedCount: 0,
      pending: known("250000.0000"),
      pendingCount: 1,
      kpiActual: { status: "not_applicable", value: null, reason: null },
    },
    ownerUserId: OTHER_USER,
    evidenceCount: 2,
    latestEvidenceIds: [],
    status: "green",
    lifecycleStep: "measure",
    realizationState: "measured_pending_validation",
    counting: { counted: true, exclusionReason: null, overlapOpen: false },
    currency: "SAR",
    version: 4,
    initiatives: [
      { id: INITIATIVE_A, code: "INI-0001", name: "Synthetic digital onboarding" },
      { id: INITIATIVE_B, code: "INI-0002", name: "Synthetic retention offers" },
    ],
    ...over,
  };
}

/** A CX benefit: Value (SAR) n/a, Realized = the KPI actual (Unknown here), status not assessed (Unknown). */
export function cxRow(): BenefitRegisterRow {
  return registerRow({
    id: CX_BENEFIT_ID,
    code: "B02",
    title: "Synthetic NPS uplift",
    benefitType: "cx",
    valueClass: "non_financial",
    valueSar: { status: "not_applicable", amount: null, currency: null, reason: null },
    realized: {
      validated: known("0.0000"),
      validatedCount: 0,
      sustained: known("0.0000"),
      sustainedCount: 0,
      pending: known("0.0000"),
      pendingCount: 0,
      kpiActual: { status: "unknown", value: null, reason: "benefit.kpi_actual_missing" },
    },
    status: "unknown",
    lifecycleStep: "plan",
    realizationState: "not_enabled",
    counting: { counted: false, exclusionReason: "group_counted_member_not_named", overlapOpen: true },
    initiatives: [],
  });
}

/** A financial benefit without a planned value: Value (SAR) Unknown with its reason, never 0. */
export function unknownValueRow(): BenefitRegisterRow {
  return registerRow({
    id: "01920000-0000-7000-9000-00000000b003",
    code: "B03",
    title: "Synthetic cash saving",
    benefitType: "cost",
    valueClass: "cash_saving",
    valueSar: { status: "unknown", amount: null, currency: null, reason: "benefit.planned_value_missing" },
    status: "unknown",
  });
}

export function benefit(over: Partial<Benefit> = {}): Benefit {
  return {
    id: BENEFIT_ID,
    transformationId: TR_ID,
    code: "B01",
    title: "Synthetic churn reduction",
    description: "Lower churn on the synthetic prepaid base.",
    benefitType: "revenue",
    valueClass: "revenue_uplift",
    ownerUserId: OTHER_USER,
    financeValidatorUserId: null,
    financeValidationRequired: true,
    financialStatementLine: "Revenue - prepaid",
    measurementKpiDefinitionId: null,
    measurementKpiVariable: null,
    businessCaseLineId: null,
    benefitFormulaId: "01920000-0000-7000-9000-00000000f001",
    baselineId: null,
    baselineValue: "1000000",
    baselineUnit: "SAR",
    baselineDate: "2026-01-01",
    counterfactual: null,
    baselineValidationStatus: "unvalidated",
    baselineValidatedBy: null,
    baselineValidatedAt: null,
    baselineValidationNote: null,
    driverKey: "prepaid.churn",
    driverUnits: null,
    populationKey: null,
    targetValue: "1200000",
    targetDate: "2027-12-31",
    realizationStart: "2026-01-01",
    realizationEnd: "2027-12-31",
    recurrence: "recurring",
    currency: "SAR",
    plannedValue: null,
    valuationMethodId: null,
    measurementSource: null,
    confidence: "M",
    assumptions: null,
    parentBenefitId: null,
    benefitGroupId: null,
    allocationSetNo: 1,
    lifecycleStep: "enable",
    recoveryPlan: null,
    bauOwnerUserId: null,
    controlCadence: null,
    statusRag: null,
    statusRagNote: null,
    realizationState: "not_enabled",
    counting: { counted: true, exclusionReason: null, overlapOpen: false },
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 3,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    updatedBy: USER_ID,
    ...over,
  };
}

const STEPS = [
  ["identify", "Identify", "What value is expected and why?", "Benefit statement", "التحديد"],
  ["plan", "Plan", "How will it be measured, when, and by whom?", "Baseline, formula, target, owner", "التخطيط"],
  ["enable", "Enable", "What must be delivered?", "Benefit dependency chain", "التمكين"],
  ["measure", "Measure", "Is it happening?", "Realized value", "القياس"],
  ["correct", "Correct", "What if it is off track?", "Recovery plan", "التصحيح"],
  ["sustain", "Sustain", "Will it last?", "BAU ownership", "الاستدامة"],
] as const;

export function lifecycle(current: Benefit["lifecycleStep"] = "enable"): BenefitLifecycle {
  return {
    benefitId: BENEFIT_ID,
    currentStep: current,
    steps: STEPS.map(([code, stepEn, questionEn, outputEn, stepAr], i) => ({
      code,
      ordinal: i + 1,
      stepEn,
      questionEn,
      outputEn,
      stepAr,
      questionAr: `سؤال ${stepAr}`,
      outputAr: `مخرج ${stepAr}`,
      arIsProvisional: true,
      preconditionsMet: code !== "measure" && code !== "sustain",
      missing: code === "measure" ? ["enablers"] : code === "sustain" ? ["bau_owner", "control_cadence"] : [],
    })),
    history: [
      { fromStep: null, toStep: "identify", benefitVersion: 1, occurredAt: T0, actorUserId: USER_ID },
      { fromStep: "identify", toStep: "plan", benefitVersion: 2, occurredAt: T0, actorUserId: USER_ID },
      { fromStep: "plan", toStep: "enable", benefitVersion: 3, occurredAt: T0, actorUserId: USER_ID },
    ],
  };
}

export function allocations(): BenefitAllocations {
  return {
    benefitId: BENEFIT_ID,
    setNo: 1,
    allocations: [
      { initiativeId: INITIATIVE_A, share: "0.600000", basis: null },
      { initiativeId: INITIATIVE_B, share: "0.300000", basis: "Synthetic usage split" },
    ],
    allocatedShare: "0.900000",
    unallocatedShare: "0.100000",
  };
}

export function values(): BenefitValues {
  const series = (state: BenefitValues["series"][number]["state"], amount: string, count: number) => ({
    state,
    total: known(amount),
    count,
    lines: [],
  });
  return {
    benefitId: BENEFIT_ID,
    currency: "SAR",
    series: [
      series("planned", "10000000.0000", 1),
      series("forecast", "999999.0000", 1),
      series("measured", "250000.0000", 1),
      series("submitted", "250000.0000", 1),
      series("validated", "0.0000", 0),
      series("sustained", "0.0000", 0),
      series("rejected", "0.0000", 0),
    ],
  };
}

export function measurement(over: Partial<BenefitMeasurement> = {}): BenefitMeasurement {
  return {
    id: MEASUREMENT_ID,
    benefitId: BENEFIT_ID,
    measurementNo: 1,
    kind: "measurement",
    correctsMeasurementId: null,
    source: "manual",
    calculationRunId: null,
    benefitCalculationId: null,
    formulaVersionId: null,
    periodStart: "2026-07-01",
    periodEnd: "2026-09-30",
    amount: "250000.0000",
    kpiValue: null,
    currency: "SAR",
    missingReason: null,
    attribution: "Synthetic: churn fell after the retention offers.",
    assumptions: "Synthetic ARPU constant.",
    status: "submitted",
    sustainPhase: false,
    validatedAmount: null,
    basis: "validated",
    inputs: [],
    evidenceIds: ["01920000-0000-7000-9000-00000000a001"],
    financeValidationId: FV_ID,
    submittedBy: OTHER_USER,
    submittedAt: T0,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    version: 2,
    createdAt: T0,
    createdBy: OTHER_USER,
    updatedAt: T0,
    ...over,
  };
}

export function financeValidation(over: Partial<FinanceValidation> = {}): FinanceValidation {
  return {
    id: FV_ID,
    benefitId: BENEFIT_ID,
    benefitMeasurementId: MEASUREMENT_ID,
    kind: "validation",
    correctsValidationId: null,
    assigneeUserId: USER_ID,
    status: "queued",
    content: {
      baseline: {
        value: "1000000",
        unit: "SAR",
        date: "2026-01-01",
        baselineId: null,
        counterfactual: null,
        validationStatus: "validated",
      },
      attribution: "Synthetic: churn fell after the retention offers.",
      calculation: {
        formulaVersionId: null,
        benefitCalculationId: null,
        amount: "250000.0000",
        kpiValue: null,
        currency: "SAR",
        inputs: [],
      },
      evidence: ["01920000-0000-7000-9000-00000000a001"],
      measurementPeriod: { start: "2026-07-01", end: "2026-09-30" },
      assumptions: "Synthetic ARPU constant.",
    },
    items: {
      baseline: null,
      attribution: null,
      calculation: null,
      evidence: null,
      measurementPeriod: null,
      assumptions: null,
    },
    approvedAmount: null,
    decisionNote: null,
    decidedBy: null,
    decidedAt: null,
    reason: null,
    version: 1,
    createdAt: T0,
    createdBy: OTHER_USER,
    updatedAt: T0,
    ...over,
  };
}

export function totals(): BenefitTotals {
  const line = (
    valueClass: BenefitTotals["currencies"][number]["lines"][number]["valueClass"],
    state: BenefitTotals["currencies"][number]["lines"][number]["state"],
    amount: string,
    count: number,
  ) => ({
    valueClass,
    state,
    total: known(amount),
    count,
  });
  return {
    scope: "transformation",
    scopeId: TR_ID,
    allocated: false,
    transformationIds: [TR_ID],
    currencies: [
      {
        currency: "SAR",
        lines: [
          line("revenue_uplift", "planned", "10000000.0000", 1),
          line("revenue_uplift", "submitted", "250000.0000", 1),
          line("revenue_uplift", "validated", "0.0000", 0),
          line("cash_saving", "planned", "500000.0000", 1),
          line("avoided_cost", "planned", "200000.0000", 1),
        ],
        pendingOverlap: [line("margin_uplift", "validated", "75000.0000", 1)],
        gross: { planned: known("10700000.0000"), validated: known("0.0000") },
        implementationCost: {
          cash: known("1000000.0000"),
          nonCash: { status: "unknown", amount: null, currency: null, reason: "benefit.cost_amount_missing" },
          total: { status: "unknown", amount: null, currency: null, reason: "benefit.cost_amount_missing" },
        },
        net: {
          planned: { status: "unknown", amount: null, currency: null, reason: "benefit.cost_amount_missing" },
          validated: { status: "unknown", amount: null, currency: null, reason: "benefit.cost_amount_missing" },
        },
      },
    ],
    nonFinancialCount: 1,
    excluded: [{ benefitId: CX_BENEFIT_ID, code: "B02", reason: "group_counted_member_not_named" }],
    computedAt: T0,
  };
}

export function scenario(): BenefitScenario {
  return {
    id: "01920000-0000-7000-9000-00000000a501",
    transformationId: TR_ID,
    businessCaseId: null,
    kind: "upside",
    title: "Synthetic upside",
    assumptions: null,
    values: [
      {
        id: "01920000-0000-7000-9000-00000000a502",
        scenarioId: "01920000-0000-7000-9000-00000000a501",
        scenarioKind: "upside",
        benefitId: BENEFIT_ID,
        periodStart: "2027-01-01",
        periodEnd: "2027-12-31",
        amount: "7777777.0000",
        kpiValue: null,
        currency: "SAR",
        note: null,
        version: 1,
        createdAt: T0,
        createdBy: USER_ID,
        updatedAt: T0,
      },
    ],
    status: "active",
    archivedAt: null,
    archivedBy: null,
    archiveReason: null,
    version: 1,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
  };
}
