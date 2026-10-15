// Platform job handlers (ADR-0008 §3, §7; moved from src/handlers.ts by T-DG4-BE-A, p4-work-split §I+C.1). Each handler inserts its (consumer, idempotency_key) ledger row in the
// SAME transaction as its effects; a redelivery conflicts on the primary key and becomes a no-op, so retries and
// restarts never duplicate reminders, actions or approvals. Handlers act as a constrained SERVICE principal on behalf
// of the initiating user, and never approve anything.
import { insertAuditEvent, sql, type AuditActor, type Db, type Tx } from "@mth/db";
import {
  outboxEnvelope,
  transformationCreatedV1,
  transformationCreatedV2,
  type TransformationCreatedV2,
} from "@mth/shared/schemas";
import { workingDayDueDate } from "../automation/actions/items.ts";
import { LAUNCH_PLAN_PORT_UNAVAILABLE, launchPlanPort } from "../automation/ports/launch-plan.ts";
import { createWorkItemOnce } from "../kit.ts";

export const STARTER_AUTOMATION_CONSUMER = "starter_automation.v1";

export type HandlerOutcome = "done" | "skipped" | "duplicate";

/**
 * `transformation.created` -> starter automation 1 (REQ-S12-004, M0224). P1 recorded the request (ledger row plus one
 * audit event). P5 (T-DG5-BE-J; ADR-0044 §2) adds, in the SAME runOnce transaction, once per event:
 *  1. the phase checklist: the entry phase's `phase_step` rows `not_started` (the DG4 `gates.decided` insert: ON
 *     CONFLICT DO NOTHING on (transformation, step), one `phase_step.enable` audit event per row inserted);
 *  2. role-assignment tasks: for each source role SP, BO, WL, FIN and TO with no active transformation-scope assignment,
 *     one `role_assignment` work item to the creator, due `roleTaskDueWorkingDays` (starter 1's effective version,
 *     default 5) working days after the creation business date on the organization's default calendar (null, Unknown,
 *     when none exists; never elapsed days), dedupe `role_assignment:<transformationId>:<roleCode>`;
 *  3. the optional 90-day plan (v2 `launchPlan`): LaunchPlanPort.generate (key `launch_plan:<transformationId>`),
 *     a no-op until BE-P registers it (the audit reason names `automation.port_unavailable`).
 * The methodology and forms pins are made in the API create transaction (DG2, slice B). The v1 consumer is kept for
 * events in flight (launchPlan null). A replay is `duplicate` and writes nothing (ledger + dedupe keys + port key).
 */
export async function handleTransformationCreated(db: Db, data: unknown, jobId: string): Promise<HandlerOutcome> {
  const envelope = outboxEnvelope.parse(data);
  if (
    envelope.eventType !== "transformation.created" ||
    (envelope.schemaVersion !== 1 && envelope.schemaVersion !== 2)
  ) {
    throw new Error(`unexpected event ${envelope.eventType} v${envelope.schemaVersion} on transformation.created`);
  }
  const payload: TransformationCreatedV2 =
    envelope.schemaVersion === 2
      ? transformationCreatedV2.parse(envelope.payload)
      : { ...transformationCreatedV1.parse(envelope.payload), launchPlan: null };
  return db.transaction().execute(async (tx) => {
    const t = await tx
      .selectFrom("transformation")
      .select(["id", "archived_at", "current_phase", "timezone", "code"])
      .where("id", "=", payload.transformationId)
      .executeTakeFirst();
    const outcome = !t || t.archived_at !== null ? "skipped" : "done";
    const ledger = await tx
      .insertInto("processed_message")
      .values({ consumer: STARTER_AUTOMATION_CONSUMER, idempotency_key: envelope.idempotencyKey, outcome })
      .onConflict((oc) => oc.doNothing())
      .returning("consumer")
      .executeTakeFirst();
    if (!ledger) return "duplicate";
    const actor: AuditActor = {
      actorType: "service",
      actorUserId: null,
      onBehalfOfUserId: payload.createdBy,
      requestId: `job:${jobId}`,
      source: "worker",
    };
    const made =
      outcome === "done" && t
        ? await instantiateStarterContent(tx, actor, payload, { ...t, jobId })
        : { steps: 0, roleTasks: 0, launchPlan: "none" as const };
    await insertAuditEvent(tx, actor, {
      action:
        outcome === "done"
          ? "transformation.starter_automation_requested"
          : "transformation.starter_automation_skipped",
      recordType: "transformation",
      recordId: payload.transformationId,
      organizationId: payload.organizationId,
      transformationId: payload.transformationId,
      reason:
        outcome === "done"
          ? `Starter automation ran for ${payload.mode}${payload.entryPhase ? ` (entry phase ${payload.entryPhase})` : ""}: ${made.steps} phase checklist step(s), ${made.roleTasks} role-assignment task(s); 90-day plan: ${made.launchPlan}`
          : "Transformation missing or archived before the starter automation ran",
    });
    return outcome;
  });
}

/** Role codes whose holder the creator is asked to assign (ADR-0044 §2 step 2; the source roles of B0101). */
export const ROLE_TASK_ROLE_CODES = ["SP", "BO", "WL", "FIN", "TO"] as const;
export const ROLE_ASSIGNMENT_KIND = "role_assignment";
export const ROLE_ASSIGNMENT_MESSAGE = "transformations.task.role_assignment";
const DEFAULT_ROLE_TASK_DUE_WORKING_DAYS = 5;

/** The calendar date of an instant in a time zone (`YYYY-MM-DD`). */
function businessDateOf(instant: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(instant),
  );
}

