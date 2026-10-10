// REQ-S16-019 A09, the slice D entity group (ADR-0032 §13; T-DG4-BE-F2, after BE-F): an integration test creates and
// reads each entity - Forum, Meeting, AgendaItem, Attendance, Minutes and MeetingActionLink - through the API with
// authorization enforced: each write is 403 for an AUD user (who reads it in scope), and each read and write is 404
// outside the scope (a user of another organization; an ADM-only technical admin). Against a real PostgreSQL.
// All data is SYNTHETIC; nothing here approves anything or touches the engineering gates DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
let outsider: Session;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
  outsider = await signIn(api.app, w.officeB.subject);
}, 120_000);
afterAll(() => api.close());

/** The write is 403 for AUD and 404 outside the scope, and creates nothing; then the authorized write succeeds. */
async function guardedCreate(url: string, body: Record<string, unknown>, session: Session): Promise<Body> {
  expect((await send("POST", url, { session: x.auditor.session, body })).status, `AUD ${url}`).toBe(403);
  expect((await send("POST", url, { session: outsider, body })).status, `outsider ${url}`).toBe(404);
  expect((await send("POST", url, { session: x.admin, body })).status, `ADM-only ${url}`).toBe(404);
  const res = await send("POST", url, { session, body });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
}

/** The read succeeds for AUD (read-only, in scope) and is 404 outside the scope. */
async function guardedRead(url: string): Promise<Body> {
  expect((await send("GET", url, { session: outsider })).status, `outsider ${url}`).toBe(404);
  expect((await send("GET", url, { session: x.admin })).status, `ADM-only ${url}`).toBe(404);
  const res = await send("GET", url, { session: x.auditor.session });
  expect(res.status, url).toBe(200);
  return res.body;
}

describe("REQ-S16-019: the slice D entity group through the API", () => {
  it("Forum, Meeting, AgendaItem, Attendance, Minutes and MeetingActionLink: created and read, AUD 403, outside 404", async () => {
    // Forum (forum.configure: TO).
    const forum = await guardedCreate(
      `${T()}/forums`,
      {
        nameEn: "Synthetic Architecture Board",
        nameAr: "مجلس معماري اصطناعي",
        cadenceLabel: "Monthly",
        purpose: "Synthetic: review designs",
        participantsLabel: "Architects",
        outputsLabel: "Decisions, actions",
        outputKinds: ["decision", "action"],
        chairPartyCode: "TL",
      },
      x.office.session,
    );
    expect((await guardedRead(`${T()}/forums/${forum.id}`)).id).toBe(forum.id);

    // Meeting (meeting.prepare: TL).
    const meeting = await guardedCreate(
      `${T()}/meetings`,
      { forumId: forum.id, scheduledDate: plusDays(today, 5), startTime: "13:00", durationMinutes: 60 },
      x.lead.session,
    );
    const M = `${T()}/meetings/${meeting.id}`;
    expect([(await guardedRead(M)).id, meeting.chairUserId]).toEqual([meeting.id, x.lead.id]);
    const patch = await send("PATCH", M, { session: x.auditor.session, headers: ifm(1), body: { location: "X" } });
    expect(patch.status).toBe(403);

    // AgendaItem.
    const item = await guardedCreate(
      `${M}/agenda-items`,
      { itemKind: "discussion", title: "Synthetic: design review" },
      x.lead.session,
    );
    expect((await guardedRead(`${M}/agenda-items`)).items.map((i: Body) => i.id)).toEqual([item.id]);

    // Attendance.
    const attendance = await guardedCreate(
      `${M}/attendance`,
      { userId: x.lead.id, attendance: "present" },
      x.lead.session,
    );
    expect((await guardedRead(`${M}/attendance`)).items.map((i: Body) => i.id)).toEqual([attendance.id]);

    // MeetingActionLink (with its canonical action).
    const action = await guardedCreate(
      `${M}/actions`,
      { title: "Synthetic: update the design", ownerUserId: x.contributor.id, agendaItemId: item.id },
      x.lead.session,
    );
    const actions = await guardedRead(`${M}/actions`);
    expect(actions.items.map((a: Body) => [a.id, a.agendaItemId, a.action.ownerUserId])).toEqual([
      [action.id, item.id, x.contributor.id],
    ]);

    // Minutes (drafted by TL; read back with their ETag).
    const minutes = await guardedCreate(`${M}/minutes`, { body: "Synthetic minutes" }, x.lead.session);
    const read = await guardedRead(`${M}/minutes`);
    expect([read.id, read.status]).toEqual([minutes.id, "draft"]);
    const audEdit = await send("PATCH", `${M}/minutes`, {
      session: x.auditor.session,
      headers: ifm(1),
      body: { body: "X" },
    });
    expect(audEdit.status).toBe(403);
  });
});
