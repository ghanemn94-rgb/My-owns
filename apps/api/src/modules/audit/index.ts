// audit (ADR-0004): the API's audit writer and audit queries. Depends on platform only.
//  - record(tx, ctx, event): the API's single insert path (delegates to @mth/db insertAuditEvent), always inside the
//    mutation's transaction, stamped with the request ID and source "api".
//  - listTransformationAudit: newest first, cursor on seq. Callers authorize (audit.read on the transformation).
//  - P6 (T-DG6-BE-E; ADR-0052 §8): queryAuditEvents / findAuditEvent, the global audit API's reads, filtered by the
//    caller's audit_event.read scope predicate that routes.ts receives from access through the injected port.
import {
  insertAuditEvent,
  sql,
  type AuditEventInput,
  type DbOrTx,
  type Expression,
  type SqlBool,
  type Tx,
} from "@mth/db";
import type { AuditEvent, AuditEventListQuery, GlobalAuditEvent } from "@mth/shared/schemas";
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

// ---------------------------------------------------------------- P6: the global audit API (ADR-0052 §8)

/**
 * The hierarchy columns of an audit event's target, as SQL expressions over the query below (ADR-0052 §8): an event
 * with a transformation targets that transformation (in its business unit); an event without one targets its
 * organization at organization level. `level` is 'transformation' or 'organization'.
 */
export interface AuditEventTargetColumns {
  readonly level: Expression<string>;
  readonly organizationId: Expression<string>;
  readonly businessUnitId: Expression<string | null>;
  readonly transformationId: Expression<string | null>;
}

/** The caller's audit_event.read boundary over an event's target columns (the access port, routes.ts). */
export type AuditScopePredicate = (cols: AuditEventTargetColumns) => Expression<SqlBool>;

/** One event before redaction; `redacted` is decided by the caller (routes.ts). */
export type AuditEventRow = Omit<GlobalAuditEvent, "redacted">;

function baseQuery(db: DbOrTx, scope: AuditScopePredicate) {
  return db
    .selectFrom("audit_event as e")
    .leftJoin("actor_display as u", "u.user_id", "e.actor_user_id")
    .leftJoin("transformation as t", "t.id", "e.transformation_id")
    .select([
      "e.id",
      "e.seq",
      "e.occurred_at",
      "e.organization_id",
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
      "e.source",
      "e.changes",
    ])
    .where("e.organization_id", "is not", null)
    .where(
      scope({
        level: sql<string>`(CASE WHEN e.transformation_id IS NULL THEN 'organization' ELSE 'transformation' END)`,
        organizationId: sql<string>`e.organization_id`,
        businessUnitId: sql<string | null>`t.business_unit_id`,
        transformationId: sql<string | null>`e.transformation_id`,
      }),
    );
}

type BaseRow = Awaited<ReturnType<ReturnType<typeof baseQuery>["executeTakeFirstOrThrow"]>>;

function toAuditEventRow(r: BaseRow): AuditEventRow {
  return {
    id: r.id,
    seq: String(r.seq),
    occurredAt: iso(r.occurred_at),
    organizationId: r.organization_id,
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
    source: r.source as GlobalAuditEvent["source"],
    changes: (r.changes ?? null) as GlobalAuditEvent["changes"],
  };
}

/** listAuditEvents: one organization's events inside `scope`, newest first by seq; cursor bound to the filters. */
export async function queryAuditEvents(
  db: DbOrTx,
  scope: AuditScopePredicate,
  query: AuditEventListQuery,
): Promise<{ items: AuditEventRow[]; nextCursor: string | null }> {
  const hash = filterHash({ ...query, view: "audit_events" });
  const after = decodeCursor(query.cursor, hash, 1);
  let q = baseQuery(db, scope).where("e.organization_id", "=", query.organizationId);
  if (query.transformationId !== undefined) q = q.where("e.transformation_id", "=", query.transformationId);
  if (query.recordType !== undefined) q = q.where("e.record_type", "=", query.recordType);
  if (query.recordId !== undefined) q = q.where("e.record_id", "=", query.recordId);
  if (query.actorUserId !== undefined) q = q.where("e.actor_user_id", "=", query.actorUserId);
  if (query.action !== undefined) q = q.where("e.action", "=", query.action);
  if (query.from !== undefined) q = q.where("e.occurred_at", ">=", new Date(query.from));
  if (query.to !== undefined) q = q.where("e.occurred_at", "<=", new Date(query.to));
  if (after) q = q.where("e.seq", "<", sql<string>`${String(after[0])}::bigint`);
  const rows = await q
    .orderBy("e.seq", "desc")
    .limit(query.limit + 1)
    .execute();
  const { items, nextCursor } = paginate(rows, query.limit, (r) => [String(r.seq)], hash);
  return { items: items.map(toAuditEventRow), nextCursor };
}

/** getAuditEvent: the event if it exists and lies inside `scope`, else undefined (the route answers 404). */
export async function findAuditEvent(
  db: DbOrTx,
  scope: AuditScopePredicate,
  auditEventId: string,
): Promise<AuditEventRow | undefined> {
  const row = await baseQuery(db, scope).where("e.id", "=", auditEventId).executeTakeFirst();
  return row === undefined ? undefined : toAuditEventRow(row);
}

// P6 (ADR-0052 §8): the global audit API routes (T-DG6-BE-E), registered by server.ts with the injected access port
// (audit cannot import access; see routes.ts).
export {
  auditRecordKey,
  registerAuditRoutes,
  sensitiveRecordsRedactedForEveryone,
  type AuditOrganizationAccess,
  type AuditRecordRef,
  type AuditRouteAccess,
} from "./routes.ts";
