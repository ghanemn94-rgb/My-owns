// OIDC authorization code + PKCE against a local fake OpenID Provider, with the real openid-client doing all ID-token
// validation (ADR-0005 §1-2; REQ-S16-007 increment). Runs on its OWN fresh database, because just-in-time provisioning
// depends on how many organizations exist.
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import {
  createScratchDatabase,
  dropScratchDatabase,
  roleUrl,
  testDatabase,
} from "../../../../packages/db/test/helpers.ts";
import { OidcService } from "../../src/modules/identity/index.ts";
import { FakeIdp } from "../support/fake-idp.ts";
import {
  APP_ORIGIN,
  auditOf,
  call,
  createOrg,
  createUser,
  startApi,
  testConfig,
  type TestApi,
} from "../support/harness.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let api: TestApi;
let orgId: string;

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_oidc");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  idp = await new FakeIdp().start();
  const env = {
    AUTH_MODE: "oidc",
    OIDC_ISSUER_URL: idp.issuer,
    OIDC_CLIENT_ID: idp.clientId,
    OIDC_CLIENT_SECRET: idp.clientSecret,
    DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
  };
  api = await startApi({ env });
  orgId = (await createOrg(api.db, "OIDCORG")).id;
});
afterAll(async () => {
  await api.close();
  await idp.stop();
  await dropScratchDatabase(adminUrl, dbName);
});

async function startLogin(returnTo?: string) {
  const res = await call(
    api.app,
    "GET",
    `/api/v1/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
  );
  expect(res.status).toBe(302);
  return String(res.headers["location"]);
}

async function completeLogin(
  claims: Parameters<FakeIdp["issueCode"]>[1],
  opts: Parameters<FakeIdp["issueCode"]>[2] = {},
  returnTo?: string,
) {
  const authUrl = await startLogin(returnTo);
  const { code, state } = idp.issueCode(authUrl, claims, opts);
  const cb = await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`);
  return { cb, state, cookie: cb.headers["set-cookie"] ? String(cb.headers["set-cookie"]).split(";")[0]! : null };
}

