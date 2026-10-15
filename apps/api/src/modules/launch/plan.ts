// The 90-day launch plan (P5 slice H; ADR-0048 §1-§2, §7-§9; REQ-PB-086, REQ-S14-004; p5-work-split §H.1; T-DG5-BE-P):
//   GET   /transformations/{t}/launch-plan     getLaunchPlan       (transformation.read; 404 when none was generated)
//   POST  /transformations/{t}/launch-plan     generateLaunchPlan  (launch_plan.edit; TL, TO; 409 launch_plan.exists)
//   PATCH /transformations/{t}/launch-plan     updateLaunchPlan    (launch_plan.edit; If-Match on the plan)
//
// GENERATION (one transaction, lock class launchPlan on the transformation): the plan, one `launch_task` per
// `launch_template_item` (the 17 B0134 actions, the 15 B0134 outputs and the Day-90 test, each title verbatim), and the
// plan's `day_ninety_test`. Day d is the start date + d CALENDAR days (D-142 Q6): a task's start date is start +
// start_day, its due date start + due_day, the test's scheduled date start + 90. A date that falls on a non-working day
// is flagged on read (tasks.ts `nonWorkingDay`) and never shifted. The core (`generateLaunchPlanInTx`) depends only on
// @mth/db, so the S12-004 port (port.ts) and the request share it; a replay finds the existing plan under the lock and
// writes nothing, and the UNIQUE keys (`launch_plan_transformation_key`, `launch_plan_idempotency_key`) are the backstop.
//
// RE-DATING (updateLaunchPlan): with delta = new start - old start, every `not_started` task moves its start and due
// dates by delta (one version step and one audit event each), in-progress, completed and cancelled tasks keep their
// dates, an open Day-90 test moves its scheduled date by delta, and the plan records `last_shift_days = delta`
// (`launch_plan_shift_recorded`). An unchanged start date writes nothing.
//
// Every mutation re-checks authorization at commit time on grants reloaded in the transaction (AUD and a caller without
// launch_plan.edit get 403), validates, needs If-Match (428/409; generation creates version 1), writes one audit event
// per row in the same transaction, and does no remote I/O. Nothing here is a G1-G6 business approval or touches DG0-DG7.
import { insertAuditEvent, sql, type AuditActor, type DbOrTx, type Tx } from "@mth/db";
import { launchPlanCreate, launchPlanUpdate, type LaunchPlan } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import {
  ADVISORY_LOCK_CLASSES,
  iso,
  parse,
  parseBody,
  problems,
  requireIfMatch,
  sendVersioned,
  type ModuleDeps,
} from "../platform/index.ts";
import { openWrite, type WriteContext } from "../transformations/index.ts";

export const LAUNCH_PLAN = "/api/v1/transformations/:transformationId/launch-plan";
export const LAUNCH_PLAN_EDIT = "launch_plan.edit" as const;
export const JSON_BODY = ["application/json"] as const;

const transformationParams = z.strictObject({ transformationId: z.uuid() });
export const parseTransformationParam = (params: unknown): string =>
  parse(transformationParams, params, "params").transformationId;
/** The plan's day of the Day-90 leadership test (B0135; the template item `day_ninety_test` is due on day 90). */
export const DAY_NINETY = 90;

// ------------------------------------------------------------------------------------------------ problems (ADR-0048 §9)

export const PLAN_EXISTS = () =>
  problems.duplicate("launch_plan.exists", "This transformation already has a 90-day launch plan.");

// ------------------------------------------------------------------------------------------------ dates

const DAY_MS = 86_400_000;

/** `YYYY-MM-DD` + n calendar days (UTC arithmetic on the business date; no time zone is involved). */
export function addCalendarDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d) + n * DAY_MS).toISOString().slice(0, 10);
}

/** The number of calendar days from `from` to `to` (both `YYYY-MM-DD`). */
export function calendarDaysBetween(from: string, to: string): number {
  const at = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / DAY_MS);
}

export const dateText = (d: unknown): string => String(d).slice(0, 10);

// ------------------------------------------------------------------------------------------------ the generation core

