// Deliverables (T05 "Key deliverables"; ADR-0023 §2; REQ-PB-045, REQ-S09-007 increment; T-DG3-BE-C):
//   GET   /initiatives/{initiativeId}/deliverables     by ordinal; countWarning outside 3-7 (a warning, never a rule)
//   POST  /initiatives/{initiativeId}/deliverables     create (initiative.edit); acceptance pending
//   GET   /deliverables/{deliverableId}                one deliverable
//   PATCH /deliverables/{deliverableId}                edit or archive (archiveReason) (initiative.edit; If-Match)
//   POST  /deliverables/{deliverableId}/submit         pending|rejected -> submitted (initiative.edit; If-Match)
//   POST  /deliverables/{deliverableId}/acceptance     submitted -> accepted|rejected (deliverable.accept AND the
//                                                      initiative's executive owner or their delegate; If-Match)
//
// Acceptance is a BUSINESS decision recorded with the decider, timestamp, note and audit event. The accepter is never
// the submitter (separation of duties; DB CHECK deliverable_acceptor_not_submitter as well), and a delegate cannot
// act for the submitter either. Delegation is one hop (access.actsOnBehalfOf), so it cannot form a loop.
import { diffFields, sql, type DbOrTx, type DeliverableTable, type Tx } from "@mth/db";
import {
  acceptanceDecision,
  deliverableCreate,
  deliverableUpdate,
  transitionNote,
  type Deliverable,
  type Warning,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { actsOnBehalfOf, principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  iso,
  isoOrNull,
  parse,
  parseBody,
  parseQuery,
  problems,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { assertActiveUsers, bumpStamps, loose, openWrite, type LooseRow } from "../transformations/index.ts";
import { checkVersion, dateText, forbiddenProblem, JSON_BODY, lockForWrite, transitionProblem } from "./waves.ts";
import { assertInitiativeEditable } from "./repository.ts";

export type DeliverableRow = Selectable<DeliverableTable>;

export const toDeliverable = (r: DeliverableRow): Deliverable => ({
  id: r.id,
  organizationId: r.organization_id,
  transformationId: r.transformation_id,
  initiativeId: r.initiative_id,
  ordinal: r.ordinal,
  title: r.title,
  description: r.description,
  ownerUserId: r.owner_user_id,
  dueDate: dateText(r.due_date),
  acceptanceStatus: r.acceptance_status as Deliverable["acceptanceStatus"],
  submittedBy: r.submitted_by,
  submittedAt: isoOrNull(r.submitted_at),
  decidedBy: r.decided_by,
  decidedAt: isoOrNull(r.decided_at),
  acceptanceNote: r.acceptance_note,
  status: r.status as Deliverable["status"],
  archivedAt: isoOrNull(r.archived_at),
  archivedBy: r.archived_by,
  archiveReason: r.archive_reason,
  version: r.version,
  createdAt: iso(r.created_at),
  createdBy: r.created_by,
  updatedAt: iso(r.updated_at),
  updatedBy: r.updated_by,
});

/** ADR-0021 §2: 3-7 key deliverables is the recommendation; outside it is a warning, never a rejection. */
export function deliverableCountWarning(activeCount: number): Warning | null {
  if (activeCount >= 3 && activeCount <= 7) return null;
  return {
    code: "initiative.deliverable_count",
    message: `The initiative has ${activeCount} key deliverables; 3-7 are recommended.`,
  };
}

/** The deliverables of the given initiatives (active only unless `includeArchived`), by initiative and ordinal. */
export function loadDeliverables(
  db: DbOrTx,
  transformationId: string,
  initiativeIds: readonly string[] | null,
  includeArchived = false,
): Promise<DeliverableRow[]> {
  let q = db.selectFrom("deliverable").selectAll().where("transformation_id", "=", transformationId);
  if (initiativeIds !== null) {
    if (initiativeIds.length === 0) return Promise.resolve([]);
    q = q.where("initiative_id", "in", [...initiativeIds]);
  }
  if (!includeArchived) q = q.where("status", "=", "active");
  return q.orderBy("initiative_id").orderBy("ordinal").orderBy("id").execute();
}

/** The initiative a nested route names, with the caller's read gate (404 when absent or not readable). */
export async function readableInitiative(db: DbOrTx, request: FastifyRequest, initiativeId: string) {
  const ini = await db
    .selectFrom("initiative")
    .select(["id", "transformation_id", "executive_owner_user_id", "code", "name"])
    .where("id", "=", initiativeId)
    .executeTakeFirst();
  if (!ini) throw problems.notFound();
  await requireTransformationRead(db, principalOf(request), ini.transformation_id);
  return ini;
}

const AUDIT_FIELDS = ["ordinal", "title", "description", "owner_user_id", "due_date"] as const;
const EDIT_RULES = [{ permission: "initiative.edit" }] as const;

// ------------------------------------------------------------------------------------------------ writes

async function createDeliverable(tx: Tx, request: FastifyRequest, initiativeId: string): Promise<DeliverableRow> {
  const ini = await readableInitiative(tx, request, initiativeId);
  // Lock the parent initiative (ordinal = max + 1 is serialised), then authorise on reloaded grants (BE18A).
  await tx.selectFrom("initiative").select("id").where("id", "=", initiativeId).forUpdate().execute();
  const ctx = await openWrite(tx, request, ini.transformation_id, EDIT_RULES, null, { atCommit: true });
  const body = parseBody(deliverableCreate, request.body);
  await assertInitiativeEditable(tx, initiativeId);
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  let ordinal = body.ordinal;
  if (ordinal === undefined) {
    const max = await tx
      .selectFrom("deliverable")
      .select((eb) => eb.fn.max("ordinal").as("m"))
      .where("initiative_id", "=", initiativeId)
      .executeTakeFirst();
    ordinal = Math.min(999, (max?.m ?? 0) + 1);
  }
  const id = uuidv7();
  const row = await tx
    .insertInto("deliverable")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: ini.transformation_id,
      initiative_id: initiativeId,
      ordinal,
      title: body.title,
      description: body.description ?? null,
      owner_user_id: body.ownerUserId ?? null,
      due_date: body.dueDate ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "deliverable.create",
    recordType: "deliverable",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId: ini.transformation_id,
    newVersion: row.version,
    changes: {
      ...diffFields({} as LooseRow, row as unknown as LooseRow, AUDIT_FIELDS),
      initiative_id: { from: null, to: initiativeId },
      acceptance_status: { from: null, to: "pending" },
    },
  });
  return row;
}

