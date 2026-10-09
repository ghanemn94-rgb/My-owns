// Data-quality findings (ADR-0027 §9, §13; REQ-S16-014; T-DG4-KBE-B):
//   GET  /transformations/{t}/data-quality-findings                       ?kpiDefinitionId&status, newest first
//   GET  /transformations/{t}/data-quality-findings/{id}
//   POST /transformations/{t}/data-quality-findings/{id}/resolve          resolve or dismiss (data_quality.manage; If-Match)
//
// Findings are created only by calculation runs (KBE-C's kpi.recalculate worker; run lineage, no audit event, at most
// one open finding per KPI, scope, period and rule). A person's resolve or dismiss is versioned and audited: open ->
// resolved | dismissed is final (422 data_quality.not_open) and needs a note (a blank note is a 400 validation.blank;
// the database refuses a missing one, mapped to 422 data_quality.note_required). Resolving a finding changes no KPI
// value: Unknown, Stale and Not computable stay what the run computed.
import { diffFields, sql, type DataQualityFindingRow } from "@mth/db";
import { dataQualityFindingListQuery, dataQualityResolution, type DataQualityFinding } from "@mth/shared/schemas";
import type { FastifyInstance } from "fastify";
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
import { openWrite } from "../transformations/index.ts";

const JSON_BODY = ["application/json"] as const;
const COLLECTION = "/api/v1/transformations/:transformationId/data-quality-findings";
const ITEM = `${COLLECTION}/:dataQualityFindingId`;
const PERMISSION = "data_quality.manage" as const;

export const DATA_QUALITY_FINDING_AUDIT_FIELDS = [
  "status",
  "resolution_note",
  "resolved_by",
  "resolved_at",
] as const satisfies readonly (keyof DataQualityFindingRow)[];

export function toDataQualityFinding(r: DataQualityFindingRow): DataQualityFinding {
  return {
    id: r.id,
    transformationId: r.transformation_id,
    kpiDefinitionId: r.kpi_definition_id,
    scopeKind: r.scope_kind as DataQualityFinding["scopeKind"],
    scopeId: r.scope_id,
    reportingPeriodId: r.reporting_period_id,
    kpiActualId: r.kpi_actual_id,
    valueNo: r.value_no,
    ruleCode: r.rule_code as DataQualityFinding["ruleCode"],
    severity: r.severity as DataQualityFinding["severity"],
    detailParams: (r.detail_params ?? {}) as Record<string, unknown>,
    detectedByRunId: r.detected_by_run_id,
    detectedAt: iso(r.detected_at),
    status: r.status as DataQualityFinding["status"],
    resolutionNote: r.resolution_note,
    resolvedBy: r.resolved_by,
    resolvedAt: isoOrNull(r.resolved_at),
    version: r.version,
    updatedAt: iso(r.updated_at),
  };
}

const collectionParams = z.strictObject({ transformationId: z.uuid() });
const itemParams = z.strictObject({ transformationId: z.uuid(), dataQualityFindingId: z.uuid() });
const listQuery = z.strictObject({ ...dataQualityFindingListQuery.shape, cursor: cursorSchema, limit: limitSchema });

export function registerDataQualityRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };

  app.get(COLLECTION, { config: read }, async (request) => {
    const { transformationId } = parse(collectionParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({ list: "data-quality-findings", transformationId, ...query });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("data_quality_finding")
      .selectAll()
      .select(sql<string>`to_char(detected_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("sort_key"))
      .where("transformation_id", "=", transformationId);
    if (query.kpiDefinitionId !== undefined) q = q.where("kpi_definition_id", "=", query.kpiDefinitionId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after)
      q = q.where(sql<boolean>`(detected_at, id) < (${String(after[0])}::timestamptz, ${String(after[1])}::uuid)`);
    const rows = await q
      .orderBy("detected_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.sort_key, r.id], hash);
    return {
      items: page.items.map(({ sort_key: _k, ...r }) => toDataQualityFinding(r as DataQualityFindingRow)),
      nextCursor: page.nextCursor,
    };
  });

  app.get(ITEM, { config: read }, async (request, reply) => {
    const { transformationId, dataQualityFindingId } = parse(itemParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const row = await db
      .selectFrom("data_quality_finding")
      .selectAll()
      .where("transformation_id", "=", transformationId)
      .where("id", "=", dataQualityFindingId)
      .executeTakeFirst();
    if (!row) throw problems.notFound();
    return sendVersioned(reply, 200, toDataQualityFinding(row));
  });

  app.post(
    `${ITEM}/resolve`,
    { config: { access: { permission: PERMISSION }, consumes: JSON_BODY } },
    async (request, reply) => {
      const { transformationId, dataQualityFindingId } = parse(itemParams, request.params, "params");
      const row = await db.transaction().execute(async (tx) => {
        const ctx = await openWrite(tx, request, transformationId, [{ permission: PERMISSION }], null, {
          atCommit: true,
        });
        const expected = requireIfMatch(request);
        const body = parseBody(dataQualityResolution, request.body);
        const current = await tx
          .selectFrom("data_quality_finding")
          .selectAll()
          .where("transformation_id", "=", transformationId)
          .where("id", "=", dataQualityFindingId)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw problems.notFound();
        if (current.version !== expected) throw problems.versionConflict(current.version);
        if (current.status !== "open")
          throw problems.businessRule("data_quality.not_open", "Only an open finding can be resolved or dismissed.");
        const updated = await tx
          .updateTable("data_quality_finding")
          .set({
            status: body.outcome,
            resolution_note: body.note,
            resolved_by: ctx.userId,
            resolved_at: sql<Date>`now()`,
            version: sql<number>`version + 1`,
            updated_at: sql<Date>`now()`,
            updated_by: ctx.userId,
          })
          .where("id", "=", current.id)
          .where("version", "=", current.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx.audit, {
          action: body.outcome === "resolved" ? "data_quality_finding.resolve" : "data_quality_finding.dismiss",
          recordType: "data_quality_finding",
          recordId: current.id,
          organizationId: ctx.organizationId,
          transformationId,
          priorVersion: current.version,
          newVersion: updated.version,
          reason: body.note,
          changes: diffFields(current, updated, [...DATA_QUALITY_FINDING_AUDIT_FIELDS]),
        });
        return updated;
      });
      return sendVersioned(reply, 200, toDataQualityFinding(row));
    },
  );

  return [`GET ${COLLECTION}`, `GET ${ITEM}`, `POST ${ITEM}/resolve`];
}
