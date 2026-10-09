// My Work items and the in-app inbox (OpenAPI tag "tasks"; ADR-0025 §4; REQ-S12-005; T-DG4-BE-A):
//   GET  /me/work-items                     the caller's own items (open first, by due date); never anyone else's
//   GET  /work-items/{workItemId}           one of the caller's items (anyone else: 404)
//   POST /work-items/{workItemId}/complete  mark the caller's task done (If-Match). 403 work_item.not_assignee;
//                                           422 work_item.closed, work_item.system_managed
//   GET  /me/inbox                          the caller's reminders, newest first, with the unread count
//   POST /me/inbox/{notificationId}/read    mark one of the caller's reminders read, once (If-Match; others: 404).
//                                           422 inbox.already_read
// Reads need a session and no permission: an item is visible to its assignee only. The two actions are bodiless
// (no config.consumes, the activateKpiDefinition precedent); each re-resolves the session inside its transaction
// (commit-time authorisation: 401 when the session ended), checks If-Match (428/409), and writes its audit event in
// the same transaction. An AUD user holds no item, so every write by one is refused like anyone else's.
import { sql, type InboxNotificationRow, type Tx, type WorkItemRow } from "@mth/db";
import { uuid, type InboxNotification, type WorkItem } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, organizationsWith, principalOf, refreshPrincipal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";

/**
 * Kinds whose task closes with its subject (ADR-0025 §4): the approval tasks close when the approval is decided, so
 * they refuse manual completion with 422 work_item.system_managed.
 */
export const SYSTEM_MANAGED_KINDS: ReadonlySet<string> = new Set(["approval_decision", "approval_escalated"]);

export const taskRefusals = {
  notAssignee: () =>
    new HttpProblem({
      status: 403,
      type: "urn:mth:problem:forbidden",
      code: "work_item.not_assignee",
      title: "Forbidden",
      detail: "Only the person this task is assigned to can complete it.",
    }),
  closed: () => problems.businessRule("work_item.closed", "This task is already closed."),
  systemManaged: () =>
    problems.businessRule("work_item.system_managed", "This task closes automatically when its approval is decided."),
  alreadyRead: () => problems.businessRule("inbox.already_read", "This reminder is already marked as read."),
} as const;

const paramsOf = (value: unknown) =>
  (value !== null && typeof value === "object" ? value : {}) as WorkItem["messageParams"];

export const toWorkItem = (r: WorkItemRow): WorkItem => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  kind: r.kind,
  assigneeUserId: r.assignee_user_id,
  subjectType: r.subject_type,
  subjectId: r.subject_id,
  linkPath: r.link_path,
  messageKey: r.message_key,
  messageParams: paramsOf(r.message_params),
  dueDate: r.due_date,
  periodLabel: r.period_label,
  status: r.status as WorkItem["status"],
  completedAt: isoOrNull(r.completed_at),
  completedBy: r.completed_by,
  createdAt: iso(r.created_at),
  version: r.version,
});

export const toInboxNotification = (r: InboxNotificationRow): InboxNotification => ({
  id: r.id,
  transformationId: r.transformation_id,
  workItemId: r.work_item_id,
  linkPath: r.link_path,
  messageKey: r.message_key,
  messageParams: paramsOf(r.message_params),
  readAt: isoOrNull(r.read_at),
  createdAt: iso(r.created_at),
  version: r.version,
});

const stringBool = z.stringbool({ truthy: ["true"], falsy: ["false"] });
const workItemQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(["open", "done", "cancelled"]).optional(),
  kind: z
    .string()
    .max(64)
    .regex(/^[a-z_]+$/, "validation.pattern")
    .optional(),
  transformationId: uuid.optional(),
});
const inboxQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema, unreadOnly: stringBool.default(false) });
const itemParams = z.strictObject({ workItemId: uuid });
const notificationParams = z.strictObject({ notificationId: uuid });

/** Sort key of My Work: open items first, then by due date (no due date last), then id. */
const ITEM_ORDER = sql<string>`(CASE WHEN status = 'open' THEN 0 ELSE 1 END)`;
const DUE_ORDER = sql<string>`COALESCE(due_date, DATE '9999-12-31')`;
/** Inbox cursor key: created_at in whole microseconds (an ISO string would drop them and skip rows). */
const CREATED_US = sql<string>`(EXTRACT(EPOCH FROM created_at) * 1000000)::bigint`;

/** The signed-in user id (401 without a session; a service principal has none). */
function callerOf(request: FastifyRequest): string {
  const principal = principalOf(request);
  if (principal.userId === null) throw problems.unauthenticated();
  return principal.userId;
}

