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
// P4 slice F (T-DG4-BE-H; ADR-0033 §4 step 6): the ADR-0031 §5.4 check-failed payload.
import { checkFailedPayload } from "./corrective.ts";
// P4 slice D (T-DG4-BE-G; ADR-0032 §8.3): a blocker RAG observed in one meeting cycle.
import { blockerStatusRecordedV1 } from "./executive-decisions.ts";
import { jobRunRequestedV1 } from "./job-operations.ts";
// P5 slice G (T-DG5-KBE-E2; ADR-0047 §3, §7): an approved KPI restatement, consumed once by kpi.recalculate.
import { kpiRestatementApprovedV1 } from "./kpi-restatement.ts";
// P5 slice I (T-DG5-BE-R; ADR-0049 §12): a new branding version is current.
import { brandingPublishedV1 } from "./branding.ts";

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
 * T-DG5-BE-J (ADR-0044 §2; p5-plan §3 row 15): v2 adds the optional 90-day plan choice made at creation
 * (`launchPlan: {startDate} | null`). The v1 consumer is kept for events already in flight.
 */
export const transformationCreatedV2 = transformationCreatedV1.extend({
  launchPlan: z.strictObject({ startDate: z.iso.date() }).nullable(),
});
export type TransformationCreatedV2 = z.infer<typeof transformationCreatedV2>;

/**
 * T-DG5-BE-J (ADR-0044 §7, §8; REQ-S12-012): a critical dependency slipped (one per dependency_slip row); consumer
 * portfolio.dependency_slip (starter 9) notifies each affected owner once. The producer (apps/api portfolio/
 * slip-events.ts) and the consumer parse it with this schema. Registered in OUTBOX_EVENT_SCHEMAS (T-DG5-BE-T5,
 * D-167, D-QA-F2-1): the relay refuses an outbox row whose (event_type, schema_version) has no schema, so without the
 * registration starter 9 never ran. The automation dry run therefore validates a `dependency.slipped` sample strictly
 * against this complete v1 payload (ADR-0043, the BE-C3 reading), and the builder catalogue serves its samplePayload.
 */
export const dependencySlippedV1 = z.strictObject({
  slipId: uuid,
  dependencyId: uuid,
  transformationId: uuid,
  slipDays: z.number().int().min(1).max(3650),
});
export type DependencySlippedV1 = z.infer<typeof dependencySlippedV1>;

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

/**
 * P4 slice H (T-DG4-BE-K; ADR-0035 §7; REQ-S12-009): a gate submission was recorded. Consumer gates.submitted creates
 * one gate_decision_due task per required approver referencing the snapshot SHA-256, and cancels the open tasks of the
 * superseded submission. Key `gate.submitted:<submissionId>`. A product gate (business approval), never DG0-DG7.
 */
export const gateSubmittedV1 = z.strictObject({
  gateInstanceId: uuid,
  transformationId: uuid,
  gateCode: z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]),
  submissionId: uuid,
  submissionNo: z.number().int().min(1),
  snapshotSha256: z.string().regex(/^[0-9a-f]{64}$/),
  approverRoleCode: z.string().min(1).max(32),
  approverUserId: uuid.nullable(),
  submittedBy: uuid,
  supersededSubmissionId: uuid.nullable(),
});
export type GateSubmittedV1 = z.infer<typeof gateSubmittedV1>;

/**
 * P4 slice H (T-DG4-BE-K; ADR-0035 §7; REQ-S12-010): a person decided a gate submission. Consumer gates.decided closes
 * the decision tasks and, on approval, enables the next phase's steps (once) and, for G5, only the approved scope items
 * and conditions. Key `gate.decided:<gateDecisionId>`. The event reports a decision; it never makes one.
 */
export const gateDecidedV1 = z.strictObject({
  gateInstanceId: uuid,
  transformationId: uuid,
  gateCode: z.enum(["G1", "G2", "G3", "G4", "G5", "G6"]),
  submissionId: uuid,
  submissionNo: z.number().int().min(1),
  gateDecisionId: uuid,
  outcome: z.enum(["approved", "rejected", "changes_requested", "deferred"]),
  decidedBy: uuid,
  nextPhase: z.string().min(1).max(32).nullable(),
  scaleScopeItemIds: z.array(uuid),
  conditionIds: z.array(uuid),
});
export type GateDecidedV1 = z.infer<typeof gateDecidedV1>;

/**
 * P5 slice C (T-DG5-BE-F2; ADR-0042 §7): a procedure step became active (its due date in working days on the business
 * calendar, null = Unknown). Consumer: automation.evaluate (the slice E rule actions: step reminders and the escalation
 * path). Key `procedure_step.activated:<stepInstanceId>`. The event reports an activation; it never completes or
 * approves a step.
 */
