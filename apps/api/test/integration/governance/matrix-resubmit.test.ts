// Governance matrices: round 2 and later resubmit through the matrix's own submit (T-DG4-BE-R2; ADR-0026 amendment
// A4, BE-C handback §4.1) against a real PostgreSQL. The four A4 tests for the governance_matrix_change subject:
//  (a) after changes are requested the header is a draft and its rows are editable; submitting it again sets it
//      in_approval and resubmits the SAME approval: one open approval, round 2, bound to the header's new version; the
//      rows are frozen again (422 governance_matrix.in_approval); a decision quoting the round-1 version is 409
//      approval.stale_version; the Sponsor's approval on round 2 succeeds and approves that version;
//  (b) a matrix has no withdraw action of its own: withdrawing its approval (the requester, through the route) leaves
//      the approval `withdrawn` and the header `draft`, both audited by one transaction (same xmin), in round 1 and
//      in round 2;
//  (c) `POST /approvals/{id}/resubmit` on a governance_matrix_change approval is 422 approval.resubmit_through_record
//      and writes nothing;
//  (d) a requester whose raci.edit grant is revoked between the request and its commit gets 403; nothing is written.
// All data is SYNTHETIC; the matrix approvals decided here are demo BUSINESS approvals by a synthetic Sponsor; they
// approve nothing real and have nothing to do with the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person, setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 120_000);
afterAll(() => api.close());

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = (q: ApprovalWorld) => `/api/v1/transformations/${q.transformationId}`;
const title = { title: "Synthetic RACI for the Sponsor's business approval" };
const RATIONALE = "Synthetic: demo decision on synthetic data.";

const header = async (q: ApprovalWorld) =>
  api.db
    .selectFrom("governance_matrix")
    .selectAll()
    .where("transformation_id", "=", q.transformationId)
    .where("kind", "=", "raci")
    .executeTakeFirstOrThrow();
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
      .orderBy("seq")
      .execute()
  ).map((r) => r.x);

async function patchCharter(q: ApprovalWorld, labelEn: string, session = q.lead.session) {
  const raci = await send("GET", `${T(q)}/raci`, { session: q.auditor.session });
  const d = raci.body.deliverables.find((x: Body) => x.templateKey === "charter");
  return send("PATCH", `${T(q)}/raci/deliverables/${d.id}`, { session, headers: ifm(d.version), body: { labelEn } });
}
const submit = (q: ApprovalWorld, version: number, session = q.lead.session) =>
  send("POST", `${T(q)}/governance-matrices/raci/submit`, { session, headers: ifm(version), body: title });
const decide = async (q: ApprovalWorld, approvalId: string, outcome: string, subjectVersion?: number) => {
  const a = await approvalRow(approvalId);
  return send("POST", `/api/v1/approvals/${approvalId}/decisions`, {
    session: q.sponsor.session,
    headers: ifm(a.version),
    body: { outcome, rationale: RATIONALE, subjectVersion: subjectVersion ?? a.subject_version },
  });
};

/** A fresh world whose RACI matrix was submitted by `who` (default the lead) and returned with changes. */
async function returnedMatrix(who?: { id: string; session: ApprovalWorld["lead"]["session"] }) {
  const q = await setupApprovalWorld(api, w);
  const requester = who ?? q.lead;
  const h0 = await header(q);
  const first = await submit(q, h0.version, requester.session);
  expect(first.status, JSON.stringify(first.body)).toBe(201);
  const back = await decide(q, first.body.id, "request_changes");
  expect(back.status, JSON.stringify(back.body)).toBe(200);
  const h = await header(q);
  expect([h.status, h.version]).toEqual(["draft", h0.version + 2]);
  return { q, approvalId: first.body.id as string, round1Version: h0.version + 1, h };
}

