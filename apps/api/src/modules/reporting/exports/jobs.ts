// Export jobs (ADR-0046 §2, §5, §6, §8; REQ-S13-005, REQ-S13-006; p5-work-split §F.5; T-DG5-BE-M): create with
// idempotency, list, read, download with the access re-check, cancel. The API never renders: it validates the request,
// writes the job (queued), its progress row, the audit event and the `export_job.requested` outbox event in ONE
// transaction, and the worker (apps/worker/src/reports/export-runner.ts) renders after that COMMIT.
//
// Authorization ("export authorization equal to record views", ADR-0046 §5-§6):
//   - create: `export.create` in the snapshot's transformation (and `report.generate` for a live selection, which
//     generates its snapshot first); a caller who cannot see the transformation gets 404, one who can but lacks the
//     code (AUD) 403. A caller who holds `export.create` nowhere (AUD) gets 403 before the body is read. Re-checked at
//     commit time inside the write transaction (grants reloaded).
//   - list, read, download, cancel: only the requester, and only while the requester can still read the
//     transformation (re-checked on every call); anyone else, and a requester who lost `transformation.read`, gets 404.
// Exactly once: the request key `(requested_by, idempotency_key)` is UNIQUE (`export_job_idempotency_key`); the same
// key returns the existing job with 200 (ON CONFLICT DO NOTHING closes the race), a different request with the same key
// is 422 `idempotency.key_reused` (ADR-0007 §6). Without the header a server key is used, so every request is new.
// Cancel takes the job's lock (class `exportJob`, the worker's lock) and `If-Match`. No remote I/O in a transaction.
// An export approves nothing; product gates G1-G6 are business approvals and nothing here touches DG0-DG7.
import type { Db, DbOrTx, ExportJobProgressRow, ExportJobRow, Tx } from "@mth/db";
import { PROBLEM_TYPES } from "@mth/shared";
import {
  EXPORT_ERROR_CODES,
  EXPORT_STAGES,
  EXPORT_STATUSES,
  exportCreate,
  exportJob,
  exportJobPage,
  exportLiveSelection,
  outboxPayloadSchema,
  type ExportCreate,
  type ExportJob,
  type ReportSubjectType,
} from "@mth/shared/schemas";
import type { FastifyRequest } from "fastify";
import { sql } from "kysely";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import {
  auditContextOf,
  authorize,
  commitTimeDenial,
  holdsAnywhere,
  principalOf,
  refreshPrincipal,
  type Principal,
} from "../../access/index.ts";
import { record } from "../../audit/index.ts";
import { restrictionOf } from "../../benefits/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  cursorSchema,
  decodeCursor,
  filterHash,
  HttpProblem,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  problems,
} from "../../platform/index.ts";
import { generateSnapshot, requireReportPermission } from "../reports/snapshots.ts";

export const EXPORT_REQUESTED_EVENT = "export_job.requested";
// The closed sets, ExportCreate and the ExportJob mirrors live in @mth/shared/schemas (export-jobs.ts; promoted by
// T-DG5-FE-E, D-155 d) so the API, the contract exercise and the web share one definition; re-exported here unchanged.
export {
  EXPORT_ERROR_CODES,
  EXPORT_STAGES,
  EXPORT_STATUSES,
  exportCreate,
  exportJob,
  exportJobPage,
  exportLiveSelection,
};
export type { ExportCreate, ExportJob };

// ------------------------------------------------------------------------------------------------ schemas (zod mirrors)

const idempotencyKey = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);

export const exportListQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  status: z.enum(EXPORT_STATUSES).optional(),
});

// ------------------------------------------------------------------------------------------------ refusals (ADR-0046 §8)

