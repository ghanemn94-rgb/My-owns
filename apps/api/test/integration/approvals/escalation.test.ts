// The approval escalation timer `approval.escalation_scan` (apps/worker/src/handlers/approvals.ts; ADR-0026 §6;
// REQ-S10-019; T-DG4-BE-B) against a real PostgreSQL. REQ-S10-019 acceptance: "after the due date plus retries, the
// approval is escalated exactly once and remains undecided":
//  - an overdue approval escalates ONCE to the next authority of its chain (Target-state design: BO, then SP), which
//    gets an `approval_escalated` task; the status is unchanged and no decision row is written;
//  - repeated runs (retries, a redelivery, a restart) and concurrent runs add nothing;
//  - an approval with an Unknown due date is never selected; a not-yet-overdue one is never escalated;
//  - an exhausted chain (Business scope change: SP only) or an unmapped next party is recorded as a visible routing
//    error, never a silent skip, and still never decides;
//  - the escalation target can decide; a deferral to a new date allows one further escalation for that date.
// The worker imports no API code (ADR-0002); the test drives the worker's real handler on the API's database. All data
// is SYNTHETIC; a timer never approves anything, and nothing here touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanOverdueApprovals } from "../../../../worker/src/handlers/approvals.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { makeOverdue, newDecision, requestBody, setupApprovalWorld, type ApprovalWorld } from "./approval-world.ts";

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

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const scan = (job = "test-scan") => scanOverdueApprovals(api.db, { organizationId: w.orgA.id }, job);

