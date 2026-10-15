// A launch task's predecessors (P5 slice H; ADR-0048 §3, §7-§9; REQ-S14-004; p5-work-split §H.1; T-DG5-BE-P):
//   PUT /transformations/{t}/launch-plan/tasks/{task}/predecessors   putLaunchTaskPredecessors (launch_plan.edit; If-Match)
//
// The body is the task's complete ACTIVE predecessor set. Under the launchPlan lock the service compares it
// with the current active links: a link no longer wanted is stamped removed (`removed_at`/`removed_by`, its only
// change; never deleted), a new one is inserted active (re-adding a removed pair makes a new row), each with its own
// audit event, and the task steps one version with its own audit event. An unchanged set writes nothing. Refusals,
// checked before the database's `launch_task_predecessor_guard`: a predecessor outside this plan gives 422
// launch_task.predecessor_other_plan; the task itself, or a set whose links would close a loop through the plan's
// active links, gives 422 launch_task.predecessor_cycle. "Blocked by" is derived on read (tasks.ts).
import { sql, type Tx } from "@mth/db";
import { launchTaskPredecessors } from "@mth/shared/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import { record } from "../audit/index.ts";
import { parse, parseBody, problems, requireIfMatch, sendVersioned, type ModuleDeps } from "../platform/index.ts";
import { JSON_BODY, LAUNCH_PLAN_EDIT, lockLaunchPlan, openLaunchWrite } from "./plan.ts";
import { LAUNCH_TASK, lockTask, presentTask, TASK_CANCELLED } from "./tasks.ts";

export const LAUNCH_TASK_PREDECESSORS = `${LAUNCH_TASK}/predecessors`;

export const PREDECESSOR_CYCLE = () =>
  problems.businessRule(
    "launch_task.predecessor_cycle",
    "This predecessor would make the tasks depend on each other in a loop.",
  );
export const PREDECESSOR_OTHER_PLAN = () =>
  problems.businessRule("launch_task.predecessor_other_plan", "A predecessor must be a task of the same launch plan.");

/** True when `target` is reachable from any of `starts` through `edges` (task -> its predecessors). */
export function reaches(edges: ReadonlyMap<string, readonly string[]>, starts: readonly string[], target: string) {
  const seen = new Set<string>();
  const stack = [...starts];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === target) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of edges.get(id) ?? []) stack.push(next);
  }
  return false;
}

async function replacePredecessors(
  tx: Tx,
  request: FastifyRequest,
  transformationId: string,
  taskId: string,
): Promise<void> {
  const ctx = await openLaunchWrite(tx, request, transformationId);
  const body = parseBody(launchTaskPredecessors, request.body);
  const expected = requireIfMatch(request);
  await lockLaunchPlan(tx, transformationId);
  const task = await lockTask(tx, transformationId, taskId);
  if (task.version !== expected) throw problems.versionConflict(task.version);
  if (task.status === "cancelled") throw TASK_CANCELLED();

  const wanted = body.predecessorTaskIds;
  if (wanted.includes(taskId)) throw PREDECESSOR_CYCLE();
  if (wanted.length > 0) {
    const same = await tx
      .selectFrom("launch_task")
      .select("id")
      .where("id", "in", wanted)
      .where("plan_id", "=", task.plan_id)
      .execute();
    if (same.length !== wanted.length) throw PREDECESSOR_OTHER_PLAN();
  }

  const links = await tx
    .selectFrom("launch_task_predecessor as p")
    .innerJoin("launch_task as t", "t.id", "p.task_id")
    .select(["p.id", "p.task_id", "p.predecessor_task_id", "p.version"])
    .where("t.plan_id", "=", task.plan_id)
    .where("p.removed_at", "is", null)
    .execute();
  const mine = links.filter((l) => l.task_id === taskId);
  const current = new Set(mine.map((l) => l.predecessor_task_id));
  const toRemove = mine.filter((l) => !wanted.includes(l.predecessor_task_id));
  const toAdd = wanted.filter((id) => !current.has(id));
  if (toRemove.length === 0 && toAdd.length === 0) return;

  // A loop: some wanted predecessor already (transitively) needs this task.
  const edges = new Map<string, string[]>();
  for (const l of links) {
    if (l.task_id === taskId) continue;
    edges.set(l.task_id, [...(edges.get(l.task_id) ?? []), l.predecessor_task_id]);
  }
  if (reaches(edges, toAdd, taskId)) throw PREDECESSOR_CYCLE();

  const scope = { organizationId: ctx.organizationId, transformationId };
  for (const l of toRemove) {
    const removed = await tx
      .updateTable("launch_task_predecessor")
      .set({
        removed_at: sql<Date>`now()`,
        removed_by: ctx.userId,
        version: sql<number>`version + 1`,
        updated_at: sql<Date>`now()`,
        updated_by: ctx.userId,
      })
      .where("id", "=", l.id)
      .where("version", "=", l.version)
      .returning("version")
      .executeTakeFirstOrThrow();
    await record(tx, ctx.audit, {
      action: "launch_task_predecessor.remove",
      recordType: "launch_task_predecessor",
      recordId: l.id,
      ...scope,
      priorVersion: l.version,
      newVersion: removed.version,
      changes: { removed: { from: false, to: true } },
    });
  }
  for (const predecessorId of toAdd) {
    const id = uuidv7();
    await tx
      .insertInto("launch_task_predecessor")
      .values({
        id,
        organization_id: ctx.organizationId,
        transformation_id: transformationId,
        task_id: taskId,
        predecessor_task_id: predecessorId,
        created_by: ctx.userId,
        updated_by: ctx.userId,
      })
      .execute();
    await record(tx, ctx.audit, {
      action: "launch_task_predecessor.add",
      recordType: "launch_task_predecessor",
      recordId: id,
      ...scope,
      newVersion: 1,
      changes: {
        task_id: { from: null, to: taskId },
        predecessor_task_id: { from: null, to: predecessorId },
      },
    });
  }
  const stepped = await tx
    .updateTable("launch_task")
    .set({ version: sql<number>`version + 1`, updated_at: sql<Date>`now()`, updated_by: ctx.userId })
    .where("id", "=", taskId)
    .where("version", "=", task.version)
    .returning("version")
    .executeTakeFirstOrThrow();
  await record(tx, ctx.audit, {
    action: "launch_task.predecessors_replace",
    recordType: "launch_task",
    recordId: taskId,
    ...scope,
    priorVersion: task.version,
    newVersion: stepped.version,
    changes: {
      predecessor_task_ids: { from: [...current].sort(), to: [...wanted].sort() },
    },
  });
}

const taskParams = z.strictObject({ transformationId: z.uuid(), taskId: z.uuid() });

/** Registers the predecessor route and returns it as "METHOD /path". */
export function registerLaunchPredecessorRoutes(app: FastifyInstance, { db }: ModuleDeps): string[] {
  const edit = { access: { permission: LAUNCH_PLAN_EDIT }, consumes: JSON_BODY };
  app.put(LAUNCH_TASK_PREDECESSORS, { config: edit }, async (request, reply) => {
    const { transformationId, taskId } = parse(taskParams, request.params, "params");
    const body = await db.transaction().execute(async (tx) => {
      await replacePredecessors(tx, request, transformationId, taskId);
      return presentTask(tx, transformationId, taskId);
    });
    return sendVersioned(reply, 200, body);
  });
  return [`PUT ${LAUNCH_TASK_PREDECESSORS}`];
}
