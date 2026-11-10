// search job handlers (P6; ADR-0057 §2; REQ-S15-010; T-DG6-BE-P; stub by T-DG6-BE-A). Two jobs keep the derived
// search index (`search_document`, `search_index_state`, 0108) current. Both run under their own service identity
// (ADR-0053 §1; `defineJob`; migration 0115) and write nothing outside those two tables; neither approves anything,
// and nothing here reads or writes DG0-DG7.
//
// search.index_feed (every minute; 0115). The audit trail IS the feed (ADR-0057 §2; work split §H/G.14 item 3): every
// DG1-DG5 write already inserts its `audit_event` in the same transaction, so no write path emits anything new. Per
// record type, in ONE transaction under pg_advisory_xact_lock(730318 `searchReindex`, hashtext('<recordType>')):
//   1. read up to 500 audit events of the type with seq > search_index_state.last_audit_seq, in seq order, stopping at
//      the first event whose writing transaction is not yet SETTLED (see `settledHorizon`), so a transaction that took
//      a lower sequence but commits later is never skipped (no gap);
//   2. per distinct record: read its current row through the job's scope and upsert the document with
//      source_audit_seq = the record's highest seq in the batch, or delete the document when the row is gone;
//   3. advance last_audit_seq to the batch's highest seq and set last_incremental_at (when the type is caught up), in
//      the same transaction.
//   A replay changes nothing (the upsert is keyed by record and refuses older content: 0108 search_document_monotonic),
//   and a run killed mid-batch rolls the whole batch back, so the next run re-reads it: no duplicate and no gap. A type
//   in `reindexing` is skipped (the reindex owns it). A failure rolls the batch back and marks the type `failed` with
//   its code (0108 search_index_state_failed_coded); the next successful run sets it `idle` again.
//
// search.reindex (weekly, Sunday 02:30 Asia/Riyadh; on demand through the P5 runJobNow, job.repair). Per type, under
// the same lock: capture S0 (the settled audit horizon); set `reindexing`, last_audit_seq 0 and reindex_started_at
// (the only backward move search_index_state_guard allows); upsert a document for every current row in id order, in
// batches of 500 (one transaction each) with source_audit_seq = greatest(existing, S0); delete the documents of rows
// that no longer exist; set last_audit_seq = S0, `idle`, reindex_finished_at and documents_count. A failure sets
// `failed` and restores the consumed sequence it had before (a forward move from 0), so the feed resumes; the next
// reindex starts over.
//
// No remote I/O happens anywhere here (rule 4): the jobs read and write the product database only.
import { sql, type Db, type Tx } from "@mth/db";
import { defineJob, isServiceIdentityError, type JobRunContext } from "../kit.ts";
import {
  buildDocument,
  deleteDocument,
  readCurrent,
  ScopeCache,
  SEARCH_DOCUMENT_SPECS,
  SEARCH_RECORD_TYPES,
  upsertDocument,
  type SearchRecordType,
} from "../search/documents.ts";
import type { JobHandler } from "./spec.ts";

export const SEARCH_INDEX_FEED_QUEUE = "search.index_feed";
export const SEARCH_REINDEX_QUEUE = "search.reindex";
/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `searchReindex` (the worker imports no API code). */
export const SEARCH_REINDEX_LOCK = 730318;
/** ADR-0057 §2: batches of 500. */
export const SEARCH_BATCH_SIZE = 500;
/** At most this many feed batches per type and run (the rest waits for the next minute). */
export const SEARCH_FEED_MAX_BATCHES = 20;
/** The failure code of an index error that is not a service-identity refusal (0108 last_error_code format). */
export const SEARCH_INDEX_FAILED_CODE = "search.index_failed";
/** How far back (in audit sequence numbers) the reindex looks for unsettled writes when it captures S0. */
const SETTLE_SCAN_WINDOW = 100_000;

/** Test hooks (QA-C's A13 hook): called inside the batch transaction, before it commits; a throw rolls it back. */
export interface SearchJobHooks {
  readonly beforeCommit?: (recordType: SearchRecordType, batch: SearchBatchInfo) => void | Promise<void>;
}

export interface SearchBatchInfo {
  readonly kind: "feed" | "reindex";
  /** Records upserted or deleted so far in this batch's transaction. */
  readonly upserted: number;
  readonly deleted: number;
  readonly highestSeq: string | null;
}

