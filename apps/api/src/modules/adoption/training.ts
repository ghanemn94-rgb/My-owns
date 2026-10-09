// Training attendance records (P4 slice F; ADR-0033 §6, §9, §10, §11; T-DG4-BE-H2; REQ-PB-072 "Training completion",
// REQ-S16-020 Training/AssessmentRecord, the training half):
//   GET   /transformations/{t}/training-records        attendance records (transformation.read)
//   POST  /transformations/{t}/training-records        enrol a participant (a user or a label) (proficiency.record;
//                                                      BO, WL)
//   PATCH /transformations/{t}/training-records/{r}    completed (with its completion date), no_show or withdrawn;
//                                                      final (If-Match)
//
// Completion is attendance, never adoption: nothing here writes a proficiency observation or counts in the observed-
// proficiency measure (REQ-PB-072 "completion alone does not count as adoption"). A completed record names its
// completion date (400 validation.required at /completedOn otherwise; the 0047 CHECK is the last line). A linked
// intervention must be a training intervention (422 training_record.intervention_not_training). Every mutation: the
// read gate (ADM-only/outsider 404), proficiency.record at commit time (AUD 403), validation, If-Match on the update
// (428/409; creates are version 1), one audit event in the same transaction (S-4). Nothing here is a business approval.
import { diffFields, sql, type TrainingRecordTable, type Tx } from "@mth/db";
import { trainingRecordCreate, trainingRecordUpdate, type TrainingRecord } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { Selectable } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
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
import { assertActiveUsers } from "../transformations/index.ts";
import { PROFICIENCY_RECORD } from "./assessments.ts";
import {
  adoptionRule,
  JSON_BODY,
  lockActiveGroupRef,
  openAdoptionWrite,
  parseTransformationParam,
  T_BASE,
} from "./register.ts";

export type TrainingRecordRow = Selectable<TrainingRecordTable>;

export const TRAINING_RECORDS = `${T_BASE}/training-records`;
export const TRAINING_RECORD = `${TRAINING_RECORDS}/:trainingRecordId`;

const TRAINING_AUDIT_FIELDS = [
  "stakeholder_group_id",
  "intervention_id",
  "participant_user_id",
  "participant_label",
  "training_title",
  "scheduled_on",
  "status",
  "completed_on",
  "recorded_by",
] as const satisfies readonly (keyof TrainingRecordRow & string)[];

const TRAINING_FINAL = (status: string) =>
  adoptionRule("training_record.final", `This training record is ${status} and can no longer be changed.`);
const NOT_TRAINING = () =>
  adoptionRule(
    "training_record.intervention_not_training",
    "Only a training intervention can be linked to a training record.",
    "/interventionId",
  );

const dateOrNull = (d: string | null): string | null => (d === null ? null : String(d).slice(0, 10));

export function toTrainingRecord(r: TrainingRecordRow): TrainingRecord {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    stakeholderGroupId: r.stakeholder_group_id,
    interventionId: r.intervention_id,
    participantUserId: r.participant_user_id,
    participantLabel: r.participant_label,
    trainingTitle: r.training_title,
    scheduledOn: dateOrNull(r.scheduled_on),
    status: r.status as TrainingRecord["status"],
    completedOn: dateOrNull(r.completed_on),
    recordedBy: r.recorded_by,
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
    updatedAt: iso(r.updated_at),
    updatedBy: r.updated_by,
  };
}

async function createTraining(tx: Tx, request: FastifyRequest): Promise<TrainingRecordRow> {
  const transformationId = parseTransformationParam(request.params);
  const ctx = await openAdoptionWrite(tx, request, transformationId, PROFICIENCY_RECORD);
  const body = parseBody(trainingRecordCreate, request.body);
  const group = await lockActiveGroupRef(tx, transformationId, body.stakeholderGroupId, "/stakeholderGroupId");
  if (body.interventionId !== undefined) {
    const iv = await tx
      .selectFrom("adoption_intervention")
      .select(["id", "intervention_type"])
      .where("id", "=", body.interventionId)
      .where("transformation_id", "=", transformationId)
      .forShare()
      .executeTakeFirst();
    if (!iv)
      throw adoptionRule(
        "validation.reference",
        "The linked record does not exist in this transformation.",
        "/interventionId",
      );
    if (iv.intervention_type !== "training") throw NOT_TRAINING();
  }
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.participantUserId, pointer: "/participantUserId" }]);
  const id = uuidv7();
  const row = await tx
    .insertInto("training_record")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      stakeholder_group_id: group.id,
      intervention_id: body.interventionId ?? null,
      participant_user_id: body.participantUserId ?? null,
      participant_label: body.participantLabel ?? null,
      training_title: body.trainingTitle,
      scheduled_on: body.scheduledOn ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "training_record.create",
    recordType: "training_record",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    changes: diffFields({} as TrainingRecordRow, row, [...TRAINING_AUDIT_FIELDS]),
  });
  return row;
}

const trainingParams = z.strictObject({ transformationId: z.uuid(), trainingRecordId: z.uuid() });

async function updateTraining(tx: Tx, request: FastifyRequest): Promise<TrainingRecordRow> {
  const { transformationId, trainingRecordId } = parse(trainingParams, request.params, "params");
  const ctx = await openAdoptionWrite(tx, request, transformationId, PROFICIENCY_RECORD);
  const current = await tx
    .selectFrom("training_record")
    .selectAll()
    .where("id", "=", trainingRecordId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!current) throw problems.notFound();
  const body = parseBody(trainingRecordUpdate, request.body);
  const expected = requireIfMatch(request);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status !== "enrolled") throw TRAINING_FINAL(current.status);
  const updated = await tx
    .updateTable("training_record")
    .set({
      status: body.status,
      completed_on: body.status === "completed" ? body.completedOn! : null,
      recorded_by: ctx.userId,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "training_record.update",
    recordType: "training_record",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diffFields(current, updated, [...TRAINING_AUDIT_FIELDS]),
  });
  return updated;
}

const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  stakeholderGroupId: z.uuid().optional(),
  status: z.enum(["enrolled", "completed", "no_show", "withdrawn"]).optional(),
});

export function registerTrainingRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const write = { access: { permission: PROFICIENCY_RECORD }, consumes: JSON_BODY };

  app.get(TRAINING_RECORDS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "training_record",
      transformationId,
      stakeholderGroupId: query.stakeholderGroupId ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("training_record").selectAll().where("transformation_id", "=", transformationId);
    if (query.stakeholderGroupId !== undefined) q = q.where("stakeholder_group_id", "=", query.stakeholderGroupId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toTrainingRecord), nextCursor: page.nextCursor };
  });

  app.post(TRAINING_RECORDS, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => createTraining(tx, request));
    return sendVersioned(reply, 201, toTrainingRecord(row), `${request.url.split("?")[0]!}/${row.id}`);
  });

  app.patch(TRAINING_RECORD, { config: write }, async (request, reply) => {
    const row = await db.transaction().execute((tx) => updateTraining(tx, request));
    return sendVersioned(reply, 200, toTrainingRecord(row));
  });

  return [`GET ${TRAINING_RECORDS}`, `POST ${TRAINING_RECORDS}`, `PATCH ${TRAINING_RECORD}`];
}
