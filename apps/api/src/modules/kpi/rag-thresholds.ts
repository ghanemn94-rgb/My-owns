// Versioned RAG thresholds of a KPI (ADR-0027 §8 step 5, ADR-0028 §5; REQ-S07-007 threshold half; T-DG4-KBE-B):
//   GET  /transformations/{t}/kpi-definitions/{k}/rag-thresholds   threshold versions, newest first
//   POST /transformations/{t}/kpi-definitions/{k}/rag-thresholds   a new version, in force at once (kpi_threshold.configure)
//
// - A new version is inserted `active` and the previous active version becomes `superseded` in the same transaction
//   (one audit event each). A threshold version is otherwise immutable (trigger kpi_rag_threshold_immutable).
// - `relative` thresholds are fractions of |expected-to-date| (0.05 = 5 %); `absolute` thresholds are in the KPI's unit.
//   The red threshold cannot be below the amber threshold (422 kpi_threshold.order); neither is negative.
// - "Changing the threshold version recomputes RAG" (REQ-S07-007): the outbox event kpi.threshold_changed (key
//   kpi.threshold_changed:<thresholdId>:<versionNo>) is written in the same transaction; KBE-C's kpi.recalculate
//   consumer runs one calculation run for it. Without a version, the KBE-A defaults 0.05 / 0.10 apply (recorded as
//   'default' by the run). RAG never reads task completion (ADR-0027 A.8 #7).
import { diffFields, sql, type DbOrTx, type KpiRagThresholdRow, type Tx } from "@mth/db";
import { FORMULA_DECIMAL as Decimal } from "@mth/shared/calc";
import {
  canonicalDecimal,
  kpiRagThresholdCreate,
  type KpiRagThreshold,
  type KpiRagThresholdCreate,
} from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
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
  type ModuleDeps,
} from "../platform/index.ts";
import { maybeIdempotent, openWrite, sendCreated, type WriteContext } from "../transformations/index.ts";
import { enqueueKpiEvent } from "./kpi-outbox.ts";
import { ruleProblem } from "./support.ts";

const THRESHOLDS = "/api/v1/transformations/:transformationId/kpi-definitions/:kpiDefinitionId/rag-thresholds";
const JSON_BODY = ["application/json"] as const;
const PERMISSION = "kpi_threshold.configure" as const;

export const KPI_RAG_THRESHOLD_AUDIT_FIELDS = [
  "version_no",
  "tolerance_mode",
  "amber_threshold",
  "red_threshold",
  "reason",
  "status",
  "superseded_at",
] as const satisfies readonly (keyof KpiRagThresholdRow)[];

export function toKpiRagThreshold(r: KpiRagThresholdRow): KpiRagThreshold {
  return {
    id: r.id,
    kpiDefinitionId: r.kpi_definition_id,
    versionNo: r.version_no,
    toleranceMode: r.tolerance_mode as KpiRagThreshold["toleranceMode"],
    amberThreshold: canonicalDecimal(r.amber_threshold),
    redThreshold: canonicalDecimal(r.red_threshold),
    reason: r.reason,
    status: r.status as KpiRagThreshold["status"],
    supersededAt: isoOrNull(r.superseded_at),
    version: r.version,
    createdAt: iso(r.created_at),
    createdBy: r.created_by,
  };
}

const params = z.strictObject({ transformationId: z.uuid(), kpiDefinitionId: z.uuid() });
const listQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The threshold order rules (ADR-0027 §13 kpi_threshold.order), checked before anything is written. */
export function checkThresholds(body: Pick<KpiRagThresholdCreate, "amberThreshold" | "redThreshold">): void {
  if (new Decimal(body.amberThreshold).isNegative())
    throw ruleProblem({
      code: "validation.constraint",
      detail: "A threshold cannot be negative.",
      pointer: "/amberThreshold",
    });
  if (new Decimal(body.redThreshold).lt(body.amberThreshold))
    throw ruleProblem({
      code: "kpi_threshold.order",
      detail: "The red threshold cannot be below the amber threshold.",
      pointer: "/redThreshold",
    });
}

