// Blocker RAG by cycle (ADR-0032 §8.2, §8.3, §9, §11; REQ-PB-082 "RAG history by cycle"; T-DG4-BE-G) against a real
// PostgreSQL:
//  - recordBlockerStatus (meeting.prepare: TL, TO): one observation per meeting (cycle) and blocker, in a meeting that
//    is in session or held; the forum and cycle date are the meeting's own; append-only; audited; the outbox event
//    `blocker_status.recorded` (payload and idempotency key of ADR-0032 §8.3) in the same transaction;
//  - refusals: 409 blocker_status.exists, 422 meeting.not_in_session (scheduled), 422 meeting.frozen (cancelled), 422
//    blocker_status.record_not_found, 400 validation; AUD and SP 403, ADM-only and another organization 404;
//  - a person may link an ask to a blocker on createExecutiveDecision; a second open ask for it is 409
//    executive_decision.blocker_ask_open (the API side of "without duplicating an existing open ask");
//  - commit-time authorization of recordBlockerStatus (a grant revoked while the request waits: 403, nothing written);
//  - D-102 parity: the worker's twins (apps/worker/src/handlers/escalations.ts; ADR-0002 rule 5 forbids it importing
//    API code) give the same answers as the API services for the same input: resolveParty, the executive check of an
//    owner or escalation target (holdsExecutiveDecide) and the DEC-nn code sequence (workflows' nextCode, the T16
//    allocator nextDecisionCode and the worker's twin share one counter and one format).
// The red-cycles rule itself is proven with the worker's real consumer in apps/worker/test/integration/
// blocker-escalation.test.ts. All data is SYNTHETIC; nothing touches the engineering gates DG0-DG7.
import { sql } from "@mth/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  executivesAmong,
  nextDecisionCode,
  resolveParty as workerResolveParty,
} from "../../../../worker/src/handlers/escalations.ts";
import { resolveParty, resolveTarget } from "../../../src/modules/access/index.ts";
import {
  holdsExecutiveDecide,
  nextDecisionCode as apiNextDecisionCode,
} from "../../../src/modules/governance/executive-decisions.ts";
import { nextCode } from "../../../src/modules/workflows/codes.ts";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { person } from "../approvals/approval-world.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";
import { askBody, createBlockerRisk, createForum, envelopeOf, meetingInSession } from "./t16-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
let risk: string;
let forumId: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
  risk = await createBlockerRisk(send, x);
  forumId = await createForum(send, x);
}, 120_000);
afterAll(() => api.close());

const S = (meetingId: string) => `/api/v1/transformations/${x.transformationId}/meetings/${meetingId}/blocker-statuses`;
const red = () => ({
  sourceRecordType: "raid_entry",
  sourceRecordId: risk,
  rag: "red",
  note: "Synthetic: still blocked",
});

