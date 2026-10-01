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

/** The login cookie ("mth_login=<binding>") each started login set in "its" browser, keyed by the state it bound. */
const loginCookieOf = new Map<string, string>();

function setCookies(res: { headers: Record<string, unknown> }): string[] {
  const h = res.headers["set-cookie"];
  return h === undefined ? [] : Array.isArray(h) ? h.map(String) : [String(h)];
}

async function startLogin(returnTo?: string) {
  const res = await call(
    api.app,
    "GET",
    `/api/v1/auth/login${returnTo ? `?returnTo=${encodeURIComponent(returnTo)}` : ""}`,
  );
  expect(res.status).toBe(302);
  const location = String(res.headers["location"]);
  const login = setCookies(res).find((c) => c.startsWith("mth_login="));
  expect(login, "GET /auth/login sets the browser-binding login cookie").toBeTruthy();
  loginCookieOf.set(new URL(location).searchParams.get("state")!, login!.split(";")[0]!);
  return location;
}

/** The callback as the browser that started the login (it presents its login cookie). */
function callback(query: string, state: string, extraCookie?: string) {
  const cookie = [loginCookieOf.get(state), extraCookie].filter(Boolean).join("; ");
  return call(api.app, "GET", `/api/v1/auth/callback?${query}`, { headers: cookie ? { cookie } : {} });
}

const sessionCookieOf = (res: { headers: Record<string, unknown> }) =>
  setCookies(res)
    .find((c) => c.startsWith("mth_session="))
    ?.split(";")[0] ?? null;

