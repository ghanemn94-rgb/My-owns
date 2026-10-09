// Delegation (ADR-0026 §3; REQ-S10-010; D-089 Q3; T-DG4-BE-B) against a real PostgreSQL. REQ-S10-010 acceptance:
// "A delegating to B and B to A is rejected; an approval by B shows 'B on behalf of A' in audit; after expiry B loses
// the capability". Also: A->B->C then C->A is rejected, two concurrent halves of a loop never both commit, self and
// window rules, who may create and revoke (the delegator; an access administrator on request, never to themselves;
// AUD and others refused), the pending-requester rule, If-Match on revoke, the expiry sweep (status only; capability is
// read from the window at use time), and an audit event for every write (the delegation table has no audit-required
// trigger, so these tests assert it). All data is SYNTHETIC; the approvals are demo BUSINESS approvals and have nothing
// to do with the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sweepExpiredDelegations } from "../../../../worker/src/handlers/access.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  person,
  requestBody,
  setupApprovalWorld,
  type ApprovalWorld,
  type Person,
} from "../approvals/approval-world.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
let admin: Session;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
  admin = await signIn(api.app, w.admin.subject); // ADM_ACCESS (delegation.manage) + ADM_TECH @ org A
}, 120_000);
afterAll(() => api.close());

const D = "/api/v1/delegations";
const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const window = (fromH = -1, toH = 24 * 7) => ({ effectiveFrom: hours(fromH), effectiveTo: hours(toH) });

async function delegate(from: Person | { session: Session }, toUserId: string, extra: Record<string, unknown> = {}) {
  return call<Body>(api.app, "POST", D, {
    session: from.session,
    body: { delegateUserId: toUserId, reasonCode: "absence", absenceNote: "Synthetic leave", ...window(), ...extra },
  });
}

