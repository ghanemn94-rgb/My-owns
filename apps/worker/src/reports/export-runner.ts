// The export runner (ADR-0046 §2-§5, §9; REQ-S13-005, REQ-S13-006; p5-work-split §F.5; T-DG5-BE-M): consumer of the
// queue `reports.export` (the `export_job.requested` outbox event, one per job, job id = the outbox event id).
//
// One run of a job:
//   1. START, in one short transaction under lock class `exportJob` (730264, ADR-0016 §6) on the job id: a finished job
//      (succeeded, failed, cancelled) is a replay and does nothing; a job left `running` by a killed worker is put back
//      `queued` (audited `export_job.retry`) and started again; then the requester's access is re-checked (they must
//      still hold `transformation.read` and `export.create` in the transformation, else `failed` with
//      `export.source_unavailable`, never retried); otherwise `queued -> running` (attempt + 1, audited
//      `export_job.start`, actor service).
//   2. RENDER, outside any transaction: the snapshot's stored content (never re-assembled) through `@mth/reporting`,
//      progress moved forward after each section (unaudited, the job_run precedent); between sections the job's status
//      is read, and a cancelled job stops without storing a file.
//   3. STORE, outside any transaction: the export-file store (atomic write) under `exports/<org>/<job>-a<attempt>.<ext>`
//      (the attempt in the key, so a stale attempt can never overwrite the recorded file).
//   4. FINISH, in one transaction under the lock: `running -> succeeded` with the file fields, progress `done`, the
//      audit event `export_job.succeed`. A job that is no longer running (cancelled meanwhile) keeps no file.
// Failures: a renderer's own validation error (RenderError) fails the job at once with `export.render_failed`; a file
// above 200 MiB fails it with `export.too_large` (neither is retried). Any other error before the last attempt moves the
// job `running -> queued` (audited) and rethrows, so pg-boss retries with backoff (RETRY_POLICY, unchanged); on the last
// attempt the job becomes `failed` with `export.retries_exhausted` and the error is rethrown, so worker.ts captures it in
// the failure queue (ADR-0043 §5, captureJobFailure). Every job transition has one audit event in its transaction.
// An export approves nothing; product gates G1-G6 are business approvals and nothing here touches DG0-DG7.
import { insertAuditEvent, sql, type Db, type ExportJobRow, type Tx } from "@mth/db";
import {
  createExportStore,
  EXPORT_MAX_BYTES,
  exportFileName,
  exportStorageKey,
  ExportTooLarge,
  render,
  RenderError,
  type ExportFileStore,
  type ExportFormat,
  type LabelTable,
} from "@mth/reporting";
import { ENV_VARS } from "@mth/config";
import { DEFAULTS } from "@mth/shared";
import { exportJobRequestedV1, outboxEnvelope, type ReportDocument } from "@mth/shared/schemas";
import { jobActor } from "../kit.ts";
import type { JobAttempt } from "../handlers/spec.ts";

export const EXPORT_QUEUE = "reports.export";
export const EXPORT_REQUESTED_EVENT = "export_job.requested";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `exportJob` (the worker imports no API code). */
export const EXPORT_JOB_LOCK = 730264;
/** The 0081 `attempt_count` ceiling. */
const MAX_ATTEMPTS = 20;

export type ExportRunOutcome = "succeeded" | "already_finished" | "cancelled" | "failed" | "requeued";

export interface ExportRunResult {
  readonly exportJobId: string;
  readonly outcome: ExportRunOutcome;
  readonly errorCode?: string;
}

export interface ExportRunnerDeps {
  readonly store: ExportFileStore;
  /** The content label table (`report.*` keys) in en and ar; the frame labels are built into @mth/reporting. */
  readonly labels?: LabelTable;
  /** The product name printed in the file header (slice I's branding port replaces it once BE-R ships). */
  readonly productName?: string;
  /** Test seam: called after each rendered section (before the status check). */
  readonly afterSection?: (done: number, total: number) => void | Promise<void>;
}

class Cancelled extends Error {
  constructor() {
    super("export cancelled");
    this.name = "Cancelled";
  }
}

