// The failure queue (OpenAPI tag `automation`; ADR-0043 §5, §8, §9; REQ-S12-002 "a failed execution appears in the queue
// and succeeds on retry without duplicating actions", REQ-S12-003, REQ-S12-020; p5-work-split §D.3; T-DG5-BE-I):
//   GET  /admin/automation-failures                     listAutomationFailures   (automation.read | job.read)
//   GET  /admin/automation-failures/{failureId}         getAutomationFailure     (automation.read | job.read)
//   POST /admin/automation-failures/{failureId}/retry   retryAutomationFailure   (automation.repair | job.repair; If-Match)
//   POST /admin/automation-failures/{failureId}/dismiss dismissAutomationFailure (automation.repair | job.repair; If-Match)
// Stub created by T-DG5-BE-A; filled by T-DG5-BE-I. This file also registers the execution history (executions.ts),
// so the module's registration lines (index.ts, routes.ts) stay unchanged.
//
// The worker writes the entries (apps/worker/src/kit.ts: a job's last failed attempt; a rule execution that finished
// `failed`, at once for automation.action_forbidden). Access by source (ADR-0043 §8): a `rule_execution` entry is read
// with `automation.read` and repaired with `automation.repair` in its organization; a `job` entry is read with
// `job.read` and repaired with `job.repair` (in its organization when it names one). Unreadable entries are 404.
//
// Retry (advisory lock class `failureRepair`, key = the entry id): one transaction moves the entry `open -> retrying`
// (retry_count + 1, at most 20), moves a failed execution `failed -> running` with attempt_no + 1, writes one audit
// event per row and the internal `automation_failure.retry_requested` outbox event. Nothing is sent to pg-boss inside
// the transaction: the relay delivers the event after COMMIT, and the worker's dispatcher resumes the execution (actions
// whose key already has a `done` result are skipped) or re-sends the job's original data to its original queue (its
// runOnce ledger skips completed work). The worker then marks the entry `resolved`, or `open` again if it fails.
// Dismiss records who, when and why. Every write re-checks the right on grants reloaded in its transaction, validates,
// requires If-Match (428/409) and audits. A failure is operational; nothing here decides a business approval.
import { sql, type DbOrTx, type OperationalFailureRow, type Tx } from "@mth/db";
import type { Permission } from "@mth/shared";
import { operationalFailureDismiss, operationalFailureListQuery, type OperationalFailure } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  auditContextOf,
  denialOf,
  holdsAnywhere,
  organizationsWith,
  principalOf,
  refreshPrincipal,
  type Principal,
} from "../access/index.ts";
import { record } from "../audit/index.ts";
import { enqueueOutboxEvent } from "../jobs/index.ts";
import type { HttpProblem } from "../platform/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
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
import { registerAutomationExecutionRoutes } from "./executions.ts";

const JSON_BODY = ["application/json"] as const;
export const FAILURES = "/api/v1/admin/automation-failures";
const ONE = `${FAILURES}/:failureId`;
const RETRY = `${ONE}/retry`;
const DISMISS = `${ONE}/dismiss`;
const failureParams = z.strictObject({ failureId: z.uuid() });
const listQuery = operationalFailureListQuery.extend({ cursor: cursorSchema, limit: limitSchema });

/** ADR-0043 §5: a failure is retried at most 20 times (0074 CHECK retry_count BETWEEN 0 AND 20). */
export const FAILURE_RETRY_LIMIT = 20;
export const RETRY_REQUESTED_EVENT = "automation_failure.retry_requested";

/** ADR-0043 §9, exact codes and English texts. */
export const failureRefusals = {
  notOpen: () =>
    problems.businessRule("automation_failure.not_open", "Only an open failure can be retried or dismissed."),
  retryLimit: () =>
    problems.businessRule(
      "automation_failure.retry_limit",
      "This failure has been retried 20 times; dismiss it or fix its cause first.",
    ),
};

// ------------------------------------------------------------------------------------------------ access

/** The read right of an entry's source (ADR-0043 §8). */
const readRight = (f: OperationalFailureRow): Permission =>
  f.source === "rule_execution" ? "automation.read" : "job.read";
