// The automation engine (ADR-0043 §2, §3, §5; REQ-S12-001 "each execution is recorded with rule version, trigger event
// and outcome"; REQ-S12-021 "the same event ×3 → one execution, one task"; p5-work-split §D.2; T-DG5-BE-H2).
//
// Evaluation of one trigger occurrence (an outbox event on queue automation.evaluate, or an engine tick):
//  1. candidates: every ENABLED ADMIN rule whose effective (published) version names the trigger and whose scope holds
//     the occurrence (its organization; for a transformation-scoped rule, its transformation). Starters keep their
//     DG4 queues and handlers (ADR-0044 §1), so the engine never runs a starter;
//  2. per rule, under advisory lock 730258 (`automationRuleExecution`, key `<ruleVersionId>:<triggerKey>`): insert the
//     execution (`running`, attempt 1). UNIQUE automation_execution_once_key (rule version, trigger key) makes a
//     second insert impossible: a replay finds the execution; a finished one is a duplicate and does nothing, a
//     `running` one (a crash or a pg-boss retry) resumes;
//  3. conditions (the twin of the API's conditions.ts; decimal.js; Unknown is never 0): not met -> `skipped`
//     (conditions_met = false; an unusable value is named in error_detail as automation.condition_unknown_value);
//  4. each action in ITS OWN transaction under the same lock, atomically with its automation_action_result row:
//     an action whose key already has a `done` result (or a result in this attempt) is not run again (layer 2,
//     partial UNIQUE automation_action_result_effect_once_key); the effect's own dedupe key is layer 3;
//  5. finish: `succeeded`, or `failed` with the first action error (`automation.action_forbidden` is never retried:
//     ADR-0043 §3). On the LAST pg-boss attempt a thrown error marks the execution `failed` with
//     `automation.retries_exhausted` before it is rethrown, so the job still reaches ops.failed (ADR-0008 §4).
//     Capturing failures into the failure queue (operational_failure) is BE-I's (p5-work-split §D.3).
// Trigger keys: the envelope's idempotencyKey for events; `<schedule code>:<ISO minute of the slot>` for ticks.
// Audit: actor `service`, source `worker` (jobActor); one audit event per execution/result row written (P2 guard).
// No remote I/O inside a transaction. The engine never approves anything: human-only actions are refused by the API,
// by 0074 on the version and again on any result (REQ-S12-026), and no executor exists for them.
import { insertAuditEvent, sql, type Db, type Tx } from "@mth/db";
import type { AutomationCondition } from "@mth/shared/schemas";
import { FORMULA_DECIMAL as D } from "@mth/shared/calc";
import type { JobAttempt } from "../handlers/spec.ts";
import { jobActor } from "../kit.ts";
import {
  automationActionKey,
  type ActionEffect,
  type WorkerActionContext,
  type WorkerIdentity,
} from "./actions/common.ts";
import { CREATE_TASK, executeCreateTask } from "./actions/create-task.ts";
import { ESCALATE, executeEscalate } from "./actions/escalate.ts";
import { executeNotify, NOTIFY } from "./actions/notify.ts";

/** ADR-0016 §6 / apps/api platform/advisory-locks.ts `automationRuleExecution` (the worker imports no API code). */
export const AUTOMATION_RULE_EXECUTION_LOCK = 730258;
export const AUTOMATION_EVALUATE_QUEUE = "automation.evaluate";
export const AUTOMATION_TICK_HOURLY = "automation.tick_hourly";
export const AUTOMATION_TICK_DAILY = "automation.tick_daily";
export const CONDITION_UNKNOWN_VALUE = "automation.condition_unknown_value";
export const RETRIES_EXHAUSTED = "automation.retries_exhausted";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ------------------------------------------------------------------------------------------------ conditions (twin)

const PAYLOAD_DECIMAL = /^-?[0-9]{1,24}(\.[0-9]{1,12})?$/;
const CONDITION_DECIMAL = /^-?(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/;

function scalarOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isSafeInteger(value) ? String(value) : null;
  return null;
}

