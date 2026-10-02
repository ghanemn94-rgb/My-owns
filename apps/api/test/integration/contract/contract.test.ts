// Contract tests (ADR-0007 §2):
//  1. route coverage: every Fastify route under /api/v1 (plus /healthz, /readyz) has an OpenAPI operation and every
//     operation has a route, with the same method;
//  2. every operation is exercised at least once in this file through the validating client (status, body, headers
//     checked against docs/api/openapi.yaml), with at least one success response each;
//  3. zod lockstep: every successful body also parses with the @mth/shared/schemas mirror of its component, and the
//     problem bodies parse with the problem mirror.
import {
  auditEvent,
  brandingTokens,
  businessUnit,
  logoutResult,
  me,
  organization,
  page,
  permissionEntry,
  problem,
  role,
  roleAssignment,
  transformation,
  user,
} from "@mth/shared/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";
import { FakeIdp } from "../../support/fake-idp.ts";
import { exercised, operations } from "../../support/contract.ts";
import { P2_PENDING_OPERATIONS } from "../../support/p2-pending.ts";
import { exerciseKpiOperations } from "./kpi-exercises.ts";
import {
  call,
  seedWorld,
  signIn,
  startApi,
  uniq,
  type Session,
  type TestApi,
  type World,
} from "../../support/harness.ts";
import { OidcService } from "../../../src/modules/identity/index.ts";
import { testConfig } from "../../support/harness.ts";

const ZOD_MIRRORS: Record<string, z.ZodType> = {
  getMe: me,
  updateMyPreferences: user,
  listOrganizations: page(organization),
  createOrganization: organization,
  getOrganization: organization,
  updateOrganization: organization,
  listBusinessUnits: page(businessUnit),
  createBusinessUnit: businessUnit,
  getBusinessUnit: businessUnit,
  updateBusinessUnit: businessUnit,
  listUsers: page(user),
  createUser: user,
  getUser: user,
  updateUser: user,
  listRoles: z.strictObject({ items: z.array(role) }),
  listPermissions: z.strictObject({ items: z.array(permissionEntry) }),
  listRoleAssignments: page(roleAssignment),
  createRoleAssignment: roleAssignment,
  getRoleAssignment: roleAssignment,
  revokeRoleAssignment: roleAssignment,
  listTransformations: page(transformation),
  createTransformation: transformation,
  getTransformation: transformation,
  updateTransformation: transformation,
  archiveTransformation: transformation,
  listTransformationAudit: page(auditEvent),
  getBrandingTokens: brandingTokens,
  logout: logoutResult,
};

let api: TestApi;
let w: World;
let idp: FakeIdp;
const zodChecked = new Set<string>();

async function mirrored<T = { id: string; user: { version: number } }>(
  method: string,
  url: string,
  opts: Parameters<typeof call>[3] = {},
) {
  const res = await call<T>(api.app, method, url, opts);
  const op = operations.find((o) => o.method === method && o.regex.test(url.split("?")[0]!))!;
  if (res.status >= 400) {
    expect(problem.safeParse(res.body).success, `problem mirror for ${op.operationId} ${res.status}`).toBe(true);
  } else if (ZOD_MIRRORS[op.operationId] && res.status !== 204) {
    const parsed = ZOD_MIRRORS[op.operationId]!.safeParse(res.body);
    expect(
      parsed.success,
      `zod mirror for ${op.operationId}: ${parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 3))}`,
    ).toBe(true);
    zodChecked.add(op.operationId);
  }
  return res;
}

beforeAll(async () => {
  idp = await new FakeIdp().start();
  const oidc = new OidcService(
    testConfig({ OIDC_ISSUER_URL: idp.issuer, OIDC_CLIENT_ID: idp.clientId, OIDC_CLIENT_SECRET: idp.clientSecret }),
  );
  api = await startApi({ oidc });
  w = await seedWorld(api.db);
});
afterAll(async () => {
  await api.close();
  await idp.stop();
});

