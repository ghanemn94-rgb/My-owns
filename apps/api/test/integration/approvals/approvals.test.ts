// The P4 approval service (ADR-0026 §2, §4, §8; T-DG4-BE-B) against a real PostgreSQL:
//  - REQ-S10-008: a decision routed to 'Business Owner' reaches the mapped person; an unmapped role blocks routing with
//    a visible error (422 routing.role_unmapped, nothing written; the resolve preview shows `unmapped`);
//  - REQ-S10-014: a decision without rationale is rejected; the stored record includes the request version, assignee,
//    due date, rationale, comments and decision timestamp;
//  - REQ-S10-016: the requester approving their own scope change returns 403 under the default policy;
//  - REQ-S10-017: approving version 3 after the record moved to version 4 returns 409 (currentVersion, requestedVersion);
//  - REQ-S10-018: four distinct outcomes; request changes returns the item to the requester without closing it; defer
//    requires a new date;
//  - REQ-S10-003: an ADM-only user gets 403 on decideApproval;
//  - every mutation: authorization (positive and negative, re-checked at commit time), validation, If-Match 428/409 and
//    its audit event.
// All data is SYNTHETIC: these are demo BUSINESS approvals on synthetic records; they approve nothing real and have
// nothing to do with the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, endSessions, revokeAll } from "../calendar/session-lock.ts";
import {
  editDecision,
  newDecision,
  person,
  requestBody,
  setupApprovalWorld,
  type ApprovalWorld,
} from "./approval-world.ts";

let api: TestApi;
let w: World;
let p: ApprovalWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupApprovalWorld(api, w);
}, 120_000);
afterAll(() => api.close());

const REQ = () => `/api/v1/transformations/${p.transformationId}/approvals`;
const A = (id: string) => `/api/v1/approvals/${id}`;

/** TL requests a Target-state design decision (Approve party BO, 10 working days) on a fresh decision. */
async function requestTsd(decisionId?: string, session = p.lead.session) {
  const id = decisionId ?? (await newDecision((m, u, o) => call(api.app, m, u, o), p));
  const res = await call<Body>(api.app, "POST", REQ(), {
    session,
    body: requestBody(id, p.rights["target_state_design"]!),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { approval: res.body, decisionId: id };
}

const decide = (id: string, session = p.bo.session, version = 1, body: Record<string, unknown> = {}) =>
  call<Body>(api.app, "POST", `${A(id)}/decisions`, {
    session,
    headers: ifm(version),
    body: {
      outcome: "approve",
      rationale: "Synthetic rationale: the evidence supports it.",
      subjectVersion: 1,
      ...body,
    },
  });

describe("routing (REQ-S10-008; ADR-0026 §2, §8)", () => {
  it("a decision routed to 'Business Owner' reaches the mapped person, with a task in their My Work", async () => {
    const { approval } = await requestTsd();
    expect(approval).toMatchObject({
      status: "pending",
      roundNo: 1,
      approvalType: "decision_request",
      subjectType: "decision",
      subjectVersion: 1,
      assignee: { partyCode: "BO", userId: p.bo.id, groupId: null },
      requestedBy: p.lead.id,
      slaType: "working_days",
      dueUnknownReason: null,
      escalationLevel: 0,
      escalatedTo: null,
      decisions: [],
      escalations: [],
      version: 1,
    });
    expect(approval.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(approval.calendarId).not.toBeNull();
    const items = await call<Body>(api.app, "GET", "/api/v1/me/work-items?kind=approval_decision&status=open", {
      session: p.bo.session,
    });
    expect(items.body.items.map((i: Body) => i.subjectId)).toContain(approval.id);
    const mine = await call<Body>(api.app, "GET", "/api/v1/approvals?status=pending", { session: p.bo.session });
    expect(mine.body.items.map((a: Body) => a.id)).toContain(approval.id);
    const requested = await call<Body>(api.app, "GET", "/api/v1/approvals?role=requester", { session: p.lead.session });
    expect(requested.body.items.map((a: Body) => a.id)).toContain(approval.id);
    expect((await auditOf(api.db, approval.id)).map((e) => e.action)).toEqual(["approval.request"]);
  });

  it("an unmapped role blocks routing with a visible error; nothing is written; the preview shows `unmapped`", async () => {
    // Funding reallocation's Approve party is SteerCo, which nobody mapped.
    const decisionId = await newDecision((m, u, o) => call(api.app, m, u, o), p);
    const res = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: requestBody(decisionId, p.rights["funding_reallocation"]!),
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "routing.role_unmapped",
      "No person or group is mapped to SteerCo in this transformation. Map the role in the transformation team before routing.",
    ]);
    expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([]);
    const none = await api.db.selectFrom("approval").select("id").where("subject_id", "=", decisionId).execute();
    expect(none).toEqual([]);
    const preview = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${p.transformationId}/role-mappings/resolve?party=STEERCO`,
      { session: p.auditor.session },
    );
    expect(preview.body).toEqual({
      partyCode: "STEERCO",
      status: "unmapped",
      mappingId: null,
      targetKind: null,
      userId: null,
      groupId: null,
    });
  });

  it("a mapped person without a business-approver role is refused (422 routing.assignee_not_approver)", async () => {
    const q = await setupApprovalWorld(api, w);
    // End the BO mapping and map the contributor (WL: no approval.decide) instead.
    const list = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${q.transformationId}/role-mappings?status=active`,
      {
        session: q.lead.session,
      },
    );
    const bo = list.body.items.find((m: Body) => m.partyCode === "BO");
    const ended = await call<Body>(
      api.app,
      "POST",
      `/api/v1/transformations/${q.transformationId}/role-mappings/${bo.id}/end`,
      { session: q.lead.session, headers: ifm(bo.version), body: { reason: "Synthetic: the owner changed" } },
    );
    expect(ended.status).toBe(200);
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
      session: q.lead.session,
      body: { partyCode: "BO", targetKind: "user", userId: q.contributor.id },
    });
    const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    expect([res.status, res.body.code]).toEqual([422, "routing.assignee_not_approver"]);
    expect(res.body.detail).toMatch(
      /is mapped to Business Owner but holds no business-approver role in this transformation/,
    );
  });
});

