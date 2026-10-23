// F-DG5-121 (domain DG5 round 1; reproduction docs/delivery/test-evidence/DG5/domain/round-1/probe/
// zz-dom-r1-day90.spec.ts): REQ-PB-087, M0261, B0135-B0141. The Day-90 leadership test is part of the 90-day launch
// plan: plan.ts creates one with every plan, and the demo dataset's roaming plan carries its own. The REAL synthetic
// demo dataset (`seedDemo`, International Roaming) is seeded into a scratch database of this run's disposable cluster,
// the REAL API runs on it (MTH_ENV=demo), and the demo TL reads the roaming plan and its Day-90 test
// (getLaunchPlan, getDayNinetyTest: the operations the web launch-plan and Day-90 pages call). Control: a NEW
// transformation of the demo business unit gets its plan from the same start date through POST .../launch-plan (the
// product path, generateLaunchPlanInTx), and the two Day-90 tests must agree on everything but their ids.
// Everything is SYNTHETIC; a Day-90 answer is a leader's assessment, not a G1-G6 business approval, and nothing here
// names the engineering gates DG0-DG7.
import { migrate, seedDemo } from "@mth/db";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { DEMO_ANCHORS } from "../../../../../packages/db/src/demo/data/kpis.ts";
import { DEMO_USERS } from "../../../../../packages/db/src/demo/data/roaming.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../../packages/db/test/helpers.ts";
import { call, signIn, startApi, type Session, type TestApi } from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const T = DEMO_ANCHORS.transformationId;
const BU = DEMO_ANCHORS.businessUnitId;
/** The roaming plan's start date: 60 days before the synthetic clock 2026-09-01 (roaming-states.ts). */
const START = "2026-07-03";
/** Day 90 of that plan: START + 90 calendar days (plan.ts DAY_NINETY, D-142 Q6). */
const DAY_90 = "2026-10-01";
/** B0136-B0141, verbatim (the 0086 catalogue), written out here rather than read from the dataset under test. */
const QUESTIONS = [
  ["q1", "Can leaders explain the same case for change and North Star?", "B0136"],
  ["q2", "Can every initiative be traced to a target-state gap and outcome?", "B0137"],
  ["q3", "Are executive decision rights clear?", "B0138"],
  ["q4", "Is Finance aligned on baselines and benefit formulas?", "B0139"],
  ["q5", "Are Wave 1 initiatives producing evidence rather than only plans?", "B0140"],
  ["q6", "Can the transformation team show what it needs from executives this month?", "B0141"],
] as const;

let api: TestApi;
let scratch: string | null = null;
const s: Record<string, Session> = {};
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const user = (role: string) => DEMO_USERS.find((u) => u.role === role)!;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratch = await createScratchDatabase(adminUrl, "mth_demo_day_ninety");
  await migrate(roleUrl(adminUrl, scratch, "mth_owner"));
  await seedDemo(roleUrl(adminUrl, scratch, "mth_owner"), {
    mthEnv: "demo",
    runKind: "seed",
    requestedVia: "cli",
    requestedBy: null,
    devIssuerBinding: true,
  });
  api = await startApi({ database: scratch, env: { MTH_ENV: "demo" } });
  for (const role of ["TL", "WL", "SP"]) s[role] = await signIn(api.app, user(role).name);
}, 240_000);

afterAll(async () => {
  await api?.close();
  if (scratch) await dropScratchDatabase(inject("mthDb").adminUrl, scratch);
}, 60_000);

describe("F-DG5-121: the demo roaming launch plan carries its Day-90 leadership test (REQ-PB-087)", () => {
  it("the reviewer's reproduction: the roaming plan exists (33 tasks from 2026-07-03) and GET day-90-test is 200", async () => {
    const plan = await send("GET", `/api/v1/transformations/${T}/launch-plan`, { session: s["TL"]! });
    expect(plan.status, JSON.stringify(plan.body)).toBe(200);
    expect([plan.body.startDate, plan.body.taskCount]).toEqual([START, 33]);
    const test = await send("GET", `/api/v1/transformations/${T}/day-90-test`, { session: s["TL"]! });
    expect(test.status, JSON.stringify(test.body)).toBe(200);
  });

  it("it is the plan's test: scheduled on day 90, open, Incomplete (0/6), the six B0136-B0141 questions verbatim", async () => {
    const plan = (await send("GET", `/api/v1/transformations/${T}/launch-plan`, { session: s["TL"]! })).body;
    const test = (await send("GET", `/api/v1/transformations/${T}/day-90-test`, { session: s["TL"]! })).body;
    expect(test.planId).toBe(plan.id);
    expect([test.scheduledDate, test.status, test.completedAt, test.completedBy]).toEqual([DAY_90, "open", null, null]);
    expect(test.completion).toEqual({ answered: 0, total: 6, complete: false });
    expect(test.questions.map((q: Body) => [q.code, q.textEn, q.sourceRef])).toEqual(QUESTIONS);
    for (const q of test.questions) {
      expect(q.textAr, q.code).toMatch(/[؀-ۿ]/);
      expect(q.response, q.code).toBeNull();
    }
  });

  it("control: it agrees with the test the product path creates for a plan from the same start date, ids aside", async () => {
    const t = await send("POST", "/api/v1/transformations", {
      session: s["TL"]!,
      body: { businessUnitId: BU, name: "Synthetic F-DG5-121 control launch", mode: "end_to_end" },
    });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const gen = await send("POST", `/api/v1/transformations/${t.body.id}/launch-plan`, {
      session: s["TL"]!,
      body: { startDate: START },
    });
    expect(gen.status, JSON.stringify(gen.body)).toBe(201);
    const shape = (b: Body) => ({
      scheduledDate: b.scheduledDate,
      status: b.status,
      completion: b.completion,
      questions: b.questions.map((q: Body) => [q.code, q.ordinal, q.textEn, q.textAr, q.sourceRef, q.response]),
      completedAt: b.completedAt,
      completedBy: b.completedBy,
      version: b.version,
    });
    const product = await send("GET", `/api/v1/transformations/${t.body.id}/day-90-test`, { session: s["TL"]! });
    const demo = await send("GET", `/api/v1/transformations/${T}/day-90-test`, { session: s["TL"]! });
    expect(product.status).toBe(200);
    expect(shape(demo.body)).toEqual(shape(product.body));
  });

  it("the demo leaders can run it: the TL records a response (If-Match); the WL (no respond right) gets 403", async () => {
    const before = (await send("GET", `/api/v1/transformations/${T}/day-90-test`, { session: s["TL"]! })).body;
    const url = `/api/v1/transformations/${T}/day-90-test/responses/q1`;
    const refused = await send("PUT", url, {
      session: s["WL"]!,
      headers: { "if-match": `"${before.version}"` },
      body: { answer: "yes" },
    });
    expect(refused.status, JSON.stringify(refused.body)).toBe(403);
    const ok = await send("PUT", url, {
      session: s["TL"]!,
      headers: { "if-match": `"${before.version}"` },
      body: { answer: "yes", comment: "Synthetic demo response (illustrative)." },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const after = (await send("GET", `/api/v1/transformations/${T}/day-90-test`, { session: s["TL"]! })).body;
    expect(after.completion).toEqual({ answered: 1, total: 6, complete: false });
    expect(after.questions[0].response.respondedBy).toBe(user("TL").id);
  });
});