describe("route coverage", () => {
  const toOpenApi = (url: string) => url.replace(/:([A-Za-z]+)/g, "{$1}");
  it("maps every governed Fastify route to an OpenAPI operation with the same method, and back", () => {
    const governed = api.routes
      .filter(
        (r) =>
          (r.url.startsWith("/api/") || r.url === "/healthz" || r.url === "/readyz") &&
          r.method !== "HEAD" &&
          r.method !== "OPTIONS",
      )
      .map((r) => `${r.method} ${toOpenApi(r.url)}`)
      .sort();
    const contract = operations
      .filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId))
      .map((o) => `${o.method} ${o.path}`)
      .sort();
    // dev-login is registered only in AUTH_MODE=dev and OIDC routes only with OIDC configured: this app has both.
    expect(governed).toEqual(contract);
    // Pending P2 operations (p2-pending.ts) are declared but not routed yet; a routed one must leave the list.
    const pending = operations.filter((o) => P2_PENDING_OPERATIONS.has(o.operationId));
    expect(pending.map((o) => o.operationId).sort()).toEqual([...P2_PENDING_OPERATIONS].sort());
    expect(pending.filter((o) => governed.includes(`${o.method} ${o.path}`)).map((o) => o.operationId)).toEqual([]);
  });

  it("declares access on every governed route (public or a permission)", () => {
    for (const r of api.routes.filter((r) => r.url.startsWith("/api/"))) {
      expect(r.access, `${r.method} ${r.url}`).toBeTruthy();
    }
  });
});

