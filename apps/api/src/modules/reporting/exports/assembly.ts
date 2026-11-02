// The export assembly watch (T-DG6-BE-Y5; D-207; F-DG6-147; ADR-0046 §2 as amended by D-207; migration 0124; the
// persisted attempt count and the session lock: T-DG6-BE-Y6, F-DG6-sa12-3, migration 0125).
//
// createExport (jobs.ts) answers a LIVE selection with 202 and a job that has its stored selection but no snapshot yet
// (`snapshot_id IS NULL`, `status = 'queued'`), and no outbox event. This watch, in the API process (the assembler is
// API code and the worker imports none, ADR-0002 rule 5; the connector-run-watch precedent, integrations/runs.ts),
// turns each such job into an ordinary export of a snapshot:
//
//   ONE database connection per job, holding the job's `exportJob` advisory lock as a SESSION lock from the claim to
//   the end (the class cancel and the worker hold; only ever tried, never waited for, so no lock-order deadlock; a
//   process that dies loses its connection and so the lock), and on it TWO transactions:
//     0. the attempt (its own committed transaction, 0125): the oldest pending job `FOR UPDATE SKIP LOCKED`, then
//        `pg_try_advisory_lock` (a job another watcher, another API instance or a concurrent step, holds is skipped,
//        never assembled twice); a job whose `assembly_attempt_count` reached EXPORT_ASSEMBLY_MAX_ERRORS fails
//        `export.assembly_failed`; otherwise the attempt is counted (+ 1, version + 1, audited
//        `export_job.assembly_attempt`) and COMMITTED before anything is assembled, so even a crash that kills the
//        process in the middle of the assembly leaves it counted;
//   then ONE transaction for the job itself:
//     1. the job re-read `FOR UPDATE` at the counted version (still pending; the session lock keeps others out);
//     2. the requester's access, on the CURRENT grants: an active user holding transformation.read, export.create and
//        report.generate in the job's transformation, else the job fails `export.source_unavailable`;
//     3. the assembly (read-only REPEATABLE READ, on its own connection, while the claim is held): the snapshot's
//        data-as-of is the assembly time, recorded on the snapshot as before (D-207 (5)). A refusal of the report
//        itself (its subject or period is gone, it became too large) fails the job `export.assembly_failed`;
//     4. the access re-check on grants reloaded after the assembly (commit time), else `export.source_unavailable`;
//     5. D-199 on the assembly's actual sources: a record the requester is not admitted to fails the job
//        `export.includes_restricted_records` (nothing written but the failure: no snapshot, never a file); then the
//        snapshot (rows and the
//        `report_snapshot.generate` audit event exactly as generateSnapshot writes them; created_by = the requester),
//        the job's `snapshot_id` (version + 1, audited `export_job.assemble`) and the `export_job.requested` outbox
//        event for the worker, which renders after this COMMIT exactly as for an export of an existing snapshot.
//   Every failure is `queued -> failed` with its error code, audited `export_job.fail`, in the same transaction.
//
// Durable and idempotent: the pending state lives in the job row, so a restart (or a crash in the middle of a job,
// whose transaction then rolls back) leaves the job pending and the next step assembles it; a job is assembled at most
// once because the snapshot, the assignment and the outbox event commit together and an assembled job is no longer
// pending (the 0124 guard also refuses a second assignment). An unexpected error (not a refusal) or a crash rolls back
// and is retried at the next tick; its attempt is already counted ON THE JOB, so after EXPORT_ASSEMBLY_MAX_ERRORS
// attempts that never committed an outcome the job fails `export.assembly_failed`, across restarts and processes.
//
// Who drives it: every API process, every EXPORT_ASSEMBLY_INTERVAL_MS, and immediately after a 202 of a live selection
// (routes.ts `kick`). Not started under NODE_ENV=test, where the suites call `exportAssemblyWatchStep` themselves.
// An export approves nothing; product gates G1-G6 are business approvals and nothing here touches DG0-DG7.
import { sql, type Db, type Tx } from "@mth/db";
import { v7 as uuidv7 } from "uuid";
import { authorize, loadGrants, type Principal } from "../../access/index.ts";
import { record, type AuditContext } from "../../audit/index.ts";
import { ADVISORY_LOCK_CLASSES, HttpProblem } from "../../platform/index.ts";
import { assembleReport, insertGeneratedSnapshot, type Assembly } from "../reports/snapshots.ts";
import {
  assemblySources,
  enqueueExportRequested,
  reportRequestOf,
  restrictedAmong,
  storedSelection,
  type ExportJob,
} from "./jobs.ts";

