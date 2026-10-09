// SYNTHETIC fixtures of the KPI engine screens (T-DG4-FE-B). No real KPI, person, organization or approval.
import { ORG_ID, TR_ID, USER_ID } from "../../test/fixtures.tsx";
import type {
  DataQualityFinding,
  KpiActual,
  KpiActualSubmission,
  KpiDictionaryEntry,
  KpiStatus,
  KpiVersion,
  ReportingPeriod,
} from "./api.ts";

export const KPI_ID = "01920000-0000-7000-9000-00000000a001";
export const VERSION_ID = "01920000-0000-7000-9000-00000000a002";
export const PERIOD_ID = "01920000-0000-7000-9000-00000000a003";
export const ACTUAL_ID = "01920000-0000-7000-9000-00000000a004";
export const OTHER_ID = "01920000-0000-7000-9000-00000000a005";
const T0 = "2026-10-01T09:00:00Z";

export function kpiVersion(over: Partial<KpiVersion> = {}): KpiVersion {
  return {
    id: VERSION_ID,
    transformationId: TR_ID,
    kpiDefinitionId: KPI_ID,
    versionNo: 1,
    status: "active",
    measureType: "higher_is_better",
    valueNature: "flow",
    entryScopeKind: "transformation",
    unitKind: "percentage",
    unitLabel: null,
    currency: null,
    frequency: "monthly",
    numeratorLabel: null,
    denominatorLabel: null,
    calculationMethod: "entered",
    calculationDescription: null,
    formulaExpression: null,
    formulaEngineVersion: null,
    formulaInputs: [],
    aggregationRule: "last_value",
    stockAdditiveAcrossScopes: false,
    ytdStartMonth: 1,
    baselineId: null,
    baselineValue: null,
    baselineDate: null,
    targetValue: "0.25",
    targetDate: "2027-06-30",
    bandLower: null,
    bandUpper: null,
    milestoneDueDate: null,
    dataQuality: { staleAfterDays: 45, validMin: null, validMax: null, evidenceRequired: false },
    submissionRoute: "review",
    reviewerPartyCode: "BO",
    definitionApproval: "direct",
    approvalId: null,
    changeReason: null,
    activatedAt: T0,
    activatedBy: USER_ID,
    supersededAt: null,
    withdrawnAt: null,
    withdrawnBy: null,
    withdrawReason: null,
    version: 2,
    createdAt: T0,
    createdBy: USER_ID,
    updatedAt: T0,
    ...over,
  };
}

export function dictionaryEntry(over: Partial<KpiDictionaryEntry> = {}): KpiDictionaryEntry {
  return {
    definition: {
      id: KPI_ID,
      organizationId: ORG_ID,
      transformationId: TR_ID,
      name: "Synthetic digital adoption rate",
      description: null,
      businessPurpose: null,
      unitKind: "percentage",
      unitLabel: null,
      currency: null,
      polarity: "higher_is_better",
      frequency: "monthly",
      isLeading: true,
      dataSource: null,
      ownerUserId: USER_ID,
      stewardUserId: null,
      status: "active",
      archivedAt: null,
      archivedBy: null,
      archiveReason: null,
      version: 3,
      createdAt: T0,
      createdBy: USER_ID,
      updatedAt: T0,
      updatedBy: USER_ID,
    } as KpiDictionaryEntry["definition"],
    activeVersion: kpiVersion(),
    draftVersionId: null,
    missingForUse: [],
    ...over,
  };
}

export function kpiStatus(over: Partial<KpiStatus> = {}): KpiStatus {
  return {
    kpiDefinitionId: KPI_ID,
    kpiName: "Synthetic digital adoption rate",
    kpiVersionId: VERSION_ID,
    unitKind: "percentage",
    currency: null,
    scopeKind: "transformation",
    scopeId: TR_ID,
    reportingPeriodId: PERIOD_ID,
    periodLabel: "2026-10",
    actual: "0.12",
    actualStatus: "ok",
    actualReason: null,
    expectedToDate: "0.1",
    expectedReason: null,
    finalTarget: "0.25",
    finalTargetDate: "2027-06-30",
    variance: "0.02",
    varianceRatio: "0.2",
    changeLabel: "pp",
    trend: "improving",
    freshness: { status: "fresh", dataAsOf: "2026-10-31", staleAfterDays: 45 },
    explanation: {
      key: "kpi.rag.on_or_better_than_trajectory",
      params: {},
      thresholdSource: "configured",
      thresholdVersion: 3,
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.1",
      trajectoryVersion: 2,
    },
    calculatedRag: "green",
    displayedRag: "green",
    override: null,
    evaluationId: "01920000-0000-7000-9000-00000000a0e1",
    calculationRunId: "01920000-0000-7000-9000-00000000a0e2",
    ...over,
  };
}

