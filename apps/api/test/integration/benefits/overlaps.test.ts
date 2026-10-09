// Overlap warnings and their Finance resolution (T-DG4-KBE-D2; ADR-0029 §7, §9, §11; REQ-S08-014). Proves, against the
// run's disposable PostgreSQL:
//  - A10 "two benefits using the same driver and period raise a warning and remain excluded from validated totals
//    until Finance resolves": the rule raises the warning on createBenefit and on an updateBenefit that changes the
//    keys; while it is open both benefits are `overlapOpen` in benefit_counting (the totals' exclusion input); Finance's
//    resolution lifts it (no_economic_overlap) or excludes one side for good (duplicate -> overlap_duplicate);
//  - "Overlap detected -> Finance task": one benefit_overlap_review work item per Finance recipient (the mapped FIN
//    party, else the finance.validate holders), created once and closed by the resolution;
//  - the exact §11 refusals; FIN only (BO, TL, AUD and ADM-only get 403); never the owner of either benefit; If-Match
//    428/409; one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here grants a real business or Finance approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, financialBody, seedBenefitWorld, type BenefitWorld } from "./fixtures.ts";

let api: TestApi;
let w: World;
let b: BenefitWorld;
let B: string;
let O: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  B = `${b.base}/benefits`;
  O = `${b.base}/benefit-overlaps`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

