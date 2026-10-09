// Actions on RAID entries and the action register (P4 slice E; ADR-0031 §4, §9-§11; T-DG4-BE-D; REQ-S16-018 Action):
//   GET   /transformations/{t}/raid/{raidEntryId}/actions          the actions linked to a RAID entry (transformation.read)
//   POST  /transformations/{t}/raid/{raidEntryId}/actions          an owned action linked to the entry (action.edit, or
//                                                                  action.update_own for an action the caller owns)
//   GET   /transformations/{t}/action-register                     every action of the transformation, with its source
//                                                                  (workshop, RAID entry, dependency, corrective case)
//                                                                  and the filters sourceKind, ownerUserId, status, overdue
//   GET   /transformations/{t}/action-register/{actionItemId}      one action
//   PATCH /transformations/{t}/action-register/{actionItemId}      update, incl. the follow-up date (If-Match); status
//                                                                  changes follow the DG2 transitions (422 invalid-transition)
//
// The DG2 action operations (/actions) are byte-stable: the P4 representation `RaidAction` (source links, follow-up
// date, `overdue`) is served only on these paths. Actions stay person-authored (`created_by` NOT NULL; ADR-0031 §6).
// A linked action's owner gets one My Work item (kind raid_action_due, dedupe `raid.action:<actionItemId>:<owner>`,
// due date = the action's due date) through createWorkItemOnce (S-13); an owner change cancels the previous owner's
// open item and creates the new owner's; done / cancelled closes it. `createLinkedAction` is reused by BE-D2 for
// corrective-case actions. Nothing here is a business approval or touches DG0-DG7.
import { diffFields, sql, type ActionItemTable, type DbOrTx, type Tx } from "@mth/db";
import { raidActionCreate, raidActionUpdate, type RaidAction, type RaidActionCreate } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { WriteRule } from "../access/index.ts";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  limitSchema,
  paginate,
  parse,
  parseBody,
  parseQuery,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { closeWorkItemsOfSubject, createWorkItemOnce } from "../tasks/index.ts";
import { assertActiveUsers, openWrite, type WriteContext } from "../transformations/index.ts";
import { JSON_BODY, parseEntryParams, parseTransformationParam, RAID, RAID_CLOSED } from "./register.ts";

export type ActionRow = Selectable<ActionItemTable>;

export const RAID_ENTRY_ACTIONS = `${RAID}/:raidEntryId/actions`;
export const ACTION_REGISTER = "/api/v1/transformations/:transformationId/action-register";
export const ACTION_REGISTER_ITEM = `${ACTION_REGISTER}/:actionItemId`;

export const RAID_ACTION_TASK_KIND = "raid_action_due";
const OPEN_STATUSES = ["open", "in_progress"] as const;

/** The DG2 action write rules (ADR-0020 §3): action.edit for any action, action.update_own for the caller's own. */
export const ACTION_RULES: readonly WriteRule[] = [
  { permission: "action.edit" },
  { permission: "action.update_own", scope: "own" },
];

/** The DG2 status transitions, unchanged (design-registers.ts actionItemRegister). */
const TRANSITIONS: ReadonlyMap<string, readonly string[]> = new Map([
  ["open", ["in_progress", "done", "cancelled"]],
  ["in_progress", ["open", "done", "cancelled"]],
  ["done", ["in_progress"]],
  ["cancelled", ["open"]],
]);

export const ACTION_AUDIT_FIELDS = [
  "title",
  "description",
  "owner_user_id",
  "due_date",
  "follow_up_date",
  "status",
  "raid_entry_id",
  "dependency_id",
  "corrective_case_id",
] as const satisfies readonly (keyof ActionRow & string)[];

/** The source an action is linked to at creation (never changed afterwards; `action_item_source_immutable`). */
export type ActionLink =
  | { readonly raidEntryId: string; readonly code: string }
  | { readonly dependencyId: string; readonly code: string }
  | { readonly correctiveCaseId: string; readonly code: string };

// ------------------------------------------------------------------------------------------------ presentation

/** Today's business date in the organization's default calendar timezone, else its default timezone (ADR-0025 §2). */
export async function todayOf(db: DbOrTx, organizationId: string): Promise<string> {
  const r = await sql<{ d: string }>`
    SELECT p4_business_date(now(), coalesce(
      (SELECT c.timezone FROM business_calendar c
        WHERE c.organization_id = ${organizationId}::uuid AND c.is_default AND c.status = 'active' LIMIT 1),
      (SELECT o.default_timezone FROM organization o WHERE o.id = ${organizationId}::uuid)))::text AS d`.execute(db);
  return r.rows[0]!.d;
}

