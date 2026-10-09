// Performance areas and their KPI and benefit links (T-DG4-BE-I; ADR-0034 §4, §9, §12; REQ-S03-002 (areas)). Proves,
// against the run's disposable PostgreSQL:
//  - an area is created establishing in cycle 1 (with its append-only cycle row), PA-nn codes, the review cadence
//    defaults (monthly x 1); no BAU owner and no review date until a handover is accepted ("not scheduled", never a
//    guessed date);
//  - REQ-S03-002 (areas half): after the transformation is closed (SYNTHETIC closure-record fixture; never archived),
//    its area stays readable and writable: edits, links and a BAU handover with acceptance still work, and the review is
//    scheduled for the BAU owner (BE-I2's scan creates the next ones);
//  - links: a KPI or a benefit of the same transformation; exactly one of the two ids (400); one active link per target
//    (409 performance_area_link.exists); removal is final; a retired area takes no change (422 performance_area.retired);
//  - every mutation: AUD 403, WL 403 (no performance_area.manage), ADM-only and outsider 404 (reads too), If-Match
//    428/409, one audit event per change, commit-time authorization.
// All data is SYNTHETIC; nothing here is a business approval; nothing touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody } from "../benefits/fixtures.ts";
import {
  areaInBau,
  closeTransformationSynthetic,
  createArea,
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

const RETIRED = "This performance area is retired and can no longer be changed.";

describe("performance areas (ADR-0034 §4)", () => {
  it("creates an establishing area in cycle 1 with defaults; reads it with its cycle; audits both rows", async () => {
    const r = await send("POST", s.areas, {
      session: s.to.session,
      body: { name: "Synthetic care journey performance", description: "Synthetic", businessUnitId: w.a1 },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.etag).toBe('"1"');
    expect(r.headers.location).toBe(`${s.areas}/${r.body.id}`);
    expect(r.body).toMatchObject({
      code: expect.stringMatching(/^PA-[0-9]{2,6}$/),
      status: "establishing",
      cycleNo: 1,
      reviewFrequency: "monthly",
      reviewInterval: 1,
      bauOwnerUserId: null,
      kpiOwnerUserId: null,
      nextReviewDate: null,
      currentHandoverId: null,
      businessUnitId: w.a1,
      transformationId: s.b.transformationId,
    });
    expect(r.body.cycles).toEqual([
      {
        cycleNo: 1,
        openedAt: expect.any(String),
        openedBy: s.to.id,
        reopenReason: null,
        priorHandoverId: null,
        priorHandoverAcceptedAt: null,
        priorHandoverAcceptedBy: null,
        priorClosureRecordId: null,
        priorClosedAt: null,
      },
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["performance_area.create", 1],
    ]);
    const cycle = await api.db
      .selectFrom("performance_area_cycle")
      .select("id")
      .where("performance_area_id", "=", r.body.id)
      .executeTakeFirstOrThrow();
    expect((await auditOf(api.db, cycle.id)).map((a) => a.action)).toEqual(["performance_area_cycle.create"]);
  });

  it("validation: blank name 400, unknown member 400, a business unit of another organization 422, sponsor active", async () => {
    expect((await send("POST", s.areas, { session: s.b.s.bo, body: { name: "  " } })).status).toBe(400);
    expect((await send("POST", s.areas, { session: s.b.s.bo, body: { name: "x", extra: 1 } })).status).toBe(400);
    expect(
      (await send("POST", s.areas, { session: s.b.s.bo, body: { name: "x", reviewFrequency: "daily" } })).status,
    ).toBe(400);
    const bu = await send("POST", s.areas, { session: s.b.s.bo, body: { name: "x", businessUnitId: w.b1 } });
    expect([bu.status, bu.body.errors[0].pointer]).toEqual([422, "/businessUnitId"]);
    const sp = await send("POST", s.areas, { session: s.b.s.bo, body: { name: "x", sponsorUserId: w.disabled.id } });
    expect([sp.status, sp.body.code]).toEqual([422, "validation.user_invalid"]);
  });

  it("update with If-Match (428/409); list with status filter and pagination; retire is final", async () => {
    const a = await createArea(send, s);
    const A = `${s.areas}/${a.id}`;
    expect((await send("PATCH", A, { session: s.b.s.bo, body: { name: "y" } })).status).toBe(428);
    const stale = await send("PATCH", A, { session: s.b.s.bo, headers: ifm(9), body: { name: "y" } });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    expect((await send("PATCH", A, { session: s.b.s.bo, headers: ifm(1), body: {} })).status).toBe(400);
    const upd = await send("PATCH", A, {
      session: s.b.s.bo,
      headers: ifm(1),
      body: {
        name: "Synthetic renamed",
        reviewFrequency: "quarterly",
        reviewInterval: 2,
        sponsorUserId: s.b.users.tl.id,
      },
    });
    expect([upd.status, upd.body.name, upd.body.reviewFrequency, upd.body.reviewInterval, upd.body.version]).toEqual([
      200,
      "Synthetic renamed",
      "quarterly",
      2,
      2,
    ]);
    expect((await auditOf(api.db, a.id)).at(-1)).toMatchObject({
      action: "performance_area.update",
      prior_version: 1,
      new_version: 2,
    });
    const retireNoReason = await send("POST", `${A}/retire`, { session: s.b.s.bo, headers: ifm(2), body: {} });
    expect(retireNoReason.status).toBe(400);
    const ret = await send("POST", `${A}/retire`, {
      session: s.b.s.bo,
      headers: ifm(2),
      body: { reason: "Synthetic: merged" },
    });
    expect([ret.status, ret.body.status, ret.body.retireReason, ret.body.retiredAt !== null]).toEqual([
      200,
      "retired",
      "Synthetic: merged",
      true,
    ]);
    for (const [method, path, body] of [
      ["PATCH", A, { name: "z" }],
      ["POST", `${A}/retire`, { reason: "again" }],
      ["POST", `${A}/links`, { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId }],
    ] as const) {
      const r = await send(method, path, { session: s.b.s.bo, headers: ifm(3), body });
      expect([r.status, r.body.code, r.body.detail]).toEqual([422, "performance_area.retired", RETIRED]);
    }
    const page1 = await send("GET", `${s.areas}?limit=1`, { session: s.b.s.auditor });
    expect([page1.status, page1.body.items.length, typeof page1.body.nextCursor]).toEqual([200, 1, "string"]);
    const page2 = await send("GET", `${s.areas}?limit=1&cursor=${encodeURIComponent(page1.body.nextCursor)}`, {
      session: s.b.s.auditor,
    });
    expect(page2.body.items[0].id).not.toBe(page1.body.items[0].id);
    const retiredOnly = await send("GET", `${s.areas}?status=retired`, { session: s.b.s.auditor });
    expect(retiredOnly.body.items.map((i: { id: string }) => i.id)).toContain(a.id);
    expect(retiredOnly.body.items.every((i: { status: string }) => i.status === "retired")).toBe(true);
    expect((await send("GET", `${s.areas}?status=closed`, { session: s.b.s.auditor })).status).toBe(400);
  });

  it("gates: AUD and WL 403 on every write, ADM-only and an outsider 404 (reads too)", async () => {
    const a = await createArea(send, s);
    const A = `${s.areas}/${a.id}`;
    for (const [session, status] of [
      [s.b.s.auditor, 403],
      [s.wl.session, 403],
      [s.b.s.fin, 403],
      [s.b.s.admin, 404],
      [s.b.s.outsider, 404],
    ] as const) {
      expect((await send("POST", s.areas, { session, body: { name: "x" } })).status).toBe(status);
      expect((await send("PATCH", A, { session, headers: ifm(1), body: { name: "x" } })).status).toBe(status);
      expect(
        (await send("POST", `${A}/retire`, { session, headers: ifm(1), body: { reason: "Synthetic" } })).status,
      ).toBe(status);
      expect(
        (await send("POST", `${A}/links`, { session, body: { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId } }))
          .status,
      ).toBe(status);
    }
    for (const session of [s.b.s.admin, s.b.s.outsider]) {
      expect((await send("GET", s.areas, { session })).status).toBe(404);
      expect((await send("GET", A, { session })).status).toBe(404);
      expect((await send("GET", `${A}/links`, { session })).status).toBe(404);
    }
    expect((await send("GET", `${s.areas}/00000000-0000-7000-8000-000000000000`, { session: s.b.s.bo })).status).toBe(
      404,
    );
  });

  it("commit-time: performance_area.manage revoked while the create waited is 403; nothing written", async () => {
    const u = await extraUser(api, w, s.b, "TO");
    const before = await api.db
      .selectFrom("performance_area")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", s.b.transformationId)
      .executeTakeFirstOrThrow();
    const res = await afterIdentity(
      api,
      u.id,
      () => call(api.app, "POST", s.areas, { session: u.session, body: { name: "Synthetic late" }, contract: false }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const after = await api.db
      .selectFrom("performance_area")
      .select((eb) => eb.fn.countAll<string>().as("n"))
      .where("transformation_id", "=", s.b.transformationId)
      .executeTakeFirstOrThrow();
    expect(after.n).toBe(before.n);
  });
});

describe("links: the area's KPIs and benefits", () => {
  it("links a KPI and a benefit of the transformation once; exactly one target; removal is final", async () => {
    const a = await createArea(send, s);
    const L = `${s.areas}/${a.id}/links`;
    const both = await send("POST", L, {
      session: s.b.s.bo,
      body: { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId, benefitId: s.b.kpiDefinitionId },
    });
    expect([both.status, both.body.errors[0].pointer]).toEqual([400, "/benefitId"]);
    const none = await send("POST", L, { session: s.b.s.bo, body: { linkKind: "benefit" } });
    expect([none.status, none.body.errors[0].pointer]).toEqual([400, "/benefitId"]);
    const foreign = await send("POST", L, {
      session: s.b.s.bo,
      body: { linkKind: "benefit", benefitId: "00000000-0000-7000-8000-000000000000" },
    });
    expect([foreign.status, foreign.body.code, foreign.body.errors[0].pointer]).toEqual([
      422,
      "validation.reference",
      "/benefitId",
    ]);
    const k = await send("POST", L, {
      session: s.to.session,
      body: { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId },
    });
    expect([k.status, k.body.linkKind, k.body.kpiDefinitionId, k.body.benefitId, k.body.status]).toEqual([
      201,
      "kpi",
      s.b.kpiDefinitionId,
      null,
      "active",
    ]);
    const dup = await send("POST", L, {
      session: s.to.session,
      body: { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId },
    });
    expect([dup.status, dup.body.type, dup.body.code, dup.body.detail]).toEqual([
      409,
      "urn:mth:problem:duplicate",
      "performance_area_link.exists",
      "This KPI or benefit is already linked to the performance area.",
    ]);
    const benefit = await send("POST", `${s.b.base}/benefits`, { session: s.b.s.bo, body: financialBody(s.b) });
    const bl = await send("POST", L, { session: s.b.s.bo, body: { linkKind: "benefit", benefitId: benefit.body.id } });
    expect(bl.status).toBe(201);
    const list = await send("GET", L, { session: s.b.s.auditor });
    expect(list.body.items.map((i: { id: string }) => i.id).sort()).toEqual([k.body.id, bl.body.id].sort());
    const R = `${L}/${k.body.id}/remove`;
    expect((await send("POST", R, { session: s.b.s.bo })).status).toBe(428);
    expect((await send("POST", R, { session: s.b.s.auditor, headers: ifm(1) })).status).toBe(403);
    const removed = await send("POST", R, { session: s.b.s.bo, headers: ifm(1) });
    expect([removed.status, removed.body.status, removed.body.removedBy, removed.body.version]).toEqual([
      200,
      "removed",
      s.b.users.bo.id,
      2,
    ]);
    const again = await send("POST", R, { session: s.b.s.bo, headers: ifm(2) });
    expect([again.status, again.body.type]).toEqual([422, "urn:mth:problem:invalid-transition"]);
    // After removal the same KPI can be linked again (one ACTIVE link per target).
    expect(
      (await send("POST", L, { session: s.b.s.bo, body: { linkKind: "kpi", kpiDefinitionId: s.b.kpiDefinitionId } }))
        .status,
    ).toBe(201);
    expect((await auditOf(api.db, k.body.id)).map((x) => x.action)).toEqual([
      "performance_area_link.create",
      "performance_area_link.remove",
    ]);
  });
});

describe("areas outlive their transformation (REQ-S03-002, areas half)", () => {
  it("after the transformation is closed, its area takes edits, links and a BAU handover with its review", async () => {
    const s2 = await seedSustainmentWorld(api, w);
    const pre = await createArea(send, s2);
    await closeTransformationSynthetic(api, s2.b);
    const t = await api.db
      .selectFrom("transformation")
      .select(["status", "archived_at"])
      .where("id", "=", s2.b.transformationId)
      .executeTakeFirstOrThrow();
    expect(t).toEqual({ status: "closed", archived_at: null });
    const A = `${s2.areas}/${pre.id}`;
    const upd = await send("PATCH", A, { session: s2.b.s.bo, headers: ifm(1), body: { description: "After closure" } });
    expect([upd.status, upd.body.status]).toEqual([200, "establishing"]);
    expect(
      (
        await send("POST", `${A}/links`, {
          session: s2.b.s.bo,
          body: { linkKind: "kpi", kpiDefinitionId: s2.b.kpiDefinitionId },
        })
      ).status,
    ).toBe(201);
    // A whole handover after closure: prepared, submitted and accepted; the area is in BAU with its review scheduled.
    const { area } = await areaInBau(api, s2);
    const read = await send("GET", `${s2.areas}/${area.id}`, { session: s2.b.s.auditor });
    expect([read.body.status, read.body.bauOwnerUserId, read.body.nextReviewDate === null]).toEqual([
      "bau",
      s2.b.users.bo.id,
      false,
    ]);
    const reviews = await api.db
      .selectFrom("sustainment_review")
      .select(["assignee_user_id", "due_date"])
      .where("performance_area_id", "=", area.id)
      .execute();
    expect(reviews.map((r) => [r.assignee_user_id, String(r.due_date).slice(0, 10)])).toEqual([
      [s2.b.users.bo.id, read.body.nextReviewDate],
    ]);
  });
});
