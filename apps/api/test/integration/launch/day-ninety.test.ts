// The Day-90 leadership test (P5 slice H; ADR-0048 §4, §7-§9; REQ-PB-087; p5-work-split §H.2; T-DG5-BE-P2). Proves,
// against the run's disposable PostgreSQL:
//  - REQ-PB-087: all six questions render verbatim (equal to B0136-B0141); with 5 responses the test reports
//    `completion {answered: 5, total: 6, complete: false}`, and completing gives 422 day_ninety_test.incomplete; with
//    six it completes; a response after completion gives 422 day_ninety_test.completed;
//  - evidence suggestions are pre-filled links (at most 5 per question) from the question's record types, with their
//    state, and never answers;
//  - AUD (and TO, WL) get 403 on every write, an outsider 404; If-Match of the test gives 428/409 (two leaders
//    answering at once get one 409); one audit event per mutated row; authorization is re-checked at commit time.
// All data is SYNTHETIC; a Day-90 answer is not a G1-G6 business approval, and nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, signIn, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm, makeG1Ready, setupP2World, type P2World } from "../../support/p2-fixtures.ts";
import { createWorkItemOnce } from "../../../src/modules/tasks/index.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";

let api: TestApi;
let w: World;
let p: P2World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
const testUrl = (t: string) => `/api/v1/transformations/${t}/day-90-test`;
const respUrl = (t: string, q: string) => `${testUrl(t)}/responses/${q}`;
const completeUrl = (t: string) => `${testUrl(t)}/complete`;

/** B0136-B0141 of docs/source/playbook.md, verbatim. */
const SOURCE_QUESTIONS = [
  ["q1", "B0136", "Can leaders explain the same case for change and North Star?"],
  ["q2", "B0137", "Can every initiative be traced to a target-state gap and outcome?"],
  ["q3", "B0138", "Are executive decision rights clear?"],
  ["q4", "B0139", "Is Finance aligned on baselines and benefit formulas?"],
  ["q5", "B0140", "Are Wave 1 initiatives producing evidence rather than only plans?"],
  ["q6", "B0141", "Can the transformation team show what it needs from executives this month?"],
];

interface Suggestion {
  recordType: string;
  recordId: string;
  label: string;
  state: string | null;
}
interface DayNinety {
  id: string;
  planId: string;
  scheduledDate: string;
  status: string;
  completion: { answered: number; total: number; complete: boolean };
  questions: {
    code: string;
    ordinal: number;
    textEn: string;
    textAr: string;
    sourceRef: string;
    response: { answer: string; comment: string | null; evidenceId: string | null; respondedBy: string } | null;
    evidenceSuggestions: Suggestion[];
  }[];
  completedAt: string | null;
  completedBy: string | null;
  version: number;
}