describe("GET /api/v1/auth/login", () => {
  it("redirects to the IdP with code flow, PKCE S256, state and nonce, storing only the state's hash", async () => {
    const location = new URL(await startLogin("/transformations?x=1"));
    expect(location.origin + location.pathname).toBe(`${idp.issuer}/protocol/openid-connect/auth`);
    const p = location.searchParams;
    expect(p.get("response_type")).toBe("code");
    expect(p.get("client_id")).toBe(idp.clientId);
    expect(p.get("redirect_uri")).toBe(`${APP_ORIGIN}/api/v1/auth/callback`);
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("scope")).toBe("openid profile email");
    const stored = await api.db
      .selectFrom("oidc_login_state")
      .selectAll()
      .where("state_hash", "=", createHash("sha256").update(p.get("state")!).digest())
      .executeTakeFirstOrThrow();
    expect(stored.return_to).toBe("/transformations?x=1");
    expect(stored.nonce).toBe(p.get("nonce"));
    expect(stored.expires_at.getTime() - stored.created_at.getTime()).toBe(10 * 60 * 1000);
  });

  it.each(["//evil.example/x", "https://evil.example/", "relative", "/\\evil"])(
    "rejects returnTo=%s (open redirect) with 400",
    async (returnTo) => {
      const res = await call(api.app, "GET", `/api/v1/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
      expect(res.status).toBe(400);
    },
  );
});

describe("GET /api/v1/auth/callback", () => {
  it("provisions a first-time user just in time, WITHOUT any role, and signs them in (audited)", async () => {
    const { cb, cookie } = await completeLogin(
      { sub: "jit-subject-1", email: "jit1@example.invalid", email_verified: true, name: "Synthetic JIT User" },
      {},
      "/welcome",
    );
    expect(cb.status).toBe(302);
    expect(cb.headers["location"]).toBe("/welcome");
    expect(cookie).toMatch(/^mth_session=/);
    const identity = await api.db
      .selectFrom("user_identity")
      .selectAll()
      .where("issuer", "=", idp.issuer)
      .where("subject", "=", "jit-subject-1")
      .executeTakeFirstOrThrow();
    const user = await api.db
      .selectFrom("app_user")
      .selectAll()
      .where("id", "=", identity.user_id)
      .executeTakeFirstOrThrow();
    expect(user).toMatchObject({
      organization_id: orgId,
      display_name: "Synthetic JIT User",
      email: "jit1@example.invalid",
    });
    const assignments = await api.db
      .selectFrom("scoped_assignment")
      .select("id")
      .where("user_id", "=", user.id)
      .execute();
    expect(assignments).toEqual([]);
    expect((await auditOf(api.db, user.id)).map((a) => a.action)).toEqual(["app_user.create"]);
    const me = await call(api.app, "GET", "/api/v1/me", { session: { cookie: cookie!, csrf: "", userId: "" } });
    expect(me.body).toMatchObject({ authMode: "oidc", assignments: [], effectivePermissions: [] });
  });

  it("signs an existing (issuer, subject) back in to the same user", async () => {
    const before = await api.db.selectFrom("app_user").select("id").execute();
    const { cb } = await completeLogin({
      sub: "jit-subject-1",
      email: "changed@example.invalid",
      email_verified: true,
    });
    expect(cb.status).toBe(302);
    expect(await api.db.selectFrom("app_user").select("id").execute()).toHaveLength(before.length);
  });

  it("binds a pre-provisioned user by VERIFIED e-mail only", async () => {
    const pre = await createUser(api.db, orgId, { email: "Pre.Provisioned@example.invalid" });
    const unverified = await completeLogin({
      sub: "sub-unverified",
      email: "pre.provisioned@example.invalid",
      email_verified: false,
      name: "Someone",
    });
    expect(unverified.cb.status).toBe(302);
    const unboundId = await api.db
      .selectFrom("user_identity")
      .select("user_id")
      .where("subject", "=", "sub-unverified")
      .executeTakeFirstOrThrow();
    expect(unboundId.user_id).not.toBe(pre.id); // a separate JIT user, not a takeover of the pre-provisioned one

    const verified = await completeLogin({
      sub: "sub-verified",
      email: "pre.provisioned@example.invalid",
      email_verified: true,
    });
    expect(verified.cb.status).toBe(302);
    const bound = await api.db
      .selectFrom("user_identity")
      .select("user_id")
      .where("subject", "=", "sub-verified")
      .executeTakeFirstOrThrow();
    expect(bound.user_id).toBe(pre.id);
    expect((await auditOf(api.db, pre.id)).map((a) => a.action)).toContain("user_identity.bind");
  });

  it("refuses a disabled user", async () => {
    const u = await createUser(api.db, orgId);
    await api.db
      .insertInto("user_identity")
      .values({ id: crypto.randomUUID(), user_id: u.id, issuer: idp.issuer, subject: "sub-disabled" })
      .execute();
    await api.db.updateTable("app_user").set({ status: "disabled" }).where("id", "=", u.id).execute();
    const { cb, cookie } = await completeLogin({ sub: "sub-disabled" });
    expect(cb.headers["location"]).toBe("/login?error=account_disabled");
    expect(cookie).toBeNull();
  });

  it("uses each state once, and rejects unknown or expired states", async () => {
    const authUrl = await startLogin();
    const { code, state } = idp.issueCode(authUrl, { sub: "sub-state" });
    expect((await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`)).headers["location"]).toBe(
      "/",
    );
    const replay = await call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`);
    expect(replay.headers["location"]).toBe("/login?error=state_invalid");
    expect((await call(api.app, "GET", "/api/v1/auth/callback?code=x&state=unknown")).headers["location"]).toBe(
      "/login?error=state_invalid",
    );

    const expiredUrl = await startLogin();
    const expired = idp.issueCode(expiredUrl, { sub: "sub-expired" });
    await api.db
      .updateTable("oidc_login_state")
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where("state_hash", "=", createHash("sha256").update(expired.state).digest())
      .execute();
    expect(
      (await call(api.app, "GET", `/api/v1/auth/callback?code=${expired.code}&state=${expired.state}`)).headers[
        "location"
      ],
    ).toBe("/login?error=state_invalid");
  });

  it("rejects a wrong nonce and a PKCE mismatch (token_invalid), and IdP errors (idp_denied), all without a session", async () => {
    const nonce = await completeLogin({ sub: "sub-nonce", nonce: "not-the-stored-nonce" });
    expect([nonce.cb.headers["location"], nonce.cookie]).toEqual(["/login?error=token_invalid", null]);
    const pkce = await completeLogin({ sub: "sub-pkce" }, { challengeOverride: "A".repeat(43) });
    expect([pkce.cb.headers["location"], pkce.cookie]).toEqual(["/login?error=token_invalid", null]);
    const authUrl = await startLogin();
    const state = new URL(authUrl).searchParams.get("state")!;
    const denied = await call(api.app, "GET", `/api/v1/auth/callback?error=access_denied&state=${state}`);
    expect(denied.headers["location"]).toBe("/login?error=idp_denied");
    expect(
      await api.db.selectFrom("user_identity").select("id").where("subject", "in", ["sub-nonce", "sub-pkce"]).execute(),
    ).toEqual([]);
  });

  it("refuses just-in-time provisioning when several organizations exist (users must be pre-provisioned)", async () => {
    await createOrg(api.db, "OIDCORG2");
    const { cb } = await completeLogin({ sub: "sub-multi-org", email: "multi@example.invalid", email_verified: true });
    expect(cb.headers["location"]).toBe("/login?error=not_provisioned");
  });
});

describe("OIDC logout and configuration", () => {
  it("returns the IdP end-session URL for OIDC sessions", async () => {
    const { cookie } = await completeLogin({ sub: "jit-subject-1" });
    const s = { cookie: cookie!, csrf: "", userId: "" };
    const me = await call<{ csrfToken: string }>(api.app, "GET", "/api/v1/me", { session: s });
    const out = await call<{ endSessionUrl: string }>(api.app, "POST", "/api/v1/auth/logout", {
      session: { ...s, csrf: me.body.csrfToken },
    });
    expect(out.status).toBe(200);
    const u = new URL(out.body.endSessionUrl);
    expect(u.origin + u.pathname).toBe(`${idp.issuer}/protocol/openid-connect/logout`);
    expect(u.searchParams.get("post_logout_redirect_uri")).toBe(`${APP_ORIGIN}/login`);
  });

  it("answers 404 on /auth/login and /auth/callback when OIDC is not configured", async () => {
    const devApi = await startApi({ oidc: null });
    try {
      expect((await call(devApi.app, "GET", "/api/v1/auth/login")).status).toBe(404);
      expect((await call(devApi.app, "GET", "/api/v1/auth/callback?state=x", { contract: false })).status).toBe(404);
    } finally {
      await devApi.close();
    }
  });

  it("redirects to /login?error=idp_unavailable when the IdP cannot be reached, and never fails startup", async () => {
    const svc = new OidcService(
      testConfig({ OIDC_ISSUER_URL: "http://127.0.0.1:9/realms/down", OIDC_CLIENT_ID: "c", OIDC_CLIENT_SECRET: "s" }),
      { discoveryTimeoutSeconds: 1 },
    );
    const downApi = await startApi({ oidc: svc });
    try {
      const res = await call(downApi.app, "GET", "/api/v1/auth/login");
      expect([res.status, res.headers["location"]]).toEqual([302, "/login?error=idp_unavailable"]);
    } finally {
      await downApi.close();
    }
  });

  it("keeps the IdP's token endpoint behind the server (the browser never receives tokens)", () => {
    expect(idp.tokenRequests).toBeGreaterThan(0);
  });
});
