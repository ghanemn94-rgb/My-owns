// Governed groups, governance parties and role mappings (ADR-0026 §1, §2, §10; REQ-S16-011, REQ-S10-008; T-DG4-BE-B)
// against a real PostgreSQL:
//  - REQ-S16-011 acceptance: "an integration test creates and reads each one [Organization, BusinessUnit, User, Group,
//    Role, Permission, ScopedAssignment, Delegation] through the API with authorization enforced" (Role and Permission
//    are read-only seeded catalogues: their "create" is the seed, ADR-0026 §10);
//  - groups: group.manage (TO) for writes, organization.read for reads; If-Match, validation and an audit event per
//    write; members of the same organization only, one current membership, removal kept as history; commit-time
//    authorization; a group grants no permission;
//  - role mappings: role_mapping.assign (TL, TO); one active mapping per party; party and target fixed (end and map
//    again); the resolve preview.
// All data is SYNTHETIC.
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
} from "../../support/harness.ts";
import { ifm } from "../../support/p2-fixtures.ts";
import { afterIdentity, revokeAll } from "../calendar/session-lock.ts";
import { setupApprovalWorld, type ApprovalWorld } from "../approvals/approval-world.ts";

let api: TestApi;
let w: World;
let office: Session; // TO @ org A (group.manage, role_mapping.assign; inherits)
let admin: Session; // ADM_ACCESS + ADM_TECH @ org A (no group.manage)
let auditor: Session;
let nobody: Session;
let officeB: Session;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Body = any;

beforeAll(async () => {
  api = await startApi();
  w = await seedWorld(api.db);
  office = await signIn(api.app, w.office.subject);
  admin = await signIn(api.app, w.admin.subject);
  auditor = await signIn(api.app, w.auditor.subject);
  nobody = await signIn(api.app, w.nobody.subject);
  officeB = await signIn(api.app, w.officeB.subject);
}, 60_000);
afterAll(() => api.close());

const G = () => `/api/v1/organizations/${w.orgA.id}/groups`;
const groupBody = (extra: Record<string, unknown> = {}) => ({
  code: uniq("STEERCO-"),
  nameEn: "Executive SteerCo",
  nameAr: "اللجنة التوجيهية التنفيذية",
  description: "Synthetic governed group",
  ownerUserId: w.office.id,
  ...extra,
});