async function completeItem(tx: Tx, request: FastifyRequest, workItemId: string): Promise<WorkItemRow> {
  callerOf(request);
  const fresh = await refreshPrincipal(tx, request); // commit-time: 401 when the session ended meanwhile
  const userId = fresh.userId!;
  const current = await tx
    .selectFrom("work_item")
    .selectAll()
    .where("id", "=", workItemId)
    .forUpdate()
    .executeTakeFirst();
  // Existence is disclosed only inside an organization the caller belongs to (anyone else: 404).
  if (!current || !organizationsWith(fresh, "organization.read").includes(current.organization_id))
    throw problems.notFound();
  if (current.assignee_user_id !== userId) throw taskRefusals.notAssignee();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "open") throw taskRefusals.closed();
  if (SYSTEM_MANAGED_KINDS.has(current.kind)) throw taskRefusals.systemManaged();
  const updated = await tx
    .updateTable("work_item")
    .set({
      status: "done",
      completed_at: sql<Date>`now()`,
      completed_by: userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", workItemId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "work_item.complete",
    recordType: "work_item",
    recordId: workItemId,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { status: { from: current.status, to: "done" } },
  });
  return updated;
}

async function markRead(tx: Tx, request: FastifyRequest, notificationId: string): Promise<InboxNotificationRow> {
  callerOf(request);
  const fresh = await refreshPrincipal(tx, request);
  const userId = fresh.userId!;
  const current = await tx
    .selectFrom("inbox_notification")
    .selectAll()
    .where("id", "=", notificationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current || current.recipient_user_id !== userId) throw problems.notFound();
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.read_at !== null) throw taskRefusals.alreadyRead();
  const updated = await tx
    .updateTable("inbox_notification")
    .set({
      read_at: sql<Date>`now()`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", notificationId)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "inbox_notification.read",
    recordType: "inbox_notification",
    recordId: notificationId,
    organizationId: current.organization_id,
    transformationId: current.transformation_id,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: { read_at: { from: null, to: iso(updated.read_at!) } },
  });
  return updated;
}

export function registerTaskRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const ME_ITEMS = "/api/v1/me/work-items";
  const ITEM = "/api/v1/work-items/:workItemId";
  const COMPLETE = `${ITEM}/complete`;
  const INBOX = "/api/v1/me/inbox";
  const READ = `${INBOX}/:notificationId/read`;
  const session = { access: { permission: "authenticated" } } as const;

  app.get(ME_ITEMS, { config: session }, async (request) => {
    const userId = callerOf(request);
    const query = parseQuery(workItemQuery, request.query);
    const hash = filterHash({
      userId,
      status: query.status,
      kind: query.kind,
      transformationId: query.transformationId,
    });
    const after = decodeCursor(query.cursor, hash, 3);
    let q = db
      .selectFrom("work_item")
      .selectAll()
      .select([ITEM_ORDER.as("status_rank"), DUE_ORDER.as("due_rank")])
      .where("assignee_user_id", "=", userId);
    if (query.status) q = q.where("status", "=", query.status);
    if (query.kind) q = q.where("kind", "=", query.kind);
    if (query.transformationId) q = q.where("transformation_id", "=", query.transformationId);
    if (after)
      q = q.where(
        sql<boolean>`(${ITEM_ORDER}, ${DUE_ORDER}, id) > (${Number(after[0])}::integer, ${String(after[1])}::date, ${String(after[2])}::uuid)`,
      );
    const rows = await q
      .orderBy(ITEM_ORDER)
      .orderBy(DUE_ORDER)
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [Number(r.status_rank), String(r.due_rank), r.id], hash);
    return { items: page.items.map(toWorkItem), nextCursor: page.nextCursor };
  });

  app.get(ITEM, { config: session }, async (request, reply) => {
    const userId = callerOf(request);
    const { workItemId } = parse(itemParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const row = await db
      .selectFrom("work_item")
      .selectAll()
      .where("id", "=", workItemId)
      .where("assignee_user_id", "=", userId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toWorkItem(row));
  });

  app.post(COMPLETE, { config: session }, async (request, reply) => {
    const { workItemId } = parse(itemParams, request.params, "params");
    const row = await db.transaction().execute((tx) => completeItem(tx, request, workItemId));
    return sendVersioned(reply, 200, toWorkItem(row));
  });

  app.get(INBOX, { config: session }, async (request) => {
    const userId = callerOf(request);
    const query = parseQuery(inboxQuery, request.query);
    const hash = filterHash({ userId, unreadOnly: query.unreadOnly });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("inbox_notification")
      .selectAll()
      .select(CREATED_US.as("created_us"))
      .where("recipient_user_id", "=", userId);
    if (query.unreadOnly) q = q.where("read_at", "is", null);
    if (after)
      q = q.where(sql<boolean>`(${CREATED_US}, id) < (${String(after[0])}::bigint, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [String(r.created_us), r.id], hash);
    const unread = await db
      .selectFrom("inbox_notification")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("recipient_user_id", "=", userId)
      .where("read_at", "is", null)
      .executeTakeFirstOrThrow();
    return { items: page.items.map(toInboxNotification), nextCursor: page.nextCursor, unreadCount: Number(unread.n) };
  });

  app.post(READ, { config: session }, async (request, reply) => {
    const { notificationId } = parse(notificationParams, request.params, "params");
    const row = await db.transaction().execute((tx) => markRead(tx, request, notificationId));
    return sendVersioned(reply, 200, toInboxNotification(row));
  });

  return [`GET ${ME_ITEMS}`, `GET ${ITEM}`, `POST ${COMPLETE}`, `GET ${INBOX}`, `POST ${READ}`];
}
