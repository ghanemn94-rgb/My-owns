// Presentation mode of a meeting (ADR-0045 §7; REQ-S10-013, M0212; p5-work-split §F.7; T-DG5-BE-O) against a real
// PostgreSQL. The literal tests of §F.7 for REQ-S10-013:
//  - changing a linked decision before cut-off changes the LIVE presentation: runs as soon as a `meeting_pack`
//    assembler is registered (KBE-D2) and the composition root wires it (both in place since D-159; the test runs,
//    and T-DG5-BE-T5 emptied P5_PENDING_TESTS_BE_O, D-162 e);
//  - the issued meeting-pack snapshot still returns the old decision (snapshot mode returns the stored content);
//  - a snapshot of another meeting -> 422 presentation.snapshot_mismatch.
// Also: a snapshot of another output -> 422; an unknown snapshot, one of another transformation, an unknown meeting
// -> 404; the live mode answers 404 while no meeting_pack assembler is wired; the live path through the port (a
// stub assembler: route plumbing only, not the REQ-S10-013 test); AUD reads; a caller holding transformation.read
// nowhere -> 403; one holding it elsewhere -> 404; 400 on malformed input. The route writes nothing.
// All data is SYNTHETIC; a pack issue is not a business approval and nothing touches the engineering gates DG0-DG7.
import type { ReportDocument } from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { setMeetingPackAssembler } from "../../../src/modules/governance/presentation.ts";
import { assemblerOf } from "../../../src/modules/reporting/reports/assembler.ts";
import { call, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { businessToday, plusDays, setupMeetingWorld, type MeetingWorld } from "./meeting-fixtures.ts";
import { decisionSection, storeMeetingPack } from "./presentation-fixtures.ts";
import { raiseAsk } from "./t16-fixtures.ts";

let api: TestApi;
let w: World;
let x: MeetingWorld;
let today: string;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call<Body>(api.app, m, u, o);
const T = () => `/api/v1/transformations/${x.transformationId}`;
const P = (meetingId: string, snapshotId?: string) =>
  `${T()}/meetings/${meetingId}/presentation${snapshotId === undefined ? "" : `?snapshotId=${snapshotId}`}`;
const hasMeetingPackAssembler = assemblerOf("meeting_pack") !== undefined;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  x = await setupMeetingWorld(api, w);
  today = await businessToday(api);
}, 120_000);
afterAll(() => api.close());

