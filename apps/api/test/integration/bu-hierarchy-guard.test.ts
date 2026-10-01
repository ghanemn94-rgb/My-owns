// Business-unit hierarchy under concurrency and destination authorization (T-DG1-BE-R2; REQ-S19-004, REQ-DLV-033).
//  F-DG1-140  two concurrent re-parents (A under C while B moves under A, with C under B) must never commit a cycle:
//             - through the API, the loser is refused 422 business_unit.cycle (serialized on the hierarchy lock);
//             - in the database alone (migration 0009 trigger), the loser fails with 23514 / 40001 under READ
//               COMMITTED and REPEATABLE READ, so no client can commit a cycle or an over-deep tree.
//  F-DG1-141  a re-parent needs business_unit.manage on the destination parent too (403, audited), not only on the
//             moved unit; the legitimate in-scope move still succeeds.
// Deterministic interleaving without sleeps: the same advisory-lock parking trigger the code-security reviewer used
// (docs/delivery/test-evidence/DG1/code-security/round-1/repro-bu/zz-review-bu-hierarchy.test.ts, also the technique
// of access-derived-race.test.ts). It runs on its own scratch database, because it adds a test-only trigger.
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
const HOOK_KEY = 990_141;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_buguard");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  appUrl = roleUrl(adminUrl, scratchDb, "mth_app");
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject); // ADM_TECH + ADM_ACCESS at organization A
  await api.owner.query(`CREATE TABLE buguard_hook (bu_id uuid)`);
  await api.owner.query(`GRANT SELECT ON buguard_hook TO mth_app`);
  await api.owner.query(`
    CREATE FUNCTION buguard_park() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF OLD.parent_business_unit_id IS DISTINCT FROM NEW.parent_business_unit_id
         AND EXISTS (SELECT 1 FROM buguard_hook WHERE bu_id = NEW.id) THEN
        PERFORM pg_advisory_xact_lock(${HOOK_KEY});
      END IF;
      RETURN NEW;
    END $$`);
  // Fires after the row is written and after business_unit_hierarchy_guard (triggers fire in name order), i.e. while
  // the parked transaction holds its row lock and the hierarchy lock, uncommitted.
  await api.owner.query(
    `CREATE TRIGGER zz_buguard_park AFTER UPDATE ON business_unit FOR EACH ROW EXECUTE FUNCTION buguard_park()`,
  );
});
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

async function waiters(kind: "advisory" | "row"): Promise<number> {
  const types = kind === "advisory" ? ["advisory"] : ["transactionid", "tuple"];
  // Only waiters in this suite's scratch database (other integration files may run concurrently on the cluster).
  const { rows } = await api.owner.query(
    `SELECT count(*)::int AS n FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
     WHERE NOT l.granted AND l.locktype = ANY($1::text[]) AND a.datname = current_database()`,
    [types],
  );
  return (rows[0] as { n: number }).n;
}

