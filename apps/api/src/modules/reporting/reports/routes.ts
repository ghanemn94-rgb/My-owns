// Report definitions, live reports and report snapshots (OpenAPI tags "reports" and "report-snapshots"; ADR-0045 §1-§5,
// §9-§12; REQ-S13-004, REQ-S13-007, REQ-S13-008, REQ-S13-010; p5-work-split §F.1; T-DG5-KBE-C):
//   GET  /report-definitions                                              listReportDefinitions      (authenticated)
//   GET  /transformations/{id}/reports/{definitionCode}/live              getLiveReport              (transformation.read)
//   POST /transformations/{id}/reports/{definitionCode}/generate          generateReportSnapshot     (report.generate)
//   GET  /transformations/{id}/report-snapshots                           listReportSnapshots        (transformation.read)
//   GET  /transformations/{id}/report-snapshots/{snapshotId}              getReportSnapshot          (transformation.read)
//   GET  …/report-snapshots/{snapshotId}/sources                          listReportSnapshotSources  (transformation.read)
//   GET  …/report-snapshots/{snapshotId}/versions                         listReportSnapshotVersions (transformation.read)
//   GET  …/report-snapshots/{snapshotId}/evidence                         listReportSnapshotEvidence (transformation.read)
//   POST …/report-snapshots/{snapshotId}/issue                            issueReportSnapshot        (report.issue)
//   POST …/report-snapshots/{snapshotId}/discard                          discardReportSnapshot      (report.issue)
//   POST …/report-snapshots/{snapshotId}/reissue                          reissueReportSnapshot      (report.issue)
//
// Every write: authorization re-checked at commit time, Zod validation, If-Match on issue/discard/reissue (428
// missing, 409 stale; generate is a create, version 1), one audit event per row written in the same transaction, no
// remote I/O inside it (snapshots.ts). Every body is application/json (`config.consumes`, shared rule 3). AUD reads
// through transformation.read and holds none of the report codes: 403 on every write. KBE-D extends this file
// (p5-work-split §F.3) only through its own assembler line in assembler.ts.
import {
  reportDefinitionCode,
  reportGenerate,
  reportSnapshotIssue,
  reportSnapshotReason,
  REPORT_MAX_PARAMETER_BYTES,
  REPORT_SNAPSHOT_STATUSES,
  type ReportSnapshotEvidenceItem,
  type ReportSnapshotSource,
  type ReportSnapshotVersion,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../../access/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
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
  keysetPage,
  pageQueryFields,
  type SortKey,
} from "../../platform/index.ts";
import { listReportDefinitions, reportRefusals } from "./definitions.ts";
import {
  assembleReport,
  discardSnapshot,
  generateSnapshot,
  issueSnapshot,
  reissueSnapshot,
  requireReportPermission,
  toReportSnapshot,
  toReportSnapshotSummary,
} from "./snapshots.ts";

const JSON_BODY = ["application/json"] as const;
const DEFINITIONS = "/api/v1/report-definitions";
const REPORTS = "/api/v1/transformations/:transformationId/reports/:definitionCode";
const SNAPSHOTS = "/api/v1/transformations/:transformationId/report-snapshots";
const ONE = `${SNAPSHOTS}/:snapshotId`;

const reportParams = z.strictObject({ transformationId: z.uuid(), definitionCode: reportDefinitionCode });
const tParams = z.strictObject({ transformationId: z.uuid() });
const sParams = z.strictObject({ transformationId: z.uuid(), snapshotId: z.uuid() });
const versionListQuery = z.strictObject({ ...pageQueryFields });
/** The pinned versions' page sort (T-DG6-BE-V): kind, reference key (unique per snapshot), then id. */
const SNAPSHOT_VERSION_SORT: readonly SortKey[] = [
  { name: "version_kind", type: "text" },
  { name: "reference_key", type: "text" },
  { name: "id", type: "uuid" },
];
const liveQuery = z.strictObject({
  subjectId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
  parameters: z.string().max(REPORT_MAX_PARAMETER_BYTES).optional(),
});
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  definitionCode: reportDefinitionCode.optional(),
  status: z.enum(REPORT_SNAPSHOT_STATUSES).optional(),
});
const pageQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });

