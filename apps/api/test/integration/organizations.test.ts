// Organizations and business units (REQ-S16-011 increment, REQ-S15-008 defaults). Each mutation: authorization
// (positive/negative), validation, If-Match concurrency, one audit event. BU hierarchy: same organization, no cycles,
// bounded depth.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  auditOfRequest,
  call,
  createUser,
  grant,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../support/harness.ts";

let api: TestApi;
let w: World;
let admin: Session;
let office: Session;
let officeB: Session;
let nobody: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  office = await signIn(api.app, w.office.subject);
  officeB = await signIn(api.app, w.officeB.subject);
  nobody = await signIn(api.app, w.nobody.subject);
});
afterAll(() => api.close());

describe("organizations", () => {
  it("lists only organizations in which the caller holds organization.read", async () => {
    const ids = async (s: Session) =>
      (
        await call<{ items: { id: string }[] }>(api.app, "GET", "/api/v1/organizations?limit=100", { session: s })
      ).body.items.map((o) => o.id);
    expect(await ids(office)).toEqual([w.orgA.id]);
    expect(await ids(officeB)).toEqual([w.orgB.id]);
    expect(await ids(nobody)).toEqual([]);
  });

  it("reads one organization with ETag; others are 404", async () => {
    const res = await call(api.app, "GET", `/api/v1/organizations/${w.orgA.id}`, { session: office });
    expect([res.status, res.headers["etag"], res.body.defaultTimezone, res.body.defaultCurrency]).toEqual([
      200,
      '"1"',
      "Asia/Riyadh",
      "SAR",
    ]);
    expect((await call(api.app, "GET", `/api/v1/organizations/${w.orgA.id}`, { session: officeB })).status).toBe(404);
  });

  it("updates with If-Match (technical admin), 403 for a business role, 404 across organizations; audited", async () => {
    const url = `/api/v1/organizations/${w.orgA.id}`;
    expect(
      (await call(api.app, "PATCH", url, { session: office, headers: { "if-match": '"1"' }, body: { nameEn: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (await call(api.app, "PATCH", url, { session: officeB, headers: { "if-match": '"1"' }, body: { nameEn: "x" } }))
        .status,
    ).toBe(404);
    expect((await call(api.app, "PATCH", url, { session: admin, body: { nameEn: "x" } })).status).toBe(428);
    const ok = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "Synthetic Org A", defaultTimezone: "Asia/Dubai" },
    });
    expect([ok.status, ok.body.version, ok.body.defaultTimezone]).toEqual([200, 2, "Asia/Dubai"]);
    const stale = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "late" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    const audit = (await auditOf(api.db, w.orgA.id)).filter((a) => a.action === "organization.update");
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ prior_version: 1, new_version: 2, actor_user_id: w.admin.id });
    expect(audit[0]!.changes).toMatchObject({ default_timezone: { from: "Asia/Riyadh", to: "Asia/Dubai" } });
  });

  it("creates an organization (organization.manage) and carries over only the creator's technical-admin roles", async () => {
    const code = uniq("NEW");
    expect(
      (
        await call(api.app, "POST", "/api/v1/organizations", {
          session: office,
          body: { code, nameEn: "n", nameAr: "ن" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await call(api.app, "POST", "/api/v1/organizations", {
          session: admin,
          body: { code: "lower", nameEn: "n", nameAr: "ن" },
        })
      ).status,
    ).toBe(400);
    const res = await call(api.app, "POST", "/api/v1/organizations", {
      session: admin,
      body: { code, nameEn: "Synthetic New Org", nameAr: "مؤسسة جديدة" },
    });
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe(`/api/v1/organizations/${res.body.id}`);
    expect(res.body).toMatchObject({
      code,
      defaultTimezone: "Asia/Riyadh",
      defaultCurrency: "SAR",
      defaultLocale: "ar",
      status: "active",
      version: 1,
    });
    const carried = await api.db
      .selectFrom("scoped_assignment as a")
      .innerJoin("role as r", "r.id", "a.role_id")
      .select(["r.code", "r.kind"])
      .where("a.organization_id", "=", res.body.id)
      .execute();
    expect(carried.map((c) => c.code).sort()).toEqual(["ADM_ACCESS", "ADM_TECH"]);
    expect(carried.every((c) => c.kind === "technical_admin")).toBe(true);
    expect((await auditOf(api.db, res.body.id)).map((a) => a.action)).toEqual(["organization.create"]);
    expect(
      (
        await call(api.app, "POST", "/api/v1/organizations", {
          session: admin,
          body: { code, nameEn: "dup", nameAr: "dup" },
        })
      ).status,
    ).toBe(409);
  });
});

describe("business units", () => {
  it("creates under an organization (business_unit.manage on the organization), with duplicate and cross-org checks", async () => {
    const url = `/api/v1/organizations/${w.orgA.id}/business-units`;
    expect(
      (await call(api.app, "POST", url, { session: office, body: { code: uniq("BU"), nameEn: "x", nameAr: "x" } }))
        .status,
    ).toBe(403);
    expect(
      (await call(api.app, "POST", url, { session: officeB, body: { code: uniq("BU"), nameEn: "x", nameAr: "x" } }))
        .status,
    ).toBe(404);
    const code = uniq("BU");
    const res = await call(api.app, "POST", url, {
      session: admin,
      body: { code, nameEn: "Synthetic Unit", nameAr: "وحدة", parentBusinessUnitId: w.a1 },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ organizationId: w.orgA.id, parentBusinessUnitId: w.a1, version: 1 });
    expect((await auditOf(api.db, res.body.id)).map((a) => a.action)).toEqual(["business_unit.create"]);
    expect(
      (await call(api.app, "POST", url, { session: admin, body: { code, nameEn: "dup", nameAr: "dup" } })).status,
    ).toBe(409);
    const crossOrg = await call(api.app, "POST", url, {
      session: admin,
      body: { code: uniq("BU"), nameEn: "x", nameAr: "x", parentBusinessUnitId: w.b1 },
    });
    // The contract declares no 422 for createBusinessUnit: the rule is a 400 field error on parentBusinessUnitId.
    expect([crossOrg.status, crossOrg.body.errors[0].pointer, crossOrg.body.errors[0].code]).toEqual([
      400,
      "/parentBusinessUnitId",
      "business_unit.parent_invalid",
    ]);
  });

  it("lists the organization's units for readers and 404s other organizations", async () => {
    const list = await call<{ items: { id: string }[] }>(
      api.app,
      "GET",
      `/api/v1/organizations/${w.orgA.id}/business-units?limit=100`,
      { session: office },
    );
    expect(list.body.items.map((b) => b.id)).toEqual(expect.arrayContaining([w.a1, w.a1x, w.a2]));
    expect(
      (await call(api.app, "GET", `/api/v1/organizations/${w.orgA.id}/business-units`, { session: officeB })).status,
    ).toBe(404);
    const inactive = await call<{ items: unknown[] }>(
      api.app,
      "GET",
      `/api/v1/organizations/${w.orgA.id}/business-units?status=inactive`,
      { session: office },
    );
    expect(inactive.status).toBe(200);
  });

  it("rejects moving a unit under itself or its descendant (422 cycle) and keeps the hierarchy", async () => {
    const url = `/api/v1/business-units/${w.a1}`;
    const cur = await call(api.app, "GET", url, { session: admin });
    const cycle = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": cur.headers["etag"] as string },
      body: { parentBusinessUnitId: w.a1x },
    });
    expect([cycle.status, cycle.body.code]).toEqual([422, "business_unit.cycle"]);
    const self = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": cur.headers["etag"] as string },
      body: { parentBusinessUnitId: w.a1 },
    });
    expect(self.status).toBe(422);
  });

  it("re-parents and renames with If-Match; audited with a diff", async () => {
    const url = `/api/v1/business-units/${w.a2}`;
    const res = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { parentBusinessUnitId: w.a1, nameAr: "وحدة معاد تسميتها" },
    });
    expect([res.status, res.body.version, res.body.parentBusinessUnitId]).toEqual([200, 2, w.a1]);
    const audit = (await auditOf(api.db, w.a2)).filter((a) => a.action === "business_unit.update");
    expect(audit[0]!.changes).toMatchObject({ parent_business_unit_id: { from: null, to: w.a1 } });
    expect(
      (await call(api.app, "PATCH", url, { session: admin, headers: { "if-match": '"1"' }, body: { nameEn: "late" } }))
        .status,
    ).toBe(409);
    // Moving it back to the top level.
    expect(
      (
        await call(api.app, "PATCH", url, {
          session: admin,
          headers: { "if-match": '"2"' },
          body: { parentBusinessUnitId: null },
        })
      ).status,
    ).toBe(200);
  });

  it("limits nesting depth (400 on create, per the contract)", async () => {
    let parent: string | null = null;
    const url = `/api/v1/organizations/${w.orgA.id}/business-units`;
    for (let depth = 0; depth < 10; depth++) {
      const r: { status: number; body: { id: string } } = await call(api.app, "POST", url, {
        session: admin,
        body: {
          code: uniq("D"),
          nameEn: `Depth ${depth}`,
          nameAr: "عمق",
          ...(parent ? { parentBusinessUnitId: parent } : {}),
        },
      });
      expect(r.status).toBe(201);
      parent = r.body.id;
    }
    const tooDeep = await call(api.app, "POST", url, {
      session: admin,
      body: { code: uniq("D"), nameEn: "Too deep", nameAr: "عميق", parentBusinessUnitId: parent },
    });
    expect([tooDeep.status, tooDeep.body.errors[0].code]).toEqual([400, "business_unit.depth_exceeded"]);
  });

  it("reads one unit (business_unit.read) and 404s outside scope", async () => {
    expect((await call(api.app, "GET", `/api/v1/business-units/${w.a1}`, { session: office })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/business-units/${w.a1}`, { session: officeB })).status).toBe(404);
    expect((await call(api.app, "GET", `/api/v1/business-units/${w.b1}`, { session: nobody })).status).toBe(404);
  });
});

// Drill A26 regression (F-DG7-CS-A26-1/-2, QA-A26-01/-02/-03): PATCH /api/v1/business-units/:id requires
// business_unit.manage on the moved/renamed unit. business_unit.read (held by almost every role) is not enough
// (ADR-0006: a caller who may read but not change a record gets 403). Synthetic data only.
describe("business unit update authorization (business_unit.manage, not business_unit.read)", () => {
  const unit = (id: string) =>
    api.db.selectFrom("business_unit").selectAll().where("id", "=", id).executeTakeFirstOrThrow();

  for (const who of ["office", "auditor", "leadA1"] as const) {
    it(`${who} (business_unit.read without business_unit.manage) gets 403; unit unchanged; no update audited`, async () => {
      const s = await signIn(api.app, w[who].subject);
      const before = await unit(w.a1);
      const requestId = uniq("a26-");
      const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1}`, {
        session: s,
        headers: { "if-match": `"${before.version}"`, "x-request-id": requestId },
        body: { nameEn: `renamed-by-${who}`, nameAr: "تغيير", status: "inactive" },
      });
      expect(res.status).toBe(403);
      const after = await unit(w.a1);
      expect([after.version, after.name_en, after.name_ar, after.status]).toEqual([
        before.version,
        before.name_en,
        before.name_ar,
        before.status,
      ]);
      const updates = (await auditOf(api.db, w.a1)).filter(
        (a) => a.action === "business_unit.update" && a.actor_user_id === w[who].id,
      );
      expect(updates).toHaveLength(0);
      // Everything this request audited is the denial; no change event.
      expect((await auditOfRequest(api.db, requestId)).map((a) => a.action)).toEqual(["authorization.denied"]);
      // The refusal itself is audited as an authorization denial (denials.ts), never as a change.
      expect(
        (await auditOf(api.db, w.a1)).some((a) => a.action === "authorization.denied" && a.actor_user_id === w[who].id),
      ).toBe(true);
    });
  }

  it("split grant: manage on the destination (a2) but only read on the moved unit (a1x) cannot re-parent it (403)", async () => {
    const u = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "ADM_TECH", { type: "business_unit", id: w.a2 }, w.orgA.id);
    await grant(api.db, w.grantor.id, u.id, "AUD", { type: "business_unit", id: w.a1 }, w.orgA.id);
    const s = await signIn(api.app, u.subject);
    const before = await unit(w.a1x);
    expect(before.parent_business_unit_id).toBe(w.a1);
    const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
      session: s,
      headers: { "if-match": `"${before.version}"` },
      body: { parentBusinessUnitId: w.a2 },
    });
    expect(res.status).toBe(403);
    const after = await unit(w.a1x);
    expect([after.version, after.parent_business_unit_id]).toEqual([before.version, w.a1]);
    expect(
      (await auditOf(api.db, w.a1x)).filter((a) => a.action === "business_unit.update" && a.actor_user_id === u.id),
    ).toHaveLength(0);
  });

  it("other-organization and no-grant callers get 404 (ADR-0006); a manager still gets 200 (positive control)", async () => {
    for (const s of [officeB, nobody]) {
      const before = await unit(w.a1x);
      const res = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
        session: s,
        headers: { "if-match": `"${before.version}"` },
        body: { nameEn: "x" },
      });
      expect(res.status).toBe(404);
      expect((await unit(w.a1x)).version).toBe(before.version);
    }
    const before = await unit(w.a1x);
    const ok = await call(api.app, "PATCH", `/api/v1/business-units/${w.a1x}`, {
      session: admin,
      headers: { "if-match": `"${before.version}"` },
      body: { nameEn: "Synthetic Unit A1X renamed" },
    });
    expect([ok.status, ok.body.version]).toEqual([200, before.version + 1]);
    expect(
      (await auditOf(api.db, w.a1x)).filter(
        (a) => a.action === "business_unit.update" && a.actor_user_id === w.admin.id,
      ),
    ).toHaveLength(1);
  });
});
