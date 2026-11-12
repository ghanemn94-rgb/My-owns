// retention.archive (P7 slice E; ADR-0067 §4-§6; REQ-S16-024; T-DG7-BE-G): the retention archival job. It consumes the
// internal outbox event `retention_run.requested` (createRetentionRun, createRetentionDryRun; singleton key = the run
// id) and its own schedule `retention.archive`, which ships DISABLED (0148). Under its own service identity
// job:retention.archive (retention.read only), it runs one retention run exactly once:
//   claim   (one transaction under the retentionRun lock 730410, key "retention"): queued -> running once, audit
//           retention_run.started. A run that is already running or terminal, or missing, is skipped, so a redelivered
//           job changes nothing. A scheduled delivery first requests a run itself (requested_via schedule, as_of =
//           now(), audit retention_run.requested), unless one is already queued or running.
//   select  (one REPEATABLE READ, READ ONLY transaction with the ADR-0064 encoder settings): per enabled class
//           (action <> 'retain') and per table of it with an age column, every row whose age is not NULL and older
//           than the run's as_of minus the class period, and not yet marked archived. The age is read as TEXT from SQL
//           (a JavaScript Date drops microseconds and the marker trigger compares exactly), the key is
//           retention_record_key() (primary key values only), and the row is encoded in the ADR-0064 §2.3 encoding.
//   set     (run mode with candidates only; no transaction open): `tables/<table>.ndjson` and `manifest.json`
//           (`mth-retention-archive/1`) under `retention/<runId>/` in the evidence store, BEFORE any marker. A store
//           failure fails the run with no marker written.
//   batches (≤ 500 rows per transaction): run mode: marker -> `archived` action + audit retention.archived -> for an
//           archive_then_purge class retention_purge_record() -> `purged` (audit retention.purged) or
//           `skipped_referenced` (audit retention.skipped). Dry run: `would_archive` (and `would_purge`) actions only,
//           no per-row audit, no set, no marker, no delete.
//   finish  succeeded with the counts (and the set's key, manifest SHA-256 and total bytes), audit
//           retention_run.succeeded; or failed with the reason, audit retention_run.failed.
// The database re-checks every guarantee (0144): a record that is not past retention can never be marked; only
// operational archive_then_purge tables can be purged; an unaudited action cannot commit. The job never calls
// EvidenceStore.delete and has no DELETE grant. A run approves nothing (no G1-G6, Finance or IT approval) and never
// reads or writes DG0-DG7.
import { createHash } from "node:crypto";
import { join } from "node:path";
import {
  columnExpression,
  directorySink,
  ENCODER_SETTINGS,
  encodeLine,
  insertAuditEvent,
  sql,
  transferSha256,
  type AuditActor,
  type ColumnKind,
  type Db,
  type PackageSink,
  type Tx,
} from "@mth/db";
import { outboxEnvelope, retentionRunRequestedV1 } from "@mth/shared/schemas";
import { defineJob, jobActor } from "../../kit.ts";
import type { JobHandler } from "../spec.ts";
import { evidenceRoot } from "../transfer/export.ts";

export const RETENTION_ARCHIVE_QUEUE = "retention.archive";
/** ADR-0016 §6 `retentionRun` (apps/api platform/advisory-locks.ts; pinned by the integration test). */
export const RETENTION_LOCK_CLASS = 730410;
export const RETENTION_LOCK_KEY = "retention";
export const RETENTION_ARCHIVE_PREFIX = "retention";
export const RETENTION_ARCHIVE_SCHEMA_VERSION = "mth-retention-archive/1";
export const RETENTION_BATCH_SIZE = 500;

export const retentionArchiveKey = (runId: string, file: string): string =>
  `${RETENTION_ARCHIVE_PREFIX}/${runId}/${file}`;

export interface RetentionArchiveDeps {
  /** The archive set sink of one run (default: the evidence store root + `retention/<runId>/`). */
  readonly sink: (runId: string) => PackageSink;
  /** Rows per transaction (default 500, ADR-0067 §6). */
  readonly batchSize?: number;
}

export function retentionStoreDeps(root: () => string = () => evidenceRoot()): RetentionArchiveDeps {
  return { sink: (runId) => directorySink(join(root(), RETENTION_ARCHIVE_PREFIX, runId)) };
}

export type RetentionRunOutcome =
  | { readonly outcome: "skipped"; readonly status: string | null }
  | {
      readonly outcome: "succeeded";
      readonly runId: string;
      readonly candidates: number;
      readonly archived: number;
      readonly purged: number;
      readonly skipped: number;
    }
  | { readonly outcome: "failed"; readonly runId: string; readonly reason: string };

