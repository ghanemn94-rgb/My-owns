// code-security-reviewer DG4 round-1 probe A (T-DG4-REV-SEC-R1). NOT product code; runs only in a disposable clone,
// copied to apps/api/test/integration/zz-sec-dg4/ (it imports the implementers' approval-world fixture read-only).
// All data is synthetic. Business approvals here are synthetic product records, never a real approval, and never
// related to the engineering gates DG0-DG7.
//   A1 SoD through a group: the BO party is mapped to a group that contains the requester; the requester's own decision
//      is 403 approval.sod_requester, the other member's is 200.
//   A2 SoD through delegation: the assignee delegated to the (later) requester BEFORE the request; the requester
//      deciding on behalf of the assignee is 403 approval.sod_requester; nothing written.
//   A3 race: two concurrent approvals of the same approval at If-Match 1: exactly one 200, one decision row.
//   A4 race: an approval and the requester's withdrawal at the same time: exactly one wins, and the end state is
//      consistent (approved with one decision, or withdrawn with none).
//   A5 delegation loop of three (A->B, B->C, then C->A) is 422 delegation.loop; a concurrent A<->B pair: one 201.
//   A6 stale: the subject moves to version 2; deciding at subjectVersion 1 is 409 approval.stale_version.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOfRequest, call, seedWorld, signIn, startApi, uniq, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  editDecision,
  newDecision,
  person,
  requestBody,
  setupApprovalWorld,
  type ApprovalWorld,
} from "../approvals/approval-world.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
let api: TestApi;
let w: World;
let p: ApprovalWorld;
const send = (m: string, u: string, o = {}) => call(api.app, m, u, o);
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
}, 180_000);
afterAll(() => api.close());

