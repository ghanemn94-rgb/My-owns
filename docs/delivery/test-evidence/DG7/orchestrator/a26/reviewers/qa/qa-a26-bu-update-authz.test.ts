// qa-verifier drill a26 (T-DG7-REV-A26-QA): independent test of PATCH /api/v1/business-units/:id authorization.
// Derived from the 0005 seed (business_unit.manage is held only by ADM_TECH) and ADR-0006 / openapi "Authorization":
// a caller who may read but not change a record gets 403, the denial is audited (authorization.denied), and nothing
// changes (version, fields, business_unit.update audit). Synthetic data only.
// Run inside tests/qa/integration/ of a disposable clone (imports are relative to that location).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { auditOf, call, createUser, grant, seedWorld, signIn, startApi, type Session, type TestApi, type World } from "../../../apps/api/test/support/harness.ts";

let api: TestApi;
let w: World;
const s: Record<string, Session> = {};

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  for (const k of ["admin", "office", "auditor", "leadA1", "officeB", "nobody"] as const) s[k] = await signIn(api.app, w[k].subject);
});
afterAll(() => api.close());

async function bu(id: string) {
  return api.db.selectFrom("business_unit").selectAll().where("id", "=", id).executeTakeFirstOrThrow();
}

describe("drill a26: business-unit PATCH requires business_unit.manage", () => {
  for (const who of ["office", "auditor", "leadA1"] as const) {
    it(`${who} (business_unit.read only) cannot rename/deactivate a1: 403, audited denial, no change`, async () => {
      const before = await bu(w.a1);
      const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1}`, {
        session: s[who]!,
        headers: { "if-match": `"${before.version}"` },
        body: { nameEn: `pwned-by-${who}`, status: "inactive" },
      });
      const after = await bu(w.a1);
      const audits = await auditOf(api.db, w.a1);
      console.log(`[qa-a26] ${who}: status=${res.status} version ${before.version}->${after.version} name_en=${after.name_en} status=${after.status} updates=${audits.filter((a) => a.action === "business_unit.update").length}`);
      expect(res.status).toBe(403);
      expect([after.version, after.name_en, after.status]).toEqual([before.version, before.name_en, before.status]);
      expect(audits.some((a) => a.action === "authorization.denied" && a.actor_user_id === w[who].id)).toBe(true);
    });
  }

  it("auditor (read-only) cannot re-parent a1x to the top level when only read applies to the moved unit", async () => {
    const before = await bu(w.a1x);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
      session: s.auditor!,
      headers: { "if-match": `"${before.version}"` },
      body: { parentBusinessUnitId: null },
    });
    console.log(`[qa-a26] auditor re-parent: status=${res.status}`);
    expect(res.status).toBe(403);
    expect((await bu(w.a1x)).parent_business_unit_id).toBe(w.a1);
  });

  it("re-parent: manage on the destination (a2) but only read on the moved unit (a1x) must be refused", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "business_unit", id: w.a2 }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "AUD", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const su = await signIn(api.app, u.subject);
    const before = await bu(w.a1x);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
      session: su,
      headers: { "if-match": `"${before.version}"` },
      body: { parentBusinessUnitId: w.a2 },
    });
    const after = await bu(w.a1x);
    console.log(`[qa-a26] split-grant re-parent: status=${res.status} parent ${before.parent_business_unit_id === w.a1 ? "a1" : "?"}->${after.parent_business_unit_id === w.a2 ? "a2" : after.parent_business_unit_id === w.a1 ? "a1" : "?"}`);
    expect(res.status).toBe(403);
    expect(after.parent_business_unit_id).toBe(w.a1);
  });

  it("negative scope control: other-organization and no-grant users still get 404", async () => {
    for (const who of ["officeB", "nobody"] as const) {
      const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a2}`, {
        session: s[who]!,
        headers: { "if-match": '"1"' },
        body: { nameEn: "x" },
      });
      expect(res.status).toBe(404);
    }
  });

  it("positive control: ADM_TECH (business_unit.manage) renames a2 with If-Match; one audit event; stale If-Match 409", async () => {
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a2}`, {
      session: s.admin!,
      headers: { "if-match": '"1"' },
      body: { nameEn: "QA renamed" },
    });
    expect([res.status, res.body.version]).toEqual([200, 2]);
    expect((await auditOf(api.db, w.a2)).filter((a) => a.action === "business_unit.update")).toHaveLength(1);
    const stale = await call(api.app, "PATCH", `/api/v1/business-units/${w.a2}`, {
      session: s.admin!,
      headers: { "if-match": '"1"' },
      body: { nameEn: "late" },
    });
    expect(stale.status).toBe(409);
  });
});
