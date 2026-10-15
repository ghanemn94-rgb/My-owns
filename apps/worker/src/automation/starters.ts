// The sixteen starter automations as versioned rules, worker side (ADR-0044 §1; REQ-S12-001 note AN-04 "the engine
// must run all sixteen starter automations as versioned, configurable rules"; D-142 R3; p5-work-split §E.1; T-DG5-BE-J).
//
// `withStarterRule(ruleCode, handler)` wraps a DG4 (or P5) handler, registered in place of it on its OWN queue: the
// queue, the consumer name, the handler's runOnce key, its lock class and its outputs are those of the handler, which
// is called UNCHANGED (its return value is returned as it is). Around it the wrapper records the trigger occurrence as
// one `automation_execution` of the rule's EFFECTIVE (published) version:
//   1. trigger: an outbox job -> the envelope's event type and `idempotencyKey`; a scheduled job -> the schedule's
//      code and `<schedule code>:<ISO minute of the job's pg-boss createdOn>` (the key BE-I's failure capture gives
//      the same job, so a failure-queue retry of the job resumes this execution instead of opening another);
//   2. under advisory lock 730258 (`automationRuleExecution`, key `<versionId>:<triggerKey>`): insert the execution
//      `running` (UNIQUE automation_execution_once_key: a replay finds it); a finished execution is a duplicate and
//      records nothing more; a `failed` one (its job is being retried from the failure queue) moves to `running` with
//      attempt_no + 1;
//   3. call the handler (outside any transaction of the wrapper: it opens its own, as in DG4);
//   4. record one `automation_action_result` (action `starter_handler`, ordinal 1, key
//      `automation:<rule code>:<trigger key>:1`) with the handler's outcome (`done` -> done, `duplicate` -> existing,
//      `skipped` -> skipped) and finish the execution `succeeded`; when the handler throws on the job's LAST attempt,
//      the execution finishes `failed` (automation.retries_exhausted) before the error is rethrown. The failure itself
//      enters the failure queue as the JOB (worker.ts capture, source `job`): its retry re-sends the job, and step 2
//      resumes this execution. No second (rule_execution) queue row is written for a starter.
// A trigger the effective version does not name (never the case for the seeded starters) runs the handler unrecorded.
// Every row written has its audit event in the same transaction (actor `service`, source `worker`). No starter, and no
// wrapper, decides an approval, a gate, an investment or a Finance attestation (M0242); nothing here touches DG0-DG7.
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import type { JobAttempt, JobHandler } from "../handlers/spec.ts";
import { failureRetryJobId, jobActor } from "../kit.ts";
import { automationActionKey } from "./actions/common.ts";
import { AUTOMATION_RULE_EXECUTION_LOCK, RETRIES_EXHAUSTED } from "./engine.ts";

export const STARTER_HANDLER_ACTION = "starter_handler";

/**
 * Queue -> starter rule (0075 `p5_starter`; ADR-0044 §1 table). Starters 5, 14 (its accept path) and 15 are REQUEST
 * starters recorded in the API transaction (apps/api platform/request-executions.ts). A queue whose handler is not
 * registered yet (governance.meeting_cutoff_scan, BE-L2) is wrapped as soon as its handler is.
 */
