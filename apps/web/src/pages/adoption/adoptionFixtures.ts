// SYNTHETIC fixtures of the slice F and G screens (T-DG4-FE-E). No real person, organization, decision or approval.
import type {
  AdoptionIndicatorTemplate,
  AdoptionIntervention,
  AdoptionPlan,
  AssessmentForm,
  BauHandover,
  ChampionConstraint,
  ControlCheck,
  ImprovementItem,
  LessonSearchHit,
  PerformanceArea,
  StakeholderGroup,
  SustainmentReview,
} from "@mth/shared/schemas";
import { TR_ID, USER_ID } from "../../test/fixtures.tsx";
import { OTHER_USER, T0 } from "../my-work/p4fixtures.ts";

export const GROUP_ID = "01920000-0000-7000-b000-000000000001";
export const DECISION_ID = "01920000-0000-7000-b000-000000000002";
export const AREA_ID = "01920000-0000-7000-b000-000000000003";
export const HANDOVER_ID = "01920000-0000-7000-b000-000000000004";
export const FORM_ID = "01920000-0000-7000-b000-000000000005";
export const PRIOR_HANDOVER_ID = "01920000-0000-7000-b000-000000000006";
export const CASE_ID = "01920000-0000-7000-b000-000000000007";

const stamps = { version: 1, createdAt: T0, createdBy: USER_ID, updatedAt: T0, updatedBy: USER_ID };

export function plan(): AdoptionPlan {
  return {
    transformationId: TR_ID,
    rows: [
      {
        stakeholderGroupId: GROUP_ID,
        code: "SG-01",
        stakeholder: "Synthetic store supervisors",
        impact: "H",
        influence: "L",
        currentStance: "resist",
        requiredBehavior: "Use the new synthetic queue screen for every walk-in",
        intervention: ["comms", "training"],
        ownerUserId: USER_ID,
        adoptionKpiDefinitionId: null,
        adoptionKpiName: null,
        championCount: 1,
        openInterventionCount: 2,
        openChampionConstraintCount: 1,
      },
    ],
  };
}

export function group(over: Partial<StakeholderGroup> = {}): StakeholderGroup {
  return {
    id: GROUP_ID,
    transformationId: TR_ID,
    code: "SG-01",
    name: "Synthetic store supervisors",
    description: null,
    influence: "L",
    impact: "H",
    currentStance: "resist",
    requiredBehavior: "Use the new synthetic queue screen for every walk-in",
    interventionTypes: ["comms", "training"],
    interventionPlan: null,
    ownerUserId: USER_ID,
    adoptionKpiDefinitionId: null,
    headcount: 40,
    championCount: 1,
    openInterventionCount: 2,
    status: "active",
    archivedAt: null,
    archiveReason: null,
    ...stamps,
    ...over,
  };
}

export function intervention(over: Partial<AdoptionIntervention> = {}): AdoptionIntervention {
  return {
    id: "01920000-0000-7000-b000-000000000101",
    transformationId: TR_ID,
    code: "AI-01",
    stakeholderGroupId: GROUP_ID,
    interventionType: "corrective",
    title: "Synthetic queue usage KPI",
    description: null,
    ownerUserId: null,
    ownerStatus: "unassigned",
    dueDate: null,
    dueUnknownReason: "calendar_not_configured",
    status: "planned",
    origin: "below_trajectory",
    metricLinkId: null,
    kpiEvaluationId: null,
    reportingPeriodId: null,
    scopeKind: "transformation",
    scopeId: TR_ID,
    outcomeNote: null,
    completedAt: null,
    completedBy: null,
    createdSource: "worker",
    ...stamps,
    createdBy: null,
    ...over,
  };
}

const SOURCE = [
  [1, 1, "Usage / activation rate", "usage_activation_rate", "Usage / activation rate", "percentage", "kpi_actuals"],
  [
    2,
    1,
    "Compliance with new process",
    "process_compliance_rate",
    "Process compliance rate",
    "percentage",
    "kpi_actuals",
  ],
  [3, 1, "Cycle-time shift", "cycle_time_shift", "Cycle-time shift", "duration", "kpi_actuals"],
  [
    4,
    1,
    "Training completion + observed proficiency",
    "training_completion",
    "Training completion",
    "percentage",
    "training_records",
  ],
  [
    4,
    2,
    "Training completion + observed proficiency",
    "observed_proficiency",
    "Observed proficiency",
    "percentage",
    "assessment_records",
  ],
  [5, 1, "Decision turnaround time", "decision_turnaround_time", "Decision turnaround time", "duration", "kpi_actuals"],
  [
    6,
    1,
    "Percentage of transactions handled through the new journey",
    "new_journey_share",
    "New-journey share",
    "percentage",
    "kpi_actuals",
  ],
  [
    7,
    1,
    "Exception / workaround rate",
    "exception_workaround_rate",
    "Exception / workaround rate",
    "percentage",
    "kpi_actuals",
  ],
] as const;

