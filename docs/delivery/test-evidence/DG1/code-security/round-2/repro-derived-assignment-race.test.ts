// code-security-reviewer DG1 round 2 — F-DG1-106 follow-up: a derived creator assignment can OUTLIVE its revoked source
// when the create and the revocation of the source BU grant overlap. NOT part of the candidate. Run by copying into a
// DISPOSABLE clone at apps/api/test/integration/ and executing
//   TEST_DATABASE_ADMIN_URL=... npx vitest run --project integration apps/api/test/integration/repro-derived-assignment-race.test.ts
//
// Both requests go through the REAL API. To make the interleaving deterministic, a timing-only trigger is added to the
// THROWAWAY test database: it sleeps 1.5 s right after the revoke's UPDATE of the source row (before the revoke's
// cascade UPDATE and commit) — standing in for any scheduling delay (GC pause, slow audit insert, network). It changes
// no data. Interleaving:
//   T2 revoke: SELECT source FOR UPDATE; UPDATE source SET revoked_at   (trigger sleeps here, lock held, uncommitted)
//   T1 create: loadGrants + grantCreatorTransformationRoles SELECT (unlocked) still see the source ACTIVE;
//              INSERT derived row -> FK check (FOR KEY SHARE) waits for T2
//   T2: cascade "UPDATE ... WHERE derived_from_assignment_id = src" cannot see T1's uncommitted row; COMMIT
//   T1: FK check passes (row still exists); COMMIT  -> an ACTIVE derived TL assignment whose source is REVOKED.
import { afterAll, beforeAll, expect, it } from "vitest";
import { call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
});
afterAll(async () => {
  await api.owner.query("DROP TRIGGER IF EXISTS repro_slow_revoke ON scoped_assignment");
  await api.owner.query("DROP FUNCTION IF EXISTS repro_slow_revoke()");
  await api.close();
});

it("an overlapping create keeps an ACTIVE derived assignment after its source BU grant is revoked", async () => {
  const lead = await createUser(api.db, w.orgA.id);
  const source = await grant(api.db, w.grantor.id, lead.id, "TL", { type: "business_unit", id: w.a1 }, w.orgA.id);
  const session = await signIn(api.app, lead.subject);

  await api.owner.query(`
    CREATE FUNCTION repro_slow_revoke() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id = '${source}'::uuid AND OLD.revoked_at IS NULL AND NEW.revoked_at IS NOT NULL THEN
        PERFORM pg_sleep(1.5);
      END IF;
      RETURN NEW;
    END $$`);
  await api.owner.query(
    "CREATE TRIGGER repro_slow_revoke AFTER UPDATE ON scoped_assignment FOR EACH ROW EXECUTE FUNCTION repro_slow_revoke()",
  );

  const revokeP = call(api.app, "POST", `/api/v1/role-assignments/${source}/revoke`, {
    session: admin,
    headers: { "if-match": '"1"' },
    body: { reason: "Synthetic: lead left the unit (race repro)" },
  });
  await new Promise((r) => setTimeout(r, 400)); // the revoke now holds the source row, uncommitted
  const createP = call<{ id: string }>(api.app, "POST", "/api/v1/transformations", {
    session,
    body: { businessUnitId: w.a1, name: "Created while the lead's grant is being revoked", mode: "end_to_end" },
  });
  const [revoke, created] = await Promise.all([revokeP, createP]);
  console.log("[race] revoke:", revoke.status, " create:", created.status);
  expect(revoke.status).toBe(200);
  expect(created.status).toBe(201);

  const rows = await api.db
    .selectFrom("scoped_assignment as a")
    .leftJoin("scoped_assignment as src", "src.id", "a.derived_from_assignment_id")
    .select(["a.id", "a.scope_type", "a.revoked_at", "a.derived_from_assignment_id", "src.revoked_at as source_revoked_at"])
    .where("a.user_id", "=", lead.id)
    .execute();
  console.log("[race] lead's assignments after both committed:", JSON.stringify(rows));
  const derived = rows.find((r) => r.derived_from_assignment_id === source)!;
  expect(derived.source_revoked_at).not.toBeNull(); // the source BU grant IS revoked

  // The revoke also ended the lead's sessions (admin/routes.ts revokeUserSessions) -> the old cookie is 401.
  const stale = await call(api.app, "GET", `/api/v1/transformations/${created.body.id}`, { session });
  console.log("[race] old session after the revocation:", stale.status);
  // ...but the lead simply signs in again: the surviving derived grant still authorizes the record.
  const fresh = await signIn(api.app, lead.subject);
  const after = await call(api.app, "GET", `/api/v1/transformations/${created.body.id}`, { session: fresh });
  console.log("[race] lead (signed in again) reads the new transformation after the revocation:", after.status);

  // SECURE expectation (F-DG1-106: "revoked with its source"): the derived assignment is revoked and the read is 404.
  // The assertions below document the OBSERVED behaviour; flip them to see the secure expectation fail.
  expect(derived.revoked_at).toBeNull(); // DEFECT: still active
  expect(after.status).toBe(200); // DEFECT: access survives the revocation of its only source
});
