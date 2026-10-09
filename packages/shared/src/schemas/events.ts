// Outbox event payload schemas (ADR-0008), keyed by (event_type, schema_version). NOT part of the HTTP contract
// (docs/api/openapi.yaml): these are the internal API -> worker messages. The API validates a payload before inserting
// the outbox row, and the worker validates it again on receipt. Payloads never carry secrets, tokens or evidence bytes.
import { z } from "zod";
import { phase, standaloneDeliverableType, timestamp, transformationMode, uuid } from "./common.ts";
// P4 slice A (T-DG4-KBE-B; ADR-0027 §8 step 5): the three KPI change events; payloads defined with their mirrors.
import { kpiThresholdChangedV1, kpiTrajectoryApprovedV1, kpiVersionActivatedV1 } from "./kpi-versions.ts";
import { kpiActualAcceptedV1, kpiDeviationEvaluatedV1, kpiValuesRecalculatedV1 } from "./kpi-actuals.ts";
// P4 slice B (T-DG4-KBE-E; ADR-0030 §3, §4, §6): the measurement submission, Finance decision and variance events.
import { benefitEvidenceSubmittedV1, benefitValueDecidedV1, benefitVarianceEvaluatedV1 } from "./benefit-values.ts";

export const transformationCreatedV1 = z.strictObject({
  transformationId: uuid,
  organizationId: uuid,
  businessUnitId: uuid,
  mode: transformationMode,
  entryPhase: phase.nullable(),
  standaloneDeliverableType: standaloneDeliverableType.nullable(),
  createdBy: uuid,
  occurredAt: timestamp,
});
export type TransformationCreatedV1 = z.infer<typeof transformationCreatedV1>;

/**
 * P4 (ADR-0025 §3; T-DG4-BE-A): a job schedule was enabled, disabled or rescheduled through updateJobSchedule. The
 * worker re-registers every enabled schedule with pg-boss and unschedules every disabled one (apps/worker/src/schedules.ts).
 */
export const jobScheduleUpdatedV1 = z.strictObject({
  jobScheduleId: uuid,
  code: z.string().min(1).max(64),
  queueName: z.string().min(1).max(100),
  cron: z.string().min(1).max(100),
  timezone: z.string().min(1).max(64),
  enabled: z.boolean(),
  version: z.number().int().min(1),
  updatedBy: uuid,
  occurredAt: timestamp,
});
export type JobScheduleUpdatedV1 = z.infer<typeof jobScheduleUpdatedV1>;

export const OUTBOX_EVENT_SCHEMAS = {
  "transformation.created": { 1: transformationCreatedV1 },
  "job_schedule.updated": { 1: jobScheduleUpdatedV1 },
  "kpi.threshold_changed": { 1: kpiThresholdChangedV1 },
  "kpi.trajectory_approved": { 1: kpiTrajectoryApprovedV1 },
  "kpi.version_activated": { 1: kpiVersionActivatedV1 },
  // T-DG4-KBE-C (ADR-0027 §8): the accept pipeline.
  "kpi.actual_accepted": { 1: kpiActualAcceptedV1 },
  "kpi.values_recalculated": { 1: kpiValuesRecalculatedV1 },
  "kpi.deviation_evaluated": { 1: kpiDeviationEvaluatedV1 },
  // T-DG4-KBE-E (ADR-0030 §3, §4, §6): consumers benefits.finance_queue (evidence_submitted) and slice E (variance).
  "benefit.evidence_submitted": { 1: benefitEvidenceSubmittedV1 },
  "benefit.value_validated": { 1: benefitValueDecidedV1 },
  "benefit.value_rejected": { 1: benefitValueDecidedV1 },
  "benefit.variance_evaluated": { 1: benefitVarianceEvaluatedV1 },
} as const;
export type OutboxEventType = keyof typeof OUTBOX_EVENT_SCHEMAS;

/** The message the relay puts on the queue: the outbox row's identity plus its validated payload. */
export const outboxEnvelope = z.strictObject({
  outboxEventId: uuid,
  eventType: z.string(),
  schemaVersion: z.number().int().min(1),
  idempotencyKey: z.string().min(1).max(200),
  organizationId: uuid,
  payload: z.record(z.string(), z.unknown()),
});
export type OutboxEnvelope = z.infer<typeof outboxEnvelope>;

export function outboxPayloadSchema(eventType: string, schemaVersion: number): z.ZodType | null {
  const versions = (OUTBOX_EVENT_SCHEMAS as Record<string, Record<number, z.ZodType>>)[eventType];
  return versions?.[schemaVersion] ?? null;
}
