// The launch plan's editable scheduled tasks (P5 slice H; ADR-0048 §2-§3, §7-§9; REQ-S14-004; p5-work-split §H.1;
// T-DG5-BE-P):
//   GET   /transformations/{t}/launch-plan/tasks           listLaunchTasks   (transformation.read; by due date)
//   POST  /transformations/{t}/launch-plan/tasks           createLaunchTask  (launch_plan.edit; a custom task)
//   GET   /transformations/{t}/launch-plan/tasks/{task}    getLaunchTask     (transformation.read)
//   PATCH /transformations/{t}/launch-plan/tasks/{task}    updateLaunchTask  (launch_plan.edit; If-Match)
//
// Status (the 0086 `launch_task_guard` list): not_started -> in_progress | completed | cancelled; in_progress ->
// not_started | completed | cancelled; completed -> in_progress (reopen); cancelled is final. A completed task keeps
// its dates. A template task keeps its required output type; its output record must be a record of that type in the
// transformation. Owners are active users of the transformation's organization (422 validation.user_invalid).
// "Blocked by" is derived on read: the active predecessors whose status is not completed; a blocked task can still be
// started (the plan informs, it does not lock). `nonWorkingDay` is true when the due date is not a working day of the
// organization's default business calendar (ADR-0025): a warning, never a shift (D-142 Q6); with no calendar it is
// false, because nothing is known to warn about.
import { sql, type DbOrTx, type Tx } from "@mth/db";
import { isWorkingDay, type WorkingCalendar } from "@mth/shared/time";
import {
  LAUNCH_OUTPUT_RECORD_TYPES,
  launchTaskCreate,
  launchTaskUpdate,
  type LaunchTask,
  type LaunchTaskRef,
} from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { principalOf, requireTransformationRead } from "../access/index.ts";
import { record } from "../audit/index.ts";
import {
  cursorSchema,
  decodeCursor,
  filterHash,
  iso,
  isoOrNull,
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
import { assertActiveUsers } from "../transformations/index.ts";
import {
  dateText,
  JSON_BODY,
  LAUNCH_PLAN,
  LAUNCH_PLAN_EDIT,
  lockLaunchPlan,
  openLaunchWrite,
  parseTransformationParam,
  requirePlan,
} from "./plan.ts";

export const LAUNCH_TASKS = `${LAUNCH_PLAN}/tasks`;
export const LAUNCH_TASK = `${LAUNCH_TASKS}/:taskId`;
const MAX_ORDINAL = 999;

// ------------------------------------------------------------------------------------------------ problems (ADR-0048 §9)

export const TASK_CANCELLED = () =>
  problems.businessRule("launch_task.cancelled", "A cancelled task cannot be changed.");
export const TASK_COMPLETED_DATES_FIXED = () =>
  problems.businessRule("launch_task.completed_dates_fixed", "A completed task keeps its dates; reopen it first.");
export const TASK_STATUS_STEP = () =>
  problems.businessRule("launch_task.status_step", "This status change is not allowed for the task.");
export const TASK_OUTPUT_RECORD_INVALID = () =>
  problems.businessRule(
    "launch_task.output_record_invalid",
    "The output must be a record of the required type in this transformation.",
  );
const DATES_ORDER = () =>
  problems.badRequest("validation.constraint", "The due date cannot be before the start date.", "/dueDate");

/** The legal status moves (the 0086 `launch_task_guard` list). */
const TRANSITIONS: ReadonlySet<string> = new Set([
  "not_started>in_progress",
  "not_started>completed",
  "not_started>cancelled",
  "in_progress>not_started",
  "in_progress>completed",
  "in_progress>cancelled",
  "completed>in_progress",
]);

// ------------------------------------------------------------------------------------------------ rows

export interface TaskRow {
  id: string;
  organization_id: string;
  transformation_id: string;
  plan_id: string;
  ordinal: number;
  template_item_code: string | null;
  window_code: string;
  task_kind: string;
  title: string;
  notes: string | null;
  start_date: string;
  due_date: string;
  owner_user_id: string | null;
  status: string;
  completed_at: Date | null;
  completed_by: string | null;
  output_record_type: string | null;
  output_record_id: string | null;
  version: number;
  updated_at: Date;
  source_text_en: string | null;
}

const TASK_AUDIT_FIELDS = [
  "title",
  "notes",
  "start_date",
  "due_date",
  "owner_user_id",
  "status",
  "output_record_type",
  "output_record_id",
] as const;
const DATE_FIELDS: ReadonlySet<string> = new Set(["start_date", "due_date"]);

function diff(before: Partial<TaskRow>, after: TaskRow): Record<string, { from: unknown; to: unknown }> {
  const b = new Map<string, unknown>(Object.entries(before));
  const a = new Map<string, unknown>(Object.entries(after));
  const out = new Map<string, { from: unknown; to: unknown }>();
  for (const f of TASK_AUDIT_FIELDS) {
    const norm = (v: unknown) => (v === undefined || v === null ? null : DATE_FIELDS.has(f) ? dateText(v) : v);
    const from = norm(b.get(f));
    const to = norm(a.get(f));
    if (from !== to) out.set(f, { from, to });
  }
  return Object.fromEntries(out);
}

function taskQuery(db: DbOrTx) {
  return db
    .selectFrom("launch_task as t")
    .leftJoin("launch_template_item as i", "i.code", "t.template_item_code")
    .select([
      "t.id",
      "t.organization_id",
      "t.transformation_id",
      "t.plan_id",
      "t.ordinal",
      "t.template_item_code",
      "t.window_code",
      "t.task_kind",
      "t.title",
      "t.notes",
      "t.start_date",
      "t.due_date",
      "t.owner_user_id",
      "t.status",
      "t.completed_at",
      "t.completed_by",
      "t.output_record_type",
      "t.output_record_id",
      "t.version",
      "t.updated_at",
      "i.text_en as source_text_en",
    ]);
}

export async function findTask(db: DbOrTx, transformationId: string, taskId: string): Promise<TaskRow> {
  const row = await taskQuery(db)
    .where("t.id", "=", taskId)
    .where("t.transformation_id", "=", transformationId)
    .executeTakeFirst();
  if (!row) throw problems.notFound();
  return row as TaskRow;
}

/** Row-locks a task of the transformation (404 when it is not one) and returns it. */
export async function lockTask(tx: Tx, transformationId: string, taskId: string): Promise<TaskRow> {
  const locked = await tx
    .selectFrom("launch_task")
    .select("id")
    .where("id", "=", taskId)
    .where("transformation_id", "=", transformationId)
    .forUpdate()
    .executeTakeFirst();
  if (!locked) throw problems.notFound();
  return findTask(tx, transformationId, taskId);
}

// ------------------------------------------------------------------------------------------------ presenters

/** The organization's active default business calendar with its active holidays, or null (ADR-0025 §1). */
export async function loadCalendar(db: DbOrTx, transformationId: string): Promise<WorkingCalendar | null> {
  const calendar = await db
    .selectFrom("business_calendar as c")
    .innerJoin("transformation as tr", "tr.organization_id", "c.organization_id")
    .select(["c.id", "c.workweek"])
    .where("tr.id", "=", transformationId)
    .where("c.is_default", "=", true)
    .where("c.status", "=", "active")
    .executeTakeFirst();
  if (!calendar) return null;
  const holidays = await db
    .selectFrom("business_calendar_holiday")
    .select(["id", "date_from", "date_to"])
    .where("calendar_id", "=", calendar.id)
    .where("status", "=", "active")
    .orderBy("date_from")
    .execute();
  return {
    workweek: calendar.workweek.map(Number),
    holidays: holidays.map((h) => ({ id: h.id, dateFrom: dateText(h.date_from), dateTo: dateText(h.date_to) })),
  };
}

/** Each task's active predecessors as refs (by predecessor ordinal). */
async function predecessorsOf(db: DbOrTx, taskIds: readonly string[]): Promise<Map<string, LaunchTaskRef[]>> {
  const out = new Map<string, LaunchTaskRef[]>();
  if (taskIds.length === 0) return out;
  const rows = await db
    .selectFrom("launch_task_predecessor as p")
    .innerJoin("launch_task as t", "t.id", "p.predecessor_task_id")
    .select(["p.task_id", "t.id", "t.ordinal", "t.title", "t.status"])
    .where("p.task_id", "in", [...taskIds])
    .where("p.removed_at", "is", null)
    .orderBy("p.task_id")
    .orderBy("t.ordinal")
    .execute();
  for (const r of rows) {
    const list = out.get(r.task_id) ?? [];
    list.push({ taskId: r.id, ordinal: r.ordinal, title: r.title, status: r.status as LaunchTaskRef["status"] });
    out.set(r.task_id, list);
  }
  return out;
}

function toTask(r: TaskRow, predecessors: readonly LaunchTaskRef[], calendar: WorkingCalendar | null): LaunchTask {
  const due = dateText(r.due_date);
  return {
    id: r.id,
    planId: r.plan_id,
    ordinal: r.ordinal,
    templateItemCode: r.template_item_code,
    windowCode: r.window_code as LaunchTask["windowCode"],
    taskKind: r.task_kind as LaunchTask["taskKind"],
    title: r.title,
    sourceTextEn: r.source_text_en,
    notes: r.notes,
    startDate: dateText(r.start_date),
    dueDate: due,
    nonWorkingDay: calendar === null ? false : !isWorkingDay(due, calendar),
    ownerUserId: r.owner_user_id,
    status: r.status as LaunchTask["status"],
    completedAt: isoOrNull(r.completed_at),
    completedBy: r.completed_by,
    outputRecordType: r.output_record_type as LaunchTask["outputRecordType"],
    outputRecordId: r.output_record_id,
    predecessors: [...predecessors],
    blockedBy: predecessors.filter((p) => p.status !== "completed"),
    version: r.version,
    updatedAt: iso(r.updated_at),
  };
}

export async function presentTasks(db: DbOrTx, transformationId: string, rows: readonly TaskRow[]) {
  const [preds, calendar] = await Promise.all([
    predecessorsOf(
      db,
      rows.map((r) => r.id),
    ),
    loadCalendar(db, transformationId),
  ]);
  return rows.map((r) => toTask(r, preds.get(r.id) ?? [], calendar));
}

export async function presentTask(db: DbOrTx, transformationId: string, taskId: string): Promise<LaunchTask> {
  const [task] = await presentTasks(db, transformationId, [await findTask(db, transformationId, taskId)]);
  return task!;
}

// ------------------------------------------------------------------------------------------------ writes

/** The table of each output record type (the 0086 `launch_task_output_record` list; every one has transformation_id). */
const OUTPUT_TABLES: ReadonlySet<string> = new Set(LAUNCH_OUTPUT_RECORD_TYPES);

async function outputRecordExists(tx: Tx, type: string, id: string, transformationId: string): Promise<boolean> {
  if (!OUTPUT_TABLES.has(type)) return false;
  const r = await sql<{ found: boolean }>`
    SELECT EXISTS (SELECT 1 FROM ${sql.table(type)} WHERE id = ${id}::uuid AND transformation_id = ${transformationId}::uuid) AS found`.execute(
    tx,
  );
  return r.rows[0]?.found === true;
}

async function createTask(tx: Tx, request: FastifyRequest, transformationId: string): Promise<string> {
  const ctx = await openLaunchWrite(tx, request, transformationId);
  const body = parseBody(launchTaskCreate, request.body);
  if (body.dueDate < body.startDate) throw DATES_ORDER();
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);
  await lockLaunchPlan(tx, transformationId);
  const plan = await requirePlan(tx, transformationId);
  const max = await tx
    .selectFrom("launch_task")
    .select(sql<number>`coalesce(max(ordinal), 0)::int`.as("max"))
    .where("plan_id", "=", plan.id)
    .executeTakeFirstOrThrow();
  if (max.max >= MAX_ORDINAL)
    throw problems.businessRule("validation.constraint", "The launch plan has reached its maximum number of tasks.");
  const id = uuidv7();
  await tx
    .insertInto("launch_task")
    .values({
      id,
      organization_id: ctx.organizationId,
      transformation_id: transformationId,
      plan_id: plan.id,
      ordinal: max.max + 1,
      template_item_code: null,
      window_code: body.windowCode,
      task_kind: "custom",
      title: body.title,
      notes: body.notes ?? null,
      start_date: body.startDate,
      due_date: body.dueDate,
      owner_user_id: body.ownerUserId ?? null,
      created_by: ctx.userId,
      updated_by: ctx.userId,
    })
    .execute();
  const created = await findTask(tx, transformationId, id);
  await record(tx, ctx.audit, {
    action: "launch_task.create",
    recordType: "launch_task",
    recordId: id,
    organizationId: ctx.organizationId,
    transformationId,
    newVersion: 1,
    changes: { window_code: { from: null, to: body.windowCode }, ...diff({}, created) },
  });
  return id;
}