export const exportRefusals = {
  formatNotOffered: () =>
    problems.businessRule("export.format_not_offered", "This output cannot be exported in that format."),
  snapshotDiscarded: () =>
    problems.businessRule("export.snapshot_discarded", "A discarded snapshot cannot be exported."),
  notCancellable: () =>
    problems.businessRule("export.not_cancellable", "Only a queued or running export can be cancelled."),
  notReady: () =>
    new HttpProblem({
      status: 409,
      type: PROBLEM_TYPES.versionConflict,
      code: "export.not_ready",
      title: "Export not ready",
      detail: "The export is not finished yet; check its progress.",
    }),
  failed: () => problems.businessRule("export.failed", "This export failed; start a new export."),
  keyReused: () =>
    problems.businessRule("idempotency.key_reused", "This Idempotency-Key was already used for a different request."),
  subjectInvalid: () =>
    problems.businessRule(
      "report.subject_invalid",
      "The subject must be a record of this transformation of the type this output reports on.",
    ),
};

// ------------------------------------------------------------------------------------------------ rows

type JobRow = ExportJobRow;
type ProgressRow = ExportJobProgressRow;

const num = (v: number | string | bigint | null): number | null => (v === null ? null : Number(v));

export function toExportJob(j: JobRow, p: ProgressRow | undefined): ExportJob {
  return {
    id: j.id,
    transformationId: j.transformation_id,
    snapshotId: j.snapshot_id,
    format: j.format as ExportJob["format"],
    language: j.language as ExportJob["language"],
    status: j.status as ExportJob["status"],
    stage: (p?.stage ?? "queued") as ExportJob["stage"],
    percent: p?.percent ?? 0,
    sectionsDone: p?.sections_done ?? 0,
    sectionsTotal: p?.sections_total ?? null,
    attemptCount: j.attempt_count,
    startedAt: isoOrNull(j.started_at),
    finishedAt: isoOrNull(j.finished_at),
    fileName: j.file_name,
    contentType: j.content_type,
    fileSha256: j.file_sha256 === null ? null : j.file_sha256.trim(),
    fileSizeBytes: num(j.file_size_bytes),
    errorCode: j.error_code as ExportJob["errorCode"],
    cancelledAt: isoOrNull(j.cancelled_at),
    version: j.version,
    createdAt: iso(j.created_at),
  };
}

async function progressOf(db: DbOrTx, jobId: string): Promise<ProgressRow | undefined> {
  return db.selectFrom("export_job_progress").selectAll().where("export_job_id", "=", jobId).executeTakeFirst();
}

/**
 * A job row and its progress row are read in one snapshot. The worker's START commits `queued -> running` and then
 * advances the progress row, so two separate reads could pair a job that is still `queued` with the progress of an
 * attempt that has already started (D-155).
 */
function snapshotRead<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction().setIsolationLevel("repeatable read").setAccessMode("read only").execute(fn);
}

// ------------------------------------------------------------------------------------------------ access

/** The signed-in user (a service principal has no export). */
function requesterOf(principal: Principal): string {
  if (principal.userId === null) throw problems.forbidden();
  return principal.userId;
}

/** True when the principal can still read the transformation (counts as a policy decision). */
async function canRead(db: DbOrTx, principal: Principal, transformationId: string): Promise<boolean> {
  return (await authorize(db, principal, "transformation.read", { type: "transformation", id: transformationId }))
    .allowed;
}

/** The requester's own job that the requester can still read; anything else is 404 (ADR-0046 §5). */
async function ownJob(db: DbOrTx, principal: Principal, jobId: string, lock = false): Promise<JobRow> {
  const userId = requesterOf(principal);
  let q = db.selectFrom("export_job").selectAll().where("id", "=", jobId).where("requested_by", "=", userId);
  if (lock) q = q.forUpdate();
  const row = await q.executeTakeFirst();
  if (row === undefined) throw problems.notFound();
  if (!(await canRead(db, principal, row.transformation_id))) throw problems.notFound();
  return row;
}

// ------------------------------------------------------------------------------------------------ export selection (P6)

/**
 * The export selection's sensitivity boundary (T-DG6-BE-B2; ADR-0051 §1, §2; REQ-S10-002, REQ-S10-004): the
 * requester's ReadScope applied to the records the snapshot was assembled from (`report_snapshot_source`). The worker
 * renders the snapshot's stored content unchanged (never re-assembled, ADR-0046 §2), so a snapshot that includes a
 * sensitive benefit, business case or evidence item the requester is not admitted to (or a business-case line or a
 * benefit measurement of one) is never exported for that requester: 403, at the request, again at commit time and
 * again at download. A snapshot with no sensitive source exports exactly as in DG5.
 */
