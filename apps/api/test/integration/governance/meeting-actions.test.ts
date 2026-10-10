// Meeting actions and My Work (ADR-0032 §5.4, §9, §11; T-DG4-BE-F2) against a real PostgreSQL:
//  - REQ-S10-011 A09 "actions appear in owners' My Work": an action assigned in a meeting appears in its owner's
//    listMyWorkItems (kind meeting_action_due, subject the action, due date the action's), once (createWorkItemOnce);
//  - the canonical action (person-authored, DG2 status open, no RAID source) and the append-only `assigned` link are
//    created and audited in one transaction; the action is listed in the action register;
//  - "monitor closure": listMeetingActions shows each action's current status and the overdue flag (due before today's
//    business date while open or in progress);
//  - validation (unknown owner 400), AUD 403, ADM-only and another organization 404, frozen, commit-time 403.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

async function meeting(): Promise<{ id: string; url: string }> {
  const c = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: {
      forumId: x.forums.workstream_review,
      scheduledDate: plusDays(today, 4),
      startTime: "08:30",
      durationMinutes: 45,
    },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id, url: `${T()}/meetings/${c.body.id}` };
}

/** Test clock: moves an action's due date into the past (version + 1 with an audit event, like an API change). */
async function backdate(actionId: string, dueDate: string): Promise<void> {
  await api.db.transaction().execute(async (tx) => {
    const a = await tx.selectFrom("action_item").selectAll().where("id", "=", actionId).executeTakeFirstOrThrow();
    await tx
      .updateTable("action_item")
      .set({ due_date: dueDate, version: sql<number>`version + 1` })
      .where("id", "=", actionId)
      .execute();
    await insertAuditEvent(
      tx,
      { actorType: "system", actorUserId: null, requestId: "test:action-clock", source: "api" },
      {
        action: "action_item.test_clock",
        recordType: "action_item",
        recordId: actionId,
        organizationId: a.organization_id,
        transformationId: a.transformation_id,
        priorVersion: a.version,
        newVersion: a.version + 1,
      },
    );
  });
}

describe("createMeetingAction (REQ-S10-011: actions appear in owners' My Work)", () => {
  it("the action, its link and the owner's My Work item are created in one transaction, audited", async () => {
    const m = await meeting();
    const due = plusDays(today, 9);
    const res = await send("POST", `${m.url}/actions`, {
      session: x.lead.session,
      body: { title: "Synthetic: confirm the cut-over plan", ownerUserId: x.contributor.id, dueDate: due },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body;
    expect([a.linkKind, a.meetingId, a.overdue, a.action.status, a.action.sourceKind, a.action.createdBy]).toEqual([
      "assigned",
      m.id,
      false,
      "open",
      "none",
      x.lead.id,
    ]);
    expect(res.headers.location).toBe(`${T()}/action-register/${a.actionItemId}`);
    const mine = await send("GET", "/api/v1/me/work-items?kind=meeting_action_due", { session: x.contributor.session });
    const item = mine.body.items.find((i: Body) => i.subjectId === a.actionItemId);
    expect([item.kind, item.subjectType, item.dueDate, item.status, item.messageKey]).toEqual([
      "meeting_action_due",
      "action_item",
      due,
      "open",
      "governance.task.meeting_action_due",
    ]);
    const others = await send("GET", "/api/v1/me/work-items?kind=meeting_action_due", { session: x.lead.session });
    expect(others.body.items.find((i: Body) => i.subjectId === a.actionItemId)).toBeUndefined();
    const register = await send("GET", `${T()}/action-register/${a.actionItemId}`, { session: x.auditor.session });
    expect([register.status, register.body.ownerUserId]).toEqual([200, x.contributor.id]);
    expect((await auditOf(api.db, a.actionItemId)).map((e) => e.action)).toEqual(["action_item.create"]);
    expect((await auditOf(api.db, a.id)).map((e) => e.action)).toEqual(["meeting_action_link.create"]);
    await expect(
      sql`UPDATE meeting_action_link SET link_kind = 'reviewed' WHERE id = ${a.id}::uuid`.execute(api.db),
    ).rejects.toThrow();
  });

  it("listMeetingActions shows each action's current status and overdue flag (monitor closure)", async () => {
    const m = await meeting();
    const one = await send("POST", `${m.url}/actions`, {
      session: x.lead.session,
      body: { title: "Synthetic: one", ownerUserId: x.lead.id, dueDate: plusDays(today, 3) },
    });
    const two = await send("POST", `${m.url}/actions`, {
      session: x.office.session,
      body: { title: "Synthetic: two", ownerUserId: x.contributor.id },
    });
    await backdate(one.body.actionItemId, plusDays(today, -2));
    const list = await send("GET", `${m.url}/actions`, { session: x.auditor.session });
    expect(list.body.items.map((i: Body) => [i.id, i.overdue, i.action.dueDate])).toEqual([
      [one.body.id, true, plusDays(today, -2)],
      [two.body.id, false, null],
    ]);
    const page = await send("GET", `${m.url}/actions?limit=1`, { session: x.auditor.session });
    const next = await send("GET", `${m.url}/actions?limit=1&cursor=${page.body.nextCursor}`, {
      session: x.auditor.session,
    });
    expect([page.body.items[0].id, next.body.items[0].id, next.body.nextCursor]).toEqual([
      one.body.id,
      two.body.id,
      null,
    ]);
  });

  it("validation, AUD 403, ADM-only and another organization 404, frozen, commit-time 403", async () => {
    const m = await meeting();
    const A = `${m.url}/actions`;
    const foreign = await send("POST", A, { session: x.lead.session, body: { title: "X", ownerUserId: w.officeB.id } });
    expect([foreign.status, foreign.body.errors[0].pointer]).toEqual([400, "/ownerUserId"]);
    const blank = await send("POST", A, { session: x.lead.session, body: { title: "   ", ownerUserId: x.lead.id } });
    expect(blank.status).toBe(400);
    const body = { title: "Synthetic", ownerUserId: x.lead.id };
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.sponsor.session, 403],
      [x.admin, 404],
      [await signIn(api.app, w.officeB.subject), 404],
    ] as const)
      expect((await send("POST", A, { session, body })).status).toBe(status);
    expect((await send("GET", A, { session: x.admin })).status).toBe(404);
    const tl = await person(api, w, x.transformationId, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () => call(api.app, "POST", A, { session: tl.session, body, contract: false }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect((await send("GET", A, { session: x.auditor.session })).body.items).toEqual([]);
    await send("POST", `${m.url}/cancel`, { session: x.lead.session, headers: ifm(1), body: { reason: "Synthetic" } });
    const frozen = await send("POST", A, { session: x.lead.session, body });
    expect([frozen.status, frozen.body.code]).toEqual([422, "meeting.frozen"]);
  });
});
