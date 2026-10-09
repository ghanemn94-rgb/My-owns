// The kpi module's transactional outbox writer (ADR-0008; T-DG4-KBE-B). The kpi module's declared dependencies
// (modules.ts) do not include `jobs`, so it cannot import jobs/outbox.ts; this writer does the same thing within the
// module boundary: it validates the payload against the shared registry (@mth/shared/schemas `outboxPayloadSchema`,
// which the worker's relay checks again) and inserts the outbox row in the caller's transaction, next to the record
// and its audit event. Used for kpi.version_activated, kpi.threshold_changed and kpi.trajectory_approved (ADR-0027 §8
// step 5); the idempotency key is `<event>:<recordId>:<versionNo>`. If the orchestrator adds `jobs` to kpi's
// dependsOn, the callers can switch to jobs' enqueueOutboxEvent unchanged (same input shape).
import type { Tx } from "@mth/db";
import { outboxPayloadSchema } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";

export interface KpiOutboxEvent {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: "kpi.version_activated" | "kpi.threshold_changed" | "kpi.trajectory_approved";
  readonly schemaVersion: 1;
  readonly payload: Record<string, unknown>;
  /** Unique per logical event; consumers dedupe on it (processed_message). */
  readonly idempotencyKey: string;
}

export async function enqueueKpiEvent(tx: Tx, event: KpiOutboxEvent): Promise<string> {
  const schema = outboxPayloadSchema(event.eventType, event.schemaVersion);
  if (!schema) throw new Error(`outbox: no schema for ${event.eventType} v${event.schemaVersion}`);
  const payload = schema.parse(event.payload) as Record<string, unknown>;
  const id = uuidv7();
  await tx
    .insertInto("outbox_event")
    .values({
      id,
      organization_id: event.organizationId,
      aggregate_type: event.aggregateType,
      aggregate_id: event.aggregateId,
      event_type: event.eventType,
      schema_version: event.schemaVersion,
      payload: JSON.stringify(payload),
      idempotency_key: event.idempotencyKey,
    })
    .execute();
  return id;
}
