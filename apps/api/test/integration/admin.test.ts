// Administration: users (identity), role catalogue and scoped role assignments (access). REQ-S10-001/003,
// REQ-S06-010, REQ-S16-011 increments. Each mutation: authorization, validation, concurrency, one audit event.
import { PERMISSIONS, ROLES } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  auditOf,
  call,
  createTransformationRow,
  createUser,
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
let office: Session;
let auditor: Session;
let nobody: Session;
let officeB: Session;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  admin = await signIn(api.app, w.admin.subject);
  office = await signIn(api.app, w.office.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
});
afterAll(() => api.close());

describe("users", () => {
  it("lists users of an organization for user.read holders only (403 otherwise), with search", async () => {
    const ok = await call<{ items: { id: string }[] }>(
      api.app,
      "GET",
      `/api/v1/users?organizationId=${w.orgA.id}&limit=100`,
      { session: admin },
    );
    expect(ok.body.items.map((u) => u.id)).toEqual(expect.arrayContaining([w.office.id, w.nobody.id]));
    expect(ok.body.items.map((u) => u.id)).not.toContain(w.officeB.id);
    expect((await call(api.app, "GET", `/api/v1/users?organizationId=${w.orgA.id}`, { session: auditor })).status).toBe(
      200,
    );
    expect((await call(api.app, "GET", `/api/v1/users?organizationId=${w.orgA.id}`, { session: office })).status).toBe(
      403,
    );
    expect((await call(api.app, "GET", `/api/v1/users?organizationId=${w.orgB.id}`, { session: admin })).status).toBe(
      403,
    );
    expect((await call(api.app, "GET", "/api/v1/users", { session: admin })).status).toBe(400);
    const subject = w.office.subject;
    const found = await call<{ items: { id: string }[] }>(
      api.app,
      "GET",
      `/api/v1/users?organizationId=${w.orgA.id}&q=${subject}`,
      { session: admin },
    );
    expect(found.body.items.map((u) => u.id)).toEqual([w.office.id]);
  });

  it("pre-provisions a user with an identity binding (user.manage), 409 on duplicate e-mail or identity, audited", async () => {
    const body = {
      organizationId: w.orgA.id,
      displayName: "Synthetic Newcomer",
      email: "newcomer@example.invalid",
      identity: { issuer: "https://idp.example.invalid", subject: "newcomer-1" },
    };
    expect((await call(api.app, "POST", "/api/v1/users", { session: office, body })).status).toBe(403);
    const res = await call(api.app, "POST", "/api/v1/users", { session: admin, body });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      displayName: "Synthetic Newcomer",
      status: "active",
      version: 1,
      identities: [{ issuer: "https://idp.example.invalid", subject: "newcomer-1", lastLoginAt: null }],
    });
    expect((await auditOf(api.db, res.body.id)).map((a) => a.action)).toEqual(["app_user.create"]);
    const dupEmail = await call(api.app, "POST", "/api/v1/users", {
      session: admin,
      body: { ...body, email: "NEWCOMER@example.invalid", identity: undefined },
    });
    expect([dupEmail.status, dupEmail.body.code]).toEqual([409, "duplicate.email"]);
    const dupIdentity = await call(api.app, "POST", "/api/v1/users", {
      session: admin,
      body: { ...body, email: "other@example.invalid" },
    });
    expect([dupIdentity.status, dupIdentity.body.code]).toEqual([409, "duplicate.identity"]);
    expect(
      (await call(api.app, "POST", "/api/v1/users", { session: admin, body: { ...body, email: "not-an-email" } }))
        .status,
    ).toBe(400);
    const emptyIssuer = await call(api.app, "POST", "/api/v1/users", {
      session: admin,
      body: { ...body, email: "e@example.invalid", identity: { issuer: "", subject: "s-empty" } },
    });
    expect([emptyIssuer.status, emptyIssuer.body.errors[0].pointer]).toEqual([400, "/identity/issuer"]);
  });

  it("reads a user (self always; others need user.read on the home organization, else 404)", async () => {
    expect((await call(api.app, "GET", `/api/v1/users/${w.nobody.id}`, { session: nobody })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/users/${w.office.id}`, { session: nobody })).status).toBe(404);
    expect((await call(api.app, "GET", `/api/v1/users/${w.office.id}`, { session: admin })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/users/${w.office.id}`, { session: officeB })).status).toBe(404);
  });

  it("disables a user with If-Match, revoking all their sessions in the same transaction; audited", async () => {
    const target = await createUser(api.db, w.orgA.id);
    const victim = await signIn(api.app, target.subject);
    const url = `/api/v1/users/${target.id}`;
    expect(
      (
        await call(api.app, "PATCH", url, {
          session: auditor,
          headers: { "if-match": '"1"' },
          body: { status: "disabled" },
        })
      ).status,
    ).toBe(403);
    expect((await call(api.app, "PATCH", url, { session: admin, body: { status: "disabled" } })).status).toBe(428);
    const res = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { status: "disabled" },
    });
    expect([res.status, res.body.status, res.body.version]).toEqual([200, "disabled", 2]);
    expect((await call(api.app, "GET", "/api/v1/me", { session: victim })).status).toBe(401);
    const live = await api.db
      .selectFrom("session")
      .select("id")
      .where("user_id", "=", target.id)
      .where("revoked_at", "is", null)
      .execute();
    expect(live).toEqual([]);
    const audit = (await auditOf(api.db, target.id)).at(-1)!;
    expect(audit).toMatchObject({ action: "app_user.disable", prior_version: 1, new_version: 2 });
    expect(audit.changes).toMatchObject({
      status: { from: "active", to: "disabled" },
      sessionsRevoked: { from: null, to: 1 },
    });
    const stale = await call(api.app, "PATCH", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { displayName: "late" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
  });

  it("refuses to let an administrator disable themself (403 user.cannot_disable_self)", async () => {
    const me = await call(api.app, "GET", `/api/v1/users/${w.admin.id}`, { session: admin });
    const res = await call(api.app, "PATCH", `/api/v1/users/${w.admin.id}`, {
      session: admin,
      headers: { "if-match": me.headers["etag"] as string },
      body: { status: "disabled" },
    });
    expect([res.status, res.body.code]).toEqual([403, "user.cannot_disable_self"]);
  });
});

