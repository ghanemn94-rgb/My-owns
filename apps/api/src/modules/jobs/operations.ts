// The jobs operations view (OpenAPI tag "jobs"; ADR-0043 §6, §8, §9; REQ-S12-022 "store scheduled runs and execution
// outcomes in the database and expose last success, next run, failures and repair actions to authorized
// administrators"; p5-work-split §D.4; T-DG5-BE-I2):
//   GET  /admin/jobs                 listJobOperations  (job.read; ADM_TECH)
//   GET  /admin/jobs/{jobCode}       getJobOperation    (job.read; the job and its runs, newest first, paginated)
//   POST /admin/jobs/{jobCode}/run   runJobNow          (job.repair; ADM_TECH; 422 job.schedule_disabled)
// Stub created by T-DG5-BE-A; filled by T-DG5-BE-I2. DG4's GET/PATCH /admin/job-schedules are unchanged.
//
// Each job_schedule row is shown with:
//  - last success: the newest finished_at of a `succeeded` job_run, else null ("Never run"; never a time or "OK");
//  - last run / last outcome: the newest job_run of the schedule, else null;
//  - next run: the next instant matching the cron in the schedule's time zone after the request time
//    (@mth/shared/time nextCronRun, minute by minute up to 366 days); a disabled schedule is null with reason
//    `disabled`, a cron without a match in 366 days null with reason `unknown` (never a guessed time);
//  - open failures: the `open`/`retrying` operational_failure rows of the schedule (the repairs are BE-I's retry and
//    dismiss routes, job.repair);
//  - allowed actions for the caller: `run_now` (job.repair, schedule enabled), `retry_failures` (job.repair, at least
//    one `open` failure).
// The table is platform-wide (one deployment), so, as for the DG4 job schedules, a permission is required in the
// caller's own organization; a non-admin (TL, AUD) gets 403.
//
// Run now: one transaction re-checks job.repair on grants reloaded in it (commit-time authorization), locks the
// schedule row (FOR UPDATE: two requests for one job serialize), refuses a disabled schedule (422), and, unless a run
// now of this job was already requested in the same minute, writes the audit event `job_schedule.run_now` and the
// internal outbox event `job.run_requested` with idempotency key = the singleton key `run-now:<code>:<ISO minute>`.
// Nothing is sent to pg-boss inside the transaction: after COMMIT the relay delivers the event and the worker sends the
// schedule's own job to its queue under job id = the outbox event id (apps/worker/src/job-runs.ts). A second request in
// the same minute writes nothing and returns the same job id, so it sends one job. The run is recorded like a scheduled
// one (job_run). The request changes no versioned record, so it takes no If-Match (the contract declares none). A job
// only starts work; nothing here decides a business approval.
import { sql, type Db, type JobScheduleRow } from "@mth/db";
import type { Permission } from "@mth/shared";
import { jobCode, runNowSingletonKey, type JobOperation, type JobRun } from "@mth/shared/schemas";
import { nextCronRun } from "@mth/shared/time";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { auditContextOf, denialOf, principalOf, refreshPrincipal, type Principal } from "../access/index.ts";
import { record } from "../audit/index.ts";
import type { ModuleDeps } from "../platform/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  isoOrNull,
  limitSchema,
  paginate,
  parse,
  parseQuery,
  problems,
} from "../platform/index.ts";
import { enqueueOutboxEvent } from "./outbox.ts";

const BASE = "/api/v1/admin/jobs";
const ONE = `${BASE}/:jobCode`;
const RUN = `${BASE}/:jobCode/run`;
export const RUN_REQUESTED_EVENT = "job.run_requested";

/** ADR-0043 §9 (exact). */
export const jobOperationRefusals = {
  scheduleDisabled: () => problems.businessRule("job.schedule_disabled", "Enable the schedule before running it now."),
} as const;

