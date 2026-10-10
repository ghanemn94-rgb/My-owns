// The T-DG4-BE-R4 A/B byte-stability transcript (the BE-M2 method, `response-transcript.ts`). It drives the EXISTING
// operations of every module this task touched (schedule-network.ts, scale.ts, assessments.ts, minutes.ts, gates.ts
// through the gate list, and the shared problem renderer) and asserts only what holds before and after the change.
// When MTH_BE_R4_TRANSCRIPT names a file, every response is recorded (status, ETag, Location, body without requestId;
// ids, instants and hashes normalized) for a `cmp` against a run on the base commit's source. Unset, it is an ordinary
// regression test that records nothing. The only expected difference is the `forumAr` member of the minutes task's
// messageParams (ADR-0032 amendment G3). The new reads are not called here: they had no route on the base.
// All data is SYNTHETIC. The G5 decision is a synthetic in-product business approval by a test Sponsor; it approves
// nothing real, and nothing here touches the engineering delivery gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { responseTranscript } from "../../support/response-transcript.ts";
import { seedBenefitWorld } from "../benefits/fixtures.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates } from "../contract/p4-exercises-be-k.ts";
import { businessToday, plusDays, setupMeetingWorld } from "../governance/meeting-fixtures.ts";
import { insertInitiative, newDependency, seedExecutionWorld } from "../portfolio/execution-fixtures.ts";

let api: TestApi;
let w: World;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const t = responseTranscript(call, "MTH_BE_R4_TRANSCRIPT");
afterAll(() => t.flush());
const r = t.call;

