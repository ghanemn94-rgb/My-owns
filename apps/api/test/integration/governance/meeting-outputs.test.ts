// Meeting outputs linked to canonical records (ADR-0032 §4, §9, §11; REQ-PB-061; T-DG4-BE-F2) against a real
// PostgreSQL: the kind must be one of the forum's outputs (422 meeting_output.kind_not_in_forum); a record kind links
// a record of its types (422 meeting_output.record_required); the record exists in this transformation (422
// meeting_output.record_not_found); a kind without a record states a note (400); a type without its record (400);
// append-only (no update path; the table refuses UPDATE); audited; AUD 403, ADM-only and another organization 404;
// frozen with the meeting; commit-time 403. All data is SYNTHETIC; nothing here approves anything or touches DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type ForumKey, type MeetingWorld } from "./meeting-fixtures.ts";

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

async function meeting(forum: ForumKey): Promise<{ id: string; url: string }> {
  const c = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: { forumId: x.forums[forum], scheduledDate: plusDays(today, 6), startTime: "12:00", durationMinutes: 30 },
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  return { id: c.body.id, url: `${T()}/meetings/${c.body.id}` };
}

describe("createMeetingOutput and listMeetingOutputs (REQ-PB-061)", () => {
  it("links a canonical record of the forum's outputs; refuses another layer's kind, a wrong type and a foreign record", async () => {
    const m = await meeting("workstream_review");
    const O = `${m.url}/outputs`;
    const action = await send("POST", `${m.url}/actions`, {
      session: x.lead.session,
      body: { title: "Synthetic: fix the interface", ownerUserId: x.contributor.id },
    });
    const ok = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "action", recordType: "action_item", recordId: action.body.actionItemId },
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect([ok.body.outputKind, ok.body.recordType, ok.body.recordId, ok.body.note, ok.headers.location]).toEqual([
      "action",
      "action_item",
      action.body.actionItemId,
      null,
      O,
    ]);
    const audit = await auditOf(api.db, ok.body.id);
    expect([audit.map((e) => e.action), audit[0]!.changes]).toMatchObject([
      ["meeting_output.create"],
      { output_kind: { from: null, to: "action" }, record_id: { from: null, to: action.body.actionItemId } },
    ]);
    const kind = await send("POST", O, { session: x.lead.session, body: { outputKind: "forecast", note: "X" } });
    expect([kind.status, kind.body.code, kind.body.detail, kind.body.errors[0].pointer]).toEqual([
      422,
      "meeting_output.kind_not_in_forum",
      "forecast is not an output of this forum.",
      "/outputKind",
    ]);
    const noRecord = await send("POST", O, { session: x.lead.session, body: { outputKind: "milestone", note: "X" } });
    expect([noRecord.status, noRecord.body.code, noRecord.body.detail]).toEqual([
      422,
      "meeting_output.record_required",
      "This output links a record of type milestone.",
    ]);
    const wrongType = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "raid", recordType: "action_item", recordId: action.body.actionItemId },
    });
    expect([wrongType.status, wrongType.body.detail]).toEqual([
      422,
      "This output links a record of type raid_entry or dependency.",
    ]);
    const missing = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "action", recordType: "action_item", recordId: x.decisionId },
    });
    expect([missing.status, missing.body.code, missing.body.errors[0].pointer]).toEqual([
      422,
      "meeting_output.record_not_found",
      "/recordId",
    ]);
    const half = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "action", recordType: "action_item" },
    });
    expect([half.status, half.body.errors[0].code]).toEqual([400, "validation.record_pair"]);
    const list = await send("GET", O, { session: x.auditor.session });
    expect(list.body.items.map((o: Body) => o.id)).toEqual([ok.body.id]);
  });

  it("a kind without a record states a note; an agenda item named must be the meeting's; append-only", async () => {
    const m = await meeting("transformation_review");
    const O = `${m.url}/outputs`;
    const noNote = await send("POST", O, { session: x.lead.session, body: { outputKind: "integrated_status" } });
    expect([noNote.status, noNote.body.errors[0].pointer]).toEqual([400, "/note"]);
    const other = await meeting("transformation_review");
    const item = await send("POST", `${other.url}/agenda-items`, {
      session: x.lead.session,
      body: { itemKind: "discussion", title: "Synthetic" },
    });
    const foreignItem = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "integrated_status", note: "X", agendaItemId: item.body.id },
    });
    expect([foreignItem.status, foreignItem.body.errors[0].code]).toEqual([400, "validation.agenda_item_unknown"]);
    const ok = await send("POST", O, {
      session: x.lead.session,
      body: { outputKind: "decision_log", note: "Synthetic: no decision this cycle" },
    });
    expect([ok.status, ok.body.recordType, ok.body.recordId]).toEqual([201, null, null]);
    await expect(
      sql`UPDATE meeting_output SET note = 'changed' WHERE id = ${ok.body.id}::uuid`.execute(api.db),
    ).rejects.toThrow();
  });

  it("authorization: AUD 403; ADM-only and another organization 404; frozen; commit-time 403", async () => {
    const m = await meeting("transformation_review");
    const O = `${m.url}/outputs`;
    const body = { outputKind: "integrated_status", note: "Synthetic" };
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.admin, 404],
      [await signIn(api.app, w.officeB.subject), 404],
    ] as const) {
      expect((await send("POST", O, { session, body })).status).toBe(status);
      if (status === 404) expect((await send("GET", O, { session })).status).toBe(404);
    }
    const tl = await person(api, w, x.transformationId, "TL");
    const res = await afterIdentity(
      api,
      tl.id,
      () => call(api.app, "POST", O, { session: tl.session, body, contract: false }),
      () => revokeAll(api, w.grantor.id, tl.id),
    );
    expect(res.status).toBe(403);
    expect((await send("GET", O, { session: x.auditor.session })).body.items).toEqual([]);
    await send("POST", `${m.url}/cancel`, { session: x.lead.session, headers: ifm(1), body: { reason: "Synthetic" } });
    const frozen = await send("POST", O, { session: x.lead.session, body });
    expect([frozen.status, frozen.body.code]).toEqual([422, "meeting.frozen"]);
  });
});
