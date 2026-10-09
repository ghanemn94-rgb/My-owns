// Actions on RAID entries and the action register (T-DG4-BE-D; ADR-0031 §4, §9-§11; REQ-S16-018 Action). Proves,
// against the run's disposable PostgreSQL:
//  - an owned, person-authored action linked to a Risk (raidEntryId) or a Dependency entry (dependencyId), with its
//    follow-up date; one My Work item raid_action_due for its owner through createWorkItemOnce (dedupe
//    raid.action:<id>:<owner>, due = the action's due date); an owner change moves the item, done closes it;
//  - action.edit for any action; action.update_own only for the caller's own (create for oneself only);
//  - a closed entry refuses new actions (422 raid.closed);
//  - the action register lists every action of the transformation (DG2 ones as sourceKind none) with the filters
//    sourceKind, ownerUserId, status, overdue; the DG2 /actions representation is unchanged (byte-stable);
//  - updates follow the DG2 transitions (422 invalid_transition); If-Match 428/409; AUD 403; ADM-only and outsiders
//    404; one audit event per change; commit-time authorisation.
// All data is SYNTHETIC; nothing here is a business approval or touches DG0-DG7.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, seedWorld, startApi, type TestApi, type World } from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { extraUser, seedBenefitWorld, type BenefitWorld } from "../benefits/fixtures.ts";

type Extra = Awaited<ReturnType<typeof extraUser>>;
let api: TestApi;
let w: World;
let b: BenefitWorld;
let wl: Extra;
let wl2: Extra;
let R: string;
let AR: string;
beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  b = await seedBenefitWorld(api, w);
  wl = await extraUser(api, w, b, "WL");
  wl2 = await extraUser(api, w, b, "WL");
  R = `${b.base}/raid`;
  AR = `${b.base}/action-register`;
}, 60_000);
afterAll(async () => {
  await api.close();
}, 60_000);