const REQ = () => `/api/v1/transformations/${p.transformationId}/approvals`;
const decideBody = (extra: Record<string, unknown> = {}) => ({
  outcome: "approve",
  rationale: "Synthetic rationale (SEC probe)",
  subjectVersion: 1,
  ...extra,
});
async function decisionRows(approvalId: string) {
  return api.db.selectFrom("approval_decision").select(["id", "decided_by"]).where("approval_id", "=", approvalId).execute();
}
async function request(session = p.bo2.session, rightKey = "target_state_design") {
  const decisionId = await newDecision(send, p);
  const res = await call<Body>(api.app, "POST", REQ(), { session, body: requestBody(decisionId, p.rights[rightKey]!) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { approval: res.body, decisionId };
}

describe("SEC-DG4-R1 probe A: approval separation of duties and races", () => {
  it("A2 SoD through delegation: the requester cannot decide on behalf of the assignee who delegated to them", async () => {
    const d = await call<Body>(api.app, "POST", "/api/v1/delegations", {
      session: p.bo.session,
      body: { delegateUserId: p.bo2.id, reasonCode: "absence", absenceNote: "Synthetic leave", effectiveFrom: hours(-1), effectiveTo: hours(48) },
    });
    console.log(`[probe-A] A2 delegation bo->bo2 ${d.status} ${d.body.code ?? ""}`);
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const { approval } = await request(p.bo2.session);
    console.log(`[probe-A] A2 approval assignee ${approval.assignee.userId} (bo ${p.bo.id}), requester ${approval.requestedBy} (bo2 ${p.bo2.id})`);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: decideBody({ onBehalfOfUserId: p.bo.id }),
    });
    const audit = (await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action);
    console.log(`[probe-A] A2 requester decides on behalf of assignee -> ${res.status} ${res.body.code} audit=${JSON.stringify(audit)}`);
    expect([res.status, res.body.code]).toEqual([403, "approval.sod_requester"]);
    expect(await decisionRows(approval.id)).toEqual([]);
    const direct = await call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: decideBody(),
    });
    console.log(`[probe-A] A2 requester decides directly -> ${direct.status} ${direct.body.code}`);
    expect(direct.status).toBe(403);
    await call(api.app, "POST", `/api/v1/delegations/${d.body.id}/revoke`, { session: p.bo.session, headers: ifm(1), body: { reason: "Synthetic end" } });
  });

  it("A1 SoD through a group: the requester in the assignee group gets 403 approval.sod_requester; the other member decides", async () => {
    const office = await signIn(api.app, w.office.subject);
    const g = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/groups`, {
      session: office,
      body: { code: uniq("G"), nameEn: "Synthetic owners", nameAr: "ملاك اصطناعيون", ownerUserId: w.office.id },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    for (const userId of [p.bo.id, p.bo2.id])
      expect((await call(api.app, "POST", `/api/v1/groups/${g.body.id}/members`, { session: office, body: { userId } })).status).toBe(201);
    const list = await call<Body>(api.app, "GET", `/api/v1/transformations/${p.transformationId}/role-mappings?status=active`, { session: p.lead.session });
    const bo = list.body.items.find((m: Body) => m.partyCode === "BO");
    const ended = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/role-mappings/${bo.id}/end`, {
      session: p.lead.session,
      headers: ifm(bo.version),
      body: { reason: "Synthetic: route to the group" },
    });
    expect(ended.status, JSON.stringify(ended.body)).toBe(200);
    const mapped = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/role-mappings`, {
      session: p.lead.session,
      body: { partyCode: "BO", targetKind: "group", groupId: g.body.id },
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
    const { approval } = await request(p.bo2.session);
    expect(approval.assignee.groupId).toBe(g.body.id);
    const own = await call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, { session: p.bo2.session, headers: ifm(1), body: decideBody() });
    const audit = (await auditOfRequest(api.db, String(own.headers["x-request-id"]))).map((e) => e.action);
    console.log(`[probe-A] A1 requester (group member) decides -> ${own.status} ${own.body.code} audit=${JSON.stringify(audit)}`);
    expect([own.status, own.body.code]).toEqual([403, "approval.sod_requester"]);
    expect(await decisionRows(approval.id)).toEqual([]);
    const other = await call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, { session: p.bo.session, headers: ifm(1), body: decideBody() });
    console.log(`[probe-A] A1 other member decides -> ${other.status} ${other.body.status ?? other.body.code}`);
    expect([other.status, other.body.status]).toEqual([200, "approved"]);
  });

  it("A3 two concurrent approvals at If-Match 1: exactly one 200 and one decision row", async () => {
    const { approval } = await request(p.bo2.session);
    const both = await Promise.all([0, 1].map(() =>
      call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, { session: p.bo.session, headers: ifm(1), body: decideBody() }),
    ));
    const statuses = both.map((r) => r.status).sort();
    console.log(`[probe-A] A3 concurrent approve -> ${JSON.stringify(both.map((r) => [r.status, r.body.code ?? r.body.status]))}; decision rows ${(await decisionRows(approval.id)).length}`);
    expect(statuses[0]).toBe(200);
    expect(statuses[1]).toBeGreaterThanOrEqual(409);
    expect((await decisionRows(approval.id)).length).toBe(1);
  });

  it("A4 approve and withdraw at the same time: one wins; the end state is consistent", async () => {
    const { approval } = await request(p.bo2.session);
    const [dec, wd] = await Promise.all([
      call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, { session: p.bo.session, headers: ifm(1), body: decideBody() }),
      call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/withdraw`, { session: p.bo2.session, headers: ifm(1), body: { reason: "Synthetic withdrawal" } }),
    ]);
    const row = await api.db.selectFrom("approval").select(["status", "version"]).where("id", "=", approval.id).executeTakeFirstOrThrow();
    const rows = await decisionRows(approval.id);
    console.log(`[probe-A] A4 decide ${dec.status} ${dec.body.code ?? dec.body.status}, withdraw ${wd.status} ${wd.body.code ?? wd.body.status}; final ${row.status} v${row.version}; decision rows ${rows.length}`);
    expect([dec.status, wd.status].filter((s) => s === 200).length).toBe(1);
    if (row.status === "approved") expect(rows.length).toBe(1);
    else {
      expect(row.status).toBe("withdrawn");
      expect(rows.length).toBe(0);
    }
    expect(row.version).toBe(2);
  });

  it("A5 delegation loops: a three-person loop is 422; a concurrent A<->B pair gives exactly one 201", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    const b = await person(api, w, p.transformationId, "BO");
    const c = await person(api, w, p.transformationId, "BO");
    const del = (from: typeof a, to: string) =>
      call<Body>(api.app, "POST", "/api/v1/delegations", {
        session: from.session,
        body: { delegateUserId: to, reasonCode: "absence", absenceNote: "Synthetic leave", effectiveFrom: hours(-1), effectiveTo: hours(48) },
      });
    expect((await del(a, b.id)).status).toBe(201);
    expect((await del(b, c.id)).status).toBe(201);
    const loop = await del(c, a.id);
    console.log(`[probe-A] A5 C->A after A->B, B->C -> ${loop.status} ${loop.body.code}`);
    expect([loop.status, loop.body.code]).toEqual([422, "delegation.loop"]);
    const x = await person(api, w, p.transformationId, "BO");
    const y = await person(api, w, p.transformationId, "BO");
    const pair = await Promise.all([del(x, y.id), del(y, x.id)]);
    const n = await api.db
      .selectFrom("delegation")
      .select("id")
      .where((eb) => eb.or([eb.and([eb("delegator_user_id", "=", x.id), eb("delegate_user_id", "=", y.id)]), eb.and([eb("delegator_user_id", "=", y.id), eb("delegate_user_id", "=", x.id)])]))
      .execute();
    console.log(`[probe-A] A5 concurrent X->Y and Y->X -> ${JSON.stringify(pair.map((r) => [r.status, r.body.code ?? r.body.status]))}; rows ${n.length}`);
    expect(pair.filter((r) => r.status === 201).length).toBe(1);
    expect(n.length).toBe(1);
  });

  it("A6 the subject moved to version 2: deciding version 1 is 409 approval.stale_version; nothing written", async () => {
    const { approval, decisionId } = await request(p.bo2.session);
    await editDecision(send, p, decisionId, 1);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${approval.id}/decisions`, { session: p.bo.session, headers: ifm(1), body: decideBody() });
    console.log(`[probe-A] A6 stale -> ${res.status} ${res.body.code} requested ${res.body.requestedVersion} current ${res.body.currentVersion}`);
    expect([res.status, res.body.code]).toEqual([409, "approval.stale_version"]);
    expect(await decisionRows(approval.id)).toEqual([]);
  });
});
