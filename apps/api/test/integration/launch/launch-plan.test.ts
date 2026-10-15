// The 90-day launch plan, its tasks and predecessors, the template and the S12-004 port (P5 slice H; ADR-0048 §1-§3,
// §7-§9; p5-work-split §H.1; T-DG5-BE-P). Proves, against the run's disposable PostgreSQL:
//  - REQ-PB-086: with start 2026-10-01 the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30, and all 17 B0134
//    actions appear verbatim (rejoined with "; " they equal launch_window.actions_source_en without its final ".");
//    day d = start + d calendar days, a non-working due date is flagged and never shifted (D-142 Q6);
//  - REQ-S14-004: moving the start date by +7 days moves every unstarted task (and the open Day-90 test) by 7 days and
//    leaves completed and in-progress tasks unchanged; a task whose predecessor is incomplete returns `blockedBy`
//    naming it; a removed link is stamped, never deleted;
//  - a loop gives 422 launch_task.predecessor_cycle; a second generate gives 409 launch_plan.exists; the port replayed
//    three times gives one plan; the ADR-0048 §9 refusals with their exact texts;
//  - AUD (and SP, WL) get 403 on every write, an outsider 404; If-Match gives 428/409; one audit event per row;
//    authorization is re-checked at commit time.
// All data is SYNTHETIC; nothing here is a G1-G6 business approval, and nothing touches DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { launchPlanPort } from "../../../src/modules/automation/ports/launch-plan.ts";
import { launchPlanGenerator } from "../../../src/modules/launch/port.ts";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { ensureDefaultCalendar } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let p: P2World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const planUrl = (t: string) => `/api/v1/transformations/${t}/launch-plan`;
const tasksUrl = (t: string) => `${planUrl(t)}/tasks`;

interface Task {
  id: string;
  ordinal: number;
  templateItemCode: string | null;
  windowCode: string;
  taskKind: string;
  title: string;
  sourceTextEn: string | null;
  startDate: string;
  dueDate: string;
  nonWorkingDay: boolean;
  status: string;
  predecessors: { taskId: string; title: string; status: string }[];
  blockedBy: { taskId: string; title: string; status: string }[];
  version: number;
}