describe("groups (ADR-0026 §1)", () => {
  it("create: group.manage only (AUD and ADM 403, outsiders 404); duplicate code 409; owner and text validated; audited", async () => {
    const aud = await call<Body>(api.app, "POST", G(), { session: auditor, body: groupBody() });
    expect(aud.status).toBe(403);
    expect((await auditOfRequest(api.db, String(aud.headers["x-request-id"]))).map((e) => e.action)).toEqual([
      "authorization.denied",
    ]);
    expect((await call(api.app, "POST", G(), { session: admin, body: groupBody() })).status).toBe(403);
    expect((await call(api.app, "POST", G(), { session: nobody, body: groupBody() })).status).toBe(404);
    expect((await call(api.app, "POST", G(), { session: officeB, body: groupBody() })).status).toBe(404);
    const body = groupBody();
    const res = await call<Body>(api.app, "POST", G(), { session: office, body });
    expect(res.status).toBe(201);
    expect(res.headers["location"]).toBe(`/api/v1/groups/${res.body.id}`);
    expect(res.headers["etag"]).toBe('"1"');
    expect(res.body).toMatchObject({
      code: body.code,
      status: "active",
      memberCount: 0,
      version: 1,
      ownerUserId: w.office.id,
    });
    expect((await auditOf(api.db, res.body.id)).map((e) => e.action)).toEqual(["access_group.create"]);
    const dup = await call<Body>(api.app, "POST", G(), { session: office, body: { ...groupBody(), code: body.code } });
    expect([dup.status, dup.body.code]).toEqual([409, "group.code_taken"]);
    const owner = await call<Body>(api.app, "POST", G(), {
      session: office,
      body: groupBody({ ownerUserId: w.officeB.id }),
    });
    expect([owner.status, owner.body.code]).toEqual([422, "group.owner_invalid"]);
    expect((await call(api.app, "POST", G(), { session: office, body: groupBody({ nameEn: "⁠ " }) })).status).toBe(400);
    expect((await call(api.app, "POST", G(), { session: office, body: groupBody({ code: "lower" }) })).status).toBe(
      400,
    );
  });

  it("read and list: organization.read (AUD 200); outsiders 404", async () => {
    const g = await call<Body>(api.app, "POST", G(), { session: office, body: groupBody() });
    expect((await call(api.app, "GET", `/api/v1/groups/${g.body.id}`, { session: auditor })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/groups/${g.body.id}`, { session: officeB })).status).toBe(404);
    const list = await call<Body>(api.app, "GET", `${G()}?limit=100`, { session: auditor });
    expect(list.body.items.map((x: Body) => x.id)).toContain(g.body.id);
    expect((await call(api.app, "GET", G(), { session: officeB })).status).toBe(404);
  });

  it("update: If-Match 428/409; rename, change owner, archive; audited", async () => {
    const g = await call<Body>(api.app, "POST", G(), { session: office, body: groupBody() });
    const U = `/api/v1/groups/${g.body.id}`;
    expect((await call(api.app, "PATCH", U, { session: office, body: { nameEn: "x" } })).status).toBe(428);
    expect((await call(api.app, "PATCH", U, { session: office, headers: ifm(3), body: { nameEn: "x" } })).status).toBe(
      409,
    );
    expect((await call(api.app, "PATCH", U, { session: auditor, headers: ifm(1), body: { nameEn: "x" } })).status).toBe(
      403,
    );
    expect((await call(api.app, "PATCH", U, { session: office, headers: ifm(1), body: {} })).status).toBe(400);
    const res = await call<Body>(api.app, "PATCH", U, {
      session: office,
      headers: ifm(1),
      body: { nameEn: "Renamed SteerCo", status: "archived", description: null },
    });
    expect(res.body).toMatchObject({ nameEn: "Renamed SteerCo", status: "archived", description: null, version: 2 });
    const audit = await auditOf(api.db, g.body.id);
    expect(audit.map((e) => e.action)).toEqual(["access_group.create", "access_group.update"]);
    expect(audit[1]!.changes).toMatchObject({ status: { from: "active", to: "archived" } });
    // An archived group takes no new member.
    const add = await call<Body>(api.app, "POST", `${U}/members`, { session: office, body: { userId: w.leadA1.id } });
    expect([add.status, add.body.code]).toEqual([422, "group.archived"]);
  });

  it("members: same organization only, one current membership, removal with a reason kept as history", async () => {
    const g = await call<Body>(api.app, "POST", G(), { session: office, body: groupBody() });
    const M = `/api/v1/groups/${g.body.id}/members`;
    expect((await call(api.app, "POST", M, { session: auditor, body: { userId: w.leadA1.id } })).status).toBe(403);
    const add = await call<Body>(api.app, "POST", M, { session: office, body: { userId: w.leadA1.id } });
    expect(add.status).toBe(201);
    expect(add.body).toMatchObject({ groupId: g.body.id, userId: w.leadA1.id, removedAt: null, version: 1 });
    expect(add.body.displayName).toMatch(/^Synthetic /);
    expect((await auditOf(api.db, add.body.id)).map((e) => e.action)).toEqual(["access_group_member.create"]);
    const dup = await call<Body>(api.app, "POST", M, { session: office, body: { userId: w.leadA1.id } });
    expect([dup.status, dup.body.code]).toEqual([409, "group.member_exists"]);
    const other = await call<Body>(api.app, "POST", M, { session: office, body: { userId: w.officeB.id } });
    expect([other.status, other.body.code]).toEqual([422, "group.member_other_organization"]);
    const win = await call<Body>(api.app, "POST", M, {
      session: office,
      body: { userId: w.auditor.id, effectiveFrom: "2026-10-01T00:00:00Z", effectiveTo: "2026-09-01T00:00:00Z" },
    });
    expect([win.status, win.body.code]).toEqual([422, "group.member_window_invalid"]);
    const second = await call<Body>(api.app, "POST", M, { session: office, body: { userId: w.auditor.id } });
    expect(second.status).toBe(201);
    expect(
      (await call<Body>(api.app, "GET", `/api/v1/groups/${g.body.id}`, { session: auditor })).body.memberCount,
    ).toBe(2);
    const R = `${M}/${add.body.id}/remove`;
    expect((await call(api.app, "POST", R, { session: office, body: { reason: "Synthetic: left" } })).status).toBe(428);
    expect(
      (await call(api.app, "POST", R, { session: office, headers: ifm(2), body: { reason: "Synthetic: left" } }))
        .status,
    ).toBe(409);
    expect(
      (await call(api.app, "POST", R, { session: auditor, headers: ifm(1), body: { reason: "Synthetic: left" } }))
        .status,
    ).toBe(403);
    const removed = await call<Body>(api.app, "POST", R, {
      session: office,
      headers: ifm(1),
      body: { reason: "Synthetic: left" },
    });
    expect([removed.status, removed.body.removedBy, removed.body.removeReason, removed.body.version]).toEqual([
      200,
      w.office.id,
      "Synthetic: left",
      2,
    ]);
    const again = await call<Body>(api.app, "POST", R, {
      session: office,
      headers: ifm(2),
      body: { reason: "Synthetic: again" },
    });
    expect([again.status, again.body.code]).toEqual([422, "group.member_removed"]);
    // Current members first; the removed one stays as history. Re-adding the same person is allowed.
    const list = await call<Body>(api.app, "GET", M, { session: auditor });
    expect(list.body.items.map((m: Body) => [m.userId, m.removedAt === null])).toEqual([
      [w.auditor.id, true],
      [w.leadA1.id, false],
    ]);
    expect((await call(api.app, "POST", M, { session: office, body: { userId: w.leadA1.id } })).status).toBe(201);
    expect((await auditOf(api.db, add.body.id)).map((e) => e.action)).toEqual([
      "access_group_member.create",
      "access_group_member.remove",
    ]);
  });

  it("commit-time: group.manage revoked while the request waits is refused, nothing written", async () => {
    const to = await createUser(api.db, w.orgA.id);
    await grant(api.db, w.grantor.id, to.id, "TO", { type: "organization", id: w.orgA.id }, w.orgA.id);
    const s = await signIn(api.app, to.subject);
    const body = groupBody();
    const res = await afterIdentity(
      api,
      to.id,
      () => call(api.app, "POST", G(), { session: s, body, contract: false }),
      () => revokeAll(api, w.grantor.id, to.id),
    );
    expect(res.status).toBe(403);
    const rows = await api.db.selectFrom("access_group").select("id").where("code", "=", body.code).execute();
    expect(rows).toEqual([]);
  });
});

describe("governance parties and role mappings (ADR-0026 §2; REQ-S10-008)", () => {
  let p: ApprovalWorld;
  beforeAll(async () => {
    p = await setupApprovalWorld(api, w);
  }, 60_000);

  it("lists the 18 T11/T12 parties in order (signed in); anonymous 401", async () => {
    const res = await call<Body>(api.app, "GET", "/api/v1/governance-parties", { session: auditor });
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(18);
    expect(res.body.items.slice(0, 6).map((x: Body) => x.code)).toEqual(["SP", "TL", "BO", "WL", "FIN", "TD"]);
    expect(res.body.items[0]).toMatchObject({ code: "SP", labelEn: "Sponsor", kind: "role", roleCode: "SP" });
    expect((await call(api.app, "GET", "/api/v1/governance-parties")).status).toBe(401);
  });

  it("create: role_mapping.assign (TL, TO); WL, AUD 403; one active mapping per party; targets validated; audited", async () => {
    const M = `/api/v1/transformations/${p.transformationId}/role-mappings`;
    const body = { partyCode: "FIN", targetKind: "user", userId: p.fin.id };
    expect((await call(api.app, "POST", M, { session: p.contributor.session, body })).status).toBe(403);
    expect((await call(api.app, "POST", M, { session: p.auditor.session, body })).status).toBe(403);
    expect((await call(api.app, "POST", M, { session: officeB, body })).status).toBe(404);
    const unknown = await call<Body>(api.app, "POST", M, {
      session: p.lead.session,
      body: { ...body, partyCode: "NOPE" },
    });
    expect([unknown.status, unknown.body.code]).toEqual([422, "role_mapping.party_unknown"]);
    const mismatch = await call<Body>(api.app, "POST", M, {
      session: p.lead.session,
      body: { partyCode: "FIN", targetKind: "group", userId: p.fin.id },
    });
    expect([mismatch.status, mismatch.body.code]).toEqual([422, "role_mapping.target_invalid"]);
    const foreign = await call<Body>(api.app, "POST", M, {
      session: p.lead.session,
      body: { ...body, userId: w.officeB.id },
    });
    expect([foreign.status, foreign.body.code]).toEqual([422, "role_mapping.target_invalid"]);
    const ok = await call<Body>(api.app, "POST", M, { session: p.lead.session, body });
    expect(ok.status).toBe(201);
    expect(ok.body).toMatchObject({
      partyCode: "FIN",
      targetKind: "user",
      userId: p.fin.id,
      status: "active",
      version: 1,
    });
    expect(ok.body.targetDisplayName).toMatch(/^Synthetic /);
    expect((await auditOf(api.db, ok.body.id)).map((e) => e.action)).toEqual(["role_mapping.create"]);
    const dup = await call<Body>(api.app, "POST", M, { session: office, body });
    expect([dup.status, dup.body.code]).toEqual([409, "role_mapping.already_mapped"]);
    // End (If-Match), then map again: the history stays.
    const E = `${M}/${ok.body.id}/end`;
    expect((await call(api.app, "POST", E, { session: p.lead.session, body: { reason: "Synthetic" } })).status).toBe(
      428,
    );
    expect(
      (await call(api.app, "POST", E, { session: p.lead.session, headers: ifm(5), body: { reason: "Synthetic" } }))
        .status,
    ).toBe(409);
    expect(
      (
        await call(api.app, "POST", E, {
          session: p.contributor.session,
          headers: ifm(1),
          body: { reason: "Synthetic" },
        })
      ).status,
    ).toBe(403);
    const ended = await call<Body>(api.app, "POST", E, {
      session: p.lead.session,
      headers: ifm(1),
      body: { reason: "Synthetic: changed" },
    });
    expect([ended.status, ended.body.status, ended.body.endReason]).toEqual([200, "ended", "Synthetic: changed"]);
    const again = await call<Body>(api.app, "POST", E, {
      session: p.lead.session,
      headers: ifm(2),
      body: { reason: "Synthetic" },
    });
    expect([again.status, again.body.code]).toEqual([422, "role_mapping.ended"]);
    expect((await call(api.app, "POST", M, { session: office, body })).status).toBe(201);
    const history = await call<Body>(api.app, "GET", `${M}?status=ended`, { session: p.auditor.session });
    expect(history.body.items.map((m: Body) => m.id)).toContain(ok.body.id);
    expect((await auditOf(api.db, ok.body.id)).map((e) => e.action)).toEqual([
      "role_mapping.create",
      "role_mapping.end",
    ]);
  });

  it("maps a party to a governed group; resolve shows the group (mapped) and an unknown party is 400", async () => {
    const g = await call<Body>(api.app, "POST", G(), { session: office, body: groupBody() });
    const M = `/api/v1/transformations/${p.transformationId}/role-mappings`;
    const res = await call<Body>(api.app, "POST", M, {
      session: p.lead.session,
      body: { partyCode: "STEERCO", targetKind: "group", groupId: g.body.id },
    });
    expect([res.status, res.body.groupId, res.body.targetDisplayName]).toEqual([201, g.body.id, "Executive SteerCo"]);
    const r = await call<Body>(api.app, "GET", `${M}/resolve?party=STEERCO`, { session: p.auditor.session });
    expect(r.body).toEqual({
      partyCode: "STEERCO",
      status: "mapped",
      mappingId: res.body.id,
      targetKind: "group",
      userId: null,
      groupId: g.body.id,
    });
    expect((await call(api.app, "GET", `${M}/resolve?party=NOPE`, { session: p.auditor.session })).status).toBe(400);
    expect((await call(api.app, "GET", `${M}/resolve?party=BO`, { session: officeB })).status).toBe(404);
  });
});

describe("REQ-S16-011: the identity and access entity group through the API, with authorization enforced", () => {
  it("creates and reads Organization, BusinessUnit, User, Group, ScopedAssignment and Delegation; reads Role and Permission", async () => {
    // Organization (organization.manage): ADM creates; TO is refused.
    const orgCode = uniq("ORG");
    expect(
      (
        await call(api.app, "POST", "/api/v1/organizations", {
          session: office,
          body: { code: orgCode, nameEn: "x", nameAr: "س" },
        })
      ).status,
    ).toBe(403);
    const org = await call<Body>(api.app, "POST", "/api/v1/organizations", {
      session: admin,
      body: { code: orgCode, nameEn: "Synthetic entity-group org", nameAr: "مؤسسة اصطناعية" },
    });
    expect(org.status).toBe(201);
    expect(
      (await call<Body>(api.app, "GET", `/api/v1/organizations/${org.body.id}`, { session: admin })).body,
    ).toMatchObject({ id: org.body.id, status: "active" });
    // BusinessUnit (business_unit.manage): ADM creates under org A; TO refused; outsiders 404.
    const buUrl = `/api/v1/organizations/${w.orgA.id}/business-units`;
    expect(
      (await call(api.app, "POST", buUrl, { session: office, body: { code: uniq("BU"), nameEn: "x", nameAr: "س" } }))
        .status,
    ).toBe(403);
    const bu = await call<Body>(api.app, "POST", buUrl, {
      session: admin,
      body: { code: uniq("BU"), nameEn: "Synthetic unit", nameAr: "وحدة" },
    });
    expect(bu.status).toBe(201);
    expect((await call(api.app, "GET", `/api/v1/business-units/${bu.body.id}`, { session: auditor })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/business-units/${bu.body.id}`, { session: officeB })).status).toBe(404);
    // User (user.manage): ADM_ACCESS creates; TO refused.
    const userBody = {
      organizationId: w.orgA.id,
      displayName: "Synthetic entity-group user",
      email: `${uniq("eg").toLowerCase()}@example.invalid`,
      identity: { issuer: "https://idp.example.invalid", subject: uniq("eg-") },
    };
    expect((await call(api.app, "POST", "/api/v1/users", { session: office, body: userBody })).status).toBe(403);
    const user = await call<Body>(api.app, "POST", "/api/v1/users", { session: admin, body: userBody });
    expect(user.status).toBe(201);
    expect((await call<Body>(api.app, "GET", `/api/v1/users/${user.body.id}`, { session: admin })).body.id).toBe(
      user.body.id,
    );
    // Group (group.manage): TO creates; ADM refused (a technical administrator does not manage governed groups).
    expect((await call(api.app, "POST", G(), { session: admin, body: groupBody() })).status).toBe(403);
    const group = await call<Body>(api.app, "POST", G(), { session: office, body: groupBody() });
    expect(group.status).toBe(201);
    expect((await call(api.app, "GET", `/api/v1/groups/${group.body.id}`, { session: auditor })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/groups/${group.body.id}`, { session: officeB })).status).toBe(404);
    // Role and Permission: seeded read-only catalogues (role.read); a user without it is refused.
    const roles = await call<Body>(api.app, "GET", "/api/v1/roles", { session: admin });
    expect(roles.body.items.map((r: Body) => r.code)).toEqual(expect.arrayContaining(["SP", "BO", "FIN", "ADM_TECH"]));
    const perms = await call<Body>(api.app, "GET", "/api/v1/permissions", { session: admin });
    expect(perms.body.items.map((x: Body) => x.code)).toEqual(
      expect.arrayContaining(["group.manage", "approval.decide", "delegation.create_own"]),
    );
    expect((await call(api.app, "GET", "/api/v1/roles", { session: nobody })).status).toBe(403);
    expect((await call(api.app, "GET", "/api/v1/permissions", { session: nobody })).status).toBe(403);
    // ScopedAssignment (access.assign): ADM_ACCESS grants FIN at the org to the new user; TO refused.
    const assignment = {
      userId: user.body.id,
      roleCode: "FIN",
      scope: { type: "organization", id: w.orgA.id },
      reason: "Synthetic entity-group grant",
    };
    expect(
      (await call(api.app, "POST", "/api/v1/role-assignments", { session: office, body: assignment })).status,
    ).toBe(403);
    const sa = await call<Body>(api.app, "POST", "/api/v1/role-assignments", { session: admin, body: assignment });
    expect(sa.status).toBe(201);
    expect((await call(api.app, "GET", `/api/v1/role-assignments/${sa.body.id}`, { session: admin })).status).toBe(200);
    // Delegation (delegation.create_own for yourself): the TO delegates; AUD refused; strangers do not see it.
    const del = await call<Body>(api.app, "POST", "/api/v1/delegations", {
      session: office,
      body: {
        delegateUserId: w.leadA1.id,
        reasonCode: "absence",
        effectiveFrom: new Date(Date.now() - 60_000).toISOString(),
        effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
      },
    });
    expect(del.status, JSON.stringify(del.body)).toBe(201);
    expect((await call(api.app, "GET", `/api/v1/delegations/${del.body.id}`, { session: office })).status).toBe(200);
    expect((await call(api.app, "GET", `/api/v1/delegations/${del.body.id}`, { session: auditor })).status).toBe(404);
    expect(
      (
        await call(api.app, "POST", "/api/v1/delegations", {
          session: auditor,
          body: {
            delegateUserId: w.leadA1.id,
            reasonCode: "absence",
            effectiveFrom: new Date().toISOString(),
            effectiveTo: new Date(Date.now() + 86_400_000).toISOString(),
          },
        })
      ).status,
    ).toBe(403);
  });
});
