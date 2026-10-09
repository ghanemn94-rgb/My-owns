// Gate exceptions (waivers) for a missing mandatory criterion (T-DG4-BE-K2; ADR-0035 §4, §8, §11; REQ-S04-012,
// REQ-S04-013; D-089 Q2) against a real PostgreSQL:
//  - the gate page lists the missing items; a submission with one missing mandatory item -> 422 listing exactly it, in
//    the DG2 form for G1 (detail with keys, one error per criterion; nothing written);
//  - with accepted, unexpired exceptions -> 201; the snapshot's criterion entry and the frozen criterion row record the
//    exception; the review table shows it;
//  - a waiver without expiry or compensating action -> 400 (nothing written); expiry in the past -> 422; a criterion of
//    another gate -> 422;
//  - the requester cannot decide (403), a non-approver cannot (403), an ADM-only caller gets 403, AUD 403 on every
//    write; one hop of delegation decides for the approver;
//  - after expiry (business date after expires_on, clock injected) the exception no longer covers: the live view and
//    the submission report the criterion missing again; approving a submission whose recorded exception expired ->
//    422 gate.exception_expired (requesting changes stays allowed);
//  - revoke (reason required, only accepted), withdraw (requester only, only pending), If-Match 428/409 on every
//    action, one audit event per mutation.
// All data is SYNTHETIC; every exception decision is a demo in-product decision by a test person that approves nothing
// real, and nothing touches the engineering delivery gates DG0-DG7.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { setGateExceptionClock } from "../../../src/modules/workflows/gate-exceptions.ts";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { extraUser } from "../benefits/fixtures.ts";
import {
  acceptException,
  coverGate,
  exceptionBody,
  missingMandatory,
  plusDays,
  requestException,
  requesterApprover,
  seedGateWorld,
  submitThroughApi,
  todayOf,
  type GateWorld,
} from "../contract/p4-exercises-be-k.ts";

let api: TestApi;
let w: World;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
}, 60_000);
afterAll(() => api.close());
afterEach(() => setGateExceptionClock(null));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;
const EXC = (g: GateWorld) => `${g.b.base}/gate-exceptions`;
const DAY = 86_400_000;
/** Inject the exception clock `days` calendar days after now (business date moves by the same number of days). */
const later = (days: number) => setGateExceptionClock(() => new Date(Date.now() + days * DAY));

const exceptionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("gate_exception")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;
const submissionsOf = async (g: GateWorld) =>
  (
    await api.db
      .selectFrom("gate_submission")
      .select("id")
      .where("transformation_id", "=", g.b.transformationId)
      .execute()
  ).length;
const decide = (g: GateWorld, e: { id: string }, session: GateWorld["sp"]["session"], v: number, body?: object) =>
  send("POST", `${EXC(g)}/${e.id}/decision`, {
    session,
    headers: ifm(v),
    body: body ?? { outcome: "accepted", note: "Synthetic decision note" },
  });

