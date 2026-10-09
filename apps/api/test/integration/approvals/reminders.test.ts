// The approval inbox reminders (ADR-0026 §4 "Outcome behaviour" and §6 step 3; migration 0058; D-094 (2);
// T-DG4-BE-B2) against a real PostgreSQL:
//  - approve or reject: the requester gets exactly ONE `approval_outcome` reminder (work item + inbox notification),
//    once per (approval, round, requester). ADR-0026 §4: approve "The requester gets an inbox reminder."; reject "The
//    requester gets a reminder.";
//  - request changes and defer: NO `approval_outcome` reminder. ADR-0026 §4: request changes "Returns to the requester:
//    a work item `approval_changes_requested` for the requester." (its own kind); defer "The assignee's task stays open
//    with the new due date." (the approval stays open with the assignee; the ADR names no requester reminder);
//  - the escalation timer: the requester and the current assignee each get ONE `approval_overdue` reminder per
//    (approval, round, due date), naming the delay and any routing error (ADR-0026 §6 step 3: "In every case the
//    requester and the current assignee get an inbox reminder naming the delay impact and any routing error"), and
//    retries, redeliveries and concurrent runs create nothing more. A reminder informs; it decides nothing.
// All data is SYNTHETIC. These are business approvals inside the product; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { scanOverdueApprovals } from "../../../../worker/src/handlers/approvals.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  editDecision,
  makeOverdue,
  newDecision,
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

const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const scan = (job: string) => scanOverdueApprovals(api.db, { organizationId: w.orgA.id }, job);