/** The `parameters` query value of a live report: a JSON object (else 422 report.parameters_invalid). */
function parseParametersQuery(text: string | undefined): unknown {
  if (text === undefined) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw reportRefusals.parametersInvalid();
  }
}

/** If-Match (428 missing) then the issue body; called after the authorization check. */
function readIssueInput(request: FastifyRequest): { expected: number; text: string | null } {
  const expected = requireIfMatch(request);
  return { expected, text: parseBody(reportSnapshotIssue, request.body).note ?? null };
}

/** If-Match (428 missing) then the reason body; called after the authorization check. */
function readReasonInput(request: FastifyRequest): { expected: number; text: string } {
  const expected = requireIfMatch(request);
  return { expected, text: parseBody(reportSnapshotReason, request.body).reason };
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerReportRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const authenticated = { access: { permission: "authenticated" as const } };
  const read = { access: { permission: "transformation.read" as const } };
  const generate = { access: { permission: "report.generate" as const }, consumes: JSON_BODY };
  const issue = { access: { permission: "report.issue" as const }, consumes: JSON_BODY };

  app.get(DEFINITIONS, { config: authenticated }, async (request) => {
    parseQuery(z.strictObject({}), request.query);
    principalOf(request);
    return { items: await listReportDefinitions(db) };
  });

  app.get(`${REPORTS}/live`, { config: read }, async (request) => {
    const { transformationId, definitionCode } = parse(reportParams, request.params, "params");
    const query = parseQuery(liveQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const a = await assembleReport(db, {
      definitionCode,
      transformationId,
      subjectId: query.subjectId,
      reportingPeriodId: query.reportingPeriodId,
      parameters: parseParametersQuery(query.parameters),
    });
    return { snapshotId: null, document: a.document };
  });

  app.post(`${REPORTS}/generate`, { config: generate }, async (request, reply) => {
    const { transformationId, definitionCode } = parse(reportParams, request.params, "params");
    // Authorization before validation (an AUD caller gets 403 whatever it sends); re-checked at commit time.
    await requireReportPermission(db, principalOf(request), transformationId, "report.generate");
    const body = parseBody(reportGenerate, request.body);
    const row = await generateSnapshot(db, request, {
      definitionCode,
      transformationId,
      subjectId: body.subjectId,
      reportingPeriodId: body.reportingPeriodId,
      parameters: body.parameters ?? {},
    });
    return sendVersioned(
      reply,
      201,
      toReportSnapshot(row),
      `/api/v1/transformations/${transformationId}/report-snapshots/${row.id}`,
    );
  });

  app.get(SNAPSHOTS, { config: read }, async (request) => {
    const { transformationId } = parse(tParams, request.params, "params");
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "report_snapshot",
      transformationId,
      definitionCode: query.definitionCode ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 1);
    // Newest first: ids are UUIDv7 (time-ordered).
    let q = db.selectFrom("report_snapshot").selectAll().where("transformation_id", "=", transformationId);
    if (query.definitionCode !== undefined) q = q.where("definition_code", "=", query.definitionCode);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return { items: page.items.map(toReportSnapshotSummary), nextCursor: page.nextCursor };
  });

  /** The snapshot of a readable transformation, or 404. */
  const snapshotOf = async (transformationId: string, snapshotId: string) => {
    const row = await db
      .selectFrom("report_snapshot")
      .selectAll()
      .where("id", "=", snapshotId)
      .where("transformation_id", "=", transformationId)
      .executeTakeFirst();
    if (row === undefined) throw problems.notFound();
    return row;
  };

  app.get(ONE, { config: read }, async (request, reply) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    parseQuery(z.strictObject({}), request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    return sendVersioned(reply, 200, toReportSnapshot(await snapshotOf(transformationId, snapshotId)));
  });

  app.get(`${ONE}/sources`, { config: read }, async (request) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await snapshotOf(transformationId, snapshotId);
    const hash = filterHash({ table: "report_snapshot_source", snapshotId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("report_snapshot_source").selectAll().where("snapshot_id", "=", snapshotId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return {
      items: page.items.map(
        (r): ReportSnapshotSource => ({
          id: r.id,
          sectionKey: r.section_key,
          recordType: r.record_type,
          recordId: r.record_id,
          recordVersion: r.record_version,
          recordUpdatedAt: isoOrNull(r.record_updated_at),
          approvalState: r.approval_state as ReportSnapshotSource["approvalState"],
          validationState: r.validation_state as ReportSnapshotSource["validationState"],
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });

  app.get(`${ONE}/versions`, { config: read }, async (request) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    const query = parseQuery(versionListQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await snapshotOf(transformationId, snapshotId);
    const q = db.selectFrom("report_snapshot_version").selectAll().where("snapshot_id", "=", snapshotId);
    const page = await keysetPage(q, SNAPSHOT_VERSION_SORT, query, { list: "report-snapshot-versions", snapshotId });
    return {
      nextCursor: page.nextCursor,
      items: page.items.map(
        (r): ReportSnapshotVersion => ({
          versionKind: r.version_kind as ReportSnapshotVersion["versionKind"],
          referenceId: r.reference_id,
          referenceKey: r.reference_key,
          versionLabel: r.version_label,
        }),
      ),
    };
  });

  app.get(`${ONE}/evidence`, { config: read }, async (request) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    const query = parseQuery(pageQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    await snapshotOf(transformationId, snapshotId);
    const hash = filterHash({ table: "report_snapshot_evidence", snapshotId });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = db.selectFrom("report_snapshot_evidence").selectAll().where("snapshot_id", "=", snapshotId);
    if (after) q = q.where("id", ">", String(after[0]));
    const rows = await q
      .orderBy("id")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    return {
      items: page.items.map(
        (r): ReportSnapshotEvidenceItem => ({
          sectionKey: r.section_key,
          evidenceId: r.evidence_id,
          contentId: r.content_id,
          contentRevision: r.content_revision,
          contentSha256: r.content_sha256 === null ? null : r.content_sha256.trim(),
          reviewStatus: r.review_status as ReportSnapshotEvidenceItem["reviewStatus"],
        }),
      ),
      nextCursor: page.nextCursor,
    };
  });

  app.post(`${ONE}/issue`, { config: issue }, async (request, reply) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    // Authorization (at commit time, inside the transaction), then If-Match, then the body (snapshots.ts).
    const row = await db
      .transaction()
      .execute((tx) => issueSnapshot(tx, request, transformationId, snapshotId, () => readIssueInput(request)));
    return sendVersioned(reply, 200, toReportSnapshot(row));
  });

  app.post(`${ONE}/discard`, { config: issue }, async (request, reply) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    const row = await db
      .transaction()
      .execute((tx) => discardSnapshot(tx, request, transformationId, snapshotId, () => readReasonInput(request)));
    return sendVersioned(reply, 200, toReportSnapshot(row));
  });

  app.post(`${ONE}/reissue`, { config: issue }, async (request, reply) => {
    const { transformationId, snapshotId } = parse(sParams, request.params, "params");
    const row = await reissueSnapshot(db, request, transformationId, snapshotId, () => readReasonInput(request));
    return sendVersioned(
      reply,
      201,
      toReportSnapshot(row),
      `/api/v1/transformations/${transformationId}/report-snapshots/${row.id}`,
    );
  });

  return [
    `GET ${DEFINITIONS}`,
    `GET ${REPORTS}/live`,
    `POST ${REPORTS}/generate`,
    `GET ${SNAPSHOTS}`,
    `GET ${ONE}`,
    `GET ${ONE}/sources`,
    `GET ${ONE}/versions`,
    `GET ${ONE}/evidence`,
    `POST ${ONE}/issue`,
    `POST ${ONE}/discard`,
    `POST ${ONE}/reissue`,
  ];
}