async function instantiateStarterContent(
  tx: Tx,
  actor: AuditActor,
  p: TransformationCreatedV2,
  t: { readonly current_phase: string; readonly timezone: string; readonly code: string; readonly jobId: string },
): Promise<{ steps: number; roleTasks: number; launchPlan: string }> {
  // 1. The entry phase's checklist rows (End-to-End: diagnose; Modular: the selected entry phase).
  const entryPhase = p.entryPhase ?? t.current_phase;
  const definitions = await tx
    .selectFrom("phase_step_definition")
    .select(["key", "phase_code"])
    .where("phase_code", "=", entryPhase)
    .orderBy("ordinal")
    .execute();
  let steps = 0;
  for (const d of definitions) {
    const id = (await sql<{ id: string }>`SELECT mth_uuid_v7() AS id`.execute(tx)).rows[0]!.id;
    const inserted = await tx
      .insertInto("phase_step")
      .values({
        id,
        organization_id: p.organizationId,
        transformation_id: p.transformationId,
        step_key: d.key,
        phase_code: d.phase_code,
        status: "not_started",
        enabled_by_gate_decision_id: null,
        created_by: null,
        updated_by: null,
      })
      .onConflict((oc) => oc.constraint("phase_step_key").doNothing())
      .returning("id")
      .executeTakeFirst();
    if (!inserted) continue;
    steps += 1;
    await insertAuditEvent(tx, actor, {
      action: "phase_step.enable",
      recordType: "phase_step",
      recordId: id,
      organizationId: p.organizationId,
      transformationId: p.transformationId,
      newVersion: 1,
      changes: { step_key: { from: null, to: d.key }, enabled_by_gate_decision_id: { from: null, to: null } },
    });
  }

  // 2. Role-assignment tasks for the source roles nobody holds in the transformation yet.
  const held = await tx
    .selectFrom("scoped_assignment as a")
    .innerJoin("role as r", "r.id", "a.role_id")
    .select("r.code")
    .where("a.scope_type", "=", "transformation")
    .where("a.scope_id", "=", p.transformationId)
    .where("a.revoked_at", "is", null)
    .where((eb) => eb.or([eb("a.effective_to", "is", null), eb("a.effective_to", ">", sql<Date>`now()`)]))
    .execute();
  const heldCodes = new Set(held.map((h) => h.code));
  const version = await tx
    .selectFrom("automation_rule as r")
    .innerJoin("automation_rule_version as v", "v.id", "r.effective_version_id")
    .select("v.parameters")
    .where("r.code", "=", "starter.transformation_created")
    .executeTakeFirst();
  const configured = new Map(Object.entries((version?.parameters ?? {}) as Record<string, unknown>)).get(
    "roleTaskDueWorkingDays",
  );
  const dueWorkingDays =
    typeof configured === "number" && Number.isInteger(configured) && configured >= 1 && configured <= 30
      ? configured
      : DEFAULT_ROLE_TASK_DUE_WORKING_DAYS;
  const created = businessDateOf(p.occurredAt, t.timezone);
  const dueDate = await workingDayDueDate(tx, p.organizationId, created, dueWorkingDays);
  let roleTasks = 0;
  for (const roleCode of ROLE_TASK_ROLE_CODES) {
    if (heldCodes.has(roleCode)) continue;
    const w = await createWorkItemOnce(tx, actor, {
      organizationId: p.organizationId,
      transformationId: p.transformationId,
      kind: ROLE_ASSIGNMENT_KIND,
      assigneeUserId: p.createdBy,
      subjectType: "transformation",
      subjectId: p.transformationId,
      linkPath: `/transformations/${p.transformationId}/team`,
      messageKey: ROLE_ASSIGNMENT_MESSAGE,
      messageParams: { roleCode, transformationCode: t.code },
      dueDate,
      dedupeKey: `role_assignment:${p.transformationId}:${roleCode}`,
    });
    if (w.outcome === "created") roleTasks += 1;
  }

  // 3. The optional 90-day plan through the port (BE-P; no-op until then).
  let launchPlan = "not requested";
  if (p.launchPlan !== null) {
    const r = await launchPlanPort().generate(tx, {
      transformationId: p.transformationId,
      startDate: p.launchPlan.startDate,
      idempotencyKey: `launch_plan:${p.transformationId}`,
      jobId: t.jobId,
    });
    launchPlan =
      r.outcome === "port_unavailable"
        ? `requested from ${p.launchPlan.startDate}, not generated (${LAUNCH_PLAN_PORT_UNAVAILABLE})`
        : `${r.outcome} from ${p.launchPlan.startDate}`;
  }
  return { steps, roleTasks, launchPlan };
}

export interface PurgeResult {
  readonly sessions: number;
  readonly loginStates: number;
  readonly idempotencyRecords: number;
}

/** Maintenance: delete expired/revoked sessions, expired login states and expired Idempotency-Key records. */
export async function purgeExpired(db: Db): Promise<PurgeResult> {
  return db.transaction().execute(async (tx) => {
    const sessions = await tx
      .deleteFrom("session")
      .where((eb) =>
        eb.or([
          eb("absolute_expires_at", "<", sql<Date>`now()`),
          eb("idle_expires_at", "<", sql<Date>`now()`),
          eb("revoked_at", "<", sql<Date>`now() - interval '1 day'`),
        ]),
      )
      .executeTakeFirst();
    const states = await tx
      .deleteFrom("oidc_login_state")
      .where("expires_at", "<", sql<Date>`now()`)
      .executeTakeFirst();
    const idem = await tx
      .deleteFrom("idempotency_record")
      .where("expires_at", "<", sql<Date>`now()`)
      .executeTakeFirst();
    return {
      sessions: Number(sessions.numDeletedRows),
      loginStates: Number(states.numDeletedRows),
      idempotencyRecords: Number(idem.numDeletedRows),
    };
  });
}
