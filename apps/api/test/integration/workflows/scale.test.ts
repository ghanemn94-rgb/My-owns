// Scale transitions inside the approved G5 scope (T-DG4-BE-K; ADR-0035 §5, §11; REQ-S03-004, REQ-S04-007) against a
// real PostgreSQL: before an approved G5 a scale transition is 422 invalid-transition naming G5; after the G5 approval
// inside the approved scope 201 (one audit event); outside the scope 422 scale.outside_approved_scope; a repeat 409
// scale.already_scaled; AUD and ADM-only 403 (nothing written); the read model before and after G5. The G5 decision
// here is a synthetic in-product business approval by a test Sponsor; it approves nothing real and touches no DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates, type GateWorld } from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const transitionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("scale_transition")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;

describe("scale transitions (REQ-S03-004, REQ-S04-007)", () => {
  it("before G5: 422 invalid-transition naming G5; the scope reads approved = false; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    const scope = await send("GET", `${g.b.base}/scale-scope`, { session: g.b.s.auditor });
    expect(scope.body).toEqual({ approved: false, gateDecisionId: null, decidedAt: null, items: [], conditions: [] });
    const r = await send("POST", `${g.b.base}/scale-transitions`, {
      session: g.b.s.tl,
      body: { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId },
    });
    expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "gate.g5_not_approved",
      "Scaling requires the G5 (Scale) business approval, which is not approved for this transformation.",
    ]);
    expect(r.body.detail).toContain("G5");
    // A rejected G5 is not an approval either.
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    const rejected = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: { submissionNo: no, outcome: "rejected", rationale: "Synthetic: pilots not yet conclusive." },
    });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    const again = await send("POST", `${g.b.base}/scale-transitions`, {
      session: g.b.s.tl,
      body: { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId },
    });
    expect([again.status, again.body.code]).toEqual([422, "gate.g5_not_approved"]);
    expect(await transitionsOf(g)).toBe(0);
  });

  it("after the G5 approval: inside the scope 201 with its audit event; outside 422; a repeat 409; AUD/ADM 403", async () => {
    const g = await seedGateWorld(api, w);
    await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
    const no = await pendingGate(api, g, "G5");
    const d = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const body = { initiativeId: g.initiativeId, businessUnitId: g.businessUnitId, note: "Synthetic wave 1" };
    for (const session of [g.b.s.auditor, g.b.s.admin, g.b.s.bo]) {
      const denied = await send("POST", `${g.b.base}/scale-transitions`, { session, body });
      expect(denied.status, JSON.stringify(denied.body)).toBe(403);
    }
    expect(await transitionsOf(g)).toBe(0);
    const ok = await send("POST", `${g.b.base}/scale-transitions`, { session: g.b.s.tl, body });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toEqual({
      id: expect.any(String),
      transformationId: g.b.transformationId,
      initiativeId: g.initiativeId,
      businessUnitId: g.businessUnitId,
      gateDecisionId: d.body.id,
      note: "Synthetic wave 1",
      transitionedBy: g.b.users.tl.id,
      transitionedAt: expect.any(String),
    });
    expect(ok.headers.location).toBe(`${g.b.base}/scale-transitions/${ok.body.id}`);
    const audit = await auditOf(api.db, ok.body.id);
    expect(audit.map((e) => [e.action, e.actor_user_id])).toEqual([["scale_transition.create", g.b.users.tl.id]]);
    const dup = await send("POST", `${g.b.base}/scale-transitions`, { session: g.b.s.tl, body });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "scale.already_scaled",
      "This initiative is already scaled into this business unit.",
    ]);
    const otherBu = await send("POST", `${g.b.base}/scale-transitions`, {
      session: g.b.s.tl,
      body: { initiativeId: g.initiativeId, businessUnitId: w.a2 },
    });
    expect([otherBu.status, otherBu.body.type, otherBu.body.code, otherBu.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "scale.outside_approved_scope",
      "This initiative and business unit are outside the scale scope approved at G5.",
    ]);
    const list = await send("GET", `${g.b.base}/scale-transitions`, { session: g.b.s.auditor });
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([ok.body.id]);
    expect(await transitionsOf(g)).toBe(1);
  });
});
