// Change requests: resubmit and withdraw inside the request's own transaction (T-DG4-BE-R2; ADR-0026 amendment A2-A4,
// ADR-0036 amendment A2) against a real PostgreSQL. The four A4 tests for the change_request subject:
//  (a) a round-2 resubmission through the request's own submit leaves ONE open approval, round 2, bound to the
//      request's new version, and a decision on it succeeds; a decision quoting the round-1 version is still 409
//      approval.stale_version;
//  (b) the request's own withdraw on a request in approval leaves the approval `withdrawn` and the request `withdrawn`,
//      with both audit events written by one transaction (same xmin); `change_request.withdraw_via_approval` is no
//      longer produced; anyone but the approval's requester gets 403 approval.not_requester and nothing is written;
//  (c) `POST /approvals/{id}/resubmit` on a change_request approval is 422 approval.resubmit_through_record (exact text)
//      and writes nothing;
//  (d) a requester whose grants are revoked between the request and its commit gets 403, and nothing is written.
// All data is SYNTHETIC; every decision is a demo BUSINESS approval by a named synthetic person; it approves nothing
// real, no job decides anything, and nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type Res, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { decide, selectedInitiative, setupChangeWorld, type Caller, type ChangeWorld } from "./change-fixtures.ts";

let api: TestApi;
let w: World;
let c: ChangeWorld;
const send: Caller = (m, u, o) => call(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await setupChangeWorld(api, w);
}, 120_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const CR = () => `${c.base}/change-requests`;
const scopeBody = (initiativeId: string) => ({
  changeKind: "business_scope",
  subjectType: "initiative",
  subjectId: initiativeId,
  subjectVersion: 1,
  proposedChange: { name: { from: "Synthetic initiative", to: "Synthetic initiative, wider scope" } },
  reason: "Synthetic: the sponsor asked to widen the scope",
});
const approvalRow = (id: string) =>
  api.db.selectFrom("approval").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const crRow = (id: string) =>
  api.db.selectFrom("change_request").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const openApprovals = (subjectId: string) =>
  api.db
    .selectFrom("approval")
    .select(["id", "status", "round_no", "subject_version"])
    .where("subject_id", "=", subjectId)
    .where("status", "in", ["pending", "changes_requested", "deferred"])
    .execute();
const assessmentsOf = async (crId: string) =>
  (await api.db.selectFrom("impact_assessment").select("id").where("change_request_id", "=", crId).execute()).length;
/** The xmin (inserting transaction) of the audit events with `action` on `recordId`. */
const auditXmin = async (recordId: string, action: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select(sql<string>`xmin::text`.as("x"))
      .where("record_id", "=", recordId)
      .where("action", "=", action)
      .execute()
  ).map((r) => r.x);

/** Raises a request as `who` (default the lead), submits it (routed to SP) and returns the ids and versions. */
async function submitted(who: { session: ChangeWorld["lead"]["session"] } = c.lead) {
  const ini = await selectedInitiative(api.db, c);
  const created = await send("POST", CR(), { session: who.session, body: scopeBody(ini) });
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const sub = await send("POST", `${CR()}/${created.body.id}/submit`, { session: who.session, headers: ifm(1) });
  expect([sub.status, sub.body.routePartyCode], JSON.stringify(sub.body)).toEqual([200, "SP"]);
  return { id: created.body.id as string, approvalId: sub.body.approvalId as string, version: sub.body.version };
}

/** A submitted request returned with changes by the Sponsor (the request is changes_requested, version 3). */
async function returned(who: { session: ChangeWorld["lead"]["session"] } = c.lead) {
  const r = await submitted(who);
  const back = await decide(send, r.approvalId, c.sponsor.session, "request_changes");
  expect(back.status, JSON.stringify(back.body)).toBe(200);
  const cr = await crRow(r.id);
  expect([cr.status, cr.version]).toEqual(["changes_requested", 3]);
  return r;
}