let seq = 0;
const driver = () => `synthetic.driver.${(seq += 1)}`;
const newBenefit = async (extra: Record<string, unknown> = {}, world: BenefitWorld = b) => {
  const r = await call(api.app, "POST", `${world.base}/benefits`, {
    session: world.s.bo,
    body: financialBody(world, extra),
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; code: string };
};
const openOverlaps = (id: string) =>
  api.db
    .selectFrom("benefit_overlap")
    .selectAll()
    .where((eb) => eb.or([eb("benefit_a_id", "=", id), eb("benefit_b_id", "=", id)]))
    .where("status", "=", "open")
    .execute();
const counting = async (id: string) =>
  (await call(api.app, "GET", `${B}/${id}`, { session: b.s.auditor })).body.counting as {
    counted: boolean;
    exclusionReason: string | null;
    overlapOpen: boolean;
  };
const tasksOf = (overlapId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["kind", "assignee_user_id", "status", "dedupe_key", "message_key", "link_path"])
    .where("subject_type", "=", "benefit_overlap")
    .where("subject_id", "=", overlapId)
    .execute();
const sorted = (ids: string[]) => [...ids].sort();

describe("the overlap rule (REQ-S08-014)", () => {
  it("same driver and period -> a warning, a Finance task, both excluded until Finance resolves", async () => {
    const d = driver();
    const window = { realizationStart: "2026-01-01", realizationEnd: "2026-12-31" };
    const one = await newBenefit({ driverKey: d, ...window, plannedValue: "10000000" });
    expect(await openOverlaps(one.id)).toEqual([]);
    const two = await newBenefit({ driverKey: d, realizationStart: "2026-06-01", realizationEnd: "2027-05-31" });
    const [warning, ...more] = await openOverlaps(two.id);
    expect(more).toEqual([]);
    expect(warning).toMatchObject({
      benefit_a_id: sorted([one.id, two.id])[0],
      benefit_b_id: sorted([one.id, two.id])[1],
      driver_key: d,
      population_key: null,
      detected_by: "rule",
      status: "open",
      version: 1,
    });
    const got = await call(api.app, "GET", `${O}/${warning!.id}`, { session: b.s.auditor });
    expect([got.status, got.headers.etag, got.body.dimensions, got.body.overlapStart, got.body.overlapEnd]).toEqual([
      200,
      '"1"',
      ["driver", "period"],
      "2026-06-01",
      "2026-12-31",
    ]);
    // Excluded from validated totals while open: benefit_counting.overlap_open is the totals' exclusion input.
    for (const id of [one.id, two.id]) expect((await counting(id)).overlapOpen).toBe(true);
    const view = await api.db
      .selectFrom("benefit_counting")
      .select(["benefit_id", "overlap_open"])
      .where("benefit_id", "in", [one.id, two.id])
      .execute();
    expect(view.every((v) => v.overlap_open)).toBe(true);
    // One audit event; one Finance task (the world's only FIN user, unmapped party -> finance.validate holders).
    expect((await auditOf(api.db, warning!.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["benefit_overlap.detect", 1],
    ]);
    expect(await tasksOf(warning!.id)).toEqual([
      {
        kind: "benefit_overlap_review",
        assignee_user_id: b.users.fin.id,
        status: "open",
        dedupe_key: `benefit.overlap:${warning!.id}:${b.users.fin.id}`,
        message_key: "benefits.task.overlap_review",
        link_path: `/transformations/${b.transformationId}/benefit-overlaps/${warning!.id}`,
      },
    ]);
    // Finance resolves: no economic overlap -> both count again; the task is done.
    const resolved = await call(api.app, "POST", `${O}/${warning!.id}/resolve`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { resolution: "no_economic_overlap", note: "Different customer bases (synthetic)." },
    });
    expect([resolved.status, resolved.body.status, resolved.body.resolution, resolved.body.resolvedBy]).toEqual([
      200,
      "resolved",
      "no_economic_overlap",
      b.users.fin.id,
    ]);
    expect(resolved.headers.etag).toBe('"2"');
    for (const id of [one.id, two.id])
      expect(await counting(id)).toEqual({ counted: true, exclusionReason: null, overlapOpen: false });
    expect((await tasksOf(warning!.id)).map((t) => t.status)).toEqual(["done"]);
    expect((await auditOf(api.db, warning!.id)).map((a) => a.action)).toEqual([
      "benefit_overlap.detect",
      "benefit_overlap.resolve",
    ]);
  });

  it("a duplicate resolution excludes the named benefit for good (overlap_duplicate); the other counts", async () => {
    const d = driver();
    const one = await newBenefit({ driverKey: d });
    const two = await newBenefit({ driverKey: d });
    const [warning] = await openOverlaps(two.id);
    const r = await call(api.app, "POST", `${O}/${warning!.id}/resolve`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { resolution: "duplicate", excludedBenefitId: two.id, note: "Same churn pool claimed twice (synthetic)." },
    });
    expect([r.status, r.body.excludedBenefitId]).toEqual([200, two.id]);
    expect(await counting(one.id)).toEqual({ counted: true, exclusionReason: null, overlapOpen: false });
    expect(await counting(two.id)).toEqual({
      counted: false,
      exclusionReason: "overlap_duplicate",
      overlapOpen: false,
    });
  });

  it("population adds a dimension; other drivers and disjoint windows raise nothing; a missing window overlaps", async () => {
    const d = driver();
    const base = await newBenefit({
      driverKey: d,
      populationKey: "segment.youth",
      realizationStart: "2026-01-01",
      realizationEnd: "2026-06-30",
    });
    const samePop = await newBenefit({
      driverKey: d,
      populationKey: "segment.youth",
      realizationStart: "2026-03-01",
      realizationEnd: "2026-04-30",
    });
    const [p] = await openOverlaps(samePop.id);
    expect((await call(api.app, "GET", `${O}/${p!.id}`, { session: b.s.tl })).body.dimensions).toEqual([
      "driver",
      "population",
      "period",
    ]);
    const otherDriver = await newBenefit({ driverKey: driver(), populationKey: "segment.youth" });
    expect(await openOverlaps(otherDriver.id)).toEqual([]);
    const later = await newBenefit({ driverKey: d, realizationStart: "2026-07-01", realizationEnd: "2026-12-31" });
    // `later` is disjoint from base and samePop by window.
    expect(await openOverlaps(later.id)).toEqual([]);
    const noWindow = await newBenefit({ driverKey: d });
    expect((await openOverlaps(noWindow.id)).length).toBe(3);
    expect((await openOverlaps(base.id)).length).toBe(2);
  });

  it("an update that changes the keys raises a warning; an update of other fields or an open pair raises none", async () => {
    const d = driver();
    const one = await newBenefit({ driverKey: d, realizationStart: "2026-01-01", realizationEnd: "2026-03-31" });
    const two = await newBenefit({ driverKey: d, realizationStart: "2026-06-01", realizationEnd: "2026-09-30" });
    expect(await openOverlaps(one.id)).toEqual([]);
    const retitled = await call(api.app, "PATCH", `${B}/${two.id}`, {
      session: b.s.bo,
      headers: ifm(1),
      body: { title: "Synthetic retitled" },
    });
    expect(retitled.status).toBe(200);
    expect(await openOverlaps(one.id)).toEqual([]);
    const moved = await call(api.app, "PATCH", `${B}/${two.id}`, {
      session: b.s.bo,
      headers: ifm(2),
      body: { realizationStart: "2026-03-01" },
    });
    expect(moved.status, JSON.stringify(moved.body)).toBe(200);
    expect(moved.body.counting.overlapOpen).toBe(true);
    const [warning] = await openOverlaps(one.id);
    expect([warning!.overlap_start, warning!.overlap_end].map(String)).toEqual(["2026-03-01", "2026-03-31"]);
    // Changing the keys again while the pair's warning is open raises no second warning (one open per pair).
    await call(api.app, "PATCH", `${B}/${two.id}`, {
      session: b.s.bo,
      headers: ifm(3),
      body: { realizationEnd: null },
    });
    expect((await openOverlaps(one.id)).length).toBe(1);
    // After a resolution, a later key change raises a new warning.
    await call(api.app, "POST", `${O}/${warning!.id}/resolve`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { resolution: "no_economic_overlap", note: "Checked by Finance (synthetic)." },
    });
    await call(api.app, "PATCH", `${B}/${two.id}`, {
      session: b.s.bo,
      headers: ifm(4),
      body: { realizationEnd: "2026-12-31" },
    });
    expect((await openOverlaps(one.id)).length).toBe(1);
  });
});