/** The repair right of an entry's source (ADR-0043 §8). */
const repairRight = (f: OperationalFailureRow): Permission =>
  f.source === "rule_execution" ? "automation.repair" : "job.repair";

/** May the principal use `permission` on an entry of `organizationId` (null: a job naming no organization)? */
function holdsFor(principal: Principal, permission: Permission, organizationId: string | null): boolean {
  if (organizationId === null) return holdsAnywhere(principal, permission);
  return organizationsWith(principal, permission).includes(organizationId);
}

const mayRead = (p: Principal, f: OperationalFailureRow) => holdsFor(p, readRight(f), f.organization_id);
const mayRepair = (p: Principal, f: OperationalFailureRow) => holdsFor(p, repairRight(f), f.organization_id);

function denyRepair(f: OperationalFailureRow): HttpProblem {
  const permission = repairRight(f);
  const denied = problems.forbidden();
  return f.organization_id === null
    ? denied
    : denied.withDenial(
        denialOf(permission, {
          level: "organization",
          organizationId: f.organization_id,
          businessUnitId: null,
          transformationId: null,
          businessUnitAncestry: [],
        }),
      );
}

// ------------------------------------------------------------------------------------------------ presenter

export function presentFailure(f: OperationalFailureRow, principal: Principal): OperationalFailure {
  const allowed: ("retry" | "dismiss")[] = [];
  if (f.status === "open" && mayRepair(principal, f)) {
    if (f.retry_count < FAILURE_RETRY_LIMIT) allowed.push("retry");
    allowed.push("dismiss");
  }
  return {
    id: f.id,
    source: f.source as OperationalFailure["source"],
    organizationId: f.organization_id,
    executionId: f.automation_execution_id,
    jobScheduleCode: f.job_schedule_code,
    queueName: f.queue_name,
    jobId: f.job_id,
    idempotencyKey: f.idempotency_key,
    errorCode: f.error_code,
    errorMessage: f.error_message,
    attempts: f.attempts,
    firstFailedAt: iso(f.first_failed_at),
    lastFailedAt: iso(f.last_failed_at),
    status: f.status as OperationalFailure["status"],
    retryCount: f.retry_count,
    lastRetryBy: f.last_retry_by,
    lastRetryAt: f.last_retry_at === null ? null : iso(f.last_retry_at),
    resolvedAt: f.resolved_at === null ? null : iso(f.resolved_at),
    dismissedBy: f.dismissed_by,
    dismissedAt: f.dismissed_at === null ? null : iso(f.dismissed_at),
    dismissReason: f.dismiss_reason,
    allowedActions: allowed,
    version: f.version,
    updatedAt: iso(f.updated_at),
  };
}

/** `automation.read` or `job.read` held at any scope, else 403. */
function requireReader(principal: Principal): void {
  if (!holdsAnywhere(principal, "automation.read") && !holdsAnywhere(principal, "job.read")) throw problems.forbidden();
}

