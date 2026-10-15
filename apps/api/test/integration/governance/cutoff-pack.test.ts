// Meeting cut-off draft agenda and pack (ADR-0044 §6, §9, §10; REQ-S12-015, M0235; p5-work-split §E.4; T-DG5-BE-L2)
// against a real PostgreSQL. The literal tests of §E.4:
//  - cut-off creates ONE draft agenda containing the current open asks, and only those (an ask already on the agenda
//    and a non-executive decision are left out; an ask raised after the cut-off scan is not in the snapshot);
//  - a second scan creates nothing (the runOnce ledger and UNIQUE meeting_cutoff_pack_once_key);
//  - publishing one of its items before review -> 422 agenda_item.pack_not_reviewed, nothing written;
//  - after the chair reviews, the chair publishes;
//  - a non-chair/secretary reviewing -> 403 meeting_cutoff_pack.not_reviewer; AUD 403;
//  - DG4 agenda items outside packs publish as before (regression), even while the meeting's pack is a draft.
// Also: the secretary (meeting.prepare) reviews; a secretary without meeting.prepare is refused; If-Match 428/409;
// 422 already_reviewed; one audit event per write; the chair's meeting_pack_review work item (closed by the review);
// no chair and no secretary -> no work item and reviewerAssigned false; meetings not due get no pack; the API
// generation service and the worker job write the same rows (parity, ADR-0002 rule 5); the worker registers the scan
// on its own queue as starter 12. All data is SYNTHETIC; a pack review is a human action, not a G1-G6 business
// approval, and nothing touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { STARTER_RULE_BY_QUEUE } from "../../../../worker/src/automation/starters.ts";
import {
  generateCutoffPackInTx as workerGenerate,
  handleMeetingCutoffScan,
  MEETING_CUTOFF_SCAN_QUEUE,
  MEETINGS_HANDLERS,
} from "../../../../worker/src/handlers/meetings.ts";
import { DOMAIN_HANDLERS } from "../../../../worker/src/handlers/index.ts";
import { DOMAIN_QUEUES } from "../../../../worker/src/queues/index.ts";
import { generateCutoffPackInTx as apiGenerate } from "../../../src/modules/governance/cut-off.ts";
import { auditOf, call, seedWorld, signIn, startApi, uniq, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";
import { raiseAsk } from "./t16-fixtures.ts";

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

/** An ad-hoc Executive SteerCo meeting `days` ahead (default tomorrow: its 2-working-day cut-off has passed). */
async function meeting(extra: Record<string, unknown> = {}, days = 1): Promise<{ id: string; url: string }> {
  const res = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: {
      forumId: x.forums.executive_steerco,
      scheduledDate: plusDays(today, days),
      startTime: "09:00",
      durationMinutes: 60,
      ...extra,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return { id: res.body.id, url: `${T()}/meetings/${res.body.id}` };
}

const scan = (meetingIds: readonly string[], job = uniq("job:be-l2-")) =>
  handleMeetingCutoffScan(api.db, null, job, { meetingIds });

async function packRow(meetingId: string) {
  return api.db.selectFrom("meeting_cutoff_pack").selectAll().where("meeting_id", "=", meetingId).executeTakeFirst();
}

async function itemsOf(meetingId: string) {
  return api.db.selectFrom("agenda_item").selectAll().where("meeting_id", "=", meetingId).orderBy("ordinal").execute();
}

async function openAskIds(): Promise<string[]> {
  const rows = await api.db
    .selectFrom("decision")
    .select("id")
    .where("transformation_id", "=", x.transformationId)
    .where("kind", "=", "executive")
    .where("ask_origin", "is not", null)
    .where("status", "in", ["open", "deferred"])
    .execute();
  return rows.map((r) => r.id).sort();
}

async function reviewWorkItems(packId: string) {
  return api.db
    .selectFrom("work_item")
    .selectAll()
    .where("subject_type", "=", "meeting_cutoff_pack")
    .where("subject_id", "=", packId)
    .execute();
}

const note = { note: "Synthetic: checked against the T16 log" };

describe("REQ-S12-015: the cut-off creates one draft agenda containing the current open asks (and only those)", () => {
  it("one pack, one draft executive-ask item per open ask not yet on the agenda; a second scan creates nothing", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 20));
    const m = await meeting();
    // One open ask is already on this meeting's agenda (DG4 link): it must not be added twice.
    const onAgenda = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 25));
    const linked = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic: already linked", decisionId: onAgenda.id },
    });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    const expected = (await openAskIds()).filter((id) => id !== onAgenda.id);
    expect(expected.length).toBeGreaterThanOrEqual(2);

    const first = await scan([m.id]);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ meetingId: m.id, outcome: "generated" });
    const pack = (await packRow(m.id))!;
    expect(pack).toMatchObject({ status: "draft", version: 1, reviewed_by: null });
    const snapshot = pack.open_asks as { decisionId: string; agendaItemId: string | null }[];
    // Only the current open asks, and the design decision of the approval world (kind 'design') is not one.
    expect(snapshot.map((a) => a.decisionId).sort()).toEqual(expected);
    expect(snapshot.map((a) => a.decisionId)).not.toContain(x.decisionId);
    const items = await itemsOf(m.id);
    const generated = items.filter((i) => pack.agenda_item_ids.includes(i.id));
    expect(generated).toHaveLength(expected.length);
    expect(generated.every((i) => i.status === "draft" && i.item_kind === "executive_ask")).toBe(true);
    expect(generated.map((i) => i.decision_id).sort()).toEqual(expected);
    expect(snapshot.map((a) => a.agendaItemId).sort()).toEqual([...pack.agenda_item_ids].sort());
    // Next free ordinals after the existing item.
    expect(generated.map((i) => i.ordinal)).toEqual(generated.map((_, k) => 2 + k));
    // Audited: one create per item and the pack.
    for (const i of generated)
      expect((await auditOf(api.db, i.id)).map((e) => e.action)).toEqual(["agenda_item.create"]);
    expect((await auditOf(api.db, pack.id)).map((e) => e.action)).toEqual(["meeting_cutoff_pack.create"]);

    // A second scan (and a third, concurrently) creates nothing.
    const second = await scan([m.id]);
    expect(second).toEqual([]);
    await Promise.all([scan([m.id]), scan([m.id])]);
    expect(await itemsOf(m.id)).toHaveLength(items.length);
    const packs = await api.db.selectFrom("meeting_cutoff_pack").select("id").where("meeting_id", "=", m.id).execute();
    expect(packs).toHaveLength(1);

    // An ask raised after the cut-off is not added to the snapshot (content never changes, MP05).
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 30));
    expect(await scan([m.id])).toEqual([]);
    expect(((await packRow(m.id))!.open_asks as unknown[]).length).toBe(expected.length);
  });

  it("the chair gets one meeting_pack_review work item; the GET reads the pack (AUD reads it too)", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    const pack = (await packRow(m.id))!;
    const tasks = await reviewWorkItems(pack.id);
    expect(tasks.map((t) => [t.kind, t.assignee_user_id, t.status, t.message_key])).toEqual([
      ["meeting_pack_review", x.sponsor.id, "open", "governance.task.meeting_pack_review"],
    ]);
    const res = await send("GET", `${m.url}/cutoff-pack`, { session: x.lead.session });
    expect(res.status).toBe(200);
    expect(res.headers.etag).toBe('"1"');
    expect(res.body).toMatchObject({ id: pack.id, meetingId: m.id, status: "draft", reviewerAssigned: true });
    expect((await send("GET", `${m.url}/cutoff-pack`, { session: x.auditor.session })).status).toBe(200);
  });

  it("meetings not due get no pack: cut-off in the future, or the meeting already past", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 40));
    const later = await meeting({}, 30);
    expect(await scan([later.id])).toEqual([]);
    expect(await packRow(later.id)).toBeUndefined();
    expect((await send("GET", `${later.url}/cutoff-pack`, { session: x.lead.session })).status).toBe(404);
  });

  it("no chair and no secretary: the pack is generated without a work item and reads reviewerAssigned false", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting({ chairUserId: null, secretaryUserId: null });
    await scan([m.id]);
    const pack = (await packRow(m.id))!;
    expect(await reviewWorkItems(pack.id)).toEqual([]);
    const res = await send("GET", `${m.url}/cutoff-pack`, { session: x.lead.session });
    expect(res.body.reviewerAssigned).toBe(false);
  });
});

