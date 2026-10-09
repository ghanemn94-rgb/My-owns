// Risk dispositions (T-DG4-BE-K; ADR-0035 §6, §8, §11; REQ-PB-020, REQ-S04-007) against a real PostgreSQL: an open risk
// only (closed risk and non-risk entries 422 risk_disposition.not_open_risk); the creation writes the immutable row, its
// audit event and ONE canonical approval of type risk_disposition (pending, subject version 1) routed to the party SP,
// or to the T11 "Go-live / scale" party BO when G5 is configured to BO (unmapped -> 422 routing.role_unmapped, nothing
// written); the proposer cannot decide it (separation of duties); AUD 403. Synthetic data; the approval here is a demo
// business decision by a test person and approves nothing real; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { highRisk, seedGateWorld, type GateWorld } from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());

const body = (g: GateWorld, raidEntryId: string, extra: Record<string, unknown> = {}) => ({
  raidEntryId,
  disposition: "transfer",
  rationale: "Synthetic: transferred to the vendor under the managed-service contract.",
  residualOwnerUserId: g.b.users.bo.id,
  ...extra,
});
const dispositionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("risk_disposition")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;

describe("risk dispositions (REQ-PB-020)", () => {
  it("creates the row, its audit event and one pending risk_disposition approval routed to SP", async () => {
    const g = await seedGateWorld(api, w);
    const risk = await highRisk(send, g);
    const r = await send("POST", `${g.b.base}/risk-dispositions`, { session: g.b.s.tl, body: body(g, risk.id) });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toEqual({
      id: expect.any(String),
      transformationId: g.b.transformationId,
      raidEntryId: risk.id,
      disposition: "transfer",
      rationale: "Synthetic: transferred to the vendor under the managed-service contract.",
      residualOwnerUserId: g.b.users.bo.id,
      approvalId: expect.any(String),
      approvalStatus: "pending",
      version: 1,
      createdAt: expect.any(String),
      createdBy: g.b.users.tl.id,
    });
    expect([r.headers.etag, r.headers.location]).toEqual(['"1"', `${g.b.base}/risk-dispositions/${r.body.id}`]);
    expect((await auditOf(api.db, r.body.id)).map((e) => e.action)).toEqual(["risk_disposition.create"]);
    const approval = await api.db
      .selectFrom("approval")
      .selectAll()
      .where("id", "=", r.body.approvalId)
      .executeTakeFirstOrThrow();
    expect([
      approval.approval_type,
      approval.subject_type,
      approval.subject_id,
      approval.subject_version,
      approval.status,
      approval.assignee_party_code,
      approval.assignee_user_id,
      approval.requested_by,
    ]).toEqual(["risk_disposition", "risk_disposition", r.body.id, 1, "pending", "SP", g.sp.id, g.b.users.tl.id]);
    // The proposer cannot decide their own disposition (requester_excluded SoD; TL holds no approval.decide either).
    const self = await send("POST", `/api/v1/approvals/${r.body.approvalId}/decisions`, {
      session: g.b.s.tl,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic self-approval attempt", subjectVersion: 1 },
    });
    expect(self.status).toBe(403);
    const list = await send("GET", `${g.b.base}/risk-dispositions?raidEntryId=${risk.id}`, { session: g.b.s.auditor });
    expect(list.body.items.map((i: { id: string }) => i.id)).toEqual([r.body.id]);
  });

  it("only an open risk: a closed risk or an issue is 422 risk_disposition.not_open_risk; AUD 403; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    const risk = await highRisk(send, g);
    const closed = await send("POST", `${g.b.base}/raid/${risk.id}/close`, {
      session: g.b.s.tl,
      headers: ifm(risk.version),
      body: { closureNote: "Synthetic: supplier qualified" },
    });
    expect(closed.status, JSON.stringify(closed.body)).toBe(200);
    const onClosed = await send("POST", `${g.b.base}/risk-dispositions`, { session: g.b.s.tl, body: body(g, risk.id) });
    expect([onClosed.status, onClosed.body.code, onClosed.body.detail, onClosed.body.errors[0].pointer]).toEqual([
      422,
      "risk_disposition.not_open_risk",
      "Only an open risk can be given a disposition.",
      "/raidEntryId",
    ]);
    const issue = await send("POST", `${g.b.base}/raid`, {
      session: g.b.s.tl,
      body: { type: "issue", description: "Synthetic billing defect", impact: "high", ownerUserId: g.wl.id },
    });
    expect(issue.status, JSON.stringify(issue.body)).toBe(201);
    const onIssue = await send("POST", `${g.b.base}/risk-dispositions`, {
      session: g.b.s.tl,
      body: body(g, issue.body.id),
    });
    expect([onIssue.status, onIssue.body.code]).toEqual([422, "risk_disposition.not_open_risk"]);
    const open = await highRisk(send, g);
    for (const session of [g.b.s.auditor, g.b.s.fin]) {
      const denied = await send("POST", `${g.b.base}/risk-dispositions`, { session, body: body(g, open.id) });
      expect(denied.status).toBe(403);
    }
    expect(await dispositionsOf(g)).toBe(0);
  });

  it("G5 configured to BO: routed to the T11 Go-live / scale party BO; unmapped BO -> 422 routing.role_unmapped, nothing written", async () => {
    const g = await seedGateWorld(api, w);
    const v = (
      await api.db
        .selectFrom("gate_instance")
        .select("version")
        .where("transformation_id", "=", g.b.transformationId)
        .where("gate_code", "=", "G5")
        .executeTakeFirstOrThrow()
    ).version;
    const cfg = await send("PATCH", `${g.gates}/G5`, {
      session: g.s.to.session,
      headers: ifm(v),
      body: { approverRoleCode: "BO" },
    });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
    const risk = await highRisk(send, g);
    const unmapped = await send("POST", `${g.b.base}/risk-dispositions`, { session: g.b.s.tl, body: body(g, risk.id) });
    expect([unmapped.status, unmapped.body.code]).toEqual([422, "routing.role_unmapped"]);
    expect(await dispositionsOf(g)).toBe(0);
    const mapped = await send("POST", `${g.b.base}/role-mappings`, {
      session: g.b.s.tl,
      body: { partyCode: "BO", targetKind: "user", userId: g.b.users.bo2.id },
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
    const ok = await send("POST", `${g.b.base}/risk-dispositions`, { session: g.b.s.tl, body: body(g, risk.id) });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const approval = await api.db
      .selectFrom("approval")
      .select(["assignee_party_code", "assignee_user_id"])
      .where("id", "=", ok.body.approvalId)
      .executeTakeFirstOrThrow();
    expect(approval).toEqual({ assignee_party_code: "BO", assignee_user_id: g.b.users.bo2.id });
  });
});