export const procedureStepActivatedV1 = z.strictObject({
  instanceId: uuid,
  stepInstanceId: uuid,
  procedureCode: z.string().regex(/^[a-z][a-z0-9_]{2,47}$/),
  transformationId: uuid.nullable(),
  stepKey: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
  stepKind: z.enum(["task", "approval"]),
  dueDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  assigneeUserId: uuid.nullable(),
  assigneeRoleCode: z.string().min(1).max(32),
});
export type ProcedureStepActivatedV1 = z.infer<typeof procedureStepActivatedV1>;

/**
 * P5 slice D (T-DG5-BE-I; ADR-0043 §5, §7): a job failed on its last attempt and entered the failure queue (internal;
 * the starter-16 trigger, M0239). Written by the worker's failure capture when the job names an organization.
 */
export const jobFailedV1 = z.strictObject({
  queueName: z.string().min(1).max(100),
  jobScheduleCode: z.string().min(1).max(100).nullable(),
  failureId: uuid,
});
export type JobFailedV1 = z.infer<typeof jobFailedV1>;

/**
 * P5 slice D (T-DG5-BE-I; ADR-0043 §5): a person asked to retry a failure-queue entry. Written by the API in the
 * transaction that moves the entry to `retrying`, so the worker re-sends the work only after that COMMIT (no remote
 * I/O inside the transaction). `retryCount` is the entry's count after this retry: a stale message does nothing.
 */
export const automationFailureRetryRequestedV1 = z.strictObject({
  failureId: uuid,
  retryCount: z.number().int().min(1).max(20),
});
export type AutomationFailureRetryRequestedV1 = z.infer<typeof automationFailureRetryRequestedV1>;

/**
 * P5 slice F (T-DG5-BE-M; ADR-0046 §5): an export job was created (queued). Written by the API in the transaction that
 * inserts the job, so the worker renders only after that COMMIT (no remote I/O inside it); the relay sends it to
 * `reports.export` with the outbox event id as the job id (exactly once). Key `export_job.requested:<exportJobId>`.
 * An export approves nothing.
 */
export const exportJobRequestedV1 = z.strictObject({ exportJobId: uuid });
export type ExportJobRequestedV1 = z.infer<typeof exportJobRequestedV1>;

/**
 * P5 slice J (T-DG5-BE-S; ADR-0050 §6): an in-app demo reset was requested. Written by the API with its audit event in
 * one transaction; the relay sends it to `demo.reset` (singleton key = the idempotency key
 * `demo.reset_requested:<latest run id>`). The worker acknowledges it, then drops, re-creates and re-seeds the demo
 * database. Demo deployments only; a reset approves nothing.
 */
export const demoResetRequestedV1 = z.strictObject({ requestedBy: uuid, latestRunNo: z.number().int().min(0) });
export type DemoResetRequestedV1 = z.infer<typeof demoResetRequestedV1>;

/**
 * P6 slice B (T-DG6-BE-L2; ADR-0055 §2 step 4, §4; ADR-0053 §2, §3): a connector run failed for the LAST time (no
 * automatic retry left), or a connector succeeded again after a failure. `integrations` never imports `operations`
 * (apps/api/src/modules.ts), so the run reports through the outbox: the worker's `integrations.connector_exception`
 * consumer opens or recurs (failed) or resolves `recovered` (recovered) the connector's operational exception with the
 * BE-K kit twin under lock 730305; `connector.run_failed` is also the catalogue trigger of ADR-0053 §3 (BE-K2).
 * Key `connector.run_failed:<runId>` / `connector.run_recovered:<runId>`. `errorMessage` is the stored run message
 * (the ADR-0055 §4 "why" text and its parameters; never a source's response text or a secret).
 */
export const connectorRunFailedV1 = z.strictObject({
  connectorId: uuid,
  connectorCode: z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  runId: uuid,
  serviceIdentityId: uuid,
  failureClass: z.enum(["connector_run_failed", "connector_unreachable", "connector_credentials_rejected"]),
  errorCode: z
    .string()
    .regex(/^[a-z][a-z0-9_.]*$/)
    .max(100),
  errorMessage: z.string().min(1).max(2000),
});
export type ConnectorRunFailedV1 = z.infer<typeof connectorRunFailedV1>;
export const connectorRunRecoveredV1 = z.strictObject({
  connectorId: uuid,
  connectorCode: z.string().regex(/^[a-z][a-z0-9_-]{1,62}$/),
  runId: uuid,
});
export type ConnectorRunRecoveredV1 = z.infer<typeof connectorRunRecoveredV1>;

/**
 * P6 slice J (T-DG6-BE-K2; ADR-0053 §2, §3): a KPI's DG4 freshness became `stale` (ADR-0028 read-time rule, unchanged).
 * Written by the worker's kpi.freshness_scan once per stale episode, key `data.stale:<kpiId>:<dataAsOf>`; consumers
 * operations.exception_raise (starter 16 version 2: the `data_stale` operational exception, linked to the KPI) and
 * automation.evaluate (admin rules; condition field `kpiId`). `dataAsOf` is the business date of the last accepted
 * data; nothing here writes or clears a KPI value. Approves nothing.
 */