export async function includesRestrictedSources(
  db: DbOrTx,
  principal: Principal,
  snapshotId: string,
): Promise<boolean> {
  const sources = await db
    .selectFrom("report_snapshot_source")
    .select(["record_type", "record_id"])
    .where("snapshot_id", "=", snapshotId)
    .where("record_type", "in", ["benefit", "business_case", "evidence", "business_case_line", "benefit_measurement"])
    .execute();
  if (sources.length === 0) return false;
  const idsOf = (type: string) => [...new Set(sources.filter((r) => r.record_type === type).map((r) => r.record_id))];
  const lineIds = idsOf("business_case_line");
  const measurementIds = idsOf("benefit_measurement");
  const lineCases =
    lineIds.length === 0
      ? []
      : await db.selectFrom("business_case_line").select("business_case_id").where("id", "in", lineIds).execute();
  const measurementBenefits =
    measurementIds.length === 0
      ? []
      : await db.selectFrom("benefit_measurement").select("benefit_id").where("id", "in", measurementIds).execute();
  const benefits = [...idsOf("benefit"), ...measurementBenefits.map((m) => m.benefit_id)];
  const cases = [...idsOf("business_case"), ...lineCases.map((l) => l.business_case_id)];
  for (const [type, ids] of [
    ["benefit", benefits],
    ["business_case", cases],
    ["evidence", idsOf("evidence")],
  ] as const) {
    if ((await restrictionOf(db, principal, type, ids)).restricted.size > 0) return true;
  }
  return false;
}

/**
 * The export's own refusal code (D-199, T-DG6-BE-F2), replacing the generic `forbidden`: 403
 * `export.includes_restricted_records` with the D-199 English text (Arabic in the web catalogue, provisional).
 */
export const includesRestrictedRecordsRefusal = () =>
  new HttpProblem({
    status: 403,
    type: PROBLEM_TYPES.forbidden,
    code: "export.includes_restricted_records",
    title: "Forbidden",
    detail: "This report includes records you cannot see, so it cannot be exported for you.",
  });

/** 403 when the snapshot includes a record the requester is not admitted to (see includesRestrictedSources). */
async function requireUnrestrictedSelection(db: DbOrTx, principal: Principal, snapshotId: string): Promise<void> {
  if (await includesRestrictedSources(db, principal, snapshotId)) throw includesRestrictedRecordsRefusal();
}

// ------------------------------------------------------------------------------------------------ create

/**
 * The `export_job.requested` outbox row, in the creating transaction (the relay sends it to `reports.export` after
 * COMMIT; ADR-0008). Written directly, as reports/snapshots.ts does: the reporting module does not depend on jobs.
 */
async function enqueueExportRequested(tx: Tx, organizationId: string, exportJobId: string): Promise<void> {
  const schema = outboxPayloadSchema(EXPORT_REQUESTED_EVENT, 1);
  if (schema === null) throw new Error(`outbox: no schema for ${EXPORT_REQUESTED_EVENT} v1`);
  const payload = schema.parse({ exportJobId }) as Record<string, unknown>;
  await tx
    .insertInto("outbox_event")
    .values({
      id: uuidv7(),
      organization_id: organizationId,
      aggregate_type: "export_job",
      aggregate_id: exportJobId,
      event_type: EXPORT_REQUESTED_EVENT,
      schema_version: 1,
      payload: JSON.stringify(payload),
      idempotency_key: `${EXPORT_REQUESTED_EVENT}:${exportJobId}`,
    })
    .execute();
}

const SUBJECT_TABLES = new Map<ReportSubjectType, "meeting" | "gate_instance" | "business_case" | "bau_handover">([
  ["meeting", "meeting"],
  ["gate_instance", "gate_instance"],
  ["business_case", "business_case"],
  ["bau_handover", "bau_handover"],
]);

/** The definition's formats and subject type (404 for an unknown code cannot happen: the body enum is closed). */
async function definitionOf(db: DbOrTx, code: string) {
  return db
    .selectFrom("report_definition")
    .select(["code", "formats", "subject_type"])
    .where("code", "=", code)
    .executeTakeFirstOrThrow();
}