async function updateTask(tx: Tx, request: FastifyRequest, transformationId: string, taskId: string): Promise<void> {
  const ctx = await openLaunchWrite(tx, request, transformationId);
  const body = parseBody(launchTaskUpdate, request.body);
  const expected = requireIfMatch(request);
  await lockLaunchPlan(tx, transformationId);
  const current = await lockTask(tx, transformationId, taskId);
  if (current.version !== expected) throw problems.versionConflict(current.version);
  if (current.status === "cancelled") throw TASK_CANCELLED();

  const move = body.status !== undefined && body.status !== current.status;
  if (move && !TRANSITIONS.has(`${current.status}>${body.status}`)) throw TASK_STATUS_STEP();

  const oldStart = dateText(current.start_date);
  const oldDue = dateText(current.due_date);
  const start = body.startDate ?? oldStart;
  const due = body.dueDate ?? oldDue;
  const datesChange = start !== oldStart || due !== oldDue;
  if (current.status === "completed" && datesChange) throw TASK_COMPLETED_DATES_FIXED();
  if (due < start) throw DATES_ORDER();

  // The required output: a template task keeps its type; the record must be of that type in this transformation.
  const outputType = body.outputRecordType !== undefined ? body.outputRecordType : current.output_record_type;
  const outputId = body.outputRecordId !== undefined ? body.outputRecordId : current.output_record_id;
  if (current.template_item_code !== null && outputType !== current.output_record_type)
    throw TASK_OUTPUT_RECORD_INVALID();
  if (outputId !== null) {
    if (outputType === null || !(await outputRecordExists(tx, outputType, outputId, transformationId)))
      throw TASK_OUTPUT_RECORD_INVALID();
  }
  await assertActiveUsers(tx, ctx.organizationId, [{ id: body.ownerUserId, pointer: "/ownerUserId" }]);

  const completing = move && body.status === "completed";
  const leavingCompleted = move && current.status === "completed";
  await tx
    .updateTable("launch_task")
    .set({
      ...(body.title !== undefined ? { title: body.title } : {}),
      ...(body.notes !== undefined ? { notes: body.notes } : {}),
      ...(datesChange ? { start_date: start, due_date: due } : {}),
      ...(body.ownerUserId !== undefined ? { owner_user_id: body.ownerUserId } : {}),
      ...(move ? { status: body.status! } : {}),
      ...(completing ? { completed_at: sql<Date>`now()`, completed_by: ctx.userId } : {}),
      ...(leavingCompleted ? { completed_at: null, completed_by: null } : {}),
      ...(body.outputRecordType !== undefined ? { output_record_type: outputType } : {}),
      ...(body.outputRecordId !== undefined ? { output_record_id: outputId } : {}),
      version: sql<number>`version + 1`,
      updated_at: sql<Date>`now()`,
      updated_by: ctx.userId,
    })
    .where("id", "=", current.id)
    .where("version", "=", current.version)
    .executeTakeFirstOrThrow();
  const updated = await findTask(tx, transformationId, taskId);
  await record(tx, ctx.audit, {
    action: move ? `launch_task.${body.status!}` : "launch_task.update",
    recordType: "launch_task",
    recordId: current.id,
    organizationId: ctx.organizationId,
    transformationId,
    priorVersion: current.version,
    newVersion: updated.version,
    changes: diff(current, updated),
  });
}

