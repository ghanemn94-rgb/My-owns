// Conditional approval (T-DG5-BE-K; ADR-0044 §3, §9, §10; REQ-S04-011 "When enabled in Studio, an approver may approve
// with conditions; the platform allows only the permitted scope and tracks each condition to closure; overdue conditions
// escalate"; A08 "a conditional G5 approval limited to one region blocks a scale transition for another region; a
// conditional approval with no scope is rejected"; D-142 Q2) against a real PostgreSQL:
//  - v1 (the switch resolves on for G5): a conditional G5 limited to BU a1 blocks a scale transition for BU a2 (DG4,
//    re-run); a G5 approval with no scope -> 422 gate.scale_scope_required; nothing written;
//  - a published v2 that switches G5 off: conditions -> 422 gate.conditional_approval_disabled, nothing written; the same
//    approval without conditions -> 201; the resolved switch per gate (G5 on, G1-G4 and G6 off by default);
//  - tracking: the list shows each condition open / overdue / closed (status filter; AUD reads); the owner closes it
//    (201, one closure, one audit event, the owner's condition task done); another user -> 403 gate_condition.not_owner;
//    AUD 403; a second close -> 422 gate_condition.already_closed.
// The escalation job is tested in apps/worker/test/integration/gate-condition-escalation.test.ts.
// Every value is SYNTHETIC; every G5 decision is a demo business decision by a test person that approves nothing real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CONDITIONAL_APPROVAL_CATALOGUE_DEFAULT,
  conditionalApprovalEnabled,
} from "../../../src/modules/workflows/conditional-approval.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { g5Approval, pendingGate, seedGateWorld, stageGates, type GateWorld } from "../contract/p4-exercises-be-k.ts";
import { freshKey, pinFixture, seedPublishedVersion } from "../methodology/migration-fixtures.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const decisionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;
const conditionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("gate_decision_condition")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;

/** A G5-ready world: G1-G4 approved (audited fixtures), one pending G5 submission. Returns its number. */
async function g5Ready(g: GateWorld): Promise<number> {
  await stageGates(api, g, ["G1", "G2", "G3", "G4"], "transform");
  return pendingGate(api, g, "G5");
}

/** Pins the world's transformation to a published v2 whose G5 element sets the switch. */
async function pinSwitch(g: GateWorld, enabled: boolean): Promise<string> {
  const versionId = await seedPublishedVersion(api, "methodology", freshKey("methodology"), 2, [
    { elementType: "gate", stableKey: "G5", origin: "source", attributes: { conditionalApprovalEnabled: enabled } },
  ]);
  await pinFixture(api, {
    organizationId: g.b.organizationId,
    transformationId: g.b.transformationId,
    kind: "methodology",
    versionId,
    by: g.b.users.tl.id,
  });
  return versionId;
}

describe("v1: conditional G5 within its scope (REQ-S04-011 A08; DG4 behaviour re-run)", () => {
  it("a conditional G5 limited to one BU blocks a scale transition for another BU; no scope -> 422", async () => {
    const g = await seedGateWorld(api, w);
    const no = await g5Ready(g);
    const before = await decisionsOf(g);
    const noScope = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: { submissionNo: no, outcome: "approved", rationale: "Synthetic approval without a scope" },
    });
    expect([noScope.status, noScope.body.code]).toEqual([422, "gate.scale_scope_required"]);
    expect(await decisionsOf(g)).toBe(before);
    const ok = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const outside = await send("POST", `${g.b.base}/scale-transitions`, {
      session: g.b.s.tl,
      body: { initiativeId: g.initiativeId, businessUnitId: w.a2 },
    });
    expect([outside.status, outside.body.code]).toEqual([422, "scale.outside_approved_scope"]);
    expect(await conditionalApprovalEnabled(api.db, g.b.transformationId, "G5")).toBe(true);
  });
});