export const STARTER_RULE_BY_QUEUE: Readonly<Record<string, string>> = {
  "transformation.created": "starter.transformation_created",
  "kpi.reporting_period_open": "starter.reporting_period_open",
  "kpi.recalculate": "starter.kpi_actual_accepted",
  "benefits.recalculate_pending": "starter.kpi_actual_accepted",
  "raid.corrective_kpi": "starter.kpi_deviation",
  "raid.corrective_benefit": "starter.kpi_deviation",
  "gates.submitted": "starter.gate_submission_routing",
  "gates.decided": "starter.gate_approved",
  "governance.decision_sla_scan": "starter.decision_sla",
  "approval.escalation_scan": "starter.decision_sla",
  "portfolio.dependency_slip": "starter.dependency_slip",
  "governance.blocker_escalation": "starter.blocker_red",
  "governance.blocker_escalation_scan": "starter.blocker_red",
  "benefits.finance_queue": "starter.benefit_evidence",
  "governance.meeting_cutoff_scan": "starter.meeting_cutoff",
  "raid.corrective_adoption": "starter.adoption_control_failed",
  "raid.corrective_control": "starter.adoption_control_failed",
  "adoption.indicator_evaluated": "starter.adoption_control_failed",
  "sustainment.review_scan": "starter.bau_handover_accepted",
  "sustainment.control_check_scan": "starter.bau_handover_accepted",
  "automation.job_failed": "starter.job_failed",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENVELOPE_KEYS = ["outboxEventId", "eventType", "schemaVersion", "idempotencyKey", "organizationId", "payload"];

export type StarterResultOutcome = "done" | "existing" | "skipped";

/**
 * The action-result outcome of a handler's return value: a string or an object `outcome` of `duplicate` is `existing`
 * (the effect was already there), `skipped` is `skipped`, anything else (`done`, a scan's counts) is `done`.
 */
export function starterOutcome(result: unknown): StarterResultOutcome {
  let o: unknown = result;
  if (result !== null && typeof result === "object" && !Array.isArray(result))
    o = new Map(Object.entries(result as Record<string, unknown>)).get("outcome");
  if (o === "duplicate") return "existing";
  if (o === "skipped") return "skipped";
  return "done";
}

export interface StarterOccurrence {
  readonly triggerCode: string;
  readonly triggerKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly organizationId: string | null;
  readonly transformationId: string | null;
}

/** The ISO minute a scheduled job belongs to: its failure's slot when it is a failure-queue retry, else its createdOn. */
async function scheduleSlotKey(db: Db, queue: string, scheduleCode: string, jobId: string): Promise<string> {
  const retrying = await db
    .selectFrom("operational_failure")
    .select(["id", "retry_count", "idempotency_key"])
    .where("source", "=", "job")
    .where("queue_name", "=", queue)
    .where("status", "in", ["retrying", "open"])
    .execute();
  const resent = retrying.find((f) => f.retry_count > 0 && failureRetryJobId(f.id, f.retry_count) === jobId);
  if (resent !== undefined) return resent.idempotency_key;
  let created: Date | null = null;
  if (UUID.test(jobId)) {
    const r = await sql<{
      created_on: Date;
    }>`SELECT created_on FROM pgboss.job WHERE id = ${jobId}::uuid AND name = ${queue}`
      .execute(db)
      .catch(() => ({ rows: [] as { created_on: Date }[] }));
    created = r.rows[0]?.created_on ?? null;
  }
  return `${scheduleCode}:${(created ?? new Date()).toISOString().slice(0, 16)}`;
}

/** The trigger occurrence of a job on a starter queue (step 1). */
export async function starterOccurrence(
  db: Db,
  queue: string,
  data: unknown,
  jobId: string,
): Promise<StarterOccurrence | null> {
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const m = new Map(Object.entries(data as Record<string, unknown>));
    if (ENVELOPE_KEYS.every((k) => m.has(k))) {
      const eventType = m.get("eventType");
      const key = m.get("idempotencyKey");
      const org = m.get("organizationId");
      const raw = m.get("payload");
      if (typeof eventType !== "string" || typeof key !== "string" || key.length < 1 || key.length > 200) return null;
      const payload =
        raw !== null && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      const t = new Map(Object.entries(payload)).get("transformationId");
      const organizationId = typeof org === "string" && UUID.test(org) ? org : null;
      return {
        triggerCode: eventType,
        triggerKey: key,
        payload,
        organizationId,
        transformationId: organizationId !== null && typeof t === "string" && UUID.test(t) ? t : null,
      };
    }
  }
  const schedule = await db
    .selectFrom("job_schedule")
    .select("code")
    .where("queue_name", "=", queue)
    .orderBy("code")
    .executeTakeFirst();
  if (schedule === undefined) return null;
  return {
    triggerCode: schedule.code,
    triggerKey: await scheduleSlotKey(db, queue, schedule.code, jobId),
    payload: {},
    organizationId: null,
    transformationId: null,
  };
}

interface StarterVersion {
  readonly ruleId: string;
  readonly ruleCode: string;
  readonly versionId: string;
  readonly triggerCodes: readonly string[];
}

