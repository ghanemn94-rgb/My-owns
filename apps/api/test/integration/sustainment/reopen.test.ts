// Reopening a deteriorating performance area preserves the earlier handover and closure history (T-DG4-BE-I;
// ADR-0034 §4, §12; REQ-S11-009). Proves, against the run's disposable PostgreSQL:
//  - REQ-S11-009 A11 "after reopening, the original handover acceptance and closure date remain visible and unchanged":
//    the transformation is closed (SYNTHETIC closure-record fixture until BE-J routes closeTransformation), the BAU area
//    is reopened, and getPerformanceArea shows cycle 2 linked to the prior accepted handover (its acceptance time and
//    acceptor) and to the closure (its id and closure time), exactly as they were; the accepted handover row and the
//    closure record are byte-for-byte unchanged; cycle 1 is unchanged;
//  - a new handover for cycle 2 is accepted and the area returns to BAU, keeping both cycles;
//  - the refusals: 400 performance_area.reopen_reason_required at /reason, 422 performance_area.not_reopenable
//    (invalid-transition) for an establishing or reopened area, 422 performance_area.retired; AUD/TO 403 (TO holds no
//    performance_area.reopen), ADM 404; If-Match 428/409; one audit event per written row.
// All data is SYNTHETIC; the closure and acceptance here approve nothing real; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  areaInBau,
  closeTransformationSynthetic,
  createArea,
  createNoteEvidence,
  fullContent,
  seedSustainmentWorld,
  type SustainmentWorld,
} from "../contract/p4-exercises-be-i.ts";

let api: TestApi;
let w: World;
let s: SustainmentWorld;
const send = (m: string, u: string, o?: Parameters<typeof call>[3]) => call(api.app, m, u, o);
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  s = await seedSustainmentWorld(api, w);
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const NOT_REOPENABLE = "Only a performance area in BAU can be reopened.";
const reason = { reason: "Synthetic: churn deteriorating two months in a row" };

describe("reopening preserves the original handover acceptance and closure date (REQ-S11-009)", () => {
  it("after the transformation closed, reopen -> cycle 2 linked to the prior handover and closure; nothing overwritten", async () => {
    const { area, handover } = await areaInBau(api, s);
    const A = `${s.areas}/${area.id}`;
    const closure = await closeTransformationSynthetic(api, s.b);
    const handoverBefore = await api.db
      .selectFrom("bau_handover")
      .selectAll()
      .where("id", "=", handover.id)
      .executeTakeFirstOrThrow();
    const closureBefore = await api.db
      .selectFrom("closure_record")
      .selectAll()
      .where("id", "=", closure.closureRecordId)
      .executeTakeFirstOrThrow();
    const before = await send("GET", A, { session: s.b.s.auditor });
    expect([before.body.status, before.body.cycles.length]).toEqual(["bau", 1]);

    const reopened = await send("POST", `${A}/reopen`, {
      session: s.b.s.tl,
      headers: ifm(before.body.version),
      body: reason,
    });
    expect(reopened.status, JSON.stringify(reopened.body)).toBe(200);
    expect([
      reopened.body.status,
      reopened.body.cycleNo,
      reopened.body.currentHandoverId,
      reopened.body.nextReviewDate,
    ]).toEqual(["reopened", 2, handover.id, null]);

    const read = await send("GET", A, { session: s.b.s.auditor });
    expect(read.body.cycles).toHaveLength(2);
    expect(read.body.cycles[0]).toEqual(before.body.cycles[0]);
    expect(read.body.cycles[1]).toMatchObject({
      cycleNo: 2,
      openedBy: s.b.users.tl.id,
      reopenReason: reason.reason,
      priorHandoverId: handover.id,
      priorHandoverAcceptedAt: handover.acceptedAt,
      priorHandoverAcceptedBy: handover.acceptedBy,
      priorClosureRecordId: closure.closureRecordId,
      priorClosedAt: closure.closedAt,
    });
    // The accepted handover and the closure record are unchanged, row for row.
    expect(
      await api.db.selectFrom("bau_handover").selectAll().where("id", "=", handover.id).executeTakeFirstOrThrow(),
    ).toEqual(handoverBefore);
    expect(
      await api.db
        .selectFrom("closure_record")
        .selectAll()
        .where("id", "=", closure.closureRecordId)
        .executeTakeFirstOrThrow(),
    ).toEqual(closureBefore);
    const original = await send("GET", `${s.handovers}/${handover.id}`, { session: s.b.s.auditor });
    expect([original.body.status, original.body.acceptedAt, original.body.acceptedBy]).toEqual([
      "accepted",
      handover.acceptedAt,
      handover.acceptedBy,
    ]);
    expect((await auditOf(api.db, area.id)).map((a) => a.action)).toEqual([
      "performance_area.create",
      "performance_area.bau_accepted",
      "performance_area.reopen",
    ]);

    // A new handover for cycle 2, accepted; the area returns to BAU with both cycles kept.
    const evidenceId = await createNoteEvidence(send, s.b, s.wl.session, s.wl.id);
    const ho2 = await send("POST", s.handovers, {
      session: s.wl.session,
      body: { performanceAreaId: area.id, receivingOwnerUserId: s.b.users.bo.id, ...fullContent(s.b.users.bo.id) },
    });
    expect([ho2.status, ho2.body.cycleNo]).toEqual([201, 2]);
    const H2 = `${s.handovers}/${ho2.body.id}`;
    const ev = await send("POST", `${H2}/evidence`, { session: s.wl.session, headers: ifm(1), body: { evidenceId } });
    const sub = await send("POST", `${H2}/submit`, { session: s.wl.session, headers: ifm(ev.body.version) });
    const acc = await send("POST", `${H2}/accept`, { session: s.b.s.bo, headers: ifm(sub.body.version), body: {} });
    expect(acc.status, JSON.stringify(acc.body)).toBe(200);
    const back = await send("GET", A, { session: s.b.s.auditor });
    expect([back.body.status, back.body.cycleNo, back.body.currentHandoverId, back.body.cycles.length]).toEqual([
      "bau",
      2,
      ho2.body.id,
      2,
    ]);
    expect(back.body.cycles[1].priorHandoverAcceptedAt).toBe(handover.acceptedAt);
    expect(back.body.cycles[1].priorClosedAt).toBe(closure.closedAt);
    // The BAU owner has the review of the new next review date exactly once, after closure (the origin transformation is
    // closed). Re-acceptance on the same business date gives the same due date, so the unique key keeps one review.
    const reviews = await api.db
      .selectFrom("sustainment_review")
      .select(["assignee_user_id", "due_date"])
      .where("performance_area_id", "=", area.id)
      .where("due_date", "=", back.body.nextReviewDate)
      .execute();
    expect(reviews.map((r) => r.assignee_user_id)).toEqual([s.b.users.bo.id]);
  });
});