function evaluateOne(c: AutomationCondition, payload: Readonly<Record<string, unknown>>): boolean | "unknown" {
  const raw = Object.prototype.hasOwnProperty.call(payload, c.field)
    ? new Map(Object.entries(payload)).get(c.field)
    : undefined;
  const present = raw !== undefined && raw !== null;
  switch (c.op) {
    case "present":
      return present;
    case "absent":
      return !present;
    case "eq":
    case "neq": {
      if (!present) return "unknown";
      let equal: boolean;
      if (typeof c.value === "boolean") equal = raw === c.value;
      else {
        const s = scalarOf(raw);
        if (s === null) return "unknown";
        equal = s === c.value;
      }
      return c.op === "eq" ? equal : !equal;
    }
    case "in": {
      if (!present) return "unknown";
      const s = scalarOf(raw);
      if (s === null) return "unknown";
      return Array.isArray(c.value) && c.value.includes(s);
    }
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      const s = scalarOf(raw);
      const left = s !== null && PAYLOAD_DECIMAL.test(s) ? s : null;
      if (left === null || typeof c.value !== "string" || !CONDITION_DECIMAL.test(c.value)) return "unknown";
      const cmp = new D(left).comparedTo(new D(c.value));
      if (c.op === "gt") return cmp > 0;
      if (c.op === "gte") return cmp >= 0;
      if (c.op === "lt") return cmp < 0;
      return cmp <= 0;
    }
    default:
      return "unknown";
  }
}

/**
 * The twin of apps/api/src/modules/automation/conditions.ts `evaluateConditions` (parity test in
 * apps/api/test/integration/automation/automation-engine.test.ts): all must hold; an unusable value is not met, with
 * a finding naming the condition.
 */
export function evaluateConditions(
  conditions: readonly AutomationCondition[],
  payload: Readonly<Record<string, unknown>>,
): { met: boolean; findings: { code: string; pointer: string; field: string }[] } {
  let met = true;
  const findings: { code: string; pointer: string; field: string }[] = [];
  conditions.forEach((c, i) => {
    const r = evaluateOne(c, payload);
    if (r === "unknown") {
      met = false;
      findings.push({ code: CONDITION_UNKNOWN_VALUE, pointer: `/conditions/${i}`, field: c.field });
    } else if (!r) met = false;
  });
  return { met, findings };
}

// ------------------------------------------------------------------------------------------------ executors

type Executor = (tx: Tx, ctx: WorkerActionContext, parameters: unknown) => Promise<ActionEffect>;

/** The automatic actions the worker executes (each the twin of its API planner). */
export const AUTOMATION_EXECUTORS: ReadonlyMap<string, Executor> = new Map<string, Executor>([
  [CREATE_TASK, executeCreateTask],
  [NOTIFY, executeNotify],
  [ESCALATE, executeEscalate],
]);

// ------------------------------------------------------------------------------------------------ candidates

export interface Candidate {
  readonly ruleId: string;
  readonly ruleCode: string;
  readonly ruleName: string;
  readonly scopeLevel: "platform" | "organization" | "transformation";
  readonly organizationId: string;
  readonly transformationId: string | null;
  readonly versionId: string;
  readonly conditions: AutomationCondition[];
  readonly actions: { type: string; parameters?: Record<string, unknown> }[];
  readonly runAs: "initiating_user" | "service";
  readonly servicePermissionCodes: string[];
}

export async function candidates(
  db: Db,
  triggerCode: string,
  where: { organizationId: string; transformationId: string | null } | null,
): Promise<Candidate[]> {
  let q = db
    .selectFrom("automation_rule as r")
    .innerJoin("automation_rule_version as v", "v.id", "r.effective_version_id")
    .select([
      "r.id as ruleId",
      "r.code as ruleCode",
      "r.name_en as ruleName",
      "r.scope_level as scopeLevel",
      "r.organization_id as organizationId",
      "r.transformation_id as transformationId",
      "v.id as versionId",
      "v.conditions",
      "v.actions",
      "v.run_as as runAs",
      "v.service_permission_codes as servicePermissionCodes",
    ])
    .where("r.enabled", "=", true)
    .where("r.origin", "=", "admin")
    .where("v.status", "=", "published")
    .where(sql<boolean>`${triggerCode} = ANY (v.trigger_codes)`);
  if (where !== null) {
    q = q.where("r.organization_id", "=", where.organizationId);
    q = q.where((eb) =>
      eb.or([
        eb("r.scope_level", "=", "organization"),
        where.transformationId === null ? sql<boolean>`false` : eb("r.transformation_id", "=", where.transformationId),
      ]),
    );
  }
  const rows = await q.orderBy("r.code").execute();
  return rows.map((r) => ({
    ...r,
    organizationId: r.organizationId as string,
    scopeLevel: r.scopeLevel as Candidate["scopeLevel"],
    conditions: r.conditions as AutomationCondition[],
    actions: r.actions as Candidate["actions"],
    runAs: r.runAs as Candidate["runAs"],
  }));
}

// ------------------------------------------------------------------------------------------------ one execution

export interface Occurrence {
  readonly triggerCode: string;
  readonly triggerKey: string;
  readonly payload: Readonly<Record<string, unknown>>;
  /** The occurrence's transformation (an event's payload `transformationId`; a tick: the rule's own). */
  readonly transformationId: string | null;
}