export const EXPORT_ASSEMBLY_INTERVAL_MS = 1_000;
/** Jobs assembled at the same time by one process (each on its own claim; the pool has room for 2 connections each). */
export const EXPORT_ASSEMBLY_CONCURRENCY = 2;
/** At most this many jobs per step and loop (the next tick continues). */
export const EXPORT_ASSEMBLY_BATCH = 50;
/**
 * Assembly attempts of one job that ended without a committed outcome (an unexpected error, or a crash that killed the
 * process) before the next claim fails it `export.assembly_failed`. Counted on the job (`assembly_attempt_count`,
 * 0125), so the bound holds across restarts.
 */
export const EXPORT_ASSEMBLY_MAX_ERRORS = 3;

type AssemblyErrorCode = Extract<
  ExportJob["errorCode"],
  "export.source_unavailable" | "export.includes_restricted_records" | "export.assembly_failed"
>;

export type AssemblyOutcome =
  | { readonly outcome: "assembled"; readonly exportJobId: string; readonly snapshotId: string }
  | { readonly outcome: "failed"; readonly exportJobId: string; readonly errorCode: AssemblyErrorCode }
  | { readonly outcome: "none" };

const ASSEMBLY_ACTOR = (jobId: string, requester: string): AuditContext => ({
  actorUserId: null,
  actorType: "service",
  onBehalfOfUserId: requester,
  requestId: `export_job:${jobId}`,
});

/** The requester's principal on the current grants, or null for a user who is no longer active. */
async function requesterPrincipal(tx: Tx, userId: string): Promise<Principal | null> {
  const user = await tx
    .selectFrom("app_user")
    .select(["organization_id", "status"])
    .where("id", "=", userId)
    .executeTakeFirst();
  if (user === undefined || user.status !== "active") return null;
  return {
    kind: "user",
    userId,
    organizationId: user.organization_id,
    grants: await loadGrants(tx, userId),
    tracker: { decisions: 0 },
  };
}

/** True when the requester may still read, export and generate in the transformation. */
async function stillAllowed(tx: Tx, userId: string, transformationId: string): Promise<Principal | null> {
  const principal = await requesterPrincipal(tx, userId);
  if (principal === null) return null;
  const target = { type: "transformation" as const, id: transformationId };
  for (const permission of ["transformation.read", "export.create", "report.generate"] as const)
    if (!(await authorize(tx, principal, permission, target)).allowed) return null;
  return principal;
}

type ClaimedJob = NonNullable<Awaited<ReturnType<typeof claimNext>>>;

/**
 * The oldest pending job not held by another watcher, row-locked, with its `exportJob` lock taken as a SESSION lock
 * (released by `assembleNextExport`, or by the connection's end); undefined when there is none.
 */
async function claimNext(tx: Tx, onlyJobIds: readonly string[] | null) {
  for (;;) {
    let q = tx
      .selectFrom("export_job")
      .selectAll()
      .where("snapshot_id", "is", null)
      .where("status", "=", "queued")
      .orderBy("created_at")
      .orderBy("id")
      .limit(1)
      .forUpdate()
      .skipLocked();
    if (onlyJobIds !== null) q = q.where("id", "in", onlyJobIds.length === 0 ? [uuidv7()] : [...onlyJobIds]);
    const job = await q.executeTakeFirst();
    if (job === undefined) return undefined;
    const locked = await sql<{ ok: boolean }>`
      SELECT pg_try_advisory_lock(${ADVISORY_LOCK_CLASSES.exportJob}::int4, hashtext(${job.id}::text)) AS ok`.execute(
      tx,
    );
    if (locked.rows[0]?.ok === true) return job;
    // A cancel (or another watcher) holds the job's lock right now: leave this job to it (the next step sees the
    // outcome). Another pending job may still be free; the row lock of this one is kept until this short claim
    // transaction ends, so it is not claimed again.
    if (onlyJobIds !== null && onlyJobIds.length === 1) return undefined;
    onlyJobIds = await otherPending(tx, job.id, onlyJobIds);
    if (onlyJobIds.length === 0) return undefined;
  }
}

/** The pending job ids other than `skip` (within `scope` when given). */
async function otherPending(tx: Tx, skip: string, scope: readonly string[] | null): Promise<string[]> {
  let q = tx
    .selectFrom("export_job")
    .select("id")
    .where("snapshot_id", "is", null)
    .where("status", "=", "queued")
    .where("id", "<>", skip)
    .orderBy("created_at")
    .orderBy("id")
    .limit(EXPORT_ASSEMBLY_BATCH);
  if (scope !== null) q = q.where("id", "in", scope.length === 0 ? [uuidv7()] : [...scope]);
  return (await q.execute()).map((r) => r.id);
}