async function createThreshold(ctx: WriteContext, kpiDefinitionId: string, body: KpiRagThresholdCreate) {
  const { tx, transformationId } = ctx;
  // The definition row lock serializes the threshold numbering of this KPI.
  const def = await tx
    .selectFrom("kpi_definition")
    .select(["id", "status"])
    .where("transformation_id", "=", transformationId)
    .where("id", "=", kpiDefinitionId)
    .forUpdate()
    .executeTakeFirst();
  if (!def) throw problems.notFound();
  if (def.status === "archived")
    throw problems.businessRule("kpi_definition.archived", "Archived records are read-only.");
  checkThresholds(body);
  const previous = await tx
    .selectFrom("kpi_rag_threshold")
    .selectAll()
    .where("kpi_definition_id", "=", def.id)
    .orderBy("version_no", "desc")
    .executeTakeFirst();
  if (previous && previous.status === "active") {
    const superseded = await tx
      .updateTable("kpi_rag_threshold")
      .set({
        status: "superseded",
        superseded_at: sql<Date>`now()`,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", previous.id)
      .where("version", "=", previous.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "kpi_rag_threshold.supersede",
      recordType: "kpi_rag_threshold",
      recordId: previous.id,
      organizationId: ctx.organizationId,
      transformationId,
      priorVersion: previous.version,
      newVersion: superseded.version,
      changes: diffFields(previous, superseded, [...KPI_RAG_THRESHOLD_AUDIT_FIELDS]),
    });
  }
  const row = await tx
    .insertInto("kpi_rag_threshold")
    .values({
      id: uuidv7(),
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      kpi_definition_id: def.id,
      version_no: (previous?.version_no ?? 0) + 1,
      tolerance_mode: body.toleranceMode,
      amber_threshold: body.amberThreshold,
      red_threshold: body.redThreshold,
      reason: body.reason,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "kpi_rag_threshold.create",
    recordType: "kpi_rag_threshold",
    recordId: row.id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: row.version,
    reason: body.reason,
    changes: diffFields({} as KpiRagThresholdRow, row, [...KPI_RAG_THRESHOLD_AUDIT_FIELDS]),
  });
  await enqueueKpiEvent(tx, {
    organizationId: ctx.organizationId,
    aggregateType: "kpi_rag_threshold",
    aggregateId: row.id,
    eventType: "kpi.threshold_changed",
    schemaVersion: 1,
    payload: {
      kpiRagThresholdId: row.id,
      kpiDefinitionId: def.id,
      transformationId,
      versionNo: row.version_no,
      occurredAt: iso(row.created_at),
    },
    idempotencyKey: `kpi.threshold_changed:${row.id}:${row.version_no}`,
  });
  return row;
}

/** The threshold version in force for a KPI, or undefined (the KBE-A defaults 0.05 / 0.10 then apply). */
export function activeThreshold(db: DbOrTx, kpiDefinitionId: string): Promise<KpiRagThresholdRow | undefined> {
  return db
    .selectFrom("kpi_rag_threshold")
    .selectAll()
    .where("kpi_definition_id", "=", kpiDefinitionId)
    .where("status", "=", "active")
    .executeTakeFirst();
}

export function registerRagThresholdRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  app.get(THRESHOLDS, { config: { access: { permission: "transformation.read" } } }, async (request) => {
    const { transformationId, kpiDefinitionId } = parse(params, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const def = await db
      .selectFrom("kpi_definition")
      .select("id")
      .where("transformation_id", "=", transformationId)
      .where("id", "=", kpiDefinitionId)
      .executeTakeFirst();
    if (!def) throw problems.notFound();
    const hash = filterHash({ list: "kpi-rag-thresholds", transformationId, kpiDefinitionId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("kpi_rag_threshold").selectAll().where("kpi_definition_id", "=", kpiDefinitionId);
    if (after) q = q.where("version_no", "<", Number.parseInt(String(after[0]), 10));
    const rows = await q
      .orderBy("version_no", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.version_no], hash);
    return { items: page.items.map(toKpiRagThreshold), nextCursor: page.nextCursor };
  });

  app.post(
    THRESHOLDS,
    { config: { access: { permission: PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, kpiDefinitionId } = parse(params, request.params, "params");
      const result = await db.transaction().execute(async (tx: Tx) => {
        const ctx = await openWrite(tx, request, transformationId, [{ permission: PERMISSION }], null, {
          atCommit: true,
        });
        const body = parseBody(kpiRagThresholdCreate, request.body);
        return maybeIdempotent(tx, request, ctx.userId, request.body, async () => ({
          status: 201,
          body: toKpiRagThreshold(await createThreshold(ctx, kpiDefinitionId, body)),
        }));
      });
      return sendCreated(request, reply, result);
    },
  );

  return [`GET ${THRESHOLDS}`, `POST ${THRESHOLDS}`];
}