export interface SearchRunOptions {
  /** Restrict the run to some record types (tests; default all 12). */
  readonly recordTypes?: readonly SearchRecordType[];
  readonly batchSize?: number;
  readonly hooks?: SearchJobHooks;
}

export interface SearchTypeOutcome {
  readonly recordType: SearchRecordType;
  readonly outcome: "indexed" | "skipped_reindexing" | "failed";
  readonly events: number;
  readonly upserted: number;
  readonly deleted: number;
  readonly lastAuditSeq: string;
  readonly errorCode: string | null;
}

export interface SearchRunResult {
  readonly types: readonly SearchTypeOutcome[];
}

const lockType = (tx: Tx, recordType: SearchRecordType) =>
  sql`SELECT pg_advisory_xact_lock(${SEARCH_REINDEX_LOCK}::integer, hashtext(${recordType}::text))`.execute(tx);

/**
 * The settled horizon: the 32-bit xmin of the current snapshot. A transaction whose xid is OLDER than it had finished
 * when the snapshot was taken; a newer one may still be concurrent with a writer that holds a lower audit sequence. The
 * comparison uses age(), which is wrap-around safe (the xid8 is reduced to its 32-bit xid first).
 */
async function settledHorizon(tx: Tx): Promise<string> {
  const r = await sql<{ x: string }>`
    SELECT (pg_snapshot_xmin(pg_current_snapshot())::text::bigint % 4294967296)::text AS x`.execute(tx);
  return r.rows[0]!.x;
}

interface FeedEvent {
  readonly seq: string;
  readonly record_id: string;
  readonly settled: boolean;
}

function errorCodeOf(err: unknown): string {
  return isServiceIdentityError(err) ? err.code : SEARCH_INDEX_FAILED_CODE;
}

async function lockedState(tx: Tx, recordType: SearchRecordType) {
  await lockType(tx, recordType);
  return tx
    .selectFrom("search_index_state")
    .selectAll()
    .where("record_type", "=", recordType)
    .forUpdate()
    .executeTakeFirstOrThrow();
}

/** Marks a type failed with its code, in its own transaction; `restoreSeq` moves last_audit_seq forward to it. */
async function markFailed(
  db: Db,
  recordType: SearchRecordType,
  code: string,
  restoreSeq: string | null,
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    const state = await lockedState(tx, recordType);
    const restore = restoreSeq !== null && BigInt(restoreSeq) > BigInt(state.last_audit_seq) ? restoreSeq : null;
    await tx
      .updateTable("search_index_state")
      .set({
        status: "failed",
        last_error_code: code,
        last_error_at: sql<Date>`now()`,
        ...(restore !== null ? { last_audit_seq: restore } : {}),
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", state.id)
      .execute();
  });
}