describe("REQ-S12-015: review before publication", () => {
  it("publishing a pack item before review -> 422 agenda_item.pack_not_reviewed; after the chair reviews, the chair publishes", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    const pack = (await packRow(m.id))!;
    const itemId = pack.agenda_item_ids[0]!;
    const refused = await send("POST", `${m.url}/agenda-items/${itemId}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect([refused.status, refused.body.code, refused.body.detail]).toEqual([
      422,
      "agenda_item.pack_not_reviewed",
      "Review the meeting's cut-off pack before publishing its items.",
    ]);
    const unchanged = await api.db
      .selectFrom("agenda_item")
      .selectAll()
      .where("id", "=", itemId)
      .executeTakeFirstOrThrow();
    expect([unchanged.status, unchanged.version]).toEqual(["draft", 1]);
    expect((await auditOf(api.db, itemId)).map((e) => e.action)).toEqual(["agenda_item.create"]);

    // The chair reviews (If-Match), then publishes the same item.
    const reviewed = await send("POST", `${m.url}/cutoff-pack/review`, {
      session: x.sponsor.session,
      headers: ifm(1),
      body: note,
    });
    expect(reviewed.status, JSON.stringify(reviewed.body)).toBe(200);
    expect(reviewed.headers.etag).toBe('"2"');
    expect(reviewed.body).toMatchObject({
      status: "reviewed",
      reviewedBy: x.sponsor.id,
      reviewNote: note.note,
      version: 2,
    });
    const events = await auditOf(api.db, pack.id);
    expect(events.map((e) => e.action)).toEqual(["meeting_cutoff_pack.create", "meeting_cutoff_pack.review"]);
    expect((await reviewWorkItems(pack.id)).map((t) => t.status)).toEqual(["done"]);
    const published = await send("POST", `${m.url}/agenda-items/${itemId}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect([published.status, published.body.status]).toEqual([200, "published"]);
    // A second review is refused.
    const again = await send("POST", `${m.url}/cutoff-pack/review`, {
      session: x.sponsor.session,
      headers: ifm(2),
      body: {},
    });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "meeting_cutoff_pack.already_reviewed",
      "This pack is already reviewed.",
    ]);
  });

  it("DG4 regression: an agenda item outside the pack publishes as before while the pack is still a draft", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    expect((await packRow(m.id))!.status).toBe("draft");
    const outside = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 18));
    const item = await send("POST", `${m.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "executive_ask", title: "Synthetic: outside the pack", decisionId: outside.id },
    });
    expect(item.status, JSON.stringify(item.body)).toBe(201);
    const pub = await send("POST", `${m.url}/agenda-items/${item.body.id}/publish`, {
      session: x.sponsor.session,
      headers: ifm(1),
    });
    expect([pub.status, pub.body.status]).toEqual([200, "published"]);
  });

  it("a non-chair/secretary reviewing -> 403 meeting_cutoff_pack.not_reviewer; AUD 403; nothing written", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    const pack = (await packRow(m.id))!;
    // WL holds meeting.chair but is not this meeting's chair; TL holds meeting.prepare but is not its secretary.
    for (const s of [x.contributor.session, x.lead.session, x.auditor.session]) {
      const res = await send("POST", `${m.url}/cutoff-pack/review`, { session: s, headers: ifm(1), body: note });
      expect([res.status, res.body.code, res.body.detail]).toEqual([
        403,
        "meeting_cutoff_pack.not_reviewer",
        "Only the meeting's chair or secretary can review its pack.",
      ]);
    }
    const row = (await packRow(m.id))!;
    expect([row.status, row.version]).toEqual(["draft", 1]);
    expect((await auditOf(api.db, pack.id)).map((e) => e.action)).toEqual(["meeting_cutoff_pack.create"]);
  });

  it("the secretary with meeting.prepare reviews; a secretary without meeting.prepare is refused", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const withPrepare = await meeting({ chairUserId: null, secretaryUserId: x.lead.id });
    await scan([withPrepare.id]);
    expect((await reviewWorkItems((await packRow(withPrepare.id))!.id)).map((t) => t.assignee_user_id)).toEqual([
      x.lead.id,
    ]);
    const ok = await send("POST", `${withPrepare.url}/cutoff-pack/review`, {
      session: x.lead.session,
      headers: ifm(1),
      body: {},
    });
    expect([ok.status, ok.body.status, ok.body.reviewedBy, ok.body.reviewNote]).toEqual([
      200,
      "reviewed",
      x.lead.id,
      null,
    ]);
    // A BO (meeting.chair only, no meeting.prepare) named secretary cannot review.
    const bo = await person(api, w, x.transformationId, "BO");
    const without = await meeting({ chairUserId: null, secretaryUserId: bo.id });
    await scan([without.id]);
    const res = await send("POST", `${without.url}/cutoff-pack/review`, {
      session: bo.session,
      headers: ifm(1),
      body: {},
    });
    expect([res.status, res.body.code]).toEqual([403, "meeting_cutoff_pack.not_reviewer"]);
  });

  it("If-Match: missing -> 428, stale -> 409; invalid note -> 400; another organization -> 404", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    const url = `${m.url}/cutoff-pack/review`;
    expect((await send("POST", url, { session: x.sponsor.session, body: note })).status).toBe(428);
    const stale = await send("POST", url, { session: x.sponsor.session, headers: ifm(3), body: note });
    expect(stale.status).toBe(409);
    const bad = await send("POST", url, { session: x.sponsor.session, headers: ifm(1), body: { note: "  " } });
    expect(bad.status).toBe(400);
    const unknown = await send("POST", url, { session: x.sponsor.session, headers: ifm(1), body: { extra: 1 } });
    expect(unknown.status).toBe(400);
    const officeB = await signIn(api.app, w.officeB.subject);
    expect((await send("POST", url, { session: officeB, headers: ifm(1), body: note })).status).toBe(404);
    expect((await send("GET", `${m.url}/cutoff-pack`, { session: officeB })).status).toBe(404);
    expect((await packRow(m.id))!.version).toBe(1);
  });

  it("the database refuses publishing a pack item before review even past the API (trigger agenda_item_cutoff_review)", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const m = await meeting();
    await scan([m.id]);
    const itemId = (await packRow(m.id))!.agenda_item_ids[0]!;
    await expect(
      api.db
        .updateTable("agenda_item")
        .set({ status: "published", published_at: new Date(), published_by: x.sponsor.id, version: 2 })
        .where("id", "=", itemId)
        .execute(),
    ).rejects.toThrow(/cut-off pack of this item is not reviewed/);
  });
});

describe("generation: the API service and the worker job write the same rows; the worker registration", () => {
  it("parity (ADR-0002 rule 5): same asks, items, pack fields, work item and audit actions", async () => {
    await raiseAsk(send, x, x.sponsor.id, plusDays(today, 15));
    const a = await meeting();
    const b = await meeting();
    const actor = { actorType: "service", actorUserId: null, requestId: "job:parity-api", source: "worker" } as const;
    const viaApi = await api.db.transaction().execute((tx) => apiGenerate(tx, actor, a.id));
    const viaWorker = await api.db.transaction().execute((tx) => workerGenerate(tx, "parity-worker", b.id));
    const shape = async (meetingId: string, packId: string) => {
      const p = (await packRow(meetingId))!;
      const items = (await itemsOf(meetingId)).filter((i) => p.agenda_item_ids.includes(i.id));
      const tasks = await reviewWorkItems(packId);
      const audit = await api.db
        .selectFrom("audit_event")
        .select(["action", "actor_type", "on_behalf_of_user_id", "source"])
        .where("record_id", "in", [packId, ...p.agenda_item_ids, ...tasks.map((t) => t.id)])
        .orderBy("seq")
        .execute();
      return {
        status: p.status,
        cutoff: String(p.cutoff_date),
        asks: (p.open_asks as { decisionId: string; code: string; status: string }[]).map((o) => [
          o.decisionId,
          o.code,
          o.status,
        ]),
        items: items.map((i) => [i.item_kind, i.title, i.decision_id, i.status, i.late, i.created_by]),
        tasks: tasks.map((t) => [t.kind, t.assignee_user_id, t.message_key, t.message_params, t.due_date]),
        audit: audit.map((e) => [e.action, e.actor_type, e.on_behalf_of_user_id, e.source]),
      };
    };
    expect(viaApi.agendaItemIds.length).toBe(viaWorker.agendaItemIds.length);
    const left = await shape(a.id, viaApi.packId);
    const right = await shape(b.id, viaWorker.packId);
    // The two meetings fall on the same date with the same forum, so the rows are equal field by field.
    expect(left).toEqual(right);
    expect(left.audit.length).toBeGreaterThan(2);
  });

  it("the worker runs governance.meeting_cutoff_scan on its own queue, wrapped as starter 12 (starter.meeting_cutoff)", () => {
    expect(MEETINGS_HANDLERS.map((h) => h.queue)).toContain(MEETING_CUTOFF_SCAN_QUEUE);
    expect(DOMAIN_HANDLERS.filter((h) => h.queue === MEETING_CUTOFF_SCAN_QUEUE)).toHaveLength(1);
    expect(DOMAIN_QUEUES.map((q) => q.name)).toContain(MEETING_CUTOFF_SCAN_QUEUE);
    expect(STARTER_RULE_BY_QUEUE[MEETING_CUTOFF_SCAN_QUEUE]).toBe("starter.meeting_cutoff");
    // Wrapped: the registered handler is not the bare one.
    const bare = MEETINGS_HANDLERS.find((h) => h.queue === MEETING_CUTOFF_SCAN_QUEUE)!.handle;
    expect(DOMAIN_HANDLERS.find((h) => h.queue === MEETING_CUTOFF_SCAN_QUEUE)!.handle).not.toBe(bare);
  });
});