async function updateDeliverable(tx: Tx, request: FastifyRequest, id: string): Promise<DeliverableRow> {
  const { ctx, current } = await lockForWrite<DeliverableRow>(tx, request, "deliverable", id, EDIT_RULES, (r) => ({
    createdBy: r.created_by,
    ownerUserId: r.owner_user_id,
  }));
  const body = parseBody(deliverableUpdate, request.body);
  checkVersion(request, current);
  await assertInitiativeEditable(tx, current.initiative_id);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId ?? null, pointer: "/ownerUserId" }]);
  const changes: LooseRow = {
    ...(body.title !== undefined ? { title: body.title } : {}),
    ...(body.description !== undefined ? { description: body.description } : {}),
    ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
    ...(body.dueDate !== undefined ? { due_date: body.dueDate } : {}),
    ...(body.ordinal !== undefined ? { ordinal: body.ordinal } : {}),
    ...(body.archiveReason !== undefined
      ? {
          status: "archived",
          archived_at: sql<Date>`now()`,
          archived_by: ctx.userId,
          archive_reason: body.archiveReason,
        }
      : {}),
  };
  const updated = (await loose(tx)
    .updateTable("deliverable")
    .set({ ...changes, ...bumpStamps(ctx.userId) })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow()) as unknown as DeliverableRow;
  await record(tx, ctx.audit, {
    action: body.archiveReason !== undefined ? "deliverable.archive" : "deliverable.update",
    recordType: "deliverable",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.archiveReason !== undefined ? { reason: body.archiveReason } : {}),
    changes: diffFields(current as unknown as LooseRow, updated as unknown as LooseRow, [...AUDIT_FIELDS, "status"]),
  });
  return updated;
}

async function submitDeliverable(tx: Tx, request: FastifyRequest, id: string): Promise<DeliverableRow> {
  const { ctx, current } = await lockForWrite<DeliverableRow>(tx, request, "deliverable", id, EDIT_RULES, (r) => ({
    createdBy: r.created_by,
    ownerUserId: r.owner_user_id,
  }));
  const body = parseBody(transitionNote, request.body);
  checkVersion(request, current);
  await assertInitiativeEditable(tx, current.initiative_id);
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  if (current.acceptance_status !== "pending" && current.acceptance_status !== "rejected")
    throw transitionProblem(
      "deliverable.not_submittable",
      "Only a pending or rejected deliverable can be submitted for acceptance.",
    );
  const updated = await tx
    .updateTable("deliverable")
    .set({
      acceptance_status: "submitted",
      submitted_by: ctx.userId,
      submitted_at: sql<Date>`now()`,
      decided_by: null,
      decided_at: null,
      acceptance_note: null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "deliverable.submit",
    recordType: "deliverable",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      acceptance_status: { from: current.acceptance_status, to: "submitted" },
      submitted_by: { from: current.submitted_by, to: ctx.userId },
    },
  });
  return updated;
}