async function loadForRead(db: DbOrTx, principal: Principal, failureId: string): Promise<OperationalFailureRow> {
  const f = await db.selectFrom("operational_failure").selectAll().where("id", "=", failureId).executeTakeFirst();
  if (f === undefined || !mayRead(principal, f)) throw problems.notFound();
  return f;
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * Commit-time: grants reloaded in `tx`; a repair right held somewhere (else 403); the entry locked (`failureRepair`, then
 * FOR UPDATE); unreadable -> 404; readable without the repair right of its source and organization -> 403.
 */
async function loadForWrite(
  tx: Tx,
  request: FastifyRequest,
  failureId: string,
): Promise<{ failure: OperationalFailureRow; principal: Principal; userId: string }> {
  const principal = await refreshPrincipal(tx, request);
  if (
    principal.userId === null ||
    (!holdsAnywhere(principal, "automation.repair") && !holdsAnywhere(principal, "job.repair"))
  )
    throw problems.forbidden();
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.failureRepair}::int4, hashtext(${failureId}::text))`.execute(
    tx,
  );
  const failure = await tx
    .selectFrom("operational_failure")
    .selectAll()
    .where("id", "=", failureId)
    .forUpdate()
    .executeTakeFirst();
  if (failure === undefined || !mayRead(principal, failure)) throw problems.notFound();
  if (!mayRepair(principal, failure)) throw denyRepair(failure);
  return { failure, principal, userId: principal.userId };
}

async function retryFailure(tx: Tx, request: FastifyRequest, failureId: string): Promise<OperationalFailureRow> {
  const { failure: f, principal, userId } = await loadForWrite(tx, request, failureId);
  const expected = requireIfMatch(request);
  if (f.version !== expected) throw problems.versionConflict(f.version);
  if (f.status !== "open") throw failureRefusals.notOpen();
  if (f.retry_count >= FAILURE_RETRY_LIMIT) throw failureRefusals.retryLimit();
  // A rule execution resumes at its next attempt; only a failed execution can (0074 automation_execution_guard).
  if (f.source === "rule_execution") {
    const e = await tx
      .selectFrom("automation_execution")
      .select(["id", "status", "attempt_no", "version", "organization_id", "transformation_id"])
      .where("id", "=", f.automation_execution_id ?? "")
      .forUpdate()
      .executeTakeFirst();
    if (e === undefined || e.status !== "failed") throw failureRefusals.notOpen();
    const resumed = await tx
      .updateTable("automation_execution")
      .set({
        status: "running",
        attempt_no: e.attempt_no + 1,
        finished_at: null,
        error_code: null,
        error_detail: null,
        version: e.version + 1,
        updated_at: sql<Date>`now()`,
        updated_by: userId,
      })
      .where("id", "=", e.id)
      .where("version", "=", e.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, auditContextOf(request), {
      action: "automation_execution.retry",
      recordType: "automation_execution",
      recordId: e.id,
      organizationId: e.organization_id,
      transformationId: e.transformation_id,
      priorVersion: e.version,
      newVersion: resumed.version,
      changes: { status: { from: "failed", to: "running" }, attempt_no: { from: e.attempt_no, to: e.attempt_no + 1 } },
    });
  }
  const retryCount = f.retry_count + 1;
  const updated = await tx
    .updateTable("operational_failure")
    .set({
      status: "retrying",
      retry_count: retryCount,
      last_retry_by: userId,
      last_retry_at: sql<Date>`now()`,
      version: f.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", f.id)
    .where("version", "=", f.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "operational_failure.retry",
    recordType: "operational_failure",
    recordId: f.id,
    organizationId: f.organization_id,
    priorVersion: f.version,
    newVersion: updated.version,
    changes: { status: { from: "open", to: "retrying" }, retry_count: { from: f.retry_count, to: retryCount } },
  });
  // The outbox row needs an organization: the entry's, else (a job naming none) the requesting user's own.
  const organizationId = f.organization_id ?? principal.organizationId;
  if (organizationId === null) throw problems.forbidden();
  await enqueueOutboxEvent(tx, {
    organizationId,
    aggregateType: "operational_failure",
    aggregateId: f.id,
    eventType: RETRY_REQUESTED_EVENT,
    schemaVersion: 1,
    payload: { failureId: f.id, retryCount },
    idempotencyKey: `${RETRY_REQUESTED_EVENT}:${f.id}:${retryCount}`,
  });
  return updated;
}

async function dismissFailure(tx: Tx, request: FastifyRequest, failureId: string): Promise<OperationalFailureRow> {
  const { failure: f, userId } = await loadForWrite(tx, request, failureId);
  const body = parseBody(operationalFailureDismiss, request.body);
  const expected = requireIfMatch(request);
  if (f.version !== expected) throw problems.versionConflict(f.version);
  if (f.status !== "open") throw failureRefusals.notOpen();
  const updated = await tx
    .updateTable("operational_failure")
    .set({
      status: "dismissed",
      dismissed_by: userId,
      dismissed_at: sql<Date>`now()`,
      dismiss_reason: body.reason,
      version: f.version + 1,
      updated_at: sql<Date>`now()`,
      updated_by: userId,
    })
    .where("id", "=", f.id)
    .where("version", "=", f.version)
    .returningAll()
    .executeTakeFirstOrThrow();
  await record(tx, auditContextOf(request), {
    action: "operational_failure.dismiss",
    recordType: "operational_failure",
    recordId: f.id,
    organizationId: f.organization_id,
    priorVersion: f.version,
    newVersion: updated.version,
    reason: body.reason,
    changes: { status: { from: "open", to: "dismissed" } },
  });
  return updated;
}

// ------------------------------------------------------------------------------------------------ routes

const STATUS_RANK = sql<number>`CASE f.status WHEN 'open' THEN 0 WHEN 'retrying' THEN 1 ELSE 2 END`;

/** Registers the failure queue and the execution history and returns them as "METHOD /path". */
export function registerAutomationFailureRoutes(app: FastifyInstance, deps: ModuleDeps): string[] {
  const { db } = deps;
  const read = { access: { permission: "automation.read" as const } };
  const repair = { access: { permission: "automation.repair" as const } };

  app.get(FAILURES, { config: read }, async (request) => {
    const query = parseQuery(listQuery, request.query);
    const principal = principalOf(request);
    requireReader(principal);
    const ruleOrgs = organizationsWith(principal, "automation.read");
    const jobOrgs = organizationsWith(principal, "job.read");
    const jobAnywhere = jobOrgs.length > 0;
    const hash = filterHash({ source: query.source, status: query.status });
    const after = decodeCursor(query.cursor, hash, 3);
    let q = db
      .selectFrom("operational_failure as f")
      .selectAll("f")
      .select([
        STATUS_RANK.as("rank_key"),
        sql<string>`to_char(f.last_failed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`.as("failed_key"),
      ])
      .where((eb) =>
        eb.or([
          ruleOrgs.length === 0
            ? sql<boolean>`false`
            : eb.and([eb("f.source", "=", "rule_execution"), eb("f.organization_id", "in", ruleOrgs)]),
          !jobAnywhere
            ? sql<boolean>`false`
            : eb.and([
                eb("f.source", "=", "job"),
                eb.or([eb("f.organization_id", "is", null), eb("f.organization_id", "in", jobOrgs)]),
              ]),
        ]),
      );
    if (query.source !== undefined) q = q.where("f.source", "=", query.source);
    if (query.status !== undefined) q = q.where("f.status", "=", query.status);
    if (after) {
      const [rank, failedAt, id] = [Number(after[0]), String(after[1]), String(after[2])];
      q = q.where(
        sql<boolean>`(${STATUS_RANK} > ${rank} OR (${STATUS_RANK} = ${rank} AND (f.last_failed_at, f.id) < (${failedAt}::timestamptz, ${id}::uuid)))`,
      );
    }
    const rows = await q
      .orderBy(STATUS_RANK)
      .orderBy("f.last_failed_at", "desc")
      .orderBy("f.id", "desc")
      .limit(query.limit + 1)
      .execute();
    const pageRows = paginate(rows, query.limit, (r) => [Number(r.rank_key), r.failed_key, r.id], hash);
    return {
      items: pageRows.items.map(({ rank_key: _r, failed_key: _f, ...f }) => presentFailure(f, principal)),
      nextCursor: pageRows.nextCursor,
    };
  });

  app.get(ONE, { config: read }, async (request, reply) => {
    const { failureId } = parse(failureParams, request.params, "params");
    const principal = principalOf(request);
    requireReader(principal);
    return sendVersioned(reply, 200, presentFailure(await loadForRead(db, principal, failureId), principal));
  });

  app.post(RETRY, { config: repair }, async (request, reply) => {
    const { failureId } = parse(failureParams, request.params, "params");
    const row = await db.transaction().execute((tx) => retryFailure(tx, request, failureId));
    return sendVersioned(reply, 200, presentFailure(row, principalOf(request)));
  });

  app.post(DISMISS, { config: { ...repair, consumes: JSON_BODY } }, async (request, reply) => {
    const { failureId } = parse(failureParams, request.params, "params");
    const row = await db.transaction().execute((tx) => dismissFailure(tx, request, failureId));
    return sendVersioned(reply, 200, presentFailure(row, principalOf(request)));
  });

  return [
    ...registerAutomationExecutionRoutes(app, deps),
    `GET ${FAILURES}`,
    `GET ${ONE}`,
    `POST ${RETRY}`,
    `POST ${DISMISS}`,
  ];
}