export const dataStaleV1 = z.strictObject({
  kpiId: uuid,
  transformationId: uuid,
  dataAsOf: z.iso.date(),
  staleAfterDays: z.number().int().min(1).max(3650),
});
export type DataStaleV1 = z.infer<typeof dataStaleV1>;

/**
 * T-DG6-BE-I2 (ADR-0054 §3 step 1; REQ-S12-023): one in-app notification was written, in its producing transaction
 * (apps/api tasks/service.ts createWorkItemOnce and its worker twin in apps/worker/src/kit.ts). Consumer
 * notifications.fanout (apps/worker queues/notifications.ts): it fans the notification out to the organization's
 * ENABLED external channels after commit; with no channel row it writes nothing (A21). Ids only: never a title, a
 * message text or an address.
 */
export const inboxNotificationCreatedV1 = z.strictObject({
  notificationId: uuid,
  recipientUserId: uuid,
});
export type InboxNotificationCreatedV1 = z.infer<typeof inboxNotificationCreatedV1>;

export const OUTBOX_EVENT_SCHEMAS = {
  "transformation.created": { 1: transformationCreatedV1, 2: transformationCreatedV2 },
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
  // T-DG4-BE-H (ADR-0033 §4 step 6; ADR-0031 §5.4): one per below-trajectory intervention; consumer raid.corrective_adoption.
  "adoption.check_failed": { 1: checkFailedPayload },
  // T-DG4-BE-G (ADR-0032 §8.3): one per blocker RAG observation; consumer governance.blocker_escalation.
  "blocker_status.recorded": { 1: blockerStatusRecordedV1 },
  // T-DG4-BE-I2 (ADR-0034 §6; ADR-0031 §5.4): one per failed control check; consumer raid.corrective_control.
  "control_check.failed": { 1: checkFailedPayload },
  // T-DG4-BE-K (ADR-0035 §7): the gate events (R1); consumers gates.submitted and gates.decided (apps/worker gates).
  "gate.submitted": { 1: gateSubmittedV1 },
  "gate.decided": { 1: gateDecidedV1 },
  // T-DG5-BE-F2 (ADR-0042 §7): consumer automation.evaluate (apps/worker/src/queues/automation.ts).
  "procedure_step.activated": { 1: procedureStepActivatedV1 },
  // T-DG5-BE-I (ADR-0043 §5, §7): the failure queue's two internal events; consumers automation.job_failed and
  // automation.failure_retry (apps/worker queues/automation.ts).
  "job.failed": { 1: jobFailedV1 },
  "automation_failure.retry_requested": { 1: automationFailureRetryRequestedV1 },
  // T-DG5-BE-I2 (ADR-0043 §6): "run now" of a scheduled job; consumer jobs.run_now (apps/worker queues/automation.ts).
  "job.run_requested": { 1: jobRunRequestedV1 },
  // T-DG5-BE-M (ADR-0046 §5): an export job to render; consumer reports.export (apps/worker queues/reports.ts).
  "export_job.requested": { 1: exportJobRequestedV1 },
  // T-DG5-BE-S (ADR-0050 §6): the in-app demo reset; consumer demo.reset (apps/worker queues/demo.ts).
  "demo.reset_requested": { 1: demoResetRequestedV1 },
  // T-DG5-KBE-E2 (ADR-0047 §3, §7): the restatement run and the reissue offers; consumer kpi.recalculate (queues/kpi.ts).
  "kpi_restatement.approved": { 1: kpiRestatementApprovedV1 },
  // T-DG5-BE-R (ADR-0049 §8, §12): a branding version was published; consumer platform.branding_published (worker).
  "branding.published": { 1: brandingPublishedV1 },
  // T-DG5-BE-J (ADR-0044 §7, §8), registered by T-DG5-BE-T5 (D-167): a critical dependency slipped; consumers
  // portfolio.dependency_slip (starter 9, REQ-S12-012) and automation.evaluate (apps/worker queues/portfolio.ts, automation.ts).
  "dependency.slipped": { 1: dependencySlippedV1 },
  // T-DG6-BE-L2 (ADR-0055 §2, ADR-0053 §2-§3): a connector run's last failure and its recovery; consumer
  // integrations.connector_exception (apps/worker queues/integrations.ts).
  "connector.run_failed": { 1: connectorRunFailedV1 },
  "connector.run_recovered": { 1: connectorRunRecoveredV1 },
  // T-DG6-BE-K2 (ADR-0053 §3): consumers operations.exception_raise and automation.evaluate (apps/worker queues).
  "data.stale": { 1: dataStaleV1 },
  // T-DG6-BE-I2 (ADR-0054 §3): consumer notifications.fanout (apps/worker queues/notifications.ts).
  "inbox_notification.created": { 1: inboxNotificationCreatedV1 },
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