async function lockJob(tx: Tx, id: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${EXPORT_JOB_LOCK}::int4, hashtext(${id}::text))`.execute(tx);
}

async function lockedJob(tx: Tx, id: string): Promise<ExportJobRow | undefined> {
  await lockJob(tx, id);
  return tx.selectFrom("export_job").selectAll().where("id", "=", id).forUpdate().executeTakeFirst();
}

/**
 * The requester still holds `permission` in the transformation: an active, unrevoked, effective grant whose role holds
 * it at the transformation itself, or at a business unit above it or the organization when the role inherits downward
 * (the API's policy rules, access/rules.ts `grantApplies`, in SQL; the worker imports no API code).
 */
async function requesterHolds(tx: Tx, job: ExportJobRow, permission: string): Promise<boolean> {
  const r = await sql<{ ok: boolean }>`
    SELECT EXISTS (
      SELECT 1
        FROM scoped_assignment a
        JOIN role r ON r.id = a.role_id
        JOIN role_permission rp ON rp.role_id = r.id AND rp.permission_code = ${permission}
        JOIN app_user u ON u.id = a.user_id AND u.status = 'active'
        JOIN transformation t ON t.id = ${job.transformation_id}::uuid
       WHERE a.user_id = ${job.requested_by}::uuid
         AND a.revoked_at IS NULL
         AND a.effective_from <= now()
         AND (a.effective_to IS NULL OR a.effective_to > now())
         AND (
              (a.scope_type = 'transformation' AND a.scope_id = t.id)
           OR (r.inherits_downward AND a.scope_type = 'business_unit' AND a.scope_id IN (
                 SELECT c.ancestor_id FROM business_unit_closure c WHERE c.descendant_id = t.business_unit_id))
           OR (r.inherits_downward AND a.scope_type = 'organization' AND a.scope_id = t.organization_id)
         )
    ) AS ok`.execute(tx);
  return r.rows[0]?.ok === true;
}

type Transition = "start" | "retry" | "succeed" | "fail" | "cancel";

async function audit(
  tx: Tx,
  actorJobId: string,
  job: ExportJobRow,
  action: Transition,
  updated: ExportJobRow,
  changes: Record<string, { from: unknown; to: unknown }>,
): Promise<void> {
  await insertAuditEvent(tx, jobActor(actorJobId, job.requested_by), {
    action: `export_job.${action}`,
    recordType: "export_job",
    recordId: job.id,
    organizationId: job.organization_id,
    transformationId: job.transformation_id,
    priorVersion: job.version,
    newVersion: updated.version,
    changes,
  });
}

/** `running|queued -> failed` with `code`, audited (in `tx`, the job locked). */
async function failJob(tx: Tx, actorJobId: string, job: ExportJobRow, code: string): Promise<void> {
  const updated = await tx
    .updateTable("export_job")
    .set({
      status: "failed",
      error_code: code,
      finished_at: sql<Date>`now()`,
      version: job.version + 1,
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", job.id)
    .where("version", "=", job.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, actorJobId, job, "fail", updated, {
    status: { from: job.status, to: "failed" },
    error_code: { from: null, to: code },
  });
}

/** `running -> queued`, audited (a transient failure before the last attempt, or a killed worker's leftover). */
async function requeueJob(tx: Tx, actorJobId: string, job: ExportJobRow, why: string): Promise<ExportJobRow> {
  const updated = await tx
    .updateTable("export_job")
    .set({ status: "queued", version: job.version + 1, updated_at: sql<Date>`now()` })
    .where("id", "=", job.id)
    .where("version", "=", job.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await audit(tx, actorJobId, job, "retry", updated, {
    status: { from: "running", to: "queued" },
    reason: { from: null, to: why },
  });
  return updated;
}

/** Moves progress forward only (the 0081 guard refuses a step back): GREATEST of the stored and the new values. */
async function advance(
  db: Db | Tx,
  jobId: string,
  stage: "loading" | "rendering" | "storing",
  sectionsDone: number,
  sectionsTotal: number | null,
  percent: number,
): Promise<void> {
  const order = sql`array_position(ARRAY['queued','loading','rendering','storing','done']::text[], stage)`;
  const next = sql`array_position(ARRAY['queued','loading','rendering','storing','done']::text[], ${stage}::text)`;
  await db
    .updateTable("export_job_progress")
    .set({
      stage: sql<string>`CASE WHEN ${next} > ${order} THEN ${stage}::text ELSE stage END`,
      sections_done: sql<number>`GREATEST(sections_done, LEAST(${sectionsDone}::int, COALESCE(${sectionsTotal}::int, sections_total, ${sectionsDone}::int)))`,
      sections_total: sql<number | null>`COALESCE(${sectionsTotal}::int, sections_total)`,
      percent: sql<number>`GREATEST(percent, LEAST(${percent}::int, 99))`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
    })
    .where("export_job_id", "=", jobId)
    .where("stage", "<>", "done")
    .execute();
}

/** Step 1 (see the header). Returns the running job, or a finished outcome. */
async function start(
  db: Db,
  actorJobId: string,
  id: string,
): Promise<{ job: ExportJobRow } | { result: ExportRunResult }> {
  return db.transaction().execute(async (tx) => {
    let job = await lockedJob(tx, id);
    if (job === undefined) return { result: { exportJobId: id, outcome: "already_finished" } };
    if (job.status === "succeeded" || job.status === "failed" || job.status === "cancelled")
      return { result: { exportJobId: id, outcome: "already_finished" } };
    if (job.status === "running") job = await requeueJob(tx, actorJobId, job, "worker_restarted");
    if (job.attempt_count >= MAX_ATTEMPTS) {
      await failJob(tx, actorJobId, job, "export.retries_exhausted");
      return { result: { exportJobId: id, outcome: "failed", errorCode: "export.retries_exhausted" } };
    }
    const allowed =
      (await requesterHolds(tx, job, "transformation.read")) && (await requesterHolds(tx, job, "export.create"));
    if (!allowed) {
      await failJob(tx, actorJobId, job, "export.source_unavailable");
      return { result: { exportJobId: id, outcome: "failed", errorCode: "export.source_unavailable" } };
    }
    const updated = await tx
      .updateTable("export_job")
      .set({
        status: "running",
        attempt_count: job.attempt_count + 1,
        started_at: sql<Date>`COALESCE(started_at, now())`,
        version: job.version + 1,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", job.id)
      .where("version", "=", job.version)
      .returningAll()
      .executeTakeFirstOrThrow();
    await audit(tx, actorJobId, job, "start", updated, {
      status: { from: "queued", to: "running" },
      attempt_count: { from: job.attempt_count, to: updated.attempt_count },
    });
    await advance(tx, id, "loading", 0, null, 1);
    return { job: updated };
  });
}

/** The snapshot content and its frame (read outside any transaction; the content is immutable after INSERT). */
async function loadSource(db: Db, job: ExportJobRow) {
  const s = await db
    .selectFrom("report_snapshot as s")
    .innerJoin("report_definition as d", "d.code", "s.definition_code")
    .innerJoin("organization as o", "o.id", "s.organization_id")
    .innerJoin("transformation as t", "t.id", "s.transformation_id")
    .select([
      "s.id",
      "s.content",
      "s.status",
      "s.issue_version",
      "s.definition_code",
      "d.label_en",
      "d.label_ar",
      "o.default_timezone",
      "t.code as transformation_code",
    ])
    .where("s.id", "=", job.snapshot_id)
    .executeTakeFirstOrThrow();
  return s;
}

const isLastAttempt = (a: JobAttempt | undefined): boolean => a === undefined || a.retryCount >= a.retryLimit;

/** One run of `reports.export` (see the header). `data` is the relay's envelope of `export_job.requested`. */
export async function runExport(
  db: Db,
  data: unknown,
  jobId: string,
  attempt: JobAttempt | undefined,
  deps: ExportRunnerDeps,
): Promise<ExportRunResult> {
  const envelope = outboxEnvelope.parse(data);
  const { exportJobId: id } = exportJobRequestedV1.parse(envelope.payload);
  const started = await start(db, jobId, id);
  if ("result" in started) return started.result;
  const job = started.job;
  const key = exportStorageKey(job.organization_id, `${job.id}-a${job.attempt_count}`, job.format);
  try {
    const src = await loadSource(db, job);
    const format = job.format as ExportFormat;
    const language = job.language as "en" | "ar";
    const result = await render(src.content as ReportDocument, {
      format,
      language,
      title: language === "ar" ? src.label_ar : src.label_en,
      branding: { productName: deps.productName ?? DEFAULTS.productName },
      snapshot: {
        id: src.id,
        status: src.status as "generated" | "issued" | "superseded" | "discarded",
        issueVersion: src.issue_version,
      },
      timeZone: src.default_timezone,
      ...(deps.labels === undefined ? {} : { labels: deps.labels }),
      onSection: async (done, total) => {
        await advance(db, id, "rendering", done, total, Math.floor((done / Math.max(total, 1)) * 90));
        await deps.afterSection?.(done, total);
        const now = await db.selectFrom("export_job").select("status").where("id", "=", id).executeTakeFirstOrThrow();
        if (now.status !== "running") throw new Cancelled();
      },
    });
    if (result.bytes.byteLength > EXPORT_MAX_BYTES) throw new ExportTooLarge();
    await advance(db, id, "storing", result.sections, result.sections, 95);
    const file = await deps.store.put(key, result.bytes);
    const fileName = exportFileName({
      transformationCode: src.transformation_code,
      definitionCode: src.definition_code,
      snapshotId: src.id,
      language,
      extension: result.extension,
    });
    const outcome = await db.transaction().execute(async (tx) => {
      const cur = await lockedJob(tx, id);
      if (cur === undefined || cur.status !== "running" || cur.attempt_count !== job.attempt_count)
        return cur?.status === "cancelled" ? ("cancelled" as const) : ("already_finished" as const);
      const updated = await tx
        .updateTable("export_job")
        .set({
          status: "succeeded",
          storage_key: key,
          file_name: fileName,
          content_type: result.contentType,
          file_sha256: file.sha256,
          file_size_bytes: String(file.size),
          finished_at: sql<Date>`now()`,
          version: cur.version + 1,
          updated_at: sql<Date>`now()`,
        })
        .where("id", "=", id)
        .where("version", "=", cur.version)
        .returningAll()
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("export_job_progress")
        .set({
          stage: "done",
          percent: 100,
          sections_done: result.sections,
          sections_total: result.sections,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
        })
        .where("export_job_id", "=", id)
        .execute();
      await audit(tx, jobId, cur, "succeed", updated, {
        status: { from: "running", to: "succeeded" },
        file_sha256: { from: null, to: file.sha256 },
        file_size_bytes: { from: null, to: file.size },
        content_type: { from: null, to: result.contentType },
      });
      return "succeeded" as const;
    });
    if (outcome !== "succeeded") await deps.store.discard(key);
    return { exportJobId: id, outcome };
  } catch (err) {
    // No job records this attempt's file: remove it (a stored file of a failed or cancelled attempt is never kept).
    await deps.store.discard(key).catch(() => undefined);
    if (err instanceof Cancelled) return { exportJobId: id, outcome: "cancelled" };
    const permanent =
      err instanceof RenderError ? "export.render_failed" : err instanceof ExportTooLarge ? "export.too_large" : null;
    const last = isLastAttempt(attempt);
    const code = permanent ?? (last ? "export.retries_exhausted" : null);
    const settled = await db.transaction().execute(async (tx) => {
      const cur = await lockedJob(tx, id);
      if (cur === undefined || cur.status !== "running" || cur.attempt_count !== job.attempt_count) return false;
      if (code !== null) await failJob(tx, jobId, cur, code);
      else await requeueJob(tx, jobId, cur, "transient_failure");
      return true;
    });
    if (permanent !== null) return { exportJobId: id, outcome: "failed", errorCode: permanent };
    // Transient: rethrow so pg-boss retries (or, on the last attempt, worker.ts captures the failure).
    if (!settled) return { exportJobId: id, outcome: "already_finished" };
    throw err;
  }
}

let defaultStore: ExportFileStore | null = null;

/**
 * The store of the worker process: the configured evidence storage (EVIDENCE_STORAGE_DRIVER / EVIDENCE_STORAGE_PATH,
 * the same volume the API reads; ADR-0046 §5), read from the environment with the @mth/config defaults.
 */
export function workerExportStore(): ExportFileStore {
  if (defaultStore === null) {
    const driver =
      (process.env["EVIDENCE_STORAGE_DRIVER"] ?? ENV_VARS.EVIDENCE_STORAGE_DRIVER.default) === "s3"
        ? "s3"
        : "filesystem";
    const path =
      process.env["EVIDENCE_STORAGE_PATH"] ?? ENV_VARS.EVIDENCE_STORAGE_PATH.default ?? "/var/lib/mth/evidence";
    defaultStore = createExportStore({ driver, path });
  }
  return defaultStore;
}
