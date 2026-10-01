// REPRODUCTION ONLY (code-security-reviewer, DG1 round 2). Copied into a DISPOSABLE clone of candidate 485e91f at
// apps/api/test/integration/zz-review-r2-bu.test.ts and run there; never part of the candidate tree.
// Adversarial re-verification of F-DG1-140 (hierarchy cycle under concurrency) and F-DG1-141 (destination authz).
//  R2-1  API: the round-1 interleaving (A under C parked uncommitted, then B under A) -> the second PATCH must wait on
//        the hierarchy lock and then be refused 422 business_unit.cycle; no cycle committed.
//  R2-2  API sequential friendly 422 still holds.
//  R2-3  DB as mth_app (no API lock): same interleaving at READ COMMITTED -> 23514 business_unit_acyclic.
//  R2-4  DB as mth_app at REPEATABLE READ (snapshot taken before the winner commits) -> 40001 or 23514.
//  R2-5  DB as mth_app: ONE multi-row UPDATE swapping two roots under each other (2-cycle) -> 23514.
//  R2-6  mth_app cannot switch the guard off (session_replication_role / ALTER TABLE ... DISABLE TRIGGER).
//  R2-7  API authz: a1-scoped manager -> sibling a2: 403 + authorization.denied audit; top-level: 403; in-scope: 200;
//        destination in another org: 422 (no cross-org existence oracle); V never gains read.
import { migrate } from "@mth/db";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../packages/db/test/helpers.ts";
import {
  auditOf,
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
let appUrl: string;
const HOOK_KEY = 990_202;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_revsec2");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  appUrl = roleUrl(adminUrl, scratchDb, "mth_app");
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  await api.owner.query(`CREATE TABLE revsec2_hook (bu_id uuid)`);
  await api.owner.query(`GRANT SELECT ON revsec2_hook TO mth_app`);
  await api.owner.query(`
    CREATE FUNCTION revsec2_park() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.parent_business_unit_id IS DISTINCT FROM NEW.parent_business_unit_id
         AND EXISTS (SELECT 1 FROM revsec2_hook WHERE bu_id = NEW.id) THEN
        PERFORM pg_advisory_xact_lock(${HOOK_KEY});
      END IF;
      RETURN NEW;
    END $$`);
  // name sorts after business_unit_hierarchy_guard: parks AFTER the guard passed, holding row + hierarchy locks.
  await api.owner.query(
    `CREATE TRIGGER zz_revsec2_park AFTER UPDATE ON business_unit FOR EACH ROW EXECUTE FUNCTION revsec2_park()`,
  );
});
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

