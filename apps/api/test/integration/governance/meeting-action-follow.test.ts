// Meeting actions after ADR-0032 amendment G1 (T-DG4-BE-R3) against a real PostgreSQL:
//  - G1 item 4: governance writes the action through raid's insertActionItem. The `action_item` row and its
//    `action_item.create` audit event are exactly those BE-F2's copy wrote (explicit expectations here; and, when
//    MTH_BE_R3_MEETING_ACTION_TRANSCRIPT is set, a normalized transcript for the A/B byte comparison against the base
//    commit's meeting-actions.ts, in the handback). The meeting action still gets exactly one task, its own.
//  - BE-F2 handback §8 item 1: a meeting action whose owner or due date changes, or which closes, through raid's
//    action register (PATCH /action-register/{id}) or the DG2 path (PATCH /actions/{id}) updates its
//    `meeting_action_due` item through BE-R1's reassign, reschedule and close services; other actions are untouched.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { responseTranscript, transcriptNormalizer } from "../../support/response-transcript.ts";
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

async function meeting(): Promise<{ id: string; url: string; date: string }> {
  const date = plusDays(today, 4);
  const c = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: { forumId: x.forums.workstream_review, scheduledDate: date, startTime: "08:30", durationMinutes: 45 },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id, url: `${T()}/meetings/${c.body.id}`, date };
}

const TITLE = "Synthetic: confirm the cut-over plan";

