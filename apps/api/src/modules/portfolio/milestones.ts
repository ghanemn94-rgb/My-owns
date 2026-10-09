// Milestones (T05 "Milestones" / T07 dates; ADR-0023 §2-§3; REQ-S09-006, REQ-S09-007 increment; T-DG3-BE-C):
//   GET   /initiatives/{initiativeId}/milestones     approved vs forecast dates
//   POST  /initiatives/{initiativeId}/milestones     create (initiative.edit or roadmap.edit); no approved date
//   GET   /milestones/{milestoneId}                  one milestone
//   PATCH /milestones/{milestoneId}                  move the forecast, set the actual date or status (roadmap.edit;
//                                                    If-Match: a stale version is 409 with currentVersion)
//   POST  /milestones/{milestoneId}/approve-date     set the approved (baseline) date with a reason (roadmap.approve)
//
// `approved_date` is written ONLY by approve-date: a recorded human decision with approver, timestamp and reason; a
// re-approval overwrites it with its own reason and audit event (formal rebaseline through change control is P4).
// `forecast_date` is editable ("moving a milestone"). Variance = forecast - approved in days, computed on read and
// never stored; null (Unknown) when either date is missing, never 0. The timeline, table and board read the same
// records through the roadmap read model (roadmap.ts).
import { diffFields, sql, type DbOrTx, type MilestoneTable, type Tx } from "@mth/db";
import { businessDate, freeText, milestoneCreate, uuid, type Milestone } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  iso,
  isoOrNull,
  materialChangePort,
  type ModuleDeps,
  parse,
  parseBody,
  parseQuery,
  problems,
  sendVersioned,
} from "../platform/index.ts";
import {
  assertActiveUsers,
  assertSameTransformation,
  bumpStamps,
  loose,
  openWrite,
  type LooseRow,
} from "../transformations/index.ts";
import { readableInitiative } from "./deliverables.ts";
import { assertInitiativeEditable } from "./repository.ts";
import { checkVersion, dateText, JSON_BODY, lockForWrite, rule } from "./waves.ts";

export type MilestoneRow = Selectable<MilestoneTable>;

const MILESTONE_STATUSES = ["planned", "achieved", "missed", "cancelled"] as const;