export interface GenerateLaunchPlanInput {
  readonly organizationId: string;
  readonly transformationId: string;
  readonly startDate: string;
  readonly generatedVia: "request" | "automation";
  /** The user stamped in created_by/updated_by (the requester, or the transformation's creator for the automation). */
  readonly userId: string;
}

export type GenerateLaunchPlanResult =
  | { readonly outcome: "created"; readonly launchPlanId: string }
  | { readonly outcome: "existing"; readonly launchPlanId: string };

/** Transaction-scoped lock class launchPlan on the transformation, the key the 0086 guards take. */
export async function lockLaunchPlan(tx: Tx, transformationId: string): Promise<void> {
  await sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_CLASSES.launchPlan}::int4, hashtext(${transformationId}))`.execute(
    tx,
  );
}

/**
 * Generates the plan of a transformation once (ADR-0048 §1). Takes the launchPlan lock, then returns the existing plan
 * untouched if there is one (a replay writes nothing); otherwise inserts the plan, the 33 template tasks and the Day-90
 * test, each with its audit event at version 1 by `actor`.
 */
export async function generateLaunchPlanInTx(
  tx: Tx,
  actor: AuditActor,
  input: GenerateLaunchPlanInput,
): Promise<GenerateLaunchPlanResult> {
  await lockLaunchPlan(tx, input.transformationId);
  const existing = await tx
    .selectFrom("launch_plan")
    .select("id")
    .where("transformation_id", "=", input.transformationId)
    .executeTakeFirst();
  if (existing) return { outcome: "existing", launchPlanId: existing.id };

  const scope = { organizationId: input.organizationId, transformationId: input.transformationId };
  const planId = uuidv7();
  const inserted = await tx
    .insertInto("launch_plan")
    .values({
      id: planId,
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      start_date: input.startDate,
      generated_via: input.generatedVia,
      idempotency_key: `launch_plan:${input.transformationId}`,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .onConflict((oc) => oc.doNothing())
    .returning("id")
    .executeTakeFirst();
  if (!inserted) {
    // Unreachable under the lock; the UNIQUE keys make a concurrent generator a no-op rather than a duplicate.
    const row = await tx
      .selectFrom("launch_plan")
      .select("id")
      .where("transformation_id", "=", input.transformationId)
      .executeTakeFirstOrThrow();
    return { outcome: "existing", launchPlanId: row.id };
  }
  await insertAuditEvent(tx, actor, {
    action: "launch_plan.generate",
    recordType: "launch_plan",
    recordId: planId,
    ...scope,
    newVersion: 1,
    changes: {
      start_date: { from: null, to: input.startDate },
      generated_via: { from: null, to: input.generatedVia },
    },
  });

  const items = await tx
    .selectFrom("launch_template_item")
    .select(["code", "window_code", "item_kind", "ordinal", "text_en", "output_record_type", "start_day", "due_day"])
    .orderBy("ordinal")
    .execute();
  const tasks = items.map((item) => ({
    id: uuidv7(),
    organization_id: input.organizationId,
    transformation_id: input.transformationId,
    plan_id: planId,
    ordinal: item.ordinal,
    template_item_code: item.code,
    window_code: item.window_code,
    task_kind: item.item_kind,
    title: item.text_en,
    start_date: addCalendarDays(input.startDate, item.start_day),
    due_date: addCalendarDays(input.startDate, item.due_day),
    output_record_type: item.output_record_type,
    created_by: input.userId,
    updated_by: input.userId,
  }));
  if (tasks.length > 0) await tx.insertInto("launch_task").values(tasks).execute();
  for (const t of tasks)
    await insertAuditEvent(tx, actor, {
      action: "launch_task.generate",
      recordType: "launch_task",
      recordId: t.id,
      ...scope,
      newVersion: 1,
      changes: {
        template_item_code: { from: null, to: t.template_item_code },
        title: { from: null, to: t.title },
        start_date: { from: null, to: t.start_date },
        due_date: { from: null, to: t.due_date },
      },
    });

  const testId = uuidv7();
  const scheduledDate = addCalendarDays(input.startDate, DAY_NINETY);
  await tx
    .insertInto("day_ninety_test")
    .values({
      id: testId,
      organization_id: input.organizationId,
      transformation_id: input.transformationId,
      plan_id: planId,
      scheduled_date: scheduledDate,
      created_by: input.userId,
      updated_by: input.userId,
    })
    .execute();
  await insertAuditEvent(tx, actor, {
    action: "day_ninety_test.create",
    recordType: "day_ninety_test",
    recordId: testId,
    ...scope,
    newVersion: 1,
    changes: { scheduled_date: { from: null, to: scheduledDate } },
  });
  return { outcome: "created", launchPlanId: planId };
}

// ------------------------------------------------------------------------------------------------ reads

interface PlanRow {
  id: string;
  transformation_id: string;
  start_date: string;
  template_ref: string;
  generated_via: string;
  last_shift_days: number | null;
  version: number;
  created_at: Date;
  updated_at: Date;
}

export async function findPlan(db: DbOrTx, transformationId: string, lock = false): Promise<PlanRow | null> {
  let q = db
    .selectFrom("launch_plan")
    .select([
      "id",
      "transformation_id",
      "start_date",
      "template_ref",
      "generated_via",
      "last_shift_days",
      "version",
      "created_at",
      "updated_at",
    ])
    .where("transformation_id", "=", transformationId);
  if (lock) q = q.forUpdate();
  return ((await q.executeTakeFirst()) as PlanRow | undefined) ?? null;
}

export async function requirePlan(db: DbOrTx, transformationId: string, lock = false): Promise<PlanRow> {
  const plan = await findPlan(db, transformationId, lock);
  if (!plan) throw problems.notFound();
  return plan;
}

export async function presentPlan(db: DbOrTx, plan: PlanRow): Promise<LaunchPlan> {
  const counts = await db
    .selectFrom("launch_task")
    .select([
      sql<number>`count(*)::int`.as("total"),
      sql<number>`count(*) FILTER (WHERE status = 'completed')::int`.as("completed"),
    ])
    .where("plan_id", "=", plan.id)
    .executeTakeFirstOrThrow();
  return {
    id: plan.id,
    transformationId: plan.transformation_id,
    startDate: dateText(plan.start_date),
    templateRef: plan.template_ref,
    generatedVia: plan.generated_via as LaunchPlan["generatedVia"],
    lastShiftDays: plan.last_shift_days,
    taskCount: counts.total,
    completedCount: counts.completed,
    version: plan.version,
    createdAt: iso(plan.created_at),
    updatedAt: iso(plan.updated_at),
  };
}

// ------------------------------------------------------------------------------------------------ writes

/**
 * The write context of every launch-plan mutation: the read gate on the request principal first (an outsider or an
 * ADM-only user gets 404, ADR-0006), then launch_plan.edit re-checked at commit time on the grants reloaded in the
 * transaction (a grant revoked meanwhile gives 403; AUD, SP and WL get 403).
 */
export async function openLaunchWrite(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
): Promise<WriteContext> {
  await requireTransformationRead(tx, principalOf(request), transformationId);
  return openWrite(tx, request, transformationId, [{ permission: LAUNCH_PLAN_EDIT }], null, { atCommit: true });
}

/** The user audit actor of a request's write context. */
export const requestActor = (ctx: WriteContext): AuditActor => ({
  actorType: "user",
  actorUserId: ctx.userId,
  requestId: ctx.audit.requestId,
  source: "api",
});

async function generate(tx: Tx, request: FastifyRequest, transformationId: string): Promise<void> {
  const ctx = await openLaunchWrite(tx, request, transformationId);
  const body = parseBody(launchPlanCreate, request.body);
  await lockLaunchPlan(tx, transformationId);
  if (await findPlan(tx, transformationId)) throw PLAN_EXISTS();
  await generateLaunchPlanInTx(tx, requestActor(ctx), {
    organizationId: ctx.organizationId,
    transformationId,
    startDate: body.startDate,
    generatedVia: "request",
    userId: ctx.userId,
  });
}

async function redate(tx: Tx, request: FastifyRequest, transformationId: string): Promise<void> {
  const ctx = await openLaunchWrite(tx, request, transformationId);
  const body = parseBody(launchPlanUpdate, request.body);
  const expected = requireIfMatch(request);
  await lockLaunchPlan(tx, transformationId);
  const plan = await requirePlan(tx, transformationId, true);
  if (plan.version !== expected) throw problems.versionConflict(plan.version);
  const oldStart = dateText(plan.start_date);
  const delta = calendarDaysBetween(oldStart, body.startDate);
  if (delta === 0) return; // nothing moves, nothing is written
  const actor = requestActor(ctx);
  const scope = { organizationId: ctx.organizationId, transformationId };

  const updatedPlan = await tx
    .updateTable("launch_plan")
    .set({
      start_date: body.startDate,
      last_shift_days: delta,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", plan.id)
    .where("version", "=", plan.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await insertAuditEvent(tx, actor, {
    action: "launch_plan.redate",
    recordType: "launch_plan",
    recordId: plan.id,
    ...scope,
    priorVersion: plan.version,
    newVersion: updatedPlan.version,
    changes: {
      start_date: { from: oldStart, to: body.startDate },
      last_shift_days: { from: plan.last_shift_days, to: delta },
    },
  });

  // 1. Every not-started task moves by delta (2. the others keep their dates).
  const moved = await tx
    .updateTable("launch_task")
    .set({
      start_date: sql<string>`start_date + ${delta}::int`,
      due_date: sql<string>`due_date + ${delta}::int`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("plan_id", "=", plan.id)
    .where("status", "=", "not_started")
    .returning(["id", "version", "start_date", "due_date"])
    .execute();
  for (const t of moved) {
    const start = dateText(t.start_date);
    const due = dateText(t.due_date);
    await insertAuditEvent(tx, actor, {
      action: "launch_task.redate",
      recordType: "launch_task",
      recordId: t.id,
      ...scope,
      priorVersion: t.version - 1,
      newVersion: t.version,
      reason: `Launch plan start date moved by ${delta} day(s)`,
      changes: {
        start_date: { from: addCalendarDays(start, -delta), to: start },
        due_date: { from: addCalendarDays(due, -delta), to: due },
      },
    });
  }

  // 3. An open Day-90 test moves its scheduled date by delta.
  const test = await tx
    .updateTable("day_ninety_test")
    .set({
      scheduled_date: sql<string>`scheduled_date + ${delta}::int`,
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("plan_id", "=", plan.id)
    .where("status", "=", "open")
    .returning(["id", "version", "scheduled_date"])
    .executeTakeFirst();
  if (test) {
    const scheduled = dateText(test.scheduled_date);
    await insertAuditEvent(tx, actor, {
      action: "day_ninety_test.redate",
      recordType: "day_ninety_test",
      recordId: test.id,
      ...scope,
      priorVersion: test.version - 1,
      newVersion: test.version,
      reason: `Launch plan start date moved by ${delta} day(s)`,
      changes: { scheduled_date: { from: addCalendarDays(scheduled, -delta), to: scheduled } },
    });
  }
}

// ------------------------------------------------------------------------------------------------ routes

/** Registers the plan routes and returns them as "METHOD /path". */
export function registerLaunchPlanRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: LAUNCH_PLAN_EDIT }, consumes: JSON_BODY };

  app.get(LAUNCH_PLAN, { config: read }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => presentPlan(tx, await requirePlan(tx, transformationId)));
    return sendVersioned(reply, 200, body);
  });

  app.post(LAUNCH_PLAN, { config: edit }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await generate(tx, request, transformationId);
      return presentPlan(tx, await requirePlan(tx, transformationId));
    });
    return sendVersioned(reply, 201, body, request.url.split("?")[0]!);
  });

  app.patch(LAUNCH_PLAN, { config: edit }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      await redate(tx, request, transformationId);
      return presentPlan(tx, await requirePlan(tx, transformationId));
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${LAUNCH_PLAN}`, `POST ${LAUNCH_PLAN}`, `PATCH ${LAUNCH_PLAN}`];
}