async function request(key: string, session = p.lead.session) {
  const decisionId = await newDecision(send, p);
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/approvals`, {
    session,
    body: requestBody(decisionId, p.rights[key]!),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body as { id: string; dueDate: string | null };
}

const approvalRow = (id: string) =>
  api.db.selectFrom("approval").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
const escalations = (id: string) =>
  api.db.selectFrom("approval_escalation").selectAll().where("approval_id", "=", id).orderBy("escalated_at").execute();
const decisionsOf = (id: string) =>
  api.db.selectFrom("approval_decision").select("id").where("approval_id", "=", id).execute();

describe("approval.escalation_scan (REQ-S10-019)", () => {
  it("after the due date plus retries, the approval is escalated exactly once and remains undecided", async () => {
    const a = await request("target_state_design");
    expect(a.dueDate).not.toBeNull();
    // Not yet overdue: nothing happens.
    await scan("not-yet");
    expect(await escalations(a.id)).toEqual([]);
    await makeOverdue(api, a.id, "2026-01-04");
    const first = await scan("run-1");
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    // Retries, a redelivery and a restart: the same (approval, round, due date) never escalates again.
    for (const job of ["run-1", "retry-2", "retry-3", "restart-4"]) await scan(job);
    // Concurrent runs too.
    await Promise.all(["c1", "c2", "c3", "c4"].map((j) => scan(j)));
    const rows = await escalations(a.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      round_no: 1,
      due_date: "2026-01-04",
      level: 1,
      from_party_code: "BO",
      to_party_code: "SP",
      to_user_id: p.sponsor.id,
      to_group_id: null,
      routing_error: null,
    });
    const after = await approvalRow(a.id);
    expect(after).toMatchObject({
      status: "pending",
      decided_by: null,
      decided_at: null,
      escalation_level: 1,
      escalated_to_party_code: "SP",
      escalated_to_user_id: p.sponsor.id,
    });
    expect(await decisionsOf(a.id)).toEqual([]);
    // Audited as the service actor; the target got one escalation task.
    const audit = await auditOf(api.db, a.id);
    expect(audit.map((e) => [e.action, e.actor_type, e.source])).toEqual([
      ["approval.request", "user", "api"],
      ["approval.test_clock", "system", "api"],
      ["approval.escalate", "service", "worker"],
    ]);
    const tasks = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "kind", "status"])
      .where("subject_id", "=", a.id)
      .where("kind", "=", "approval_escalated")
      .execute();
    expect(tasks).toEqual([{ assignee_user_id: p.sponsor.id, kind: "approval_escalated", status: "open" }]);
    // The escalation target (SP) can decide; the original assignee keeps the right too. The tasks then close.
    const decided = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/decisions`, {
      session: p.sponsor.session,
      headers: ifm(after.version),
      body: { outcome: "approve", rationale: "Synthetic: approved after escalation.", subjectVersion: 1 },
    });
    expect([decided.status, decided.body.status, decided.body.decidedBy]).toEqual([200, "approved", p.sponsor.id]);
    const closed = await api.db
      .selectFrom("work_item")
      .select("status")
      .where("subject_id", "=", a.id)
      .where("kind", "in", ["approval_decision", "approval_escalated"])
      .execute();
    expect(closed.length > 0 && closed.every((t) => t.status === "done")).toBe(true);
    // T-DG4-BE-B2 (0058; ADR-0026 §4/§6): the requester's and the assignee's reminders are informational and stay open
    // for their owners to dismiss: one approval_overdue each from the escalation, one approval_outcome for the requester.
    const reminders = await api.db
      .selectFrom("work_item")
      .select(["kind", "assignee_user_id", "status"])
      .where("subject_id", "=", a.id)
      .where("kind", "in", ["approval_overdue", "approval_outcome"])
      .orderBy("kind")
      .orderBy("assignee_user_id")
      .execute();
    expect(reminders).toEqual([
      { kind: "approval_outcome", assignee_user_id: p.lead.id, status: "open" },
      ...[p.lead.id, p.bo.id].sort().map((u) => ({ kind: "approval_overdue", assignee_user_id: u, status: "open" })),
    ]);
  });

  it("an exhausted chain is a visible routing error (no_next_authority); the approval stays pending, never approved", async () => {
    // Business scope change: escalation chain SP alone (B0099). The TL requests; the sponsor is the assignee.
    const a = await request("business_scope_change");
    await makeOverdue(api, a.id, "2026-01-05");
    await scan("exhausted-1");
    await scan("exhausted-2");
    const rows = await escalations(a.id);
    expect(rows.map((r) => [r.level, r.from_party_code, r.to_party_code, r.routing_error])).toEqual([
      [1, "SP", null, "no_next_authority"],
    ]);
    const row = await approvalRow(a.id);
    expect([row.status, row.escalation_level, row.decided_by]).toEqual(["pending", 0, null]);
    expect(await decisionsOf(a.id)).toEqual([]);
    expect((await auditOf(api.db, rows[0]!.id)).map((e) => [e.action, e.actor_type])).toEqual([
      ["approval_escalation.create", "service"],
    ]);
  });

  it("an unmapped next party is recorded as party_unmapped; a deferral to a new date allows one more escalation", async () => {
    const q = await setupApprovalWorld(api, w);
    // End the SP mapping: Target-state design's chain is BO, SP.
    const list = await call<Body>(
      api.app,
      "GET",
      `/api/v1/transformations/${q.transformationId}/role-mappings?status=active`,
      {
        session: q.lead.session,
      },
    );
    const sp = list.body.items.find((m: Body) => m.partyCode === "SP");
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings/${sp.id}/end`, {
      session: q.lead.session,
      headers: ifm(sp.version),
      body: { reason: "Synthetic: the sponsor left" },
    });
    const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    const id = res.body.id as string;
    await makeOverdue(api, id, "2026-01-06");
    await scan("unmapped-1");
    let rows = await escalations(id);
    expect(rows.map((r) => [r.to_party_code, r.to_user_id, r.routing_error])).toEqual([["SP", null, "party_unmapped"]]);
    // The assignee defers to a new date: one further escalation is possible for that date, not for the old one.
    const a = await approvalRow(id);
    const deferred = await call<Body>(api.app, "POST", `/api/v1/approvals/${id}/decisions`, {
      session: q.bo.session,
      headers: ifm(a.version),
      body: { outcome: "defer", rationale: "Synthetic: waiting for data", subjectVersion: 1, deferUntil: "2099-01-01" },
    });
    expect([deferred.status, deferred.body.status]).toEqual([200, "deferred"]);
    await makeOverdue(api, id, "2026-01-07");
    await scan("unmapped-2");
    await scan("unmapped-3");
    rows = await escalations(id);
    expect(rows.map((r) => [r.due_date, r.routing_error])).toEqual([
      ["2026-01-06", "party_unmapped"],
      ["2026-01-07", "party_unmapped"],
    ]);
    expect((await approvalRow(id)).status).toBe("deferred");
  });

  it("an approval with an Unknown due date is never selected", async () => {
    const q = await setupApprovalWorld(api, w);
    await call(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
      session: q.lead.session,
      body: { partyCode: "STEERCO", targetKind: "user", userId: q.sponsor.id },
    });
    const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["funding_reallocation"]!),
    });
    expect([res.body.dueDate, res.body.dueUnknownReason]).toEqual([null, "no_steerco_scheduled"]);
    await scan("unknown-due");
    expect(await escalations(res.body.id)).toEqual([]);
  });
});