describe("request (ADR-0026 §4, §5)", () => {
  it("authorization: approval.request holders only (AUD and a no-role user refused), read gate 404 outside", async () => {
    const decisionId = await newDecision((m, u, o) => call(api.app, m, u, o), p);
    const body = requestBody(decisionId, p.rights["target_state_design"]!);
    const aud = await call<Body>(api.app, "POST", REQ(), { session: p.auditor.session, body });
    expect(aud.status).toBe(403);
    expect((await auditOfRequest(api.db, String(aud.headers["x-request-id"]))).map((e) => e.action)).toEqual([
      "authorization.denied",
    ]);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await call(api.app, "POST", REQ(), { session: outsider, body })).status).toBe(404);
    expect((await call(api.app, "POST", REQ(), { session: p.contributor.session, body })).status).toBe(201); // WL
  });

  it("validation: a wrong subject version is 409 stale; a duplicate open request is 409; unknown T11 row 422", async () => {
    const decisionId = await newDecision((m, u, o) => call(api.app, m, u, o), p);
    const stale = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: requestBody(decisionId, p.rights["target_state_design"]!, 2),
    });
    expect([stale.status, stale.body.code, stale.body.currentVersion, stale.body.requestedVersion]).toEqual([
      409,
      "approval.stale_version",
      1,
      2,
    ]);
    await requestTsd(decisionId);
    const dup = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: requestBody(decisionId, p.rights["target_state_design"]!),
    });
    expect([dup.status, dup.body.code, dup.body.type]).toEqual([
      409,
      "approval.already_open",
      "urn:mth:problem:duplicate",
    ]);
    const unknown = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: requestBody(decisionId, crypto.randomUUID()),
    });
    expect([unknown.status, unknown.body.code]).toEqual([422, "approval.decision_right_unknown"]);
    const blankTitle = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: { ...requestBody(decisionId, p.rights["target_state_design"]!), title: "‏ " },
    });
    expect(blankTitle.status).toBe(400);
  });

  it("SLA types: next SteerCo is Unknown (never guessed); urgent needs a reason and a configured route; release plan without a milestone is Unknown", async () => {
    // Map SteerCo to the sponsor (SP holds approval.decide) so the funding row routes.
    const q = await setupApprovalWorld(api, w);
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
      session: q.lead.session,
      body: { partyCode: "STEERCO", targetKind: "user", userId: q.sponsor.id },
    });
    const R = `/api/v1/transformations/${q.transformationId}/approvals`;
    const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
    const steerco = await call<Body>(api.app, "POST", R, {
      session: q.lead.session,
      body: requestBody(await newDecision(send, q), q.rights["funding_reallocation"]!),
    });
    expect([steerco.status, steerco.body.dueDate, steerco.body.dueUnknownReason]).toEqual([
      201,
      null,
      "no_steerco_scheduled",
    ]);
    const noReason = await call<Body>(api.app, "POST", R, {
      session: q.lead.session,
      body: requestBody(await newDecision(send, q), q.rights["funding_reallocation"]!, 1, { urgent: true }),
    });
    expect([noReason.status, noReason.body.code]).toEqual([422, "decision_right.urgent_reason_required"]);
    const notConfigured = await call<Body>(api.app, "POST", R, {
      session: q.lead.session,
      body: requestBody(await newDecision(send, q), q.rights["target_state_design"]!, 1, {
        urgent: true,
        urgentReason: "Synthetic urgency",
      }),
    });
    expect([notConfigured.status, notConfigured.body.code]).toEqual([422, "decision_right.urgent_not_configured"]);
    const release = await call<Body>(api.app, "POST", R, {
      session: q.lead.session,
      body: requestBody(await newDecision(send, q), q.rights["go_live_scale"]!),
    });
    expect([release.status, release.body.dueDate, release.body.dueUnknownReason]).toEqual([
      201,
      null,
      "no_release_date",
    ]);
  });
});