describe("loops and self-delegation (REQ-S10-010; ADR-0026 §3 rules 1-2)", () => {
  it("A delegating to B and B to A is rejected (422 delegation.loop); nothing is written", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    const b = await person(api, w, p.transformationId, "BO");
    const ab = await delegate(a, b.id);
    expect(ab.status, JSON.stringify(ab.body)).toBe(201);
    expect(ab.body).toMatchObject({ delegatorUserId: a.id, delegateUserId: b.id, status: "active", version: 1 });
    expect((await auditOf(api.db, ab.body.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
      ["delegation.create", a.id],
    ]);
    // Even with a different scope (stricter than needed, ADR-0026 §3 rule 2).
    const ba = await delegate(b, a.id, { scopeType: "transformation", scopeId: p.transformationId });
    expect([ba.status, ba.body.code]).toEqual([422, "delegation.loop"]);
    expect(ba.body.detail).toMatch(
      /^This delegation would create a loop: .+ already delegates, directly or through others, to .+\.$/,
    );
    expect((await auditOfRequest(api.db, String(ba.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
  });

  it("A->B->C then C->A is rejected; a revoked delegation is not part of the graph", async () => {
    const [a, b, c] = await Promise.all([1, 2, 3].map(() => person(api, w, p.transformationId, "FIN")));
    expect((await delegate(a!, b!.id)).status).toBe(201);
    const bc = await delegate(b!, c!.id);
    expect(bc.status).toBe(201);
    expect((await delegate(c!, a!.id)).body.code).toBe("delegation.loop");
    const revoked = await call<Body>(api.app, "POST", `${D}/${bc.body.id}/revoke`, {
      session: b!.session,
      headers: ifm(1),
      body: { reason: "Synthetic: back early" },
    });
    expect([revoked.status, revoked.body.status]).toEqual([200, "revoked"]);
    expect((await delegate(c!, a!.id)).status).toBe(201);
  });

  it("two concurrent halves of a loop: exactly one commits (lock 730224)", async () => {
    const a = await person(api, w, p.transformationId, "SP");
    const b = await person(api, w, p.transformationId, "SP");
    const [r1, r2] = await Promise.all([delegate(a, b.id), delegate(b, a.id)]);
    expect([r1.status, r2.status].sort()).toEqual([201, 422]);
    expect([r1, r2].find((r) => r.status === 422)!.body.code).toBe("delegation.loop");
  });

  it("self-delegation is 422 delegation.self; an invalid window is 422 delegation.window_invalid", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    expect((await delegate(a, a.id)).body.code).toBe("delegation.self");
    for (const win of [
      { effectiveFrom: hours(5), effectiveTo: hours(4) },
      { effectiveFrom: hours(-48), effectiveTo: hours(-1) },
      { effectiveFrom: hours(1), effectiveTo: hours(24 * 367 + 2) },
    ]) {
      const res = await delegate(a, p.bo2.id, win);
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "delegation.window_invalid",
        "A delegation needs a start before its end, an end in the future, and at most 366 days in between.",
      ]);
    }
  });
});

describe("who creates and revokes (ADR-0026 §3 rule 4)", () => {
  it("an access administrator records one on the delegator's request (with a reason), never to themselves", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    const noReason = await call<Body>(api.app, "POST", D, {
      session: admin,
      body: { delegatorUserId: a.id, delegateUserId: p.bo2.id, reasonCode: "absence", ...window() },
    });
    expect(noReason.status).toBe(400);
    const ok = await call<Body>(api.app, "POST", D, {
      session: admin,
      body: {
        delegatorUserId: a.id,
        delegateUserId: p.bo2.id,
        reasonCode: "absence",
        reasonText: "Synthetic: requested by e-mail during sick leave",
        ...window(),
      },
    });
    expect([ok.status, ok.body.requestedByUserId, ok.body.delegatorUserId]).toEqual([201, a.id, a.id]);
    const audit = await auditOf(api.db, ok.body.id);
    expect(audit.map((e) => [e.action, e.actor_user_id])).toEqual([["delegation.create", w.admin.id]]);
    expect(audit[0]!.reason).toMatch(/on the delegator's request/);
    const toSelf = await call<Body>(api.app, "POST", D, {
      session: admin,
      body: {
        delegatorUserId: a.id,
        delegateUserId: w.admin.id,
        reasonCode: "other",
        reasonText: "Synthetic",
        ...window(),
      },
    });
    expect([toSelf.status, toSelf.body.code]).toEqual([422, "delegation.admin_self"]);
    // The administrator can revoke it; the delegate cannot (403 delegation.not_delegator).
    const byDelegate = await call<Body>(api.app, "POST", `${D}/${ok.body.id}/revoke`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect([byDelegate.status, byDelegate.body.code]).toEqual([403, "delegation.not_delegator"]);
    const byAdmin = await call<Body>(api.app, "POST", `${D}/${ok.body.id}/revoke`, {
      session: admin,
      headers: ifm(1),
      body: { reason: "Synthetic: the delegator returned" },
    });
    expect([byAdmin.status, byAdmin.body.status, byAdmin.body.revokedBy]).toEqual([200, "revoked", w.admin.id]);
    expect((await auditOf(api.db, ok.body.id)).map((e) => e.action)).toEqual([
      "delegation.create",
      "delegation.revoke",
    ]);
  });

  it("someone else's delegation: a business user 403 delegation.not_delegator; AUD 403; nobody 403; reads 404", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    const other = await call<Body>(api.app, "POST", D, {
      session: p.bo2.session,
      body: { delegatorUserId: a.id, delegateUserId: p.fin.id, reasonCode: "absence", ...window() },
    });
    expect([other.status, other.body.code]).toEqual([403, "delegation.not_delegator"]);
    const aud = await call<Body>(api.app, "POST", D, {
      session: p.auditor.session,
      body: { delegateUserId: p.fin.id, reasonCode: "absence", ...window() },
    });
    expect(aud.status).toBe(403);
    expect((await auditOfRequest(api.db, String(aud.headers["x-request-id"]))).map((e) => e.action)).toEqual([
      "authorization.denied",
    ]);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect(
      (
        await call(api.app, "POST", D, {
          session: nobody,
          body: { delegateUserId: p.fin.id, reasonCode: "absence", ...window() },
        })
      ).status,
    ).toBe(403);
    const mine = await delegate(a, p.fin.id);
    expect((await call(api.app, "GET", `${D}/${mine.body.id}`, { session: p.auditor.session })).status).toBe(404);
    expect((await call(api.app, "GET", `${D}/${mine.body.id}`, { session: p.fin.session })).status).toBe(200);
    expect((await call(api.app, "GET", `${D}/${mine.body.id}`, { session: admin })).status).toBe(200);
    const list = await call<Body>(api.app, "GET", `${D}?role=delegator`, { session: a.session });
    expect(list.body.items.map((d: Body) => d.id)).toEqual([mine.body.id]);
  });

  it("revoke: If-Match 428/409, reason required, final (422 delegation.not_active)", async () => {
    const a = await person(api, w, p.transformationId, "BO");
    const d = await delegate(a, p.fin.id);
    const R = `${D}/${d.body.id}/revoke`;
    expect((await call(api.app, "POST", R, { session: a.session, body: { reason: "Synthetic" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", R, { session: a.session, headers: ifm(4), body: { reason: "Synthetic" } })).status,
    ).toBe(409);
    expect(
      (await call(api.app, "POST", R, { session: a.session, headers: ifm(1), body: { reason: "  " } })).status,
    ).toBe(400);
    expect(
      (await call(api.app, "POST", R, { session: a.session, headers: ifm(1), body: { reason: "Synthetic" } })).status,
    ).toBe(200);
    const again = await call<Body>(api.app, "POST", R, {
      session: a.session,
      headers: ifm(2),
      body: { reason: "Again" },
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "delegation.not_active",
      "This delegation is revoked and can no longer be revoked.",
    ]);
  });

  it("commit-time: delegation.create_own revoked while the request waits is refused, nothing written", async () => {
    const a = await person(api, w, p.transformationId, "WL");
    const res = await afterIdentity(
      api,
      a.id,
      () =>
        call(api.app, "POST", D, {
          session: a.session,
          body: { delegateUserId: p.fin.id, reasonCode: "absence", ...window() },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, a.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("delegation").select("id").where("delegator_user_id", "=", a.id).execute();
    expect(rows).toEqual([]);
  });
});

describe("delegated approvals (REQ-S10-010; ADR-0026 §3 rules 6-9)", () => {
  it("an approval by B shows 'B on behalf of A' in audit", async () => {
    // A = the mapped Business Owner (p.bo); B = another BO who acts for A while A is away.
    const d = await delegate(p.bo, p.bo2.id, {
      scopeType: "transformation",
      scopeId: p.transformationId,
      recordTypes: ["approval"],
    });
    expect(d.status, JSON.stringify(d.body)).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/approvals`, {
      session: p.lead.session,
      body: requestBody(p.decisionId, p.rights["target_state_design"]!),
    });
    expect(req.status).toBe(201);
    // B sees it among "my approvals" (people I act for) and decides on A's behalf.
    const mine = await call<Body>(api.app, "GET", "/api/v1/approvals", { session: p.bo2.session });
    expect(mine.body.items.map((x: Body) => x.id)).toContain(req.body.id);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: p.bo2.session,
      headers: ifm(1),
      body: {
        outcome: "approve",
        rationale: "Synthetic: approved while A is on leave.",
        subjectVersion: 1,
        onBehalfOfUserId: p.bo.id,
      },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ status: "approved", decidedBy: p.bo2.id, decidedOnBehalfOf: p.bo.id });
    expect(res.body.decisions[0]).toMatchObject({ decidedBy: p.bo2.id, onBehalfOfUserId: p.bo.id });
    const audit = await auditOf(api.db, req.body.id);
    const decided = audit.find((e) => e.action === "approval.decide")!;
    expect([decided.actor_user_id, decided.on_behalf_of_user_id]).toEqual([p.bo2.id, p.bo.id]);
    // The transformation's audit trail (what the audit view renders as "B on behalf of A") carries both identities.
    const view = await call<Body>(api.app, "GET", `/api/v1/transformations/${p.transformationId}/audit?limit=100`, {
      session: p.auditor.session,
    });
    expect(view.status).toBe(200);
    const ev = (view.body.items as Body[]).find((e) => e.action === "approval.decide" && e.recordId === req.body.id);
    expect(ev).toMatchObject({ actor: { type: "user", userId: p.bo2.id }, onBehalfOfUserId: p.bo.id });
    const records = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${p.transformationId}/approval-decisions?limit=100`,
      {
        session: p.auditor.session,
      },
    );
    expect(records.body.items).toContainEqual(
      expect.objectContaining({ recordId: res.body.decisions[0].id, decidedBy: p.bo2.id, onBehalfOfUserId: p.bo.id }),
    );
  });

  it("after expiry B loses the capability (at once, before any sweep); the sweep then marks it expired, once", async () => {
    const q = await setupApprovalWorld(api, w);
    const short = await call<Body>(api.app, "POST", D, {
      session: q.bo.session,
      body: {
        delegateUserId: q.bo2.id,
        reasonCode: "absence",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date(Date.now() + 1500).toISOString(),
      },
    });
    expect(short.status).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    await new Promise((r) => setTimeout(r, 2000));
    // The row still says `active` (no sweep yet); the window has passed, so B can no longer act for A.
    const row = await api.db
      .selectFrom("delegation")
      .select("status")
      .where("id", "=", short.body.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("active");
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: q.bo2.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1, onBehalfOfUserId: q.bo.id },
    });
    expect([res.status, res.body.code]).toEqual([403, "approval.not_assignee"]);
    expect((await call<Body>(api.app, "GET", `${D}/${short.body.id}`, { session: q.bo.session })).body.status).toBe(
      "expired",
    );
    // The sweep: status only, audited as the service actor, exactly once.
    const s1 = await sweepExpiredDelegations(api.db, { organizationId: w.orgA.id }, "sweep-1");
    const s2 = await sweepExpiredDelegations(api.db, { organizationId: w.orgA.id }, "sweep-2");
    expect(s1.expired).toBeGreaterThanOrEqual(1);
    expect(s2.expired).toBe(0);
    const audit = await auditOf(api.db, short.body.id);
    expect(audit.map((e) => [e.action, e.actor_type, e.source])).toEqual([
      ["delegation.create", "user", "api"],
      ["delegation.expire", "service", "worker"],
    ]);
    const revoke = await call<Body>(api.app, "POST", `${D}/${short.body.id}/revoke`, {
      session: q.bo.session,
      headers: ifm(2),
      body: { reason: "Synthetic" },
    });
    expect([revoke.status, revoke.body.code]).toEqual([422, "delegation.not_active"]);
  });

  it("capability is the delegator's: a delegator who lost approval.decide gives the delegate nothing", async () => {
    const q = await setupApprovalWorld(api, w);
    expect((await delegate(q.bo, q.bo2.id)).status).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    await revokeAll(api, w.grantor.id, q.bo.id);
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: q.bo2.session,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect([res.status, res.body.code]).toEqual([403, "approval.not_assignee"]);
  });

  it("never to the requester of an approval pending with the delegator (422 delegation.delegate_is_requester)", async () => {
    const q = await setupApprovalWorld(api, w);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    expect(req.status).toBe(201);
    const res = await delegate(q.bo, q.lead.id);
    expect([res.status, res.body.code]).toEqual([422, "delegation.delegate_is_requester"]);
    expect(res.body.detail).toMatch(
      /requested an approval that is pending with .+, so they cannot act on .+'s behalf\.$/,
    );
  });

  it("the requester cannot approve through a delegation either (SoD: on behalf of the requester is 403)", async () => {
    const q = await setupApprovalWorld(api, w);
    // The sponsor requests a scope change (assigned to SP = the sponsor) ... a BO delegate of the sponsor tries.
    const sp2 = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, sp2.id, "SP", { type: "transformation", id: q.transformationId }, w.orgA.id);
    const sp2s = await signIn(api.app, sp2.subject);
    expect((await delegate(q.sponsor, sp2.id)).status).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.sponsor.session,
      body: requestBody(q.decisionId, q.rights["business_scope_change"]!),
    });
    const res = await call<Body>(api.app, "POST", `/api/v1/approvals/${req.body.id}/decisions`, {
      session: sp2s,
      headers: ifm(1),
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1, onBehalfOfUserId: q.sponsor.id },
    });
    expect([res.status, res.body.code]).toEqual([403, "approval.sod_requester"]);
  });
});
