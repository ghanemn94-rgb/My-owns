// Saved views (ADR-0057 §4, §10; REQ-S15-010 "saved views", REQ-S15-013 "persist column choices in saved views";
// T-DG6-BE-Q, p6-work-split §H/G.3) against the run's disposable PostgreSQL. Proves:
//  - create, put, delete, share and unshare each write exactly one audit event (prior and new version) and step the
//    version; If-Match 428 missing, 409 stale with currentVersion;
//  - another user of the organization reads a shared view and gets 404 for a personal one; a user of another
//    organization gets 404 for both; only the owner changes a view (403 saved_view.not_owner);
//  - share without saved_view.share -> 403, unshare allowed; saved_view.share revoked while the share waits on lock
//    730319 -> 403 (re-checked at commit), nothing written;
//  - AUD: list and get 200, every write 403 (also on a view it owns from an earlier role);
//  - an unknown column, filter or sort key -> 422 saved_view.unknown_key naming the key; a filter value of the wrong
//    format -> 400; a duplicate name (case-insensitive) -> 409 saved_view.name_taken;
//  - setting a default clears the previous one (its own version step and audit event); a concurrent default switch
//    -> 409 saved_view.default_conflict;
//  - a shared view of a transformation the reader cannot read is neither listed nor returned; the list pages with no
//    duplicate and no gap, own views first, and a foreign cursor is 400;
//  - the registry equals the contract: columns = the list item's properties, filters = the query parameters other than
//    cursor, limit and sort (format and repeatability), sorts = the ADR-0057 §5 sort enum (a test reading the contract).
// All data is SYNTHETIC; nothing here grants a business approval (G1-G6) or touches DG0-DG7.
import { insertAuditEvent, sql } from "@mth/db";
import { SAVED_VIEW_LIST_KEYS, SAVED_VIEW_LISTS, savedViewFilterValueError, savedViewUnknownKey } from "@mth/shared";
import { v7 as uuidv7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { openapi } from "../../support/contract.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import {
  auditOf,
  auditOfRequest,
  call,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Res,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

const V = "/api/v1/saved-views";
let api: TestApi;
let w: World;
let X: string;
let Y: string;
let office: Session;
let admin: Session;
let auditor: Session;
let officeB: Session;
let tlX: Session;
let tlY: Session;

const viewBody = (over: Record<string, unknown> = {}) => ({
  listKey: "initiatives",
  name: uniq("View "),
  columns: ["code", "name", "status"],
  filters: { q: "synthetic", status: "draft" },
  sort: [{ key: "code", direction: "asc" }],
  ...over,
});
const requestAudit = async (res: Res) => auditOfRequest(api.db, String(res.headers["x-request-id"]));
const create = async (session: Session, over: Record<string, unknown> = {}): Promise<Body> => {
  const res = await call(api.app, "POST", V, { session, body: viewBody(over) });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return res.body;
};
const fullUpdate = (v: Body, over: Record<string, unknown> = {}) => ({
  name: v.name,
  columns: v.columns,
  filters: v.filters,
  sort: v.sort,
  isDefault: v.isDefault,
  ...over,
});

/** Polls (bounded, 60 s) until `probe` counts at least one waiting backend. */
async function waitFor(probe: () => Promise<number>, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  for (;;) {
    if ((await probe()) > 0) return;
    if (Date.now() > deadline) {
      const seen = await sql`SELECT locktype, mode, granted, classid::text, transactionid::text FROM pg_locks
                               WHERE NOT granted`.execute(api.db);
      throw new Error(`timed out waiting for ${what}: ${JSON.stringify(seen.rows)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
/** A backend of this database waiting for an advisory lock of class 730319 (savedViewShare). */
const shareLockWaiters = async () =>
  Number(
    (
      await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM pg_locks
         WHERE locktype = 'advisory' AND classid = 730319 AND NOT granted
           AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`.execute(api.db)
    ).rows[0]!.n,
  );
/** A backend waiting for transaction `xid` to end (the create blocked on the racer's uncommitted default). */
const xidWaiters = (xid: string) => async () =>
  Number(
    (
      await sql<{ n: string }>`
        SELECT count(*)::text AS n FROM pg_locks
         WHERE locktype = 'transactionid' AND NOT granted AND transactionid::text = ${xid}`.execute(api.db)
    ).rows[0]!.n,
  );

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  X = await createTransformationRow(api.db, w.orgA.id, w.a1, w.office.id);
  Y = await createTransformationRow(api.db, w.orgA.id, w.a2, w.office.id);
  const ux = await createUser(api.db, w.orgA.id);
  const uy = await createUser(api.db, w.orgA.id);
  await grant(api.db, w.grantor.id, ux.id, "TL", { type: "transformation", id: X }, w.orgA.id);
  await grant(api.db, w.grantor.id, uy.id, "TL", { type: "transformation", id: Y }, w.orgA.id);
  office = await signIn(api.app, w.office.subject);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  tlX = await signIn(api.app, ux.subject);
  tlY = await signIn(api.app, uy.subject);
}, 120_000);
afterAll(async () => {
  await api?.close();
});

describe("writes: one audit event each, the version step, If-Match", () => {
  it("create (v1), put (v2), share (v3), unshare (v4), delete (v5) each write exactly one audit event", async () => {
    const res = await call(api.app, "POST", V, { session: office, body: viewBody() });
    expect(res.status).toBe(201);
    expect(res.headers["etag"]).toBe('"1"');
    const v = res.body;
    expect(v).toMatchObject({
      ownerUserId: w.office.id,
      isOwner: true,
      organizationId: w.orgA.id,
      transformationId: null,
      visibility: "personal",
      status: "active",
      isDefault: false,
      version: 1,
      sharedAt: null,
      sharedBy: null,
    });
    const steps: [Res, string, number | null, number][] = [[res, "saved_view.created", null, 1]];
    const put = await call(api.app, "PUT", `${V}/${v.id}`, {
      session: office,
      body: fullUpdate(v, { name: `${v.name} renamed`, columns: ["name"] }),
      headers: ifm(1),
    });
    expect([put.status, put.body.version, put.body.columns]).toEqual([200, 2, ["name"]]);
    steps.push([put, "saved_view.updated", 1, 2]);
    const share = await call(api.app, "POST", `${V}/${v.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(2),
    });
    expect([share.status, share.body.visibility, share.body.sharedBy, share.body.version]).toEqual([
      200,
      "shared",
      w.office.id,
      3,
    ]);
    expect(share.body.sharedAt).not.toBeNull();
    steps.push([share, "saved_view.shared", 2, 3]);
    const unshare = await call(api.app, "POST", `${V}/${v.id}/share`, {
      session: office,
      body: { shared: false },
      headers: ifm(3),
    });
    expect([unshare.status, unshare.body.visibility, unshare.body.sharedAt, unshare.body.version]).toEqual([
      200,
      "personal",
      null,
      4,
    ]);
    steps.push([unshare, "saved_view.unshared", 3, 4]);
    const del = await call(api.app, "DELETE", `${V}/${v.id}`, { session: office, headers: ifm(4) });
    expect([del.status, del.body.status, del.body.version]).toEqual([200, "deleted", 5]);
    expect(del.body.deletedAt).not.toBeNull();
    steps.push([del, "saved_view.deleted", 4, 5]);
    for (const [r, action, prior, next] of steps) {
      const events = await requestAudit(r);
      expect(events.map((e) => [e.action, e.record_type, e.record_id, e.prior_version, e.new_version])).toEqual([
        [action, "saved_view", v.id, prior, next],
      ]);
      expect(events[0]!.actor_user_id).toBe(w.office.id);
    }
    expect((await auditOf(api.db, v.id)).map((e) => e.new_version)).toEqual([1, 2, 3, 4, 5]);
    // The trigger-written history has one row per version.
    const history = await api.db
      .selectFrom("saved_view_event")
      .select(["record_version", "status", "visibility"])
      .where("saved_view_id", "=", v.id)
      .orderBy("record_version")
      .execute();
    expect(history.map((h) => h.record_version)).toEqual([1, 2, 3, 4, 5]);
    // A deleted view never changes: 409 saved_view.deleted for every write; the owner still reads it.
    const again = await call(api.app, "DELETE", `${V}/${v.id}`, { session: office, headers: ifm(5) });
    expect([again.status, again.body.code]).toEqual([409, "saved_view.deleted"]);
    const reshare = await call(api.app, "POST", `${V}/${v.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(5),
    });
    expect([reshare.status, reshare.body.code]).toEqual([409, "saved_view.deleted"]);
    expect((await call(api.app, "GET", `${V}/${v.id}`, { session: office })).body.status).toBe("deleted");
    const listed = await call(api.app, "GET", `${V}?listKey=initiatives&limit=100`, { session: office });
    expect(listed.body.items.map((i: Body) => i.id)).not.toContain(v.id);
  });

  it("If-Match: missing -> 428, stale -> 409 with currentVersion, malformed -> 400; nothing is written", async () => {
    const v = await create(office);
    const body = fullUpdate(v, { name: uniq("Changed ") });
    for (const [method, url, b] of [
      ["PUT", `${V}/${v.id}`, body],
      ["DELETE", `${V}/${v.id}`, undefined],
      ["POST", `${V}/${v.id}/share`, { shared: true }],
    ] as const) {
      const missing = await call(api.app, method, url, { session: office, ...(b ? { body: b } : {}) });
      expect([missing.status, missing.body.code]).toEqual([428, "precondition_required"]);
      const stale = await call(api.app, method, url, { session: office, headers: ifm(7), ...(b ? { body: b } : {}) });
      expect([stale.status, stale.body.code, stale.body.currentVersion]).toEqual([409, "version_conflict", 1]);
      expect(await requestAudit(stale)).toEqual([]);
      const bad = await call(api.app, method, url, {
        session: office,
        headers: { "if-match": "*" },
        ...(b ? { body: b } : {}),
      });
      expect(bad.status).toBe(400);
    }
    const now = await call(api.app, "GET", `${V}/${v.id}`, { session: office });
    expect([now.body.version, now.body.name]).toEqual([1, v.name]);
  });

  it("a share of an already shared view changes nothing (no version step, no audit event)", async () => {
    const v = await create(office);
    await call(api.app, "POST", `${V}/${v.id}/share`, { session: office, body: { shared: true }, headers: ifm(1) });
    const same = await call(api.app, "POST", `${V}/${v.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(2),
    });
    expect([same.status, same.body.version]).toEqual([200, 2]);
    expect(await requestAudit(same)).toEqual([]);
  });
});

describe("visibility: shared, personal, another organization, owner only", () => {
  it("another user of the organization reads a shared view and gets 404 for a personal one; another organization 404 for both", async () => {
    const personal = await create(office);
    const shared = await create(office);
    await call(api.app, "POST", `${V}/${shared.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(1),
    });
    const asAdmin = await call(api.app, "GET", `${V}/${shared.id}`, { session: admin });
    expect([asAdmin.status, asAdmin.body.isOwner, asAdmin.body.ownerUserId]).toEqual([200, false, w.office.id]);
    expect(asAdmin.body.ownerDisplayName).toMatch(/^Synthetic /);
    expect((await call(api.app, "GET", `${V}/${personal.id}`, { session: admin })).status).toBe(404);
    expect((await call(api.app, "GET", `${V}/${personal.id}`, { session: officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `${V}/${shared.id}`, { session: officeB })).status).toBe(404);
    const adminList = await call(api.app, "GET", `${V}?listKey=initiatives&limit=100`, { session: admin });
    const adminIds = adminList.body.items.map((i: Body) => i.id);
    expect(adminIds).toContain(shared.id);
    expect(adminIds).not.toContain(personal.id);
    const bList = await call(api.app, "GET", `${V}?listKey=initiatives&limit=100`, { session: officeB });
    expect(bList.body.items.map((i: Body) => i.id)).not.toContain(shared.id);
    // Writes by another organization's user: 404 (existence not disclosed).
    const putB = await call(api.app, "PUT", `${V}/${shared.id}`, {
      session: officeB,
      body: fullUpdate(shared),
      headers: ifm(2),
    });
    expect(putB.status).toBe(404);
  });

  it("only the owner changes a view: 403 saved_view.not_owner on put, delete and share of a shared view; 404 on a personal one", async () => {
    const v = await create(office);
    await call(api.app, "POST", `${V}/${v.id}/share`, { session: office, body: { shared: true }, headers: ifm(1) });
    const fresh = (await call(api.app, "GET", `${V}/${v.id}`, { session: office })).body;
    for (const [method, url, b] of [
      ["PUT", `${V}/${v.id}`, fullUpdate(fresh)],
      ["DELETE", `${V}/${v.id}`, undefined],
      ["POST", `${V}/${v.id}/share`, { shared: false }],
    ] as const) {
      const r = await call(api.app, method, url, { session: admin, headers: ifm(2), ...(b ? { body: b } : {}) });
      expect([r.status, r.body.code, r.body.detail]).toEqual([
        403,
        "saved_view.not_owner",
        "Only the person who created this view can change it.",
      ]);
    }
    const personal = await create(office);
    const r = await call(api.app, "DELETE", `${V}/${personal.id}`, { session: admin, headers: ifm(1) });
    expect(r.status).toBe(404);
    expect((await call(api.app, "GET", `${V}/${v.id}`, { session: office })).body.version).toBe(2);
  });

  it("a shared view of a transformation the reader cannot read is neither listed nor returned", async () => {
    const outcomes = { listKey: "outcomes", columns: ["statement"], filters: {}, sort: [] };
    const xView = await create(tlX, { ...outcomes, transformationId: X });
    expect(xView.transformationId).toBe(X);
    await call(api.app, "POST", `${V}/${xView.id}/share`, { session: tlX, body: { shared: true }, headers: ifm(1) });
    const yList = await call(api.app, "GET", `${V}?listKey=outcomes&limit=100`, { session: tlY });
    expect(yList.body.items.map((i: Body) => i.id)).not.toContain(xView.id);
    const yListX = await call(api.app, "GET", `${V}?listKey=outcomes&transformationId=${X}&limit=100`, {
      session: tlY,
    });
    expect(yListX.body.items.map((i: Body) => i.id)).not.toContain(xView.id);
    expect((await call(api.app, "GET", `${V}/${xView.id}`, { session: tlY })).status).toBe(404);
    // An organization-level reader (TO; AUD) can read X: listed and returned.
    const officeList = await call(api.app, "GET", `${V}?listKey=outcomes&transformationId=${X}&limit=100`, {
      session: office,
    });
    expect(officeList.body.items.map((i: Body) => i.id)).toContain(xView.id);
    expect((await call(api.app, "GET", `${V}/${xView.id}`, { session: auditor })).status).toBe(200);
    // The transformationId filter: X's views and views of every transformation; not Y's.
    const anyView = await create(office, { ...outcomes });
    await call(api.app, "POST", `${V}/${anyView.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(1),
    });
    const yOnlyList = await call(api.app, "GET", `${V}?listKey=outcomes&transformationId=${Y}&limit=100`, {
      session: office,
    });
    const yIds = yOnlyList.body.items.map((i: Body) => i.id);
    expect(yIds).toContain(anyView.id);
    expect(yIds).not.toContain(xView.id);
    // Creating a view of a transformation the caller cannot read: 404; another organization's: 404.
    const denied = await call(api.app, "POST", V, {
      session: tlY,
      body: viewBody({ ...outcomes, transformationId: X }),
    });
    expect(denied.status).toBe(404);
    const foreign = await call(api.app, "POST", V, {
      session: officeB,
      body: viewBody({ ...outcomes, transformationId: X }),
    });
    expect(foreign.status).toBe(404);
    // The cross-transformation list takes no transformationId: 400.
    const tList = await call(api.app, "POST", V, {
      session: office,
      body: viewBody({ listKey: "transformations", columns: ["code"], filters: {}, sort: [], transformationId: X }),
    });
    expect([tList.status, tList.body.errors?.[0]?.pointer]).toEqual([400, "/transformationId"]);
  });

  it("the list: own views first, then shared, each by name; pages with no duplicate and no gap; a foreign cursor is 400", async () => {
    const listKey = "journeys";
    const columns = ["name"];
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const me = await signIn(api.app, u.subject);
    const mine: string[] = [];
    for (const n of ["delta", "Alpha", "charlie", "bravo"])
      mine.push((await create(me, { listKey, columns, filters: {}, sort: [], name: `${n} ${uniq("")}` })).id);
    const other = await create(office, { listKey, columns, filters: {}, sort: [], name: `aaa ${uniq("")}` });
    await call(api.app, "POST", `${V}/${other.id}/share`, { session: office, body: { shared: true }, headers: ifm(1) });
    const seen: Body[] = [];
    let cursor: string | null = null;
    do {
      const url: string = `${V}?listKey=${listKey}&limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const page: Res<Body> = await call(api.app, "GET", url, { session: me });
      expect(page.status).toBe(200);
      seen.push(...page.body.items);
      cursor = page.body.nextCursor;
    } while (cursor !== null);
    const ids = seen.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const own = seen.filter((s) => s.isOwner);
    expect(own.map((s) => s.name.split(" ")[0])).toEqual(["Alpha", "bravo", "charlie", "delta"]);
    expect(seen.slice(0, 4).every((s) => s.isOwner)).toBe(true);
    expect(ids).toContain(other.id);
    expect(ids.indexOf(other.id)).toBeGreaterThan(3);
    const first = await call(api.app, "GET", `${V}?listKey=${listKey}&limit=1`, { session: me });
    const foreign = await call(
      api.app,
      "GET",
      `${V}?listKey=outcomes&limit=1&cursor=${encodeURIComponent(first.body.nextCursor)}`,
      { session: me },
    );
    expect(foreign.status).toBe(400);
  });
});

describe("permissions: saved_view.manage, saved_view.share, AUD", () => {
  it("share without saved_view.share -> 403; unshare allowed", async () => {
    // ADM_TECH holds saved_view.manage only: it saves its own views but cannot share them.
    const v = await create(admin);
    const share = await call(api.app, "POST", `${V}/${v.id}/share`, {
      session: admin,
      body: { shared: true },
      headers: ifm(1),
    });
    expect([share.status, share.body.code]).toEqual([403, "forbidden"]);
    expect(await requestAudit(share)).toEqual([
      expect.objectContaining({ action: "authorization.denied", actor_user_id: w.admin.id }),
    ]);
    // A user who shared a view while holding TO, and now holds only SP (saved_view.manage): unshare 200, share 403.
    const u = await createUser(api.db, w.orgA.id);
    const to = await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const mine = await create(s);
    expect(
      (await call(api.app, "POST", `${V}/${mine.id}/share`, { session: s, body: { shared: true }, headers: ifm(1) }))
        .status,
    ).toBe(200);
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revoke (BE-Q test)" })
      .where("id", "=", to)
      .execute();
    const unshare = await call(api.app, "POST", `${V}/${mine.id}/share`, {
      session: s,
      body: { shared: false },
      headers: ifm(2),
    });
    expect([unshare.status, unshare.body.visibility]).toEqual([200, "personal"]);
    const reshare = await call(api.app, "POST", `${V}/${mine.id}/share`, {
      session: s,
      body: { shared: true },
      headers: ifm(3),
    });
    expect(reshare.status).toBe(403);
  });

  it("saved_view.share is re-checked at commit: revoked while the share waits on lock 730319 -> 403, nothing written", async () => {
    const u = await createUser(api.db, w.orgA.id);
    const to = await grant(api.db, w.grantor.id, u.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const v = await create(s);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockTaken = new Promise<void>((resolve) => (locked = resolve));
    const holder = api.db.transaction().execute(async (tx) => {
      await sql`SELECT pg_advisory_xact_lock(730319, hashtext(${v.id}::text))`.execute(tx);
      locked();
      await held;
    });
    await lockTaken;
    const pending = call(api.app, "POST", `${V}/${v.id}/share`, {
      session: s,
      body: { shared: true },
      headers: ifm(1),
    });
    await waitFor(shareLockWaiters, "the share to wait on lock 730319");
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revoke mid-request" })
      .where("id", "=", to)
      .execute();
    release();
    await holder;
    const res = await pending;
    expect(res.status).toBe(403);
    const now = await call(api.app, "GET", `${V}/${v.id}`, { session: s });
    expect([now.body.version, now.body.visibility]).toEqual([1, "personal"]);
    expect((await auditOf(api.db, v.id)).map((e) => e.action)).toEqual(["saved_view.created"]);
  });

  it("AUD: list and get 200; create, put, delete, share and unshare 403 (also on a view it owns from an earlier role)", async () => {
    const shared = await create(office);
    await call(api.app, "POST", `${V}/${shared.id}/share`, {
      session: office,
      body: { shared: true },
      headers: ifm(1),
    });
    const list = await call(api.app, "GET", `${V}?listKey=initiatives&limit=100`, { session: auditor });
    expect(list.status).toBe(200);
    expect(list.body.items.map((i: Body) => i.id)).toContain(shared.id);
    expect((await call(api.app, "GET", `${V}/${shared.id}`, { session: auditor })).status).toBe(200);
    expect((await call(api.app, "POST", V, { session: auditor, body: viewBody() })).status).toBe(403);
    // A user who saved a view while holding SP and now holds only AUD.
    const u = await createUser(api.db, w.orgA.id);
    const sp = await grant(api.db, w.grantor.id, u.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "AUD", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const own = await create(s);
    await api.db
      .updateTable("scoped_assignment")
      .set({ revoked_at: new Date(), revoked_by: w.grantor.id, revoke_reason: "Synthetic revoke (BE-Q AUD test)" })
      .where("id", "=", sp)
      .execute();
    const aud = await signIn(api.app, u.subject);
    for (const [method, url, b] of [
      ["POST", V, viewBody()],
      ["PUT", `${V}/${own.id}`, fullUpdate(own)],
      ["DELETE", `${V}/${own.id}`, undefined],
      ["POST", `${V}/${own.id}/share`, { shared: true }],
      ["POST", `${V}/${own.id}/share`, { shared: false }],
    ] as const) {
      const r = await call(api.app, method, url, { session: aud, headers: ifm(1), ...(b ? { body: b } : {}) });
      expect(r.status, `${method} ${url}`).toBe(403);
    }
    expect((await call(api.app, "GET", `${V}/${own.id}`, { session: aud })).body.version).toBe(1);
  });

  it("401 without a session; 403 without saved_view.manage (a user with no grant)", async () => {
    expect((await call(api.app, "GET", `${V}?listKey=initiatives`)).status).toBe(401);
    expect((await call(api.app, "POST", V, { body: viewBody() })).status).toBe(401);
    const nobody = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "POST", V, { session: nobody, body: viewBody() })).status).toBe(403);
    expect((await call(api.app, "GET", `${V}?listKey=initiatives`, { session: nobody })).status).toBe(200);
  });
});

describe("validation: the registry, names, defaults", () => {
  it("an unknown column, filter or sort key -> 422 saved_view.unknown_key naming the key; nothing is written", async () => {
    for (const [over, key, pointer] of [
      [{ columns: ["code", "budgetAmount"] }, "budgetAmount", "/columns/1"],
      [{ filters: { q: "x", ownerUserId: "y" } }, "ownerUserId", "/filters/ownerUserId"],
      [{ sort: [{ key: "status", direction: "desc" }] }, "status", "/sort/0/key"],
    ] as const) {
      const r = await call(api.app, "POST", V, { session: office, body: viewBody(over) });
      expect([r.status, r.body.code, r.body.params, r.body.errors?.[0]?.pointer]).toEqual([
        422,
        "saved_view.unknown_key",
        { key },
        pointer,
      ]);
      expect(r.body.detail).toBe(`This view uses a column, filter or sort that the list does not offer: ${key}.`);
      expect(await requestAudit(r)).toEqual([]);
    }
    const v = await create(office);
    const put = await call(api.app, "PUT", `${V}/${v.id}`, {
      session: office,
      body: fullUpdate(v, { columns: ["title"] }),
      headers: ifm(1),
    });
    expect([put.status, put.body.params]).toEqual([422, { key: "title" }]);
  });

  it("a filter value of the wrong format or a list for a single-valued filter -> 400; the shape rules -> 400", async () => {
    for (const filters of [
      { waveId: "not-a-uuid" },
      { status: "unknown_status" },
      { status: ["draft", "funded"] },
      { q: "\u0000" },
      { q: "   " },
    ]) {
      const r = await call(api.app, "POST", V, { session: office, body: viewBody({ filters }) });
      expect(r.status, JSON.stringify(filters)).toBe(400);
    }
    const ok = await call(api.app, "POST", V, {
      session: office,
      body: viewBody({
        listKey: "transformations",
        columns: ["code"],
        filters: { status: ["draft", "active"] },
        sort: [],
      }),
    });
    expect(ok.status).toBe(201);
    for (const over of [
      { columns: ["code", "code"] },
      { columns: [] },
      {
        sort: [
          { key: "code", direction: "asc" },
          { key: "code", direction: "desc" },
        ],
      },
      { sort: [{ key: "code", direction: "up" }] },
      { name: "" },
      { name: "x".repeat(121) },
      { listKey: "budgets" },
      { extra: true },
    ]) {
      const r = await call(api.app, "POST", V, { session: office, body: viewBody(over) });
      expect(r.status, JSON.stringify(over)).toBe(400);
    }
  });

  it("a duplicate name (case-insensitive) -> 409 saved_view.name_taken; another list, transformation or owner may reuse it", async () => {
    const name = uniq("Same name ");
    await create(office, { name });
    const dup = await call(api.app, "POST", V, { session: office, body: viewBody({ name: name.toLowerCase() }) });
    expect([dup.status, dup.body.code, dup.body.detail]).toEqual([
      409,
      "saved_view.name_taken",
      "You already have a view with this name for this list.",
    ]);
    expect(
      (
        await call(api.app, "POST", V, {
          session: office,
          body: viewBody({ name, listKey: "search", columns: ["title"], filters: {}, sort: [] }),
        })
      ).status,
    ).toBe(201);
    expect((await call(api.app, "POST", V, { session: admin, body: viewBody({ name }) })).status).toBe(201);
    const other = await create(office);
    const rename = await call(api.app, "PUT", `${V}/${other.id}`, {
      session: office,
      body: fullUpdate(other, { name: name.toUpperCase() }),
      headers: ifm(1),
    });
    expect([rename.status, rename.body.code]).toEqual([409, "saved_view.name_taken"]);
    // A deleted view frees its name.
    const gone = await create(office);
    await call(api.app, "DELETE", `${V}/${gone.id}`, { session: office, headers: ifm(1) });
    expect((await call(api.app, "POST", V, { session: office, body: viewBody({ name: gone.name }) })).status).toBe(201);
  });

  it("setting a default clears the previous one (its own version step and audit event)", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const a = await create(s, { isDefault: true });
    expect(a.isDefault).toBe(true);
    const b = await call(api.app, "POST", V, { session: s, body: viewBody({ isDefault: true }) });
    expect([b.status, b.body.isDefault]).toEqual([201, true]);
    const aNow = (await call(api.app, "GET", `${V}/${a.id}`, { session: s })).body;
    expect([aNow.isDefault, aNow.version]).toEqual([false, 2]);
    const events = await requestAudit(b);
    expect(events.map((e) => [e.action, e.record_id, e.prior_version, e.new_version])).toEqual([
      ["saved_view.updated", a.id, 1, 2],
      ["saved_view.created", b.body.id, null, 1],
    ]);
    // Put a back as the default: b is cleared.
    const put = await call(api.app, "PUT", `${V}/${a.id}`, {
      session: s,
      body: fullUpdate(aNow, { isDefault: true }),
      headers: ifm(2),
    });
    expect([put.status, put.body.isDefault]).toEqual([200, true]);
    expect((await call(api.app, "GET", `${V}/${b.body.id}`, { session: s })).body.isDefault).toBe(false);
    // A default per (list, transformation): a default of another list stays.
    const other = await create(s, { listKey: "search", columns: ["title"], filters: {}, sort: [], isDefault: true });
    expect((await call(api.app, "GET", `${V}/${a.id}`, { session: s })).body.isDefault).toBe(true);
    expect(other.isDefault).toBe(true);
    // Deleting the default leaves no default.
    await call(api.app, "DELETE", `${V}/${a.id}`, { session: s, headers: ifm(3) });
    const defaults = await api.db
      .selectFrom("saved_view")
      .select("id")
      .where("owner_user_id", "=", u.id)
      .where("list_key", "=", "initiatives")
      .where("is_default", "=", true)
      .execute();
    expect(defaults).toEqual([]);
  });

  it("a concurrent default switch -> 409 saved_view.default_conflict; the first default stays", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "SP", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const racerId = uuidv7();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let xid = "";
    let inserted!: () => void;
    const insertedP = new Promise<void>((resolve) => (inserted = resolve));
    // Another transaction makes a view the default for (u, tom_gaps, any transformation) and has not committed yet.
    const racer = api.db.transaction().execute(async (tx) => {
      await tx
        .insertInto("saved_view")
        .values({
          id: racerId,
          organization_id: w.orgA.id,
          owner_user_id: u.id,
          list_key: "tom_gaps",
          name: "Racer",
          columns: JSON.stringify(["gap"]),
          is_default: true,
          created_by: u.id,
          updated_by: u.id,
        })
        .execute();
      await insertAuditEvent(
        tx,
        { actorType: "user", actorUserId: u.id, requestId: `be-q-racer-${racerId}`, source: "api" },
        {
          action: "saved_view.created",
          recordType: "saved_view",
          recordId: racerId,
          organizationId: w.orgA.id,
          newVersion: 1,
        },
      );
      xid = (await sql<{ x: string }>`SELECT (txid_current() % 4294967296)::text AS x`.execute(tx)).rows[0]!.x;
      inserted();
      await held;
    });
    await insertedP;
    const pending = call(api.app, "POST", V, {
      session: s,
      body: viewBody({ listKey: "tom_gaps", columns: ["gap"], filters: {}, sort: [], isDefault: true }),
    });
    await waitFor(xidWaiters(xid), "the create to wait on the racing default");
    release();
    await racer;
    const res = await pending;
    expect([res.status, res.body.code, res.body.detail]).toEqual([
      409,
      "saved_view.default_conflict",
      "Another view was made the default for this list at the same time. Reload the list and try again.",
    ]);
    const rows = await api.db
      .selectFrom("saved_view")
      .select(["id", "is_default"])
      .where("owner_user_id", "=", u.id)
      .where("list_key", "=", "tom_gaps")
      .execute();
    expect(rows).toEqual([{ id: racerId, is_default: true }]);
  });
});

