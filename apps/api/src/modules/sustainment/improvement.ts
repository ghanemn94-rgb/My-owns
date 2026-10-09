// The continuous-improvement backlog (P4 slice G; ADR-0034 §8, §9, §12; T-DG4-BE-I2; REQ-PB-084 "CI backlog items remain
// visible after transformation closure; G6 lists the backlog", REQ-S11-008):
//   GET   /transformations/{t}/improvement-items                    list (transformation.read); the read slice H's G6
//                                                                   evaluator uses (GateFactsProvider, ARCH-07)
//   POST  /transformations/{t}/improvement-items                    create, open (improvement.edit; BO, TO)
//   PATCH /transformations/{t}/improvement-items/{i}                edit or move the status (If-Match)
//
// Status: open -> in_progress <-> open; open | in_progress -> done | rejected (final, with a resolution note). The source
// (`manual`, or a lesson, control check, review or handover of the same transformation) is fixed at create. No guard
// here reads the transformation's status: after closure the backlog stays visible and editable (ADR-0034 §8, Context 3).
// Every mutation re-checks authorization at commit time, validates, needs If-Match (creates are version 1) and writes
// its audit event in the same transaction (S-4). Nothing here approves anything or touches DG0-DG7.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { improvementItemCreate, improvementItemUpdate, type ImprovementItem } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  isoOrNull,
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
import { assertActiveUsers, assertSameTransformation } from "../transformations/index.ts";
import { assertOpenArea, diffFields, nextOperationsCode } from "./controls.ts";
import {
  dateOrNull,
  JSON_BODY,
  openSustainmentWrite,
  parseTransformationParam,
  sustainRule,
} from "./performance-areas.ts";

export const IMPROVEMENT_ITEMS = "/api/v1/transformations/:transformationId/improvement-items";
export const IMPROVEMENT_ITEM = `${IMPROVEMENT_ITEMS}/:improvementItemId`;
export const IMPROVEMENT_EDIT = "improvement.edit" as const;

/** The legal status moves (the `improvement_item_guard` list, 0048). */
const TRANSITIONS: ReadonlySet<string> = new Set([
  "open>in_progress",
  "open>done",
  "open>rejected",
  "in_progress>done",
  "in_progress>rejected",
  "in_progress>open",
]);
const FINAL: ReadonlySet<string> = new Set(["done", "rejected"]);

// ------------------------------------------------------------------------------------------------ problems (§12, S-11)

const ITEM_FINAL = (status: string) =>
  sustainRule("improvement_item.final", `This improvement item is ${status} and can no longer be changed.`);
const ITEM_TRANSITION = (from: string, to: string) =>
  sustainRule("improvement_item.status_transition", `This improvement item cannot move from ${from} to ${to}.`);
const RESOLUTION_NOTE_REQUIRED = () =>
  problems.badRequest(
    "improvement_item.resolution_note_required",
    "Record a resolution note before closing the item.",
    "/resolutionNote",
  );

// ------------------------------------------------------------------------------------------------ rows

interface ItemRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  code: string;
  performance_area_id: string | null;
  title: string;
  description: string | null;
  source_kind: string;
  lesson_id: string | null;
  control_check_id: string | null;
  review_id: string | null;
  handover_id: string | null;
  owner_user_id: string | null;
  priority: string | null;
  target_date: string | null;
  status: string;
  resolution_note: string | null;
  resolved_at: Date | string | null;
  resolved_by: string | null;
  version: number;
  created_at: Date | string;
  created_by: string;
  updated_at: Date | string;
  updated_by: string;
}

const ITEM_AUDIT_FIELDS = [
  "code",
  "performance_area_id",
  "title",
  "description",
  "source_kind",
  "lesson_id",
  "control_check_id",
  "review_id",
  "handover_id",
  "owner_user_id",
  "priority",
  "target_date",
  "status",
  "resolution_note",
] as const;

const toItem = (r: ItemRow): ImprovementItem => ({
  id: r.id,
  transformationId: r.transformation_id,
  code: r.code,
  performanceAreaId: r.performance_area_id,
  title: r.title,
  description: r.description,
  ownerUserId: r.owner_user_id,
  priority: r.priority as ImprovementItem["priority"],
  targetDate: dateOrNull(r.target_date),
  sourceKind: r.source_kind as ImprovementItem["sourceKind"],
  sourceId: r.lesson_id ?? r.control_check_id ?? r.review_id ?? r.handover_id,
  status: r.status as ImprovementItem["status"],
  resolutionNote: r.resolution_note,
  resolvedAt: isoOrNull(r.resolved_at as Date | null),
  resolvedBy: r.resolved_by,
  version: r.version,
  createdAt: iso(r.created_at as Date),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at as Date),
  updatedBy: r.updated_by,
});

async function findItem(db: DbOrTx, transformationId: string, id: string, lock = false): Promise<ItemRow> {
  let q = db
    .selectFrom("improvement_item")
    .selectAll()
    .where("id", "=", id)
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as ItemRow;
}