async function waitFor(sql: string, n: number, what: string): Promise<void> {
  for (let i = 0; i < 400; i++) {
    const { rows } = await api.owner.query(sql);
    if ((rows[0] as { n: number }).n >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${what}`);
}
const advisoryWaiters = (n: number) =>
  waitFor(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND locktype = 'advisory'`, n, `${n} advisory waiters`);

// attempt 2: the DB-only loser may queue on the winner's FOR SHARE row lock (guard walk) instead of the advisory lock.
const anyWaiters = (n: number) =>
  waitFor(`SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted`, n, `${n} lock waiters (any type)`);

const move = (session: Session, bu: string, parent: string | null, version = 1) =>
  call(api.app, "PATCH", `/api/v1/business-units/${bu}`, {
    session,
    headers: { "if-match": `"${version}"` },
    body: { parentBusinessUnitId: parent },
  });

async function cycles(): Promise<number> {
  const { rows } = await api.owner.query(
    `SELECT count(*)::int AS n FROM business_unit_closure WHERE ancestor_id = descendant_id AND depth > 0`,
  );
  return (rows[0] as { n: number }).n;
}

async function parked<T>(buId: string, first: () => Promise<unknown>, second: () => Promise<T>, waiters: number) {
  await api.owner.query("INSERT INTO revsec2_hook (bu_id) VALUES ($1)", [buId]);
  const hold = await api.owner.connect();
  await hold.query("SELECT pg_advisory_lock($1)", [HOOK_KEY]);
  let released = false;
  try {
    const p1 = first();
    await advisoryWaiters(1);
    const p2 = second();
    await anyWaiters(waiters); // the second must queue (hierarchy advisory lock or the guard's row lock), not commit
    const { rows: waiting } = await api.owner.query(`SELECT locktype FROM pg_locks WHERE NOT granted ORDER BY 1`);
    console.log("waiting lock types before release:", waiting.map((r: { locktype: string }) => r.locktype).join(","));
    await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
    released = true;
    const out = await Promise.allSettled([p1, p2]);
    return out;
  } finally {
    if (!released) await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
    hold.release();
    await api.owner.query("DELETE FROM revsec2_hook WHERE bu_id = $1", [buId]);
  }
}

describe("F-DG1-140 re-verification", () => {
  it("R2-2 sequential: B under A after A under C is a friendly 422 business_unit.cycle", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    expect((await move(admin, a, c)).status).toBe(200);
    const r = await move(admin, b, a);
    console.log("R2-2 sequential:", r.status, JSON.stringify(r.body));
    expect([r.status, r.body.code]).toEqual([422, "business_unit.cycle"]);
  });

  it("R2-1 API concurrent round-1 interleaving: second PATCH waits on the hierarchy lock, then 422; no cycle", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    const [s1, s2] = await parked(a, () => move(admin, a, c), () => move(admin, b, a), 2);
    const r1 = s1.status === "fulfilled" ? (s1.value as { status: number }) : null;
    const r2 = s2.status === "fulfilled" ? (s2.value as { status: number; body: { code: string } }) : null;
    console.log("R2-1 statuses: A->C", r1?.status, "| B->A", r2?.status, r2?.body.code, "| cycles:", await cycles());
    expect(r1?.status).toBe(200);
    expect([r2?.status, r2?.body.code]).toEqual([422, "business_unit.cycle"]);
    expect(await cycles()).toBe(0);
  });

  for (const iso of ["READ COMMITTED", "REPEATABLE READ"] as const) {
    it(`R2-3/4 DB-only as mth_app at ${iso}: the concurrent cycle is refused by the trigger`, async () => {
      const b = await createBu(api.db, w.orgA.id);
      const c = await createBu(api.db, w.orgA.id, b);
      const a = await createBu(api.db, w.orgA.id);
      const c1 = new pg.Client({ connectionString: appUrl });
      const c2 = new pg.Client({ connectionString: appUrl });
      await c1.connect();
      await c2.connect();
      try {
        await c1.query("BEGIN");
        await c2.query(`BEGIN ISOLATION LEVEL ${iso}`);
        await c2.query("SELECT count(*) FROM business_unit"); // take T2's snapshot BEFORE T1 commits
        const out = await parked(
          a,
          async () => {
            await c1.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [c, a]);
            await c1.query("COMMIT");
          },
          async () => {
            await c2.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [a, b]);
            await c2.query("COMMIT");
          },
          2,
        );
        const err = out[1].status === "rejected" ? (out[1].reason as { code?: string; constraint?: string }) : null;
        console.log(`R2-3/4 ${iso}: T1`, out[0].status, "| T2", out[1].status, err?.code, err?.constraint, "| cycles:", await cycles());
        expect(out[0].status).toBe("fulfilled");
        expect(out[1].status).toBe("rejected");
        expect(["23514", "40001"]).toContain(err?.code);
        await c2.query("ROLLBACK").catch(() => undefined);
        expect(await cycles()).toBe(0);
      } finally {
        await c1.end();
        await c2.end();
      }
    });
  }

  it("R2-5 DB-only: one multi-row UPDATE putting two roots under each other is refused (23514)", async () => {
    const x = await createBu(api.db, w.orgA.id);
    const y = await createBu(api.db, w.orgA.id);
    const c = new pg.Client({ connectionString: appUrl });
    await c.connect();
    try {
      const err = await c
        .query(
          `UPDATE business_unit SET parent_business_unit_id = CASE id WHEN $1::uuid THEN $2::uuid ELSE $1::uuid END
           WHERE id IN ($1::uuid, $2::uuid)`,
          [x, y],
        )
        .then(() => null, (e: { code?: string; constraint?: string }) => e);
      console.log("R2-5 single-statement 2-cycle:", err?.code, err?.constraint, "| cycles:", await cycles());
      expect(err?.code).toBe("23514");
      expect(await cycles()).toBe(0);
    } finally {
      await c.end();
    }
  });

  it("R2-6 mth_app cannot disable the guard", async () => {
    const c = new pg.Client({ connectionString: appUrl });
    await c.connect();
    try {
      const e1 = await c.query("SET session_replication_role = replica").then(() => null, (e: { code?: string }) => e);
      const e2 = await c
        .query("ALTER TABLE business_unit DISABLE TRIGGER business_unit_hierarchy_guard")
        .then(() => null, (e: { code?: string }) => e);
      const e3 = await c
        .query("CREATE OR REPLACE FUNCTION business_unit_hierarchy_guard() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RETURN NULL; END$$")
        .then(() => null, (e: { code?: string }) => e);
      console.log("R2-6 replication_role:", e1?.code, "| disable trigger:", e2?.code, "| replace fn:", e3?.code);
      expect(e1?.code).toBe("42501");
      expect(e2?.code).toBe("42501");
      expect(e3?.code).toBe("42501");
    } finally {
      await c.end();
    }
  });
});