async function waitFor(kind: "advisory" | "row", n: number): Promise<void> {
  for (let i = 0; i < 400; i++) {
    if ((await waiters(kind)) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${n} ${kind} lock waiter(s)`);
}

async function parentsOf(ids: string[]): Promise<Map<string, string | null>> {
  const { rows } = await api.owner.query(
    "SELECT id, parent_business_unit_id AS parent FROM business_unit WHERE id = ANY($1::uuid[])",
    [ids],
  );
  return new Map(rows.map((r: { id: string; parent: string | null }) => [r.id, r.parent]));
}

/** True when some unit is its own ancestor (the closure view stops at depth 10, so a loop shows as depth > 0). */
async function anyCycle(): Promise<boolean> {
  const { rows } = await api.owner.query(
    "SELECT EXISTS (SELECT 1 FROM business_unit_closure WHERE ancestor_id = descendant_id AND depth > 0) AS c",
  );
  return (rows[0] as { c: boolean }).c;
}

const move = (session: Session, bu: string, parent: string | null, version = 1) =>
  call(api.app, "PATCH", `/api/v1/business-units/${bu}`, {
    session,
    headers: { "if-match": `"${version}"` },
    body: { parentBusinessUnitId: parent },
  });

async function appClient(): Promise<pg.Client> {
  const c = new pg.Client({ connectionString: appUrl });
  c.on("error", () => undefined);
  await c.connect();
  return c;
}

/** The error a promise rejects with (or null when it resolves). */
const failure = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { code?: string; constraint?: string }) => ({ code: e.code, constraint: e.constraint }),
  );

describe("F-DG1-140 concurrent re-parenting through the API never commits a cycle", () => {
  it("A->C and B->A (with C under B) interleaved: one 200, the other 422 business_unit.cycle; no cycle persists", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);

    await api.owner.query("INSERT INTO buguard_hook (bu_id) VALUES ($1)", [a]);
    const hold = await api.owner.connect();
    await hold.query("SELECT pg_advisory_lock($1)", [HOOK_KEY]);
    let r1, r2;
    let released = false;
    try {
      const p1 = move(admin, a, c); // checks, updates A, parks holding the hierarchy lock (uncommitted)
      await waitFor("advisory", 1);
      // Before the fix this request read the committed hierarchy (A still a root), passed its cycle check and only
      // then blocked on A's row; now it waits on the organization's hierarchy lock BEFORE checking anything.
      const p2 = move(admin, b, a);
      await waitFor("advisory", 2);
      await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
      released = true;
      [r1, r2] = await Promise.all([p1, p2]);
    } finally {
      if (!released) await hold.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
      hold.release();
      await api.owner.query("DELETE FROM buguard_hook");
    }
    expect(r1.status).toBe(200);
    expect([r2.status, r2.body.code]).toEqual([422, "business_unit.cycle"]);
    const parent = await parentsOf([a, b, c]);
    expect([parent.get(a), parent.get(c), parent.get(b)]).toEqual([c, b, null]);
    expect(await anyCycle()).toBe(false);
  });

  it("the sequential control is still the friendly 422 business_unit.cycle", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    expect((await move(admin, a, c)).status).toBe(200);
    const r = await move(admin, b, a);
    expect([r.status, r.body.code]).toEqual([422, "business_unit.cycle"]);
  });
});

describe("F-DG1-140 the database guard (migration 0009) fails closed on its own", () => {
  it("refuses a direct cycle and an over-deep chain with 23514 and the named constraint", async () => {
    const x = await createBu(api.db, w.orgA.id);
    const y = await createBu(api.db, w.orgA.id, x);
    const z = await createBu(api.db, w.orgA.id, y);
    const c = await appClient();
    try {
      expect(
        await failure(c.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [z, x])),
      ).toEqual({ code: "23514", constraint: "business_unit_acyclic" });
      // One statement that closes a loop over several rows is checked on its final state too.
      const p = await createBu(api.db, w.orgA.id);
      const q = await createBu(api.db, w.orgA.id);
      expect(
        await failure(
          c.query(
            `UPDATE business_unit SET parent_business_unit_id = CASE id WHEN $1::uuid THEN $2::uuid ELSE $1::uuid END
             WHERE id IN ($1::uuid, $2::uuid)`,
            [p, q],
          ),
        ),
      ).toMatchObject({ code: "23514" });
      // Depth: 10 levels are allowed, the 11th is refused (inserting and moving).
      let parent: string | null = null;
      const chain: string[] = [];
      for (let i = 0; i < 10; i++) chain.push((parent = await createBu(api.db, w.orgA.id, parent)));
      expect(
        await failure(
          c.query(
            `INSERT INTO business_unit (id, organization_id, parent_business_unit_id, code, name_en, name_ar)
             VALUES (gen_random_uuid(), $1, $2, 'DEEP11', 'Too deep', 'عميق')`,
            [w.orgA.id, chain[9]],
          ),
        ),
      ).toEqual({ code: "23514", constraint: "business_unit_max_depth" });
      const leafParent = await createBu(api.db, w.orgA.id);
      await createBu(api.db, w.orgA.id, leafParent); // a 2-level subtree
      expect(
        await failure(
          c.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [chain[8], leafParent]),
        ),
      ).toEqual({ code: "23514", constraint: "business_unit_max_depth" });
    } finally {
      await c.end();
    }
    expect(await anyCycle()).toBe(false);
  });

  it("READ COMMITTED: two raw transactions forming A->C->B->A - the second fails with 23514 after the first commits", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    const t1 = await appClient();
    const t2 = await appClient();
    try {
      await t1.query("BEGIN");
      await t2.query("BEGIN");
      await t1.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [c, a]);
      const second = failure(t2.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [a, b]));
      await waitFor("row", 1).catch(() => waitFor("advisory", 1)); // t2 is blocked behind t1
      await t1.query("COMMIT");
      expect(await second).toEqual({ code: "23514", constraint: "business_unit_acyclic" });
      await t2.query("ROLLBACK");
    } finally {
      await t1.end();
      await t2.end();
    }
    const parent = await parentsOf([a, b, c]);
    expect([parent.get(a), parent.get(c), parent.get(b)]).toEqual([c, b, null]);
    expect(await anyCycle()).toBe(false);
  });

  it("REPEATABLE READ with a snapshot older than the first commit: the second fails (40001 or 23514), no cycle", async () => {
    const b = await createBu(api.db, w.orgA.id);
    const c = await createBu(api.db, w.orgA.id, b);
    const a = await createBu(api.db, w.orgA.id);
    const t1 = await appClient();
    const t2 = await appClient();
    try {
      await t2.query("BEGIN ISOLATION LEVEL REPEATABLE READ");
      await t2.query("SELECT count(*) FROM business_unit"); // takes t2's snapshot: A is a root here
      await t1.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [c, a]); // autocommit
      const err = await failure(
        t2.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [a, b]),
      );
      expect(err).not.toBeNull();
      expect(["40001", "23514"]).toContain(err!.code);
      await t2.query("ROLLBACK");
    } finally {
      await t1.end();
      await t2.end();
    }
    expect(await anyCycle()).toBe(false);
  });

  it("READ COMMITTED depth race: a move that makes a subtree 10 deep and a concurrent child insert below it", async () => {
    // P1..P5 (5 levels) and S1..S5 (5 levels). Moving S1 under P5 gives exactly 10 levels; a child of S5 makes 11.
    let p: string | null = null;
    for (let i = 0; i < 5; i++) p = await createBu(api.db, w.orgA.id, p);
    let s: string | null = null;
    let s1 = "";
    for (let i = 0; i < 5; i++) {
      s = await createBu(api.db, w.orgA.id, s);
      if (i === 0) s1 = s;
    }
    const t1 = await appClient();
    const t2 = await appClient();
    try {
      await t1.query("BEGIN");
      await t1.query("UPDATE business_unit SET parent_business_unit_id = $1 WHERE id = $2", [p, s1]);
      const insert = failure(
        t2.query(
          `INSERT INTO business_unit (id, organization_id, parent_business_unit_id, code, name_en, name_ar)
           VALUES (gen_random_uuid(), $1, $2, 'RACE11', 'Race', 'سباق')`,
          [w.orgA.id, s],
        ),
      );
      await waitFor("advisory", 1); // t2's guard waits on the hierarchy lock t1 holds
      await t1.query("COMMIT");
      expect(await insert).toEqual({ code: "23514", constraint: "business_unit_max_depth" });
    } finally {
      await t1.end();
      await t2.end();
    }
    const { rows } = await api.owner.query("SELECT max(depth)::int AS d FROM business_unit_closure");
    expect((rows[0] as { d: number }).d).toBeLessThanOrEqual(9);
  });
});

describe("F-DG1-141 re-parenting authorizes the destination parent too", () => {
  it("a manager scoped to BU a1 cannot move a1 units under sibling a2 or to the top level (403, audited); in-scope moves work", async () => {
    // U: ADM_TECH (business_unit.manage, structural -> applies downward) at BU a1 only.
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const su = await signIn(api.app, u.subject);
    // V: auditor (AUD, inherits downward) at sibling BU a2 only; a transformation under a fresh child of a1.
    const v = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, v.id, "AUD", { type: "business_unit", id: w.a2 }, w.orgA.id);
    const sv = await signIn(api.app, v.subject);
    const moved = await createBu(api.db, w.orgA.id, w.a1);
    const tx = await createTransformationRow(api.db, w.orgA.id, moved, w.leadA1.id);
    expect((await call(api.app, "GET", `/api/v1/transformations/${tx}`, { session: sv })).status).toBe(404);

    // Negative: into the sibling branch a2 (U holds nothing there).
    const denied = await move(su, moved, w.a2);
    expect([denied.status, denied.body.code]).toEqual([403, "forbidden"]);
    const denials = (await auditOf(api.db, w.a2)).filter(
      (e) => e.action === "authorization.denied" && e.actor_user_id === u.id,
    );
    expect(denials).toHaveLength(1);
    expect(denials[0]!.reason).toMatch(/business_unit\.manage/);
    // Negative: to the top level (the destination is the organization, where U holds nothing).
    expect((await move(su, moved, null)).status).toBe(403);
    // Nothing moved, nothing exposed.
    expect((await parentsOf([moved])).get(moved)).toBe(w.a1);
    expect((await call(api.app, "GET", `/api/v1/transformations/${tx}`, { session: sv })).status).toBe(404);

    // Positive: a move inside U's own branch (under a1x, a descendant of a1) still succeeds.
    const ok = await move(su, moved, w.a1x);
    expect([ok.status, ok.body.parentBusinessUnitId]).toEqual([200, w.a1x]);
    // Positive: an organization-scope manager may move across branches (and to the top level).
    const across = await move(admin, moved, w.a2, 2);
    expect([across.status, across.body.parentBusinessUnitId]).toEqual([200, w.a2]);
    expect((await move(admin, moved, null, 3)).status).toBe(200);
  });
});