async function meeting(days = 10): Promise<string> {
  const res = await send("POST", `${T()}/meetings`, {
    session: x.lead.session,
    body: {
      forumId: x.forums.executive_steerco,
      scheduledDate: plusDays(today, days),
      startTime: "09:00",
      durationMinutes: 60,
    },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body.id as string;
}

async function renameDecision(decisionId: string, title: string): Promise<{ id: string; version: number }> {
  const current = await send("GET", `${T()}/executive-decisions/${decisionId}`, { session: x.lead.session });
  expect(current.status).toBe(200);
  const res = await send("PATCH", `${T()}/executive-decisions/${decisionId}`, {
    session: x.lead.session,
    headers: ifm(current.body.version),
    body: { title },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: decisionId, version: res.body.version as number };
}

const auditCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("audit_event")
        .select((eb) => eb.fn.countAll().as("n"))
        .where("transformation_id", "=", x.transformationId)
        .executeTakeFirstOrThrow()
    ).n,
  );

describe("REQ-S10-013: presentation mode and the printable pack come from the same records", () => {
  it("the issued meeting-pack snapshot still returns the old decision after the linked decision changes", async () => {
    const meetingId = await meeting();
    const ask = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 20), { title: "Synthetic: old decision title" });
    const pack = await storeMeetingPack(api, send, {
      transformationId: x.transformationId,
      meetingId,
      author: x.lead,
      sections: [decisionSection(ask, "Synthetic: old decision title")],
    });
    const issued = await send("POST", `${T()}/report-snapshots/${pack.id}/issue`, {
      session: x.lead.session,
      headers: ifm(pack.version),
      body: {},
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    expect(issued.body.status).toBe("issued");

    await renameDecision(ask.id, "Synthetic: new decision title");
    const before = await auditCount();
    const res = await send("GET", P(meetingId, pack.id), { session: x.lead.session });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body).toMatchObject({ meetingId, mode: "snapshot", snapshotId: pack.id });
    expect(res.body.document).toEqual(pack.document);
    const text = JSON.stringify(res.body.document);
    expect(text).toContain("Synthetic: old decision title");
    expect(text).not.toContain("Synthetic: new decision title");
    // The decision itself did change; the pack is the snapshot. Reading writes nothing.
    const d = await send("GET", `${T()}/executive-decisions/${ask.id}`, { session: x.auditor.session });
    expect(d.body.decision).toBe("Synthetic: new decision title");
    expect(await auditCount()).toBe(before);
  });

  it("a snapshot of another meeting, or of another output, is 422 presentation.snapshot_mismatch", async () => {
    const a = await meeting(11);
    const b = await meeting(12);
    const ofB = await storeMeetingPack(api, send, {
      transformationId: x.transformationId,
      meetingId: b,
      author: x.lead,
      sections: [],
    });
    const res = await send("GET", P(a, ofB.id), { session: x.lead.session });
    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      code: "presentation.snapshot_mismatch",
      detail: "This snapshot is not a pack of this meeting.",
    });
    // The same snapshot is the presentation of its own meeting.
    expect((await send("GET", P(b, ofB.id), { session: x.lead.session })).status).toBe(200);
    // A charter snapshot of the same transformation is not a meeting pack.
    const charter = await send("POST", `${T()}/reports/charter/generate`, { session: x.lead.session, body: {} });
    expect(charter.status).toBe(201);
    expect((await send("GET", P(a, charter.body.id), { session: x.lead.session })).body.code).toBe(
      "presentation.snapshot_mismatch",
    );
  });

  it("an unknown snapshot, a snapshot of another transformation and an unknown meeting are 404", async () => {
    const a = await meeting(13);
    expect((await send("GET", P(a, crypto.randomUUID()), { session: x.lead.session })).status).toBe(404);
    expect((await send("GET", P(crypto.randomUUID()), { session: x.lead.session })).status).toBe(404);
    // A second transformation of the same lead: its pack is not a snapshot of this transformation.
    const other = await send("POST", "/api/v1/transformations", {
      session: x.lead.session,
      body: { businessUnitId: w.a1, name: "Synthetic second transformation", mode: "end_to_end" },
    });
    expect(other.status, JSON.stringify(other.body)).toBe(201);
    const forum = await api.db
      .selectFrom("forum")
      .select("id")
      .where("transformation_id", "=", other.body.id)
      .where("template_key", "=", "executive_steerco")
      .executeTakeFirstOrThrow();
    const m2 = await send("POST", `/api/v1/transformations/${other.body.id}/meetings`, {
      session: x.lead.session,
      body: { forumId: forum.id, scheduledDate: plusDays(today, 14), startTime: "09:00", durationMinutes: 60 },
    });
    expect(m2.status, JSON.stringify(m2.body)).toBe(201);
    const foreign = await storeMeetingPack(api, send, {
      transformationId: other.body.id,
      meetingId: m2.body.id,
      author: x.lead,
      sections: [],
    });
    expect((await send("GET", P(a, foreign.id), { session: x.lead.session })).status).toBe(404);
    // The other transformation's meeting is not a meeting of this transformation either.
    expect((await send("GET", P(m2.body.id, foreign.id), { session: x.lead.session })).status).toBe(404);
  });

  it.runIf(!hasMeetingPackAssembler)("the live mode answers 404 while no meeting_pack assembler is wired", async () => {
    const a = await meeting(15);
    expect((await send("GET", P(a), { session: x.lead.session })).status).toBe(404);
  });

  it("the live mode returns the port's document at request time (route plumbing, with a stub assembler)", async () => {
    const a = await meeting(16);
    const ask = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 20), { title: "Synthetic: live title one" });
    const template = await storeMeetingPack(api, send, {
      transformationId: x.transformationId,
      meetingId: a,
      author: x.lead,
      sections: [],
    });
    const calls: { transformationId: string; meetingId: string }[] = [];
    const previous = setMeetingPackAssembler(async (db, input) => {
      calls.push({ ...input });
      const d = await db
        .selectFrom("decision")
        .select(["id", "title", "version"])
        .where("id", "=", ask.id)
        .executeTakeFirstOrThrow();
      return { ...template.document, sections: [decisionSection(d, d.title)] } as ReportDocument;
    });
    try {
      const one = await send("GET", P(a), { session: x.lead.session });
      expect(one.status, JSON.stringify(one.body)).toBe(200);
      expect(one.body).toMatchObject({ meetingId: a, mode: "live", snapshotId: null });
      expect(JSON.stringify(one.body.document)).toContain("Synthetic: live title one");
      await renameDecision(ask.id, "Synthetic: live title two");
      const two = await send("GET", P(a), { session: x.auditor.session });
      expect(JSON.stringify(two.body.document)).toContain("Synthetic: live title two");
      expect(calls).toEqual([
        { transformationId: x.transformationId, meetingId: a },
        { transformationId: x.transformationId, meetingId: a },
      ]);
    } finally {
      setMeetingPackAssembler(previous);
    }
  });

  it.runIf(hasMeetingPackAssembler)(
    "changing a linked decision before cut-off changes the live presentation; the issued meeting-pack snapshot still returns the old decision (real meeting_pack assembler)",
    async () => {
      const a = await meeting(17);
      const ask = await raiseAsk(send, x, x.sponsor.id, plusDays(today, 20), { title: "Synthetic: pack title one" });
      const item = await send("POST", `${T()}/meetings/${a}/agenda-items`, {
        session: x.lead.session,
        body: { itemKind: "executive_ask", title: "Synthetic: the vendor decision", decisionId: ask.id },
      });
      expect(item.status, JSON.stringify(item.body)).toBe(201);
      const live1 = await send("GET", P(a), { session: x.lead.session });
      expect(live1.status, JSON.stringify(live1.body).slice(0, 400)).toBe(200);
      expect(JSON.stringify(live1.body.document)).toContain("Synthetic: pack title one");
      const gen = await send("POST", `${T()}/reports/meeting_pack/generate`, {
        session: x.lead.session,
        body: { subjectId: a },
      });
      expect(gen.status, JSON.stringify(gen.body).slice(0, 400)).toBe(201);
      const issued = await send("POST", `${T()}/report-snapshots/${gen.body.id}/issue`, {
        session: x.lead.session,
        headers: ifm(gen.body.version),
        body: {},
      });
      expect(issued.status).toBe(200);
      await renameDecision(ask.id, "Synthetic: pack title two");
      const live2 = await send("GET", P(a), { session: x.lead.session });
      expect(JSON.stringify(live2.body.document)).toContain("Synthetic: pack title two");
      const pack = await send("GET", P(a, gen.body.id), { session: x.lead.session });
      expect(pack.body.mode).toBe("snapshot");
      expect(JSON.stringify(pack.body.document)).toContain("Synthetic: pack title one");
      expect(JSON.stringify(pack.body.document)).not.toContain("Synthetic: pack title two");
    },
  );
});