describe("submission with missing mandatory evidence (REQ-S04-012)", () => {
  it("the gate page lists the missing items; one missing item -> 422 listing exactly it (DG2 form); nothing written", async () => {
    const g = await seedGateWorld(api, w);
    const missing = await missingMandatory(send, g, "G1");
    expect(missing.length).toBeGreaterThan(1);
    // The gate page (live view) lists each missing item with its messages.
    const view = await send("GET", `${g.gates}/G1`, { session: g.b.s.auditor });
    for (const key of missing) {
      const c = (view.body as Body).criteria.find((x: Body) => x.key === key);
      expect([c.completeness, c.missing.length > 0]).toEqual(["incomplete", true]);
    }
    expect((view.body as Body).canSubmit).toBe(false);
    // No exception at all: the exact DG2 refusal over every missing key.
    const before = await submissionsOf(g);
    const none = await submitThroughApi(api, send, g, "G1");
    expect([none.status, (none.body as Body).code, (none.body as Body).detail]).toEqual([
      422,
      "gate_criteria_incomplete",
      `Mandatory required outputs are incomplete: ${missing.join(", ")}.`,
    ]);
    expect(((none.body as Body).errors as Body[]).map((e) => e.pointer)).toEqual(missing.map((k) => `/criteria/${k}`));
    // Every missing item but the last covered: 422 lists exactly the one left, in the same DG2 form.
    const today = await todayOf(api, g);
    for (const key of missing.slice(0, -1))
      await acceptException(send, g, await requestException(send, g, "G1", key, plusDays(today, 10)));
    const last = missing.at(-1)!;
    const one = await submitThroughApi(api, send, g, "G1");
    expect([one.status, (one.body as Body).detail, (one.body as Body).errors.length]).toEqual([
      422,
      `Mandatory required outputs are incomplete: ${last}.`,
      1,
    ]);
    expect((one.body as Body).errors[0].pointer).toBe(`/criteria/${last}`);
    expect(await submissionsOf(g)).toBe(before);
  });

  it("with accepted unexpired exceptions -> 201; the snapshot and the frozen criterion rows record each exception", async () => {
    const g = await seedGateWorld(api, w);
    const today = await todayOf(api, g);
    const covered = await coverGate(send, g, "G1", plusDays(today, 30));
    const view = await send("GET", `${g.gates}/G1`, { session: g.b.s.tl });
    expect((view.body as Body).canSubmit).toBe(true);
    const res = await submitThroughApi(api, send, g, "G1");
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const snapshot = (res.body as Body).snapshot;
    for (const c of covered) {
      const entry = snapshot.criteria.find((x: Body) => x.key === c.key);
      const e = (await send("GET", `${EXC(g)}/${c.id}`, { session: g.b.s.auditor })).body as Body;
      expect(entry.completeness).toBe("incomplete");
      expect(entry.exception).toEqual({
        id: c.id,
        reason: e.reason,
        scope: e.scope,
        compensatingAction: e.compensatingAction,
        compensatingOwnerUserId: g.b.users.bo.id,
        expiresOn: plusDays(today, 30),
        decidedBy: g.sp.id,
        decidedAt: e.decidedAt,
      });
    }
    const rows = await api.db
      .selectFrom("gate_submission_criterion")
      .select(["criterion_key", "gate_exception_id"])
      .where("gate_submission_id", "=", (res.body as Body).id)
      .execute();
    for (const c of covered) expect(rows.find((r) => r.criterion_key === c.key)?.gate_exception_id).toBe(c.id);
    // The review table shows the recorded exception on its row.
    const table = await send("GET", `${g.gates}/G1/submissions/${(res.body as Body).submissionNo}/criteria`, {
      session: g.b.s.auditor,
    });
    expect((table.body as Body).items.find((r: Body) => r.criterionKey === covered[0]!.key).exception.id).toBe(
      covered[0]!.id,
    );
  });

  it("a pending, rejected or other-criterion exception does not cover (422 as in DG2)", async () => {
    const g = await seedGateWorld(api, w);
    const missing = await missingMandatory(send, g, "G1");
    const today = await todayOf(api, g);
    for (const key of missing.slice(1))
      await acceptException(send, g, await requestException(send, g, "G1", key, plusDays(today, 5)));
    const pending = await requestException(send, g, "G1", missing[0]!, plusDays(today, 5));
    const r1 = await submitThroughApi(api, send, g, "G1");
    expect([r1.status, (r1.body as Body).detail]).toEqual([
      422,
      `Mandatory required outputs are incomplete: ${missing[0]}.`,
    ]);
    const rejected = await decide(g, pending, g.sp.session, 1, { outcome: "rejected", note: "Synthetic: no." });
    expect([rejected.status, (rejected.body as Body).status, (rejected.body as Body).covering]).toEqual([
      200,
      "rejected",
      false,
    ]);
    expect((await submitThroughApi(api, send, g, "G1")).status).toBe(422);
  });
});