export type ExecutionOutcome = "succeeded" | "skipped" | "failed" | "duplicate";

export interface ExecutionReport {
  readonly ruleCode: string;
  readonly executionId: string;
  readonly outcome: ExecutionOutcome;
}

const lockKey = (versionId: string, triggerKey: string) => `${versionId}:${triggerKey}`;

async function lock(tx: Tx, key: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${AUTOMATION_RULE_EXECUTION_LOCK}::integer, hashtext(${key}::text))`.execute(
    tx,
  );
}

async function nextId(tx: Tx): Promise<string> {
  return (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
}

interface ExecutionRow {
  readonly id: string;
  readonly status: string;
  readonly attempt_no: number;
  readonly version: number;
}

/** Step 2: the execution of (version, trigger key), created once; `null` when it already finished (a duplicate). */
async function startExecution(
  db: Db,
  c: Candidate,
  o: Occurrence,
  initiatingUserId: string | null,
  jobId: string,
): Promise<{ row: ExecutionRow; created: boolean }> {
  return db.transaction().execute(async (tx) => {
    await lock(tx, lockKey(c.versionId, o.triggerKey));
    const id = await nextId(tx);
    const inserted = await tx
      .insertInto("automation_execution")
      .values({
        id,
        automation_rule_id: c.ruleId,
        automation_rule_version_id: c.versionId,
        trigger_code: o.triggerCode,
        trigger_key: o.triggerKey,
        trigger_payload: JSON.stringify(o.payload),
        organization_id: c.organizationId,
        transformation_id: c.scopeLevel === "transformation" ? c.transformationId : o.transformationId,
        run_as: c.runAs,
        initiating_user_id: initiatingUserId,
      })
      .onConflict((oc) => oc.constraint("automation_execution_once_key").doNothing())
      .returning(["id", "status", "attempt_no", "version"])
      .executeTakeFirst();
    if (inserted) {
      await insertAuditEvent(tx, jobActor(jobId), {
        action: "automation_execution.start",
        recordType: "automation_execution",
        recordId: id,
        organizationId: c.organizationId,
        transformationId: c.scopeLevel === "transformation" ? c.transformationId : o.transformationId,
        newVersion: 1,
        changes: {
          automation_rule_version_id: { from: null, to: c.versionId },
          trigger_code: { from: null, to: o.triggerCode },
          trigger_key: { from: null, to: o.triggerKey },
        },
      });
      return { row: inserted, created: true };
    }
    const existing = await tx
      .selectFrom("automation_execution")
      .select(["id", "status", "attempt_no", "version"])
      .where("automation_rule_version_id", "=", c.versionId)
      .where("trigger_key", "=", o.triggerKey)
      .executeTakeFirstOrThrow();
    return { row: existing, created: false };
  });
}

async function finishExecution(
  db: Db,
  executionId: string,
  c: Candidate,
  o: Occurrence,
  jobId: string,
  set: {
    status: "succeeded" | "skipped" | "failed";
    conditionsMet: boolean;
    errorCode: string | null;
    errorDetail: string | null;
  },
): Promise<void> {
  await db.transaction().execute(async (tx) => {
    await lock(tx, lockKey(c.versionId, o.triggerKey));
    const cur = await tx
      .selectFrom("automation_execution")
      .select(["status", "version", "organization_id", "transformation_id"])
      .where("id", "=", executionId)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (cur.status !== "running") return;
    const updated = await tx
      .updateTable("automation_execution")
      .set({
        status: set.status,
        conditions_met: set.conditionsMet,
        error_code: set.errorCode,
        error_detail: set.errorDetail === null ? null : set.errorDetail.slice(0, 2000),
        finished_at: sql<Date>`now()`,
        version: cur.version + 1,
        updated_at: sql<Date>`now()`,
      })
      .where("id", "=", executionId)
      .where("version", "=", cur.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: `automation_execution.${set.status === "succeeded" ? "succeed" : set.status === "skipped" ? "skip" : "fail"}`,
      recordType: "automation_execution",
      recordId: executionId,
      organizationId: cur.organization_id,
      transformationId: cur.transformation_id,
      priorVersion: cur.version,
      newVersion: updated.version,
      changes: {
        status: { from: "running", to: set.status },
        conditions_met: { from: null, to: set.conditionsMet },
        error_code: { from: null, to: set.errorCode },
      },
    });
  });
}

/** Step 4: one action, atomically with its result row; an action already done (or recorded this attempt) is skipped. */
async function runAction(
  db: Db,
  c: Candidate,
  o: Occurrence,
  execution: ExecutionRow,
  ordinal: number,
  identity: WorkerIdentity,
  triggerLabel: string,
  jobId: string,
): Promise<{ outcome: ActionEffect["outcome"] | "already"; errorCode: string | null }> {
  const action = c.actions[ordinal - 1]!;
  return db.transaction().execute(async (tx) => {
    await lock(tx, lockKey(c.versionId, o.triggerKey));
    const key = automationActionKey({ ruleCode: c.ruleCode, triggerKey: o.triggerKey, ordinal });
    const previous = await tx
      .selectFrom("automation_action_result")
      .select(["outcome", "error_code", "automation_execution_id", "attempt_no"])
      .where("idempotency_key", "=", key)
      .execute();
    const done = previous.find((r) => r.outcome === "done");
    if (done !== undefined) return { outcome: "already" as const, errorCode: null };
    const thisAttempt = previous.find(
      (r) => r.automation_execution_id === execution.id && r.attempt_no === execution.attempt_no,
    );
    if (thisAttempt !== undefined)
      return {
        outcome: thisAttempt.outcome as ActionEffect["outcome"],
        errorCode: thisAttempt.error_code,
      };
    const ctx: WorkerActionContext = {
      ruleCode: c.ruleCode,
      ruleName: c.ruleName,
      triggerCode: o.triggerCode,
      triggerLabel,
      triggerKey: o.triggerKey,
      ordinal,
      scope: { level: c.scopeLevel, organizationId: c.organizationId, transformationId: c.transformationId },
      transformationId: o.transformationId,
      identity,
      executionId: execution.id,
      jobId,
    };
    const executor = AUTOMATION_EXECUTORS.get(action.type);
    const effect: ActionEffect =
      executor === undefined
        ? {
            outcome: "failed",
            resultRecordType: null,
            resultRecordId: null,
            errorCode: "automation.action_failed",
            planned: {
              ordinal,
              actionType: action.type,
              outcome: "invalid",
              target: {},
              idempotencyKey: key,
              messageKey: null,
            },
          }
        : await executor(tx, ctx, action.parameters ?? {});
    const resultId = await nextId(tx);
    await tx
      .insertInto("automation_action_result")
      .values({
        id: resultId,
        automation_execution_id: execution.id,
        attempt_no: execution.attempt_no,
        ordinal,
        action_type: action.type,
        idempotency_key: key,
        outcome: effect.outcome,
        result_record_type: effect.resultRecordType,
        result_record_id: effect.resultRecordId,
        error_code: effect.errorCode,
      })
      .execute();
    await insertAuditEvent(tx, jobActor(jobId), {
      action: "automation_action_result.create",
      recordType: "automation_action_result",
      recordId: resultId,
      organizationId: c.organizationId,
      transformationId: c.scopeLevel === "transformation" ? c.transformationId : o.transformationId,
      changes: {
        automation_execution_id: { from: null, to: execution.id },
        ordinal: { from: null, to: ordinal },
        idempotency_key: { from: null, to: key },
        outcome: { from: null, to: effect.outcome },
      },
    });
    return { outcome: effect.outcome, errorCode: effect.errorCode };
  });
}

const isLastAttempt = (a: JobAttempt | undefined) => a !== undefined && a.retryCount >= a.retryLimit;

async function triggerLabelOf(db: Db, triggerCode: string): Promise<{ label: string; userField: string | null }> {
  const t = await db
    .selectFrom("automation_trigger")
    .select(["label_en", "initiating_user_field"])
    .where("code", "=", triggerCode)
    .executeTakeFirst();
  return { label: t?.label_en ?? triggerCode, userField: t?.initiating_user_field ?? null };
}

/** Steps 2-5 for one rule. */
export async function executeRule(
  db: Db,
  c: Candidate,
  o: Occurrence,
  jobId: string,
  attempt?: JobAttempt,
): Promise<ExecutionReport> {
  const trig = await triggerLabelOf(db, o.triggerCode);
  let identity: WorkerIdentity;
  let initiatingUserId: string | null = null;
  if (c.runAs === "initiating_user") {
    const raw = trig.userField === null ? undefined : new Map(Object.entries(o.payload)).get(trig.userField);
    // The version is valid only for triggers that name a user (0074 AV03); a payload without one is a data error.
    if (typeof raw !== "string" || !UUID.test(raw))
      throw new Error(`automation: ${o.triggerCode} payload names no initiating user for rule ${c.ruleCode}`);
    initiatingUserId = raw;
    identity = { runAs: "initiating_user", userId: raw };
  } else identity = { runAs: "service", permissions: c.servicePermissionCodes };

  const { row } = await startExecution(db, c, o, initiatingUserId, jobId);
  if (row.status !== "running") return { ruleCode: c.ruleCode, executionId: row.id, outcome: "duplicate" };
  try {
    const conditions = evaluateConditions(c.conditions, o.payload);
    if (!conditions.met) {
      await finishExecution(db, row.id, c, o, jobId, {
        status: "skipped",
        conditionsMet: false,
        errorCode: null,
        errorDetail:
          conditions.findings.length === 0
            ? null
            : `${CONDITION_UNKNOWN_VALUE}: ${conditions.findings.map((f) => f.field).join(", ")}`,
      });
      return { ruleCode: c.ruleCode, executionId: row.id, outcome: "skipped" };
    }
    let firstError: string | null = null;
    for (let ordinal = 1; ordinal <= c.actions.length; ordinal += 1) {
      const r = await runAction(db, c, o, row, ordinal, identity, trig.label, jobId);
      if (r.errorCode !== null) firstError ??= r.errorCode;
    }
    await finishExecution(db, row.id, c, o, jobId, {
      status: firstError === null ? "succeeded" : "failed",
      conditionsMet: true,
      errorCode: firstError,
      errorDetail: null,
    });
    return { ruleCode: c.ruleCode, executionId: row.id, outcome: firstError === null ? "succeeded" : "failed" };
  } catch (err) {
    if (isLastAttempt(attempt))
      await finishExecution(db, row.id, c, o, jobId, {
        status: "failed",
        conditionsMet: true,
        errorCode: RETRIES_EXHAUSTED,
        errorDetail: err instanceof Error && err.message.length > 0 ? err.message : "error",
      });
    throw err;
  }
}

// ------------------------------------------------------------------------------------------------ entry points

/** An outbox event on automation.evaluate: every candidate rule, in code order. */
export async function evaluateEvent(
  db: Db,
  envelope: { eventType: string; idempotencyKey: string; organizationId: string; payload: Record<string, unknown> },
  jobId: string,
  attempt?: JobAttempt,
): Promise<ExecutionReport[]> {
  const t = new Map(Object.entries(envelope.payload)).get("transformationId");
  const transformationId = typeof t === "string" && UUID.test(t) ? t : null;
  const rules = await candidates(db, envelope.eventType, { organizationId: envelope.organizationId, transformationId });
  const out: ExecutionReport[] = [];
  for (const c of rules)
    out.push(
      await executeRule(
        db,
        c,
        {
          triggerCode: envelope.eventType,
          triggerKey: envelope.idempotencyKey,
          payload: envelope.payload,
          transformationId,
        },
        jobId,
        attempt,
      ),
    );
  return out;
}

/**
 * The slot of a tick: the start of the hour (hourly) or of the business day in the schedule's time zone (daily), as
 * an ISO minute. Every attempt of one tick job (pg-boss retries finish within minutes) falls in the same slot, so a
 * retry reuses the trigger key and never runs a rule twice for one slot.
 */
export function tickSlot(scheduleCode: string, now: Date, timeZone: string): string {
  if (scheduleCode === AUTOMATION_TICK_HOURLY) {
    const d = new Date(now);
    d.setUTCMinutes(0, 0, 0);
    return d.toISOString().slice(0, 16);
  }
  // The business date in the zone, then its midnight in the zone as an instant (offset from the zone's own clock).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? "0");
  const localMs = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"));
  const offsetMs = localMs - Math.floor(now.getTime() / 60_000) * 60_000;
  const midnightLocal = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(midnightLocal - offsetMs).toISOString().slice(0, 16);
}

/** An engine tick: every candidate rule naming the tick, each in its own scope (payload {}). */
export async function evaluateTick(
  db: Db,
  scheduleCode: typeof AUTOMATION_TICK_HOURLY | typeof AUTOMATION_TICK_DAILY,
  jobId: string,
  attempt?: JobAttempt,
  now: Date = new Date(),
): Promise<ExecutionReport[]> {
  const schedule = await db
    .selectFrom("job_schedule")
    .select("timezone")
    .where("code", "=", scheduleCode)
    .executeTakeFirst();
  const triggerKey = `${scheduleCode}:${tickSlot(scheduleCode, now, schedule?.timezone ?? "Asia/Riyadh")}`;
  const rules = await candidates(db, scheduleCode, null);
  const out: ExecutionReport[] = [];
  for (const c of rules)
    out.push(
      await executeRule(
        db,
        c,
        { triggerCode: scheduleCode, triggerKey, payload: {}, transformationId: c.transformationId },
        jobId,
        attempt,
      ),
    );
  return out;
}