describe("every operation, validated against the contract and the zod mirrors", () => {
  let admin: Session;
  let office: Session;

  it("health", async () => {
    await mirrored("GET", "/healthz");
    await mirrored("GET", "/readyz");
  });

  it("auth + me", async () => {
    await mirrored("POST", "/api/v1/auth/dev-login", { body: { username: "nobody.here" } });
    admin = await signIn(api.app, w.admin.subject);
    office = await signIn(api.app, w.office.subject);
    const meRes = await mirrored("GET", "/api/v1/me", { session: office });
    await mirrored("PUT", "/api/v1/me/preferences", {
      session: office,
      headers: { "if-match": `"${meRes.body.user.version}"` },
      body: { preferredLocale: "en" },
    });
    await mirrored("GET", "/api/v1/me");
    const login = await mirrored("GET", "/api/v1/auth/login?returnTo=%2F");
    // An existing (issuer, subject) binding, so the sign-in does not depend on how many organizations the shared run
    // database holds (just-in-time provisioning needs exactly one).
    const sub = `contract-${uniq("s")}`;
    await api.db
      .insertInto("user_identity")
      .values({ id: crypto.randomUUID(), user_id: w.office.id, issuer: idp.issuer, subject: sub })
      .execute();
    const { code, state } = idp.issueCode(String(login.headers["location"]), { sub });
    // The browser that started the login presents its binding cookie (F-DG1-103), so this is a real sign-in.
    const setCookie = [login.headers["set-cookie"] ?? []].flat().map(String);
    const binding = setCookie.find((c) => c.startsWith("mth_login="))!.split(";")[0]!;
    const cb = await mirrored("GET", `/api/v1/auth/callback?code=${code}&state=${state}`, {
      headers: { cookie: binding },
    });
    expect([cb.status, cb.headers["location"]]).toEqual([302, "/"]);
    expect(
      [cb.headers["set-cookie"] ?? []]
        .flat()
        .map(String)
        .some((c) => c.startsWith("mth_session=")),
    ).toBe(true);
  });

  it("organizations and business units", async () => {
    await mirrored("GET", "/api/v1/organizations", { session: office });
    const org = await mirrored("POST", "/api/v1/organizations", {
      session: admin,
      body: { code: uniq("C"), nameEn: "Contract org", nameAr: "مؤسسة" },
    });
    await mirrored("GET", `/api/v1/organizations/${org.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/organizations/${org.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "Contract org 2" },
    });
    await mirrored("PATCH", `/api/v1/organizations/${org.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { nameEn: "stale" },
    });
    await mirrored("GET", `/api/v1/organizations/${w.orgA.id}/business-units`, { session: office });
    const bu = await mirrored("POST", `/api/v1/organizations/${w.orgA.id}/business-units`, {
      session: admin,
      body: { code: uniq("C"), nameEn: "Contract BU", nameAr: "وحدة" },
    });
    await mirrored("GET", `/api/v1/business-units/${bu.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/business-units/${bu.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { status: "inactive" },
    });
    await mirrored("PATCH", `/api/v1/business-units/${bu.body.id}`, { session: admin, body: { status: "active" } });
  });

  it("users, roles, permissions and assignments", async () => {
    await mirrored("GET", `/api/v1/users?organizationId=${w.orgA.id}`, { session: admin });
    const u = await mirrored("POST", "/api/v1/users", {
      session: admin,
      body: { organizationId: w.orgA.id, displayName: "Contract user" },
    });
    await mirrored("GET", `/api/v1/users/${u.body.id}`, { session: admin });
    await mirrored("PATCH", `/api/v1/users/${u.body.id}`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { preferredLocale: "en" },
    });
    await mirrored("GET", "/api/v1/roles", { session: admin });
    await mirrored("GET", "/api/v1/permissions", { session: admin });
    await mirrored("GET", `/api/v1/role-assignments?organizationId=${w.orgA.id}`, { session: admin });
    const a = await mirrored("POST", "/api/v1/role-assignments", {
      session: admin,
      body: {
        userId: u.body.id,
        roleCode: "WL",
        scope: { type: "business_unit", id: w.a1 },
        reason: "Contract test grant",
        effectiveFrom: new Date().toISOString(),
      },
    });
    await mirrored("GET", `/api/v1/role-assignments/${a.body.id}`, { session: admin });
    await mirrored("POST", `/api/v1/role-assignments/${a.body.id}/revoke`, {
      session: admin,
      headers: { "if-match": '"1"' },
      body: { reason: "Contract test revoke" },
    });
    await mirrored("POST", "/api/v1/role-assignments", {
      session: admin,
      body: { userId: u.body.id, roleCode: "WL", scope: { type: "forum", id: w.a1 }, reason: "Reserved" },
    });
  });

  it("transformations and audit", async () => {
    const t = await mirrored("POST", "/api/v1/transformations", {
      session: office,
      headers: { "idempotency-key": uniq("contract-key-") },
      body: { businessUnitId: w.a1, name: "Contract", mode: "modular", entryPhase: "define" },
    });
    await mirrored("GET", "/api/v1/transformations?sort=code:asc&limit=5", { session: office });
    await mirrored("GET", `/api/v1/transformations/${t.body.id}`, { session: office });
    await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: { "if-match": '"1"' },
      body: { description: "Synthetic description", sponsorUserId: null },
    });
    await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, { session: office, body: { name: "no if-match" } });
    // F-DG1-001: closure is the G6 business decision (absent in P1), so a status edit to closed is a declared 422.
    const close = await mirrored("PATCH", `/api/v1/transformations/${t.body.id}`, {
      session: office,
      headers: { "if-match": '"2"' },
      body: { status: "closed" },
    });
    expect([close.status, (close.body as unknown as { code: string }).code]).toEqual([422, "invalid_transition"]);
    await mirrored("POST", `/api/v1/transformations/${t.body.id}/archive`, {
      session: office,
      headers: { "if-match": '"2"' },
      body: { reason: "Contract archive" },
    });
    await mirrored("GET", `/api/v1/transformations/${t.body.id}/audit?limit=2`, { session: office });
    await mirrored("POST", "/api/v1/auth/logout", { session: office });
  });

  it("branding tokens (getBrandingTokens): authenticated-only, provisional provenance, contract + zod valid", async () => {
    const anonymous = await mirrored("GET", "/api/v1/branding/tokens");
    expect(anonymous.status).toBe(401);
    const res = await mirrored<{ provenance: string; tokens: { name: string; value: string; provisional: boolean }[] }>(
      "GET",
      "/api/v1/branding/tokens",
      { session: admin },
    );
    expect(res.status).toBe(200);
    // #0078FF is a provisional brand token, not a verified Mobily colour: the API must never call the set official.
    expect(res.body.provenance).toBe("provisional");
    expect(res.body.tokens.length).toBeGreaterThan(0);
    expect(res.body.tokens.some((t) => t.value.toUpperCase() === "#0078FF" && t.provisional)).toBe(true);
  });

  it("kpi module operations (P2; kpi-exercises.ts, owned by kpi-benefits-engineer)", async () => {
    await exerciseKpiOperations({
      api,
      world: w,
      sessions: { admin, office },
      mirrored: (m, u, o) => mirrored(m, u, o),
    });
  });

  it("covers every operation with at least one success and every successful body with its zod mirror", () => {
    const live = operations.filter((o) => !P2_PENDING_OPERATIONS.has(o.operationId));
    const missing = live.filter((o) => !exercised.has(o.operationId)).map((o) => o.operationId);
    expect(missing).toEqual([]);
    expect([...P2_PENDING_OPERATIONS].filter((id) => exercised.has(id))).toEqual([]);
    const noSuccess = live
      .filter((o) => ![...exercised.get(o.operationId)!].some((s) => s < 400))
      .map((o) => o.operationId);
    expect(noSuccess).toEqual([]);
    const mirrorsNotChecked = Object.keys(ZOD_MIRRORS).filter((id) => !zodChecked.has(id));
    expect(mirrorsNotChecked).toEqual([]);
    // 33 P1 operations + 127 P2 operations (T-DG2-ARCH-01B). A new operation needs a contract change first.
    expect(operations).toHaveLength(160);
  });
});