describe("A/B transcript (T-DG4-BE-R4): existing responses of the touched modules", () => {
  it("schedule durations and the network (portfolio/schedule-network.ts), with 400/401/403/404/409/428 problems", async () => {
    const x = await seedExecutionWorld(api, w);
    const a = await insertInitiative(api.db, x, "INI-01");
    const b = await insertInitiative(api.db, x, "INI-02");
    await newDependency((m, u, o) => call(api.app, m, u, o), x, a, b);
    const N = `/api/v1/transformations/${x.transformationId}/schedule-network`;
    const S = `/api/v1/initiatives/${a}/schedule`;
    expect((await r(api.app, "GET", N, { session: x.s.auditor })).status).toBe(200);
    expect((await r(api.app, "GET", N, { session: x.s.admin })).status).toBe(404);
    expect((await r(api.app, "GET", N)).status).toBe(401);
    expect((await r(api.app, "POST", S, { session: x.s.tl, body: { durationWorkingDays: 5 } })).status).toBe(201);
    expect((await r(api.app, "POST", S, { session: x.s.tl, body: { durationWorkingDays: 6 } })).status).toBe(409);
    expect((await r(api.app, "POST", S, { session: x.s.tl, body: { durationWorkingDays: -1 } })).status).toBe(400);
    expect((await r(api.app, "POST", S, { session: x.s.auditor, body: { durationWorkingDays: 1 } })).status).toBe(403);
    expect((await r(api.app, "PATCH", S, { session: x.s.tl, body: { durationWorkingDays: 4 } })).status).toBe(428);
    expect(
      (await r(api.app, "PATCH", S, { session: x.s.tl, headers: ifm(7), body: { durationWorkingDays: 4 } })).status,
    ).toBe(409);
    const B = `/api/v1/initiatives/${b}/schedule`;
    expect(
      (await r(api.app, "PATCH", B, { session: x.s.tl, headers: ifm(1), body: { durationWorkingDays: 4 } })).status,
    ).toBe(404);
    expect(
      (await r(api.app, "PATCH", S, { session: x.s.wl, headers: ifm(1), body: { durationWorkingDays: 4 } })).status,
    ).toBe(200);
    expect((await r(api.app, "POST", B, { session: x.s.to, body: { durationWorkingDays: 2 } })).status).toBe(201);
    expect((await r(api.app, "GET", N, { session: x.s.tl })).status).toBe(200);
    expect((await r(api.app, "GET", `/api/v1/initiatives/${a}/execution`, { session: x.s.auditor })).status).toBe(200);
  });

  it("scale scope, transitions and the gate list (workflows/scale.ts, gates.ts)", async () => {
    const g = await seedGateWorld(api, w);
    const { b } = g;
    const item = { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId };
    expect((await r(api.app, "GET", `${b.base}/scale-scope`, { session: b.s.auditor })).status).toBe(200);
    expect((await r(api.app, "POST", `${b.base}/scale-transitions`, { session: b.s.tl, body: item })).status).toBe(422);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    expect(
      (await r(api.app, "POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) })).status,
    ).toBe(201);
    expect((await r(api.app, "GET", `${b.base}/scale-scope`, { session: b.s.auditor })).status).toBe(200);
    expect((await r(api.app, "POST", `${b.base}/scale-transitions`, { session: b.s.tl, body: item })).status).toBe(201);
    expect((await r(api.app, "POST", `${b.base}/scale-transitions`, { session: b.s.tl, body: item })).status).toBe(409);
    expect(
      (
        await r(api.app, "POST", `${b.base}/scale-transitions`, {
          session: b.s.tl,
          body: { initiativeId: g.initiativeId, businessUnitId: w.a2 },
        })
      ).status,
    ).toBe(422);
    expect((await r(api.app, "GET", `${b.base}/scale-transitions`, { session: b.s.auditor })).status).toBe(200);
    expect((await r(api.app, "GET", `${b.base}/scale-scope`, { session: b.s.admin })).status).toBe(404);
    expect((await r(api.app, "GET", g.gates, { session: b.s.auditor })).status).toBe(200);
    expect((await r(api.app, "GET", `${g.gates}/G5`, { session: b.s.auditor })).status).toBe(200);
  });

  it("assessment forms (adoption/assessments.ts): create, read, list, new question version, refusals", async () => {
    const b = await seedBenefitWorld(api, w);
    const AF = `${b.base}/assessment-forms`;
    const schema = {
      questions: [
        { key: "clarity", type: "scale", label_en: "Clarity", label_ar: "الوضوح", required: true, min: 1, max: 5 },
      ],
    };
    const bad = await r(api.app, "POST", AF, {
      session: b.s.bo,
      body: { kind: "feedback", name: "Synthetic", schema: { questions: [{ ...schema.questions[0], x: 1 }] } },
    });
    expect(bad.status).toBe(400);
    const f = await r(api.app, "POST", AF, { session: b.s.bo, body: { kind: "feedback", name: "Synthetic", schema } });
    expect(f.status).toBe(201);
    const F = `${AF}/${f.body.id}`;
    expect((await r(api.app, "GET", F, { session: b.s.auditor })).status).toBe(200);
    expect((await r(api.app, "GET", AF, { session: b.s.auditor })).status).toBe(200);
    const pub = await r(api.app, "POST", `${F}/publish`, { session: b.s.bo, headers: ifm(f.body.version) });
    expect(pub.status).toBe(200);
    const v2 = await r(api.app, "PATCH", F, {
      session: b.s.bo,
      headers: ifm(pub.body.version),
      body: { schema: { questions: [{ ...schema.questions[0], label_en: "Clarity of the guide" }] } },
    });
    expect(v2.status).toBe(200);
    expect((await r(api.app, "PATCH", F, { session: b.s.bo, headers: ifm(1), body: { name: "X" } })).status).toBe(409);
    expect((await r(api.app, "GET", F, { session: b.s.admin })).status).toBe(404);
    expect(
      (await r(api.app, "POST", AF, { session: b.s.auditor, body: { kind: "feedback", name: "S", schema } })).status,
    ).toBe(403);
  });

  it("the chair's minutes task (governance/minutes.ts) as My Work lists it", async () => {
    const x = await setupMeetingWorld(api, w);
    const today = await businessToday(api);
    const T = `/api/v1/transformations/${x.transformationId}`;
    const c = await call(api.app, "POST", `${T}/meetings`, {
      session: x.lead.session,
      body: {
        forumId: x.forums.transformation_review,
        scheduledDate: plusDays(today, 7),
        startTime: "11:00",
        durationMinutes: 60,
        chairUserId: x.lead.id,
      },
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const url = `${T}/meetings/${c.body.id}`;
    const v = (await call(api.app, "POST", `${url}/start`, { session: x.lead.session, headers: ifm(1) })).body.version;
    expect((await call(api.app, "POST", `${url}/close`, { session: x.lead.session, headers: ifm(v) })).status).toBe(
      200,
    );
    const d = await r(api.app, "POST", `${url}/minutes`, { session: x.office.session, body: { body: "Synthetic" } });
    expect(d.status).toBe(201);
    const mine = await r(api.app, "GET", "/api/v1/me/work-items?kind=minutes_to_approve&status=open", {
      session: x.lead.session,
    });
    expect(mine.status).toBe(200);
    expect((await r(api.app, "POST", `${url}/minutes/approve`, { session: x.lead.session })).status).toBe(428);
  });
});