describe("recordBlockerStatus and listBlockerStatuses (ADR-0032 §8.2)", () => {
  it("records one RAG per cycle with its audit event and the blocker_status.recorded outbox event", async () => {
    const meetingId = await meetingInSession(send, x, forumId, plusDays(today, 2));
    const res = await send("POST", S(meetingId), { session: x.lead.session, body: red() });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(res.body).toMatchObject({
      meetingId,
      forumId,
      cycleDate: plusDays(today, 2),
      sourceRecordType: "raid_entry",
      sourceRecordId: risk,
      rag: "red",
      note: "Synthetic: still blocked",
      createdBy: x.lead.id,
    });
    expect((await auditOf(api.db, res.body.id)).map((e) => [e.action, e.actor_user_id])).toEqual([
      ["blocker_status.create", x.lead.id],
    ]);
    const env = await envelopeOf(api.db, res.body.id);
    expect([env.eventType, env.schemaVersion, env.idempotencyKey]).toEqual([
      "blocker_status.recorded",
      1,
      `blocker_status.recorded:${res.body.id}`,
    ]);
    expect(env.payload).toEqual({
      blockerStatusId: res.body.id,
      transformationId: x.transformationId,
      forumId,
      meetingId,
      cycleDate: plusDays(today, 2),
      sourceRecordType: "raid_entry",
      sourceRecordId: risk,
      rag: "red",
    });
    const dup = await send("POST", S(meetingId), { session: x.office.session, body: { ...red(), rag: "green" } });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "blocker_status.exists",
      "A RAG for this blocker is already recorded in this meeting.",
    ]);
    const list = await send("GET", S(meetingId), { session: x.auditor.session });
    expect([list.status, list.body.items.map((i: Body) => i.rag), list.body.nextCursor]).toEqual([200, ["red"], null]);
  });

  it("refusals: not in session, a frozen meeting, an unknown blocker, a bad body; nothing written", async () => {
    const T = `/api/v1/transformations/${x.transformationId}/meetings`;
    const scheduled = await send("POST", T, {
      session: x.lead.session,
      body: { forumId, scheduledDate: plusDays(today, 9), startTime: "09:00", durationMinutes: 60 },
    });
    const notIn = await send("POST", S(scheduled.body.id), { session: x.lead.session, body: red() });
    expect([notIn.status, notIn.body.code, notIn.body.detail]).toEqual([
      422,
      "meeting.not_in_session",
      "Decisions and blocker status are recorded while the meeting is in session or held.",
    ]);
    await send("POST", `${T}/${scheduled.body.id}/cancel`, {
      session: x.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: no longer needed" },
    });
    const frozen = await send("POST", S(scheduled.body.id), { session: x.lead.session, body: red() });
    expect([frozen.status, frozen.body.code]).toEqual([422, "meeting.frozen"]);
    const meetingId = await meetingInSession(send, x, forumId, plusDays(today, 3));
    const unknown = await send("POST", S(meetingId), {
      session: x.lead.session,
      body: { ...red(), sourceRecordId: x.forums.value_review },
    });
    expect([unknown.status, unknown.body.code, unknown.body.errors[0].pointer]).toEqual([
      422,
      "blocker_status.record_not_found",
      "/sourceRecordId",
    ]);
    const bad = await send("POST", S(meetingId), { session: x.lead.session, body: { ...red(), rag: "purple" } });
    expect(bad.status).toBe(400);
    const rows = await api.db.selectFrom("blocker_status").select("id").where("meeting_id", "=", meetingId).execute();
    expect(rows).toEqual([]);
  });

  it("negative: AUD and SP 403, ADM-only and another organization 404; a meeting of another transformation 404", async () => {
    const meetingId = await meetingInSession(send, x, forumId, plusDays(today, 4));
    const outsider = await signIn(api.app, w.officeB.subject);
    for (const [session, status] of [
      [x.auditor.session, 403],
      [x.sponsor.session, 403],
      [x.admin, 404],
      [outsider, 404],
    ] as const)
      expect((await send("POST", S(meetingId), { session, body: red() })).status).toBe(status);
    expect((await send("GET", S(meetingId), { session: x.admin })).status).toBe(404);
    expect((await send("GET", S(x.forums.value_review), { session: x.lead.session })).status).toBe(404);
    const rows = await api.db.selectFrom("blocker_status").select("id").where("meeting_id", "=", meetingId).execute();
    expect(rows).toEqual([]);
  });
});

describe("a person-raised ask linked to a blocker (ADR-0032 §8.3)", () => {
  it("links the ask; a second open ask for the same blocker is 409 executive_decision.blocker_ask_open", async () => {
    const other = await createBlockerRisk(send, x, "Synthetic blocker: approvals backlog");
    const L = `/api/v1/transformations/${x.transformationId}/executive-decisions`;
    const first = await send("POST", L, {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 8), { blockerRecordType: "raid_entry", blockerRecordId: other }),
    });
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    expect([first.body.blockerRecordType, first.body.blockerRecordId]).toEqual(["raid_entry", other]);
    const second = await send("POST", L, {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 8), { blockerRecordType: "raid_entry", blockerRecordId: other }),
    });
    expect([second.status, second.body.code, second.body.detail]).toEqual([
      409,
      "executive_decision.blocker_ask_open",
      `An open executive ask already exists for this blocker: ${first.body.code}.`,
    ]);
    const half = await send("POST", L, {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 8), { blockerRecordId: other }),
    });
    expect([half.status, half.body.errors[0].pointer]).toEqual([400, "/blockerRecordType"]);
    const missing = await send("POST", L, {
      session: x.lead.session,
      body: askBody(x.sponsor.id, plusDays(today, 8), { blockerRecordType: "raid_entry", blockerRecordId: forumId }),
    });
    expect([missing.status, missing.body.code]).toEqual([422, "blocker_status.record_not_found"]);
  });
});