describe("the waiver record (REQ-S04-013)", () => {
  it("a waiver without expiry or compensating action -> 400; past expiry and a non-mandatory key -> 422; nothing written", async () => {
    const g = await seedGateWorld(api, w);
    const [key] = await missingMandatory(send, g, "G1");
    const today = await todayOf(api, g);
    const ok = exceptionBody(g, "G1", key!, today);
    for (const drop of ["expiresOn", "compensatingAction", "reason", "scope", "compensatingOwnerUserId"]) {
      const body: Record<string, unknown> = { ...ok };
      delete body[drop];
      const r = await send("POST", EXC(g), { session: g.b.s.tl, body });
      expect([r.status, (r.body as Body).code], drop).toEqual([400, "validation"]);
      expect(((r.body as Body).errors as Body[]).map((e) => e.pointer)).toContain(`/${drop}`);
    }
    const blank = await send("POST", EXC(g), { session: g.b.s.tl, body: { ...ok, compensatingAction: "   " } });
    expect(blank.status).toBe(400);
    const past = await send("POST", EXC(g), { session: g.b.s.tl, body: { ...ok, expiresOn: plusDays(today, -1) } });
    expect([
      past.status,
      (past.body as Body).code,
      (past.body as Body).detail,
      (past.body as Body).errors[0].pointer,
    ]).toEqual([422, "gate_exception.expiry_in_past", "The expiry date must be today or later.", "/expiresOn"]);
    const other = await send("POST", EXC(g), { session: g.b.s.tl, body: { ...ok, criterionKey: "g2.north_star" } });
    expect([other.status, (other.body as Body).code, (other.body as Body).detail]).toEqual([
      422,
      "gate_exception.criterion_not_mandatory",
      "An exception can only cover a mandatory criterion of this gate.",
    ]);
    expect(await exceptionsOf(g)).toBe(0);
    // Today is allowed (an exception expiring today covers today).
    const created = await send("POST", EXC(g), { session: g.b.s.tl, body: ok });
    expect([created.status, (created.body as Body).expiresOn]).toEqual([201, today]);
    expect((await auditOf(api.db, (created.body as Body).id)).map((e) => e.action)).toEqual(["gate_exception.create"]);
  });

  it("the requester cannot decide (403); a non-approver cannot (403); ADM-only 403; AUD 403 on every write", async () => {
    const g = await seedGateWorld(api, w);
    const [key] = await missingMandatory(send, g, "G1");
    const today = await todayOf(api, g);
    const both = await requesterApprover(api, w, g);
    const own = await send("POST", EXC(g), { session: both.session, body: exceptionBody(g, "G1", key!, today) });
    expect(own.status, JSON.stringify(own.body)).toBe(201);
    const self = await decide(g, own.body as Body, both.session, 1);
    expect([self.status, (self.body as Body).code, (self.body as Body).detail]).toEqual([
      403,
      "gate_exception.requester_cannot_decide",
      "The requester cannot decide their own exception.",
    ]);
    // BO holds gate_exception.decide but is not G1's configured approver (SP).
    const bo = await decide(g, own.body as Body, g.b.s.bo, 1);
    expect([bo.status, (bo.body as Body).code, (bo.body as Body).detail]).toEqual([
      403,
      "gate_exception.not_approver",
      "Only the configured approver of this gate can decide its exceptions.",
    ]);
    const adm = await decide(g, own.body as Body, g.b.s.admin, 1);
    expect(adm.status).toBe(403);
    for (const path of ["decision", "revoke", "withdraw"]) {
      const r = await send("POST", `${EXC(g)}/${(own.body as Body).id}/${path}`, {
        session: g.b.s.auditor,
        headers: ifm(1),
        body: path === "withdraw" ? undefined : { outcome: "accepted", note: "Synthetic", reason: "Synthetic" },
      });
      expect(r.status, path).toBe(403);
    }
    const audCreate = await send("POST", EXC(g), { session: g.b.s.auditor, body: exceptionBody(g, "G1", key!, today) });
    expect(audCreate.status).toBe(403);
    // Unchanged by every refusal; then the Sponsor (the configured approver, not the requester) accepts.
    const read = await send("GET", `${EXC(g)}/${(own.body as Body).id}`, { session: g.b.s.auditor });
    expect([(read.body as Body).status, (read.body as Body).version]).toEqual(["pending", 1]);
    const ok = await decide(g, own.body as Body, g.sp.session, 1);
    expect([ok.status, (ok.body as Body).decidedBy, (ok.body as Body).covering]).toEqual([200, g.sp.id, true]);
    expect((await auditOf(api.db, (own.body as Body).id)).map((e) => e.action)).toEqual([
      "gate_exception.create",
      "gate_exception.decide",
    ]);
  });

  it("one hop of delegation: a delegate holding gate_exception.decide decides for the approver (recorded on behalf)", async () => {
    const g = await seedGateWorld(api, w);
    const [key] = await missingMandatory(send, g, "G1");
    const e = await requestException(send, g, "G1", key!, await todayOf(api, g));
    const delegate = await extraUser(api, w, g.b, "BO");
    const hours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
    const del = await send("POST", "/api/v1/delegations", {
      session: g.sp.session,
      body: {
        delegateUserId: delegate.id,
        recordTypes: ["gate_exception"],
        reasonCode: "absence",
        absenceNote: "Synthetic leave",
        effectiveFrom: hours(-1),
        effectiveTo: hours(24),
      },
    });
    expect(del.status, JSON.stringify(del.body)).toBe(201);
    const r = await decide(g, e, delegate.session, 1, {
      outcome: "accepted",
      note: "Synthetic decision for the Sponsor",
      onBehalfOfUserId: g.sp.id,
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect([(r.body as Body).decidedBy, (r.body as Body).decidedOnBehalfOf]).toEqual([delegate.id, g.sp.id]);
    // Acting for someone who is not the approver (the BO) is refused.
    const e2 = await requestException(
      send,
      g,
      "G1",
      (await missingMandatory(send, g, "G1"))[1]!,
      await todayOf(api, g),
    );
    const notFor = await decide(g, e2, delegate.session, 1, {
      outcome: "accepted",
      note: "Synthetic",
      onBehalfOfUserId: g.b.users.bo.id,
    });
    expect([notFor.status, (notFor.body as Body).code]).toEqual([403, "gate_exception.not_approver"]);
  });
});

describe("expiry (REQ-S04-013; clock injected)", () => {
  it("after expires_on the exception no longer covers: the live view and the submission report the criterion missing again", async () => {
    const g = await seedGateWorld(api, w);
    const today = await todayOf(api, g);
    const covered = await coverGate(send, g, "G1", today);
    expect((await send("GET", `${g.gates}/G1`, { session: g.b.s.tl })).body.canSubmit).toBe(true);
    later(2);
    const e = await send("GET", `${EXC(g)}/${covered[0]!.id}`, { session: g.b.s.auditor });
    expect([(e.body as Body).status, (e.body as Body).covering]).toEqual(["accepted", false]);
    const view = await send("GET", `${g.gates}/G1`, { session: g.b.s.tl });
    expect((view.body as Body).canSubmit).toBe(false);
    for (const c of covered)
      expect((view.body as Body).criteria.find((x: Body) => x.key === c.key).completeness).toBe("incomplete");
    const res = await submitThroughApi(api, send, g, "G1");
    expect([res.status, (res.body as Body).detail]).toEqual([
      422,
      `Mandatory required outputs are incomplete: ${covered.map((c) => c.key).join(", ")}.`,
    ]);
    // Nothing about the exception changed: expiry is a date comparison, not a status.
    setGateExceptionClock(null);
    expect((await send("GET", `${EXC(g)}/${covered[0]!.id}`, { session: g.b.s.auditor })).body.covering).toBe(true);
  });

  it("approving a submission whose recorded exception has expired -> 422 gate.exception_expired; changes requested is allowed", async () => {
    const g = await seedGateWorld(api, w);
    const today = await todayOf(api, g);
    const covered = await coverGate(send, g, "G1", today);
    const sub = await submitThroughApi(api, send, g, "G1");
    expect(sub.status).toBe(201);
    later(2);
    const label = (
      await api.db
        .selectFrom("gate_criterion_definition")
        .select("label_en")
        .where("key", "=", covered[0]!.key)
        .executeTakeFirstOrThrow()
    ).label_en;
    const approve = await send("POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: {
        submissionNo: (sub.body as Body).submissionNo,
        outcome: "approved",
        rationale: "Synthetic demo decision; approves nothing real.",
        agreements: { problem: true, baseline: true, materialValuePools: true },
      },
    });
    expect([approve.status, (approve.body as Body).code, (approve.body as Body).detail]).toEqual([
      422,
      "gate.exception_expired",
      `The exception for ${label} expired on ${today}; it no longer covers the missing evidence.`,
    ]);
    expect(
      await api.db
        .selectFrom("gate_decision")
        .select("id")
        .where("transformation_id", "=", g.b.transformationId)
        .execute(),
    ).toHaveLength(0);
    const changes = await send("POST", `${g.gates}/G1/decision`, {
      session: g.sp.session,
      body: {
        submissionNo: (sub.body as Body).submissionNo,
        outcome: "changes_requested",
        rationale: "Synthetic: the waived evidence is now overdue.",
      },
    });
    expect(changes.status, JSON.stringify(changes.body)).toBe(201);
  });

  it("the injected clock also moves the create check: an expiry before the injected business date -> 422", async () => {
    const g = await seedGateWorld(api, w);
    later(1);
    const injectedToday = plusDays(await todayOf(api, g), 1);
    const [key] = await missingMandatory(send, g, "G1");
    const r = await send("POST", EXC(g), {
      session: g.b.s.tl,
      body: exceptionBody(g, "G1", key!, plusDays(injectedToday, -1)),
    });
    expect([r.status, (r.body as Body).code]).toEqual([422, "gate_exception.expiry_in_past"]);
  });
});

