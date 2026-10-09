// RAID Dependency entries ARE the canonical T08 dependency rows (T-DG4-BE-D; ADR-0031 §2, §9-§11; REQ-PB-078,
// REQ-PB-079, REQ-PB-080). Proves, against the run's disposable PostgreSQL:
//  - REQ-PB-078 A01 "editing a dependency's owner in T08 changes the same RAID entry; there is no second copy":
//    updateT08Dependency's owner change is getRaidEntry's owner (same id, same version), listRaidEntries has exactly one
//    row for it, and no raid_entry row is ever written for a dependency;
//  - a Dependency entry created through RAID is listed by listT08Dependencies with its DEP-nn code (one record); its
//    RAID writes (update, close) change the canonical row and are audited on it; T08's rules hold (cycle, type);
//  - REQ-PB-080: a Dependency entry has no Probability (422 raid.probability_not_applicable; always null);
//  - RAID status: open and at_risk -> Open, resolved -> Closed (final through RAID: 422 raid.closed); archived drops out;
//  - AUD and a role without raid.edit 403; ADM-only and outsiders 404; If-Match 428/409.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, insertInitiative, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let wl: Extra;
let td: Extra;
let R: string;
const T08 = "/api/v1/dependencies";
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  td = await extraUser(api, w, b, "TD");
  R = `${b.base}/raid`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const t08Create = async (from: string, to: string, extra: Record<string, unknown> = {}) => {
  const r = await call(api.app, "POST", T08, {
    session: b.s.tl,
    body: {
      transformationId: b.transformationId,
      description: "Synthetic T08 dependency: data platform before billing",
      from: { kind: "initiative", initiativeId: from },
      toInitiativeId: to,
      dependencyType: "tech",
      ownerUserId: b.users.tl.id,
      ...extra,
    },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string; version: number };
};
const raidDependency = (extra: Record<string, unknown> = {}) => ({
  type: "dependency",
  description: "Synthetic: vendor API contract needed",
  impact: "high",
  ownerUserId: wl.id,
  dueDate: "2026-11-30",
  mitigation: "Synthetic: weekly vendor check-in",
  ...extra,
});
const raidEntryCount = async () =>
  Number(
    (
      await api.db
        .selectFrom("raid_entry")
        .select((eb) => eb.fn.countAll<string>().as("n"))
        .executeTakeFirstOrThrow()
    ).n,
  );
const rowsFor = async (id: string) => {
  const all: { id: string }[] = [];
  let cursor: string | null = null;
  do {
    const qs: string = cursor === null ? "limit=100" : `limit=100&cursor=${encodeURIComponent(cursor)}`;
    const p = await call(api.app, "GET", `${R}?${qs}`, { session: b.s.auditor });
    expect(p.status).toBe(200);
    all.push(...p.body.items);
    cursor = p.body.nextCursor;
  } while (cursor !== null);
  return all.filter((x) => x.id === id);
};

describe("REQ-PB-078: one canonical dependency record shared by T08 and RAID", () => {
  it("A01: editing a dependency's owner in T08 changes the same RAID entry; there is no second copy", async () => {
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const entriesBefore = await raidEntryCount();
    const dep = await t08Create(i1, i2);
    const before = await call(api.app, "GET", `${R}/${dep.id}`, { session: b.s.auditor });
    expect([before.status, before.body.type, before.body.code, before.body.ownerUserId, before.body.impact]).toEqual([
      200,
      "dependency",
      dep.code,
      b.users.tl.id,
      null, // created through T08: Impact is Unknown (null), never a guessed level
    ]);
    const edited = await call(api.app, "PATCH", `${T08}/${dep.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { ownerUserId: wl.id },
    });
    expect([edited.status, edited.body.ownerUserId, edited.body.version]).toEqual([200, wl.id, 2]);
    const after = await call(api.app, "GET", `${R}/${dep.id}`, { session: b.s.auditor });
    expect([after.status, after.body.id, after.body.ownerUserId, after.body.version, after.headers.etag]).toEqual([
      200,
      dep.id,
      wl.id,
      2,
      '"2"',
    ]);
    const listed = await rowsFor(dep.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({ id: dep.id, ownerUserId: wl.id, recordTable: "dependency" });
    expect(await raidEntryCount()).toBe(entriesBefore);
    expect(
      await api.db.selectFrom("raid_entry").select("id").where("id", "=", dep.id).executeTakeFirst(),
    ).toBeUndefined();
  });

  it("a Dependency entry created through RAID is listed by listT08Dependencies with its DEP-nn code", async () => {
    const entriesBefore = await raidEntryCount();
    const created = await call(api.app, "POST", R, { session: wl.session, body: raidDependency() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect([
      created.body.type,
      created.body.recordTable,
      created.body.recordStatus,
      created.body.status,
      created.body.probability,
      created.body.impact,
      created.body.dueDate,
      created.body.mitigation,
    ]).toEqual([
      "dependency",
      "dependency",
      "open",
      "open",
      null,
      "high",
      "2026-11-30",
      "Synthetic: weekly vendor check-in",
    ]);
    expect(created.body.code).toMatch(/^DEP-[0-9]{2,6}$/);
    const t08 = await call(api.app, "GET", `${T08}?transformationId=${b.transformationId}&limit=100`, {
      session: b.s.auditor,
    });
    expect(t08.status).toBe(200);
    const mine = t08.body.items.filter((d: { id: string }) => d.id === created.body.id);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({
      code: created.body.code,
      fromKind: "other",
      toKind: "other",
      dependencyType: "other",
      neededBy: "2026-11-30",
      ownerUserId: wl.id,
      status: "open",
    });
    // The T08 representation is unchanged: it does not show the T15 Impact.
    expect(Object.keys(mine[0])).not.toContain("impact");
    const row = await api.db
      .selectFrom("dependency")
      .select(["impact", "code"])
      .where("id", "=", created.body.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ impact: "high", code: created.body.code });
    expect(await raidEntryCount()).toBe(entriesBefore);
    expect((await auditOf(api.db, created.body.id)).map((a) => [a.action, a.record_type, a.new_version])).toEqual([
      ["dependency.create", "dependency", 1],
    ]);
  });

  it("with T08 endpoints and a type: the canonical row carries them; T08's cycle and type rules hold", async () => {
    const [i1, i2] = [await insertInitiative(api.db, b), await insertInitiative(api.db, b)];
    const created = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: raidDependency({ fromInitiativeId: i1, toInitiativeId: i2, dependencyType: "data" }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.initiativeId).toBe(i2);
    const t08 = await call(api.app, "GET", `${T08}/${created.body.id}`, { session: b.s.auditor });
    expect([t08.body.fromInitiativeId, t08.body.toInitiativeId, t08.body.dependencyType]).toEqual([i1, i2, "data"]);
    const cycle = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: raidDependency({ fromInitiativeId: i2, toInitiativeId: i1 }),
    });
    expect([cycle.status, cycle.body.code]).toEqual([422, "dependency.cycle"]);
    const type = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: raidDependency({ dependencyType: "no_such" }),
    });
    expect([type.status, type.body.code]).toEqual([422, "dependency.unknown_type"]);
    const self = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: raidDependency({ fromInitiativeId: i1, toInitiativeId: i1 }),
    });
    expect([self.status, self.body.code]).toEqual([422, "dependency.self"]);
  });
});

describe("Dependency entries through the RAID API (ADR-0031 §2)", () => {
  it("has no Probability: 422 raid.probability_not_applicable on create and update; nothing written", async () => {
    const before = await call(api.app, "GET", `${R}?type=dependency&limit=100`, { session: b.s.auditor });
    const c = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency({ probability: "high" }) });
    expect([c.status, c.body.code, c.body.errors[0].pointer]).toEqual([
      422,
      "raid.probability_not_applicable",
      "/probability",
    ]);
    const after = await call(api.app, "GET", `${R}?type=dependency&limit=100`, { session: b.s.auditor });
    expect(after.body.items.length).toBe(before.body.items.length);
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency({ probability: null }) });
    expect([created.status, created.body.probability]).toEqual([201, null]);
    const u = await call(api.app, "PATCH", `${R}/${created.body.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { probability: "low" },
    });
    expect([u.status, u.body.code]).toEqual([422, "raid.probability_not_applicable"]);
  });

  it("a RAID update changes the canonical row (seen by T08); In progress is refused; one audit event", async () => {
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency() });
    const id = created.body.id as string;
    const upd = await call(api.app, "PATCH", `${R}/${id}`, {
      session: wl.session,
      headers: ifm(1),
      body: { ownerUserId: b.users.tl.id, dueDate: "2027-01-31", impact: "low", mitigation: "Synthetic: escalate" },
    });
    expect([upd.status, upd.body.ownerUserId, upd.body.dueDate, upd.body.impact, upd.body.version]).toEqual([
      200,
      b.users.tl.id,
      "2027-01-31",
      "low",
      2,
    ]);
    const t08 = await call(api.app, "GET", `${T08}/${id}`, { session: b.s.auditor });
    expect([t08.body.ownerUserId, t08.body.neededBy, t08.body.mitigation, t08.body.version]).toEqual([
      b.users.tl.id,
      "2027-01-31",
      "Synthetic: escalate",
      2,
    ]);
    const ip = await call(api.app, "PATCH", `${R}/${id}`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { status: "in_progress" },
    });
    expect([ip.status, ip.body.code, ip.body.detail]).toEqual([
      422,
      "raid.status_transition",
      "A RAID entry moves between Open and In progress; use Close to close it.",
    ]);
    const audit = await auditOf(api.db, id);
    expect(audit.map((a) => [a.action, a.prior_version, a.new_version])).toEqual([
      ["dependency.create", null, 1],
      ["dependency.update", 1, 2],
    ]);
    expect(Object.keys(audit[1]!.changes ?? {}).sort()).toEqual(["impact", "mitigation", "needed_by", "owner_user_id"]);
  });

  it("without a To initiative, T08's update refuses it (dependency.to_required, unchanged T08 rule); RAID edits it", async () => {
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency() });
    const id = created.body.id as string;
    const t08 = await call(api.app, "PATCH", `${T08}/${id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "at_risk" },
    });
    expect([t08.status, t08.body.code]).toEqual([422, "dependency.to_required"]);
    const raid = await call(api.app, "PATCH", `${R}/${id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { impact: "low" },
    });
    expect([raid.status, raid.body.impact]).toEqual([200, "low"]);
    const ini = await insertInitiative(api.db, b);
    const linked = await call(api.app, "PATCH", `${T08}/${id}`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { toInitiativeId: ini, status: "at_risk" },
    });
    expect([linked.status, linked.body.toInitiativeId, linked.body.status]).toEqual([200, ini, "at_risk"]);
    expect((await call(api.app, "GET", `${R}/${id}`, { session: b.s.auditor })).body.initiativeId).toBe(ini);
  });

  it("an at-risk dependency is Open with recordStatus at_risk; Close resolves it (final through RAID); archived drops out", async () => {
    const ini = await insertInitiative(api.db, b);
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency({ toInitiativeId: ini }) });
    const id = created.body.id as string;
    const risky = await call(api.app, "PATCH", `${T08}/${id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { status: "at_risk" },
    });
    expect(risky.status, JSON.stringify(risky.body)).toBe(200);
    const atRisk = await call(api.app, "GET", `${R}/${id}`, { session: b.s.auditor });
    expect([atRisk.body.status, atRisk.body.recordStatus]).toEqual(["open", "at_risk"]);
    const closed = await call(api.app, "POST", `${R}/${id}/close`, {
      session: b.s.tl,
      headers: ifm(2),
      body: { closureNote: "Synthetic: vendor contract signed" },
    });
    expect([closed.status, closed.body.status, closed.body.recordStatus, closed.body.version]).toEqual([
      200,
      "closed",
      "resolved",
      3,
    ]);
    expect((await call(api.app, "GET", `${T08}/${id}`, { session: b.s.auditor })).body.status).toBe("resolved");
    expect((await auditOf(api.db, id)).at(-1)).toMatchObject({
      action: "dependency.update",
      reason: "Synthetic: vendor contract signed",
    });
    const edit = await call(api.app, "PATCH", `${R}/${id}`, {
      session: b.s.tl,
      headers: ifm(3),
      body: { impact: "low" },
    });
    expect([edit.status, edit.body.code]).toEqual([422, "raid.closed"]);
    const archived = await call(api.app, "POST", `${T08}/${id}/archive`, {
      session: b.s.tl,
      headers: ifm(3),
      body: { reason: "Synthetic archive" },
    });
    expect(archived.status).toBe(200);
    expect((await call(api.app, "GET", `${R}/${id}`, { session: b.s.auditor })).status).toBe(404);
    expect(await rowsFor(id)).toHaveLength(0);
  });

  it("AUD and TD (dependency.edit without raid.edit) get 403; ADM-only and outsiders 404; If-Match 428/409", async () => {
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency() });
    const id = created.body.id as string;
    for (const session of [b.s.auditor, td.session]) {
      expect((await call(api.app, "POST", R, { session, body: raidDependency() })).status).toBe(403);
      expect(
        (await call(api.app, "PATCH", `${R}/${id}`, { session, headers: ifm(1), body: { impact: "low" } })).status,
      ).toBe(403);
      expect(
        (await call(api.app, "POST", `${R}/${id}/close`, { session, headers: ifm(1), body: { closureNote: "No" } }))
          .status,
      ).toBe(403);
    }
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "GET", `${R}/${id}`, { session })).status).toBe(404);
      expect((await call(api.app, "POST", R, { session, body: raidDependency() })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${R}/${id}`, { session, headers: ifm(1), body: { impact: "low" } })).status,
      ).toBe(404);
    }
    expect((await call(api.app, "PATCH", `${R}/${id}`, { session: b.s.tl, body: { impact: "low" } })).status).toBe(428);
    expect(
      (await call(api.app, "PATCH", `${R}/${id}`, { session: b.s.tl, headers: ifm(7), body: { impact: "low" } }))
        .status,
    ).toBe(409);
    expect((await auditOf(api.db, id)).length).toBe(1);
  });

  it("commit-time: a grant revoked while a Dependency entry update waited is 403; the canonical row is unchanged", async () => {
    const created = await call(api.app, "POST", R, { session: b.s.tl, body: raidDependency() });
    const id = created.body.id as string;
    const u = await extraUser(api, w, b, "WL");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${R}/${id}`, {
          session: u.session,
          headers: ifm(1),
          body: { impact: "low" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("dependency")
      .select(["impact", "version"])
      .where("id", "=", id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ impact: "high", version: 1 });
  });
});