describe("Finance resolution refusals (ADR-0029 §11)", () => {
  const raise = async () => {
    const d = driver();
    const one = await newBenefit({ driverKey: d });
    const two = await newBenefit({ driverKey: d });
    const [warning] = await openOverlaps(two.id);
    return { one, two, id: warning!.id, url: `${O}/${warning!.id}/resolve` };
  };

  it("FIN only: BO, TL, AUD and ADM-only get 403 forbidden; nothing written", async () => {
    const { id, url } = await raise();
    for (const session of [b.s.bo, b.s.tl, b.s.auditor, b.s.admin]) {
      const r = await call(api.app, "POST", url, {
        session,
        headers: ifm(1),
        body: { resolution: "no_economic_overlap", note: "Synthetic" },
      });
      expect([r.status, r.body.type]).toEqual([403, "urn:mth:problem:forbidden"]);
    }
    expect(
      (await api.db.selectFrom("benefit_overlap").select("status").where("id", "=", id).executeTakeFirstOrThrow())
        .status,
    ).toBe("open");
  });

  it("the exact 422s: excluded benefit, note, not open; If-Match 428/409; 404 outside the scope", async () => {
    const { one, url } = await raise();
    const send = (body: Record<string, unknown>, headers: Record<string, string> = ifm(1)) =>
      call(api.app, "POST", url, { session: b.s.fin, headers, body });
    const excluded = [
      422,
      "benefit_overlap.excluded_required",
      "A duplicate resolution names which of the two benefits is not counted.",
    ];
    const r1 = await send({ resolution: "duplicate", note: "Synthetic" });
    expect([r1.status, r1.body.code, r1.body.detail]).toEqual(excluded);
    const stranger = await newBenefit();
    const r2 = await send({ resolution: "duplicate", excludedBenefitId: stranger.id, note: "Synthetic" });
    expect([r2.status, r2.body.code]).toEqual(excluded.slice(0, 2));
    const r3 = await send({ resolution: "no_economic_overlap", excludedBenefitId: one.id, note: "Synthetic" });
    expect([r3.status, r3.body.code]).toEqual(excluded.slice(0, 2));
    const r4 = await send({ resolution: "no_economic_overlap" });
    expect([r4.status, r4.body.code, r4.body.detail]).toEqual([
      422,
      "benefit_overlap.note_required",
      "A resolution needs a note.",
    ]);
    expect((await send({ resolution: "no_economic_overlap", note: "Synthetic" }, {})).status).toBe(428);
    expect((await send({ resolution: "no_economic_overlap", note: "Synthetic" }, ifm(7))).status).toBe(409);
    expect((await send({ resolution: "no_economic_overlap", note: "  " })).status).toBe(400);
    expect(
      (
        await call(api.app, "POST", url, {
          session: b.s.outsider,
          headers: ifm(1),
          body: { resolution: "no_economic_overlap", note: "Synthetic" },
        })
      ).status,
    ).toBe(403);
    const ok = await send({ resolution: "no_economic_overlap", note: "Synthetic" });
    expect(ok.status).toBe(200);
    const again = await send({ resolution: "no_economic_overlap", note: "Synthetic" }, ifm(2));
    expect([again.status, again.body.code, again.body.detail]).toEqual([
      422,
      "benefit_overlap.not_open",
      "Only an open overlap warning can be resolved.",
    ]);
  });

  it("a Finance user who owns one of the benefits gets 403 benefit_overlap.resolver_is_owner and no task", async () => {
    const d = driver();
    await newBenefit({ driverKey: d });
    const owned = await newBenefit({ driverKey: d, ownerUserId: b.users.fin.id });
    const [warning] = await openOverlaps(owned.id);
    expect(await tasksOf(warning!.id)).toEqual([]);
    const r = await call(api.app, "POST", `${O}/${warning!.id}/resolve`, {
      session: b.s.fin,
      headers: ifm(1),
      body: { resolution: "no_economic_overlap", note: "Synthetic" },
    });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      403,
      "benefit_overlap.resolver_is_owner",
      "You own one of the overlapping benefits, so you cannot resolve this overlap.",
    ]);
  });

  it("commit-time: a FIN grant revoked while the resolution waited is 403; nothing written", async () => {
    const { id, url } = await raise();
    const u = await extraUser(api, w, b, "FIN");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "POST", url, {
          session: u.session,
          headers: ifm(1),
          body: { resolution: "no_economic_overlap", note: "Late resolution" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("benefit_overlap")
      .select(["status", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ status: "open", version: 1 });
  });
});