describe("(a) round 2 through submitGovernanceMatrix (ADR-0026 amendment A4)", () => {
  it("one open approval, round 2, on the new header version; rows frozen again; stale round-1 decision 409; approve succeeds", async () => {
    const { q, approvalId, round1Version } = await returnedMatrix();
    // While changes are requested the rows are editable (each edit steps the header).
    const edited = await patchCharter(q, "Synthetic charter, revised for round 2");
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const h = await header(q);
    const again = await submit(q, h.version);
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    expect(again.headers["location"]).toBe(`/api/v1/approvals/${approvalId}`);
    expect(again.body).toMatchObject({
      id: approvalId,
      approvalType: "governance_matrix_change",
      status: "pending",
      roundNo: 2,
      subjectVersion: h.version + 1,
    });
    expect(await openApprovals(h.id)).toEqual([
      { id: approvalId, status: "pending", round_no: 2, subject_version: h.version + 1 },
    ]);
    const inApproval = await header(q);
    expect([inApproval.status, inApproval.version]).toEqual(["in_approval", h.version + 1]);
    // The header's submit and the approval's resubmit are one transaction.
    const submitX = await auditXmin(h.id, "governance_matrix.submit");
    expect(submitX).toHaveLength(2);
    expect(await auditXmin(approvalId, "approval.resubmit")).toEqual([submitX[1]]);
    // BE-C §4.1 closed: the rows are frozen again for round 2.
    const frozen = await patchCharter(q, "Synthetic frozen edit");
    expect([frozen.status, frozen.body.code]).toEqual([422, "governance_matrix.in_approval"]);
    // A decision quoting the round-1 version is stale: 409, nothing decided.
    const stale = await decide(q, approvalId, "approve", round1Version);
    expect([stale.status, stale.body.code]).toEqual([409, "approval.stale_version"]);
    expect((await approvalRow(approvalId)).status).toBe("pending");
    const ok = await decide(q, approvalId, "approve");
    expect([ok.status, ok.body.status, ok.body.roundNo], JSON.stringify(ok.body)).toEqual([200, "approved", 2]);
    const approved = await header(q);
    expect([approved.status, approved.approved_version, approved.approved_by]).toEqual([
      "approved",
      h.version + 1,
      q.sponsor.id,
    ]);
  });

  it("another lead (not the approval's requester) submitting round 2 gets 403 approval.not_requester; nothing is written", async () => {
    const { q, approvalId, h } = await returnedMatrix();
    const lead2 = await person(api, w, q.transformationId, "TL");
    const before = await approvalRow(approvalId);
    const audits = (await auditOf(api.db, h.id)).length;
    const res = await submit(q, h.version, lead2.session);
    expect([res.status, res.body.code]).toEqual([403, "approval.not_requester"]);
    expect(await approvalRow(approvalId)).toEqual(before);
    const after = await header(q);
    expect([after.status, after.version, (await auditOf(api.db, h.id)).length]).toEqual(["draft", h.version, audits]);
  });
});

describe("(b) withdrawing a matrix's approval returns the header to draft in the same transaction", () => {
  it("round 1 pending and round 2 pending: approval withdrawn, header draft, both audited by one transaction", async () => {
    const { q, approvalId } = await returnedMatrix();
    const h = await header(q);
    expect((await submit(q, h.version)).status).toBe(201);
    const a = await approvalRow(approvalId);
    expect([a.status, a.round_no]).toEqual(["pending", 2]);
    const wd = await send("POST", `/api/v1/approvals/${approvalId}/withdraw`, {
      session: q.lead.session,
      headers: ifm(a.version),
      body: { reason: "Synthetic: the RACI needs a broader review first" },
    });
    expect([wd.status, wd.body.status], JSON.stringify(wd.body)).toEqual([200, "withdrawn"]);
    const after = await header(q);
    expect([after.status, after.version]).toEqual(["draft", h.version + 2]);
    const [withdrawX] = await auditXmin(approvalId, "approval.withdraw");
    expect((await auditXmin(h.id, "governance_matrix.return_to_draft")).at(-1)).toBe(withdrawX);
    expect(await openApprovals(h.id)).toEqual([]);
    // The rows are editable again, and a new submit requests a NEW approval (the withdrawn one is final).
    expect((await patchCharter(q, "Synthetic charter after withdrawal")).status).toBe(200);
    const fresh = await submit(q, (await header(q)).version);
    expect([fresh.status, fresh.body.roundNo, fresh.body.id === approvalId]).toEqual([201, 1, false]);
  });
});

describe("(c) POST /approvals/{id}/resubmit refuses governance_matrix_change approvals", () => {
  it("422 approval.resubmit_through_record with the exact text; the approval and the header are unchanged", async () => {
    const { q, approvalId, h } = await returnedMatrix();
    const before = await approvalRow(approvalId);
    const audits = (await auditOf(api.db, approvalId)).length;
    const res = await send("POST", `/api/v1/approvals/${approvalId}/resubmit`, {
      session: q.lead.session,
      headers: ifm(before.version),
      body: { subjectVersion: h.version },
    });
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      422,
      "approval.resubmit_through_record",
      "Resubmit this request by submitting its record again.",
    ]);
    expect(await approvalRow(approvalId)).toEqual(before);
    expect((await auditOf(api.db, approvalId)).length).toBe(audits);
    expect(await header(q)).toEqual(h);
  });
});

describe("(d) commit-time authorization (S-4)", () => {
  it("the requester revoked between the request and its commit: round-2 submit is 403; nothing is written", async () => {
    const q0 = await setupApprovalWorld(api, w);
    const t = await person(api, w, q0.transformationId, "TL");
    // The same world, with the new TL as the requester of round 1.
    const h0 = await header(q0);
    const first = await submit(q0, h0.version, t.session);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect((await decide(q0, first.body.id, "request_changes")).status).toBe(200);
    const h = await header(q0);
    const before = await approvalRow(first.body.id);
    const audits = [(await auditOf(api.db, h.id)).length, (await auditOf(api.db, first.body.id)).length];
    const res = await afterIdentity(
      api,
      t.id,
      () =>
        call(api.app, "POST", `${T(q0)}/governance-matrices/raci/submit`, {
          session: t.session,
          headers: ifm(h.version),
          body: title,
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, t.id),
    );
    expect(res.status).toBe(403);
    expect(await approvalRow(first.body.id)).toEqual(before);
    expect(await header(q0)).toEqual(h);
    expect([(await auditOf(api.db, h.id)).length, (await auditOf(api.db, first.body.id)).length]).toEqual(audits);
  });
});
