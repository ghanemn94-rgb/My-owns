// Transactional outbox relay (ADR-0008 §2). One transaction per event:
//   SELECT the oldest unpublished row FOR UPDATE SKIP LOCKED  ->  pg-boss send IN THE SAME TRANSACTION (job id = the
//   outbox event id, singletonKey = its idempotency key)  ->  mark published_at.
// Because enqueue and mark commit together, a crash can never publish without marking or mark without publishing.
// The deterministic job id (INSERT ... ON CONFLICT DO NOTHING in pg-boss) makes even a replayed send a no-op, and the
// consumer ledger (processed_message) makes a redelivery a no-op. SKIP LOCKED lets several relays run safely.
import { CompiledQuery } from "kysely";
import { sql, type Db, type Tx } from "@mth/db";
import { outboxPayloadSchema, truncateText, type OutboxEnvelope } from "@mth/shared/schemas";
import type PgBoss from "pg-boss";
import { OUTBOX_RELAY, QUEUE_FOR_EVENT } from "./queues.ts";

export interface RelayResult {
  readonly published: number;
  readonly failed: number;
}

/** pg-boss `db` adapter that runs its SQL on our open transaction. */
export function txExecutor(tx: Tx): { executeSql(text: string, values: unknown[]): Promise<{ rows: unknown[] }> } {
  return {
    async executeSql(text, values) {
      const r = await tx.executeQuery(CompiledQuery.raw(text, values));
      return { rows: r.rows as unknown[] };
    },
  };
}

async function publishNext(db: Db, boss: PgBoss): Promise<"published" | "empty" | { failedId: string; error: string }> {
  let current: { id: string } | null = null;
  try {
    return await db.transaction().execute(async (tx) => {
      const row = await tx
        .selectFrom("outbox_event")
        .select(["id", "organization_id", "event_type", "schema_version", "payload", "idempotency_key"])
        .where("published_at", "is", null)
        .where("publish_attempts", "<", OUTBOX_RELAY.maxPublishAttempts)
        .orderBy("seq")
        .limit(1)
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!row) return "empty" as const;
      current = row;
      const queue = QUEUE_FOR_EVENT[row.event_type];
      if (!queue) throw new Error(`no queue for event type ${row.event_type}`);
      const schema = outboxPayloadSchema(row.event_type, row.schema_version);
      if (!schema) throw new Error(`no schema for ${row.event_type} v${row.schema_version}`);
      schema.parse(row.payload);
      const envelope: OutboxEnvelope = {
        outboxEventId: row.id,
        eventType: row.event_type,
        schemaVersion: row.schema_version,
        idempotencyKey: row.idempotency_key,
        organizationId: row.organization_id,
        payload: row.payload as Record<string, unknown>,
      };
      await boss.send(queue, envelope, { id: row.id, singletonKey: row.idempotency_key, db: txExecutor(tx) });
      await tx
        .updateTable("outbox_event")
        .set({ published_at: sql<Date>`now()`, publish_attempts: sql<number>`publish_attempts + 1`, last_error: null })
        .where("id", "=", row.id)
        .execute();
      return "published" as const;
    });
  } catch (err) {
    const failed = current as { id: string } | null;
    if (!failed) throw err;
    return { failedId: failed.id, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Publish up to `batchSize` events. Failures are recorded on the row (attempts, last_error) and skipped. */
export async function relayOnce(
  db: Db,
  boss: PgBoss,
  batchSize: number = OUTBOX_RELAY.batchSize,
): Promise<RelayResult> {
  let published = 0;
  let failed = 0;
  for (let i = 0; i < batchSize; i++) {
    const r = await publishNext(db, boss);
    if (r === "empty") break;
    if (r === "published") {
      published += 1;
      continue;
    }
    failed += 1;
    await db
      .updateTable("outbox_event")
      .set({ publish_attempts: sql<number>`publish_attempts + 1`, last_error: truncateText(r.error, 2000) })
      .where("id", "=", r.failedId)
      .execute();
    // The same (oldest) row would be picked again at once: end this round; the next poll retries it until
    // maxPublishAttempts, after which it stays unpublished with last_error for an operator.
    break;
  }
  return { published, failed };
}