async function organizationOf(db: DbOrTx, transformationId: string): Promise<string> {
  const t = await db
    .selectFrom("transformation")
    .select("organization_id")
    .where("id", "=", transformationId)
    .executeTakeFirstOrThrow();
  return t.organization_id;
}

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

export function sourceKindOf(r: ActionRow): RaidAction["sourceKind"] {
  if (r.source_workshop_item_id !== null) return "workshop";
  if (r.raid_entry_id !== null) return "raid_entry";
  if (r.dependency_id !== null) return "dependency";
  if (r.corrective_case_id !== null) return "corrective_case";
  return "none";
}

/** Overdue: a due date before today's business date while open or in progress (ADR-0031 §4). */
export function isOverdue(r: Pick<ActionRow, "due_date" | "status">, today: string): boolean {
  const due = dateOrNull(r.due_date);
  return due !== null && due < today && (OPEN_STATUSES as readonly string[]).includes(r.status);
}

export function toRaidAction(r: ActionRow, today: string): RaidAction {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    title: r.title,
    description: r.description,
    ownerUserId: r.owner_user_id,
    dueDate: dateOrNull(r.due_date),
    followUpDate: dateOrNull(r.follow_up_date),
    status: r.status as RaidAction["status"],
    sourceKind: sourceKindOf(r),
    sourceWorkshopItemId: r.source_workshop_item_id,
    raidEntryId: r.raid_entry_id,
    dependencyId: r.dependency_id,
    correctiveCaseId: r.corrective_case_id,
    overdue: isOverdue(r, today),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

// ------------------------------------------------------------------------------------------------ work items

const userActor = (ctx: WriteContext) =>
  ({ actorType: "user", actorUserId: ctx.userId, requestId: ctx.audit.requestId, source: "api" }) as const;

const isLinked = (r: ActionRow) =>
  r.raid_entry_id !== null || r.dependency_id !== null || r.corrective_case_id !== null;

/** The owner's My Work item for a linked, open action (createWorkItemOnce; one per action and owner). */
async function assignActionTask(ctx: WriteContext, row: ActionRow, sourceCode: string | null): Promise<void> {
  if (!isLinked(row) || !(OPEN_STATUSES as readonly string[]).includes(row.status)) return;
  await createWorkItemOnce(ctx.tx, userActor(ctx), {
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    kind: RAID_ACTION_TASK_KIND,
    assigneeUserId: row.owner_user_id,
    subjectType: "action_item",
    subjectId: row.id,
    linkPath: `/transformations/${ctx.transformationId}/action-register/${row.id}`,
    messageKey: "raid.task.action_due",
    messageParams: sourceCode === null ? {} : { sourceCode },
    dueDate: dateOrNull(row.due_date),
    dedupeKey: `raid.action:${row.id}:${row.owner_user_id}`,
  });
}

function closeActionTasks(ctx: WriteContext, actionId: string, status: "done" | "cancelled"): Promise<number> {
  return closeWorkItemsOfSubject(
    ctx.tx,
    userActor(ctx),
    {
      organizationId: ctx.organizationId,
      subjectType: "action_item",
      subjectId: actionId,
      kinds: [RAID_ACTION_TASK_KIND],
    },
    status,
  );
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * The write gate of an action create: the read gate first (ADM-only and outsiders 404), then action.edit, or
 * action.update_own when the new action's owner is the caller, re-checked at commit time (S-4).
 */
export async function openActionCreate(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  const raw = request.body;
  const owner =
    raw !== null && typeof raw === "object" && typeof (raw as { ownerUserId?: unknown }).ownerUserId === "string"
      ? (raw as { ownerUserId: string }).ownerUserId
      : null;
  return openWrite(tx, request, transformationId, ACTION_RULES, { ownerUserId: owner }, { atCommit: true });
}

/**
 * Creates an owned action linked to `link` inside `ctx`'s transaction: the insert, its audit event and the owner's
 * work item. The caller has authorised the write (openActionCreate), parsed the body and locked the source (and refused
 * a closed one). Reused by BE-D2 (`createCorrectiveCaseAction`).
 */
export async function createLinkedAction(
  ctx: WriteContext,
  link: ActionLink,
  body: RaidActionCreate,
): Promise<ActionRow> {
  await assertActiveUsers(ctx.tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = await ctx.tx
    .insertInto("action_item")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      title: body.title,
      description: body.description ?? null,
      owner_user_id: body.ownerUserId,
      due_date: body.dueDate ?? null,
      follow_up_date: body.followUpDate ?? null,
      raid_entry_id: "raidEntryId" in link ? link.raidEntryId : null,
      dependency_id: "dependencyId" in link ? link.dependencyId : null,
      corrective_case_id: "correctiveCaseId" in link ? link.correctiveCaseId : null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(ctx.tx, ctx.audit, {
    action: "action_item.create",
    recordType: "action_item",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: row.version,
    changes: diffFields({} as ActionRow, row, [...ACTION_AUDIT_FIELDS]),
  });
  await assignActionTask(ctx, row, link.code);
  return row;
}

/**
 * The RAID entry an action links to, locked FOR SHARE (a concurrent close waits): 404 when it is not in the
 * transformation's register, 422 raid.closed when it is closed.
 */
async function lockLinkSource(tx: Tx, transformationId: string, raidEntryId: string): Promise<ActionLink> {
  const entry = await tx
    .selectFrom("raid_entry")
    .select(["id", "code", "status"])
    .where("id", "=", raidEntryId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (entry) {
    if (entry.status === "closed") throw RAID_CLOSED();
    return { raidEntryId: entry.id, code: entry.code };
  }
  const dep = await tx
    .selectFrom("dependency")
    .select(["id", "code", "status"])
    .where("id", "=", raidEntryId)
    .where("transformation_id", "=", transformationId)
    .forShare()
    .executeTakeFirst();
  if (!dep || dep.status === "archived") throw problems.notFound();
  if (dep.status === "resolved") throw RAID_CLOSED();
  return { dependencyId: dep.id, code: dep.code };
}

async function createEntryAction(tx: Tx, request: FastifyRequest): Promise<ActionRow> {
  const { transformationId, raidEntryId } = parseEntryParams(request.params);
  const ctx = await openActionCreate(tx, request, transformationId);
  const body = parseBody(raidActionCreate, request.body);
  const link = await lockLinkSource(tx, transformationId, raidEntryId);
  return createLinkedAction(ctx, link, body);
}

async function updateAction(tx: Tx, request: FastifyRequest): Promise<ActionRow> {
  const { transformationId, actionItemId } = parse(actionParams, request.params, "params");
  await requireTransformationRead(tx, principalOf(request), transformationId);
  const current = await tx
    .selectFrom("action_item")
    .selectAll()
    .where("id", "=", actionItemId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const ctx = await openWrite(
    tx,
    request,
    transformationId,
    ACTION_RULES,
    { createdBy: current.created_by, ownerUserId: current.owner_user_id },
    { atCommit: true },
  );
  const body = parseBody(raidActionUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (
    body.status !== undefined &&
    body.status !== current.status &&
    !(TRANSITIONS.get(current.status) ?? []).includes(body.status)
  )
    throw problems.invalidTransition(`The record cannot move from ${current.status} to ${body.status}.`);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const updated = await tx
    .updateTable("action_item")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
      ...(body.followUpDate !== undefined ? { follow_up_date: body.followUpDate } : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "action_item.update",
    recordType: "action_item",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...ACTION_AUDIT_FIELDS]),
  });
  if (isLinked(updated)) {
    if (updated.status === "done" || updated.status === "cancelled") {
      if (updated.status !== current.status) await closeActionTasks(ctx, updated.id, updated.status);
    } else if (updated.owner_user_id !== current.owner_user_id) {
      await closeActionTasks(ctx, updated.id, "cancelled");
      await assignActionTask(ctx, updated, await linkCodeOf(tx, updated));
    }
  }
  return updated;
}

/** The code of the record an action is linked to (the work item's message parameter). */
async function linkCodeOf(db: DbOrTx, r: ActionRow): Promise<string | null> {
  if (r.raid_entry_id !== null)
    return (
      (await db.selectFrom("raid_entry").select("code").where("id", "=", r.raid_entry_id).executeTakeFirst())?.code ??
      null
    );
  if (r.dependency_id !== null)
    return (
      (await db.selectFrom("dependency").select("code").where("id", "=", r.dependency_id).executeTakeFirst())?.code ??
      null
    );
  if (r.corrective_case_id !== null)
    return (
      (await db.selectFrom("corrective_case").select("code").where("id", "=", r.corrective_case_id).executeTakeFirst())
        ?.code ?? null
    );
  return null;
}

// ------------------------------------------------------------------------------------------------ routes

const actionParams = z.strictObject({ transformationId: z.uuid(), actionItemId: z.uuid() });
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const registerQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  sourceKind: z.enum(["workshop", "raid_entry", "dependency", "corrective_case", "none"]).optional(),
  ownerUserId: z.uuid().optional(),
  status: z.enum(["open", "in_progress", "done", "cancelled"]).optional(),
  overdue: z.stringbool().optional(),
});

export function registerRaidActionRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: "action.edit" as const }, consumes: JSON_BODY };

  app.get(RAID_ENTRY_ACTIONS, { config: read }, async (request) => {
    const { transformationId, raidEntryId } = parseEntryParams(request.params);
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const entry = await db
      .selectFrom("raid_register")
      .select(["id", "record_table"])
      .where("id", "=", raidEntryId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!entry) throw problems.notFound();
    const hash = filterHash({ table: "action_item", transformationId, raidEntryId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db
      .selectFrom("action_item")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where(entry.record_table === "dependency" ? "dependency_id" : "raid_entry_id", "=", raidEntryId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const today = await todayOf(db, await organizationOf(db, transformationId));
    return { items: page.items.map((r) => toRaidAction(r, today)), nextCursor: page.nextCursor };
  });

  app.post(RAID_ENTRY_ACTIONS, { config: write }, async (request, reply) => {
    const { body, location } = await db.transaction().execute(async (tx) => {
      const row = await createEntryAction(tx, request);
      const today = await todayOf(tx, row.organization_id);
      return {
        body: toRaidAction(row, today),
        location: `/api/v1/transformations/${row.transformation_id}/action-register/${row.id}`,
      };
    });
    return sendVersioned(reply, 201, body, location);
  });

  app.get(ACTION_REGISTER, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(registerQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const today = await todayOf(db, await organizationOf(db, transformationId));
    const hash = filterHash({
      table: "action_register",
      transformationId,
      sourceKind: query.sourceKind ?? null,
      ownerUserId: query.ownerUserId ?? null,
      status: query.status ?? null,
      overdue: query.overdue ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("action_item").selectAll().where("transformation_id", "=", transformationId);
    switch (query.sourceKind) {
      case "workshop":
        q = q.where("source_workshop_item_id", "is not", null);
        break;
      case "raid_entry":
        q = q.where("raid_entry_id", "is not", null);
        break;
      case "dependency":
        q = q.where("dependency_id", "is not", null);
        break;
      case "corrective_case":
        q = q.where("corrective_case_id", "is not", null);
        break;
      case "none":
        q = q
          .where("source_workshop_item_id", "is", null)
          .where("raid_entry_id", "is", null)
          .where("dependency_id", "is", null)
          .where("corrective_case_id", "is", null);
        break;
      default:
        break;
    }
    if (query.ownerUserId !== undefined) q = q.where("owner_user_id", "=", query.ownerUserId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (query.overdue !== undefined) {
      const overdue = sql<boolean>`(due_date IS NOT NULL AND due_date < ${today}::date AND status IN ('open', 'in_progress'))`;
      q = q.where(query.overdue ? overdue : sql<boolean>`NOT ${overdue}`);
    }
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map((r) => toRaidAction(r, today)), nextCursor: page.nextCursor };
  });

  app.get(ACTION_REGISTER_ITEM, { config: read }, async (request, reply) => {
    const { transformationId, actionItemId } = parse(actionParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("action_item")
      .selectAll()
      .where("id", "=", actionItemId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toRaidAction(row, await todayOf(db, row.organization_id)));
  });

  app.patch(ACTION_REGISTER_ITEM, { config: write }, async (request, reply) => {
    const body = await db.transaction().execute(async (tx) => {
      const row = await updateAction(tx, request);
      return toRaidAction(row, await todayOf(tx, row.organization_id));
    });
    return sendVersioned(reply, 200, body);
  });

  return [
    `GET ${RAID_ENTRY_ACTIONS}`,
    `POST ${RAID_ENTRY_ACTIONS}`,
    `GET ${ACTION_REGISTER}`,
    `GET ${ACTION_REGISTER_ITEM}`,
    `PATCH ${ACTION_REGISTER_ITEM}`,
  ];
}
