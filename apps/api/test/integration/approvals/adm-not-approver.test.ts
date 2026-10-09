// REQ-S10-003 (ADR-0026 §8; T-DG4-BE-B): "Never make technical administrators business approvers automatically".
// Acceptance A12: an ADM-only user calling a gate or Finance approval endpoint gets 403. An ADM-only user holds every
// technical-administrator role (ADM_TECH, ADM_ACCESS, ADM_METHOD) in the organization and no business role. They get
// 403 on decideApproval (this task's endpoint). The product-gate decision (G1) and the Finance validation endpoint (not
// this task's files) refuse them with 404 today, because their read gate comes first: a divergence from the literal
// 403, pinned below and reported in the handback. Nothing is written in any case, and the role catalogue gives no
// technical-admin role a business_approval or finance_validation permission.
// Group membership grants nothing: an ADM-only member of the assignee group is refused as well. All data is SYNTHETIC;
// product gate G1 is a business approval inside the product, unrelated to the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { requestBody, setupApprovalWorld, type ApprovalWorld } from "./approval-world.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let adm: { id: string; session: Session };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
  const u = await createUser(api.db, w.orgA.id);
  for (const role of ["ADM_TECH", "ADM_ACCESS", "ADM_METHOD"])
    await grant(api.db, w.grantor.id, u.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
  adm = { id: u.id, session: await signIn(api.app, u.subject) };
}, 120_000);
afterAll(() => api.close());

const deniedOnly = async (res: { headers: Record<string, unknown> }) =>
  (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);

describe("REQ-S10-003: an ADM-only user is never a business approver", () => {
  it("no technical-admin role holds a business_approval or finance_validation permission (catalogue)", async () => {
    const rows = await api.db
      .selectFrom("role_permission as rp")
      .innerJoin("role as r", "r.id", "rp.role_id")
      .innerJoin("permission as pm", "pm.code", "rp.permission_code")
      .select(["r.code", "pm.code as permission"])
      .where("r.kind", "=", "technical_admin")
      .where("pm.category", "in", ["business_approval", "finance_validation"])
      .execute();
    expect(rows).toEqual([]);
  });

  it("decideApproval: 403, also as a member of the assignee group; nothing written", async () => {
    // A group with the ADM-only user and a real BO; the BO party is mapped to the group in a fresh transformation.
    const office = await signIn(api.app, w.office.subject);
    const g = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/groups`, {
      session: office,
      body: { code: uniq("G"), nameEn: "Synthetic owners", nameAr: "ملاك اصطناعيون", ownerUserId: w.office.id },
    });
    expect(g.status).toBe(201);
    for (const userId of [adm.id, p.bo2.id])
      expect(
        (await call(api.app, "POST", `/api/v1/groups/${g.body.id}/members`, { session: office, body: { userId } }))
          .status,
      ).toBe(201);
    const q = await setupApprovalWorld(api, w);
    const list = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${q.transformationId}/role-mappings?status=active`,
      {
        session: q.lead.session,
      },
    );
    const bo = list.body.items.find((m: Body) => m.partyCode === "BO");
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings/${bo.id}/end`, {
      session: q.lead.session,
      headers: ifm(bo.version),
      body: { reason: "Synthetic: route to the group" },
    });
    await grant(api.db, w.grantor.id, p.bo2.id, "BO", { type: "transformation", id: q.transformationId }, w.orgA.id);
    expect(
      (
        await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
          session: q.lead.session,
          body: { partyCode: "BO", targetKind: "group", groupId: g.body.id },
        })
      ).status,
    ).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    expect([req.status, req.body.assignee.groupId]).toEqual([201, g.body.id]);
    // Only the group's approver member got a task; the ADM-only member got none.
    const tasks = await api.db
      .selectFrom("work_item")
      .select("assignee_user_id")
      .where("subject_id", "=", req.body.id)
      .execute();
    expect(tasks.map((t) => t.assignee_user_id)).toEqual([p.bo2.id]);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: adm.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect(await deniedOnly(res)).toEqual(["authorization.denied"]);
    // Only a technical-admin-only caller gets that 403: a business user of the organization who cannot read the
    // transformation (TL at its business unit, without inheritance) still gets 404 (existence not disclosed).
    const leadA1 = await signIn(api.app, w.leadA1.subject);
    const hidden = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: leadA1,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect(hidden.status).toBe(404);
    // The group's BO member decides (a member of the assignee group acts as the group).
    const ok = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic: decided for the group", subjectVersion: 1 },
    });
    expect([ok.status, ok.body.decidedBy]).toEqual([200, p.bo2.id]);
  });

  it("the product-gate decision (G1) and a Finance validation endpoint refuse the ADM-only user; nothing written", async () => {
    const gate = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/gates/G1/decision`, {
      session: adm.session,
      body: { submissionNo: 1, outcome: "approved", rationale: "Synthetic" },
    });
    const baseline = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/baselines`, {
      session: p.lead.session,
      body: {
        metric: "Synthetic cost",
        unit: "SAR",
        scope: "cost",
        value: "10",
        source: "Synthetic",
        baselineDate: "2026-06-30",
      },
    });
    expect(baseline.status, JSON.stringify(baseline.body)).toBe(201);
    const fin = await call<Body>(
      api.app,
      "POST",
      `/api/v1/transformations/${p.transformationId}/baselines/${baseline.body.id}/validation`,
      {
        session: adm.session,
        headers: ifm(1),
        body: { result: "validated", note: "Synthetic" },
      },
    );
    // DIVERGENCE (reported in the T-DG4-BE-B handback, "contract needs"): these two endpoints are not BE-B's files
    // (workflows/gates.ts, kpi/baselines). An ADM-only user holds no transformation.read, so their DG1-approved read
    // gate answers 404 (existence not disclosed) before the approval check, not the literal 403 of the acceptance.
    // The refusal itself holds: nothing is decided or validated, and nothing but a denial is written.
    expect([gate.status, fin.status]).toEqual([404, 404]);
    for (const res of [gate, fin])
      expect((await deniedOnly(res)).filter((a) => a !== "authorization.denied")).toEqual([]);
    const decisions = await api.db
      .selectFrom("gate_decision")
      .select("id")
      .where("transformation_id", "=", p.transformationId)
      .execute();
    expect(decisions).toEqual([]);
    const b = await api.db
      .selectFrom("baseline")
      .selectAll()
      .where("id", "=", baseline.body.id)
      .executeTakeFirstOrThrow();
    expect(b.version).toBe(1);
  });
});
