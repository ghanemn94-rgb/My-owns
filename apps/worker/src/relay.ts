// Transactional outbox relay (ADR-0008 §2). One transaction per event:
//   SELECT the oldest unpublished row FOR UPDATE SKIP LOCKED  ->  pg-boss send IN THE SAME TRANSACTION (job id = the
//   outbox event id, singletonKey = its idempotency key)  ->  mark published_at.
// Because enqueue and mark commit together, a crash can never publish without marking or mark without publishing.
// The deterministic job id (INSERT ... ON CONFLICT DO NOTHING in pg-boss) makes even a replayed send a no-op, and the
// consumer ledger (processed_message) makes a redelivery a no-op. SKIP LOCKED lets several relays run safely.
//
// Fan-out (D-102): an event type may have several consumer queues (QUEUES_FOR_EVENT). The relay sends one job to EVERY
// listed queue inside the event's one transaction, so either all jobs and the mark commit or none does. An event with
// ONE queue keeps job id = the outbox event id (unchanged); with several, each job id is a deterministic UUID derived
// from (event id, queue) (fanOutJobId), so the jobs are distinct and a replayed send of any of them is a no-op.
import { createHash } from "node:crypto";
import { CompiledQuery } from "kysely";
import { sql, type Db, type Tx } from "@mth/db";
import { outboxPayloadSchema, truncateText, type OutboxEnvelope } from "@mth/shared/schemas";
import type PgBoss from "pg-boss";
import { OUTBOX_RELAY, QUEUES_FOR_EVENT } from "./queues/index.ts";

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

/**
 * The job id of an event's job on `queue` when the event fans out to several queues: a name-based UUID (RFC 9562 version
 * 8 layout) over SHA-256("<outboxEventId>\n<queue>"). Deterministic, so a retried relay sends the same ids; distinct per
 * queue; never equal to the event id itself.
 */
export function fanOutJobId(outboxEventId: string, queue: string): string {
  const h = createHash("sha256").update(`${outboxEventId}\n${queue}`, "utf8").digest();
  h[6] = (h[6]! & 0x0f) | 0x80; // version 8
  h[8] = (h[8]! & 0x3f) | 0x80; // RFC 9562 variant
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

/** The (queue, job id) pairs of one event: job id = the event id for a single queue (pre-D-102), else fanOutJobId. */
export function jobsForEvent(outboxEventId: string, queues: readonly string[]): { queue: string; id: string }[] {
  if (queues.length === 1) return [{ queue: queues[0]!, id: outboxEventId }];
  return queues.map((queue) => ({ queue, id: fanOutJobId(outboxEventId, queue) }));
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
      const queues = QUEUES_FOR_EVENT[row.event_type];
      if (!queues || queues.length === 0) throw new Error(`no queue for event type ${row.event_type}`);
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
      // Every job in the same transaction: all of them and the mark commit together, or none does.
      for (const job of jobsForEvent(row.id, queues))
        await boss.send(job.queue, envelope, { id: job.id, singletonKey: row.idempotency_key, db: txExecutor(tx) });
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