/**
 * The transformation of a live selection, from its subject (the request names no transformation; ExportLiveSelection
 * has none): the subject is required, and for a transformation-level output it IS the transformation.
 */
async function liveTransformationId(db: DbOrTx, sel: z.infer<typeof exportLiveSelection>): Promise<string> {
  const def = await definitionOf(db, sel.definitionCode);
  if (sel.subjectId === undefined) throw exportRefusals.subjectInvalid();
  if (def.subject_type === "transformation") return sel.subjectId;
  const table = SUBJECT_TABLES.get(def.subject_type as ReportSubjectType);
  if (table === undefined) throw exportRefusals.subjectInvalid();
  const row = await db.selectFrom(table).select("transformation_id").where("id", "=", sel.subjectId).executeTakeFirst();
  // An unknown subject discloses nothing: 404, as for an unreadable transformation.
  if (row === undefined) throw problems.notFound();
  return row.transformation_id;
}

/** True when an existing job answers the same request (ADR-0007 §6: same key and request -> the original job). */
async function sameRequest(db: DbOrTx, j: JobRow, body: ExportCreate): Promise<boolean> {
  if (j.format !== body.format || j.language !== body.language) return false;
  if (body.snapshotId !== undefined) return j.snapshot_id === body.snapshotId;
  const s = await db
    .selectFrom("report_snapshot")
    .select(["definition_code", "subject_id", "reporting_period_id"])
    .where("id", "=", j.snapshot_id)
    .executeTakeFirstOrThrow();
  const sel = body.report!;
  return (
    s.definition_code === sel.definitionCode &&
    (sel.subjectId === undefined || s.subject_id === sel.subjectId) &&
    (s.reporting_period_id ?? undefined) === sel.reportingPeriodId
  );
}

/** The existing job of a repeated key: 200 with it when the request matches and the requester can read it. */
async function replay(db: DbOrTx, principal: Principal, j: JobRow, body: ExportCreate) {
  if (!(await canRead(db, principal, j.transformation_id))) throw problems.notFound();
  if (!(await sameRequest(db, j, body))) throw exportRefusals.keyReused();
  return { status: 200 as const, job: toExportJob(j, await progressOf(db, j.id)) };
}

export interface CreateResult {
  readonly status: 200 | 202;
  readonly job: ExportJob;
}

/** The snapshot to export, after the request-start checks (visibility, permission, discarded, format). */
async function exportableSnapshot(db: Db, principal: Principal, snapshotId: string, format: string) {
  const s = await db
    .selectFrom("report_snapshot")
    .select(["id", "transformation_id", "organization_id", "definition_code", "status"])
    .where("id", "=", snapshotId)
    .executeTakeFirst();
  if (s === undefined) throw problems.notFound();
  await requireReportPermission(db, principal, s.transformation_id, "export.create");
  if (s.status === "discarded") throw exportRefusals.snapshotDiscarded();
  const def = await definitionOf(db, s.definition_code);
  if (!def.formats.includes(format)) throw exportRefusals.formatNotOffered();
  return s;
}