export const SEVEN_INDICATORS = [...new Set(SOURCE.map((s) => s[2]))];

export function templates(): AdoptionIndicatorTemplate[] {
  return SOURCE.map(([io, mo, src, key, measure, unit, source]) => ({
    key,
    indicatorKey: key,
    indicatorOrdinal: io,
    measureOrdinal: mo,
    sourceIndicatorEn: src,
    indicatorAr: `مؤشر ${io}`,
    measureEn: measure,
    measureAr: `مقياس ${io}.${mo}`,
    arProvisional: true,
    unitKind: unit,
    polarity: "higher_is_better",
    valueNature: "ratio",
    aggregationRule: "weighted_ratio",
    valueSource: source,
    sourceRef: `B01${String(8 + io).padStart(2, "0")}`,
  }));
}

/** 100 % training completion and no proficiency observation (REQ-PB-072 A11). */
export function groupReport() {
  return {
    targetKind: "stakeholder_group",
    targetId: GROUP_ID,
    reportingPeriodId: "01920000-0000-7000-b000-000000000201",
    measures: [
      {
        templateKey: "training_completion",
        metricLinkId: null,
        kpiDefinitionId: null,
        value: "1",
        valueStatus: "ok",
        valueReason: null,
        calculatedRag: null,
        trajectoryValue: null,
        numerator: 12,
        denominator: 12,
      },
      {
        templateKey: "observed_proficiency",
        metricLinkId: null,
        kpiDefinitionId: null,
        value: null,
        valueStatus: "unknown",
        valueReason: "adoption.no_proficiency_observations",
        calculatedRag: null,
        trajectoryValue: null,
        numerator: null,
        denominator: null,
      },
    ],
  };
}

export function constraint(over: Partial<ChampionConstraint> = {}): ChampionConstraint {
  return {
    id: "01920000-0000-7000-b000-000000000301",
    transformationId: TR_ID,
    championId: "01920000-0000-7000-b000-000000000302",
    stakeholderGroupId: GROUP_ID,
    decisionId: DECISION_ID,
    decisionCode: "D-0001",
    constraintText: "Synthetic: the supervisors need offline mode for the queue screen",
    status: "open",
    responseText: null,
    resolvedAt: null,
    resolvedBy: null,
    ...stamps,
    createdBy: OTHER_USER,
    ...over,
  };
}

export function form(over: Partial<AssessmentForm> = {}): AssessmentForm {
  return {
    id: FORM_ID,
    transformationId: TR_ID,
    kind: "proficiency_assessment",
    name: "Synthetic queue screen observation",
    description: null,
    stakeholderGroupId: GROUP_ID,
    status: "published",
    currentVersion: {
      versionNo: 1,
      schema: {
        questions: [
          {
            key: "uses_queue",
            type: "yes_no",
            label_en: "Uses the queue screen unaided",
            label_ar: "يستخدم شاشة الطابور دون مساعدة",
            required: true,
            proficiency: true,
          },
        ],
      },
      createdAt: T0,
      createdBy: USER_ID,
    },
    publishedVersionNo: 1,
    publishedAt: T0,
    publishedBy: USER_ID,
    retiredAt: null,
    retiredBy: null,
    ...stamps,
    version: 3,
    ...over,
  };
}

export function area(over: Partial<PerformanceArea> = {}): PerformanceArea {
  return {
    id: AREA_ID,
    transformationId: TR_ID,
    code: "PA-01",
    name: "Synthetic walk-in service",
    description: null,
    businessUnitId: null,
    sponsorUserId: null,
    reviewFrequency: "monthly",
    reviewInterval: 1,
    bauOwnerUserId: null,
    kpiOwnerUserId: null,
    nextReviewDate: null,
    cycleNo: 2,
    status: "reopened",
    currentHandoverId: PRIOR_HANDOVER_ID,
    cycles: [
      {
        cycleNo: 1,
        openedAt: "2026-01-05T08:00:00Z",
        openedBy: USER_ID,
        reopenReason: null,
        priorHandoverId: null,
        priorHandoverAcceptedAt: null,
        priorHandoverAcceptedBy: null,
        priorClosureRecordId: null,
        priorClosedAt: null,
      },
      {
        cycleNo: 2,
        openedAt: "2026-09-20T08:00:00Z",
        openedBy: USER_ID,
        reopenReason: "Synthetic: walk-in waits deteriorated",
        priorHandoverId: PRIOR_HANDOVER_ID,
        priorHandoverAcceptedAt: "2026-03-10T09:30:00Z",
        priorHandoverAcceptedBy: OTHER_USER,
        priorClosureRecordId: "01920000-0000-7000-b000-000000000401",
        priorClosedAt: "2026-06-30T12:00:00Z",
      },
    ],
    retiredAt: null,
    retireReason: null,
    ...stamps,
    ...over,
  };
}