async function request(key = "target_state_design", session: Session = p.lead.session) {
  const decisionId = await newDecision(send, p);
  const res = await call<Body>(api.app, "POST", `/api/v1/transformations/${p.transformationId}/approvals`, {
    session,
    body: requestBody(decisionId, p.rights[key]!),
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id as string, decisionId };
}

const decide = (id: string, version: number, body: Record<string, unknown>, session: Session = p.bo.session) =>
  call<Body>(api.app, "POST", `/api/v1/approvals/${id}/decisions`, {
    session,
    headers: ifm(version),
    body: { rationale: "Synthetic rationale.", subjectVersion: 1, ...body },
  });

const itemsOf = (id: string, kind: string) =>
  api.db
    .selectFrom("work_item")
    .select(["id", "assignee_user_id", "status", "message_key", "message_params", "dedupe_key", "created_source"])
    .where("subject_id", "=", id)
    .where("kind", "=", kind)
    .orderBy("assignee_user_id")
    .execute();
const notificationsOf = (workItemIds: readonly string[]) =>
  workItemIds.length === 0
    ? Promise.resolve([])
    : api.db
        .selectFrom("inbox_notification")
        .select(["recipient_user_id", "work_item_id", "message_key", "dedupe_key"])
        .where("work_item_id", "in", workItemIds)
        .execute();
const auditActions = (recordId: string) =>
  api.db
    .selectFrom("audit_event")
    .select(["action", "actor_type", "actor_user_id", "source"])
    .where("record_id", "=", recordId)
    .orderBy("seq")
    .execute();
const versionOf = async (id: string) =>
  (await api.db.selectFrom("approval").select("version").where("id", "=", id).executeTakeFirstOrThrow()).version;

describe("approval_outcome: one requester reminder per approve or reject (ADR-0026 §4)", () => {
  it("approve: exactly one reminder for the requester, with its inbox notification and audit; the requester sees it", async () => {
    const a = await request();
    const res = await decide(a.id, 1, { outcome: "approve" });
    expect([res.status, res.body.status]).toEqual([200, "approved"]);
    const items = await itemsOf(a.id, "approval_outcome");
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      assignee_user_id: p.lead.id,
      status: "open",
      message_key: "approvals.task.outcome",
      dedupe_key: `approval.outcome:${a.id}:1:${p.lead.id}`,
      created_source: "api",
    });
    expect(items[0]!.message_params).toMatchObject({ roundNo: 1, outcome: "approved" });
    const notes = await notificationsOf(items.map((i) => i.id));
    expect(notes).toEqual([
      {
        recipient_user_id: p.lead.id,
        work_item_id: items[0]!.id,
        message_key: "approvals.task.outcome",
        dedupe_key: `approval.outcome:${a.id}:1:${p.lead.id}`,
      },
    ]);
    // Audited as the deciding user (the reminder is the decision's side effect, not a job's).
    expect(await auditActions(items[0]!.id)).toEqual([
      { action: "work_item.create", actor_type: "user", actor_user_id: p.bo.id, source: "api" },
    ]);
    // Visible in the requester's own inbox and My Work; never in the decider's.
    const inbox = await call<Body>(api.app, "GET", "/api/v1/me/inbox", { session: p.lead.session });
    expect(inbox.body.items.filter((n: Body) => n.workItemId === items[0]!.id)).toHaveLength(1);
    const boInbox = await call<Body>(api.app, "GET", "/api/v1/me/inbox", { session: p.bo.session });
    expect(boInbox.body.items.filter((n: Body) => n.workItemId === items[0]!.id)).toEqual([]);
    // A refused second decision (final) creates nothing more.
    const again = await decide(a.id, 2, { outcome: "reject" });
    expect([again.status, again.body.code]).toEqual([422, "approval.not_open"]);
    expect(await itemsOf(a.id, "approval_outcome")).toHaveLength(1);
  });

  it("reject: exactly one reminder for the requester", async () => {
    const a = await request();
    const res = await decide(a.id, 1, { outcome: "reject" });
    expect([res.status, res.body.status]).toEqual([200, "rejected"]);
    const items = await itemsOf(a.id, "approval_outcome");
    expect(items.map((i) => [i.assignee_user_id, i.dedupe_key])).toEqual([
      [p.lead.id, `approval.outcome:${a.id}:1:${p.lead.id}`],
    ]);
    expect(items[0]!.message_params).toMatchObject({ outcome: "rejected" });
  });

  it("defer and request changes create no approval_outcome reminder; the later decision of round 2 creates one", async () => {
    const a = await request();
    const deferred = await decide(a.id, 1, { outcome: "defer", deferUntil: "2099-01-01" });
    expect([deferred.status, deferred.body.status]).toEqual([200, "deferred"]);
    expect(await itemsOf(a.id, "approval_outcome")).toEqual([]);
    const changes = await decide(a.id, 2, { outcome: "request_changes" });
    expect([changes.status, changes.body.status]).toEqual([200, "changes_requested"]);
    expect(await itemsOf(a.id, "approval_outcome")).toEqual([]);
    // request changes keeps its own requester work item (unchanged BE-B behaviour).
    expect((await itemsOf(a.id, "approval_changes_requested")).map((i) => i.assignee_user_id)).toEqual([p.lead.id]);
    // Resubmit (round 2) and approve: one reminder, keyed by round 2.
    const v2 = await editDecision(send, p, a.decisionId, 1);
    const resub = await call<Body>(api.app, "POST", `/api/v1/approvals/${a.id}/resubmit`, {
      session: p.lead.session,
      headers: ifm(3),
      body: { subjectVersion: v2 },
    });
    expect([resub.status, resub.body.roundNo]).toEqual([200, 2]);
    const ok = await decide(a.id, 4, { outcome: "approve", subjectVersion: v2 });
    expect([ok.status, ok.body.status]).toEqual([200, "approved"]);
    const items = await itemsOf(a.id, "approval_outcome");
    expect(items.map((i) => [i.assignee_user_id, i.dedupe_key])).toEqual([
      [p.lead.id, `approval.outcome:${a.id}:2:${p.lead.id}`],
    ]);
    expect(items[0]!.message_params).toMatchObject({ roundNo: 2, outcome: "approved" });
  });
});