const lock = (tx: Tx) =>
  sql`SELECT pg_advisory_xact_lock(${RETENTION_LOCK_CLASS}::int, hashtext(${RETENTION_LOCK_KEY}))`.execute(tx);

/** A UUIDv7 from the database (the worker's precedent: it has no uuid dependency). */
const newId = async (tx: Tx): Promise<string> =>
  (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;

const ident = (name: string): string => `"${name.replace(/"/g, '""')}"`;

/** The failure reason as stored (0144: 1-1000 characters), one line. */
export function retentionFailureReason(err: unknown): string {
  const one = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, " ").trim() || "unexpected error";
  return one.length > 1000 ? `${one.slice(0, 999)}…` : one;
}

// ------------------------------------------------------------------------------------------------ request (schedule)

/** A scheduled delivery's own request: a queued run (requested_via schedule), or null while one is active. */
export async function requestScheduledRun(db: Db, actor: AuditActor): Promise<string | null> {
  return db.transaction().execute(async (tx) => {
    await lock(tx);
    const active = await tx
      .selectFrom("retention_run")
      .select("id")
      .where("status", "in", ["queued", "running"])
      .executeTakeFirst();
    if (active !== undefined) return null;
    const id = await newId(tx);
    const row = await tx
      .insertInto("retention_run")
      .values({
        id,
        mode: "run",
        requested_via: "schedule",
        as_of: sql<Date>`now()`,
        created_by: null,
        updated_by: null,
      })
      .returning(["as_of"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, actor, {
      action: "retention_run.requested",
      recordType: "retention_run",
      recordId: id,
      organizationId: null,
      newVersion: 1,
      changes: {
        status: { from: null, to: "queued" },
        mode: { from: null, to: "run" },
        requested_via: { from: null, to: "schedule" },
        as_of: { from: null, to: row.as_of.toISOString() },
      },
    });
    return id;
  });
}

// ------------------------------------------------------------------------------------------------ selection

interface ClassTable {
  readonly classId: string;
  readonly classCode: string;
  readonly action: "archive" | "archive_then_purge";
  readonly periodDays: number;
  readonly table: string;
  readonly keyColumns: readonly string[];
  readonly ageColumn: string;
}

interface Candidate {
  readonly key: Record<string, string>;
  /** The age column's value as PostgreSQL text (UTC, microseconds). */
  readonly ageText: string;
  /** The row in the ADR-0064 §2.3 encoding (without "\n"). */
  readonly line: string;
}

interface TableCandidates extends ClassTable {
  readonly columns: readonly string[];
  readonly rows: readonly Candidate[];
}

/** The candidates of every enabled class, in ONE read-only snapshot with the encoder settings. */
async function selectCandidates(db: Db, runId: string): Promise<{ asOf: string; tables: TableCandidates[] }> {
  return db
    .transaction()
    .setIsolationLevel("repeatable read")
    .setAccessMode("read only")
    .execute(async (tx) => {
      for (const [name, value] of ENCODER_SETTINGS) await sql`SELECT set_config(${name}, ${value}, true)`.execute(tx);
      const asOf = (
        await sql<{ as_of: string }>`SELECT as_of::text AS as_of FROM retention_run WHERE id = ${runId}`.execute(tx)
      ).rows[0]!.as_of;
      const enabled = (
        await sql<{
          class_id: string;
          code: string;
          action: "archive" | "archive_then_purge";
          period_days: number;
          table_name: string;
          key_columns: string[];
          age_column: string;
        }>`SELECT c.id AS class_id, c.code, c.action, c.period_days, t.table_name, t.key_columns, t.age_column
             FROM retention_class c JOIN retention_table_class t ON t.retention_class_id = c.id
            WHERE c.action <> 'retain' AND t.age_column IS NOT NULL
            ORDER BY t.table_name COLLATE "C"`.execute(tx)
      ).rows;
      const out: TableCandidates[] = [];
      for (const e of enabled) {
        const cols = (
          await sql<{ name: string; type: string }>`SELECT a.attname::text AS name, t.typname::text AS type
               FROM pg_attribute a JOIN pg_type t ON t.oid = a.atttypid
              WHERE a.attrelid = format('public.%I', ${e.table_name}::text)::regclass AND a.attnum > 0
                AND NOT a.attisdropped
              ORDER BY a.attnum`.execute(tx)
        ).rows;
        const kinds: { name: string; kind: ColumnKind }[] = cols.map((c) => {
          if (c.type === "json")
            throw new Error(`column ${e.table_name}.${c.name} is of type json; only jsonb is supported`);
          return { name: c.name, kind: c.type === "bool" ? "bool" : c.type === "jsonb" ? "json" : "text" };
        });
        const select = kinds.map((k, i) => `${columnExpression(k.name, k.kind)} AS c${i}`).join(", ");
        const order = e.key_columns.map((c) => `r.${ident(c)}::text COLLATE "C"`).join(", ");
        const age = `r.${ident(e.age_column)}`;
        const rows = (
          await sql<
            Record<string, string | null>
          >`SELECT retention_record_key(${e.table_name}::text, to_jsonb(r))::text AS __key,
                 ${sql.raw(age)}::text AS __age, ${sql.raw(select)}
            FROM ${sql.raw(`public.${ident(e.table_name)}`)} r
           WHERE ${sql.raw(age)} IS NOT NULL
             AND ${sql.raw(age)} < (SELECT as_of FROM retention_run WHERE id = ${runId}) - make_interval(days => ${e.period_days}::int)
             AND NOT EXISTS (SELECT 1 FROM retention_archived_record m
                              WHERE m.table_name = ${e.table_name}::text
                                AND m.record_key = retention_record_key(${e.table_name}::text, to_jsonb(r)))
           ORDER BY ${sql.raw(order)}`.execute(tx)
        ).rows;
        out.push({
          classId: e.class_id,
          classCode: e.code,
          action: e.action,
          periodDays: e.period_days,
          table: e.table_name,
          keyColumns: e.key_columns,
          ageColumn: e.age_column,
          columns: kinds.map((k) => k.name),
          rows: rows.map((r) => ({
            key: JSON.parse(r["__key"]!) as Record<string, string>,
            ageText: r["__age"]!,
            line: encodeLine(
              kinds,
              kinds.map((_, i) => r[`c${i}`] ?? null),
            ),
          })),
        });
      }
      return { asOf, tables: out };
    });
}

// ------------------------------------------------------------------------------------------------ the archive set

export interface RetentionArchiveManifestTable {
  readonly name: string;
  readonly file: string;
  readonly retentionClassCode: string;
  readonly periodDays: number;
  readonly rowCount: string;
  readonly fileSha256: string;
  readonly contentDigest: string;
  readonly columns: readonly string[];
}

export interface RetentionArchiveManifest {
  readonly schemaVersion: typeof RETENTION_ARCHIVE_SCHEMA_VERSION;
  readonly runId: string;
  readonly asOf: string;
  readonly createdAt: string;
  readonly tables: readonly RetentionArchiveManifestTable[];
  readonly totals: { readonly tables: number; readonly rows: string };
}

/** Writes the set (tables first, the manifest last); returns the manifest's SHA-256 and the set's total bytes. */
async function writeArchiveSet(
  sink: PackageSink,
  runId: string,
  asOf: string,
  tables: readonly TableCandidates[],
): Promise<{ sha256: string; bytes: number }> {
  const entries: RetentionArchiveManifestTable[] = [];
  let bytes = 0;
  let rows = 0;
  for (const t of tables) {
    if (t.rows.length === 0) continue;
    const text = t.rows.map((r) => `${r.line}\n`).join("");
    const contentDigest = createHash("sha256").update(text, "utf8").digest("hex");
    const file = `tables/${t.table}.ndjson`;
    const stored = await sink.write(file, Buffer.from(text, "utf8"));
    if (stored.sha256 !== contentDigest)
      throw new Error(
        `archive set ${runId}: ${file} was stored with SHA-256 ${stored.sha256}, expected ${contentDigest}`,
      );
    bytes += stored.size;
    rows += t.rows.length;
    entries.push({
      name: t.table,
      file,
      retentionClassCode: t.classCode,
      periodDays: t.periodDays,
      rowCount: String(t.rows.length),
      fileSha256: stored.sha256,
      contentDigest,
      columns: [...t.columns],
    });
  }
  const manifest: RetentionArchiveManifest = {
    schemaVersion: RETENTION_ARCHIVE_SCHEMA_VERSION,
    runId,
    asOf,
    createdAt: new Date().toISOString(),
    tables: entries,
    totals: { tables: entries.length, rows: String(rows) },
  };
  const text = `${JSON.stringify(manifest)}\n`;
  const stored = await sink.write("manifest.json", Buffer.from(text, "utf8"));
  if (stored.sha256 !== transferSha256(text))
    throw new Error(`archive set ${runId}: manifest.json was not stored intact`);
  return { sha256: stored.sha256, bytes: bytes + stored.size };
}

// ------------------------------------------------------------------------------------------------ actions

interface Counts {
  archived: number;
  purged: number;
  skipped: number;
}

async function insertAction(
  tx: Tx,
  runId: string,
  t: ClassTable,
  c: Candidate,
  action: "would_archive" | "would_purge" | "archived" | "purged" | "skipped_referenced",
): Promise<string> {
  const id = await newId(tx);
  await sql`INSERT INTO retention_run_action (id, retention_run_id, retention_class_id, table_name, record_key, action,
              period_days, record_age_at)
            VALUES (${id}, ${runId}, ${t.classId}, ${t.table}, ${JSON.stringify(c.key)}::jsonb, ${action},
              ${t.periodDays}, ${c.ageText}::timestamptz)`.execute(tx);
  return id;
}

const AUDIT_ACTION = {
  archived: "retention.archived",
  purged: "retention.purged",
  skipped_referenced: "retention.skipped",
};

async function auditAction(
  tx: Tx,
  actor: AuditActor,
  runId: string,
  actionId: string,
  t: ClassTable,
  c: Candidate,
  action: keyof typeof AUDIT_ACTION,
): Promise<void> {
  await insertAuditEvent(tx, actor, {
    action: AUDIT_ACTION[action],
    recordType: "retention_run_action",
    recordId: actionId,
    organizationId: null,
    changes: {
      retention_run_id: { from: null, to: runId },
      table_name: { from: null, to: t.table },
      record_key: { from: null, to: c.key },
      retention_class: { from: null, to: t.classCode },
      period_days: { from: null, to: t.periodDays },
      record_age_at: { from: null, to: c.ageText },
    },
  });
}

/** One batch of a real run (one transaction): marker -> archived (+ audit) -> purge -> purged | skipped (+ audit). */
async function archiveBatch(
  tx: Tx,
  actor: AuditActor,
  runId: string,
  t: ClassTable,
  batch: readonly Candidate[],
  counts: Counts,
): Promise<void> {
  const setKey = retentionArchiveKey(runId, "manifest.json");
  for (const c of batch) {
    await sql`INSERT INTO retention_archived_record (table_name, record_key, retention_class_id, retention_run_id,
                archive_set_key, record_age_at)
              VALUES (${t.table}, ${JSON.stringify(c.key)}::jsonb, ${t.classId}, ${runId}, ${setKey},
                ${c.ageText}::timestamptz)`.execute(tx);
    await auditAction(tx, actor, runId, await insertAction(tx, runId, t, c, "archived"), t, c, "archived");
    counts.archived += 1;
    if (t.action !== "archive_then_purge") continue;
    const purged = (
      await sql<{ purged: boolean }>`SELECT retention_purge_record(${runId}::uuid, ${t.table}::text,
                                       ${JSON.stringify(c.key)}::jsonb) AS purged`.execute(tx)
    ).rows[0]!.purged;
    const action = purged ? "purged" : "skipped_referenced";
    await auditAction(tx, actor, runId, await insertAction(tx, runId, t, c, action), t, c, action);
    if (purged) counts.purged += 1;
    else counts.skipped += 1;
  }
}

/** One batch of a dry run: would_* actions only (audited once, on the run). */
async function dryRunBatch(tx: Tx, runId: string, t: ClassTable, batch: readonly Candidate[]): Promise<void> {
  for (const c of batch) {
    await insertAction(tx, runId, t, c, "would_archive");
    if (t.action === "archive_then_purge") await insertAction(tx, runId, t, c, "would_purge");
  }
}

// ------------------------------------------------------------------------------------------------ the run

async function finish(
  db: Db,
  runId: string,
  actor: AuditActor,
  result:
    | { ok: true; candidates: number; counts: Counts; set: { sha256: string; bytes: number } | null }
    | { ok: false; reason: string },
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const row = await tx.selectFrom("retention_run").selectAll().where("id", "=", runId).forUpdate().executeTakeFirst();
    if (row === undefined || row.status !== "running") return;
    const version = row.version + 1;
    if (result.ok) {
      await tx
        .updateTable("retention_run")
        .set({
          status: "succeeded",
          candidate_count: result.candidates,
          archived_count: result.counts.archived,
          purged_count: result.counts.purged,
          skipped_count: result.counts.skipped,
          archive_set_key: result.set === null ? null : retentionArchiveKey(runId, "manifest.json"),
          archive_set_sha256: result.set?.sha256 ?? null,
          archive_set_bytes: result.set === null ? null : String(result.set.bytes),
          finished_at: sql<Date>`now()`,
          version,
          updated_at: sql<Date>`now()`,
          updated_by: null,
        })
        .where("id", "=", runId)
        .execute();
      await insertAuditEvent(tx, actor, {
        action: "retention_run.succeeded",
        recordType: "retention_run",
        recordId: runId,
        organizationId: null,
        priorVersion: row.version,
        newVersion: version,
        changes: {
          status: { from: "running", to: "succeeded" },
          candidate_count: { from: null, to: result.candidates },
          archived_count: { from: null, to: result.counts.archived },
          purged_count: { from: null, to: result.counts.purged },
          skipped_count: { from: null, to: result.counts.skipped },
          archive_set_sha256: { from: null, to: result.set?.sha256 ?? null },
        },
      });
      return;
    }
    await tx
      .updateTable("retention_run")
      .set({
        status: "failed",
        failure_reason: result.reason,
        finished_at: sql<Date>`now()`,
        version,
        updated_at: sql<Date>`now()`,
        updated_by: null,
      })
      .where("id", "=", runId)
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "retention_run.failed",
      recordType: "retention_run",
      recordId: runId,
      organizationId: null,
      priorVersion: row.version,
      newVersion: version,
      changes: { status: { from: "running", to: "failed" }, failure_reason: { from: null, to: result.reason } },
    });
  });
}