describe("F-DG1-141 re-verification", () => {
  it("R2-7 a1-scoped manager: sibling 403 (audited), top-level 403, other-org 422, in-scope 200; no exposure", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const su = await signIn(api.app, u.subject);
    const v = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, v.id, "AUD", { type: "business_unit", id: w.a2 }, w.orgA.id);
    const sv = await signIn(api.app, v.subject);
    const unit = await createBu(api.db, w.orgA.id, w.a1);
    const deep = await createBu(api.db, w.orgA.id, w.a2); // a unit deeper in the forbidden sibling branch
    const tx = await createTransformationRow(api.db, w.orgA.id, unit, w.leadA1.id);

    const sib = await move(su, unit, w.a2);
    const sibDeep = await move(su, unit, deep);
    const top = await move(su, unit, null);
    const otherOrg = await move(su, unit, w.b1);
    const missing = await move(su, unit, "01890000-0000-7000-8000-000000000000");
    const denials = (await auditOf(api.db, w.a2)).filter(
      (e) => e.action === "authorization.denied" && e.actor_user_id === u.id,
    );
    const { rows } = await api.owner.query("SELECT parent_business_unit_id AS p, version FROM business_unit WHERE id=$1", [unit]);
    const vRead = await call(api.app, "GET", `/api/v1/transformations/${tx}`, { session: sv });
    const ok = await move(su, unit, w.a1x);
    console.log(
      "R2-7 sibling:", sib.status, sib.body.code, "| deep sibling:", sibDeep.status, "| top:", top.status,
      "| other org:", otherOrg.status, otherOrg.body.code, "| missing:", missing.status, missing.body.code,
      "| denial audits on a2:", denials.length, denials[0]?.reason, "| parent still a1:", rows[0].p === w.a1,
      "| V read:", vRead.status, "| in-scope move:", ok.status,
    );
    expect([sib.status, sib.body.code]).toEqual([403, "forbidden"]);
    expect(sibDeep.status).toBe(403);
    expect(top.status).toBe(403);
    expect(otherOrg.status).toBe(422);
    expect(missing.status).toBe(422);
    expect(otherOrg.body.code).toBe(missing.body.code); // other-org is indistinguishable from nonexistent
    expect(denials.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].p).toBe(w.a1);
    expect(rows[0].version).toBe(1);
    expect(vRead.status).toBe(404);
    expect(ok.status).toBe(200);
  });
});