/** `permission` in the caller's own organization (the DG4 job-schedules rule), else 403 with the denial attached. */
function requireInOwnOrganization(
  principal: Principal,
  permission: Permission,
): { userId: string; organizationId: string } {
  const org = principal.organizationId;
  if (holdsInOwnOrganization(principal, permission) && org !== null && principal.userId !== null)
    return { userId: principal.userId, organizationId: org };
  const denied = problems.forbidden();
  throw org === null
    ? denied
    : denied.withDenial(
        denialOf(permission, {
          level: "organization",
          organizationId: org,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

function holdsInOwnOrganization(principal: Principal, permission: Permission): boolean {
  principal.tracker.decisions += 1;
  const org = principal.organizationId;
  return org !== null && principal.grants.some((g) => g.permissions.has(permission) && g.organizationId === org);
}

interface ScheduleWithRuns extends JobScheduleRow {
  readonly last_success_at: Date | null;
  readonly last_run_at: Date | null;
  readonly last_outcome: string | null;
  readonly open_failures: string | number;
  readonly retryable_failures: string | number;
}

/** Every schedule (or one) with its run summary and failure counts, in one statement. */
function schedulesWithRuns(db: Db) {
  return db
    .selectFrom("job_schedule as s")
    .selectAll("s")
    .select((eb) => [
      eb
        .selectFrom("job_run as r")
        .whereRef("r.job_schedule_code", "=", "s.code")
        .where("r.outcome", "=", "succeeded")
        .select((e) => e.fn.max("r.finished_at").as("m"))
        .as("last_success_at"),
      eb
        .selectFrom("job_run as r")
        .whereRef("r.job_schedule_code", "=", "s.code")
        .select("r.finished_at")
        .orderBy("r.finished_at", "desc")
        .orderBy("r.id", "desc")
        .limit(1)
        .as("last_run_at"),
      eb
        .selectFrom("job_run as r")
        .whereRef("r.job_schedule_code", "=", "s.code")
        .select("r.outcome")
        .orderBy("r.finished_at", "desc")
        .orderBy("r.id", "desc")
        .limit(1)
        .as("last_outcome"),
      eb
        .selectFrom("operational_failure as f")
        .whereRef("f.job_schedule_code", "=", "s.code")
        .where("f.source", "=", "job")
        .where("f.status", "in", ["open", "retrying"])
        .select((e) => e.fn.countAll<string>().as("c"))
        .as("open_failures"),
      eb
        .selectFrom("operational_failure as f")
        .whereRef("f.job_schedule_code", "=", "s.code")
        .where("f.source", "=", "job")
        .where("f.status", "=", "open")
        .select((e) => e.fn.countAll<string>().as("c"))
        .as("retryable_failures"),
    ]);
}

/** The view of one schedule at `now` for `principal` (see the header). */
export function presentJobOperation(row: ScheduleWithRuns, now: Date, canRepair: boolean): JobOperation {
  const next = row.enabled ? nextCronRun(row.cron, row.timezone, now) : null;
  const openFailures = Number(row.open_failures ?? 0);
  const allowedActions: JobOperation["allowedActions"] = [];
  if (canRepair && row.enabled) allowedActions.push("run_now");
  if (canRepair && Number(row.retryable_failures ?? 0) > 0) allowedActions.push("retry_failures");
  return {
    code: row.code,
    queueName: row.queue_name,
    cron: row.cron,
    timezone: row.timezone,
    enabled: row.enabled,
    ownerModule: row.owner_module,
    descriptionEn: row.description_en,
    descriptionAr: row.description_ar,
    lastSuccessAt: isoOrNull(row.last_success_at === null ? null : new Date(row.last_success_at)),
    lastRunAt: isoOrNull(row.last_run_at === null ? null : new Date(row.last_run_at)),
    lastOutcome: row.last_outcome === "succeeded" || row.last_outcome === "failed" ? row.last_outcome : null,
    nextRunAt: isoOrNull(next),
    nextRunUnknownReason: !row.enabled ? "disabled" : next === null ? "unknown" : null,
    openFailures,
    allowedActions,
  };
}

const listQuery = z.strictObject({});
const detailQuery = z.strictObject({ cursor: cursorSchema, limit: limitSchema });
const codeParams = z.strictObject({ jobCode });

interface RunNowResult {
  readonly code: string;
  readonly jobId: string;
  readonly singletonKey: string;
  readonly queuedAt: string;
}

async function runNow(db: Db, request: FastifyRequest, code: string): Promise<RunNowResult> {
  return db.transaction().execute(async (tx) => {
    const actor = requireInOwnOrganization(await refreshPrincipal(tx, request), "job.repair");
    const schedule = await tx
      .selectFrom("job_schedule")
      .selectAll()
      .where("code", "=", code)
      .forUpdate()
      .executeTakeFirst();
    if (schedule === undefined) throw problems.notFound();
    if (!schedule.enabled) throw jobOperationRefusals.scheduleDisabled();
    const now = new Date();
    const singletonKey = runNowSingletonKey(schedule.code, now);
    const existing = await tx
      .selectFrom("outbox_event")
      .select(["id", "created_at"])
      .where("idempotency_key", "=", singletonKey)
      .executeTakeFirst();
    if (existing !== undefined)
      return { code: schedule.code, jobId: existing.id, singletonKey, queuedAt: iso(existing.created_at) };
    const jobId = await enqueueOutboxEvent(tx, {
      organizationId: actor.organizationId,
      aggregateType: "job_schedule",
      aggregateId: schedule.id,
      eventType: RUN_REQUESTED_EVENT,
      schemaVersion: 1,
      payload: {
        jobScheduleCode: schedule.code,
        queueName: schedule.queue_name,
        requestedBy: actor.userId,
        singletonKey,
      },
      idempotencyKey: singletonKey,
    });
    await record(tx, auditContextOf(request), {
      action: "job_schedule.run_now",
      recordType: "job_schedule",
      recordId: schedule.id,
      organizationId: actor.organizationId,
      changes: { run_now: { from: null, to: singletonKey } },
    });
    const queued = await tx
      .selectFrom("outbox_event")
      .select("created_at")
      .where("id", "=", jobId)
      .executeTakeFirstOrThrow();
    return { code: schedule.code, jobId, singletonKey, queuedAt: iso(queued.created_at) };
  });
}

/** Registers this file's routes and returns them as "METHOD /path". */
export function registerJobOperationRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;

  app.get(BASE, { config: { access: { permission: "job.read" } } }, async (request) => {
    parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireInOwnOrganization(principal, "job.read");
    const canRepair = holdsInOwnOrganization(principal, "job.repair");
    const now = new Date();
    const rows = (await schedulesWithRuns(db).orderBy("s.code").execute()) as ScheduleWithRuns[];
    return { items: rows.map((r) => presentJobOperation(r, now, canRepair)) };
  });

  app.get(ONE, { config: { access: { permission: "job.read" } } }, async (request) => {
    const { jobCode: code } = parse(codeParams, request.params, "params");
    const query = parseQuery(detailQuery, request.query);
    const principal = principalOf(request);
    requireInOwnOrganization(principal, "job.read");
    const canRepair = holdsInOwnOrganization(principal, "job.repair");
    const now = new Date();
    const row = (await schedulesWithRuns(db).where("s.code", "=", code).executeTakeFirst()) as
      | ScheduleWithRuns
      | undefined;
    if (row === undefined) throw problems.notFound();
    const hash = filterHash({ jobCode: code });
    const after = decodeCursor(query.cursor, hash, 2);
    let q = db
      .selectFrom("job_run")
      .select([
        "id",
        "job_id",
        "attempt_no",
        "outcome",
        "started_at",
        "finished_at",
        "error_code",
        sql<string>`to_char(finished_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("finished_key"),
      ])
      .where("job_schedule_code", "=", code);
    if (after) {
      const [finishedAt, id] = [String(after[0]), String(after[1])];
      q = q.where(sql<boolean>`(finished_at, id) < (${finishedAt}::timestamptz, ${id}::uuid)`);
    }
    const rows = await q
      .orderBy("finished_at", "desc")
      .orderBy("id", "desc")
      .limit(query.limit + 1)
      .execute();
    const page = paginate(rows, query.limit, (r) => [r.finished_key, r.id], hash);
    const runs: JobRun[] = page.items.map((r) => ({
      id: r.id,
      jobId: r.job_id,
      attemptNo: r.attempt_no,
      outcome: r.outcome === "failed" ? "failed" : "succeeded",
      startedAt: iso(r.started_at),
      finishedAt: iso(r.finished_at),
      errorCode: r.error_code,
    }));
    return { job: presentJobOperation(row, now, canRepair), runs, nextCursor: page.nextCursor };
  });

  app.post(RUN, { config: { access: { permission: "job.repair" } } }, async (request, reply) => {
    const { jobCode: code } = parse(codeParams, request.params, "params");
    principalOf(request);
    const result = await runNow(db, request, code);
    return reply.code(202).send(result);
  });

  return [`GET ${BASE}`, `GET ${ONE}`, `POST ${RUN}`];
}