/** claim -> select -> set -> batches -> finish for one run (see the header). */
export async function runRetention(
  db: Db,
  runId: string,
  jobId: string,
  deps: RetentionArchiveDeps,
): Promise<RetentionRunOutcome> {
  const actor = jobActor(jobId);
  const claimed = await db.transaction().execute(async (tx) => {
    await lock(tx);
    const row = await tx.selectFrom("retention_run").selectAll().where("id", "=", runId).forUpdate().executeTakeFirst();
    if (row === undefined || row.status !== "queued") return { claimed: false as const, status: row?.status ?? null };
    await tx
      .updateTable("retention_run")
      .set({ status: "running", started_at: sql<Date>`now()`, version: row.version + 1, updated_at: sql<Date>`now()` })
      .where("id", "=", runId)
      .execute();
    await insertAuditEvent(tx, actor, {
      action: "retention_run.started",
      recordType: "retention_run",
      recordId: runId,
      organizationId: null,
      priorVersion: row.version,
      newVersion: row.version + 1,
      changes: { status: { from: "queued", to: "running" } },
    });
    return { claimed: true as const, mode: row.mode as "run" | "dry_run" };
  });
  if (!claimed.claimed) return { outcome: "skipped", status: claimed.status };

  const counts: Counts = { archived: 0, purged: 0, skipped: 0 };
  let candidates = 0;
  let set: { sha256: string; bytes: number } | null = null;
  try {
    const selected = await selectCandidates(db, runId);
    candidates = selected.tables.reduce((n, t) => n + t.rows.length, 0);
    // The set first, with no transaction open (no remote I/O inside a transaction), and before any marker.
    if (claimed.mode === "run" && candidates > 0)
      set = await writeArchiveSet(deps.sink(runId), runId, selected.asOf, selected.tables);
    const size = deps.batchSize ?? RETENTION_BATCH_SIZE;
    for (const t of selected.tables)
      for (let i = 0; i < t.rows.length; i += size) {
        const batch = t.rows.slice(i, i + size);
        await db
          .transaction()
          .execute((tx) =>
            claimed.mode === "run"
              ? archiveBatch(tx, actor, runId, t, batch, counts)
              : dryRunBatch(tx, runId, t, batch),
          );
      }
  } catch (err) {
    const reason = retentionFailureReason(err);
    await finish(db, runId, actor, { ok: false, reason });
    return { outcome: "failed", runId, reason };
  }
  await finish(db, runId, actor, { ok: true, candidates, counts, set });
  return { outcome: "succeeded", runId, candidates, ...counts };
}

/** The handler: an outbox envelope names its run; a scheduled delivery (no envelope) requests one first. */
export function retentionArchiveHandler(deps: RetentionArchiveDeps = retentionStoreDeps()): JobHandler {
  return defineJob({
    queue: RETENTION_ARCHIVE_QUEUE,
    handle: async (db, data, jobId) => {
      const isEnvelope = typeof data === "object" && data !== null && "outboxEventId" in data;
      if (isEnvelope) {
        const envelope = outboxEnvelope.parse(data);
        const payload = retentionRunRequestedV1.parse(envelope.payload);
        return runRetention(db, payload.retentionRunId, jobId, deps);
      }
      const runId = await requestScheduledRun(db, jobActor(jobId));
      if (runId === null) return { outcome: "skipped", status: "active" } satisfies RetentionRunOutcome;
      return runRetention(db, runId, jobId, deps);
    },
  });
}
