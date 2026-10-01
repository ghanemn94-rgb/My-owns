// DG1 round-3 code-security reviewer's OWN interleavings for F-DG1-115 (not the implementer's A-D).
// Copied into a DISPOSABLE clone as apps/api/test/integration/zz-f115-reviewer.test.ts; runs on its own scratch DB.
//  E. the revoke COMMITS completely while the create is parked right after its transformation INSERT (i.e. after the
//     authorization check, before the derive step). Expected: create 403, rolled back (no transformation, no derived
//     assignment), audited as authorization.denied; no active assignment of the lead remains.
//  F. no hooks: 15 rounds of a create and a revoke of its source fired concurrently. Invariant after each round: no
//     ACTIVE derived assignment whose source is revoked; a 201 create is never readable by the lead after re-login.
import { migrate } from "@mth/db";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../packages/db/test/helpers.ts";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;
let scratchDb: string;
const KEY = 115_777;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_f115rv");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  await api.owner.query(`CREATE TABLE f115rv_hook (name text)`);
  await api.owner.query(`GRANT SELECT ON f115rv_hook TO mth_app`);
  await api.owner.query(`
    CREATE FUNCTION f115rv_park() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM f115rv_hook WHERE name = NEW.name) THEN PERFORM pg_advisory_xact_lock(${KEY}); END IF;
      RETURN NEW;
    END $$`);
  await api.owner.query(
    `CREATE TRIGGER f115rv_park AFTER INSERT ON transformation FOR EACH ROW EXECUTE FUNCTION f115rv_park()`,
  );
});
afterAll(async () => {
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

const revoke = (id: string, reason: string) =>
  call(api.app, "POST", `/api/v1/role-assignments/${id}/revoke`, {
    session: admin,
    headers: { "if-match": '"1"' },
    body: { reason },
  });
const create = (session: Session, name: string) =>
  call<{ id: string }>(api.app, "POST", "/api/v1/transformations", {
    session,
    body: { businessUnitId: w.a1, name, mode: "end_to_end" },
  });
const orphans = async () =>
  (
    await api.owner.query(`SELECT d.id FROM scoped_assignment d JOIN scoped_assignment s ON s.id = d.derived_from_assignment_id
                           WHERE d.revoked_at IS NULL AND s.revoked_at IS NOT NULL`)
  ).rows;

async function waitAdvisoryWaiter() {
  for (let i = 0; i < 200; i++) {
    const { rows } = await api.owner.query(`SELECT count(*)::int n FROM pg_locks WHERE NOT granted AND locktype='advisory'`);
    if (rows[0].n >= 1) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error("create never parked");
}

describe("F-DG1-115 reviewer interleavings", () => {
  it("E. revoke fully commits between the create's authorization and its derive step -> 403, rollback, audited", async () => {
    const lead = await createUser(api.db, w.orgA.id);
    const source = await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const session = await signIn(api.app, lead.subject);
    const name = `F115-E ${source}`;
    await api.owner.query("INSERT INTO f115rv_hook VALUES ($1)", [name]);
    const c: pg.PoolClient = await api.owner.connect();
    await c.query("SELECT pg_advisory_lock($1)", [KEY]);
    let createdStatus = 0;
    try {
      const createP = create(session, name);
      await waitAdvisoryWaiter(); // the create has authorized and inserted the transformation; parked, uncommitted
      const r = await revoke(source, "Synthetic: revoke commits while the create is parked (E)");
      console.log(`[E] revoke status ${r.status} (completed while the create was parked)`);
      expect(r.status).toBe(200);
      await c.query("SELECT pg_advisory_unlock($1)", [KEY]);
      const created = await createP;
      createdStatus = created.status;
      console.log(`[E] create status ${created.status} body ${JSON.stringify(created.body).slice(0, 160)}`);
    } finally {
      c.release();
    }
    expect(createdStatus).toBe(403);
    expect((await api.db.selectFrom("transformation").select("id").where("name", "=", name).execute()).length).toBe(0);
    const active = await api.db.selectFrom("scoped_assignment").select("id").where("user_id", "=", lead.id).where("revoked_at", "is", null).execute();
    expect(active).toEqual([]);
    const denied = await api.db.selectFrom("audit_event").select(["action", "record_type"]).where("actor_user_id", "=", lead.id).where("action", "=", "authorization.denied").execute();
    console.log(`[E] audit for the lead: ${JSON.stringify(denied)}`);
    expect(denied).toEqual([{ action: "authorization.denied", record_type: "business_unit" }]);
    expect(await orphans()).toEqual([]);
  });

  it("F. 15 unhooked concurrent create/revoke rounds never leave an active derived assignment with a revoked source", async () => {
    const tally: Record<string, number> = {};
    for (let i = 0; i < 15; i++) {
      const lead = await createUser(api.db, w.orgA.id);
      const source = await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
      const session = await signIn(api.app, lead.subject);
      const [c, r] = await Promise.all([
        create(session, `F115-F ${i} ${source}`),
        revoke(source, `Synthetic: concurrent revoke round ${i}`),
      ]);
      const k = `create=${c.status} revoke=${r.status}`;
      tally[k] = (tally[k] ?? 0) + 1;
      expect(await orphans()).toEqual([]);
      if (c.status === 201) {
        const fresh = await signIn(api.app, lead.subject);
        expect((await call(api.app, "GET", `/api/v1/transformations/${c.body.id}`, { session: fresh })).status).toBe(404);
      }
    }
    console.log(`[F] outcome tally: ${JSON.stringify(tally)}`);
  });
});