/** `queued -> failed` with `code` (no snapshot), audited, in `tx` with the job claimed. */
async function failPending(tx: Tx, job: ClaimedJob, code: AssemblyErrorCode): Promise<AssemblyOutcome> {
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
  await record(tx, ASSEMBLY_ACTOR(job.id, job.requested_by), {
    action: "export_job.fail",
    recordType: "export_job",
    recordId: job.id,
    organizationId: job.organization_id,
    transformationId: job.transformation_id,
    priorVersion: job.version,
    newVersion: updated.version,
    changes: { status: { from: "queued", to: "failed" }, error_code: { from: null, to: code } },
  });
  return { outcome: "failed", exportJobId: job.id, errorCode: code };
}

/** Counts the claimed job's assembly attempt (+ 1, version + 1), audited, in `tx`; returns the counted row. */
async function countAttempt(tx: Tx, job: ClaimedJob): Promise<ClaimedJob> {
  const counted = await tx
    .updateTable("export_job")
    .set({
      assembly_attempt_count: job.assembly_attempt_count + 1,
      version: job.version + 1,
      updated_at: sql<Date>`now()`,
    })
    .where("id", "=", job.id)
    .where("version", "=", job.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, ASSEMBLY_ACTOR(job.id, job.requested_by), {
    action: "export_job.assembly_attempt",
    recordType: "export_job",
    recordId: job.id,
    organizationId: job.organization_id,
    transformationId: job.transformation_id,
    priorVersion: job.version,
    newVersion: counted.version,
    changes: { assembly_attempt_count: { from: job.assembly_attempt_count, to: counted.assembly_attempt_count } },
  });
  return counted;
}

export interface AssemblyHooks {
  /** After the attempt is counted and committed, before the job's transaction (tests: a crash before assembly). */
  readonly afterAttemptCounted?: (jobId: string) => Promise<void>;
  /** After the assembly, before the commit-time checks and writes (tests: a crash in the middle of the job). */
  readonly afterAssembly?: (jobId: string) => Promise<void>;
}

/**
 * Claims and assembles ONE pending job (the oldest one free); `none` when there is nothing to do. The attempt is
 * counted and committed first, then the job is assembled in one transaction (see the header). `onlyJobIds` limits the
 * claim to those jobs (the tests' scoping; production passes null). Safe against concurrent calls in this or another
 * process.
 */
export async function assembleNextExport(
  db: Db,
  onlyJobIds: readonly string[] | null = null,
  hooks: AssemblyHooks = {},
): Promise<AssemblyOutcome> {
  return db.connection().execute(async (conn): Promise<AssemblyOutcome> => {
    let lockedId: string | null = null;
    try {
      // 0. The attempt, committed on its own before anything is assembled.
      const claim = await conn.transaction().execute(async (tx) => {
        const job = await claimNext(tx, onlyJobIds);
        if (job === undefined) return { outcome: { outcome: "none" } as AssemblyOutcome };
        lockedId = job.id;
        if (job.assembly_attempt_count >= EXPORT_ASSEMBLY_MAX_ERRORS)
          return { outcome: await failPending(tx, job, "export.assembly_failed") };
        return { counted: await countAttempt(tx, job) };
      });
      if ("outcome" in claim) return claim.outcome;
      const counted = claim.counted;
      if (hooks.afterAttemptCounted !== undefined) await hooks.afterAttemptCounted(counted.id);
      // 1-5. The job, in one transaction, under the session lock.
      return await conn.transaction().execute(async (tx): Promise<AssemblyOutcome> => {
        const job = await tx
          .selectFrom("export_job")
          .selectAll()
          .where("id", "=", counted.id)
          .where("version", "=", counted.version)
          .where("snapshot_id", "is", null)
          .where("status", "=", "queued")
          .forUpdate()
          .executeTakeFirst();
        // Changed by none of the watch, cancel or the worker while the session lock is held; leave it if it did.
        if (job === undefined) return { outcome: "none" };
        const sel = storedSelection(job);
        // The 0124 CHECK makes this impossible; fail closed rather than guess.
        if (sel === null) return failPending(tx, job, "export.assembly_failed");
        if ((await stillAllowed(tx, job.requested_by, job.transformation_id)) === null)
          return failPending(tx, job, "export.source_unavailable");
        let assembly: Assembly;
        try {
          assembly = await assembleReport(db, reportRequestOf(sel, job.transformation_id));
        } catch (err) {
          // The report's own refusals (422 subject/period/parameters, report.too_large, 404 subject or output gone).
          if (err instanceof HttpProblem && err.status >= 400 && err.status < 500)
            return failPending(tx, job, "export.assembly_failed");
          throw err;
        }
        if (hooks.afterAssembly !== undefined) await hooks.afterAssembly(job.id);
        // Commit time: the grants are reloaded after the assembly.
        const principal = await stillAllowed(tx, job.requested_by, job.transformation_id);
        if (principal === null) return failPending(tx, job, "export.source_unavailable");
        if (await restrictedAmong(tx, principal, assemblySources(assembly)))
          return failPending(tx, job, "export.includes_restricted_records");
        const ctx = ASSEMBLY_ACTOR(job.id, job.requested_by);
        const snapshot = await insertGeneratedSnapshot(tx, ctx, job.requested_by, assembly);
        const updated = await tx
          .updateTable("export_job")
          .set({ snapshot_id: snapshot.id, version: job.version + 1, updated_at: sql<Date>`now()` })
          .where("id", "=", job.id)
          .where("version", "=", job.version)
          .returningAll()
          .executeTakeFirstOrThrow();
        await record(tx, ctx, {
          action: "export_job.assemble",
          recordType: "export_job",
          recordId: job.id,
          organizationId: job.organization_id,
          transformationId: job.transformation_id,
          priorVersion: job.version,
          newVersion: updated.version,
          changes: { snapshot_id: { from: null, to: snapshot.id } },
        });
        await enqueueExportRequested(tx, job.organization_id, job.id);
        return { outcome: "assembled", exportJobId: job.id, snapshotId: snapshot.id };
      });
    } finally {
      // The session lock is released whatever happened (a broken connection has lost it already, and the pool
      // discards such a connection).
      if (lockedId !== null)
        await sql`SELECT pg_advisory_unlock(${ADVISORY_LOCK_CLASSES.exportJob}::int4, hashtext(${lockedId}::text))`
          .execute(conn)
          .catch(() => undefined);
    }
  });
}