async function allTasks(transformationId: string, session = p.lead.session): Promise<Task[]> {
  const out: Task[] = [];
  let cursor: string | null = null;
  do {
    const res = await send(
      "GET",
      `${tasksUrl(transformationId)}?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
      { session },
    );
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const body = res.body as { items: Task[]; nextCursor: string | null };
    out.push(...body.items);
    cursor = body.nextCursor;
  } while (cursor !== null);
  return out;
}

const patchTask = (t: string, task: { id: string; version: number }, body: unknown, session = p.lead.session) =>
  send("PATCH", `${tasksUrl(t)}/${task.id}`, { session, headers: ifm(task.version), body });
const putPreds = (t: string, task: { id: string; version: number }, ids: string[], session = p.lead.session) =>
  send("PUT", `${tasksUrl(t)}/${task.id}/predecessors`, {
    session,
    headers: ifm(task.version),
    body: { predecessorTaskIds: ids },
  });
const getTask = async (t: string, id: string): Promise<Task> => {
  const res = await send("GET", `${tasksUrl(t)}/${id}`, { session: p.lead.session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body as Task;
};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
  await ensureDefaultCalendar(api, w, send);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("getLaunchPlanTemplate (REQ-PB-086, verbatim B0134)", () => {
  it("returns the three windows and the 33 items; the actions and outputs rejoin to the source cells", async () => {
    const res = await send("GET", "/api/v1/launch-plan-template", { session: p.sponsor.session });
    expect(res.status).toBe(200);
    const body = res.body as {
      sourceRef: string;
      windows: {
        code: string;
        labelEn: string;
        objectiveEn: string;
        actionsSourceEn: string;
        outputsSourceEn: string;
        items: { itemKind: string; textEn: string; startDay: number; dueDay: number }[];
      }[];
    };
    expect(body.sourceRef).toBe("B0134");
    expect(body.windows.map((x) => [x.code, x.labelEn, x.objectiveEn])).toEqual([
      ["days_0_30", "Days 0-30", "Diagnose & align"],
      ["days_31_60", "Days 31-60", "Define & design"],
      ["days_61_90", "Days 61-90", "Mobilize & prove"],
    ]);
    const items = body.windows.flatMap((x) => x.items);
    expect(items).toHaveLength(33);
    expect(items.filter((i) => i.itemKind === "action")).toHaveLength(17);
    expect(items.filter((i) => i.itemKind === "output")).toHaveLength(15);
    expect(items.filter((i) => i.itemKind === "day_ninety_test")).toEqual([
      expect.objectContaining({ textEn: "Day-90 leadership test", startDay: 90, dueDay: 90 }),
    ]);
    for (const win of body.windows) {
      const join = (kind: string) =>
        win.items
          .filter((i) => i.itemKind === kind)
          .map((i) => i.textEn)
          .join("; ");
      expect(join("action")).toBe(win.actionsSourceEn.replace(/\.$/, ""));
      expect(join("output")).toBe(win.outputsSourceEn.replace(/\.$/, ""));
    }
    expect((await send("GET", "/api/v1/launch-plan-template")).status).toBe(401);
  });
});

describe("generateLaunchPlan and getLaunchPlan (REQ-PB-086)", () => {
  it("refuses AUD, SP and WL (403), an outsider (404), and 404s the read while no plan exists", async () => {
    const body = { startDate: "2026-10-01" };
    for (const session of [p.auditor.session, p.sponsor.session, p.contributor.session])
      expect((await send("POST", planUrl(p.transformationId), { session, body })).status).toBe(403);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await send("POST", planUrl(p.transformationId), { session: outsider, body })).status).toBe(404);
    expect((await send("GET", planUrl(p.transformationId), { session: p.lead.session })).status).toBe(404);
    expect(
      await api.db.selectFrom("launch_plan").select("id").where("transformation_id", "=", p.transformationId).execute(),
    ).toEqual([]);
    const bad = await send("POST", planUrl(p.transformationId), {
      session: p.lead.session,
      body: { startDate: "2026-02-30" },
    });
    expect(bad.status).toBe(400);
  });

  it("generates 33 tasks dated start + d calendar days, the Days 31-60 tasks in 2026-11-01..2026-11-30", async () => {
    const res = await send("POST", planUrl(p.transformationId), {
      session: p.lead.session,
      body: { startDate: "2026-10-01" },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.etag).toBe('"1"');
    expect(res.headers.location).toBe(planUrl(p.transformationId));
    expect(res.body).toMatchObject({
      transformationId: p.transformationId,
      startDate: "2026-10-01",
      templateRef: "B0134",
      generatedVia: "request",
      lastShiftDays: null,
      taskCount: 33,
      completedCount: 0,
      version: 1,
    });
    const tasks = await allTasks(p.transformationId);
    expect(tasks).toHaveLength(33);
    // Days 31-60: the 11 tasks start on 2026-11-01 and are due on 2026-11-30 (day 31 and day 60).
    const middle = tasks.filter((t) => t.windowCode === "days_31_60");
    expect(middle).toHaveLength(11);
    for (const t of middle) expect([t.startDate, t.dueDate]).toEqual(["2026-11-01", "2026-11-30"]);
    const windowed = await send("GET", `${tasksUrl(p.transformationId)}?window=days_31_60&limit=100`, {
      session: p.auditor.session,
    });
    expect((windowed.body as { items: Task[] }).items.map((t) => t.id).sort()).toEqual(middle.map((t) => t.id).sort());
    // All 17 B0134 actions verbatim: rejoined per window they equal the source cell without its final ".".
    const windows = await api.db.selectFrom("launch_window").selectAll().orderBy("ordinal").execute();
    const actions = tasks.filter((t) => t.taskKind === "action");
    expect(actions).toHaveLength(17);
    for (const win of windows)
      expect(
        actions
          .filter((t) => t.windowCode === win.code)
          .sort((a, b) => a.ordinal - b.ordinal)
          .map((t) => t.title)
          .join("; "),
      ).toBe(win.actions_source_en.replace(/\.$/, ""));
    for (const t of tasks) expect(t.title).toBe(t.sourceTextEn);
    // The Day-90 test task is due on start + 90; its test row is scheduled the same day.
    const day90 = tasks.find((t) => t.taskKind === "day_ninety_test")!;
    expect([day90.startDate, day90.dueDate]).toEqual(["2026-12-30", "2026-12-30"]);
    const test = await api.db
      .selectFrom("day_ninety_test")
      .selectAll()
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    expect([String(test.scheduled_date), test.status, test.version]).toEqual(["2026-12-30", "open", 1]);
    // A due date on a non-working day (2026-10-31 is a Saturday; Sunday-Thursday workweek) is flagged, never shifted.
    const first = tasks.filter((t) => t.windowCode === "days_0_30");
    for (const t of first) expect([t.dueDate, t.nonWorkingDay]).toEqual(["2026-10-31", true]);
    for (const t of middle) expect(t.nonWorkingDay).toBe(false); // 2026-11-30 is a Monday
    // Tasks are listed by due date.
    expect(tasks.map((t) => t.dueDate)).toEqual([...tasks.map((t) => t.dueDate)].sort());
    // One audit event per row: the plan, every task and the test, each at version 1.
    const planId = (res.body as { id: string }).id;
    expect((await auditOf(api.db, planId)).map((a) => [a.action, a.new_version])).toEqual([
      ["launch_plan.generate", 1],
    ]);
    for (const t of tasks)
      expect((await auditOf(api.db, t.id)).map((a) => [a.action, a.new_version])).toEqual([
        ["launch_task.generate", 1],
      ]);
    expect((await auditOf(api.db, test.id)).map((a) => a.action)).toEqual(["day_ninety_test.create"]);
    // Readers: AUD reads; the plan read carries its ETag.
    const read = await send("GET", planUrl(p.transformationId), { session: p.auditor.session });
    expect([read.status, read.headers.etag]).toEqual([200, '"1"']);
  });

  it("a second generate gives 409 launch_plan.exists and writes nothing", async () => {
    const res = await send("POST", planUrl(p.transformationId), {
      session: p.office.session,
      body: { startDate: "2027-01-01" },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      409,
      "launch_plan.exists",
      "This transformation already has a 90-day launch plan.",
    ]);
    expect(
      await api.db
        .selectFrom("launch_plan")
        .select("start_date")
        .where("transformation_id", "=", p.transformationId)
        .execute(),
    ).toEqual([{ start_date: "2026-10-01" }]);
  });
});

describe("tasks, predecessors and re-dating (REQ-S14-004)", () => {
  it("a task whose predecessor is incomplete returns blockedBy naming it; completing it clears blockedBy", async () => {
    const tasks = await allTasks(p.transformationId);
    const a = tasks.find((t) => t.templateItemCode === "w2_a1")!; // Agree North Star/outcomes
    const b = tasks.find((t) => t.templateItemCode === "w2_a2")!; // build KPI tree
    const put = await putPreds(p.transformationId, b, [a.id]);
    expect(put.status, JSON.stringify(put.body)).toBe(200);
    expect(put.body.version).toBe(b.version + 1);
    expect(put.body.predecessors).toEqual([
      { taskId: a.id, ordinal: a.ordinal, title: "Agree North Star/outcomes", status: "not_started" },
    ]);
    expect(put.body.blockedBy).toEqual(put.body.predecessors);
    // A blocked task can still be started.
    const started = await patchTask(p.transformationId, put.body, { status: "in_progress" });
    expect([started.status, started.body.status, started.body.blockedBy.length]).toEqual([200, "in_progress", 1]);
    const aDone = await patchTask(p.transformationId, a, { status: "completed" });
    expect([aDone.status, aDone.body.status]).toEqual([200, "completed"]);
    expect(aDone.body.completedBy).toBe(p.lead.id);
    const after = await getTask(p.transformationId, b.id);
    expect(after.blockedBy).toEqual([]);
    expect(after.predecessors.map((x) => [x.taskId, x.status])).toEqual([[a.id, "completed"]]);
    // One audit event per row: the link, the task's replacement, each task update.
    const link = await api.db
      .selectFrom("launch_task_predecessor")
      .selectAll()
      .where("task_id", "=", b.id)
      .executeTakeFirstOrThrow();
    expect((await auditOf(api.db, link.id)).map((x) => x.action)).toEqual(["launch_task_predecessor.add"]);
    expect((await auditOf(api.db, b.id)).map((x) => x.action)).toEqual([
      "launch_task.generate",
      "launch_task.predecessors_replace",
      "launch_task.in_progress",
    ]);
  });

  it("moving the start date by +7 days moves every unstarted task by 7 and leaves completed tasks unchanged", async () => {
    const before = await allTasks(p.transformationId);
    const plan = await send("GET", planUrl(p.transformationId), { session: p.lead.session });
    const url = planUrl(p.transformationId);
    const body = { startDate: "2026-10-08" };
    expect((await send("PATCH", url, { session: p.lead.session, body })).status).toBe(428);
    expect(
      (await send("PATCH", url, { session: p.lead.session, headers: ifm(plan.body.version + 1), body })).status,
    ).toBe(409);
    expect(
      (await send("PATCH", url, { session: p.auditor.session, headers: ifm(plan.body.version), body })).status,
    ).toBe(403);
    const res = await send("PATCH", url, { session: p.office.session, headers: ifm(plan.body.version), body });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({
      startDate: "2026-10-08",
      lastShiftDays: 7,
      version: plan.body.version + 1,
      completedCount: 1,
    });
    const after = new Map((await allTasks(p.transformationId)).map((t) => [t.id, t]));
    const plus7 = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 7 * 86_400_000).toISOString().slice(0, 10);
    let moved = 0;
    for (const t of before) {
      const now = after.get(t.id)!;
      if (t.status === "not_started") {
        expect([now.startDate, now.dueDate]).toEqual([plus7(t.startDate), plus7(t.dueDate)]);
        expect(now.version).toBe(t.version + 1);
        moved += 1;
      } else {
        expect([now.startDate, now.dueDate, now.version]).toEqual([t.startDate, t.dueDate, t.version]);
      }
    }
    expect(moved).toBe(31); // 33 minus the completed w2_a1 and the in-progress w2_a2
    const completed = before.find((t) => t.templateItemCode === "w2_a1")!;
    expect(after.get(completed.id)!.dueDate).toBe("2026-11-30");
    const test = await api.db
      .selectFrom("day_ninety_test")
      .select(["id", "scheduled_date", "version"])
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    expect([String(test.scheduled_date), test.version]).toEqual(["2027-01-06", 2]);
    expect((await auditOf(api.db, test.id)).map((a) => a.action)).toEqual([
      "day_ninety_test.create",
      "day_ninety_test.redate",
    ]);
    const movedTask = before.find((t) => t.templateItemCode === "w3_a1")!;
    expect((await auditOf(api.db, movedTask.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["launch_task.generate", 1],
      ["launch_task.redate", 2],
    ]);
    // The same start date again writes nothing.
    const same = await send("PATCH", url, { session: p.lead.session, headers: ifm(res.body.version), body });
    expect([same.status, same.body.version]).toEqual([200, res.body.version]);
  });

  it("a loop gives 422 launch_task.predecessor_cycle; a task of another plan gives 422 .predecessor_other_plan", async () => {
    const tasks = await allTasks(p.transformationId);
    const a = tasks.find((t) => t.templateItemCode === "w3_a1")!;
    const b = tasks.find((t) => t.templateItemCode === "w3_a2")!;
    const c = tasks.find((t) => t.templateItemCode === "w3_a3")!;
    const ab = await putPreds(p.transformationId, b, [a.id]);
    expect(ab.status).toBe(200);
    const bc = await putPreds(p.transformationId, c, [b.id]);
    expect(bc.status).toBe(200);
    const loop = await putPreds(p.transformationId, a, [c.id]);
    expect([loop.status, loop.body.code, loop.body.detail]).toEqual([
      422,
      "launch_task.predecessor_cycle",
      "This predecessor would make the tasks depend on each other in a loop.",
    ]);
    const self = await putPreds(p.transformationId, a, [a.id]);
    expect([self.status, self.body.code]).toEqual([422, "launch_task.predecessor_cycle"]);
    const other = await putPreds(p.transformationId, a, [randomUUID()]);
    expect([other.status, other.body.code, other.body.detail]).toEqual([
      422,
      "launch_task.predecessor_other_plan",
      "A predecessor must be a task of the same launch plan.",
    ]);
    // 428, 409, AUD 403.
    expect(
      (
        await send("PUT", `${tasksUrl(p.transformationId)}/${a.id}/predecessors`, {
          session: p.lead.session,
          body: { predecessorTaskIds: [] },
        })
      ).status,
    ).toBe(428);
    expect((await putPreds(p.transformationId, { id: a.id, version: a.version + 5 }, [])).status).toBe(409);
    expect((await putPreds(p.transformationId, a, [], p.auditor.session)).status).toBe(403);
    // Removing a link stamps it (never deleted); re-adding makes a new row; the cycle check sees only active links.
    const cleared = await putPreds(p.transformationId, bc.body, []);
    expect([cleared.status, cleared.body.predecessors]).toEqual([200, []]);
    const rows = await api.db.selectFrom("launch_task_predecessor").selectAll().where("task_id", "=", c.id).execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.removed_at).not.toBeNull();
    expect(rows[0]!.removed_by).toBe(p.lead.id);
    expect((await auditOf(api.db, rows[0]!.id)).map((x) => [x.action, x.new_version])).toEqual([
      ["launch_task_predecessor.add", 1],
      ["launch_task_predecessor.remove", 2],
    ]);
    const aNow = await getTask(p.transformationId, a.id);
    const noLoop = await putPreds(p.transformationId, aNow, [c.id]);
    expect(noLoop.status).toBe(200);
    const readd = await putPreds(p.transformationId, cleared.body, [b.id]);
    expect(readd.status).toBe(422); // c -> b -> a -> c would now be a loop
    // An unchanged set writes nothing.
    const same = await putPreds(p.transformationId, noLoop.body, [c.id]);
    expect([same.status, same.body.version]).toEqual([200, noLoop.body.version]);
  });

  it("updateLaunchTask: status steps, completed dates, cancelled, output record, owner, If-Match and AUD", async () => {
    const tasks = await allTasks(p.transformationId);
    const done = tasks.find((t) => t.templateItemCode === "w2_a1")!; // completed earlier
    const step = await patchTask(p.transformationId, done, { status: "not_started" });
    expect([step.status, step.body.code, step.body.detail]).toEqual([
      422,
      "launch_task.status_step",
      "This status change is not allowed for the task.",
    ]);
    const fixed = await patchTask(p.transformationId, done, { dueDate: "2026-12-01" });
    expect([fixed.status, fixed.body.code, fixed.body.detail]).toEqual([
      422,
      "launch_task.completed_dates_fixed",
      "A completed task keeps its dates; reopen it first.",
    ]);
    const reopened = await patchTask(p.transformationId, done, { status: "in_progress" });
    expect([reopened.status, reopened.body.status, reopened.body.completedAt]).toEqual([200, "in_progress", null]);
    const redated = await patchTask(p.transformationId, reopened.body, { dueDate: "2026-12-01" });
    expect([redated.status, redated.body.dueDate]).toEqual([200, "2026-12-01"]);
    const order = await patchTask(p.transformationId, redated.body, { dueDate: "2026-01-01" });
    expect([order.status, order.body.errors?.[0]?.pointer]).toEqual([400, "/dueDate"]);

    const charterTask = tasks.find((t) => t.templateItemCode === "w1_o1")!; // Charter v0.9 -> charter
    const wrong = await patchTask(p.transformationId, charterTask, { outputRecordId: randomUUID() });
    expect([wrong.status, wrong.body.code, wrong.body.detail]).toEqual([
      422,
      "launch_task.output_record_invalid",
      "The output must be a record of the required type in this transformation.",
    ]);
    const typeChange = await patchTask(p.transformationId, charterTask, { outputRecordType: "baseline" });
    expect([typeChange.status, typeChange.body.code]).toEqual([422, "launch_task.output_record_invalid"]);
    const charter = await api.db
      .selectFrom("charter")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .executeTakeFirst();
    if (charter) {
      const linked = await patchTask(p.transformationId, charterTask, { outputRecordId: charter.id });
      expect([linked.status, linked.body.outputRecordType, linked.body.outputRecordId]).toEqual([
        200,
        "charter",
        charter.id,
      ]);
    }
    const current = await getTask(p.transformationId, charterTask.id);
    const owner = await patchTask(p.transformationId, current, { ownerUserId: w.officeB.id });
    expect([owner.status, owner.body.code]).toEqual([422, "validation.user_invalid"]);
    const owned = await patchTask(p.transformationId, current, {
      ownerUserId: p.sponsor.id,
      title: "Charter v0.9 (synthetic)",
    });
    expect([owned.status, owned.body.ownerUserId, owned.body.title, owned.body.sourceTextEn]).toEqual([
      200,
      p.sponsor.id,
      "Charter v0.9 (synthetic)",
      "Charter v0.9",
    ]);
    expect(
      (
        await send("PATCH", `${tasksUrl(p.transformationId)}/${current.id}`, {
          session: p.lead.session,
          body: { notes: "x" },
        })
      ).status,
    ).toBe(428);
    expect((await patchTask(p.transformationId, current, { notes: "stale" })).status).toBe(409);
    for (const session of [p.auditor.session, p.sponsor.session])
      expect((await patchTask(p.transformationId, owned.body, { notes: "no" }, session)).status).toBe(403);
    expect((await patchTask(p.transformationId, owned.body, {})).status).toBe(400);

    const cancelled = await patchTask(p.transformationId, owned.body, { status: "cancelled" });
    expect([cancelled.status, cancelled.body.status]).toEqual([200, "cancelled"]);
    const final = await patchTask(p.transformationId, cancelled.body, { title: "again" });
    expect([final.status, final.body.code, final.body.detail]).toEqual([
      422,
      "launch_task.cancelled",
      "A cancelled task cannot be changed.",
    ]);
    expect((await auditOf(api.db, current.id)).map((a) => a.action).slice(-2)).toEqual([
      "launch_task.update",
      "launch_task.cancelled",
    ]);
  });

  it("createLaunchTask: a custom task at version 1; 400, 403, 404 and validation.user_invalid", async () => {
    const url = tasksUrl(p.transformationId);
    const body = {
      windowCode: "days_61_90",
      title: "Synthetic custom task",
      startDate: "2026-12-10",
      dueDate: "2026-12-20",
    };
    const res = await send("POST", url, { session: p.office.session, body: { ...body, ownerUserId: p.lead.id } });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.headers.location).toBe(`${url}/${res.body.id}`);
    expect(res.body).toMatchObject({
      ordinal: 34,
      templateItemCode: null,
      taskKind: "custom",
      sourceTextEn: null,
      status: "not_started",
      ownerUserId: p.lead.id,
      version: 1,
      predecessors: [],
      blockedBy: [],
    });
    expect((await auditOf(api.db, res.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["launch_task.create", 1],
    ]);
    expect((await send("POST", url, { session: p.auditor.session, body })).status).toBe(403);
    expect((await send("POST", url, { session: p.contributor.session, body })).status).toBe(403);
    expect(
      (await send("POST", url, { session: p.lead.session, body: { ...body, dueDate: "2026-12-01" } })).status,
    ).toBe(400);
    expect((await send("POST", url, { session: p.lead.session, body: { ...body, title: "   " } })).status).toBe(400);
    const owner = await send("POST", url, { session: p.lead.session, body: { ...body, ownerUserId: randomUUID() } });
    expect([owner.status, owner.body.code]).toEqual([422, "validation.user_invalid"]);
    // A transformation without a plan: 404 on the task list and on create.
    const q = await setupP2World(api, w);
    expect((await send("GET", tasksUrl(q.transformationId), { session: q.lead.session })).status).toBe(404);
    expect((await send("POST", tasksUrl(q.transformationId), { session: q.lead.session, body })).status).toBe(404);
  });

  it("re-checks launch_plan.edit at commit time (a grant revoked mid-request gives 403 and writes nothing)", async () => {
    const q = await setupP2World(api, w);
    const res = await afterIdentity(
      api,
      q.lead.id,
      () => send("POST", planUrl(q.transformationId), { session: q.lead.session, body: { startDate: "2026-10-01" } }),
      () => revokeAll(api, w.grantor.id, q.lead.id),
    );
    expect(res.status).toBe(403);
    expect(
      await api.db.selectFrom("launch_plan").select("id").where("transformation_id", "=", q.transformationId).execute(),
    ).toEqual([]);
  });
});

describe("the S12-004 LaunchPlanPort (ADR-0044 §1)", () => {
  it("is registered in the API process; replayed three times it gives one plan dated from the start date", async () => {
    expect(launchPlanPort()).toBe(launchPlanGenerator);
    const q = await setupP2World(api, w);
    const request = {
      transformationId: q.transformationId,
      startDate: "2026-10-01",
      idempotencyKey: `launch_plan:${q.transformationId}`,
    };
    const outcomes = [];
    for (let i = 0; i < 3; i += 1)
      outcomes.push(await api.db.transaction().execute((tx) => launchPlanPort().generate(tx, request)));
    expect(outcomes.map((o) => o.outcome)).toEqual(["created", "existing", "existing"]);
    const plans = await api.db
      .selectFrom("launch_plan")
      .selectAll()
      .where("transformation_id", "=", q.transformationId)
      .execute();
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({ generated_via: "automation", idempotency_key: request.idempotencyKey });
    expect(outcomes.every((o) => o.outcome !== "port_unavailable" && o.launchPlanId === plans[0]!.id)).toBe(true);
    const tasks = await allTasks(q.transformationId, q.lead.session);
    expect(tasks).toHaveLength(33);
    for (const t of tasks.filter((x) => x.windowCode === "days_31_60"))
      expect([t.startDate, t.dueDate]).toEqual(["2026-11-01", "2026-11-30"]);
    const audit = await auditOf(api.db, plans[0]!.id);
    expect(audit.map((a) => [a.action, a.actor_type, a.on_behalf_of_user_id])).toEqual([
      ["launch_plan.generate", "service", q.lead.id],
    ]);
    // The request path then refuses a second plan.
    const again = await send("POST", planUrl(q.transformationId), {
      session: q.lead.session,
      body: { startDate: "2026-10-01" },
    });
    expect([again.status, again.body.code]).toEqual([409, "launch_plan.exists"]);
    await expect(
      api.db
        .transaction()
        .execute((tx) => launchPlanPort().generate(tx, { ...request, idempotencyKey: "launch_plan:x" })),
    ).rejects.toThrow(/idempotency key/);
  });
});