export function handover(over: Partial<BauHandover> = {}): BauHandover {
  return {
    id: HANDOVER_ID,
    transformationId: TR_ID,
    performanceAreaId: AREA_ID,
    cycleNo: 2,
    code: "HO-02",
    receivingOwnerUserId: OTHER_USER,
    kpiOwnerUserId: USER_ID,
    operatingProcedures: "Synthetic SOP v2",
    capabilityReadiness: "Synthetic: supervisors trained",
    unresolvedAcceptedRisks: "Synthetic: none material",
    benefitMonitoringCadence: "monthly",
    dataAccess: null,
    improvementBacklogSummary: "Synthetic: two open items",
    controlIds: ["01920000-0000-7000-b000-000000000501"],
    evidenceIds: ["01920000-0000-7000-b000-000000000502"],
    openImprovementItemIds: [],
    missingItems: ["data_access"],
    status: "draft",
    submittedAt: null,
    submittedBy: null,
    acceptedAt: null,
    acceptedBy: null,
    acceptanceNote: null,
    returnedAt: null,
    returnedBy: null,
    returnReason: null,
    ...stamps,
    version: 4,
    ...over,
  };
}

export function check(over: Partial<ControlCheck> = {}): ControlCheck {
  return {
    id: "01920000-0000-7000-b000-000000000601",
    transformationId: TR_ID,
    controlId: "01920000-0000-7000-b000-000000000501",
    performanceAreaId: AREA_ID,
    dueDate: "2026-10-05",
    assigneeUserId: USER_ID,
    status: "failed",
    performedAt: T0,
    performedBy: USER_ID,
    resultNote: "Synthetic: queue log not reconciled",
    correctiveCaseId: CASE_ID,
    createdSource: "worker",
    ...stamps,
    ...over,
  };
}

export function review(over: Partial<SustainmentReview> = {}): SustainmentReview {
  return {
    id: "01920000-0000-7000-b000-000000000701",
    transformationId: TR_ID,
    subjectKind: "performance_area",
    performanceAreaId: AREA_ID,
    cycleNo: 1,
    transitionDecisionId: null,
    dueDate: "2026-11-01",
    assigneeUserId: USER_ID,
    status: "done",
    completedAt: T0,
    completedBy: USER_ID,
    outcomeNote: "Synthetic: no data for September",
    performanceSignal: "unknown",
    createdSource: "worker",
    ...stamps,
    ...over,
  };
}

export function ciItem(over: Partial<ImprovementItem> = {}): ImprovementItem {
  return {
    id: "01920000-0000-7000-b000-000000000801",
    transformationId: TR_ID,
    code: "CI-01",
    performanceAreaId: AREA_ID,
    title: "Synthetic: shorten the walk-in triage",
    description: null,
    ownerUserId: USER_ID,
    priority: "H",
    targetDate: "2026-12-15",
    sourceKind: "manual",
    sourceId: null,
    status: "open",
    resolutionNote: null,
    resolvedAt: null,
    resolvedBy: null,
    ...stamps,
    ...over,
  };
}

export function searchHit(): LessonSearchHit {
  return {
    lesson: {
      id: "01920000-0000-7000-b000-000000000901",
      transformationId: "01920000-0000-7000-9000-000000000399",
      code: "LL-01",
      performanceAreaId: null,
      title: "Synthetic: pilot the queue screen with champions first",
      context: null,
      lessonText: "Synthetic: champions cut the resistance in half",
      recommendation: null,
      tags: ["adoption"],
      status: "published",
      publishedAt: T0,
      publishedBy: OTHER_USER,
      archivedAt: null,
      archivedBy: null,
      ...stamps,
    },
    transformationCode: "TR-0002",
    transformationName: "Synthetic other transformation",
  };
}
