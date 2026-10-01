// REPRODUCTION ONLY (code-security-reviewer, DG1 round 1). Copied into a DISPOSABLE copy of candidate 2c22c27 at
// apps/api/test/integration/zz-review-bu-hierarchy.test.ts and run there; never part of the candidate tree.
// Same deterministic technique as access-derived-race.test.ts: a test-only trigger parks a transaction on an advisory
// lock the test holds (no data change, no sleeps). Runs on its own scratch database of the disposable cluster.
//  SEC-1  two concurrent re-parent PATCHes (A under C, B under A, with C under B) both pass the API cycle check and
//         commit a cycle A->C->B->A.
//  SEC-2  re-parenting checks business_unit.manage on the MOVED unit only, never on the destination parent, so a
//         unit-scoped manager moves a unit into a sibling branch it has no rights on.
import { migrate } from "@mth/db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../packages/db/test/helpers.ts";
import {
  call,
  createBu,
  createTransformationRow,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;
let scratchDb: string;
const HOOK_KEY = 990_001;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_revsec");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at organization A
  await api.owner.query(`CREATE TABLE revsec_hook (bu_id uuid)`);
  await api.owner.query(`GRANT SELECT ON revsec_hook TO mth_app`);
  await api.owner.query(`
    CREATE FUNCTION revsec_park() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.parent_business_unit_id IS DISTINCT FROM NEW.parent_business_unit_id
         AND EXISTS (SELECT 1 FROM revsec_hook WHERE bu_id = NEW.id) THEN
        PERFORM pg_advisory_xact_lock(${HOOK_KEY});
      END IF;
      RETURN NEW;
    END $$`);
  await api.owner.query(
    `CREATE TRIGGER revsec_park AFTER UPDATE ON business_unit FOR EACH ROW EXECUTE FUNCTION revsec_park()`,
  );
});
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

async function waitForAdvisoryWaiters(n: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await api.owner.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype = 'advisory'`,
    );
    if ((rows[0] as { n: number }).n >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${n} advisory waiter(s)`);
}

async function waitForRowWaiter(): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await api.owner.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype IN ('transactionid', 'tuple')`,
    );
    if ((rows[0] as { n: number }).n >= 1) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("timed out waiting for a row-lock waiter");
}

const move = (session: Session, bu: string, parent: string | null, version = 1) =>
  call(api.app, "PATCH", `/api/v1/business-units/${bu}`, {
    session,
    headers: { "if-match": `"${version}"` },
    body: { parentBusinessUnitId: parent },
  });

describe("SEC-1 concurrent re-parenting creates a business-unit cycle", () => {
  // A 2-cycle (X->Y with Y->X) is serialized by accident: the FK check of "X under Y" KEY-SHARE-locks Y, which blocks
  // the reverse move's SELECT ... FOR UPDATE of Y BEFORE its cycle check (attempt 1 log). A 3-cycle is not: the second
  // move's FOR UPDATE row is not touched by the first, its cycle check reads the committed (stale) hierarchy, and only
  // its own FK check blocks - AFTER the check passed.
  it("A->C and B->A (with C already under B) both return 200 and the committed hierarchy has a cycle A->C->B->A", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    // Sequential control: once A is under C, moving B under A is refused as a cycle (the API check works serially).
    const cb = await createBu(api.db, w.orgA.id);
    const cc = await createBu(api.db, w.orgA.id, cb);
    const ca = await createBu(api.db, w.orgA.id);
    expect((await move(admin, ca, cc)).status).toBe(200);
    const ctl = await move(admin, cb, ca);
    console.log("SEC-1 sequential control (B under A after A under C):", ctl.status, JSON.stringify(ctl.body));
    expect(ctl.status).toBe(422);

    await api.owner.query("INSERT INTO revsec_hook (bu_id) VALUES ($1)", [a]);
    const hold: pg.PoolClient = await api.owner.connect();
    await hold.query("SELECT pg_advisory_lock($1)", [HOOK_KEY]);
    let r1, r2;
    let released = false;
    try {
      const p1 = move(admin, a, c); // checks, updates A, parks (uncommitted)
      await waitForAdvisoryWaiters(1);
      const p2 = move(admin, b, a); // cycle check reads committed A (root) -> passes; its FK check then waits on A
      await waitForRowWaiter();
      await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
      released = true;
      [r1, r2] = await Promise.all([p1, p2]);
    } finally {
      if (!released) await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
      hold.release();
    }
    console.log("SEC-1 statuses: A->C", r1.status, "| B->A", r2.status);
    const { rows } = await api.owner.query(
      "SELECT id, parent_business_unit_id AS parent FROM business_unit WHERE id = ANY($1::uuid[])",
      [[a, b, c]],
    );
    const parentOf = new Map(rows.map((r: { id: string; parent: string }) => [r.id, r.parent]));
    console.log("SEC-1 committed: parent(A)=C?", parentOf.get(a) === c, "parent(C)=B?", parentOf.get(c) === b, "parent(B)=A?", parentOf.get(b) === a);
    const closure = await api.owner.query(
      "SELECT count(*)::int AS n, max(depth) AS maxdepth FROM business_unit_closure WHERE descendant_id = $1",
      [a],
    );
    console.log("SEC-1 closure rows with A as descendant:", JSON.stringify(closure.rows[0]));
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(parentOf.get(a)).toBe(c);
    expect(parentOf.get(c)).toBe(b);
    expect(parentOf.get(b)).toBe(a); // cycle A -> C -> B -> A committed through the API
  });
});

describe("SEC-2 re-parenting does not authorize the destination parent", () => {
  it("a manager scoped to BU a1 moves a1x under sibling a2 (no rights on a2); a2's inheriting users gain a1x records", async () => {
    // U: ADM_TECH (business_unit.manage, structural -> applies downward) at BU a1 only.
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const su = await signIn(api.app, u.subject);
    // V: auditor (AUD, inherits downward, holds transformation.read) at sibling BU a2 only.
    const v = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, v.id, "AUD", { type: "business_unit", id: w.a2 }, w.orgA.id);
    const sv = await signIn(api.app, v.subject);
    const tx = await createTransformationRow(api.db, w.orgA.id, w.a1x, w.leadA1.id);

    // Control: U cannot manage a2 itself (sibling) - 404/403.
    const ctl = await call(api.app, "PATCH", `/api/v1/business-units/${w.a2}`, {
      session: su,
      headers: { "if-match": '"1"' },
      body: { nameEn: "Renamed by a1 manager" },
    });
    console.log("SEC-2 control: U PATCH a2 ->", ctl.status);
    expect([403, 404]).toContain(ctl.status);
    // Before: V (a2 branch) cannot see the a1x transformation.
    const before = await call(api.app, "GET", `/api/v1/transformations/${tx}`, { session: sv });
    // The move: U re-parents a1x (inside U's scope) under a2 (outside U's scope).
    const moved = await move(su, w.a1x, w.a2);
    // After: V now reads it; U itself has lost the unit it moved.
    const after = await call(api.app, "GET", `/api/v1/transformations/${tx}`, { session: sv });
    const uAfter = await call(api.app, "GET", `/api/v1/business-units/${w.a1x}`, { session: su });
    console.log("SEC-2 V read before:", before.status, "| U move a1x->a2:", moved.status, "| V read after:", after.status, "| U read a1x after:", uAfter.status);
    expect(before.status).toBe(404);
    expect(moved.status).toBe(200);
    expect(after.status).toBe(200);
  });
});