async function decideDeliverable(tx: Tx, request: FastifyRequest, id: string): Promise<DeliverableRow> {
  const { ctx, current } = await lockForWrite<DeliverableRow>(
    tx,
    request,
    "deliverable",
    id,
    [{ permission: "deliverable.accept" }],
    (r) => ({ createdBy: r.created_by, ownerUserId: r.owner_user_id }),
  );
  const body = parseBody(acceptanceDecision, request.body);
  checkVersion(request, current);
  await assertInitiativeEditable(tx, current.initiative_id);
  // Record-level ownership (ADR-0023 §2): the initiative's executive owner, or a delegate acting on their behalf.
  const ini = await tx
    .selectFrom("initiative")
    .select(["executive_owner_user_id"])
    .where("id", "=", current.initiative_id)
    .executeTakeFirstOrThrow();
  const owner = ini.executive_owner_user_id;
  const onBehalf = body.onBehalfOfUserId;
  const asOwner = owner !== null && owner === ctx.userId && (onBehalf === undefined || onBehalf === owner);
  const asDelegate =
    owner !== null && onBehalf === owner && (await actsOnBehalfOf(tx, ctx.principal, owner, "deliverable", ctx.target));
  if (!asOwner && !asDelegate)
    throw forbiddenProblem(
      "deliverable.not_owner",
      "Only the initiative's executive owner, or their delegate, can accept or reject its deliverables.",
    );
  // Separation of duties: never the submitter, neither in person nor through a delegate acting for them.
  if (current.submitted_by !== null && (current.submitted_by === ctx.userId || current.submitted_by === onBehalf))
    throw forbiddenProblem(
      "deliverable.acceptor_is_submitter",
      "A deliverable is accepted or rejected by someone other than the person who submitted it (separation of duties).",
    );
  if (current.status === "archived") throw problems.businessRule("record.archived", "Archived records are read-only.");
  if (current.acceptance_status !== "submitted")
    throw transitionProblem("deliverable.not_submitted", "Only a submitted deliverable can be accepted or rejected.");
  const updated = await tx
    .updateTable("deliverable")
    .set({
      acceptance_status: body.result,
      decided_by: ctx.userId,
      decided_at: sql<Date>`now()`,
      acceptance_note: body.note ?? null,
      ...bumpStamps(ctx.userId),
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  // A delegate's decision is audited as made on the owner's behalf (one hop; never the submitter).
  const audit = asDelegate && !asOwner ? { ...ctx.audit, onBehalfOfUserId: owner } : ctx.audit;
  await record(tx, audit, {
    action: "deliverable.decide",
    recordType: "deliverable",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId: ctx.transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    ...(body.note !== undefined ? { reason: body.note } : {}),
    changes: {
      acceptance_status: { from: "submitted", to: body.result },
      decided_by: { from: null, to: ctx.userId },
    },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const iParams = z.strictObject({ initiativeId: z.uuid() });
const dParams = z.strictObject({ deliverableId: z.uuid() });
const listQuery = z.strictObject({ includeArchived: z.stringbool().default(false) });
const ITEM = "/api/v1/deliverables/:deliverableId";
const COLLECTION = "/api/v1/initiatives/:initiativeId/deliverables";

/** Registers the deliverable routes and returns them as "METHOD /path". */
export function registerDeliverableRoutes(app: FastifyInstance, { db }: ModuleDeps): readonly string[] {
  app.get(COLLECTION, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { initiativeId } = parse(iParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    const ini = await readableInitiative(db, request, initiativeId);
    const rows = await loadDeliverables(db, ini.transformation_id, [initiativeId], query.includeArchived);
    const active = rows.filter((r) => r.status === "active").length;
    return { items: rows.map(toDeliverable), countWarning: deliverableCountWarning(active) };
  });

  app.post(
    COLLECTION,
    { config: { access: { permission: "initiative.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { initiativeId } = parse(iParams, request.params, "params");
      const row = await db.transaction().execute((tx) => createDeliverable(tx, request, initiativeId));
      return sendVersioned(reply, 201, toDeliverable(row), `/api/v1/deliverables/${row.id}`);
    },
  );

  app.get(ITEM, { config: { access: { permission: "transformation.read" } } }, async (request, reply) => {
    const { deliverableId } = parse(dParams, request.params, "params");
    const row = await db.selectFrom("deliverable").selectAll().where("id", "=", deliverableId).executeTakeFirst();
    if (!row) throw problems.notFound();
    await requireTransformationRead(db, principalOf(request), row.transformation_id);
    return sendVersioned(reply, 200, toDeliverable(row));
  });

  app.patch(
    ITEM,
    { config: { access: { permission: "initiative.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { deliverableId } = parse(dParams, request.params, "params");
      const row = await db.transaction().execute((tx) => updateDeliverable(tx, request, deliverableId));
      return sendVersioned(reply, 200, toDeliverable(row));
    },
  );

  app.post(
    `${ITEM}/submit`,
    { config: { access: { permission: "initiative.edit" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { deliverableId } = parse(dParams, request.params, "params");
      const row = await db.transaction().execute((tx) => submitDeliverable(tx, request, deliverableId));
      return sendVersioned(reply, 200, toDeliverable(row));
    },
  );

  app.post(
    `${ITEM}/acceptance`,
    { config: { access: { permission: "deliverable.accept" }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { deliverableId } = parse(dParams, request.params, "params");
      const row = await db.transaction().execute((tx) => decideDeliverable(tx, request, deliverableId));
      return sendVersioned(reply, 200, toDeliverable(row));
    },
  );

  return [
    `GET ${COLLECTION}`,
    `POST ${COLLECTION}`,
    `GET ${ITEM}`,
    `PATCH ${ITEM}`,
    `POST ${ITEM}/submit`,
    `POST ${ITEM}/acceptance`,
  ];
}