describe("revoke, withdraw and concurrency (ADR-0035 §4, §11)", () => {
  it("revoke needs a reason (400) and an accepted exception (422); after revoke the criterion is missing again", async () => {
    const g = await seedGateWorld(api, w);
    const today = await todayOf(api, g);
    const [first] = await coverGate(send, g, "G1", plusDays(today, 3));
    const url = `${EXC(g)}/${first!.id}/revoke`;
    for (const body of [{}, { reason: "  " }, { reason: "" }, { reason: null }]) {
      const r = await send("POST", url, { session: g.sp.session, headers: ifm(2), body });
      expect([r.status, (r.body as Body).errors[0].code, (r.body as Body).errors[0].pointer]).toEqual([
        400,
        "gate_exception.revoke_reason_required",
        "/reason",
      ]);
    }
    const noIfMatch = await send("POST", url, { session: g.sp.session, body: { reason: "Synthetic revoke" } });
    expect(noIfMatch.status).toBe(428);
    const stale = await send("POST", url, { session: g.sp.session, headers: ifm(1), body: { reason: "Synthetic" } });
    expect([stale.status, (stale.body as Body).currentVersion]).toEqual([409, 2]);
    const byBo = await send("POST", url, { session: g.b.s.bo, headers: ifm(2), body: { reason: "Synthetic" } });
    expect([byBo.status, (byBo.body as Body).code]).toEqual([403, "gate_exception.not_approver"]);
    const ok = await send("POST", url, {
      session: g.sp.session,
      headers: ifm(2),
      body: { reason: "Synthetic revoke" },
    });
    expect([ok.status, (ok.body as Body).status, (ok.body as Body).covering, (ok.body as Body).revokeReason]).toEqual([
      200,
      "revoked",
      false,
      "Synthetic revoke",
    ]);
    const again = await send("POST", url, { session: g.sp.session, headers: ifm(3), body: { reason: "Synthetic" } });
    expect([again.status, (again.body as Body).code, (again.body as Body).detail]).toEqual([
      422,
      "gate_exception.not_accepted",
      "Only an accepted exception can be revoked.",
    ]);
    expect((await missingMandatory(send, g, "G1")).includes(first!.key)).toBe(true);
    expect((await send("GET", `${g.gates}/G1`, { session: g.b.s.tl })).body.canSubmit).toBe(false);
    expect((await auditOf(api.db, first!.id)).map((e) => e.action)).toEqual([
      "gate_exception.create",
      "gate_exception.decide",
      "gate_exception.revoke",
    ]);
  });

  it("withdraw: the requester only, pending only, If-Match 428/409; decision If-Match 428/409", async () => {
    const g = await seedGateWorld(api, w);
    const [key] = await missingMandatory(send, g, "G1");
    const e = await requestException(send, g, "G1", key!, await todayOf(api, g));
    const url = `${EXC(g)}/${e.id}/withdraw`;
    expect((await send("POST", url, { session: g.b.s.tl })).status).toBe(428);
    const stale = await send("POST", url, { session: g.b.s.tl, headers: ifm(7) });
    expect(stale.status).toBe(409);
    const decNoIfMatch = await send("POST", `${EXC(g)}/${e.id}/decision`, {
      session: g.sp.session,
      body: { outcome: "accepted", note: "Synthetic" },
    });
    expect(decNoIfMatch.status).toBe(428);
    expect((await decide(g, e, g.sp.session, 5)).status).toBe(409);
    const other = await extraUser(api, w, g.b, "TL");
    const notMine = await send("POST", url, { session: other.session, headers: ifm(1) });
    expect(notMine.status).toBe(403);
    const ok = await send("POST", url, { session: g.b.s.tl, headers: ifm(1) });
    expect([ok.status, (ok.body as Body).status, (ok.body as Body).version]).toEqual([200, "withdrawn", 2]);
    const twice = await send("POST", url, { session: g.b.s.tl, headers: ifm(2) });
    expect([twice.status, (twice.body as Body).code]).toEqual([422, "gate_exception.not_pending"]);
    expect((await auditOf(api.db, e.id)).map((x) => x.action)).toEqual([
      "gate_exception.create",
      "gate_exception.withdraw",
    ]);
    // The approver's My Work item was created on request and cancelled on withdrawal.
    const items = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "status", "kind"])
      .where("subject_id", "=", e.id)
      .execute();
    expect(items).toEqual([{ assignee_user_id: g.sp.id, status: "cancelled", kind: "gate_exception_to_decide" }]);
  });

  it("the approver gets one gate_exception_to_decide item on request; it is done once decided; list filters", async () => {
    const g = await seedGateWorld(api, w);
    const [key] = await missingMandatory(send, g, "G1");
    const e = await requestException(send, g, "G1", key!, await todayOf(api, g));
    const open = await api.db
      .selectFrom("work_item")
      .select(["assignee_user_id", "status", "message_key", "message_params"])
      .where("subject_id", "=", e.id)
      .execute();
    expect(open).toEqual([
      {
        assignee_user_id: g.sp.id,
        status: "open",
        message_key: "gates.task.gate_exception_to_decide",
        message_params: { gateCode: "G1", criterionKey: key, expiresOn: expect.any(String) },
      },
    ]);
    await acceptException(send, g, e);
    const done = await api.db.selectFrom("work_item").select("status").where("subject_id", "=", e.id).execute();
    expect(done).toEqual([{ status: "done" }]);
    const pending = await send("GET", `${EXC(g)}?status=pending`, { session: g.b.s.auditor });
    const accepted = await send("GET", `${EXC(g)}?status=accepted&gateCode=G1`, { session: g.b.s.auditor });
    const g2 = await send("GET", `${EXC(g)}?gateCode=G2`, { session: g.b.s.auditor });
    expect([pending.body.items.length, accepted.body.items.length, g2.body.items.length]).toEqual([0, 1, 0]);
    // Outside the caller's scope: 404, existence not disclosed.
    const outsider = await send("GET", `${EXC(g)}/${e.id}`, { session: g.b.s.outsider });
    expect(outsider.status).toBe(404);
  });
});