describe("decide (REQ-S10-014, REQ-S10-016, REQ-S10-017, REQ-S10-018)", () => {
  it("REQ-S10-014: a decision without rationale is rejected; the stored record includes the request version", async () => {
    const { approval } = await requestTsd();
    for (const rationale of ["", "   ", "‏⁠"]) {
      const res = await decide(approval.id, p.bo.session, 1, { rationale });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        422,
        "approval.rationale_required",
        "Enter a rationale for this decision.",
      ]);
    }
    const ok = await decide(approval.id, p.bo.session, 1, { comments: "Synthetic comment" });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    expect(ok.body).toMatchObject({
      status: "approved",
      subjectVersion: 1,
      decidedBy: p.bo.id,
      decidedOnBehalfOf: null,
      assignee: { partyCode: "BO", userId: p.bo.id },
      version: 2,
    });
    expect(ok.body.decidedAt).not.toBeNull();
    expect(ok.body.decisions).toEqual([
      expect.objectContaining({
        roundNo: 1,
        outcome: "approve",
        rationale: "Synthetic rationale: the evidence supports it.",
        comments: "Synthetic comment",
        subjectVersion: 1,
        decidedBy: p.bo.id,
        onBehalfOfUserId: null,
        deferUntil: null,
      }),
    ]);
    const stored = await api.db
      .selectFrom("approval_decision")
      .selectAll()
      .where("approval_id", "=", approval.id)
      .executeTakeFirstOrThrow();
    expect([stored.subject_version, stored.rationale, stored.decided_by]).toEqual([
      1,
      "Synthetic rationale: the evidence supports it.",
      p.bo.id,
    ]);
    expect((await auditOf(api.db, approval.id)).map((e) => e.action)).toEqual(["approval.request", "approval.decide"]);
    expect((await auditOf(api.db, stored.id)).map((e) => e.action)).toEqual(["approval_decision.create"]);
    // Final: immutable. A second decision is 422 approval.not_open.
    const again = await decide(approval.id, p.bo.session, 2);
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "approval.not_open",
      "This approval is approved and can no longer be decided.",
    ]);
    // The approver's task closed with the decision.
    const task = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", approval.id)
      .where("kind", "=", "approval_decision")
      .executeTakeFirstOrThrow();
    expect(task.status).toBe("done");
  });

  it("REQ-S10-016: the requester approving their own scope change returns 403 under the default policy", async () => {
    // Business scope change routes to the Sponsor; the sponsor requests it and then tries to approve it.
    const decisionId = await newDecision((m, u, o) => call(api.app, m, u, o), p);
    const req = await call<Body>(api.app, "POST", REQ(), {
      session: p.sponsor.session,
      body: requestBody(decisionId, p.rights["business_scope_change"]!),
    });
    expect([req.status, req.body.assignee.userId]).toEqual([201, p.sponsor.id]);
    const res = await decide(req.body.id, p.sponsor.session);
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      403,
      "approval.sod_requester",
      "You requested this change, so you cannot decide it. The separation-of-duties policy requires a different approver.",
    ]);
    expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([
      "authorization.denied",
    ]);
    const row = await api.db
      .selectFrom("approval")
      .select("status")
      .where("id", "=", req.body.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
  });

  it("REQ-S10-017: approving version 3 after the record moved to version 4 returns 409", async () => {
    const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
    const decisionId = await newDecision(send, p);
    await editDecision(send, p, decisionId, 1);
    await editDecision(send, p, decisionId, 2); // the record is at version 3
    const req = await call<Body>(api.app, "POST", REQ(), {
      session: p.lead.session,
      body: requestBody(decisionId, p.rights["target_state_design"]!, 3),
    });
    expect([req.status, req.body.subjectVersion]).toEqual([201, 3]);
    await editDecision(send, p, decisionId, 3); // the record moves to version 4
    const res = await decide(req.body.id, p.bo.session, 1, { subjectVersion: 3 });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      type: "urn:mth:problem:version-conflict",
      code: "approval.stale_version",
      currentVersion: 4,
      requestedVersion: 3,
      detail:
        "The record changed after this approval was requested: version 3 was submitted and the record is now at version 4. Review the changes before deciding.",
    });
    const rows = await api.db
      .selectFrom("approval_decision")
      .select("id")
      .where("approval_id", "=", req.body.id)
      .execute();
    expect(rows).toEqual([]);
  });

  it("REQ-S10-018: 'request changes' returns the item to the requester without closing it; resubmit opens round 2", async () => {
    const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
    const { approval, decisionId } = await requestTsd();
    const res = await decide(approval.id, p.bo.session, 1, {
      outcome: "request_changes",
      rationale: "Synthetic: add the cost view.",
    });
    expect([res.status, res.body.status, res.body.decidedAt]).toEqual([200, "changes_requested", null]);
    const back = await call<Body>(api.app, "GET", "/api/v1/me/work-items?kind=approval_changes_requested&status=open", {
      session: p.lead.session,
    });
    expect(back.body.items.map((i: Body) => i.subjectId)).toContain(approval.id);
    // Still open: a second request on the same subject is refused; a decision now is 422 (not decidable).
    expect((await decide(approval.id, p.bo.session, 2)).body.code).toBe("approval.not_open");
    // Resubmit: requester only (403), a newer version (422), If-Match (428/409).
    const R = `${A(approval.id)}/resubmit`;
    const notRequester = await call<Body>(api.app, "POST", R, {
      session: p.bo.session,
      headers: ifm(2),
      body: { subjectVersion: 2 },
    });
    expect([notRequester.status, notRequester.body.code]).toEqual([403, "approval.not_requester"]);
    const same = await call<Body>(api.app, "POST", R, {
      session: p.lead.session,
      headers: ifm(2),
      body: { subjectVersion: 1 },
    });
    expect([same.status, same.body.code]).toEqual([422, "approval.resubmit_needs_new_version"]);
    expect((await call(api.app, "POST", R, { session: p.lead.session, body: { subjectVersion: 2 } })).status).toBe(428);
    const v2 = await editDecision(send, p, decisionId, 1);
    expect(
      (await call(api.app, "POST", R, { session: p.lead.session, headers: ifm(1), body: { subjectVersion: v2 } }))
        .status,
    ).toBe(409);
    const resub = await call<Body>(api.app, "POST", R, {
      session: p.lead.session,
      headers: ifm(2),
      body: { subjectVersion: v2 },
    });
    expect([resub.status, resub.body.status, resub.body.roundNo, resub.body.subjectVersion]).toEqual([
      200,
      "pending",
      2,
      v2,
    ]);
    const decided = await decide(approval.id, p.bo.session, 3, {
      outcome: "reject",
      rationale: "Synthetic: not now.",
      subjectVersion: v2,
    });
    expect([decided.status, decided.body.status]).toEqual([200, "rejected"]);
    expect(decided.body.decisions.map((d: Body) => [d.roundNo, d.outcome])).toEqual([
      [1, "request_changes"],
      [2, "reject"],
    ]);
    expect((await auditOf(api.db, approval.id)).map((e) => e.action)).toEqual([
      "approval.request",
      "approval.decide",
      "approval.resubmit",
      "approval.decide",
    ]);
  });

  it("REQ-S10-018: 'defer' requires a new date after today; the due date moves and the task stays open", async () => {
    const { approval } = await requestTsd();
    const noDate = await decide(approval.id, p.bo.session, 1, { outcome: "defer" });
    expect([noDate.status, noDate.body.code, noDate.body.detail]).toEqual([
      422,
      "approval.defer_date_required",
      "A deferral needs a new date after today.",
    ]);
    const past = await decide(approval.id, p.bo.session, 1, { outcome: "defer", deferUntil: "2026-01-01" });
    expect(past.body.code).toBe("approval.defer_date_required");
    const ok = await decide(approval.id, p.bo.session, 1, { outcome: "defer", deferUntil: "2099-03-02" });
    expect([ok.status, ok.body.status, ok.body.dueDate, ok.body.decidedAt]).toEqual([
      200,
      "deferred",
      "2099-03-02",
      null,
    ]);
    const open = await api.db
      .selectFrom("work_item")
      .select(["status", "due_date"])
      .where("subject_id", "=", approval.id)
      .where("kind", "=", "approval_decision")
      .where("status", "=", "open")
      .execute();
    expect(open).toEqual([{ status: "open", due_date: "2099-03-02" }]);
    // A deferred approval can still be decided.
    const final = await decide(approval.id, p.bo.session, 2, { outcome: "approve" });
    expect([final.status, final.body.status]).toEqual([200, "approved"]);
    expect(final.body.decisions.map((d: Body) => d.outcome)).toEqual(["defer", "approve"]);
  });

  it("only the assignee (or their delegate) decides: another BO is 403 approval.not_assignee; AUD 403; outsider 404", async () => {
    const { approval } = await requestTsd();
    const other = await decide(approval.id, p.bo2.session);
    expect([other.status, other.body.code, other.body.detail]).toEqual([
      403,
      "approval.not_assignee",
      "This approval is not assigned to you, your group or anyone you act for.",
    ]);
    expect((await decide(approval.id, p.auditor.session)).status).toBe(403);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await decide(approval.id, outsider)).status).toBe(404);
    expect((await call(api.app, "GET", A(approval.id), { session: outsider })).status).toBe(404);
    expect((await call(api.app, "GET", A(approval.id), { session: p.auditor.session })).status).toBe(200);
  });

  it("If-Match: missing 428, stale 409; nothing written", async () => {
    const { approval } = await requestTsd();
    const missing = await call<Body>(api.app, "POST", `${A(approval.id)}/decisions`, {
      session: p.bo.session,
      body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
    });
    expect(missing.status).toBe(428);
    const stale = await decide(approval.id, p.bo.session, 7);
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await auditOf(api.db, approval.id)).map((e) => e.action)).toEqual(["approval.request"]);
  });

  it("commit-time authorization: a decide right revoked (or a session ended) while the request waits is refused", async () => {
    const q = await setupApprovalWorld(api, w);
    const res0 = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    const id = res0.body.id;
    const send = () =>
      call(api.app, "POST", `${A(id)}/decisions`, {
        session: q.bo.session,
        headers: ifm(1),
        body: { outcome: "approve", rationale: "Synthetic", subjectVersion: 1 },
        contract: false,
      });
    const revoked = await afterIdentity(api, q.bo.id, send, () => revokeAll(api, w.grantor.id, q.bo.id));
    expect(revoked.status).toBe(403);
    // Re-grant and end the session instead.
    await grant(api.db, w.grantor.id, q.bo.id, "BO", { type: "transformation", id: q.transformationId }, w.orgA.id);
    const ended = await afterIdentity(api, q.bo.id, send, (locker) => endSessions(locker, q.bo.id));
    expect(ended.status).toBe(401);
    const row = await api.db.selectFrom("approval").select("status").where("id", "=", id).executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
  });
});

