// The builder catalogue's example payloads (`AutomationTrigger.samplePayload`; D-164 (d); T-DG5-BE-C4; ADR-0043 §4).
// For every event trigger whose outbox event has a payload schema (`outboxPayloadSchema(code, 1)`, the schema the dry
// run validates a sample against), one COMPLETE example payload of schema version 1, valid against that schema: every
// member the schema requires and no other. All ids are synthetic. `transformationId` is the fixed placeholder
// SAMPLE_TRANSFORMATION_ID, which the builder replaces with the selected transformation. Triggers without a payload
// schema (schedules, requests, and events whose schema a later slice adds) have no sample: the catalogue omits the
// member for them. Example data only: nothing here is a record, a decision or an approval (no G1-G6 business approval,
// no engineering gate DG0-DG7).
import { outboxPayloadSchema } from "@mth/shared/schemas";

/** The placeholder transformation id of every sample; replaced by the builder with the selected transformation. */
export const SAMPLE_TRANSFORMATION_ID = "00000000-0000-7000-8000-000000000000";

/** A synthetic UUIDv7-shaped id, distinct per `n`. */
const id = (n: number): string => `01920000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;
const T = SAMPLE_TRANSFORMATION_ID;
const AT = "2026-01-04T09:00:00+03:00";

const SAMPLES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  "transformation.created": {
    transformationId: T,
    organizationId: id(1),
    businessUnitId: id(2),
    mode: "end_to_end",
    entryPhase: null,
    standaloneDeliverableType: null,
    createdBy: id(3),
    occurredAt: AT,
  },
  "kpi.threshold_changed": {
    kpiRagThresholdId: id(10),
    kpiDefinitionId: id(11),
    transformationId: T,
    versionNo: 1,
    occurredAt: AT,
  },
  "kpi.trajectory_approved": {
    targetTrajectoryId: id(12),
    kpiDefinitionId: id(11),
    transformationId: T,
    scopeKind: "initiative",
    scopeId: id(13),
    versionNo: 1,
    occurredAt: AT,
  },
  "kpi.version_activated": {
    kpiVersionId: id(14),
    kpiDefinitionId: id(11),
    transformationId: T,
    versionNo: 2,
    supersededKpiVersionId: id(15),
    occurredAt: AT,
  },
  "kpi.actual_accepted": {
    kpiActualId: id(16),
    valueNo: 1,
    kpiDefinitionId: id(11),
    transformationId: T,
    scopeKind: "initiative",
    scopeId: id(13),
    reportingPeriodId: id(17),
  },
  "kpi.values_recalculated": {
    runId: id(18),
    transformationId: T,
    kpiDefinitionIds: [id(11)],
    reportingPeriodId: id(17),
  },
  "kpi.deviation_evaluated": {
    evaluationId: id(19),
    transformationId: T,
    kpiDefinitionId: id(11),
    scopeKind: "initiative",
    scopeId: id(13),
    reportingPeriodId: id(17),
    calculatedRag: "red",
    deviation: "adverse",
    previousCalculatedRag: "amber",
  },
  "benefit.evidence_submitted": {
    benefitId: id(20),
    measurementId: id(21),
    transformationId: T,
  },
  "benefit.variance_evaluated": {
    benefitId: id(20),
    measurementId: id(21),
    periodStart: "2026-01-01",
    periodEnd: "2026-03-31",
    plannedAmount: "1000000.00",
    measuredAmount: "850000.00",
    variance: "-150000.00",
    offTrack: true,
  },
  "adoption.check_failed": {
    checkId: id(22),
    checkRecordType: "adoption_intervention",
    transformationId: T,
    ownerUserId: id(23),
    subjectLabel: "Synthetic adoption intervention",
    failedAt: AT,
    businessDate: "2026-01-04",
  },
  "control_check.failed": {
    checkId: id(24),
    checkRecordType: "control_check",
    transformationId: T,
    ownerUserId: id(23),
    subjectLabel: "Synthetic sustainment control check",
    failedAt: AT,
    businessDate: "2026-01-04",
  },
  "blocker_status.recorded": {
    blockerStatusId: id(25),
    transformationId: T,
    forumId: id(26),
    meetingId: id(27),
    cycleDate: "2026-01-04",
    sourceRecordType: "raid_entry",
    sourceRecordId: id(28),
    rag: "red",
  },
  "gate.submitted": {
    gateInstanceId: id(30),
    transformationId: T,
    gateCode: "G3",
    submissionId: id(31),
    submissionNo: 1,
    snapshotSha256: "0".repeat(64),
    approverRoleCode: "BO",
    approverUserId: null,
    submittedBy: id(32),
    supersededSubmissionId: null,
  },
  "gate.decided": {
    gateInstanceId: id(30),
    transformationId: T,
    gateCode: "G3",
    submissionId: id(31),
    submissionNo: 1,
    gateDecisionId: id(33),
    outcome: "approved",
    decidedBy: id(34),
    nextPhase: "mobilize",
    scaleScopeItemIds: [],
    conditionIds: [],
  },
  "procedure_step.activated": {
    instanceId: id(40),
    stepInstanceId: id(41),
    procedureCode: "new_transformation_intake",
    transformationId: T,
    stepKey: "record_baseline",
    stepKind: "task",
    dueDate: "2026-01-08",
    assigneeUserId: null,
    assigneeRoleCode: "TL",
  },
  "job.failed": {
    queueName: "automation.evaluate",
    jobScheduleCode: null,
    failureId: id(50),
  },
};

/**
 * The example payload of an event trigger whose outbox event has a v1 payload schema (a fresh copy), or undefined
 * when the trigger has no payload schema. A sample that does not parse with its schema is never served.
 */
export function samplePayloadOf(code: string, triggerKind: string): Record<string, unknown> | undefined {
  if (triggerKind !== "event") return undefined;
  const schema = outboxPayloadSchema(code, 1);
  const sample = new Map(Object.entries(SAMPLES)).get(code);
  if (schema === null || sample === undefined) return undefined;
  const parsed = schema.safeParse(structuredClone(sample));
  return parsed.success ? (structuredClone(sample) as Record<string, unknown>) : undefined;
}

/** The event codes with a sample (for the coverage test). */
export const SAMPLE_EVENT_CODES: readonly string[] = Object.keys(SAMPLES);
