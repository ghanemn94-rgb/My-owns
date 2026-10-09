// The transactional outbox writer (ADR-0008), moved here from jobs/index.ts unchanged (T-DG4-BE-A) so that
// jobs/schedules.ts can use it without importing the module's own public index.
import type { Tx } from "@mth/db";
import { outboxPayloadSchema } from "@mth/shared/schemas";
import { v7 as uuidv7 } from "uuid";

export interface OutboxEventInput {
  readonly organizationId: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly schemaVersion: number;
  readonly payload: Record<string, unknown>;
  /** Unique per logical event; consumers dedupe on it (processed_message). */
  readonly idempotencyKey: string;
}

export async function enqueueOutboxEvent(tx: Tx, event: OutboxEventInput): Promise<string> {
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