/** The starter's effective (published) version; null when the rule is missing (never for the seeded starters). */
export async function effectiveStarterVersion(db: Db | Tx, ruleCode: string): Promise<StarterVersion | null> {
  const r = await db
    .selectFrom("automation_rule as r")
    .innerJoin("automation_rule_version as v", "v.id", "r.effective_version_id")
    .select(["r.id as ruleId", "r.code as ruleCode", "v.id as versionId", "v.trigger_codes as triggerCodes"])
    .where("r.code", "=", ruleCode)
    .where("r.origin", "=", "starter")
    .where("v.status", "=", "published")
    .executeTakeFirst();
  return r ?? null;
}

async function lock(tx: Tx, versionId: string, triggerKey: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${AUTOMATION_RULE_EXECUTION_LOCK}::integer, hashtext(${`${versionId}:${triggerKey}`}::text))`.execute(
    tx,
  );
}

const newId = async (tx: Tx) => (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;

interface Started {
  readonly executionId: string;
  readonly attemptNo: number;
  /** false: the execution already finished (a replay): nothing more is recorded. */
  readonly record: boolean;
}

/** Step 2: create the execution once, resume a failed one, or report a finished one. */
async function startStarterExecution(db: Db, v: StarterVersion, o: StarterOccurrence, jobId: string): Promise<Started> {
  return db.transaction().execute(async (tx) => {
    await lock(tx, v.versionId, o.triggerKey);
    const id = await newId(tx);
    const inserted = await tx
      .insertInto("automation_execution")
      .values({
        id,
        automation_rule_id: v.ruleId,
        automation_rule_version_id: v.versionId,
        trigger_code: o.triggerCode,
        trigger_key: o.triggerKey,
        trigger_payload: JSON.stringify(o.payload),
        organization_id: o.organizationId,
        transformation_id: o.transformationId,
        run_as: "service",
        initiating_user_id: null,
      })
      .onConflict((oc) => oc.constraint("automation_execution_once_key").doNothing())
      .returning(["id"])
      .executeTakeFirst();
    if (inserted) {
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "automation_execution.start",
        recordType: "automation_execution",
        recordId: id,
        organizationId: o.organizationId,
        transformationId: o.transformationId,
        newVersion: 1,
        changes: {
          automation_rule_version_id: { from: null, to: v.versionId },
          trigger_code: { from: null, to: o.triggerCode },
          trigger_key: { from: null, to: o.triggerKey },
        },
      });
      return { executionId: id, attemptNo: 1, record: true };
    }
    const cur = await tx
      .selectFrom("automation_execution")
      .select(["id", "status", "attempt_no", "version", "organization_id", "transformation_id"])
      .where("automation_rule_version_id", "=", v.versionId)
      .where("trigger_key", "=", o.triggerKey)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (cur.status === "running") return { executionId: cur.id, attemptNo: cur.attempt_no, record: true };
    if (cur.status !== "failed" || cur.attempt_no >= 100)
      return { executionId: cur.id, attemptNo: cur.attempt_no, record: false };
    const resumed = await tx
      .updateTable("automation_execution")
      .set({
        status: "running",
        attempt_no: cur.attempt_no + 1,
        conditions_met: null,
        error_code: null,
        error_detail: null,
        finished_at: null,
        version: cur.version + 1,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", cur.id)
      .where("version", "=", cur.version)
      .returning(["attempt_no", "version"])
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: "automation_execution.retry",
      recordType: "automation_execution",
      recordId: cur.id,
      organizationId: cur.organization_id,
      transformationId: cur.transformation_id,
      priorVersion: cur.version,
      newVersion: resumed.version,
      changes: {
        status: { from: "failed", to: "running" },
        attempt_no: { from: cur.attempt_no, to: resumed.attempt_no },
      },
    });
    return { executionId: cur.id, attemptNo: resumed.attempt_no, record: true };
  });
}

/** Step 4: the handler's result row and the execution's end, in one transaction. */
async function finishStarterExecution(
  db: Db,
  v: StarterVersion,
  o: StarterOccurrence,
  started: Started,
  jobId: string,
  end: { readonly outcome: StarterResultOutcome | "failed"; readonly errorDetail: string | null },
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lock(tx, v.versionId, o.triggerKey);
    const cur = await tx
      .selectFrom("automation_execution")
      .select(["status", "attempt_no", "version"])
      .where("id", "=", started.executionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (cur.status !== "running" || cur.attempt_no !== started.attemptNo) return;
    const key = automationActionKey({ ruleCode: v.ruleCode, triggerKey: o.triggerKey, ordinal: 1 });
    const done = await tx
      .selectFrom("automation_action_result")
      .select("id")
      .where("idempotency_key", "=", key)
      .where("outcome", "=", "done")
      .executeTakeFirst();
    // Layer 2 (0074 automation_action_result_effect_once_key): one `done` per key; a later run of the same key that
    // found its work done is `existing`.
    const outcome = end.outcome === "done" && done !== undefined ? "existing" : end.outcome;
    const resultId = await newId(tx);
    await tx
      .insertInto("automation_action_result")
      .values({
        id: resultId,
        automation_execution_id: started.executionId,
        attempt_no: started.attemptNo,
        ordinal: 1,
        action_type: STARTER_HANDLER_ACTION,
        idempotency_key: key,
        outcome,
        result_record_type: null,
        result_record_id: null,
        error_code: outcome === "failed" ? "automation.action_failed" : null,
      })
      .execute();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: "automation_action_result.create",
      recordType: "automation_action_result",
      recordId: resultId,
      organizationId: o.organizationId,
      transformationId: o.transformationId,
      changes: {
        automation_execution_id: { from: null, to: started.executionId },
        ordinal: { from: null, to: 1 },
        idempotency_key: { from: null, to: key },
        outcome: { from: null, to: outcome },
      },
    });
    const status = outcome === "failed" ? "failed" : "succeeded";
    const errorCode = outcome === "failed" ? RETRIES_EXHAUSTED : null;
    const updated = await tx
      .updateTable("automation_execution")
      .set({
        status,
        conditions_met: true,
        error_code: errorCode,
        error_detail: end.errorDetail === null ? null : end.errorDetail.slice(0, 2000),
        finished_at: sql<Date>`now()`,
        version: cur.version + 1,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", started.executionId)
      .where("version", "=", cur.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: `automation_execution.${status === "succeeded" ? "succeed" : "fail"}`,
      recordType: "automation_execution",
      recordId: started.executionId,
      organizationId: o.organizationId,
      transformationId: o.transformationId,
      priorVersion: cur.version,
      newVersion: updated.version,
      changes: {
        status: { from: "running", to: status },
        conditions_met: { from: null, to: true },
        error_code: { from: null, to: errorCode },
      },
    });
  });
}

const isLastAttempt = (a: JobAttempt | undefined) => a !== undefined && a.retryCount >= a.retryLimit;

/** Run one starter handler as an execution of its rule (steps 1-4). The handler's result is returned unchanged. */
export async function runAsStarter<T>(
  db: Db,
  ruleCode: string,
  queue: string,
  data: unknown,
  jobId: string,
  attempt: JobAttempt | undefined,
  handler: () => Promise<T>,
): Promise<T> {
  const v = await effectiveStarterVersion(db, ruleCode);
  const o = v === null ? null : await starterOccurrence(db, queue, data, jobId);
  if (v === null || o === null || !v.triggerCodes.includes(o.triggerCode)) return handler();
  const started = await startStarterExecution(db, v, o, jobId);
  if (!started.record) return handler();
  let result: T;
  try {
    result = await handler();
  } catch (err) {
    if (isLastAttempt(attempt))
      await finishStarterExecution(db, v, o, started, jobId, {
        outcome: "failed",
        errorDetail: err instanceof Error && err.message.trim().length > 0 ? err.message : "error",
      });
    throw err;
  }
  await finishStarterExecution(db, v, o, started, jobId, { outcome: starterOutcome(result), errorDetail: null });
  return result;
}

/** `withStarterRule(ruleCode, handler)`: the DG4 registration, same queue, recorded as an execution of the rule. */
export function withStarterRule(ruleCode: string, handler: JobHandler): JobHandler {
  return {
    queue: handler.queue,
    handle: (db, data, jobId, attempt) =>
      runAsStarter(db, ruleCode, handler.queue, data, jobId, attempt, () => handler.handle(db, data, jobId, attempt)),
  };
}

/** Every registered handler on a starter queue, wrapped; the others unchanged (handlers/index.ts). */
export function withStarterRules(handlers: readonly JobHandler[]): JobHandler[] {
  return handlers.map((h) => {
    const ruleCode = new Map(Object.entries(STARTER_RULE_BY_QUEUE)).get(h.queue);
    return ruleCode === undefined ? h : withStarterRule(ruleCode, h);
  });
}
