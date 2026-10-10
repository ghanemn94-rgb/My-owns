// Transition decisions: resubmit and withdraw inside the decision's own transaction (T-DG4-BE-R2; ADR-0026 amendment
// A4, ADR-0034 amendment A2; BE-J handback §5 item 3) against a real PostgreSQL. The four A4 tests for the
// benefit_transition_decision subject:
//  (a) after changes are requested and the draft is edited, the decision's own submit resubmits the SAME approval:
//      one open approval, round 2, bound to the draft's current version; a decision quoting the round-1 version is
//      409 approval.stale_version; the Sponsor's approval on round 2 succeeds. Without an edit the submit is 422
//      approval.resubmit_needs_new_version; another proposer gets 403 approval.not_requester; nothing is written;
//  (b) withdrawing a decision whose approval is open (pending, or changes requested) leaves the approval `withdrawn`
//      and the decision `withdrawn`, both audited by one transaction (same xmin); no approval is left that can never
//      be decided;
//  (c) `POST /approvals/{id}/resubmit` on a benefit_transition_decision approval is 422
//      approval.resubmit_through_record and writes nothing;
//  (d) a requester whose grants are revoked between the request and its commit gets 403; nothing is written.
// All data is SYNTHETIC; the decisions are synthetic in-product business approvals of test data made by a test user,
// never by the requester, a job or an agent, and nothing touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import {
  draftDecision,
  launchedInitiative,
  pendingBenefit,
  seedClosureWorld,
  type ClosureWorld,
} from "../contract/p4-exercises-be-j.ts";

let api: TestApi;
let w: World;
let c: ClosureWorld;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  c = await seedClosureWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

type Sess = ClosureWorld["sp"]["session"];
const decisionRow = (id: string) =>
  api.db.selectFrom("transition_decision").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const approvalRow = (id: string) =>
  api.db.selectFrom("approval").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const openApprovals = (subjectId: string) =>
  api.db
    .selectFrom("approval")
    .select(["id", "status", "round_no", "subject_version"])
    .where("subject_id", "=", subjectId)
    .where("status", "in", ["pending", "changes_requested", "deferred"])
    .execute();
const auditXmin = async (recordId: string, action: string) =>
  (
    await api.db
      .selectFrom("audit_event")
      .select(sql<string>`xmin::text`.as("x"))
      .where("record_id", "=", recordId)
      .where("action", "=", action)
      .execute()
  ).map((r) => r.x);
const decide = async (approvalId: string, outcome: string, subjectVersion?: number) => {
  const a = await approvalRow(approvalId);
  return send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session: c.sp.session,
    headers: ifm(a.version),
    body: {
      outcome,
      rationale: "Synthetic decision on synthetic data",
      subjectVersion: subjectVersion ?? a.subject_version,
    },
  });
};
const D = (id: string) => `${c.transitions}/${id}`;

/** A draft decision submitted by `session` (default BO); returns it with its approval id. */
async function submittedDecision(session: Sess = c.b.s.bo) {
  const ini = await launchedInitiative(api.db, c.b);
  const ben = await pendingBenefit(api, c, ini);
  const td = await draftDecision(send, c, ben.id);
  const sub = await send("POST", `${D(td.id)}/submit`, { session, headers: ifm(td.version) });
  expect([sub.status, sub.body.status], JSON.stringify(sub.body)).toEqual([200, "submitted"]);
  return { id: td.id, code: td.code, approvalId: sub.body.approvalId as string };
}

/** A submitted decision returned with changes by the Sponsor and then edited by `session` (version 2). */
async function returnedAndEdited(session: Sess = c.b.s.bo) {
  const td = await submittedDecision(session);
  expect((await decide(td.approvalId, "request_changes")).status).toBe(200);
  const edited = await send("PATCH", D(td.id), {
    session,
    headers: ifm(1),
    body: { rationale: "Synthetic: the realization curve documented as requested" },
  });
  expect([edited.status, edited.body.status, edited.body.version]).toEqual([200, "draft", 2]);
  return td;
}

describe("(a) round 2 through submitTransitionDecision (ADR-0026 amendment A4)", () => {
  it("one open approval, round 2, on the draft's current version; stale round-1 decision 409; the Sponsor approves", async () => {
    const td = await returnedAndEdited();
    const re = await send("POST", `${D(td.id)}/submit`, { session: c.b.s.bo, headers: ifm(2) });
    expect([re.status, re.body.status, re.body.approvalId, re.body.version], JSON.stringify(re.body)).toEqual([
      200,
      "submitted",
      td.approvalId,
      2,
    ]);
    expect(await openApprovals(td.id)).toEqual([
      { id: td.approvalId, status: "pending", round_no: 2, subject_version: 2 },
    ]);
    expect((await auditOf(api.db, td.approvalId)).map((e) => e.action)).toContain("approval.resubmit");
    const stale = await decide(td.approvalId, "approve", 1);
    expect([stale.status, stale.body.code]).toEqual([409, "approval.stale_version"]);
    const ok = await decide(td.approvalId, "approve");
    expect([ok.status, ok.body.status, ok.body.roundNo], JSON.stringify(ok.body)).toEqual([200, "approved", 2]);
    const row = await decisionRow(td.id);
    expect([row.status, row.approval_id, row.decided_by]).toEqual(["approved", td.approvalId, c.sp.id]);
  });

  it("without an edit: 422 approval.resubmit_needs_new_version; another BO: 403 approval.not_requester; nothing written", async () => {
    const td = await submittedDecision();
    expect((await decide(td.approvalId, "request_changes")).status).toBe(200);
    const before = await approvalRow(td.approvalId);
    const audits = (await auditOf(api.db, td.approvalId)).length;
    const same = await send("POST", `${D(td.id)}/submit`, { session: c.b.s.bo, headers: ifm(1) });
    expect([same.status, same.body.code, same.body.detail]).toEqual([
      422,
      "approval.resubmit_needs_new_version",
      "Resubmit after changing the record: the request must be for a newer version.",
    ]);
    const bo3 = await extraUser(api, w, c.b, "BO");
    const other = await send("POST", `${D(td.id)}/submit`, { session: bo3.session, headers: ifm(1) });
    expect([other.status, other.body.code]).toEqual([403, "approval.not_requester"]);
    expect(await approvalRow(td.approvalId)).toEqual(before);
    expect((await auditOf(api.db, td.approvalId)).length).toBe(audits);
    expect((await decisionRow(td.id)).version).toBe(1);
  });
});