/** The table of each non-manual source kind (its id goes to the column of the same kind). */
function sourceTable(kind: string): string | null {
  if (kind === "lesson") return "lesson";
  if (kind === "control_check") return "control_check";
  if (kind === "review") return "sustainment_review";
  if (kind === "handover") return "bau_handover";
  return null;
}

// ------------------------------------------------------------------------------------------------ writes

async function createItem(tx: Tx, request: FastifyRequest): Promise<string> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openSustainmentWrite(tx, request, transformationId, IMPROVEMENT_EDIT);
  const body = parseBody(improvementItemCreate, request.body);
  if (body.performanceAreaId !== undefined && body.performanceAreaId !== null)
    await assertOpenArea(tx, transformationId, body.performanceAreaId, "/performanceAreaId");
  const table = sourceTable(body.sourceKind);
  if (table !== null) await assertSameTransformation(tx, table, transformationId, body.sourceId, "/sourceId");
  const sourceOf = (kind: string) => (body.sourceKind === kind ? body.sourceId! : null);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = (await tx
    .insertInto("improvement_item")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      code: await nextOperationsCode(tx, transformationId, "CI"),
      performance_area_id: body.performanceAreaId ?? null,
      title: body.title,
      description: body.description ?? null,
      source_kind: body.sourceKind,
      lesson_id: sourceOf("lesson"),
      control_check_id: sourceOf("control_check"),
      review_id: sourceOf("review"),
      handover_id: sourceOf("handover"),
      owner_user_id: body.ownerUserId ?? null,
      priority: body.priority ?? null,
      target_date: body.targetDate ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow()) as ItemRow;
  await record(tx, ctx.audit, {
    action: "improvement_item.create",
    recordType: "improvement_item",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({}, row, ITEM_AUDIT_FIELDS, ["target_date"]),
  });
  return id;
}

async function updateItem(tx: Tx, request: FastifyRequest, transformationId: string, itemId: string) {
  const ctx = await openSustainmentWrite(tx, request, transformationId, IMPROVEMENT_EDIT);
  const body = parseBody(improvementItemUpdate, request.body);
  const closing = body.status === "done" || body.status === "rejected";
  if (closing && body.resolutionNote === undefined) throw RESOLUTION_NOTE_REQUIRED();
  const expected = requireIfMatch(request);
  const current = await findItem(tx, transformationId, itemId, true);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (FINAL.has(current.status)) throw ITEM_FINAL(current.status);
  const move = body.status !== undefined && body.status !== current.status;
  if (move && !TRANSITIONS.has(`${current.status}>${body.status}`)) throw ITEM_TRANSITION(current.status, body.status!);
  if (body.performanceAreaId !== undefined && body.performanceAreaId !== null)
    await assertOpenArea(tx, transformationId, body.performanceAreaId, "/performanceAreaId");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  const updated = (await tx
    .updateTable("improvement_item")
    .set({
      ...(body.performanceAreaId !== undefined ? { performance_area_id: body.performanceAreaId } : {}),
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.priority !== undefined ? { priority: body.priority } : {}),
      ...(body.targetDate !== undefined ? { target_date: body.targetDate } : {}),
      ...(move ? { status: body.status! } : {}),
      ...(closing
        ? { resolution_note: body.resolutionNote!, resolved_at: sql<Date>`now()`, resolved_by: ctx.userId }
        : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as ItemRow;
  await record(tx, ctx.audit, {
    action: closing ? `improvement_item.${body.status}` : "improvement_item.update",
    recordType: "improvement_item",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, ITEM_AUDIT_FIELDS, ["target_date"]),
  });
}

// ------------------------------------------------------------------------------------------------ routes

const itemParams = z.strictObject({ transformationId: z.uuid(), improvementItemId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  performanceAreaId: z.uuid().optional(),
  status: z.enum(["open", "in_progress", "done", "rejected"]).optional(),
});

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerImprovementRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: IMPROVEMENT_EDIT }, consumes: JSON_BODY };

  app.get(IMPROVEMENT_ITEMS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "improvement_item",
      transformationId,
      performanceAreaId: query.performanceAreaId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("improvement_item").selectAll().where("transformation_id", "=", transformationId);
    if (query.performanceAreaId !== undefined) q = q.where("performance_area_id", "=", query.performanceAreaId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = (await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute()) as ItemRow[];
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toItem), nextCursor: page.nextCursor };
  });

  app.post(IMPROVEMENT_ITEMS, { config: edit }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createItem(tx, request);
      return toItem(await findItem(tx, transformationId, id));
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.patch(IMPROVEMENT_ITEM, { config: edit }, async (request, reply) => {
    const { transformationId, improvementItemId } = parse(itemParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateItem(tx, request, transformationId, improvementItemId);
      return toItem(await findItem(tx, transformationId, improvementItemId));
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${IMPROVEMENT_ITEMS}`, `POST ${IMPROVEMENT_ITEMS}`, `PATCH ${IMPROVEMENT_ITEM}`];
}