describe("user-raised warnings, list and read (REQ-S08-014)", () => {
  it("TL raises a warning between two benefits; a second one for the pair is 409; same benefit 422; others 403", async () => {
    const one = await newBenefit({ driverKey: driver() });
    const two = await newBenefit({ driverKey: driver() });
    const body = { benefitAId: two.id, benefitBId: one.id, dimensions: ["population", "driver"] };
    const r = await call(api.app, "POST", O, { session: b.s.tl, body });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect([r.body.detectedBy, r.body.dimensions, r.body.benefitAId, r.headers.etag]).toEqual([
      "user",
      ["driver", "population"],
      sorted([one.id, two.id])[0],
      '"1"',
    ]);
    expect(r.headers.location).toBe(`${O}/${r.body.id}`);
    expect((await counting(one.id)).overlapOpen).toBe(true);
    expect((await tasksOf(r.body.id)).map((t) => t.assignee_user_id)).toEqual([b.users.fin.id]);
    expect((await auditOf(api.db, r.body.id)).map((a) => a.action)).toEqual(["benefit_overlap.raise"]);
    const dup = await call(api.app, "POST", O, { session: b.s.bo, body });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "benefit_overlap.already_open",
      "An open overlap warning already exists for these two benefits.",
    ]);
    const same = await call(api.app, "POST", O, {
      session: b.s.bo,
      body: { benefitAId: one.id, benefitBId: one.id, dimensions: ["driver"] },
    });
    expect([same.status, same.body.code, same.body.detail]).toEqual([
      422,
      "benefit_overlap.same_benefit",
      "An overlap needs two different benefits.",
    ]);
    const unknown = await call(api.app, "POST", O, {
      session: b.s.bo,
      body: { benefitAId: one.id, benefitBId: "01920000-0000-7000-8000-0000000fffff", dimensions: ["driver"] },
    });
    expect([unknown.status, unknown.body.code]).toEqual([422, "validation.reference"]);
    for (const session of [b.s.auditor, b.s.admin, b.s.fin])
      expect((await call(api.app, "POST", O, { session, body })).status).toBe(403);
    expect((await call(api.app, "POST", O, { session: b.s.tl, body: { ...body, dimensions: [] } })).status).toBe(400);
  });

  it("list: open first, status filter, cursor pages; get 404 outside the scope", async () => {
    const all = await call(api.app, "GET", `${O}?limit=100`, { session: b.s.auditor });
    expect(all.status).toBe(200);
    const statuses = (all.body.items as { status: string }[]).map((x) => x.status);
    expect(statuses).toEqual([...statuses].sort());
    expect(statuses).toContain("open");
    expect(statuses).toContain("resolved");
    const open = await call(api.app, "GET", `${O}?status=open&limit=100`, { session: b.s.auditor });
    expect((open.body.items as { status: string }[]).every((x) => x.status === "open")).toBe(true);
    const ids: string[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `${O}?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await call(api.app, "GET", url, {
        session: b.s.tl,
      });
      ids.push(...page.body.items.map((x) => x.id));
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    expect(ids).toEqual((all.body.items as { id: string }[]).map((x) => x.id));
    expect((await call(api.app, "GET", O, { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${O}/${ids[0]}`, { session: b.s.outsider })).status).toBe(404);
    expect((await call(api.app, "GET", `${O}?status=closed`, { session: b.s.tl })).status).toBe(400);
  });

  it("a mapped FIN party receives the task (and only it); an unmapped party falls back to finance.validate holders", async () => {
    const other = await seedBenefitWorld(api, w);
    const fin2 = await extraUser(api, w, other, "FIN");
    const mapped = await call(api.app, "POST", `${other.base}/role-mappings`, {
      session: other.s.tl,
      body: { partyCode: "FIN", targetKind: "user", userId: fin2.id },
    });
    expect(mapped.status, JSON.stringify(mapped.body)).toBe(201);
    const d = driver();
    await newBenefit({ driverKey: d }, other);
    const two = await newBenefit({ driverKey: d }, other);
    const [warning] = await openOverlaps(two.id);
    expect((await tasksOf(warning!.id)).map((t) => t.assignee_user_id)).toEqual([fin2.id]);
  });
});
