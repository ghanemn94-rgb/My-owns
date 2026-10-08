// Resource demand per initiative, role and month (ADR-0023 §6; REQ-PB-059, REQ-S09-004, REQ-S04-006; T-DG3-BE-E):
//   GET   /resource-demands?transformationId=&initiativeId=   list                                (transformation.read)
//   POST  /resource-demands                                  create, status planned                (capacity.edit)
//   GET   /resource-demands/{id}                             one demand                            (transformation.read)
//   PATCH /resource-demands/{id}                             edit a PLANNED demand, or archive it   (capacity.edit; If-Match)
//   POST  /resource-demands/{id}/commit                      planned -> committed                  (capacity.commit; If-Match)
//   POST  /resource-demands/{id}/release                     committed -> released, with a reason  (capacity.commit; If-Match)
//
// Committing is the CAPACITY COMMITMENT G4 requires (g4.capacity): a resourcing commitment recorded by a holder of
// capacity.commit (the capacity owner role, BO/TO by default) with committed_by/at and an audit event. It is NOT a
// business approval and approves nothing. A committed demand is not edited in place: release it, then plan anew.
// A cancelled or completed initiative is read-only (ADR-0021 §2): every write here answers 422 initiative.read_only.
// FTE is a decimal string (numeric(6,2)); the conflict rule lives in capacity.ts.
import type { DbOrTx, InitiativeRow, ResourceDemandTable, Tx } from "@mth/db";
import { sql } from "@mth/db";
import {
  freeText,
  reasonRequest,
  resourceDemand,
  resourceDemandPage,
  transitionNote,
  uuid,
  type ResourceDemand,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead, type WriteRule } from "../access/index.ts";
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
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertActiveUsers, bumpStamps, openWrite } from "../transformations/index.ts";
import { activeRole, fte, fteText, periodMonth } from "./capacity.ts";
import { assertEditable } from "./repository.ts";
import { checkVersion, dateText, JSON_BODY, lockForWrite, transitionProblem } from "./waves.ts";

export type ResourceDemandRow = Selectable<ResourceDemandTable>;

// ------------------------------------------------------------------------------------------------ zod mirrors

// The ResourceDemand(+Page) response mirrors live in `@mth/shared/schemas` (roadmap.ts, T-DG3-ARCH-04), re-exported here.
export { resourceDemand, resourceDemandPage, type ResourceDemand };
export const resourceDemandCreate = z.strictObject({
  initiativeId: uuid,
  resourceRoleId: uuid,
  periodMonth,
  demandFte: fte,
  ownerUserId: uuid.nullable().optional(),
  note: freeText(1, 2000).optional(),
});
export const resourceDemandUpdate = z
  .strictObject({
    demandFte: fte.optional(),
    periodMonth: periodMonth.optional(),
    ownerUserId: uuid.nullable().optional(),
    note: freeText(1, 2000).nullable().optional(),
    status: z.enum(["archived"]).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");

export const toResourceDemand = (r: ResourceDemandRow): ResourceDemand => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  initiativeId: r.initiative_id,
  resourceRoleId: r.resource_role_id,
  periodMonth: dateText(r.period_month as unknown as string)!,
  demandFte: fteText(r.demand_fte),
  ownerUserId: r.owner_user_id,
  note: r.note,
  status: r.status as ResourceDemand["status"],
  committedBy: r.committed_by,
  committedAt: isoOrNull(r.committed_at),
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** The exact English texts of the demand transitions (ADR-0023 §6). */
export const DEMAND_REASONS = {
  "resource_demand.not_planned": "Only a planned resource demand can be changed or committed",
  "resource_demand.not_committed": "Only a committed resource demand can be released",
  "resource_demand.release_first": "A committed resource demand must be released before it is archived",
} as const;

const EDIT: readonly WriteRule[] = [{ permission: "capacity.edit" }];
const COMMIT: readonly WriteRule[] = [{ permission: "capacity.commit" }];

function diff(before: ResourceDemandRow, after: ResourceDemandRow) {
  const pairs: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["demand_fte", fteText(before.demand_fte), fteText(after.demand_fte)],
    [
      "period_month",
      dateText(before.period_month as unknown as string),
      dateText(after.period_month as unknown as string),
    ],
    ["owner_user_id", before.owner_user_id, after.owner_user_id],
    ["note", before.note, after.note],
    ["status", before.status, after.status],
    ["committed_by", before.committed_by, after.committed_by],
  ];
  return Object.fromEntries(
    pairs.filter(([, a, b]) => a !== b).map(([f, a, b]) => [f, { from: a ?? null, to: b ?? null }]),
  );
}

/** The demand's initiative, locked, and refused when closed (cancelled/completed -> 422 initiative.read_only). */
async function editableInitiative(tx: Tx, initiativeId: string): Promise<InitiativeRow> {
  const ini = await tx
    .selectFrom("initiative")
    .selectAll()
    .where("id", "=", initiativeId)
    .forUpdate()
    .executeTakeFirstOrThrow();
  assertEditable(ini);
  return ini;
}

// ------------------------------------------------------------------------------------------------ writes

async function createDemand(tx: Tx, request: FastifyRequest): Promise<ResourceDemandRow> {
  // The transformation is the initiative's: read the id leniently first so authorization precedes validation.
  const raw = (request.body ?? {}) as { initiativeId?: unknown };
  const initiativeId = parse(z.uuid(), raw.initiativeId, "body");
  const seen = await tx
    .selectFrom("initiative")
    .select(["id", "transformation_id"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!seen) throw problems.notFound();
  await requireTransformationRead(tx, principalOf(request), seen.transformation_id);
  const ctx = await openWrite(tx, request, seen.transformation_id, EDIT, null, { atCommit: true });
  const body = parseBody(resourceDemandCreate, request.body);
  await editableInitiative(tx, initiativeId);
  await activeRole(tx, ctx.transformationId, body.resourceRoleId);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("resource_demand")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ctx.transformationId,
      initiative_id: initiativeId,
      resource_role_id: body.resourceRoleId,
      period_month: body.periodMonth,
      demand_fte: body.demandFte,
      owner_user_id: body.ownerUserId ?? null,
      note: body.note ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "resource_demand.create",
    recordType: "resource_demand",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    newVersion: 1,
    changes: {
      initiative_id: { from: null, to: initiativeId },
      resource_role_id: { from: null, to: body.resourceRoleId },
      period_month: { from: null, to: body.periodMonth },
      demand_fte: { from: null, to: fteText(row.demand_fte) },
      status: { from: null, to: "planned" },
    },
  });
  return row;
}