async function meetingAction(owner = x.contributor.id, dueDate: string | undefined = plusDays(today, 9)) {
  const m = await meeting();
  const res = await send("POST", `${m.url}/actions`, {
    session: x.lead.session,
    body: { title: TITLE, ownerUserId: owner, ...(dueDate !== undefined ? { dueDate } : {}) },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { meeting: m, actionId: res.body.actionItemId as string, linkId: res.body.id as string };
}

/** Every work item of the action, oldest first. */
async function itemsOf(actionId: string) {
  return api.db
    .selectFrom("work_item")
    .select([
      "id",
      "kind",
      "assignee_user_id",
      "status",
      "due_date",
      "dedupe_key",
      "message_key",
      "message_params",
      "link_path",
    ])
    .where("subject_type", "=", "action_item")
    .where("subject_id", "=", actionId)
    .orderBy("id")
    .execute();
}

const version = async (actionId: string) =>
  (await api.db.selectFrom("action_item").select("version").where("id", "=", actionId).executeTakeFirstOrThrow())
    .version;

type Path = "raid" | "dg2";
const PATHS: readonly Path[] = ["raid", "dg2"];
/** PATCH through raid's action register or the DG2 /actions path, as the lead (action.edit), with If-Match. */
async function patch(path: Path, actionId: string, body: Record<string, unknown>) {
  const url = path === "raid" ? `${T()}/action-register/${actionId}` : `${T()}/actions/${actionId}`;
  const res = await send("PATCH", url, { session: x.lead.session, headers: ifm(await version(actionId)), body });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res;
}

// ------------------------------------------------------------------------------------------------ G1: one insert

describe("ADR-0032 G1: governance writes the meeting action through raid's insertActionItem", () => {
  it("the action_item row and its action_item.create event are BE-F2's, field for field; one task, its own", async () => {
    const due = plusDays(today, 9);
    const { actionId, meeting: m } = await meetingAction(x.contributor.id, due);
    const row = await api.db.selectFrom("action_item").selectAll().where("id", "=", actionId).executeTakeFirstOrThrow();
    expect({
      organization_id: row.organization_id,
      transformation_id: row.transformation_id,
      title: row.title,
      description: row.description,
      owner_user_id: row.owner_user_id,
      due_date: row.due_date,
      follow_up_date: row.follow_up_date,
      status: row.status,
      raid_entry_id: row.raid_entry_id,
      dependency_id: row.dependency_id,
      corrective_case_id: row.corrective_case_id,
      source_workshop_item_id: row.source_workshop_item_id,
      created_by: row.created_by,
      updated_by: row.updated_by,
      version: row.version,
    }).toEqual({
      organization_id: w.orgA.id,
      transformation_id: x.transformationId,
      title: TITLE,
      description: null,
      owner_user_id: x.contributor.id,
      due_date: due,
      follow_up_date: null,
      status: "open",
      raid_entry_id: null,
      dependency_id: null,
      corrective_case_id: null,
      source_workshop_item_id: null,
      created_by: x.lead.id,
      updated_by: x.lead.id,
      version: 1,
    });
    const events = await auditOf(api.db, actionId);
    expect(events.map((e) => [e.action, e.record_type, e.prior_version, e.new_version, e.actor_user_id])).toEqual([
      ["action_item.create", "action_item", null, 1, x.lead.id],
    ]);
    // BE-F2's diff: null-to-null fields omitted (jsonb keeps no key order; the A/B transcript compares stored bytes).
    expect(events[0]!.changes).toEqual({
      title: { from: null, to: TITLE },
      owner_user_id: { from: null, to: x.contributor.id },
      due_date: { from: null, to: due },
      status: { from: null, to: "open" },
    });
    const items = await itemsOf(actionId);
    expect(items.map((i) => [i.kind, i.assignee_user_id, i.status, i.due_date, i.dedupe_key])).toEqual([
      ["meeting_action_due", x.contributor.id, "open", due, `meeting.action:${actionId}:${x.contributor.id}`],
    ]);
    expect([items[0]!.message_key, items[0]!.message_params, items[0]!.link_path]).toEqual([
      "governance.task.meeting_action_due",
      { title: TITLE, meetingDate: m.date },
      `/transformations/${x.transformationId}/meetings/${m.id}`,
    ]);
    // The owner check and refusal stay governance's own.
    const unknown = await send("POST", `${m.url}/actions`, {
      session: x.lead.session,
      body: { title: TITLE, ownerUserId: "01890000-0000-7000-8000-000000000000" },
    });
    expect([unknown.status, unknown.body.errors?.[0]?.code, unknown.body.errors?.[0]?.pointer]).toEqual([
      400,
      "validation.user_unknown",
      "/ownerUserId",
    ]);
  });

  it("A/B transcript: the row and the create event of a fixed input (normalized), when enabled", async () => {
    const t = responseTranscript(call, "MTH_BE_R3_MEETING_ACTION_TRANSCRIPT");
    const norm = transcriptNormalizer();
    for (const [owner, due, description] of [
      [x.contributor.id, plusDays(today, 9), undefined],
      [x.office.id, undefined, "Synthetic: with a description"],
    ] as const) {
      const m = await meeting();
      const res = await t.call(api.app, "POST", `${m.url}/actions`, {
        session: x.lead.session,
        body: {
          title: TITLE,
          ownerUserId: owner,
          ...(due !== undefined ? { dueDate: due } : {}),
          ...(description !== undefined ? { description } : {}),
        },
      });
      expect(res.status).toBe(201);
      const id = (res.body as Body).actionItemId as string;
      const row = await api.db.selectFrom("action_item").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
      const events = (await auditOf(api.db, id)).map(({ id: _i, seq: _s, occurred_at: _o, request_id: _r, ...e }) => e);
      t.note("action_item row", { status: 0, headers: {}, body: JSON.parse(norm(JSON.stringify(row))) });
      t.note("action_item audit", {
        status: 0,
        headers: {},
        body: { events: JSON.parse(norm(JSON.stringify(events))) },
      });
      t.note("work items", {
        status: 0,
        headers: {},
        body: { items: JSON.parse(norm(JSON.stringify(await itemsOf(id)))) },
      });
    }
    t.flush();
  });
});

// ------------------------------------------------------------------------------------------------ §8: the item follows

describe("BE-F2 §8: a meeting action's My Work item follows edits through raid and the DG2 /actions path", () => {
  for (const path of PATHS) {
    it(`${path}: an owner change cancels the previous owner's item and opens the new owner's (A -> B -> A: #2)`, async () => {
      const due = plusDays(today, 9);
      const { actionId, meeting: m } = await meetingAction(x.contributor.id, due);
      await patch(path, actionId, { ownerUserId: x.office.id });
      let items = await itemsOf(actionId);
      expect(items.map((i) => [i.assignee_user_id, i.status, i.dedupe_key, i.due_date])).toEqual([
        [x.contributor.id, "cancelled", `meeting.action:${actionId}:${x.contributor.id}`, due],
        [x.office.id, "open", `meeting.action:${actionId}:${x.office.id}`, due],
      ]);
      expect([items[1]!.kind, items[1]!.message_key, items[1]!.message_params, items[1]!.link_path]).toEqual([
        "meeting_action_due",
        "governance.task.meeting_action_due",
        { title: TITLE, meetingDate: m.date },
        `/transformations/${x.transformationId}/meetings/${m.id}`,
      ]);
      const cancelEvents = (await auditOf(api.db, items[0]!.id)).map((e) => [e.action, e.reason]);
      expect(cancelEvents).toContainEqual(["work_item.cancel", "reassigned"]);
      // The new owner sees it in My Work; the previous owner no longer does.
      const mine = await send("GET", "/api/v1/me/work-items?kind=meeting_action_due&status=open", {
        session: x.office.session,
      });
      expect(mine.body.items.map((i: Body) => i.subjectId)).toContain(actionId);
      const theirs = await send("GET", "/api/v1/me/work-items?kind=meeting_action_due&status=open", {
        session: x.contributor.session,
      });
      expect(theirs.body.items.map((i: Body) => i.subjectId)).not.toContain(actionId);

      await patch(path, actionId, { ownerUserId: x.contributor.id });
      items = await itemsOf(actionId);
      expect(items.filter((i) => i.status === "open").map((i) => [i.assignee_user_id, i.dedupe_key])).toEqual([
        [x.contributor.id, `meeting.action:${actionId}:${x.contributor.id}#2`],
      ]);
      expect(items.length).toBe(3);
    });

    it(`${path}: a due-date change moves the open item's due date (work_item.reschedule)`, async () => {
      const { actionId } = await meetingAction(x.contributor.id, plusDays(today, 9));
      const later = plusDays(today, 20);
      await patch(path, actionId, { dueDate: later });
      const items = await itemsOf(actionId);
      expect(items.map((i) => [i.assignee_user_id, i.status, i.due_date])).toEqual([[x.contributor.id, "open", later]]);
      const events = await auditOf(api.db, items[0]!.id);
      const moved = events.find((e) => e.action === "work_item.reschedule")!;
      expect((moved.changes as Body).due_date).toEqual({ from: plusDays(today, 9), to: later });
      // Owner and due date in one edit: the new owner's item carries the new date, the old one is cancelled.
      const both = plusDays(today, 30);
      await patch(path, actionId, { ownerUserId: x.office.id, dueDate: both });
      expect((await itemsOf(actionId)).map((i) => [i.assignee_user_id, i.status, i.due_date])).toEqual([
        [x.contributor.id, "cancelled", later],
        [x.office.id, "open", both],
      ]);
    });

    it(`${path}: done closes the item as done; cancelled closes it as cancelled; a title edit changes nothing`, async () => {
      const done = await meetingAction();
      await patch(path, done.actionId, { title: "Synthetic: renamed" });
      expect((await itemsOf(done.actionId)).map((i) => i.status)).toEqual(["open"]);
      await patch(path, done.actionId, { status: "done" });
      expect((await itemsOf(done.actionId)).map((i) => i.status)).toEqual(["done"]);
      const cancelled = await meetingAction();
      await patch(path, cancelled.actionId, { status: "in_progress" });
      expect((await itemsOf(cancelled.actionId)).map((i) => i.status)).toEqual(["open"]);
      await patch(path, cancelled.actionId, { status: "cancelled" });
      expect((await itemsOf(cancelled.actionId)).map((i) => i.status)).toEqual(["cancelled"]);
    });
  }

  it("an action that is not a meeting action gets no meeting item from these edits (DG2 action, both paths)", async () => {
    const created = await send("POST", `${T()}/actions`, {
      session: x.lead.session,
      body: { title: "Synthetic: a DG2 action", ownerUserId: x.contributor.id, dueDate: plusDays(today, 9) },
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    await patch("dg2", id, { ownerUserId: x.office.id, dueDate: plusDays(today, 12) });
    await patch("raid", id, { ownerUserId: x.contributor.id });
    await patch("dg2", id, { status: "done" });
    expect(await itemsOf(id)).toEqual([]);
  });

  it("a refused edit (stale If-Match, AUD) moves nothing", async () => {
    const { actionId } = await meetingAction();
    const before = await itemsOf(actionId);
    const stale = await send("PATCH", `${T()}/actions/${actionId}`, {
      session: x.lead.session,
      headers: ifm(9),
      body: { ownerUserId: x.office.id },
    });
    expect(stale.status).toBe(409);
    const aud = await send("PATCH", `${T()}/action-register/${actionId}`, {
      session: x.auditor.session,
      headers: ifm(1),
      body: { ownerUserId: x.office.id },
    });
    expect(aud.status).toBe(403);
    expect(await itemsOf(actionId)).toEqual(before);
  });
});