describe("approval_overdue: the escalation timer's reminders (ADR-0026 §6 step 3)", () => {
  it("escalated: the requester and the assignee each get one reminder naming the delay; retries add nothing", async () => {
    // Target-state design: TL requests, Approve party BO (the assignee), chain BO then SP.
    const a = await request();
    await scan("rem-not-yet");
    expect(await itemsOf(a.id, "approval_overdue")).toEqual([]);
    await makeOverdue(api, a.id, "2026-01-04");
    const first = await scan("rem-1");
    expect(first.escalated).toBeGreaterThanOrEqual(1);
    for (const job of ["rem-1", "rem-retry-2", "rem-restart-3"]) await scan(job);
    await Promise.all(["rem-c1", "rem-c2", "rem-c3"].map((j) => scan(j)));
    const items = await itemsOf(a.id, "approval_overdue");
    const expected = [p.lead.id, p.bo.id].sort();
    expect(items.map((i) => i.assignee_user_id)).toEqual(expected);
    for (const i of items) {
      expect(i).toMatchObject({
        status: "open",
        message_key: "approvals.task.overdue",
        dedupe_key: `approval.overdue:${a.id}:1:2026-01-04:${i.assignee_user_id}`,
        created_source: "worker",
      });
      expect(i.message_params).toMatchObject({
        dueDate: "2026-01-04",
        level: 1,
        escalatedToParty: "SP",
        routingError: null,
        recipientRole: i.assignee_user_id === p.lead.id ? "requester" : "assignee",
      });
      // The delay is named by business dates (overdue since dueDate, as of today's business date), never a count.
      expect(String((i.message_params as Body).overdueAsOf)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(await auditActions(i.id)).toEqual([
        { action: "work_item.create", actor_type: "service", actor_user_id: null, source: "worker" },
      ]);
    }
    expect((await notificationsOf(items.map((i) => i.id))).map((n) => n.recipient_user_id).sort()).toEqual(expected);
    // The timer never decides: still pending, no decision row, and no outcome reminder.
    const row = await api.db.selectFrom("approval").selectAll().where("id", "=", a.id).executeTakeFirstOrThrow();
    expect([row.status, row.decided_by]).toEqual(["pending", null]);
    expect(await itemsOf(a.id, "approval_outcome")).toEqual([]);
    // The escalation target gets its approval_escalated task (BE-B behaviour), not an overdue reminder.
    expect((await itemsOf(a.id, "approval_escalated")).map((i) => i.assignee_user_id)).toEqual([p.sponsor.id]);
  });

  it("a routing error is named in both reminders (no_next_authority); repeated runs add nothing", async () => {
    // Business scope change: chain SP alone, so escalation has no next authority. The TL requests; SP is assigned.
    const a = await request("business_scope_change");
    await makeOverdue(api, a.id, "2026-01-05");
    await scan("rem-err-1");
    await scan("rem-err-2");
    const items = await itemsOf(a.id, "approval_overdue");
    expect(items.map((i) => i.assignee_user_id)).toEqual([p.lead.id, p.sponsor.id].sort());
    for (const i of items) {
      expect(i.message_key).toBe("approvals.task.overdue_routing_error");
      expect(i.message_params).toMatchObject({
        dueDate: "2026-01-05",
        routingError: "no_next_authority",
        escalatedToParty: null,
      });
    }
  });

  it("a deferral to a new date gives one further reminder per person for that date (dedupe by due date)", async () => {
    const a = await request();
    await makeOverdue(api, a.id, "2026-01-06");
    await scan("rem-def-1");
    expect(await itemsOf(a.id, "approval_overdue")).toHaveLength(2);
    // The assignee defers to a new date; when that date passes, one more reminder each, keyed by the new due date.
    const deferred = await decide(a.id, await versionOf(a.id), { outcome: "defer", deferUntil: "2099-01-01" });
    expect([deferred.status, deferred.body.status]).toEqual([200, "deferred"]);
    expect(await itemsOf(a.id, "approval_outcome")).toEqual([]);
    await makeOverdue(api, a.id, "2026-01-07");
    await scan("rem-def-2");
    await scan("rem-def-3");
    const items = await itemsOf(a.id, "approval_overdue");
    expect(items.map((i) => i.dedupe_key).sort()).toEqual(
      [p.lead.id, p.bo.id]
        .flatMap((u) => [`approval.overdue:${a.id}:1:2026-01-06:${u}`, `approval.overdue:${a.id}:1:2026-01-07:${u}`])
        .sort(),
    );
  });

  it("a group assignee: the group's current approvers get the reminder, a non-approver member does not", async () => {
    const q = await setupApprovalWorld(api, w);
    const office = await signIn(api.app, w.office.subject);
    const g = await call<Body>(api.app, "POST", `/api/v1/organizations/${w.orgA.id}/groups`, {
      session: office,
      body: { code: `G${Date.now()}`, nameEn: "Synthetic owners", nameAr: "ملاك اصطناعيون", ownerUserId: w.office.id },
    });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    // bo2 holds BO (approval.decide) in q; fin is a member who holds FIN in p only, not in q (no approver there).
    for (const userId of [q.bo2.id, p.fin.id])
      expect(
        (await call(api.app, "POST", `/api/v1/groups/${g.body.id}/members`, { session: office, body: { userId } }))
          .status,
      ).toBe(201);
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
    const mapped = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/role-mappings`, {
      session: q.lead.session,
      body: { partyCode: "BO", targetKind: "group", groupId: g.body.id },
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
    const req = await call<Body>(api.app, "POST", `/api/v1/transformations/${q.transformationId}/approvals`, {
      session: q.lead.session,
      body: requestBody(q.decisionId, q.rights["target_state_design"]!),
    });
    expect([req.status, req.body.assignee.groupId]).toEqual([201, g.body.id]);
    await makeOverdue(api, req.body.id, "2026-01-08");
    await scan("rem-group-1");
    await scan("rem-group-2");
    const items = await itemsOf(req.body.id, "approval_overdue");
    expect(items.map((i) => i.assignee_user_id)).toEqual([q.lead.id, q.bo2.id].sort());
  });
});