describe("the Studio switch (ADR-0044 §3; D-142 Q2)", () => {
  it("catalogue default: on for G5 only", async () => {
    expect([...CONDITIONAL_APPROVAL_CATALOGUE_DEFAULT.entries()].filter(([, v]) => v).map(([k]) => k)).toEqual(["G5"]);
    const g = await seedGateWorld(api, w);
    for (const code of ["G1", "G2", "G3", "G4", "G6"])
      expect(await conditionalApprovalEnabled(api.db, g.b.transformationId, code)).toBe(false);
  });

  it("switched off in a published v2: conditions -> 422 gate.conditional_approval_disabled, nothing written", async () => {
    const g = await seedGateWorld(api, w);
    await pinSwitch(g, false);
    expect(await conditionalApprovalEnabled(api.db, g.b.transformationId, "G5")).toBe(false);
    const no = await g5Ready(g);
    const [decisions, conditions] = [await decisionsOf(g), await conditionsOf(g)];
    const refused = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "gate.conditional_approval_disabled",
      "Conditional approval is not enabled for this gate in the published methodology.",
    ]);
    expect([await decisionsOf(g), await conditionsOf(g)]).toEqual([decisions, conditions]);
    // Without conditions the scoped approval is accepted (the scope is still required).
    const body = g5Approval(g, no);
    const plain = await send("POST", `${g.gates}/G5/decision`, {
      session: g.sp.session,
      body: { ...body, scaleScope: { items: body.scaleScope.items } },
    });
    expect(plain.status, JSON.stringify(plain.body)).toBe(201);
    expect(await conditionsOf(g)).toBe(conditions);
  });

  it("switched on explicitly in a v2: conditions are accepted", async () => {
    const g = await seedGateWorld(api, w);
    await pinSwitch(g, true);
    const no = await g5Ready(g);
    const ok = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body: g5Approval(g, no) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });
});

describe("tracked to closure (listGateConditions, closeGateCondition)", () => {
  it("open / overdue / closed; only the owner closes, once; AUD reads but cannot close", async () => {
    const g = await seedGateWorld(api, w);
    const no = await g5Ready(g);
    const body = g5Approval(g, no);
    body.scaleScope.conditions.push({
      text: "Synthetic: second condition owned by the lead",
      ownerUserId: g.b.users.tl.id,
      dueDate: "2026-01-31", // a past due date: overdue from the start (synthetic)
    });
    const decided = await send("POST", `${g.gates}/G5/decision`, { session: g.sp.session, body });
    expect(decided.status, JSON.stringify(decided.body)).toBe(201);
    const url = `${g.b.base}/gate-conditions`;
    const list = await send("GET", url, { session: g.b.s.auditor });
    expect(list.status, JSON.stringify(list.body)).toBe(200);
    expect(list.body.items.map((c: Body) => [c.gateCode, c.ordinal, c.status, c.dueDate])).toEqual([
      ["G5", 2, "overdue", "2026-01-31"],
      ["G5", 1, "open", "2026-12-31"],
    ]);
    const [second, first] = list.body.items;
    expect(first).toMatchObject({ ownerUserId: g.b.users.bo.id, closedAt: null, escalatedAt: null });

    // Overdue is derived from the transformation's business date; the status filter selects it.
    const overdue = await send("GET", `${url}?status=overdue`, { session: g.b.s.tl });
    expect(overdue.body.items.map((c: Body) => c.id)).toEqual([second.id]);

    const CLOSE = `${url}/${first.id}/close`;
    const note = { note: "Synthetic: churn reviewed weekly; minutes attached" };
    const notOwner = await send("POST", CLOSE, { session: g.b.s.tl, body: note });
    expect([notOwner.status, notOwner.body.code, notOwner.body.detail]).toEqual([
      403,
      "gate_condition.not_owner",
      "Only the condition's owner can close it.",
    ]);
    expect((await send("POST", CLOSE, { session: g.b.s.auditor, body: note })).status).toBe(403);
    expect((await send("POST", CLOSE, { session: g.b.s.bo, body: { note: "  " } })).status).toBe(400);
    const closed = await send("POST", CLOSE, { session: g.b.s.bo, body: note });
    expect(closed.status, JSON.stringify(closed.body)).toBe(201);
    expect(closed.headers.location).toBeDefined();
    expect(closed.body).toMatchObject({
      id: first.id,
      status: "closed",
      closedBy: g.b.users.bo.id,
      closureNote: note.note,
      evidenceId: null,
    });
    const closure = await api.db
      .selectFrom("gate_condition_closure")
      .select("id")
      .where("gate_decision_condition_id", "=", first.id)
      .execute();
    expect(closure).toHaveLength(1);
    expect((await auditOf(api.db, closure[0]!.id)).map((e) => e.action)).toEqual(["gate_condition_closure.create"]);
    const again = await send("POST", CLOSE, { session: g.b.s.bo, body: note });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "gate_condition.already_closed",
      "This condition is already closed.",
    ]);
    const openList = await send("GET", `${url}?status=open&limit=1`, { session: g.b.s.auditor });
    expect([openList.body.items.length, openList.body.nextCursor]).toEqual([0, null]);
    const closedList = await send("GET", `${url}?status=closed`, { session: g.b.s.auditor });
    expect(closedList.body.items.map((c: Body) => c.id)).toEqual([first.id]);
    expect((await send("GET", url, { session: g.b.s.outsider })).status).toBe(404);
    expect((await send("GET", `${url}?status=late`, { session: g.b.s.tl })).status).toBe(400);
  });
});
