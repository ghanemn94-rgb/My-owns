// audit (ADR-0004): the API's audit writer and audit queries. Depends on platform only.
//  - record(tx, ctx, event): the API's single insert path (delegates to @mth/db insertAuditEvent), always inside the
//    mutation's transaction, stamped with the request ID and source "api".
//  - listTransformationAudit: newest first, cursor on seq. Callers authorize (audit.read on the transformation).
import { insertAuditEvent, sql, type AuditEventInput, type DbOrTx, type Tx } from "@mth/db";
import type { AuditEvent } from "@mth/shared/schemas";
import { decodeCursor, filterHash, iso, paginate } from "../platform/index.ts";

export interface AuditContext {
  readonly actorUserId: string | null;
  readonly actorType?: "user" | "service" | "system";
  readonly onBehalfOfUserId?: string | null;
  readonly requestId: string;
}

export function record(tx: Tx, ctx: AuditContext, event: AuditEventInput): Promise<string> {
  return insertAuditEvent(
    tx,
    {
      actorType: ctx.actorType ?? (ctx.actorUserId ? "user" : "system"),
      actorUserId: ctx.actorUserId,
      onBehalfOfUserId: ctx.onBehalfOfUserId ?? null,
      requestId: ctx.requestId,
      source: "api",
    },
    event,
  );
}

export async function listTransformationAudit(
  db: DbOrTx,
  transformationId: string,
  page: { cursor?: string | undefined; limit: number },
): Promise<{ items: AuditEvent[]; nextCursor: string | null }> {
  const hash = filterHash({ transformationId });
  const after = decodeCursor(page.cursor, hash, 1);
  let q = db
    .selectFrom("audit_event as e")
    .leftJoin("actor_display as u", "u.user_id", "e.actor_user_id")
    .select([
      "e.id",
      "e.seq",
      "e.occurred_at",
      "e.action",
      "e.record_type",
      "e.record_id",
      "e.transformation_id",
      "e.actor_type",
      "e.actor_user_id",
      "u.display_name",
      "e.on_behalf_of_user_id",
      "e.prior_version",
      "e.new_version",
      "e.reason",
      "e.request_id",
      "e.changes",
    ])
    .where("e.transformation_id", "=", transformationId);
  if (after) q = q.where("e.seq", "<", sql<string>`${String(after[0])}::bigint`);
  const rows = await q
    .orderBy("e.seq", "desc")
    .limit(page.limit + 1)
    .execute();
  const { items, nextCursor } = paginate(rows, page.limit, (r) => [r.seq], hash);
  return {
    nextCursor,
    items: items.map((r) => ({
      id: r.id,
      seq: r.seq,
      occurredAt: iso(r.occurred_at),
      action: r.action,
      recordType: r.record_type,
      recordId: r.record_id,
      transformationId: r.transformation_id,
      actor: {
        type: r.actor_type as "user" | "service" | "system",
        userId: r.actor_user_id,
        displayName: r.display_name ?? null,
      },
      onBehalfOfUserId: r.on_behalf_of_user_id,
      priorVersion: r.prior_version,
      newVersion: r.new_version,
      reason: r.reason,
      requestId: r.request_id,
      changes: (r.changes ?? null) as AuditEvent["changes"],
    })),
  };
}