const newRisk = async () => {
  const r = await call(api.app, "POST", R, {
    session: b.s.tl,
    body: { type: "risk", description: "Synthetic risk", impact: "medium", probability: "low", ownerUserId: wl.id },
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; code: string };
};
const newAction = async (entryId: string, body: Record<string, unknown>, session = b.s.tl) => {
  const r = await call(api.app, "POST", `${R}/${entryId}/actions`, { session, body });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body as { id: string; version: number; ownerUserId: string };
};
const tasksOf = (actionId: string) =>
  api.db
    .selectFrom("work_item")
    .select(["kind", "assignee_user_id", "status", "due_date", "dedupe_key", "subject_type", "message_key"])
    .where("subject_id", "=", actionId)
    .orderBy("created_at")
    .execute();

describe("actions linked to RAID entries (ADR-0031 §4)", () => {
  it("creates an owned action on a Risk with a follow-up date, one audit event and the owner's work item", async () => {
    const risk = await newRisk();
    const r = await call(api.app, "POST", `${R}/${risk.id}/actions`, {
      session: b.s.tl,
      body: {
        title: "Synthetic: call the vendor",
        description: "Synthetic details",
        ownerUserId: wl.id,
        dueDate: "2026-12-01",
        followUpDate: "2026-11-24",
      },
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.headers.location).toBe(`${AR}/${r.body.id}`);
    expect(r.headers.etag).toBe('"1"');
    expect(r.body).toMatchObject({
      title: "Synthetic: call the vendor",
      ownerUserId: wl.id,
      dueDate: "2026-12-01",
      followUpDate: "2026-11-24",
      status: "open",
      sourceKind: "raid_entry",
      raidEntryId: risk.id,
      dependencyId: null,
      correctiveCaseId: null,
      sourceWorkshopItemId: null,
      overdue: false,
      createdBy: b.users.tl.id,
      version: 1,
    });
    expect(await tasksOf(r.body.id)).toEqual([
      {
        kind: "raid_action_due",
        assignee_user_id: wl.id,
        status: "open",
        due_date: "2026-12-01",
        dedupe_key: `raid.action:${r.body.id}:${wl.id}`,
        subject_type: "action_item",
        message_key: "raid.task.action_due",
      },
    ]);
    expect((await auditOf(api.db, r.body.id)).map((a) => [a.action, a.new_version])).toEqual([
      ["action_item.create", 1],
    ]);
    const listed = await call(api.app, "GET", `${R}/${risk.id}/actions`, { session: b.s.auditor });
    expect([listed.status, listed.body.items.map((x: { id: string }) => x.id)]).toEqual([200, [r.body.id]]);
  });

  it("an action on a Dependency entry links dependencyId; listRaidEntryActions lists only that entry's actions", async () => {
    const dep = await call(api.app, "POST", R, {
      session: b.s.tl,
      body: { type: "dependency", description: "Synthetic dependency", impact: "low", ownerUserId: wl.id },
    });
    const a = await newAction(dep.body.id, { title: "Synthetic: chase the feed", ownerUserId: wl.id });
    const read = await call(api.app, "GET", `${AR}/${a.id}`, { session: b.s.auditor });
    expect([read.body.sourceKind, read.body.dependencyId, read.body.raidEntryId]).toEqual([
      "dependency",
      dep.body.id,
      null,
    ]);
    const listed = await call(api.app, "GET", `${R}/${dep.body.id}/actions`, { session: b.s.auditor });
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it("update_own (WL) creates an action only for itself; AUD 403; ADM-only and outsiders 404; nothing written", async () => {
    const risk = await newRisk();
    const own = await newAction(risk.id, { title: "Synthetic: my own follow-up", ownerUserId: wl.id }, wl.session);
    expect(own.ownerUserId).toBe(wl.id);
    const body = { title: "Synthetic: for someone else", ownerUserId: wl2.id };
    expect((await call(api.app, "POST", `${R}/${risk.id}/actions`, { session: wl.session, body })).status).toBe(403);
    expect((await call(api.app, "POST", `${R}/${risk.id}/actions`, { session: b.s.auditor, body })).status).toBe(403);
    for (const session of [b.s.admin, b.s.outsider]) {
      expect((await call(api.app, "POST", `${R}/${risk.id}/actions`, { session, body })).status).toBe(404);
      expect((await call(api.app, "GET", `${R}/${risk.id}/actions`, { session })).status).toBe(404);
      expect((await call(api.app, "GET", AR, { session })).status).toBe(404);
      expect((await call(api.app, "GET", `${AR}/${own.id}`, { session })).status).toBe(404);
      expect(
        (await call(api.app, "PATCH", `${AR}/${own.id}`, { session, headers: ifm(1), body: { title: "x" } })).status,
      ).toBe(404);
    }
    const listed = await call(api.app, "GET", `${R}/${risk.id}/actions`, { session: b.s.auditor });
    expect(listed.body.items.map((x: { id: string }) => x.id)).toEqual([own.id]);
  });

  it("a closed entry refuses new actions (422 raid.closed); an unknown entry is 404", async () => {
    const risk = await newRisk();
    await call(api.app, "POST", `${R}/${risk.id}/close`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { closureNote: "Synthetic closure" },
    });
    const r = await call(api.app, "POST", `${R}/${risk.id}/actions`, {
      session: b.s.tl,
      body: { title: "Too late", ownerUserId: wl.id },
    });
    expect([r.status, r.body.code, r.body.detail]).toEqual([
      422,
      "raid.closed",
      "This RAID entry is closed and can no longer be changed.",
    ]);
    const unknown = await call(api.app, "POST", `${R}/0192aaaa-0000-7000-8000-000000000003/actions`, {
      session: b.s.tl,
      body: { title: "Nowhere", ownerUserId: wl.id },
    });
    expect(unknown.status).toBe(404);
  });
});

describe("the action register (ADR-0031 §4)", () => {
  it("lists every action with its source; filters sourceKind, ownerUserId, status and overdue; DG2 path unchanged", async () => {
    const risk = await newRisk();
    const owner = await extraUser(api, w, b, "WL");
    const late = await newAction(risk.id, { title: "Synthetic late", ownerUserId: owner.id, dueDate: "2020-03-01" });
    const future = await newAction(risk.id, {
      title: "Synthetic future",
      ownerUserId: owner.id,
      dueDate: "2099-03-01",
    });
    const dg2 = await call(api.app, "POST", `${b.base}/actions`, {
      session: b.s.tl,
      body: { title: "Synthetic DG2 action", ownerUserId: owner.id, dueDate: "2020-03-01" },
    });
    expect(dg2.status, JSON.stringify(dg2.body)).toBe(201);
    // The DG2 representation is byte-stable: no P4 field appears on /actions.
    expect(Object.keys(dg2.body)).not.toContain("sourceKind");
    expect(Object.keys(dg2.body)).not.toContain("followUpDate");
    const dg2Read = await call(api.app, "GET", `${b.base}/actions/${dg2.body.id}`, { session: b.s.auditor });
    expect(Object.keys(dg2Read.body).sort()).toEqual(Object.keys(dg2.body).sort());

    const ids = async (qs: string) => {
      const r = await call(api.app, "GET", `${AR}?ownerUserId=${owner.id}&${qs}`, { session: b.s.auditor });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return r.body.items.map((x: { id: string }) => x.id).sort();
    };
    expect(await ids("limit=100")).toEqual([late.id, future.id, dg2.body.id].sort());
    expect(await ids("sourceKind=raid_entry")).toEqual([late.id, future.id].sort());
    expect(await ids("sourceKind=none")).toEqual([dg2.body.id]);
    expect(await ids("sourceKind=dependency")).toEqual([]);
    expect(await ids("overdue=true")).toEqual([late.id, dg2.body.id].sort());
    expect(await ids("overdue=false")).toEqual([future.id]);
    const dg2InRegister = await call(api.app, "GET", `${AR}/${dg2.body.id}`, { session: b.s.auditor });
    expect([dg2InRegister.body.sourceKind, dg2InRegister.body.overdue]).toEqual(["none", true]);
    // Done is never overdue.
    await call(api.app, "PATCH", `${AR}/${late.id}`, { session: b.s.tl, headers: ifm(1), body: { status: "done" } });
    expect(await ids("overdue=true")).toEqual([dg2.body.id]);
    expect(await ids("status=done")).toEqual([late.id]);
    expect((await call(api.app, "GET", `${AR}?sourceKind=nothing`, { session: b.s.auditor })).status).toBe(400);
  });

  it("update: follow-up date, DG2 transitions (422 invalid_transition), If-Match 428/409, one audit event each", async () => {
    const risk = await newRisk();
    const a = await newAction(risk.id, { title: "Synthetic", ownerUserId: wl.id });
    const I = `${AR}/${a.id}`;
    expect((await call(api.app, "PATCH", I, { session: b.s.tl, body: { followUpDate: "2026-12-10" } })).status).toBe(
      428,
    );
    const stale = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(4),
      body: { followUpDate: "2026-12-10" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 1]);
    const f = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(1),
      body: { followUpDate: "2026-12-10" },
    });
    expect([f.status, f.body.followUpDate, f.body.version, f.headers.etag]).toEqual([200, "2026-12-10", 2, '"2"']);
    const cancelled = await call(api.app, "PATCH", I, {
      session: b.s.tl,
      headers: ifm(2),
      body: { status: "cancelled" },
    });
    expect(cancelled.status).toBe(200);
    const bad = await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(3), body: { status: "done" } });
    expect([bad.status, bad.body.code, bad.body.detail]).toEqual([
      422,
      "invalid_transition",
      "The record cannot move from cancelled to done.",
    ]);
    expect((await call(api.app, "PATCH", I, { session: b.s.tl, headers: ifm(3), body: {} })).status).toBe(400);
    expect((await auditOf(api.db, a.id)).map((x) => [x.action, x.prior_version, x.new_version])).toEqual([
      ["action_item.create", null, 1],
      ["action_item.update", 1, 2],
      ["action_item.update", 2, 3],
    ]);
    // Cancelled closes the owner's work item (cancelled).
    expect((await tasksOf(a.id)).map((t) => t.status)).toEqual(["cancelled"]);
  });

  it("update_own edits only the caller's own actions; AUD 403; an owner change moves the work item; done closes it", async () => {
    const risk = await newRisk();
    const mine = await newAction(risk.id, { title: "Synthetic mine", ownerUserId: wl.id });
    const theirs = await newAction(risk.id, { title: "Synthetic theirs", ownerUserId: wl2.id });
    expect(
      (
        await call(api.app, "PATCH", `${AR}/${theirs.id}`, {
          session: wl.session,
          headers: ifm(1),
          body: { title: "x" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "PATCH", `${AR}/${mine.id}`, {
          session: b.s.auditor,
          headers: ifm(1),
          body: { title: "x" },
        })
      ).status,
    ).toBe(403);
    const moved = await call(api.app, "PATCH", `${AR}/${mine.id}`, {
      session: b.s.tl,
      headers: ifm(1),
      body: { ownerUserId: wl2.id },
    });
    expect([moved.status, moved.body.ownerUserId]).toEqual([200, wl2.id]);
    expect((await tasksOf(mine.id)).map((t) => [t.assignee_user_id, t.status])).toEqual([
      [wl.id, "cancelled"],
      [wl2.id, "open"],
    ]);
    const done = await call(api.app, "PATCH", `${AR}/${mine.id}`, {
      session: wl2.session,
      headers: ifm(2),
      body: { status: "done" },
    });
    expect([done.status, done.body.status]).toEqual([200, "done"]);
    expect((await tasksOf(mine.id)).map((t) => [t.assignee_user_id, t.status])).toEqual([
      [wl.id, "cancelled"],
      [wl2.id, "done"],
    ]);
  });

  it("commit-time: a grant revoked while an action update waited is 403; nothing written", async () => {
    const risk = await newRisk();
    const a = await newAction(risk.id, { title: "Synthetic", ownerUserId: wl.id });
    const u = await extraUser(api, w, b, "TO");
    const res = await afterIdentity(
      api,
      u.id,
      () =>
        call(api.app, "PATCH", `${AR}/${a.id}`, {
          session: u.session,
          headers: ifm(1),
          body: { title: "Late edit" },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u.id),
    );
    expect(res.status).toBe(403);
    const row = await api.db
      .selectFrom("action_item")
      .select(["title", "version"])
      .where("id", "=", a.id)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ title: "Synthetic", version: 1 });

    const u2 = await extraUser(api, w, b, "TO");
    const before = (await call(api.app, "GET", `${R}/${risk.id}/actions`, { session: b.s.auditor })).body.items.length;
    const res2 = await afterIdentity(
      api,
      u2.id,
      () =>
        call(api.app, "POST", `${R}/${risk.id}/actions`, {
          session: u2.session,
          body: { title: "Late create", ownerUserId: wl.id },
          contract: false,
        }),
      () => revokeAll(api, w.grantor.id, u2.id),
    );
    expect(res2.status).toBe(403);
    const after = (await call(api.app, "GET", `${R}/${risk.id}/actions`, { session: b.s.auditor })).body.items.length;
    expect(after).toBe(before);
  });
});