describe("reopen refusals and gates", () => {
  it("only an area in BAU can be reopened (422 invalid-transition); a reason is required (400)", async () => {
    const est = await createArea(send, s);
    const A = `${s.areas}/${est.id}`;
    const r = await send("POST", `${A}/reopen`, { session: s.b.s.bo, headers: ifm(1), body: reason });
    expect([r.status, r.body.type, r.body.code, r.body.detail]).toEqual([
      422,
      "urn:mth:problem:invalid-transition",
      "performance_area.not_reopenable",
      NOT_REOPENABLE,
    ]);
    for (const body of [{}, { reason: "" }, { reason: "   " }, null]) {
      const bad = await send("POST", `${A}/reopen`, { session: s.b.s.bo, headers: ifm(1), body });
      expect([bad.status, bad.body.errors?.[0]]).toEqual([
        400,
        {
          pointer: "/reason",
          code: "performance_area.reopen_reason_required",
          message: "A reason is required to reopen a performance area.",
        },
      ]);
    }
    const unknown = await send("POST", `${A}/reopen`, {
      session: s.b.s.bo,
      headers: ifm(1),
      body: { ...reason, x: 1 },
    });
    expect(unknown.status).toBe(400);
    const retired = await send("POST", `${A}/retire`, { session: s.b.s.bo, headers: ifm(1), body: reason });
    expect(retired.status).toBe(200);
    const again = await send("POST", `${A}/reopen`, { session: s.b.s.bo, headers: ifm(2), body: reason });
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "performance_area.retired",
      "This performance area is retired and can no longer be changed.",
    ]);
  });

  it("a reopened area cannot be reopened again; AUD and TO 403, ADM 404; If-Match 428/409", async () => {
    // A fresh transformation world (the first one is closed above; reopening is unaffected either way).
    const s2 = await seedSustainmentWorld(api, w);
    const { area } = await areaInBau(api, s2);
    const A = `${s2.areas}/${area.id}`;
    const v = (await send("GET", A, { session: s2.b.s.auditor })).body.version;
    for (const [session, status] of [
      [s2.b.s.auditor, 403],
      [s2.to.session, 403],
      [s2.wl.session, 403],
      [s2.b.s.admin, 404],
      [s2.b.s.outsider, 404],
    ] as const)
      expect((await send("POST", `${A}/reopen`, { session, headers: ifm(v), body: reason })).status).toBe(status);
    expect((await send("POST", `${A}/reopen`, { session: s2.b.s.bo, body: reason })).status).toBe(428);
    const stale = await send("POST", `${A}/reopen`, { session: s2.b.s.bo, headers: ifm(v + 1), body: reason });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, v]);
    const ok = await send("POST", `${A}/reopen`, { session: s2.b.s.bo, headers: ifm(v), body: reason });
    expect([ok.status, ok.body.cycleNo, ok.body.cycles[1].priorClosureRecordId]).toEqual([200, 2, null]);
    const twice = await send("POST", `${A}/reopen`, {
      session: s2.b.s.bo,
      headers: ifm(ok.body.version),
      body: reason,
    });
    expect([twice.status, twice.body.code]).toEqual([422, "performance_area.not_reopenable"]);
    const cycles = await api.db
      .selectFrom("performance_area_cycle")
      .select(["id", "cycle_no"])
      .where("performance_area_id", "=", area.id)
      .execute();
    expect(cycles.map((c) => c.cycle_no).sort()).toEqual([1, 2]);
    for (const c of cycles)
      expect((await auditOf(api.db, c.id)).map((a) => a.action)).toEqual(["performance_area_cycle.create"]);
  });
});