const ownership = (r: ResourceDemandRow) => ({ createdBy: r.created_by, ownerUserId: r.owner_user_id });

async function updateDemand(tx: Tx, request: FastifyRequest, id: string): Promise<ResourceDemandRow> {
  const { ctx, current } = await lockForWrite<ResourceDemandRow>(tx, request, "resource_demand", id, EDIT, ownership);
  const body = parseBody(resourceDemandUpdate, request.body);
  checkVersion(request, current);
  await editableInitiative(tx, current.initiative_id);
  const archiving = body.status === "archived";
  const edits = Object.keys(body).some((k) => k !== "status");
  if (archiving && current.status === "committed")
    throw transitionProblem("resource_demand.release_first", DEMAND_REASONS["resource_demand.release_first"]);
  if (edits && current.status !== "planned")
    throw transitionProblem("resource_demand.not_planned", DEMAND_REASONS["resource_demand.not_planned"]);
  if (archiving && current.status === "archived")
    throw problems.businessRule("resource_demand.archived", "The resource demand is already archived.");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const updated = await tx
    .updateTable("resource_demand")
    .set({
      ...(body.demandFte !== undefined ? { demand_fte: body.demandFte } : {}),
      ...(body.periodMonth !== undefined ? { period_month: body.periodMonth } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
      ...(archiving ? { status: "archived" } : {}),
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: archiving ? "resource_demand.archive" : "resource_demand.update",
    recordType: "resource_demand",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff(current, updated),
  });
  return updated;
}

async function commitDemand(tx: Tx, request: FastifyRequest, id: string): Promise<ResourceDemandRow> {
  const { ctx, current } = await lockForWrite<ResourceDemandRow>(tx, request, "resource_demand", id, COMMIT, ownership);
  const body = parseBody(transitionNote, request.body ?? {});
  checkVersion(request, current);
  await editableInitiative(tx, current.initiative_id);
  if (current.status !== "planned")
    throw transitionProblem("resource_demand.not_planned", DEMAND_REASONS["resource_demand.not_planned"]);
  const updated = await tx
    .updateTable("resource_demand")
    .set({ status: "committed", committed_by: ctx.userId, committed_at: sql<Date>`now()`, ...bumpStamps(ctx.userId) })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "resource_demand.commit",
    recordType: "resource_demand",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: diff(current, updated),
  });
  return updated;
}