describe("withdraw (ADR-0026 §4)", () => {
  it("the requester withdraws with a reason (final); anyone else 403; tasks cancelled; audited", async () => {
    const { approval } = await requestTsd();
    const W = `${A(approval.id)}/withdraw`;
    const other = await call<Body>(api.app, "POST", W, {
      session: p.bo.session,
      headers: ifm(1),
      body: { reason: "Synthetic" },
    });
    expect([other.status, other.body.code]).toEqual([403, "approval.not_requester"]);
    expect(
      (await call(api.app, "POST", W, { session: p.lead.session, headers: ifm(1), body: { reason: " " } })).status,
    ).toBe(400);
    const ok = await call<Body>(api.app, "POST", W, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: no longer needed" },
    });
    expect([ok.status, ok.body.status]).toEqual([200, "withdrawn"]);
    const again = await call<Body>(api.app, "POST", W, {
      session: p.lead.session,
      headers: ifm(2),
      body: { reason: "Again" },
    });
    expect([again.status, again.body.code]).toEqual([422, "approval.not_open"]);
    const tasks = await api.db.selectFrom("work_item").select("status").where("subject_id", "=", approval.id).execute();
    expect(tasks.map((t) => t.status)).toEqual(["cancelled"]);
    const audit = await auditOf(api.db, approval.id);
    expect(audit.map((e) => [e.action, e.reason])).toEqual([
      ["approval.request", null],
      ["approval.withdraw", "Synthetic: no longer needed"],
    ]);
  });
});