describe("role and permission catalogue", () => {
  it("lists roles with permissions equal to the seeded catalogue (role.read), 403 without it", async () => {
    const res = await call<{ items: { code: string; permissions: string[]; kind: string }[] }>(
      api.app,
      "GET",
      "/api/v1/roles",
      { session: office },
    );
    expect(res.status).toBe(200);
    expect(Object.fromEntries(res.body.items.map((r) => [r.code, r.permissions]))).toEqual(
      Object.fromEntries(Object.entries(ROLES).map(([c, d]) => [c, [...d.permissions].sort()])),
    );
    const perms = await call<{ items: { code: string; category: string }[] }>(api.app, "GET", "/api/v1/permissions", {
      session: admin,
    });
    expect(Object.fromEntries(perms.body.items.map((p) => [p.code, p.category]))).toEqual(PERMISSIONS);
    expect((await call(api.app, "GET", "/api/v1/roles", { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", "/api/v1/permissions", { session: nobody })).status).toBe(403);
  });
});

describe("scoped role assignments", () => {
  let trA2: string;
  beforeAll(async () => {
    trA2 = await createTransformationRow(api.db, w.orgA.id, w.a2, w.grantor.id);
  });

  it("grants a role at a transformation scope (access.assign), with a mandatory reason; audited; access follows", async () => {
    const body = {
      userId: w.nobody.id,
      roleCode: "TL",
      scope: { type: "transformation", id: trA2 },
      reason: "Named lead for this transformation",
    };
    expect((await call(api.app, "POST", "/api/v1/role-assignments", { session: office, body })).status).toBe(403);
    expect(
      (await call(api.app, "POST", "/api/v1/role-assignments", { session: admin, body: { ...body, reason: "no" } }))
        .status,
    ).toBe(400);
    expect((await call(api.app, "GET", `/api/v1/transformations/${trA2}`, { session: nobody })).status).toBe(404);
    const res = await call(api.app, "POST", "/api/v1/role-assignments", { session: admin, body });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({
      organizationId: w.orgA.id,
      userId: w.nobody.id,
      roleCode: "TL",
      scope: body.scope,
      grantedBy: w.admin.id,
      revokedAt: null,
      version: 1,
    });
    expect((await auditOf(api.db, res.body.id)).map((a) => [a.action, a.transformation_id, a.reason])).toEqual([
      ["scoped_assignment.create", trA2, body.reason],
    ]);
    expect((await call(api.app, "GET", `/api/v1/transformations/${trA2}`, { session: nobody })).status).toBe(200);
    const dup = await call(api.app, "POST", "/api/v1/role-assignments", { session: admin, body });
    expect([dup.status, dup.body.code]).toEqual([409, "access.duplicate_assignment"]);
  });

  it("refuses self-grants, reserved scope types, unknown scopes and cross-organization scopes", async () => {
    const self = await call(api.app, "POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: w.admin.id,
        roleCode: "SP",
        scope: { type: "organization", id: w.orgA.id },
        reason: "Self grant attempt",
      },
    });
    expect([self.status, self.body.code]).toEqual([422, "access.self_grant"]);
    const reserved = await call(api.app, "POST", "/api/v1/role-assignments", {
      session: admin,
      body: { userId: w.nobody.id, roleCode: "WL", scope: { type: "workstream", id: trA2 }, reason: "Reserved scope" },
    });
    expect([reserved.status, reserved.body.code]).toEqual([422, "access.scope_type_reserved"]);
    const unknown = await call(api.app, "POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: w.nobody.id,
        roleCode: "WL",
        scope: { type: "business_unit", id: "01920000-0000-7000-8000-0000000000ff" },
        reason: "Unknown scope",
      },
    });
    expect([unknown.status, unknown.body.code]).toEqual([422, "access.scope_not_found"]);
    const crossOrg = await call(api.app, "POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: w.nobody.id,
        roleCode: "WL",
        scope: { type: "business_unit", id: w.b1 },
        reason: "Other organization",
      },
    });
    expect(crossOrg.status).toBe(403);
    const denied = (await auditOf(api.db, w.b1)).filter((a) => a.action === "authorization.denied");
    expect(denied.map((d) => [d.actor_user_id, d.organization_id])).toEqual([[w.admin.id, w.orgB.id]]);
  });

  it("never makes a technical administrator an approver: admin roles carry no approval permission", async () => {
    const res = await call(api.app, "POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: w.nobody.id,
        roleCode: "ADM_METHOD",
        scope: { type: "organization", id: w.orgA.id },
        reason: "Methodology administration",
      },
    });
    expect(res.status).toBe(201);
    const me = await signIn(api.app, w.nobody.subject);
    const perms = (
      await call<{ effectivePermissions: { permissions: string[] }[] }>(api.app, "GET", "/api/v1/me", { session: me })
    ).body.effectivePermissions.flatMap((e) => e.permissions);
    expect(perms).not.toContain("gate.decide");
    expect(perms).not.toContain("finance.validate");
  });

  it("lists assignments (access.read) with filters; 403 for callers without access.read in that organization", async () => {
    const list = await call<{ items: { userId: string; roleCode: string }[] }>(
      api.app,
      "GET",
      `/api/v1/role-assignments?organizationId=${w.orgA.id}&userId=${w.nobody.id}&limit=100`,
      { session: admin },
    );
    expect(list.body.items.map((a) => a.roleCode).sort()).toEqual(["ADM_METHOD", "TL"]);
    expect(
      (await call(api.app, "GET", `/api/v1/role-assignments?organizationId=${w.orgA.id}`, { session: auditor })).status,
    ).toBe(200);
    expect(
      (await call(api.app, "GET", `/api/v1/role-assignments?organizationId=${w.orgA.id}`, { session: office })).status,
    ).toBe(403);
    expect(
      (await call(api.app, "GET", `/api/v1/role-assignments?organizationId=${w.orgB.id}`, { session: admin })).status,
    ).toBe(403);
  });

  it("revokes with If-Match and a reason (never deletes); the user loses access and their sessions end; audited", async () => {
    const [assignment] = (
      await call<{ items: { id: string; version: number; roleCode: string }[] }>(
        api.app,
        "GET",
        `/api/v1/role-assignments?organizationId=${w.orgA.id}&userId=${w.nobody.id}&scopeType=transformation`,
        { session: admin },
      )
    ).body.items;
    const url = `/api/v1/role-assignments/${assignment!.id}/revoke`;
    const holder = await signIn(api.app, w.nobody.subject);
    expect(
      (await call(api.app, "GET", `/api/v1/role-assignments/${assignment!.id}`, { session: admin })).headers["etag"],
    ).toBe('"1"');
    expect(
      (await call(api.app, "POST", url, { session: admin, body: { reason: "Role no longer needed" } })).status,
    ).toBe(428);
    expect(
      (
        await call(api.app, "POST", url, {
          session: office,
          headers: { "if-match": '"1"' },
          body: { reason: "Not allowed" },
        })
      ).status,
    ).toBe(404);
    const res = await call(api.app, "POST", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { reason: "Role no longer needed" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revokedBy: w.admin.id, revokeReason: "Role no longer needed", version: 2 });
    expect(res.body.revokedAt).not.toBeNull();
    expect(
      await api.db.selectFrom("scoped_assignment").select("id").where("id", "=", assignment!.id).execute(),
    ).toHaveLength(1);
    expect((await call(api.app, "GET", "/api/v1/me", { session: holder })).status).toBe(401);
    const sessionAudit = (await auditOf(api.db, w.nobody.id)).filter((a) => a.action === "session.revoke");
    expect(sessionAudit.at(-1)!.reason).toMatch(new RegExp(`because role assignment ${assignment!.id} was revoked`));
    const fresh = await signIn(api.app, w.nobody.subject);
    expect((await call(api.app, "GET", `/api/v1/transformations/${trA2}`, { session: fresh })).status).toBe(404);
    expect(
      (await auditOf(api.db, assignment!.id)).map((a) => [a.action, a.prior_version, a.new_version, a.reason]),
    ).toEqual([
      ["scoped_assignment.create", null, 1, "Named lead for this transformation"],
      ["scoped_assignment.revoke", 1, 2, "Role no longer needed"],
    ]);
    const again = await call(api.app, "POST", url, {
      session: admin,
      headers: { "if-match": '"2"' },
      body: { reason: "Twice" },
    });
    expect([again.status, again.body.code]).toEqual([422, "access.already_revoked"]);
    const stale = await call(api.app, "POST", url, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { reason: "Stale" },
    });
    expect([stale.status, stale.body.currentVersion]).toEqual([409, 2]);
    const withRevoked = await call<{ items: { id: string }[] }>(
      api.app,
      "GET",
      `/api/v1/role-assignments?organizationId=${w.orgA.id}&userId=${w.nobody.id}&includeRevoked=true`,
      { session: admin },
    );
    expect(withRevoked.body.items.map((a) => a.id)).toContain(assignment!.id);
  });
});