async function generatePlan(q: P2World, startDate = "2026-10-01"): Promise<void> {
  const res = await send("POST", `/api/v1/transformations/${q.transformationId}/launch-plan`, {
    session: q.lead.session,
    body: { startDate },
  });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

async function read(q: P2World, session = q.lead.session): Promise<DayNinety> {
  const res = await send("GET", testUrl(q.transformationId), { session });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(res.headers.etag).toBe(`"${(res.body as DayNinety).version}"`);
  return res.body as DayNinety;
}

const answer = (q: P2World, code: string, v: number, body: unknown, session = q.lead.session) =>
  send("PUT", respUrl(q.transformationId, code), { session, headers: ifm(v), body });

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  p = await setupP2World(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

describe("getDayNinetyTest (REQ-PB-087)", () => {
  it("404s before the plan exists; an outsider gets 404; 401 without a session", async () => {
    expect((await send("GET", testUrl(p.transformationId), { session: p.lead.session })).status).toBe(404);
    await generatePlan(p);
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await send("GET", testUrl(p.transformationId), { session: outsider })).status).toBe(404);
    expect((await send("GET", testUrl(p.transformationId))).status).toBe(401);
    expect(
      (await send("GET", "/api/v1/transformations/not-a-uuid/day-90-test", { session: p.lead.session })).status,
    ).toBe(400);
  });

  it("renders the six questions verbatim (B0136-B0141), open, scheduled on day 90, incomplete (0/6)", async () => {
    const t = await read(p, p.auditor.session); // AUD reads
    expect(t.questions.map((q) => [q.code, q.sourceRef, q.textEn])).toEqual(SOURCE_QUESTIONS);
    expect(t.questions.map((q) => q.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const q of t.questions) {
      expect(q.textAr.length).toBeGreaterThan(0);
      expect(q.response).toBeNull(); // a suggestion never pre-answers
    }
    expect([t.scheduledDate, t.status, t.version, t.completedAt, t.completedBy]).toEqual([
      "2026-12-30",
      "open",
      1,
      null,
      null,
    ]);
    expect(t.completion).toEqual({ answered: 0, total: 6, complete: false });
  });
});

describe("putDayNinetyResponse and completeDayNinetyTest (REQ-PB-087)", () => {
  it("refuses AUD, TO and WL (403), an outsider (404); If-Match gives 428/409; a bad body or code gives 400", async () => {
    const t = await read(p);
    const body = { answer: "yes" };
    for (const session of [p.auditor.session, p.office.session, p.contributor.session]) {
      expect((await answer(p, "q1", t.version, body, session)).status).toBe(403);
      expect((await send("POST", completeUrl(p.transformationId), { session, headers: ifm(t.version) })).status).toBe(
        403,
      );
    }
    const outsider = await signIn(api.app, w.officeB.subject);
    expect((await answer(p, "q1", t.version, body, outsider)).status).toBe(404);
    expect((await send("PUT", respUrl(p.transformationId, "q1"), { session: p.lead.session, body })).status).toBe(428);
    expect((await send("POST", completeUrl(p.transformationId), { session: p.lead.session })).status).toBe(428);
    const stale = await answer(p, "q1", t.version + 1, body);
    expect([stale.status, stale.body.code]).toEqual([409, "version_conflict"]);
    expect((await answer(p, "q7", t.version, body)).status).toBe(400);
    expect((await answer(p, "q1", t.version, { answer: "maybe" })).status).toBe(400);
    expect((await answer(p, "q1", t.version, { answer: "yes", comment: "   " })).status).toBe(400);
    expect((await answer(p, "q1", t.version, { answer: "yes", extra: 1 })).status).toBe(400);
    const after = await read(p);
    expect([after.version, after.completion.answered]).toEqual([t.version, 0]);
    expect(await api.db.selectFrom("day_ninety_response").select("id").where("test_id", "=", t.id).execute()).toEqual(
      [],
    );
  });

  it("with 5 responses: completion {answered: 5, total: 6, complete: false}; completing gives 422 incomplete", async () => {
    let t = await read(p);
    const codes = ["q1", "q2", "q3", "q4", "q5"];
    for (const [i, code] of codes.entries()) {
      // SP and TL both respond (day_ninety_test.respond: SP, TL).
      const session = i % 2 === 0 ? p.lead.session : p.sponsor.session;
      const res = await answer(
        p,
        code,
        t.version,
        { answer: i === 2 ? "no" : "yes", comment: `Synthetic ${code}` },
        session,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      expect(res.body.version).toBe(t.version + 1);
      expect(res.headers.etag).toBe(`"${t.version + 1}"`);
      t = res.body as DayNinety;
    }
    expect(t.completion).toEqual({ answered: 5, total: 6, complete: false });
    expect(t.questions.find((q) => q.code === "q2")!.response).toMatchObject({
      answer: "yes",
      comment: "Synthetic q2",
      evidenceId: null,
      respondedBy: p.sponsor.id,
    });
    expect(t.questions.find((q) => q.code === "q6")!.response).toBeNull();
    const incomplete = await send("POST", completeUrl(p.transformationId), {
      session: p.lead.session,
      headers: ifm(t.version),
    });
    expect([incomplete.status, incomplete.body.code, incomplete.body.detail]).toEqual([
      422,
      "day_ninety_test.incomplete",
      "Answer all six questions before completing the Day-90 leadership test.",
    ]);
    expect((await read(p)).status).toBe("open");
    // One audit event per mutated row: each response once, and the test once per response write.
    const responses = await api.db
      .selectFrom("day_ninety_response")
      .select(["id", "question_code"])
      .where("test_id", "=", t.id)
      .execute();
    expect(responses).toHaveLength(5);
    for (const r of responses)
      expect((await auditOf(api.db, r.id)).map((a) => [a.action, a.new_version])).toEqual([
        ["day_ninety_response.create", 1],
      ]);
    expect((await auditOf(api.db, t.id)).map((a) => a.action)).toEqual([
      "day_ninety_test.create",
      ...codes.map(() => "day_ninety_test.respond"),
    ]);
  });

  it("changing a response steps the response and the test once each; the same response again writes nothing", async () => {
    const t = await read(p);
    const changed = await answer(p, "q3", t.version, { answer: "yes", comment: null });
    expect(changed.status, JSON.stringify(changed.body)).toBe(200);
    const q3 = (changed.body as DayNinety).questions.find((q) => q.code === "q3")!;
    expect([q3.response!.answer, q3.response!.comment, changed.body.completion.answered]).toEqual(["yes", null, 5]);
    const row = await api.db
      .selectFrom("day_ninety_response")
      .select(["id", "version"])
      .where("test_id", "=", t.id)
      .where("question_code", "=", "q3")
      .executeTakeFirstOrThrow();
    expect(row.version).toBe(2);
    const events = await auditOf(api.db, row.id);
    expect(events.map((a) => a.action)).toEqual(["day_ninety_response.create", "day_ninety_response.update"]);
    expect(events[1]!.changes).toEqual({
      answer: { from: "no", to: "yes" },
      comment: { from: "Synthetic q3", to: null },
    });
    const same = await answer(p, "q3", changed.body.version, { answer: "yes" });
    expect([same.status, same.body.version]).toEqual([200, changed.body.version]);
    expect(await auditOf(api.db, row.id)).toHaveLength(2);
  });

  it("two leaders answering on the same version: one succeeds, the other gets 409", async () => {
    const t = await read(p);
    const [a, b] = await Promise.all([
      answer(p, "q4", t.version, { answer: "no" }, p.lead.session),
      answer(p, "q5", t.version, { answer: "no" }, p.sponsor.session),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect((await read(p)).version).toBe(t.version + 1);
  });

  it("an evidence id must be evidence of this transformation (422 validation.reference)", async () => {
    const t = await read(p);
    const res = await answer(p, "q6", t.version, { answer: "yes", evidenceId: "01920000-0000-7000-8000-00000000abcd" });
    expect([res.status, res.body.code]).toEqual([422, "validation.reference"]);
    expect((await read(p)).completion.answered).toBe(5);
  });

  it("with all six it completes (closing the test's due tasks); a response after completion gives 422 completed", async () => {
    let t = await read(p);
    const sixth = await answer(p, "q6", t.version, { answer: "yes" }, p.sponsor.session);
    expect(sixth.status, JSON.stringify(sixth.body)).toBe(200);
    t = sixth.body as DayNinety;
    expect(t.completion).toEqual({ answered: 6, total: 6, complete: true });
    expect(t.status).toBe("open");
    // A due task of the test (as the worker job creates it) is closed by the completion.
    const org = await api.db
      .selectFrom("transformation")
      .select("organization_id")
      .where("id", "=", p.transformationId)
      .executeTakeFirstOrThrow();
    const due = await api.db.transaction().execute((tx) =>
      createWorkItemOnce(
        tx,
        { actorType: "service", actorUserId: null, requestId: "job:synthetic-day-90", source: "worker" },
        {
          organizationId: org.organization_id,
          transformationId: p.transformationId,
          kind: "day_ninety_test_due",
          assigneeUserId: p.sponsor.id,
          subjectType: "day_ninety_test",
          subjectId: t.id,
          linkPath: `/transformations/${p.transformationId}/day-90-test`,
          messageKey: "launch.task.day_ninety_test_due",
          dueDate: t.scheduledDate,
          dedupeKey: `day_ninety_test:${t.id}:${p.sponsor.id}`,
        },
      ),
    );
    expect(
      (await send("POST", completeUrl(p.transformationId), { session: p.lead.session, headers: ifm(t.version + 1) }))
        .status,
    ).toBe(409);
    const done = await send("POST", completeUrl(p.transformationId), {
      session: p.sponsor.session,
      headers: ifm(t.version),
    });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    expect(done.body).toMatchObject({ status: "completed", completedBy: p.sponsor.id, version: t.version + 1 });
    expect(done.body.completedAt).not.toBeNull();
    expect(done.headers.etag).toBe(`"${t.version + 1}"`);
    const item = await api.db
      .selectFrom("work_item")
      .select(["status"])
      .where("id", "=", due.workItemId)
      .executeTakeFirstOrThrow();
    expect(item.status).toBe("done");
    const events = (await auditOf(api.db, t.id)).map((a) => a.action);
    expect(events.filter((a) => a === "day_ninety_test.complete")).toHaveLength(1);
    // Responses after completion: 422 day_ninety_test.completed, nothing written; a second completion too.
    const late = await answer(p, "q1", done.body.version, { answer: "no" });
    expect([late.status, late.body.code, late.body.detail]).toEqual([
      422,
      "day_ninety_test.completed",
      "The Day-90 leadership test is complete; its responses can no longer change.",
    ]);
    const again = await send("POST", completeUrl(p.transformationId), {
      session: p.lead.session,
      headers: ifm(done.body.version),
    });
    expect([again.status, again.body.code]).toEqual([422, "day_ninety_test.completed"]);
    const final = await read(p);
    expect([final.version, final.questions[0]!.response!.answer]).toEqual([done.body.version, "yes"]);
  });

  it("re-checks day_ninety_test.respond at commit time (a grant revoked mid-request gives 403 and writes nothing)", async () => {
    const q = await setupP2World(api, w);
    await generatePlan(q);
    const t = await read(q);
    const res = await afterIdentity(
      api,
      q.sponsor.id,
      () => answer(q, "q1", t.version, { answer: "yes" }, q.sponsor.session),
      () => revokeAll(api, w.grantor.id, q.sponsor.id),
    );
    expect(res.status).toBe(403);
    expect(await api.db.selectFrom("day_ninety_response").select("id").where("test_id", "=", t.id).execute()).toEqual(
      [],
    );
  });
});

describe("evidence suggestions (ADR-0048 §4: pre-filled links, never answers)", () => {
  it("lists at most 5 records per question from its record types, with their state", async () => {
    const q = await setupP2World(api, w);
    const { evidenceId, baselineId } = await makeG1Ready(api, q);
    await generatePlan(q);
    const t = await read(q);
    for (const question of t.questions) {
      expect(question.evidenceSuggestions.length).toBeLessThanOrEqual(5);
      expect(question.response).toBeNull();
    }
    const by = (code: string) => t.questions.find((x) => x.code === code)!.evidenceSuggestions;
    const charter = await api.db
      .selectFrom("charter")
      .select("id")
      .where("transformation_id", "=", q.transformationId)
      .executeTakeFirstOrThrow();
    expect(by("q1")).toContainEqual({
      recordType: "charter",
      recordId: charter.id,
      label: "Synthetic roaming uplift",
      state: null,
    });
    const baseline = await api.db
      .selectFrom("baseline")
      .select(["validation_status"])
      .where("id", "=", baselineId)
      .executeTakeFirstOrThrow();
    expect(by("q4")).toContainEqual(
      expect.objectContaining({ recordType: "baseline", recordId: baselineId, state: baseline.validation_status }),
    );
    expect(by("q5")).toContainEqual(expect.objectContaining({ recordType: "evidence", recordId: evidenceId }));
    // A record of another transformation is never suggested.
    expect(by("q5").map((s) => s.recordId)).not.toContain(undefined);
    const other = await read(p);
    expect(other.questions.flatMap((x) => x.evidenceSuggestions).map((s) => s.recordId)).not.toContain(evidenceId);
    // The answer comes from the leader: confirming a suggested record is a response with its evidence id.
    const res = await answer(q, "q5", t.version, { answer: "yes", evidenceId });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.questions.find((x: { code: string }) => x.code === "q5").response.evidenceId).toBe(evidenceId);
  });
});