/** POST /exports (createExport). */
export async function createExport(
  db: Db,
  request: FastifyRequest,
  readBody: () => ExportCreate,
  headerKey: string | undefined,
): Promise<CreateResult> {
  const principal = principalOf(request);
  const userId = requesterOf(principal);
  // AUD and the technical administrators hold export.create nowhere: 403 whatever they send (ADR-0046 §6).
  if (!holdsAnywhere(principal, "export.create")) throw problems.forbidden();
  const body = readBody();
  let key: string;
  if (headerKey === undefined) key = `srv-${uuidv7()}`;
  else {
    const parsed = idempotencyKey.safeParse(headerKey);
    if (!parsed.success)
      throw problems.badRequest(
        "validation.idempotency_key",
        "Idempotency-Key must be 8-128 characters of A-Z, a-z, 0-9, _ or -.",
        "/header/Idempotency-Key",
      );
    key = parsed.data;
    const existing = await db
      .selectFrom("export_job")
      .selectAll()
      .where("requested_by", "=", userId)
      .where("idempotency_key", "=", key)
      .executeTakeFirst();
    if (existing !== undefined) return replay(db, principal, existing, body);
  }

  // The snapshot: an existing one, or a live selection generated first (its own audited transaction, ADR-0045 §2).
  let snapshotId: string;
  let transformationId: string;
  if (body.snapshotId !== undefined) {
    const s = await exportableSnapshot(db, principal, body.snapshotId, body.format);
    snapshotId = s.id;
    transformationId = s.transformation_id;
  } else {
    const sel = body.report!;
    transformationId = await liveTransformationId(db, sel);
    await requireReportPermission(db, principal, transformationId, "export.create");
    await requireReportPermission(db, principal, transformationId, "report.generate");
    const def = await definitionOf(db, sel.definitionCode);
    if (!def.formats.includes(body.format)) throw exportRefusals.formatNotOffered();
    const generated = await generateSnapshot(db, request, {
      definitionCode: sel.definitionCode,
      transformationId,
      subjectId: sel.subjectId,
      reportingPeriodId: sel.reportingPeriodId,
      parameters: sel.parameters ?? {},
    });
    snapshotId = generated.id;
  }
  await requireUnrestrictedSelection(db, principal, snapshotId);

  return db.transaction().execute(async (tx) => {
    // Commit-time re-authorization: the grants are reloaded inside the write transaction (shared rule 4).
    const fresh = await refreshPrincipal(tx, request);
    try {
      await requireReportPermission(tx, fresh, transformationId, "export.create");
      if (body.report !== undefined) await requireReportPermission(tx, fresh, transformationId, "report.generate");
      await requireUnrestrictedSelection(tx, fresh, snapshotId);
    } catch (err) {
      throw commitTimeDenial(err);
    }
    const s = await tx
      .selectFrom("report_snapshot")
      .select(["organization_id", "status"])
      .where("id", "=", snapshotId)
      .forShare()
      .executeTakeFirstOrThrow();
    if (s.status === "discarded") throw exportRefusals.snapshotDiscarded();
    const id = uuidv7();
    const inserted = await tx
      .insertInto("export_job")
      .values({
        id,
        organization_id: s.organization_id,
        transformation_id: transformationId,
        snapshot_id: snapshotId,
        requested_by: userId,
        format: body.format,
        language: body.language,
        idempotency_key: key,
        created_by: userId,
        updated_by: userId,
      })
      .onConflict((oc) => oc.constraint("export_job_idempotency_key").doNothing())
      .returningAll()
      .executeTakeFirst();
    if (inserted === undefined) {
      // A concurrent request with the same key won the race: answer with its job.
      const winner = await tx
        .selectFrom("export_job")
        .selectAll()
        .where("requested_by", "=", userId)
        .where("idempotency_key", "=", key)
        .executeTakeFirstOrThrow();
      return replay(tx, fresh, winner, body);
    }
    await tx
      .insertInto("export_job_progress")
      .values({ export_job_id: id, organization_id: s.organization_id })
      .execute();
    await record(tx, auditContextOf(request), {
      action: "export_job.create",
      recordType: "export_job",
      recordId: id,
      organizationId: s.organization_id,
      transformationId,
      newVersion: 1,
      changes: {
        snapshot_id: { from: null, to: snapshotId },
        format: { from: null, to: body.format },
        language: { from: null, to: body.language },
        status: { from: null, to: "queued" },
      },
    });
    await enqueueExportRequested(tx, s.organization_id, id);
    return { status: 202 as const, job: toExportJob(inserted, await progressOf(tx, id)) };
  });
}

// ------------------------------------------------------------------------------------------------ reads