describe("recordBlockerStatus commit-time authorization (S-4)", () => {
  it("a TO whose grant is revoked while the request waits gets 403 and nothing is written", async () => {
    const to = await person(api, w, x.transformationId, "TO");
    const meetingId = await meetingInSession(send, x, forumId, today);
    const res = await afterIdentity(
      api,
      to.id,
      () => call(api.app, "POST", S(meetingId), { session: to.session, body: red(), contract: false }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("blocker_status").select("id").where("meeting_id", "=", meetingId).execute();
    expect(rows).toEqual([]);
    const events = await api.db
      .selectFrom("outbox_event")
      .select("id")
      .where("event_type", "=", "blocker_status.recorded")
      .where(sql<string>`payload->>'meetingId'`, "=", meetingId)
      .execute();
    expect(events).toEqual([]);
  });
});

describe("D-102 parity: the worker's twins answer as the API services do", () => {
  it("resolveParty, the executive check and the DEC-nn sequence are the same on both paths", async () => {
    // resolveParty: mapped user (SP, BO), mapped TL, and an unmapped party.
    for (const party of ["SP", "BO", "TL", "CFO"]) {
      const a = await resolveParty(api.db, x.transformationId, party);
      const b = await api.db.transaction().execute((tx) => workerResolveParty(tx, x.transformationId, party));
      const strip = (t: typeof a) =>
        t.status === "unmapped"
          ? t
          : t.kind === "user"
            ? { kind: t.kind, userId: t.userId }
            : { kind: t.kind, groupId: t.groupId };
      const stripW = (t: typeof b) =>
        t.status === "unmapped"
          ? t
          : t.kind === "user"
            ? { kind: t.kind, userId: t.userId }
            : { kind: t.kind, groupId: t.groupId };
      expect(stripW(b), party).toEqual(strip(a));
    }
    // The executive check: SP, BO and FIN hold executive_decision.decide; TL, TO, WL and AUD do not; a revoked SP
    // does not any more.
    const target = (await resolveTarget(api.db, { type: "transformation", id: x.transformationId }))!;
    const revoked = await person(api, w, x.transformationId, "SP");
    await revokeAll(api, w.grantor.id, revoked.id);
    const people = [
      x.sponsor.id,
      x.bo.id,
      x.fin.id,
      x.lead.id,
      x.office.id,
      x.contributor.id,
      x.auditor.id,
      revoked.id,
    ];
    const apiAnswers = [];
    for (const id of people) apiAnswers.push(await holdsExecutiveDecide(api.db, id, target));
    const workerAnswers = await api.db.transaction().execute(async (tx) => {
      const ok = new Set(await executivesAmong(tx, people, x.transformationId));
      return people.map((id) => ok.has(id));
    });
    expect(workerAnswers).toEqual(apiAnswers);
    expect(apiAnswers).toEqual([true, true, true, false, false, false, false, false]);
    // DEC-nn: one counter, one format; the two paths continue each other's sequence (rolled back afterwards).
    const rollback = new Error("rollback");
    let codes: string[] = [];
    await api.db
      .transaction()
      .execute(async (tx) => {
        codes = [
          await nextCode(tx, x.transformationId, "DEC"),
          await nextDecisionCode(tx, x.transformationId),
          await apiNextDecisionCode(tx, x.transformationId),
          await nextCode(tx, x.transformationId, "DEC"),
        ];
        throw rollback;
      })
      .catch((e: unknown) => {
        if (e !== rollback) throw e;
      });
    const n = codes.map((c) => Number(/^DEC-(\d{2,})$/.exec(c)![1]));
    expect([n[1]! - n[0]!, n[2]! - n[1]!, n[3]! - n[2]!]).toEqual([1, 1, 1]);
  });
});
