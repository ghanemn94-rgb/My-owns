// P5 contract exercises of BE-P (p5-work-split §H.1 and §2 rule 14; T-DG5-BE-P): the nine launch-plan operations, each
// with a success and every declared refusal it can reach, through the validating client (`ctx.mirrored`). Every value
// is SYNTHETIC; a launch plan is not a business approval and touches nothing of DG0-DG7.
import { randomUUID } from "node:crypto";
import { launchPlan, launchPlanTemplate, launchTask, launchTaskPage } from "@mth/shared/schemas";
import { expect } from "vitest";
import type { z } from "zod";
import { signIn, type P5ExerciseContext } from "../../support/harness.ts";
import { ifm, setupP2World } from "../../support/p2-fixtures.ts";

export const P5_MIRRORS_BE_P: Readonly<Record<string, z.ZodType>> = {
  getLaunchPlanTemplate: launchPlanTemplate,
  getLaunchPlan: launchPlan,
  generateLaunchPlan: launchPlan,
  updateLaunchPlan: launchPlan,
  listLaunchTasks: launchTaskPage,
  createLaunchTask: launchTask,
  getLaunchTask: launchTask,
  updateLaunchTask: launchTask,
  putLaunchTaskPredecessors: launchTask,
};

export async function exerciseP5BePOperations(ctx: P5ExerciseContext): Promise<void> {
  const { api, world: w, mirrored } = ctx;
  const p = await setupP2World(api, w);
  const outsider = await signIn(api.app, w.officeB.subject);
  const tl = p.lead.session;
  const plan = `/api/v1/transformations/${p.transformationId}/launch-plan`;
  const tasks = `${plan}/tasks`;

  // getLaunchPlanTemplate: 200, 401.
  const template = await mirrored("GET", "/api/v1/launch-plan-template", { session: p.sponsor.session });
  expect([template.status, template.body.windows.length]).toEqual([200, 3]);
  expect((await mirrored("GET", "/api/v1/launch-plan-template")).status).toBe(401);

  // getLaunchPlan before generation: 404; 400 malformed id; 401.
  expect((await mirrored("GET", plan, { session: tl })).status).toBe(404);
  expect((await mirrored("GET", "/api/v1/transformations/not-a-uuid/launch-plan", { session: tl })).status).toBe(400);
  expect((await mirrored("GET", plan)).status).toBe(401);

  // generateLaunchPlan: 400, 401, 403 (AUD), 404 (outsider), 201, then 409 launch_plan.exists.
  const start = { startDate: "2026-10-01" };
  expect((await mirrored("POST", plan, { session: tl, body: { startDate: "1 Oct" } })).status).toBe(400);
  expect((await mirrored("POST", plan, { body: start })).status).toBe(401);
  expect((await mirrored("POST", plan, { session: p.auditor.session, body: start })).status).toBe(403);
  expect((await mirrored("POST", plan, { session: outsider, body: start })).status).toBe(404);
  const made = await mirrored("POST", plan, { session: tl, body: start });
  expect([made.status, made.body.taskCount, made.body.version]).toEqual([201, 33, 1]);
  const twice = await mirrored("POST", plan, { session: tl, body: start });
  expect([twice.status, twice.body.code]).toEqual([409, "launch_plan.exists"]);

  // getLaunchPlan: 200 (AUD reads), 403 is not reachable for a reader in scope; 404 outsider.
  expect((await mirrored("GET", plan, { session: p.auditor.session })).status).toBe(200);
  expect((await mirrored("GET", plan, { session: outsider })).status).toBe(404);

  // listLaunchTasks: 200 with filters, 400, 401, 404.
  const page = await mirrored("GET", `${tasks}?window=days_31_60&limit=50`, { session: p.auditor.session });
  expect([page.status, page.body.items.length]).toEqual([200, 11]);
  expect((await mirrored("GET", `${tasks}?status=late`, { session: tl })).status).toBe(400);
  expect((await mirrored("GET", tasks)).status).toBe(401);
  expect((await mirrored("GET", tasks, { session: outsider })).status).toBe(404);
  const [a, b] = page.body.items as { id: string; version: number }[];

  // getLaunchTask: 200, 400, 401, 404.
  const one = `${tasks}/${a!.id}`;
  expect((await mirrored("GET", one, { session: tl })).status).toBe(200);
  expect((await mirrored("GET", `${tasks}/not-a-uuid`, { session: tl })).status).toBe(400);
  expect((await mirrored("GET", one)).status).toBe(401);
  expect((await mirrored("GET", `${tasks}/${randomUUID()}`, { session: tl })).status).toBe(404);

  // createLaunchTask: 201, 400, 401, 403, 404, 422 validation.user_invalid.
  const custom = {
    windowCode: "days_61_90",
    title: "Synthetic custom task",
    startDate: "2026-12-01",
    dueDate: "2026-12-15",
  };
  const created = await mirrored("POST", tasks, { session: tl, body: custom });
  expect([created.status, created.body.taskKind, created.body.version]).toEqual([201, "custom", 1]);
  expect((await mirrored("POST", tasks, { session: tl, body: { ...custom, windowCode: "days_91" } })).status).toBe(400);
  expect((await mirrored("POST", tasks, { body: custom })).status).toBe(401);
  expect((await mirrored("POST", tasks, { session: p.auditor.session, body: custom })).status).toBe(403);
  expect((await mirrored("POST", tasks, { session: outsider, body: custom })).status).toBe(404);
  const badOwner = await mirrored("POST", tasks, { session: tl, body: { ...custom, ownerUserId: randomUUID() } });
  expect([badOwner.status, badOwner.body.code]).toEqual([422, "validation.user_invalid"]);

  // updateLaunchTask: 428, 400, 401, 403, 404, 409, 200, 422.
  expect((await mirrored("PATCH", one, { session: tl, body: { notes: "Synthetic" } })).status).toBe(428);
  expect((await mirrored("PATCH", one, { session: tl, headers: ifm(a!.version), body: {} })).status).toBe(400);
  expect((await mirrored("PATCH", one, { headers: ifm(a!.version), body: { notes: "x" } })).status).toBe(401);
  expect(
    (await mirrored("PATCH", one, { session: p.auditor.session, headers: ifm(a!.version), body: { notes: "x" } }))
      .status,
  ).toBe(403);
  expect(
    (await mirrored("PATCH", one, { session: outsider, headers: ifm(a!.version), body: { notes: "x" } })).status,
  ).toBe(404);
  expect(
    (await mirrored("PATCH", one, { session: tl, headers: ifm(a!.version + 3), body: { notes: "x" } })).status,
  ).toBe(409);
  const done = await mirrored("PATCH", one, { session: tl, headers: ifm(a!.version), body: { status: "completed" } });
  expect([done.status, done.body.status]).toEqual([200, "completed"]);
  const step = await mirrored("PATCH", one, {
    session: tl,
    headers: ifm(done.body.version),
    body: { status: "not_started" },
  });
  expect([step.status, step.body.code]).toEqual([422, "launch_task.status_step"]);

  // putLaunchTaskPredecessors: 428, 400, 401, 403, 404, 409, 200 (blockedBy), 422 cycle and other plan.
  const preds = `${tasks}/${b!.id}/predecessors`;
  const set = (ids: string[]) => ({ predecessorTaskIds: ids });
  expect((await mirrored("PUT", preds, { session: tl, body: set([]) })).status).toBe(428);
  expect(
    (await mirrored("PUT", preds, { session: tl, headers: ifm(b!.version), body: set([a!.id, a!.id]) })).status,
  ).toBe(400);
  expect((await mirrored("PUT", preds, { headers: ifm(b!.version), body: set([]) })).status).toBe(401);
  expect(
    (await mirrored("PUT", preds, { session: p.auditor.session, headers: ifm(b!.version), body: set([]) })).status,
  ).toBe(403);
  expect((await mirrored("PUT", preds, { session: outsider, headers: ifm(b!.version), body: set([]) })).status).toBe(
    404,
  );
  expect((await mirrored("PUT", preds, { session: tl, headers: ifm(b!.version + 2), body: set([]) })).status).toBe(409);
  const linked = await mirrored("PUT", preds, { session: tl, headers: ifm(b!.version), body: set([created.body.id]) });
  expect([linked.status, linked.body.blockedBy.length]).toEqual([200, 1]);
  const loop = await mirrored("PUT", `${tasks}/${created.body.id}/predecessors`, {
    session: tl,
    headers: ifm(created.body.version),
    body: set([b!.id]),
  });
  expect([loop.status, loop.body.code]).toEqual([422, "launch_task.predecessor_cycle"]);
  const other = await mirrored("PUT", preds, {
    session: tl,
    headers: ifm(linked.body.version),
    body: set([randomUUID()]),
  });
  expect([other.status, other.body.code]).toEqual([422, "launch_task.predecessor_other_plan"]);

  // updateLaunchPlan: 428, 400, 401, 403, 404, 409, 200 (+7 days).
  const v = made.body.version as number;
  const move = { startDate: "2026-10-08" };
  expect((await mirrored("PATCH", plan, { session: tl, body: move })).status).toBe(428);
  expect((await mirrored("PATCH", plan, { session: tl, headers: ifm(v), body: { startDate: null } })).status).toBe(400);
  expect((await mirrored("PATCH", plan, { headers: ifm(v), body: move })).status).toBe(401);
  expect((await mirrored("PATCH", plan, { session: p.auditor.session, headers: ifm(v), body: move })).status).toBe(403);
  expect((await mirrored("PATCH", plan, { session: outsider, headers: ifm(v), body: move })).status).toBe(404);
  expect((await mirrored("PATCH", plan, { session: tl, headers: ifm(v + 4), body: move })).status).toBe(409);
  const moved = await mirrored("PATCH", plan, { session: tl, headers: ifm(v), body: move });
  expect([moved.status, moved.body.lastShiftDays, moved.body.version]).toEqual([200, 7, v + 1]);
}
