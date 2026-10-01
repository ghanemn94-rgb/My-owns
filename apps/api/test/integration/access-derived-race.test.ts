// F-DG1-115: a derived creator assignment (F-DG1-106) must never outlive a CONCURRENT revocation of its source
// business-unit grant. Both requests go through the real API against the disposable PostgreSQL database.
//
// The interleavings are made deterministic with a test-only trigger on scoped_assignment that parks the transaction
// at the critical point on an advisory lock held by the test (it changes no data). The test then waits until the
// OTHER request is really blocked on a row lock (pg_locks), and only then releases the parked one. No sleeps.
//
//  A. revoke first: the revoke has locked and updated the source row (uncommitted) when the create derives.
//     Before the fix the create read the source unlocked, saw it active and left an ACTIVE derived row behind.
//     Now the derive locks the source FOR SHARE, waits for the revoke, re-reads it revoked and the create fails (403,
//     rolled back: no transformation, no derived assignment).
//  B. create first: the create has inserted the derived row (uncommitted) when the revoke starts. The revoke waits
//     for the create's lock on the source and its cascade then revokes the derived row.
//  C. two source grants, one revoked concurrently: the create succeeds and derives only from the surviving grant.
import { migrate } from "@mth/db";
import type pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, inject, it } from "vitest";
import { createScratchDatabase, dropScratchDatabase, roleUrl } from "../../../../packages/db/test/helpers.ts";
import {
  call,
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

const HOOK_KEY = 115_001; // advisory-lock key used only by this file's trigger

// This suite adds a trigger to scoped_assignment and (C, D) temporarily changes the role catalogue. Integration files
// of one run can execute concurrently against the shared per-run database, so it runs on its OWN scratch database of
// the same disposable cluster (created, migrated with the real migrations, and dropped here).
let scratchDb: string;

beforeAll(async () => {
  const { adminUrl } = inject("mthDb");
  scratchDb = await createScratchDatabase(adminUrl, "mth_f115");
  await migrate(roleUrl(adminUrl, scratchDb, "mth_owner"));
  api = await startApi({ database: scratchDb });
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  // Test-only timing hook (no data change): parks a transaction on an advisory lock when it
  //  - revokes the assignment named in f115_hook.revoke_id, or
  //  - inserts a row derived from the assignment named in f115_hook.derive_from.
  await api.owner.query(`CREATE TABLE f115_hook (revoke_id uuid, derive_from uuid)`);
  await api.owner.query(`GRANT SELECT ON f115_hook TO mth_app`);
  await api.owner.query(`
    CREATE FUNCTION f115_park() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL
         AND EXISTS (SELECT 1 FROM f115_hook WHERE revoke_id = NEW.id) THEN
        PERFORM pg_advisory_xact_lock(${HOOK_KEY});
      ELSIF TG_OP = 'INSERT' AND NEW.derived_from_assignment_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM f115_hook WHERE derive_from = NEW.derived_from_assignment_id) THEN
        PERFORM pg_advisory_xact_lock(${HOOK_KEY});
      END IF;
      RETURN NEW;
    END $$`);
  await api.owner.query(
    `CREATE TRIGGER f115_park AFTER INSERT OR UPDATE ON scoped_assignment FOR EACH ROW EXECUTE FUNCTION f115_park()`,
  );
});
afterEach(async () => {
  await api.owner.query("DELETE FROM f115_hook");
});
afterAll(async () => {
  await api.owner.query("DROP TRIGGER IF EXISTS f115_park ON scoped_assignment");
  await api.owner.query("DROP FUNCTION IF EXISTS f115_park()");
  await api.owner.query("DROP TABLE IF EXISTS f115_hook");
  await api.close();
  await dropScratchDatabase(inject("mthDb").adminUrl, scratchDb);
});

/** Holds the hook's advisory lock on a dedicated connection until release() is called. */
async function holdHook(): Promise<{ release(): Promise<void> }> {
  const c: pg.PoolClient = await api.owner.connect();
  await c.query("SELECT pg_advisory_lock($1)", [HOOK_KEY]);
  return {
    async release() {
      await c.query("SELECT pg_advisory_unlock($1)", [HOOK_KEY]);
      c.release();
    },
  };
}

/** Waits until at least `n` backends are blocked on a lock of the given kind (fails instead of hanging). */
async function waitForWaiters(kind: "advisory" | "row", n = 1): Promise<void> {
  const predicate = kind === "advisory" ? "locktype = 'advisory'" : "locktype IN ('transactionid', 'tuple')";
  for (let i = 0; i < 200; i++) {
    const { rows } = await api.owner.query(
      `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND ${predicate}`,
    );
    if ((rows[0] as { n: number }).n >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  const { rows } = await api.owner.query(
    `SELECT a.pid, a.state, a.wait_event_type, a.wait_event, left(a.query, 120) AS query
       FROM pg_stat_activity a WHERE a.datname = current_database() AND a.pid <> pg_backend_pid()`,
  );
  throw new Error(`timed out waiting for ${n} backend(s) blocked on a ${kind} lock: ${JSON.stringify(rows)}`);
}

const assignmentsOf = (userId: string) =>
  api.db
    .selectFrom("scoped_assignment as a")
    .leftJoin("scoped_assignment as src", "src.id", "a.derived_from_assignment_id")
    .select([
      "a.id",
      "a.scope_type",
      "a.scope_id",
      "a.revoked_at",
      "a.derived_from_assignment_id",
      "src.revoked_at as source_revoked_at",
    ])
    .where("a.user_id", "=", userId)
    .execute();

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

describe("a create racing the revocation of its source BU grant leaves no active derived assignment (F-DG1-115)", () => {
  it("A. revoke first: the create waits for the revoke, sees the source revoked and is refused (nothing persists)", async () => {
    const lead = await createUser(api.db, w.orgA.id);
    const source = await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const session = await signIn(api.app, lead.subject);
    const name = `F115-A ${source}`;
    await api.owner.query("INSERT INTO f115_hook (revoke_id) VALUES ($1)", [source]);

    const hook = await holdHook();
    let released = false;
    try {
      const revokeP = revoke(source, "Synthetic: lead left the unit (race A)");
      await waitForWaiters("advisory"); // the revoke has updated the source row and is parked, uncommitted
      const createP = create(session, name);
      await waitForWaiters("row"); // the create is blocked on the source row the revoke holds
      await hook.release();
      released = true;
      const [revoked, created] = await Promise.all([revokeP, createP]);
      expect(revoked.status).toBe(200);
      expect(created.status).toBe(403);
    } finally {
      if (!released) await hook.release();
    }

    // No active assignment of the lead survives, and the refused create left nothing behind.
    const rows = await assignmentsOf(lead.id);
    expect(rows.filter((r) => r.revoked_at === null)).toEqual([]);
    expect(rows.filter((r) => r.derived_from_assignment_id !== null)).toEqual([]);
    const persisted = await api.db.selectFrom("transformation").select("id").where("name", "=", name).execute();
    expect(persisted).toEqual([]);
    // The refused create is audited as a failed authorization of a mutation, by the lead, on the business unit.
    const denied = await api.db
      .selectFrom("audit_event")
      .select(["action", "record_type", "record_id", "reason"])
      .where("actor_user_id", "=", lead.id)
      .where("action", "=", "authorization.denied")
      .execute();
    expect(denied).toEqual([
      {
        action: "authorization.denied",
        record_type: "business_unit",
        record_id: w.a1,
        reason: expect.stringMatching(/POST .* requires transformation\.create/),
      },
    ]);
  });

  it("B. create first: the revoke waits for the create and its cascade revokes the new derived assignment", async () => {
    const lead = await createUser(api.db, w.orgA.id);
    const source = await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const session = await signIn(api.app, lead.subject);
    await api.owner.query("INSERT INTO f115_hook (derive_from) VALUES ($1)", [source]);

    const hook = await holdHook();
    let released = false;
    let createdId: string;
    try {
      const createP = create(session, `F115-B ${source}`);
      await waitForWaiters("advisory"); // the create has inserted the derived row and is parked, uncommitted
      const revokeP = revoke(source, "Synthetic: lead left the unit (race B)");
      await waitForWaiters("row"); // the revoke is blocked on the source row the create holds
      await hook.release();
      released = true;
      const [created, revoked] = await Promise.all([createP, revokeP]);
      expect(created.status).toBe(201);
      expect(revoked.status).toBe(200);
      createdId = created.body.id;
    } finally {
      if (!released) await hook.release();
    }

    const derived = (await assignmentsOf(lead.id)).filter((r) => r.derived_from_assignment_id === source);
    expect(derived).toHaveLength(1);
    expect(derived[0]!.source_revoked_at).not.toBeNull();
    expect(derived[0]!.revoked_at).not.toBeNull(); // revoked with its source by the cascade
    const fresh = await signIn(api.app, lead.subject);
    expect((await call(api.app, "GET", `/api/v1/transformations/${createdId}`, { session: fresh })).status).toBe(404);
  });

  // C and D need a second non-inheriting role that may create in a BU. In the seed only TL can (TO inherits
  // downward), so - like the F-DG1-106 approval-role test - a seeded non-inheriting role temporarily receives
  // transformation.create (roles are configurable data), and the seed is restored afterwards (other suites compare
  // with it): WL (no approval permission) for C, SP (holds gate.decide, a G1-G6 approval permission) for D.
  async function withCreatePermission<T>(roleCode: "WL" | "SP", body: () => Promise<T>): Promise<T> {
    const roleId = (await api.owner.query("SELECT id FROM role WHERE code = $1", [roleCode])).rows[0].id as string;
    await api.owner.query(
      "INSERT INTO role_permission (role_id, permission_code) VALUES ($1, 'transformation.create')",
      [roleId],
    );
    try {
      return await body();
    } finally {
      await api.owner.query(
        "DELETE FROM role_permission WHERE role_id = $1 AND permission_code = 'transformation.create'",
        [roleId],
      );
    }
  }

  /** Revokes `revokedSrc` while `session` creates in a1, the revoke parked first (interleaving A). */
  async function raceRevokeFirst(session: Session, revokedSrc: string, name: string) {
    await api.owner.query("INSERT INTO f115_hook (revoke_id) VALUES ($1)", [revokedSrc]);
    const hook = await holdHook();
    let released = false;
    try {
      const revokeP = revoke(revokedSrc, `Synthetic: grant withdrawn (${name})`);
      await waitForWaiters("advisory");
      const createP = create(session, name);
      await waitForWaiters("row");
      await hook.release();
      released = true;
      const [revoked, created] = await Promise.all([revokeP, createP]);
      return { revoked, created };
    } finally {
      if (!released) await hook.release();
    }
  }

  it("C. one of two source grants revoked concurrently: the create succeeds and derives only from the survivor", async () => {
    await withCreatePermission("WL", async () => {
      const lead = await createUser(api.db, w.orgA.id);
      const revokedSrc = await grant(
        api.db,
        w.grantor.id,
        lead.id,
        "TL",
        { type: "business_unit", id: w.a1 },
        w.orgA.id,
      );
      const keptSrc = await grant(api.db, w.grantor.id, lead.id, "WL", { type: "business_unit", id: w.a1 }, w.orgA.id);
      const session = await signIn(api.app, lead.subject);
      const { revoked, created } = await raceRevokeFirst(session, revokedSrc, `F115-C ${revokedSrc}`);
      expect(revoked.status).toBe(200);
      expect(created.status).toBe(201);

      const derived = (await assignmentsOf(lead.id)).filter((r) => r.derived_from_assignment_id !== null);
      expect(derived.map((r) => [r.derived_from_assignment_id, r.revoked_at, r.scope_id])).toEqual([
        [keptSrc, null, created.body.id],
      ]);
      const fresh = await signIn(api.app, lead.subject);
      expect(
        (await call(api.app, "GET", `/api/v1/transformations/${created.body.id}`, { session: fresh })).status,
      ).toBe(200);
    });
  });

  it("D. the only source revoked concurrently, another (approval-holding, non-source) grant still authorizes create", async () => {
    // The other grant holds a G1-G6 approval permission, so it is never carried over (F-DG1-106) - but it still
    // authorizes the create, so the create is not refused; it simply derives nothing from the revoked source.
    await withCreatePermission("SP", async () => {
      const lead = await createUser(api.db, w.orgA.id);
      const revokedSrc = await grant(
        api.db,
        w.grantor.id,
        lead.id,
        "TL",
        { type: "business_unit", id: w.a1 },
        w.orgA.id,
      );
      await grant(api.db, w.grantor.id, lead.id, "SP", { type: "business_unit", id: w.a1 }, w.orgA.id);
      const session = await signIn(api.app, lead.subject);
      const { revoked, created } = await raceRevokeFirst(session, revokedSrc, `F115-D ${revokedSrc}`);
      expect(revoked.status).toBe(200);
      expect(created.status).toBe(201);
      const rows = await assignmentsOf(lead.id);
      expect(rows.filter((r) => r.derived_from_assignment_id !== null)).toEqual([]);
    });
  });
});