async function releaseDemand(tx: Tx, request: FastifyRequest, id: string): Promise<ResourceDemandRow> {
  const { ctx, current } = await lockForWrite<ResourceDemandRow>(tx, request, "resource_demand", id, COMMIT, ownership);
  const body = parseBody(reasonRequest, request.body);
  checkVersion(request, current);
  await editableInitiative(tx, current.initiative_id);
  if (current.status !== "committed")
    throw transitionProblem("resource_demand.not_committed", DEMAND_REASONS["resource_demand.not_committed"]);
  const updated = await tx
    .updateTable("resource_demand")
    .set({ status: "released", ...bumpStamps(ctx.userId) })
    .where("id", "=", id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "resource_demand.release",
    recordType: "resource_demand",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: diff(current, updated),
  });
  return updated;
}

/** Committed demand of a transformation (G4 reads it through portfolio/gate-facts.ts). */
export function loadDemands(db: DbOrTx, transformationId: string): Promise<ResourceDemandRow[]> {
  return db
    .selectFrom("resource_demand")
    .selectAll()
    .where("transformation_id", "=", transformationId)
    .orderBy("initiative_id")
    .orderBy("period_month")
    .orderBy("id")
    .execute();
}

// ------------------------------------------------------------------------------------------------ routes

const COLLECTION = "/api/v1/resource-demands";
const ITEM = `${COLLECTION}/:resourceDemandId`;
const idParams = z.strictObject({ resourceDemandId: z.uuid() });

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerResourceDemandRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: "capacity.edit" as const }, consumes: JSON_BODY };
  const commit = { access: { permission: "capacity.commit" as const }, consumes: JSON_BODY };
  const listQuery = z.strictObject({
    transformationId: z.uuid(),
    initiativeId: z.uuid().optional(),
    cursor: cursorSchema,
    limit: limitSchema,
  });

  app.get(COLLECTION, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), query.transformationId);
    const hash = filterHash({ transformationId: query.transformationId, initiativeId: query.initiativeId });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db.selectFrom("resource_demand").selectAll().where("transformation_id", "=", query.transformationId);
    if (query.initiativeId !== undefined) q = q.where("initiative_id", "=", query.initiativeId);
    if (after)
      q = q.where((eb) =>
        eb.or([
          eb("created_at", "<", new Date(String(after[0]))),
          eb.and([eb("created_at", "=", new Date(String(after[0]))), eb("id", "<", String(after[1]))]),
        ]),
      );
    const rows = await q
      .orderBy("created_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.created_at.toISOString(), r.id], hash);
    return { items: page.items.map(toResourceDemand), nextCursor: page.nextCursor };
  });

  app.post(COLLECTION, { config: edit }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createDemand(tx, request));
    return sendVersioned(reply, 201, toResourceDemand(row), `${COLLECTION}/${row.id}`);
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { resourceDemandId } = parse(idParams, request.params, "params");
    const row = await db
      .selectFrom("resource_demand")
      .selectAll()
      .where("id", "=", resourceDemandId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, toResourceDemand(row));
  });

  app.patch(ITEM, { config: edit }, async (request, reply) => {
    const { resourceDemandId } = parse(idParams, request.params, "params");
    const row = await db.transaction().execute((tx) => updateDemand(tx, request, resourceDemandId));
    return sendVersioned(reply, 200, toResourceDemand(row));
  });

  app.post(`${ITEM}/commit`, { config: commit }, async (request, reply) => {
    const { resourceDemandId } = parse(idParams, request.params, "params");
    const row = await db.transaction().execute((tx) => commitDemand(tx, request, resourceDemandId));
    return sendVersioned(reply, 200, toResourceDemand(row));
  });

  app.post(`${ITEM}/release`, { config: commit }, async (request, reply) => {
    const { resourceDemandId } = parse(idParams, request.params, "params");
    const row = await db.transaction().execute((tx) => releaseDemand(tx, request, resourceDemandId));
    return sendVersioned(reply, 200, toResourceDemand(row));
  });

  return [
    `GET ${COLLECTION}`,
    `POST ${COLLECTION}`,
    `GET ${ITEM}`,
    `PATCH ${ITEM}`,
    `POST ${ITEM}/commit`,
    `POST ${ITEM}/release`,
  ];
}