describe("(a) round-2 resubmission through submitChangeRequest (ADR-0026 amendment A4)", () => {
  it("one open approval, round 2, bound to the request's new version; the Sponsor's decision succeeds; round-1 version is 409", async () => {
    const r = await returned();
    const before = await approvalRow(r.approvalId);
    const again = await send("POST", `${CR()}/${r.id}/submit`, { session: c.lead.session, headers: ifm(3) });
    expect(
      [again.status, again.body.status, again.body.version, again.body.approvalId],
      JSON.stringify(again.body),
    ).toEqual([200, "submitted", 4, r.approvalId]);
    expect(await openApprovals(r.id)).toEqual([
      { id: r.approvalId, status: "pending", round_no: 2, subject_version: 4 },
    ]);
    const after = await approvalRow(r.approvalId);
    expect([after.version, after.round_no]).toEqual([before.version + 1, 2]);
    // The approval's resubmit audit and the request's submit audit are one transaction.
    const [resubmitX] = await auditXmin(r.approvalId, "approval.resubmit");
    const submitX = await auditXmin(r.id, "change_request.submit");
    expect(submitX).toHaveLength(2);
    expect(submitX[1]).toBe(resubmitX);
    // A second assessment was frozen for version 4.
    expect(await assessmentsOf(r.id)).toBe(2);
    // The approver's task is for round 2; the requester's changes-requested item is closed.
    const items = await api.db
      .selectFrom("work_item")
      .select(["kind", "status", "assignee_user_id"])
      .where("subject_id", "=", r.approvalId)
      .orderBy("created_at")
      .execute();
    expect(items.filter((i) => i.kind === "approval_changes_requested").map((i) => i.status)).toEqual(["done"]);
    expect(
      items.filter((i) => i.kind === "approval_decision" && i.status === "open").map((i) => i.assignee_user_id),
    ).toEqual([c.sponsor.id]);
    // A decision quoting the round-1 version is stale (REQ-S10-017): 409, nothing decided.
    const stale = await send("POST", `/api/v1/approvals/${r.approvalId}/decisions`, {
      session: c.sponsor.session,
      headers: ifm(after.version),
      body: { outcome: "approve", rationale: "Synthetic demo decision", subjectVersion: 2 },
    });
    expect([stale.status, stale.body.code]).toEqual([409, "approval.stale_version"]);
    expect((await approvalRow(r.approvalId)).version).toBe(after.version);
    const ok = await decide(send, r.approvalId, c.sponsor.session);
    expect([ok.status, ok.body.status, ok.body.roundNo, ok.body.subjectVersion], JSON.stringify(ok.body)).toEqual([
      200,
      "approved",
      2,
      4,
    ]);
    expect((await crRow(r.id)).status).toBe("approved");
  });

  it("a resubmission by a lead who is not the approval's requester is 403 approval.not_requester; nothing is written", async () => {
    const r = await returned();
    const lead2 = await person(api, w, c.transformationId, "TL");
    const before = await approvalRow(r.approvalId);
    const auditsBefore = (await auditOf(api.db, r.id)).length;
    const res = await send("POST", `${CR()}/${r.id}/submit`, { session: lead2.session, headers: ifm(3) });
    expect([res.status, res.body.code]).toEqual([403, "approval.not_requester"]);
    expect(await approvalRow(r.approvalId)).toEqual(before);
    expect([(await crRow(r.id)).version, (await auditOf(api.db, r.id)).length, await assessmentsOf(r.id)]).toEqual([
      3,
      auditsBefore,
      1,
    ]);
  });
});

