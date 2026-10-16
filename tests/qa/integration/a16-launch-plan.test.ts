// A16 "Health and launch", part 2: the 90-day launch plan and the Day-90 leadership test (qa-verifier, T-DG5-QA-D).
// Scenario (master prompt §20 A16): "... launch tasks are generated from the chosen start date". Through the REAL API
// (Fastify inject on a disposable PostgreSQL; every response validated against docs/api/openapi.yaml by the harness)
// and, for the creation-time option, the worker's EXPORTED starter-1 job function given the relay's envelope of the
// real outbox row (the production worker's composition registers the same launch-plan port first). Each check is
// derived from the acceptance text of the row named in its title (docs/delivery/requirements.csv) and the contract;
// the expected texts come from docs/source/playbook.md (B0134, B0136-B0141), never from the product:
//  - REQ-PB-086: with start date 2026-10-01 the Days 31-60 tasks fall between 2026-11-01 and 2026-11-30; all actions
//    of B0134 appear (and every output, and the Day-90 test: day d = start date + d calendar days);
//  - REQ-S14-004: moving the start date by +7 days moves every unstarted task by 7 days and leaves completed tasks
//    unchanged; a task whose predecessor is incomplete shows 'blocked by' the predecessor;
//  - REQ-PB-087: all six questions render verbatim; unanswered questions mark the test incomplete;
//  - REQ-S12-004 (A16 part): with the plan flag, creating a transformation dates the 90-day tasks from the start date,
//    and a retry creates no duplicates (one set of phase checklists and role tasks).
// Every mutation is checked for authorization (AUD 403, other organization 404), If-Match (428/409) and its audit rows.
// All data is SYNTHETIC. A Day-90 answer is an assessment by a test person, not an approval; nothing here grants a real
// business, Finance or IT approval or touches the engineering gates DG0-DG7.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest } from "../../../apps/api/test/support/harness.ts";
import { call, startApi, uniq, type Res, type Session, type TestApi } from "../support/api.ts";
import { seedNativeGateWorld, type NativeGateWorld } from "../support/gates-native.ts";
import { seedWorld, type World } from "../support/p4.ts";
import {
  addDays,
  b0134Windows,
  dayNinetyQuestions,
  envelopesOf,
  handleTransformationCreated,
  wireWorkerLaunchPlanPort,
} from "../support/a16.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

let api: TestApi;
let w: World;
let g: NativeGateWorld;
let LP: string;
const START = "2026-10-01";
const WINDOWS = ["days_0_30", "days_31_60", "days_61_90"] as const;
const send = (method: string, url: string, opts: Parameters<typeof call>[3] = {}) =>
  call<Body>(api.app, method, url, opts);
const ifm = (v: number) => ({ "if-match": `"${v}"` });
const codeOf = (r: Res<Body>) => [r.status, r.body?.code];

async function mutate(session: Session, method: string, url: string, body?: unknown, version?: number) {
  const rid = `qa-a16-${randomUUID()}`;
  const res = await send(method, url, {
    session,
    ...(body !== undefined ? { body } : {}),
    headers: { "x-request-id": rid, ...(version !== undefined ? ifm(version) : {}) },
  });
  return { res, rid };
}