/** GET /exports: the caller's own jobs, newest first, only those whose transformation the caller can still read. */
export async function listExports(
  db: Db,
  request: FastifyRequest,
  query: z.infer<typeof exportListQuery>,
): Promise<{ items: ExportJob[]; nextCursor: string | null }> {
  return snapshotRead(db, async (tx) => {
    const principal = principalOf(request);
    const userId = requesterOf(principal);
    holdsAnywhere(principal, "transformation.read");
    const hash = filterHash({ table: "export_job", requestedBy: userId, status: query.status ?? null });
    const after = decodeCursor(query.cursor, hash, 1);
    let q = tx.selectFrom("export_job").selectAll().where("requested_by", "=", userId);
    if (query.status !== undefined) q = q.where("status", "=", query.status);
    if (after) q = q.where("id", "<", String(after[0]));
    const rows = await q
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.id], hash);
    const readable = new Map<string, boolean>();
    for (const t of new Set(page.items.map((r) => r.transformation_id)))
      readable.set(t, await canRead(tx, principal, t));
    const visible = page.items.filter((r) => readable.get(r.transformation_id) === true);
    const progress =
      visible.length === 0
        ? []
        : await tx
            .selectFrom("export_job_progress")
            .selectAll()
            .where(
              "export_job_id",
              "in",
              visible.map((r) => r.id),
            )
            .execute();
    const byId = new Map(progress.map((p) => [p.export_job_id, p]));
    return { items: visible.map((r) => toExportJob(r, byId.get(r.id))), nextCursor: page.nextCursor };
  });
}

/** GET /exports/{id}. */
export async function getExport(db: Db, request: FastifyRequest, jobId: string): Promise<ExportJob> {
  return snapshotRead(db, async (tx) => {
    const row = await ownJob(tx, principalOf(request), jobId);
    return toExportJob(row, await progressOf(tx, row.id));
  });
}

/** GET /exports/{id}/download: the stored file's metadata, after the access re-check and the state checks. */
export async function downloadableExport(db: Db, request: FastifyRequest, jobId: string) {
  const principal = principalOf(request);
  const row = await ownJob(db, principal, jobId);
  // P6 (T-DG6-BE-B2): a grant revoked or a record marked since the request still keeps the file from this requester.
  await requireUnrestrictedSelection(db, principal, row.snapshot_id);
  if (row.status === "failed") throw exportRefusals.failed();
  if (row.status !== "succeeded" || row.storage_key === null) throw exportRefusals.notReady();
  return {
    storageKey: row.storage_key,
    fileName: row.file_name!,
    contentType: row.content_type!,
    sha256: row.file_sha256!.trim(),
    size: Number(row.file_size_bytes),
  };
}

// ------------------------------------------------------------------------------------------------ cancel

/** Lock class `exportJob` (ADVISORY_LOCK_CLASSES) on the job id: the worker holds it for each of its transitions. */
export async function lockExportJob(tx: Tx, jobId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.exportJob}::int4, hashtext(${jobId}::text))`.execute(
    tx,
  );
}

/** POST /exports/{id}/cancel: queued/running -> cancelled (requester; If-Match). */
export async function cancelExport(
  tx: Tx,
  request: FastifyRequest,
  jobId: string,
  readIfMatch: () => number,
): Promise<ExportJob> {
  const start = principalOf(request);
  if (!holdsAnywhere(start, "export.create")) throw problems.forbidden();
  const principal = await refreshPrincipal(tx, request);
  await lockExportJob(tx, jobId);
  let row: JobRow;
  try {
    row = await ownJob(tx, principal, jobId, true);
  } catch (err) {
    throw commitTimeDenial(err);
  }
  const expected = readIfMatch();
  if (expected !== row.version) throw problems.versionConflict(row.version);
  if (row.status !== "queued" && row.status !== "running") throw exportRefusals.notCancellable();
  const userId = requesterOf(principal);
  const updated = await tx
    .updateTable("export_job")
    .set({
      status: "cancelled",
      cancelled_at: sql<Date>`now()`,
      cancelled_by: userId,
      finished_at: sql<Date>`now()`,
      version: row.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", row.id)
    .where("version", "=", row.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "export_job.cancel",
    recordType: "export_job",
    recordId: row.id,
    organizationId: row.organization_id,
    transformationId: row.transformation_id,
    priorVersion: row.version,
    newVersion: updated.version,
    changes: { status: { from: row.status, to: "cancelled" } },
  });
  return toExportJob(updated, await progressOf(tx, row.id));
}