describe("(b) withdrawChangeRequest on a request in approval (ADR-0036 amendment A2)", () => {
  it("pending: the approval and the request are withdrawn in one transaction, both audited; the decision is then 422", async () => {
    const r = await submitted();
    const res = await send("POST", `${CR()}/${r.id}/withdraw`, { session: c.lead.session, headers: ifm(2) });
    expect([res.status, res.body.status, res.body.version], JSON.stringify(res.body)).toEqual([200, "withdrawn", 3]);
    const a = await approvalRow(r.approvalId);
    expect(a.status).toBe("withdrawn");
    const withdrawAudit = (await auditOf(api.db, r.approvalId)).filter((e) => e.action === "approval.withdraw");
    expect(withdrawAudit.map((e) => [e.reason, e.actor_user_id])).toEqual([
      [`Change request ${(await crRow(r.id)).code} withdrawn.`, c.lead.id],
    ]);
    const [approvalX] = await auditXmin(r.approvalId, "approval.withdraw");
    expect(await auditXmin(r.id, "change_request.withdraw")).toEqual([approvalX]);
    // The approver's task is cancelled; deciding the withdrawn approval is refused.
    const tasks = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", r.approvalId)
      .where("kind", "=", "approval_decision")
      .execute();
    expect(tasks.map((t) => t.status)).toEqual(["cancelled"]);
    const late = await decide(send, r.approvalId, c.sponsor.session);
    expect([late.status, late.body.code]).toEqual([422, "approval.not_open"]);
  });

  it("changes requested: both withdrawn; a lead who is not the requester gets 403 approval.not_requester first, nothing written", async () => {
    const r = await returned();
    const lead2 = await person(api, w, c.transformationId, "TL");
    const before = await approvalRow(r.approvalId);
    const audits = (await auditOf(api.db, r.id)).length;
    const other = await send("POST", `${CR()}/${r.id}/withdraw`, { session: lead2.session, headers: ifm(3) });
    expect([other.status, other.body.code]).toEqual([403, "approval.not_requester"]);
    expect(await approvalRow(r.approvalId)).toEqual(before);
    expect([(await crRow(r.id)).status, (await auditOf(api.db, r.id)).length]).toEqual(["changes_requested", audits]);
    const res = await send("POST", `${CR()}/${r.id}/withdraw`, { session: c.lead.session, headers: ifm(3) });
    expect([res.status, res.body.status]).toEqual([200, "withdrawn"]);
    expect((await approvalRow(r.approvalId)).status).toBe("withdrawn");
    expect(await openApprovals(r.id)).toEqual([]);
  });
});

describe("(c) POST /approvals/{id}/resubmit refuses change_request approvals", () => {
  it("422 approval.resubmit_through_record with the exact text; the approval and the request are unchanged", async () => {
    const r = await returned();
    const before = await approvalRow(r.approvalId);
    const audits = (await auditOf(api.db, r.approvalId)).length;
    const res = await send("POST", `/api/v1/approvals/${r.approvalId}/resubmit`, {
      session: c.lead.session,
      headers: ifm(before.version),
      body: { subjectVersion: 3 },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "approval.resubmit_through_record",
      "Resubmit this request by submitting its record again.",
    ]);
    expect(await approvalRow(r.approvalId)).toEqual(before);
    expect((await auditOf(api.db, r.approvalId)).length).toBe(audits);
    expect((await crRow(r.id)).version).toBe(3);
  });
});

describe("(d) commit-time authorization (S-4)", () => {
  const revokedMidRequest = (userId: string, sendIt: () => Promise<Res>) =>
    afterIdentity(api, userId, sendIt, () => revokeAll(api, w.grantor.id, userId));

  it("the requester revoked between the request and its commit: resubmit and withdraw are 403; nothing is written", async () => {
    for (const action of ["submit", "withdraw"] as const) {
      const t = await person(api, w, c.transformationId, "TL");
      const r = await returned(t);
      const before = await approvalRow(r.approvalId);
      const audits = [(await auditOf(api.db, r.id)).length, (await auditOf(api.db, r.approvalId)).length];
      const res = await revokedMidRequest(t.id, () =>
        call(api.app, "POST", `${CR()}/${r.id}/${action}`, { session: t.session, headers: ifm(3), contract: false }),
      );
      expect([action, res.status]).toEqual([action, 403]);
      expect(await approvalRow(r.approvalId)).toEqual(before);
      const cr = await crRow(r.id);
      expect([action, cr.status, cr.version, await assessmentsOf(r.id)]).toEqual([action, "changes_requested", 3, 1]);
      expect([(await auditOf(api.db, r.id)).length, (await auditOf(api.db, r.approvalId)).length]).toEqual(audits);
    }
  });
});