describe("the list registry equals the contract (ADR-0057 §4, §5)", () => {
  type Json = Record<string, Body>;
  const doc = openapi as Json;
  const deref = (o: Body): Body => {
    let cur = o;
    while (cur && typeof cur === "object" && typeof cur.$ref === "string")
      cur = cur.$ref
        .slice(2)
        .split("/")
        .reduce((a: Body, k: string) => a[k], doc);
    return cur;
  };
  const operation = (operationId: string) => {
    for (const item of Object.values(doc["paths"] as Json))
      for (const op of Object.values(item as Json))
        if (op && typeof op === "object" && op.operationId === operationId)
          return { op, params: [...((item as Json)["parameters"] ?? []), ...(op.parameters ?? [])].map(deref) };
    throw new Error(`no operation ${operationId}`);
  };

  it("names the 12 list keys of the contract's SavedViewListKey enum", () => {
    expect([...SAVED_VIEW_LIST_KEYS].sort()).toEqual([...doc["components"].schemas.SavedViewListKey.enum].sort());
    expect(Object.keys(SAVED_VIEW_LISTS).sort()).toEqual([...SAVED_VIEW_LIST_KEYS].sort());
  });

  it.each([...SAVED_VIEW_LIST_KEYS])("%s: columns, filters and sorts equal its operation's contract", (listKey) => {
    const spec = SAVED_VIEW_LISTS[listKey];
    const { op, params } = operation(spec.operationId);
    const page = deref(deref(op.responses["200"]).content["application/json"].schema);
    const item = deref(page.properties.items.items);
    expect([...spec.columns].sort()).toEqual(Object.keys(item.properties).sort());
    const query = params.filter((p: Body) => p.in === "query");
    const filterParams = query.filter((p: Body) => !["cursor", "limit", "sort"].includes(p.name));
    expect(spec.filters.map((f) => f.key).sort()).toEqual(filterParams.map((p: Body) => p.name).sort());
    for (const f of spec.filters) {
      const schema = deref(filterParams.find((p: Body) => p.name === f.key).schema);
      expect(f.multiple, f.key).toBe(schema.type === "array");
      const value = f.multiple ? deref(schema.items) : schema;
      if (f.format.kind === "uuid") expect(value.format, f.key).toBe("uuid");
      if (f.format.kind === "boolean") expect(value.type, f.key).toBe("boolean");
      if (f.format.kind === "enum") expect([...f.format.values].sort(), f.key).toEqual([...value.enum].sort());
      if (f.format.kind === "text") expect([value.type, value.maxLength], f.key).toEqual(["string", 200]);
    }
    expect(spec.transformationScoped).toBe(params.some((p: Body) => p.in === "path" && p.name === "transformationId"));
    // Sorts: the ADR-0057 §5 parameter (the last `sort` declared). An enumerated parameter lists them exactly; the
    // RegisterSort pattern leaves them to RegisterSpec.sortColumns (BE-R), so each key fits the pattern and is a column.
    const sorts = query.filter((p: Body) => p.name === "sort");
    if (sorts.length === 0) {
      expect(spec.sorts).toEqual([]);
      return;
    }
    const sortSchema = deref(sorts[sorts.length - 1].schema);
    if (sortSchema.enum)
      expect([...spec.sorts].sort()).toEqual(
        [...new Set((sortSchema.enum as string[]).map((s) => s.replace(/^-/, "")))].sort(),
      );
    else {
      const pattern = new RegExp(sortSchema.pattern);
      for (const key of spec.sorts) {
        expect(pattern.test(key) && pattern.test(`-${key}`), key).toBe(true);
        expect(spec.columns, key).toContain(key);
      }
    }
  });

  it("the helpers: the first unknown key in order columns, filters, sorts; filter formats", () => {
    expect(savedViewUnknownKey("initiatives", { columns: ["code"], filters: {}, sort: [] })).toBeNull();
    expect(
      savedViewUnknownKey("initiatives", {
        columns: ["x"],
        filters: { y: "1" },
        sort: [{ key: "z", direction: "asc" }],
      }),
    ).toEqual({ key: "x", pointer: "/columns/0" });
    expect(savedViewFilterValueError("initiatives", { waveId: "01920000-0000-7000-8000-000000000001" })).toBeNull();
    expect(
      savedViewFilterValueError("search", { recordType: ["lesson", "benefit"], includeArchived: "true" }),
    ).toBeNull();
    expect(savedViewFilterValueError("search", { includeArchived: "yes" })).toEqual({
      key: "includeArchived",
      pointer: "/filters/includeArchived",
      expected: "boolean",
    });
  });
});