/** Every task of a plan (all pages). */
async function allTasks(base: string, session: Session): Promise<Body[]> {
  const out: Body[] = [];
  let cursor: string | null = null;
  do {
    const q: string = cursor ? `?limit=100&cursor=${encodeURIComponent(cursor)}` : "?limit=100";
    const r = await send("GET", `${base}/launch-plan/tasks${q}`, { session });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    out.push(...(r.body.items as Body[]));
    cursor = r.body.nextCursor;
  } while (cursor);
  return out;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().replace(/\.$/, "");

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  g = await seedNativeGateWorld(api, w, "A16 launch");
  LP = `${g.base}/launch-plan`;
}, 180_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("REQ-PB-086: the 90-day launch plan generated from the chosen start date", () => {
  it("the launch template carries the three B0134 windows verbatim", async () => {
    const source = b0134Windows();
    expect(source.map((s) => s.label)).toEqual(["Days 0-30", "Days 31-60", "Days 61-90"]);
    const r = await send("GET", "/api/v1/launch-plan-template", { session: g.auditor.session });
    expect(r.status).toBe(200);
    const windows = (r.body.windows as Body[]).sort((x, y) => x.ordinal - y.ordinal);
    expect(windows.map((x) => x.code)).toEqual([...WINDOWS]);
    for (const [i, s] of source.entries()) {
      expect(windows[i].labelEn).toBe(s.label);
      expect(windows[i].objectiveEn).toBe(s.objective);
      expect(windows[i].actionsSourceEn).toBe(s.actionsCell);
      expect(windows[i].outputsSourceEn).toBe(s.outputsCell);
    }
  });

  it("generation is refused to AUD (403) and to another organization (404), and writes nothing", async () => {
    expect((await mutate(g.auditor.session, "POST", LP, { startDate: START })).res.status).toBe(403);
    expect((await mutate(g.outsider.session, "POST", LP, { startDate: START })).res.status).toBe(404);
    expect((await send("GET", LP, { session: g.tl.session })).status).toBe(404);
  });

  it("start 2026-10-01: Days 31-60 tasks fall between 2026-11-01 and 2026-11-30; every B0134 action and output appears; Day-90 test on day 90", async () => {
    const { res, rid } = await mutate(g.tl.session, "POST", LP, { startDate: START });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      startDate: START,
      generatedVia: "request",
      lastShiftDays: null,
      completedCount: 0,
    });
    expect((await auditOfRequest(api.db, rid)).length).toBeGreaterThanOrEqual(1);
    const tasks = await allTasks(g.base, g.tl.session);
    expect(tasks).toHaveLength(res.body.taskCount);
    // The windows' calendar ranges: day d = start + d calendar days.
    const ranges: Record<string, [string, string]> = {
      days_0_30: [addDays(START, 0), addDays(START, 30)],
      days_31_60: [addDays(START, 31), addDays(START, 60)],
      days_61_90: [addDays(START, 61), addDays(START, 90)],
    };
    expect(ranges.days_31_60).toEqual(["2026-11-01", "2026-11-30"]);
    for (const t of tasks) {
      const [from, to] = ranges[t.windowCode]!;
      expect(
        t.startDate >= from && t.dueDate <= to && t.startDate <= t.dueDate,
        `${t.title} ${t.startDate}..${t.dueDate}`,
      ).toBe(true);
      expect(t.status).toBe("not_started");
    }
    const mid = tasks.filter((t) => t.windowCode === "days_31_60");
    expect(mid.length).toBeGreaterThan(0);
    for (const t of mid) {
      expect(t.startDate >= "2026-11-01", t.title).toBe(true);
      expect(t.dueDate <= "2026-11-30", t.title).toBe(true);
    }
    // All actions (and outputs) of B0134 appear, each in its window, verbatim.
    const source = b0134Windows();
    for (const [i, s] of source.entries()) {
      const inWindow = tasks.filter((t) => t.windowCode === WINDOWS[i]);
      const actions = inWindow.filter((t) => t.taskKind === "action").map((t) => norm(t.sourceTextEn));
      const outputs = inWindow.filter((t) => t.taskKind === "output").map((t) => norm(t.sourceTextEn));
      expect(actions.sort()).toEqual([...s.actions].sort());
      expect(outputs.sort()).toEqual([...s.outputs].sort());
    }
    expect(source.flatMap((s) => s.actions)).toHaveLength(17);
    // The Day-90 leadership test is a task due on day 90.
    const d90 = tasks.filter((t) => t.taskKind === "day_ninety_test");
    expect(d90).toHaveLength(1);
    expect(d90[0].dueDate).toBe(addDays(START, 90));
    expect(d90[0].dueDate).toBe("2026-12-30");
    // The same plan, read back, and a second generation is refused.
    const again = await mutate(g.tl.session, "POST", LP, { startDate: "2026-10-02" });
    expect(codeOf(again.res)).toEqual([409, "launch_plan.exists"]);
    expect((await allTasks(g.base, g.tl.session)).length).toBe(tasks.length);
    const plan = await send("GET", LP, { session: g.auditor.session });
    expect([plan.status, plan.body.startDate]).toEqual([200, START]);
  });
});