/** No actual for the current period: Unknown everywhere, never 0, never green. */
export function unknownStatus(): KpiStatus {
  return kpiStatus({
    actual: null,
    actualStatus: "unknown",
    actualReason: "kpi.no_accepted_actual",
    expectedToDate: null,
    expectedReason: "kpi.no_approved_trajectory",
    variance: null,
    varianceRatio: null,
    trend: "unknown",
    freshness: { status: "unknown", dataAsOf: null, staleAfterDays: 45 },
    explanation: {
      key: "kpi.rag.no_actual",
      params: { reason: "kpi.no_accepted_actual" },
      thresholdSource: "default",
      thresholdVersion: null,
      toleranceMode: "relative",
      amberThreshold: "0.05",
      redThreshold: "0.1",
      trajectoryVersion: null,
    },
    calculatedRag: "unknown",
    displayedRag: "unknown",
    evaluationId: null,
    calculationRunId: null,
  });
}

export function period(over: Partial<ReportingPeriod> = {}): ReportingPeriod {
  return {
    id: PERIOD_ID,
    organizationId: ORG_ID,
    frequency: "monthly",
    periodLabel: "2026-10",
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    lengthDays: 31,
    basis: "calendar",
    weekCount: null,
    updateDueDate: null,
    status: "open",
    openedAt: T0,
    closedAt: null,
    version: 2,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

export function actual(over: Partial<KpiActual> = {}): KpiActual {
  return {
    id: ACTUAL_ID,
    transformationId: TR_ID,
    kpiDefinitionId: KPI_ID,
    scopeKind: "transformation",
    scopeId: TR_ID,
    reportingPeriodId: PERIOD_ID,
    periodStart: "2026-10-01",
    periodEnd: "2026-10-31",
    periodLabel: "2026-10",
    currentValueNo: 1,
    acceptedValueNo: null,
    status: "submitted",
    route: "review",
    submittedBy: OTHER_ID,
    submittedAt: T0,
    decidedBy: null,
    decidedAt: null,
    decisionReason: null,
    values: [
      {
        valueNo: 1,
        kpiVersionId: VERSION_ID,
        value: "0.12",
        numerator: null,
        denominator: null,
        milestoneAchieved: null,
        achievedOn: null,
        currency: null,
        missingReason: null,
        dataAsOf: "2026-10-31",
        comment: null,
        evidenceIds: [],
        enteredAt: T0,
        enteredBy: OTHER_ID,
        businessDate: "2026-10-31",
      },
    ],
    reviews: [],
    version: 2,
    createdAt: T0,
    createdBy: OTHER_ID,
    updatedAt: T0,
    ...over,
  };
}

export function submission(over: Partial<KpiActualSubmission> = {}): KpiActualSubmission {
  return {
    actual: actual({ submittedBy: USER_ID }),
    reviewPending: true,
    downstream: [
      { kind: "kpi_panel", id: KPI_ID, labelKey: "kpi.downstream.kpi_panel" },
      { kind: "executive_overview_outcomes", id: null, labelKey: "kpi.downstream.executive_overview_outcomes" },
      { kind: "benefit", id: OTHER_ID, labelKey: "kpi.downstream.benefit" },
    ],
    financeReview: "pending",
    ...over,
  };
}

export function finding(over: Partial<DataQualityFinding> = {}): DataQualityFinding {
  return {
    id: "01920000-0000-7000-9000-00000000a0f1",
    transformationId: TR_ID,
    kpiDefinitionId: KPI_ID,
    scopeKind: "transformation",
    scopeId: TR_ID,
    reportingPeriodId: PERIOD_ID,
    kpiActualId: null,
    valueNo: null,
    ruleCode: "missing_actual",
    severity: "warning",
    detailParams: {},
    detectedByRunId: "01920000-0000-7000-9000-00000000a0e2",
    detectedAt: T0,
    status: "open",
    resolutionNote: null,
    resolvedBy: null,
    resolvedAt: null,
    version: 1,
    updatedAt: T0,
    ...over,
  };
}