/** One feed batch of one type, in one transaction. Returns null when the type is reindexing. */
async function feedBatch(
  tx: Tx,
  recordType: SearchRecordType,
  run: JobRunContext,
  batchSize: number,
  hooks: SearchJobHooks | undefined,
): Promise<{ events: number; upserted: number; deleted: number; done: boolean; lastAuditSeq: string } | null> {
  const horizon = await settledHorizon(tx);
  const state = await lockedState(tx, recordType);
  if (state.status === "reindexing") return null;
  const rows = await sql<FeedEvent>`
    SELECT seq::text AS seq, record_id, age(xmin) > age(${horizon}::text::xid) AS settled
      FROM audit_event
     WHERE record_type = ${recordType} AND seq > ${state.last_audit_seq}::bigint
     ORDER BY seq
     LIMIT ${batchSize}`.execute(tx);
  const events: FeedEvent[] = [];
  for (const e of rows.rows) {
    if (!e.settled) break;
    events.push(e);
  }
  const stoppedEarly = events.length < rows.rows.length;
  const highest = new Map<string, string>();
  for (const e of events) highest.set(e.record_id, e.seq);
  const ids = [...highest.keys()].sort();
  const { rows: current, removed } = await readCurrent(tx, recordType, ids, new ScopeCache(tx, run.principal));
  let upserted = 0;
  let deleted = 0;
  for (const row of current)
    if (await upsertDocument(tx, buildDocument(recordType, row), highest.get(row.id)!, "feed")) upserted += 1;
  for (const id of removed) if (await deleteDocument(tx, recordType, id)) deleted += 1;
  const highestSeq = events.length > 0 ? events[events.length - 1]!.seq : null;
  await hooks?.beforeCommit?.(recordType, { kind: "feed", upserted, deleted, highestSeq });
  const caughtUp = !stoppedEarly && rows.rows.length < batchSize;
  const lastAuditSeq = highestSeq ?? state.last_audit_seq;
  await tx
    .updateTable("search_index_state")
    .set({
      last_audit_seq: lastAuditSeq,
      ...(caughtUp ? { last_incremental_at: sql<Date>`now()` } : {}),
      status: "idle",
      last_error_code: null,
      last_error_at: null,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", state.id)
    .execute();
  // A batch stopped at an unsettled write ends this run for the type (the next minute retries it); last_incremental_at
  // stays where it was, so the index honestly reads as behind (ADR-0057 §2 `stale`) until the write settles.
  return { events: events.length, upserted, deleted, done: caughtUp || stoppedEarly, lastAuditSeq };
}

/** The feed for each type (ADR-0057 §2). A failed type is marked and the first error is rethrown after all ran. */
export async function runIndexFeed(
  db: Db,
  run: JobRunContext,
  options: SearchRunOptions = {},
): Promise<SearchRunResult> {
  const types = options.recordTypes ?? SEARCH_RECORD_TYPES;
  const batchSize = options.batchSize ?? SEARCH_BATCH_SIZE;
  const out: SearchTypeOutcome[] = [];
  let failure: unknown = null;
  for (const recordType of types) {
    let events = 0;
    let upserted = 0;
    let deleted = 0;
    let lastAuditSeq = "0";
    try {
      let outcome: SearchTypeOutcome["outcome"] = "indexed";
      for (let i = 0; i < SEARCH_FEED_MAX_BATCHES; i += 1) {
        const b = await db.transaction().execute((tx) => feedBatch(tx, recordType, run, batchSize, options.hooks));
        if (b === null) {
          outcome = "skipped_reindexing";
          break;
        }
        events += b.events;
        upserted += b.upserted;
        deleted += b.deleted;
        lastAuditSeq = b.lastAuditSeq;
        if (b.done) break;
      }
      out.push({ recordType, outcome, events, upserted, deleted, lastAuditSeq, errorCode: null });
    } catch (err) {
      const code = errorCodeOf(err);
      await markFailed(db, recordType, code, null);
      out.push({ recordType, outcome: "failed", events, upserted, deleted, lastAuditSeq, errorCode: code });
      failure ??= err;
    }
  }
  if (failure !== null) throw failure;
  return { types: out };
}

/**
 * S0 for a type: the highest audit sequence below which every write of the type is settled (the feed's horizon rule
 * applied once): the global maximum, or one less than the oldest unsettled event of the type in the recent window.
 */
async function captureS0(tx: Tx, recordType: SearchRecordType): Promise<string> {
  const horizon = await settledHorizon(tx);
  const r = await sql<{ s0: string }>`
    WITH top AS (SELECT coalesce(max(seq), 0) AS m FROM audit_event)
    SELECT coalesce((SELECT min(seq) - 1 FROM audit_event, top
                      WHERE seq > top.m - ${SETTLE_SCAN_WINDOW} AND record_type = ${recordType}
                        AND NOT (age(xmin) > age(${horizon}::text::xid))),
                    (SELECT m FROM top))::text AS s0`.execute(tx);
  return r.rows[0]!.s0;
}

/** The full rebuild of one type (ADR-0057 §2). */
async function reindexType(
  db: Db,
  recordType: SearchRecordType,
  run: JobRunContext,
  batchSize: number,
  hooks: SearchJobHooks | undefined,
): Promise<SearchTypeOutcome> {
  let previousSeq: string | null = null;
  let upserted = 0;
  let deleted = 0;
  try {
    const s0 = await db.transaction().execute(async (tx) => {
      const state = await lockedState(tx, recordType);
      const captured = await captureS0(tx, recordType);
      previousSeq = state.last_audit_seq;
      await tx
        .updateTable("search_index_state")
        .set({
          status: "reindexing",
          last_audit_seq: "0",
          reindex_started_at: sql<Date>`now()`,
          reindex_finished_at: null,
          last_error_code: null,
          last_error_at: null,
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
        })
        .where("id", "=", state.id)
        .execute();
      return captured;
    });
    const table = sql.table(SEARCH_DOCUMENT_SPECS[recordType].table);
    let after = "00000000-0000-0000-0000-000000000000";
    for (;;) {
      const done = await db.transaction().execute(async (tx) => {
        await lockType(tx, recordType);
        const page = await sql<{ id: string }>`
          SELECT id FROM ${table} WHERE id > ${after}::uuid ORDER BY id LIMIT ${batchSize}`.execute(tx);
        const ids = page.rows.map((r) => r.id);
        if (ids.length === 0) return true;
        const { rows } = await readCurrent(tx, recordType, ids, new ScopeCache(tx, run.principal));
        for (const row of rows)
          if (await upsertDocument(tx, buildDocument(recordType, row), s0, "reindex")) upserted += 1;
        await hooks?.beforeCommit?.(recordType, { kind: "reindex", upserted, deleted, highestSeq: s0 });
        after = ids[ids.length - 1]!;
        return ids.length < batchSize;
      });
      if (done) break;
    }
    const lastAuditSeq = await db.transaction().execute(async (tx) => {
      const state = await lockedState(tx, recordType);
      const gone = await sql<{ n: string }>`
        WITH d AS (
          DELETE FROM search_document sd
           WHERE sd.record_type = ${recordType}
             AND NOT EXISTS (SELECT 1 FROM ${table} r WHERE r.id = sd.record_id)
          RETURNING 1)
        SELECT count(*)::text AS n FROM d`.execute(tx);
      deleted += Number(gone.rows[0]!.n);
      const count = await tx
        .selectFrom("search_document")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .where("record_type", "=", recordType)
        .executeTakeFirstOrThrow();
      await tx
        .updateTable("search_index_state")
        .set({
          status: "idle",
          last_audit_seq: s0,
          reindex_finished_at: sql<Date>`now()`,
          last_incremental_at: sql<Date>`now()`,
          documents_count: Number(count.n),
          version: sql<number>`version + 1`,
          updated_at: sql<Date>`now()`,
        })
        .where("id", "=", state.id)
        .execute();
      return s0;
    });
    return { recordType, outcome: "indexed", events: 0, upserted, deleted, lastAuditSeq, errorCode: null };
  } catch (err) {
    const code = errorCodeOf(err);
    await markFailed(db, recordType, code, previousSeq);
    throw err;
  }
}

/** The reindex of each type. A failed type is marked and the first error is rethrown after all ran. */
export async function runReindex(db: Db, run: JobRunContext, options: SearchRunOptions = {}): Promise<SearchRunResult> {
  const types = options.recordTypes ?? SEARCH_RECORD_TYPES;
  const batchSize = options.batchSize ?? SEARCH_BATCH_SIZE;
  const out: SearchTypeOutcome[] = [];
  let failure: unknown = null;
  for (const recordType of types) {
    try {
      out.push(await reindexType(db, recordType, run, batchSize, options.hooks));
    } catch (err) {
      out.push({
        recordType,
        outcome: "failed",
        events: 0,
        upserted: 0,
        deleted: 0,
        lastAuditSeq: "0",
        errorCode: errorCodeOf(err),
      });
      failure ??= err;
    }
  }
  if (failure !== null) throw failure;
  return { types: out };
}

/** The two jobs, each acting as its own service identity (ADR-0053 §1; 0115). */
export const SEARCH_HANDLERS: readonly JobHandler[] = [
  defineJob({
    queue: SEARCH_INDEX_FEED_QUEUE,
    identity: { permissions: ["transformation.read"], scope: "platform", sensitiveAccess: "none" },
    handle: (db, _data, _jobId, _attempt, run) => runIndexFeed(db, run),
  }),
  defineJob({
    queue: SEARCH_REINDEX_QUEUE,
    identity: { permissions: ["transformation.read"], scope: "platform", sensitiveAccess: "none" },
    handle: (db, _data, _jobId, _attempt, run) => runReindex(db, run),
  }),
];