async function completeLogin(
  claims: Parameters<FakeIdp["issueCode"]>[1],
  opts: Parameters<FakeIdp["issueCode"]>[2] = {},
  returnTo?: string,
) {
  const authUrl = await startLogin(returnTo);
  const { code, state } = idp.issueCode(authUrl, claims, opts);
  const cb = await callback(`code=${code}&state=${state}`, state);
  return { cb, state, cookie: sessionCookieOf(cb) };
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
    expect((await callback(`code=${code}&state=${state}`, state)).headers["location"]).toBe("/");
    const replay = await callback(`code=${code}&state=${state}`, state);
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
    expect((await callback(`code=${expired.code}&state=${expired.state}`, expired.state)).headers["location"]).toBe(
      "/login?error=state_invalid",
    );
  });

  describe("login CSRF: the state is bound to the browser that started the login (F-DG1-103)", () => {
    const auditFor = (requestId: string) =>
      api.db.selectFrom("audit_event").selectAll().where("request_id", "=", requestId).execute();

    it("refuses an attacker's live callback in the victim's browser; the victim stays signed in as themself", async () => {
      // The victim's browser holds its own valid OIDC session.
      const victim = await completeLogin({ sub: "csrf-victim", name: "Synthetic victim" });
      expect(victim.cookie).toMatch(/^mth_session=/);
      // The attacker starts a login in THEIR browser, authenticates at the IdP as themself and stops before the callback.
      const attackerAuthUrl = await startLogin();
      const attacker = idp.issueCode(attackerAuthUrl, { sub: "csrf-attacker" });
      const query = `code=${attacker.code}&state=${attacker.state}`;

      // (a) the victim's browser opens the captured callback URL: it has a session but no login cookie for this state
      const noBinding = await call(api.app, "GET", `/api/v1/auth/callback?${query}`, {
        headers: { cookie: victim.cookie!, "x-request-id": "csrf-test-no-binding" },
      });
      expect(noBinding.status).toBe(302);
      expect(noBinding.headers["location"]).toBe("/login?error=state_invalid");
      expect(sessionCookieOf(noBinding)).toBeNull();
      // (b) ...or the victim's browser has its OWN pending login (a different binding)
      const victimAuthUrl = await startLogin();
      const victimBinding = loginCookieOf.get(new URL(victimAuthUrl).searchParams.get("state")!)!;
      const otherBinding = await call(api.app, "GET", `/api/v1/auth/callback?${query}`, {
        headers: { cookie: `${victim.cookie!}; ${victimBinding}`, "x-request-id": "csrf-test-other-binding" },
      });
      expect(otherBinding.headers["location"]).toBe("/login?error=state_invalid");
      expect(sessionCookieOf(otherBinding)).toBeNull();

      // Nobody was signed in as the attacker, and the victim's session was NOT revoked (still the victim).
      expect(
        await api.db.selectFrom("user_identity").select("id").where("subject", "=", "csrf-attacker").execute(),
      ).toEqual([]);
      const me = await call<{ user: { displayName: string } }>(api.app, "GET", "/api/v1/me", {
        session: { cookie: victim.cookie!, csrf: "", userId: "" },
      });
      expect([me.status, me.body.user.displayName]).toEqual([200, "Synthetic victim"]);
      // Both refusals are audited as failed sign-ins.
      const [a] = await auditFor("csrf-test-no-binding");
      expect(a).toMatchObject({ action: "session.login_failed", record_type: "session", actor_type: "system" });
      expect(a!.reason).toMatch(/not bound to this browser/);
      const [b] = await auditFor("csrf-test-other-binding");
      expect(b!.reason).toMatch(/bound to a different browser/);

      // The refused attempts did not consume the state: the browser that started the login can still finish it.
      const own = await callback(query, attacker.state);
      expect(own.headers["location"]).toBe("/");
      expect(sessionCookieOf(own)).toMatch(/^mth_session=/);
    });

    it("sets a short-lived HttpOnly SameSite=Lax login cookie, stores only its hash, and clears it at the callback", async () => {
      const res = await call(api.app, "GET", "/api/v1/auth/login");
      const cookie = setCookies(res).find((c) => c.startsWith("mth_login="))!;
      expect(cookie).toMatch(/; Max-Age=600(;|$)/);
      expect(cookie).toMatch(/; Path=\/(;|$)/);
      expect(cookie).toMatch(/; HttpOnly(;|$)/);
      expect(cookie).toMatch(/; SameSite=Lax(;|$)/);
      const binding = cookie.split(";")[0]!.slice("mth_login=".length);
      expect(binding.length).toBeGreaterThanOrEqual(43); // 32 random bytes, base64url
      const state = new URL(String(res.headers["location"])).searchParams.get("state")!;
      const row = await api.db
        .selectFrom("oidc_login_state")
        .select("browser_binding_hash")
        .where("state_hash", "=", createHash("sha256").update(state).digest())
        .executeTakeFirstOrThrow();
      expect(row.browser_binding_hash.equals(createHash("sha256").update(binding).digest())).toBe(true);
      expect(row.browser_binding_hash.toString("utf8")).not.toContain(binding);

      const cb = await call(api.app, "GET", `/api/v1/auth/callback?error=access_denied&state=${state}`, {
        headers: { cookie: cookie.split(";")[0]! },
      });
      expect(cb.headers["location"]).toBe("/login?error=idp_denied");
      const cleared = setCookies(cb).find((c) => c.startsWith("mth_login="))!;
      expect(cleared).toMatch(/^mth_login=;/);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
    });

    it("uses the __Host- prefix and Secure on an https origin", async () => {
      const httpsApi = await startApi({
        env: {
          AUTH_MODE: "oidc",
          APP_BASE_URL: "https://hub.example.invalid",
          OIDC_ISSUER_URL: idp.issuer,
          OIDC_CLIENT_ID: idp.clientId,
          OIDC_CLIENT_SECRET: idp.clientSecret,
          DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
        },
      });
      try {
        const res = await call(httpsApi.app, "GET", "/api/v1/auth/login");
        const cookie = setCookies(res).find((c) => c.startsWith("__Host-mth_login="))!;
        expect(cookie).toBeTruthy();
        expect(cookie).toMatch(/; Secure(;|$)/);
        expect(cookie).toMatch(/; Path=\/(;|$)/);
        expect(cookie).not.toMatch(/Domain=/i);
      } finally {
        await httpsApi.close();
      }
    });
  });

  it("rejects a wrong nonce and a PKCE mismatch (token_invalid), and IdP errors (idp_denied), all without a session", async () => {
    const nonce = await completeLogin({ sub: "sub-nonce", nonce: "not-the-stored-nonce" });
    expect([nonce.cb.headers["location"], nonce.cookie]).toEqual(["/login?error=token_invalid", null]);
    const pkce = await completeLogin({ sub: "sub-pkce" }, { challengeOverride: "A".repeat(43) });
    expect([pkce.cb.headers["location"], pkce.cookie]).toEqual(["/login?error=token_invalid", null]);
    const authUrl = await startLogin();
    const state = new URL(authUrl).searchParams.get("state")!;
    const denied = await callback(`error=access_denied&state=${state}`, state);
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