describe("(b) withdrawing a decision in approval withdraws its approval (ADR-0026 amendment A3, A4)", () => {
  it("pending and changes requested: approval and decision withdrawn, audited by one transaction; nothing undecidable", async () => {
    const pending = await submittedDecision();
    const returned = await submittedDecision();
    expect((await decide(returned.approvalId, "request_changes")).status).toBe(200);
    for (const td of [pending, returned]) {
      const wd = await send("PATCH", D(td.id), { session: c.b.s.bo, headers: ifm(1), body: { status: "withdrawn" } });
      expect([wd.status, wd.body.status, wd.body.version], JSON.stringify(wd.body)).toEqual([200, "withdrawn", 2]);
      const a = await approvalRow(td.approvalId);
      expect(a.status).toBe("withdrawn");
      expect(await openApprovals(td.id)).toEqual([]);
      const withdrawEvents = (await auditOf(api.db, td.approvalId)).filter((e) => e.action === "approval.withdraw");
      expect(withdrawEvents.map((e) => [e.reason, e.actor_user_id])).toEqual([
        [`Transition decision ${td.code} withdrawn.`, c.b.users.bo.id],
      ]);
      const [approvalX] = await auditXmin(td.approvalId, "approval.withdraw");
      expect(await auditXmin(td.id, "transition_decision.withdraw")).toEqual([approvalX]);
      const late = await decide(td.approvalId, "approve");
      expect([late.status, late.body.code]).toEqual([422, "approval.not_open"]);
    }
  });

  it("another BO withdrawing a decision in approval gets 403 approval.not_requester; nothing is written", async () => {
    const td = await submittedDecision();
    const bo3 = await extraUser(api, w, c.b, "BO");
    const before = await approvalRow(td.approvalId);
    const res = await send("PATCH", D(td.id), { session: bo3.session, headers: ifm(1), body: { status: "withdrawn" } });
    expect([res.status, res.body.code]).toEqual([403, "approval.not_requester"]);
    expect(await approvalRow(td.approvalId)).toEqual(before);
    const row = await decisionRow(td.id);
    expect([row.status, row.version]).toEqual(["draft", 1]);
  });
});

describe("(c) POST /approvals/{id}/resubmit refuses benefit_transition_decision approvals", () => {
  it("422 approval.resubmit_through_record with the exact text; the approval and the decision are unchanged", async () => {
    const td = await returnedAndEdited();
    const before = await approvalRow(td.approvalId);
    const audits = (await auditOf(api.db, td.approvalId)).length;
    const res = await send("POST", `/api/v1/approvals/${td.approvalId}/resubmit`, {
      session: c.b.s.bo,
      headers: ifm(before.version),
      body: { subjectVersion: 2 },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "approval.resubmit_through_record",
      "Resubmit this request by submitting its record again.",
    ]);
    expect(await approvalRow(td.approvalId)).toEqual(before);
    expect((await auditOf(api.db, td.approvalId)).length).toBe(audits);
    expect((await decisionRow(td.id)).version).toBe(2);
  });
});

describe("(d) commit-time authorization (S-4)", () => {
  it("the requester revoked between the request and its commit: resubmit and withdraw are 403; nothing is written", async () => {
    for (const action of ["submit", "withdraw"] as const) {
      const bo3 = await extraUser(api, w, c.b, "BO");
      const td = await returnedAndEdited(bo3.session);
      const before = await approvalRow(td.approvalId);
      const audits = [(await auditOf(api.db, td.id)).length, (await auditOf(api.db, td.approvalId)).length];
      const res = await afterIdentity(
        api,
        bo3.id,
        () =>
          action === "submit"
            ? call(api.app, "POST", `${D(td.id)}/submit`, { session: bo3.session, headers: ifm(2), contract: false })
            : call(api.app, "PATCH", D(td.id), {
                session: bo3.session,
                headers: ifm(2),
                body: { status: "withdrawn" },
                contract: false,
              }),
        () => revokeAll(api, w.grantor.id, bo3.id),
      );
      expect([action, res.status]).toEqual([action, 403]);
      expect(await approvalRow(td.approvalId)).toEqual(before);
      const row = await decisionRow(td.id);
      expect([action, row.status, row.version]).toEqual([action, "draft", 2]);
      expect([(await auditOf(api.db, td.id)).length, (await auditOf(api.db, td.approvalId)).length]).toEqual(audits);
    }
  });
});