describe("presentation authorization (transformation.read; AUD reads)", () => {
  let meetingId: string;
  let packId: string;
  let nobody: Session;
  let officeB: Session;
  beforeAll(async () => {
    meetingId = await meeting(18);
    packId = (
      await storeMeetingPack(api, send, {
        transformationId: x.transformationId,
        meetingId,
        author: x.lead,
        sections: [],
      })
    ).id;
    nobody = await signIn(api.app, w.nobody.subject);
    officeB = await signIn(api.app, w.officeB.subject);
  });

  it("AUD reads the presentation", async () => {
    const res = await send("GET", P(meetingId, packId), { session: x.auditor.session });
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("snapshot");
  });

  it("a caller holding transformation.read nowhere is 403; one holding it elsewhere is 404; anonymous 401", async () => {
    expect((await send("GET", P(meetingId, packId), { session: nobody })).status).toBe(403);
    expect((await send("GET", P(meetingId, packId), { session: officeB })).status).toBe(404);
    expect((await send("GET", P(meetingId, packId))).status).toBe(401);
  });

  it("malformed input is 400 (a non-UUID snapshot id, an unknown query member, a non-UUID meeting id)", async () => {
    expect((await send("GET", `${P(meetingId)}?snapshotId=nope`, { session: x.lead.session })).status).toBe(400);
    expect((await send("GET", `${P(meetingId)}?x=1`, { session: x.lead.session })).status).toBe(400);
    expect((await send("GET", `${T()}/meetings/nope/presentation`, { session: x.lead.session })).status).toBe(400);
  });
});