describe("REQ-S10-003: technical administrators are never business approvers", () => {
  it("an ADM-only user gets 403 on decideApproval, even as a member of the assignee group; nothing is written", async () => {
    const adm = await createUser(api.db, w.orgA.id);
    for (const role of ["ADM_TECH", "ADM_ACCESS", "ADM_METHOD"])
      await grant(api.db, w.grantor.id, adm.id, role, { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, adm.subject);
    const { approval } = await requestTsd();
    const res = await decide(approval.id, s);
    expect([res.status, res.body.code]).toEqual([403, "forbidden"]);
    expect((await auditOfRequest(api.db, String(res.headers["x-request-id"]))).map((e) => e.action)).toEqual([
      "authorization.denied",
    ]);
    const row = await api.db
      .selectFrom("approval")
      .select("status")
      .where("id", "=", approval.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe("pending");
  });
});

describe("listApprovalDecisionRecords (D-089 Q10)", () => {
  it("reads the union view of the transformation's decisions (transformation.read; outsiders 404)", async () => {
    const { approval } = await requestTsd();
    await decide(approval.id, p.bo.session);
    const R = `/api/v1/transformations/${p.transformationId}/approval-decisions?limit=100`;
    const res = await call<Body>(api.app, "GET", R, { session: p.auditor.session });
    expect(res.status).toBe(200);
    expect(res.body.items).toContainEqual(
      expect.objectContaining({
        source: "approval",
        approvalKind: "decision_request",
        outcome: "approved",
        decidedBy: p.bo.id,
      }),
    );
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await call(api.app, "GET", R, { session: outsider })).status).toBe(404);
    // A FIN user at the transformation also reads it.
    const fin = await person(api, w, p.transformationId, "FIN");
    expect((await call(api.app, "GET", R, { session: fin.session })).status).toBe(200);
  });
});
