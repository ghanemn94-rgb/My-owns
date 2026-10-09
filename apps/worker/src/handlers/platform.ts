// Platform job handlers (ADR-0008 §3, §7; moved from src/handlers.ts by T-DG4-BE-A, p4-work-split §I+C.1). Each handler inserts its (consumer, idempotency_key) ledger row in the
// SAME transaction as its effects; a redelivery conflicts on the primary key and becomes a no-op, so retries and
// restarts never duplicate reminders, actions or approvals. Handlers act as a constrained SERVICE principal on behalf
// of the initiating user, and never approve anything.
import { insertAuditEvent, sql, type Db } from "@mth/db";
import { outboxEnvelope, transformationCreatedV1 } from "@mth/shared/schemas";

export const STARTER_AUTOMATION_CONSUMER = "starter_automation.v1";

export type HandlerOutcome = "done" | "skipped" | "duplicate";

/**
 * `transformation.created` -> record the starter-automation request (REQ-S12-004, P1 increment). The actual
 * instantiation of methodology, forms, phase checklist and role-assignment tasks arrives with the P2/P5 content; in P1
 * the effect is the ledger row plus one audit event on the transformation's trail.
 */
export async function handleTransformationCreated(db: Db, data: unknown, jobId: string): Promise<HandlerOutcome> {
  const envelope = outboxEnvelope.parse(data);
  if (envelope.eventType !== "transformation.created" || envelope.schemaVersion !== 1) {
    throw new Error(`unexpected event ${envelope.eventType} v${envelope.schemaVersion} on transformation.created`);
  }
  const payload = transformationCreatedV1.parse(envelope.payload);
  return db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select(["id", "archived_at"])
      .where("id", "=", payload.transformationId)
      .executeTakeFirst();
    const outcome = !t || t.archived_at !== null ? "skipped" : "done";
    const ledger = await tx
      .insertInto("processed_message")
      .values({ consumer: STARTER_AUTOMATION_CONSUMER, idempotency_key: envelope.idempotencyKey, outcome })
      .onConflict((oc) => oc.doNothing())
      .returning("consumer")
      .executeTakeFirst();
    if (!ledger) return "duplicate";
    await insertAuditEvent(
      tx,
      {
        actorType: "service",
        actorUserId: null,
        onBehalfOfUserId: payload.createdBy,
        requestId: `job:${jobId}`,
        source: "worker",
      },
      {
        action:
          outcome === "done"
            ? "transformation.starter_automation_requested"
            : "transformation.starter_automation_skipped",
        recordType: "transformation",
        recordId: payload.transformationId,
        organizationId: payload.organizationId,
        transformationId: payload.transformationId,
        reason:
          outcome === "done"
            ? `Starter automation requested for ${payload.mode}${payload.entryPhase ? ` (entry phase ${payload.entryPhase})` : ""}; methodology content arrives in P2/P5`
            : "Transformation missing or archived before the starter automation ran",
      },
    );
    return outcome;
  });
}

export interface PurgeResult {
  readonly sessions: number;
  readonly loginStates: number;
  readonly idempotencyRecords: number;
}

/** Maintenance: delete expired/revoked sessions, expired login states and expired Idempotency-Key records. */
export async function purgeExpired(db: Db): Promise<PurgeResult> {
  return db.transaction().execute(async (tx) => {
    const sessions = await tx
      .deleteFrom("session")
      .where((eb) =>
        eb.or([
          eb("absolute_expires_at", "<", sql<Date>`now()`),
          eb("idle_expires_at", "<", sql<Date>`now()`),
          eb("revoked_at", "<", sql<Date>`now() - interval '1 day'`),
        ]),
      )
      .executeTakeFirst();
    const states = await tx
      .deleteFrom("oidc_login_state")
      .where("expires_at", "<", sql<Date>`now()`)
      .executeTakeFirst();
    const idem = await tx
      .deleteFrom("idempotency_record")
      .where("expires_at", "<", sql<Date>`now()`)
      .executeTakeFirst();
    return {
      sessions: Number(sessions.numDeletedRows),
      loginStates: Number(states.numDeletedRows),
      idempotencyRecords: Number(idem.numDeletedRows),
    };
  });
}