/**
 * One watch step: EXPORT_ASSEMBLY_CONCURRENCY loops, each assembling the next free pending job until none is left
 * (or EXPORT_ASSEMBLY_BATCH per loop). Returns the outcomes (assembled or failed), in completion order.
 */
export async function exportAssemblyWatchStep(
  db: Db,
  options: { readonly onlyJobIds?: readonly string[]; readonly concurrency?: number } = {},
): Promise<AssemblyOutcome[]> {
  const out: AssemblyOutcome[] = [];
  const loop = async () => {
    for (let i = 0; i < EXPORT_ASSEMBLY_BATCH; i += 1) {
      const r = await assembleNextExport(db, options.onlyJobIds ?? null);
      if (r.outcome === "none") return;
      out.push(r);
    }
  };
  // Every loop runs to its end before the step settles (a failed loop never leaves another one running unobserved);
  // the first error is then rethrown, so the watch logs it and retries at the next tick.
  const settled = await Promise.allSettled(
    Array.from({ length: options.concurrency ?? EXPORT_ASSEMBLY_CONCURRENCY }, loop),
  );
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (failed !== undefined) throw failed.reason;
  return out;
}

export interface AssemblyWatchLogger {
  error(obj: object, msg: string): void;
}

export interface ExportAssemblyWatch {
  /** Runs a step now (or right after the running one): called after a 202 of a live selection. */
  kick(): void;
  stop(): Promise<void>;
}

/**
 * Starts the watch: a step every `intervalMs` and on `kick`, never two at once in this process. A failed step is
 * logged and retried at the next tick (the watch never stops the API). The timer is unref'd; `stop` waits for a step.
 */
export function startExportAssemblyWatch(
  db: Db,
  log: AssemblyWatchLogger,
  intervalMs = EXPORT_ASSEMBLY_INTERVAL_MS,
): ExportAssemblyWatch {
  let running: Promise<void> | null = null;
  let again = false;
  let stopped = false;
  const tick = () => {
    if (stopped) return;
    if (running !== null) {
      again = true;
      return;
    }
    running = exportAssemblyWatchStep(db)
      .then(() => undefined)
      .catch((err: unknown) =>
        log.error({ err: err instanceof Error ? err.message : String(err) }, "export assembly watch failed"),
      )
      .finally(() => {
        running = null;
        if (again && !stopped) {
          again = false;
          setImmediate(tick);
        }
      });
  };
  const timer = setInterval(tick, intervalMs);
  timer.unref();
  return {
    kick() {
      setImmediate(tick);
    },
    async stop() {
      stopped = true;
      clearInterval(timer);
      await running;
    },
  };
}