/** Zod mirror of MilestoneUpdate (docs/api/openapi.yaml). */
export const milestoneUpdate = z
  .strictObject({
    title: freeText(1, 300).optional(),
    description: freeText(1, 4000).nullable().optional(),
    ownerUserId: uuid.nullable().optional(),
    waveId: uuid.nullable().optional(),
    forecastDate: businessDate.nullable().optional(),
    actualDate: businessDate.nullable().optional(),
    status: z.enum(MILESTONE_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length >= 1, "validation.min_properties");
/** Zod mirror of MilestoneDateApproval. */
export const milestoneDateApproval = z.strictObject({ approvedDate: businessDate, reason: freeText(3, 1000) });

const DAY_MS = 86_400_000;

/** forecast - approved in whole days; null (Unknown) when either is missing. Calendar dates, so no DST effects. */
export function varianceDays(approved: string | null, forecast: string | null): number | null {
  if (approved === null || forecast === null) return null;
  return Math.round((Date.parse(`${forecast}T00:00:00Z`) - Date.parse(`${approved}T00:00:00Z`)) / DAY_MS);
}

export const toMilestone = (r: MilestoneRow): Milestone => {
  const approved = dateText(r.approved_date);
  const forecast = dateText(r.forecast_date);
  return {
    id: r.id,
    organizationId: r.organization_id,
    transformationId: r.transformation_id,
    initiativeId: r.initiative_id,
    waveId: r.wave_id,
    title: r.title,
    description: r.description,
    ownerUserId: r.owner_user_id,
    approvedDate: approved,
    approvedBy: r.approved_by,
    approvedAt: isoOrNull(r.approved_at),
    approvalReason: r.approval_reason,
    forecastDate: forecast,
    actualDate: dateText(r.actual_date),
    varianceDays: varianceDays(approved, forecast),
    status: r.status as Milestone["status"],
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
};

/** The milestones of a transformation (optionally of some initiatives), by initiative, forecast date and id. */
export function loadMilestones(
  db: DbOrTx,
  transformationId: string,
  initiativeIds: readonly string[] | null,
): Promise<MilestoneRow[]> {
  let q = db.selectFrom("milestone").selectAll().where("transformation_id", "=", transformationId);
  if (initiativeIds !== null) {
    if (initiativeIds.length === 0) return Promise.resolve([]);
    q = q.where("initiative_id", "in", [...initiativeIds]);
  }
  return q.orderBy("initiative_id").orderBy("forecast_date").orderBy("id").execute();
}

const AUDIT_FIELDS = [
  "title",
  "description",
  "owner_user_id",
  "wave_id",
  "forecast_date",
  "actual_date",
  "status",
] as const;

/** status 'achieved' exactly when an actual date is set (DB CHECK milestone_achieved_actual). */
function assertAchievedShape(status: string, actual: string | null): void {
  if ((status === "achieved") !== (actual !== null))
    throw rule(
      "milestone.actual_date_status",
      "A milestone is achieved exactly when it has an actual date: set both together, or neither.",
      "/actualDate",
    );
}

// ------------------------------------------------------------------------------------------------ writes

async function createMilestone(tx: Tx, request: FastifyRequest, initiativeId: string): Promise<MilestoneRow> {
  const ini = await readableInitiative(tx, request, initiativeId);
  await tx.selectFrom("initiative").select("id").where("id", "=", initiativeId).forUpdate().execute();
  const ctx = await openWrite(
    tx,
    request,
    ini.transformation_id,
    [{ permission: "initiative.edit" }, { permission: "roadmap.edit" }],
    null,
    { atCommit: true },
  );
  const body = parseBody(milestoneCreate, request.body);
  await assertInitiativeEditable(tx, initiativeId);
  await assertSameTransformation(tx, "roadmap_wave", ini.transformation_id, body.waveId, "/waveId");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("milestone")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ini.transformation_id,
      initiative_id: initiativeId,
      wave_id: body.waveId ?? null,
      title: body.title,
      description: body.description ?? null,
      owner_user_id: body.ownerUserId ?? null,
      forecast_date: body.forecastDate ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "milestone.create",
    recordType: "milestone",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ini.transformation_id,
    newVersion: row.version,
    changes: {
      ...diffFields({} as LooseRow, row as unknown as LooseRow, AUDIT_FIELDS),
      initiative_id: { from: null, to: initiativeId },
    },
  });
  return row;
}

async function updateMilestone(tx: Tx, request: FastifyRequest, id: string): Promise<MilestoneRow> {
  const { ctx, current } = await lockForWrite<MilestoneRow>(
    tx,
    request,
    "milestone",
    id,
    [{ permission: "roadmap.edit" }],
    (r) => ({ createdBy: r.created_by, ownerUserId: r.owner_user_id }),
  );
  const body = parseBody(milestoneUpdate, request.body);
  checkVersion(request, current);
  await assertInitiativeEditable(tx, current.initiative_id);
  const status = body.status ?? current.status;
  const actual = body.actualDate !== undefined ? body.actualDate : dateText(current.actual_date);
  assertAchievedShape(status, actual);
  await assertSameTransformation(tx, "roadmap_wave", current.transformation_id, body.waveId, "/waveId");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const changes: LooseRow = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
    ...(body.waveId !== undefined ? { wave_id: body.waveId } : {}),
    ...(body.forecastDate !== undefined ? { forecast_date: body.forecastDate } : {}),
    ...(body.actualDate !== undefined ? { actual_date: body.actualDate } : {}),
    ...(body.status !== undefined ? { status: body.status } : {}),
  };
  const updated = (await loose(tx)
    .updateTable("milestone")
    .set({ ...changes, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as unknown as MilestoneRow;
  await record(tx, ctx.audit, {
    action: "milestone.update",
    recordType: "milestone",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current as unknown as LooseRow, updated as unknown as LooseRow, AUDIT_FIELDS),
  });
  return updated;
}

async function approveMilestoneDate(tx: Tx, request: FastifyRequest, id: string): Promise<MilestoneRow> {
  const { ctx, current } = await lockForWrite<MilestoneRow>(
    tx,
    request,
    "milestone",
    id,
    [{ permission: "roadmap.approve" }],
    (r) => ({ createdBy: r.created_by, ownerUserId: r.owner_user_id }),
  );
  const body = parseBody(milestoneDateApproval, request.body);
  checkVersion(request, current);
  await assertInitiativeEditable(tx, current.initiative_id);
  if (current.status === "cancelled")
    throw rule("milestone.cancelled", "A cancelled milestone has no approved date to set.", "/approvedDate");
  const reapproval = current.approved_date !== null;
  // T-DG4-BE-L (ADR-0036 §3, REQ-S09-010): a re-approval beyond a configured material threshold needs a change request.
  const changeControl = materialChangePort();
  if (changeControl === null) throw problems.internal();
  await changeControl.assertMilestoneDateWithinThreshold(
    tx,
    ctx.organizationId,
    ctx.transformationId,
    dateText(current.approved_date),
    body.approvedDate,
  );
  const updated = await tx
    .updateTable("milestone")
    .set({
      approved_date: body.approvedDate,
      approved_by: ctx.userId,
      approved_at: sql<Date>`now()`,
      approval_reason: body.reason,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: reapproval ? "milestone.reapprove_date" : "milestone.approve_date",
    recordType: "milestone",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: {
      approved_date: { from: dateText(current.approved_date), to: body.approvedDate },
      approved_by: { from: current.approved_by, to: ctx.userId },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const iParams = z.strictObject({ initiativeId: z.uuid() });
const mParams = z.strictObject({ milestoneId: z.uuid() });
const ITEM = "/api/v1/milestones/:milestoneId";
const COLLECTION = "/api/v1/initiatives/:initiativeId/milestones";

/** Registers the milestone routes and returns them as "METHOD /path". */
export function registerMilestoneRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(COLLECTION, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { initiativeId } = parse(iParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    const ini = await readableInitiative(db, request, initiativeId);
    return { items: (await loadMilestones(db, ini.transformation_id, [initiativeId])).map(toMilestone) };
  });

  app.post(
    COLLECTION,
    { config: { access: { permission: "initiative.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId } = parse(iParams, request.params, "params");
      const row = await db.transaction().execute((tx) => createMilestone(tx, request, initiativeId));
      return sendVersioned(reply, 201, toMilestone(row), `/api/v1/milestones/${row.id}`);
    },
  );

  app.get(ITEM, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { milestoneId } = parse(mParams, request.params, "params");
    const row = await db.selectFrom("milestone").selectAll().where("id", "=", milestoneId).executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, toMilestone(row));
  });

  app.patch(
    ITEM,
    { config: { access: { permission: "roadmap.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { milestoneId } = parse(mParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateMilestone(tx, request, milestoneId));
      return sendVersioned(reply, 200, toMilestone(row));
    },
  );

  app.post(
    `${ITEM}/approve-date`,
    { config: { access: { permission: "roadmap.approve" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { milestoneId } = parse(mParams, request.params, "params");
      const row = await db.transaction().execute((tx) => approveMilestoneDate(tx, request, milestoneId));
      return sendVersioned(reply, 200, toMilestone(row));
    },
  );

  return [`GET ${COLLECTION}`, `POST ${COLLECTION}`, `GET ${ITEM}`, `PATCH ${ITEM}`, `POST ${ITEM}/approve-date`];
}