// ------------------------------------------------------------------------------------------------ routes

const taskParams = z.strictObject({ transformationId: z.uuid(), taskId: z.uuid() });
const listQuery = z.strictObject({
  cursor: cursorSchema,
  limit: limitSchema,
  window: z.enum(["days_0_30", "days_31_60", "days_61_90"]).optional(),
  status: z.enum(["not_started", "in_progress", "completed", "cancelled"]).optional(),
});

/** Registers the task routes and returns them as "METHOD /path". */
export function registerLaunchTaskRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const read = { access: { permission: "transformation.read" as const } };
  const edit = { access: { permission: LAUNCH_PLAN_EDIT }, consumes: JSON_BODY };

  app.get(LAUNCH_TASKS, { config: read }, async (request) => {
    const transformationId = parseTransformationParam(request.params);
    const query = parseQuery(listQuery, request.query);
    await requireTransformationRead(db, principalOf(request), transformationId);
    const hash = filterHash({
      table: "launch_task",
      transformationId,
      window: query.window ?? null,
      status: query.status ?? null,
    });
    const after = decodeCursor(query.cursor, hash, 2);
    return db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => {
        await requirePlan(tx, transformationId);
        let q = taskQuery(tx).where("t.transformation_id", "=", transformationId);
        if (query.window !== undefined) q = q.where("t.window_code", "=", query.window);
        if (query.status !== undefined) q = q.where("t.status", "=", query.status);
        if (after)
          q = q.where(sql<boolean>`(t.due_date, t.ordinal) > (${String(after[0])}::date, ${Number(after[1])})`);
        const rows = (await q
          .orderBy("t.due_date")
          .orderBy("t.ordinal")
          .limit(query.limit + 1)
          .execute()) as TaskRow[];
        const page = paginate(rows, query.limit, (r) => [dateText(r.due_date), r.ordinal], hash);
        return { items: await presentTasks(tx, transformationId, page.items), nextCursor: page.nextCursor };
      });
  });

  app.post(LAUNCH_TASKS, { config: edit }, async (request, reply) => {
    const transformationId = parseTransformationParam(request.params);
    const body = await db.transaction().execute(async (tx) => {
      const id = await createTask(tx, request, transformationId);
      return presentTask(tx, transformationId, id);
    });
    return sendVersioned(reply, 201, body, `${request.url.split("?")[0]!}/${body.id}`);
  });

  app.get(LAUNCH_TASK, { config: read }, async (request, reply) => {
    const { transformationId, taskId } = parse(taskParams, request.params, "params");
    await requireTransformationRead(db, principalOf(request), transformationId);
    const body = await db
      .transaction()
      .setIsolationLevel("repeatable read")
      .setAccessMode("read only")
      .execute(async (tx) => presentTask(tx, transformationId, taskId));
    return sendVersioned(reply, 200, body);
  });

  app.patch(LAUNCH_TASK, { config: edit }, async (request, reply) => {
    const { transformationId, taskId } = parse(taskParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await updateTask(tx, request, transformationId, taskId);
      return presentTask(tx, transformationId, taskId);
    });
    return sendVersioned(reply, 200, body);
  });

  return [`GET ${LAUNCH_TASKS}`, `POST ${LAUNCH_TASKS}`, `GET ${LAUNCH_TASK}`, `PATCH ${LAUNCH_TASK}`];
}