describe("REQ-PB-087: the Day-90 leadership test", () => {
  it("all six questions render verbatim (B0136-B0141); with no answer the test is incomplete (0/6)", async () => {
    const r = await send("GET", `${g.base}/day-90-test`, { session: g.auditor.session });
    expect(r.status).toBe(200);
    expect(r.body.scheduledDate).toBe(addDays(START, 90));
    expect(r.body.status).toBe("open");
    const qs = (r.body.questions as Body[]).sort((x, y) => x.ordinal - y.ordinal);
    expect(qs.map((q) => q.textEn)).toEqual(dayNinetyQuestions());
    expect(qs.map((q) => q.code)).toEqual(["q1", "q2", "q3", "q4", "q5", "q6"]);
    for (const q of qs) {
      expect(q.textAr.trim().length).toBeGreaterThan(0);
      expect(q.response).toBeNull();
    }
    expect(r.body.completion).toEqual({ answered: 0, total: 6, complete: false });
  });

  it("five answers: incomplete (5/6) and completion is refused; AUD cannot answer", async () => {
    let t = (await send("GET", `${g.base}/day-90-test`, { session: g.tl.session })).body;
    const aud = await mutate(
      g.auditor.session,
      "PUT",
      `${g.base}/day-90-test/responses/q1`,
      { answer: "yes" },
      t.version,
    );
    expect(aud.res.status).toBe(403);
    const noIfMatch = await send("PUT", `${g.base}/day-90-test/responses/q1`, {
      session: g.sp.session,
      body: { answer: "yes" },
    });
    expect(noIfMatch.status).toBe(428);
    for (const code of ["q1", "q2", "q3", "q4", "q5"]) {
      const { res, rid } = await mutate(
        code === "q1" ? g.sp.session : g.tl.session,
        "PUT",
        `${g.base}/day-90-test/responses/${code}`,
        { answer: code === "q3" ? "no" : "yes", comment: `Synthetic QA comment ${code}` },
        t.version,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect((await auditOfRequest(api.db, rid)).length).toBeGreaterThanOrEqual(1);
      t = res.body;
    }
    expect(t.completion).toEqual({ answered: 5, total: 6, complete: false });
    const stale = await mutate(
      g.tl.session,
      "PUT",
      `${g.base}/day-90-test/responses/q6`,
      { answer: "yes" },
      t.version - 1,
    );
    expect(stale.res.status).toBe(409);
    const early = await mutate(g.tl.session, "POST", `${g.base}/day-90-test/complete`, undefined, t.version);
    expect(codeOf(early.res)).toEqual([422, "day_ninety_test.incomplete"]);
    const read = (await send("GET", `${g.base}/day-90-test`, { session: g.tl.session })).body;
    expect([read.status, read.completion.complete]).toEqual(["open", false]);
  });
});

describe("REQ-S14-004: editable tasks, 'blocked by' and re-dating unstarted tasks", () => {
  let tasks: Body[];
  let doneTask: Body;
  let progressTask: Body;
  let blocker: Body;
  let blocked: Body;

  it("owners are assigned; a task whose predecessor is incomplete shows 'blocked by' the predecessor", async () => {
    tasks = (await allTasks(g.base, g.tl.session)).sort((x, y) => x.ordinal - y.ordinal);
    blocker = tasks.find((t) => t.windowCode === "days_0_30" && t.taskKind === "action")!;
    blocked = tasks.find((t) => t.windowCode === "days_31_60" && t.taskKind === "action")!;
    const owned = await mutate(
      g.tl.session,
      "PATCH",
      `${LP}/tasks/${blocker.id}`,
      { ownerUserId: g.bo.id },
      blocker.version,
    );
    expect(owned.res.status, JSON.stringify(owned.res.body)).toBe(200);
    expect(owned.res.body.ownerUserId).toBe(g.bo.id);
    blocker = owned.res.body;
    // An owner from another organization is refused.
    const foreign = await mutate(
      g.tl.session,
      "PATCH",
      `${LP}/tasks/${blocker.id}`,
      { ownerUserId: g.outsider.id },
      blocker.version,
    );
    expect(codeOf(foreign.res)).toEqual([422, "validation.user_invalid"]);
    const link = await mutate(
      g.tl.session,
      "PUT",
      `${LP}/tasks/${blocked.id}/predecessors`,
      { predecessorTaskIds: [blocker.id] },
      blocked.version,
    );
    expect(link.res.status, JSON.stringify(link.res.body)).toBe(200);
    expect(link.res.body.blockedBy.map((b: Body) => b.taskId)).toEqual([blocker.id]);
    const read = await send("GET", `${LP}/tasks/${blocked.id}`, { session: g.auditor.session });
    expect(read.body.predecessors.map((b: Body) => b.taskId)).toEqual([blocker.id]);
    expect(read.body.blockedBy).toEqual([
      expect.objectContaining({ taskId: blocker.id, ordinal: blocker.ordinal, status: "not_started" }),
    ]);
    blocked = read.body;
    // A loop is refused.
    const loop = await mutate(
      g.tl.session,
      "PUT",
      `${LP}/tasks/${blocker.id}/predecessors`,
      { predecessorTaskIds: [blocked.id] },
      blocker.version,
    );
    expect(codeOf(loop.res)).toEqual([422, "launch_task.predecessor_cycle"]);
  });

  it("completing the predecessor clears 'blocked by'", async () => {
    const done = await mutate(
      g.tl.session,
      "PATCH",
      `${LP}/tasks/${blocker.id}`,
      { status: "completed" },
      blocker.version,
    );
    expect(done.res.status, JSON.stringify(done.res.body)).toBe(200);
    expect(done.res.body.status).toBe("completed");
    doneTask = done.res.body;
    const read = await send("GET", `${LP}/tasks/${blocked.id}`, { session: g.tl.session });
    expect(read.body.blockedBy).toEqual([]);
    expect(read.body.predecessors.map((b: Body) => b.taskId)).toEqual([blocker.id]);
    const p = tasks.find((t) => t.windowCode === "days_61_90" && t.taskKind === "output")!;
    const started = await mutate(g.tl.session, "PATCH", `${LP}/tasks/${p.id}`, { status: "in_progress" }, p.version);
    expect(started.res.status, JSON.stringify(started.res.body)).toBe(200);
    progressTask = started.res.body;
  });

  it("+7 days moves every unstarted task by 7 days and leaves completed (and started) tasks unchanged; the open Day-90 test moves too", async () => {
    const before = await allTasks(g.base, g.tl.session);
    const plan = (await send("GET", LP, { session: g.tl.session })).body;
    const test = (await send("GET", `${g.base}/day-90-test`, { session: g.tl.session })).body;
    // If-Match is required and must be current.
    expect((await send("PATCH", LP, { session: g.tl.session, body: { startDate: addDays(START, 7) } })).status).toBe(
      428,
    );
    expect(
      (await mutate(g.tl.session, "PATCH", LP, { startDate: addDays(START, 7) }, plan.version + 5)).res.status,
    ).toBe(409);
    expect(
      (await mutate(g.auditor.session, "PATCH", LP, { startDate: addDays(START, 7) }, plan.version)).res.status,
    ).toBe(403);
    const { res, rid } = await mutate(g.tl.session, "PATCH", LP, { startDate: addDays(START, 7) }, plan.version);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect([res.body.startDate, res.body.lastShiftDays]).toEqual(["2026-10-08", 7]);
    expect((await auditOfRequest(api.db, rid)).length).toBeGreaterThanOrEqual(1);
    const after = new Map((await allTasks(g.base, g.tl.session)).map((t) => [t.id, t]));
    let moved = 0;
    for (const b of before) {
      const a = after.get(b.id)!;
      if (b.status === "not_started") {
        expect([a.startDate, a.dueDate], b.title).toEqual([addDays(b.startDate, 7), addDays(b.dueDate, 7)]);
        moved++;
      } else {
        expect([a.startDate, a.dueDate], `${b.status} ${b.title}`).toEqual([b.startDate, b.dueDate]);
      }
    }
    expect(moved).toBe(before.length - 2);
    expect([after.get(doneTask.id)!.dueDate, after.get(progressTask.id)!.dueDate]).toEqual([
      doneTask.dueDate,
      progressTask.dueDate,
    ]);
    const test2 = (await send("GET", `${g.base}/day-90-test`, { session: g.tl.session })).body;
    expect(test2.scheduledDate).toBe(addDays(test.scheduledDate, 7));
    // A completed task's dates cannot be edited directly either.
    const fixed = await mutate(
      g.tl.session,
      "PATCH",
      `${LP}/tasks/${doneTask.id}`,
      { dueDate: "2026-12-01" },
      after.get(doneTask.id)!.version,
    );
    expect(codeOf(fixed.res)).toEqual([422, "launch_task.completed_dates_fixed"]);
  });

  it("REQ-PB-087: the sixth answer completes the test; a completed test is final", async () => {
    let t = (await send("GET", `${g.base}/day-90-test`, { session: g.tl.session })).body;
    const sixth = await mutate(g.sp.session, "PUT", `${g.base}/day-90-test/responses/q6`, { answer: "yes" }, t.version);
    expect(sixth.res.status, JSON.stringify(sixth.res.body)).toBe(200);
    t = sixth.res.body;
    expect(t.completion).toEqual({ answered: 6, total: 6, complete: true });
    const done = await mutate(g.sp.session, "POST", `${g.base}/day-90-test/complete`, undefined, t.version);
    expect(done.res.status, JSON.stringify(done.res.body)).toBe(200);
    expect(done.res.body.status).toBe("completed");
    const late = await mutate(
      g.tl.session,
      "PUT",
      `${g.base}/day-90-test/responses/q1`,
      { answer: "no" },
      done.res.body.version,
    );
    expect(codeOf(late.res)).toEqual([422, "day_ninety_test.completed"]);
  });
});

describe("REQ-S12-004 (A16): with the plan flag, creating a transformation dates the 90-day tasks from the start date; a retry creates nothing more", () => {
  it("starter 1 generates the plan from launchPlan.startDate once; replaying the event duplicates nothing", async () => {
    // The production worker's composition registers the launch-plan port before it consumes events (worker.ts).
    wireWorkerLaunchPlanPort();
    const created = await mutate(g.tl.session, "POST", "/api/v1/transformations", {
      businessUnitId: w.a1,
      name: `Synthetic QA A16 plan flag ${uniq("T")}`,
      mode: "end_to_end",
      launchPlan: { startDate: START },
    });
    expect(created.res.status, JSON.stringify(created.res.body)).toBe(201);
    const tid = created.res.body.id as string;
    const base = `/api/v1/transformations/${tid}`;
    const [env] = await envelopesOf(api, tid, "transformation.created");
    expect(env!.schemaVersion).toBe(2);
    expect(env!.payload.launchPlan).toEqual({ startDate: START });
    expect(await handleTransformationCreated(api.db, env!, "qa-a16-starter-1")).toBe("done");
    const plan = await send("GET", `${base}/launch-plan`, { session: g.tl.session });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect([plan.body.startDate, plan.body.generatedVia]).toEqual([START, "automation"]);
    const tasks = await allTasks(base, g.tl.session);
    expect(tasks).toHaveLength(plan.body.taskCount);
    const mid = tasks.filter((t) => t.windowCode === "days_31_60");
    expect(mid.length).toBeGreaterThan(0);
    for (const t of mid) expect(t.startDate >= "2026-11-01" && t.dueDate <= "2026-11-30", t.title).toBe(true);
    expect(tasks.find((t) => t.taskKind === "day_ninety_test")!.dueDate).toBe("2026-12-30");
    const counts = async () => ({
      tasks: (await allTasks(base, g.tl.session)).length,
      steps: Number(
        (
          await api.db
            .selectFrom("phase_step")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("transformation_id", "=", tid)
            .executeTakeFirstOrThrow()
        ).n,
      ),
      roleTasks: Number(
        (
          await api.db
            .selectFrom("work_item")
            .select((eb) => eb.fn.countAll<string>().as("n"))
            .where("kind", "=", "role_assignment")
            .where("transformation_id", "=", tid)
            .executeTakeFirstOrThrow()
        ).n,
      ),
    });
    const first = await counts();
    expect(first.steps).toBeGreaterThan(0);
    expect(first.roleTasks).toBeGreaterThan(0);
    // A retry (same job) and a redelivery (another job id) create nothing more.
    expect(await handleTransformationCreated(api.db, env!, "qa-a16-starter-1")).toBe("duplicate");
    expect(await handleTransformationCreated(api.db, env!, "qa-a16-starter-1-redelivery")).toBe("duplicate");
    expect(await counts()).toEqual(first);
    const plans = await api.db.selectFrom("launch_plan").select("id").where("transformation_id", "=", tid).execute();
    expect(plans).toHaveLength(1);
  });

  it("without the flag no plan is generated", async () => {
    const created = await send("POST", "/api/v1/transformations", {
      session: g.tl.session,
      body: { businessUnitId: w.a1, name: `Synthetic QA A16 no plan ${uniq("T")}`, mode: "end_to_end" },
    });
    expect(created.status).toBe(201);
    const tid = created.body.id as string;
    const [env] = await envelopesOf(api, tid, "transformation.created");
    expect(await handleTransformationCreated(api.db, env!, "qa-a16-starter-1-noflag")).toBe("done");
    expect((await send("GET", `/api/v1/transformations/${tid}/launch-plan`, { session: g.tl.session })).status).toBe(
      404,
    );
  });
});
