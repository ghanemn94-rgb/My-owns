// code-security-reviewer DG1 round 2 — re-test of F-DG1-103 (OIDC login CSRF) against the repaired candidate.
// NOT part of the candidate. Run by copying into a DISPOSABLE clone at apps/api/test/integration/ and executing
//   TEST_DATABASE_ADMIN_URL=... npx vitest run --project integration apps/api/test/integration/repro-oidc-login-csrf-r2.test.ts
// Same attack as round 1 (attacker's callback URL opened in the victim's browser), now asserting the SECURE outcome,
// plus: a cookie/state swap between two pending logins, a forged cookie, and a replay of a completed callback.
import { afterAll, beforeAll, expect, it } from "vitest";
import { migrate } from "../../../../packages/db/src/migrate.ts";
import { createScratchDatabase, dropScratchDatabase, roleUrl, testDatabase } from "../../../../packages/db/test/helpers.ts";
import { FakeIdp } from "../support/fake-idp.ts";
import { call, createOrg, startApi, type TestApi } from "../support/harness.ts";

const { adminUrl } = testDatabase();
let dbName: string;
let idp: FakeIdp;
let api: TestApi;

beforeAll(async () => {
  dbName = await createScratchDatabase(adminUrl, "mth_csrfrepro2");
  await migrate(roleUrl(adminUrl, dbName, "mth_owner"));
  idp = await new FakeIdp().start();
  api = await startApi({
    env: {
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: idp.issuer,
      OIDC_CLIENT_ID: idp.clientId,
      OIDC_CLIENT_SECRET: idp.clientSecret,
      DATABASE_URL: roleUrl(adminUrl, dbName, "mth_app"),
    },
  });
  await createOrg(api.db, "CSRFORG2");
});
afterAll(async () => {
  await api.close();
  await idp.stop();
  await dropScratchDatabase(adminUrl, dbName);
});

const setCookies = (h: unknown): string[] => (h == null ? [] : Array.isArray(h) ? h.map(String) : [String(h)]);
const pair = (c: string | undefined) => (c ? c.split(";")[0]! : "");

async function startLogin(sub: string) {
  const start = await call(api.app, "GET", "/api/v1/auth/login");
  const loginCookieFull = setCookies(start.headers["set-cookie"]).find((c) => /^(__Host-)?mth_login=/.test(c));
  const { code, state } = idp.issueCode(String(start.headers["location"]), {
    sub,
    email: `${sub}@example.test`,
    email_verified: true,
    name: sub,
  });
  return { code, state, loginCookieFull, loginCookie: pair(loginCookieFull) };
}
const sessionCookieOf = (h: unknown) => pair(setCookies(h).find((c) => /^(__Host-)?mth_session=/.test(c)));
const cb = (code: string, state: string, cookie?: string) =>
  call(api.app, "GET", `/api/v1/auth/callback?code=${code}&state=${state}`, cookie ? { headers: { cookie } } : {});
const me = (cookie: string) => call<{ user: { displayName: string } }>(api.app, "GET", "/api/v1/me", { headers: { cookie } });

it("R2-1: the login cookie is HttpOnly, SameSite=Lax, Path=/ and short-lived", async () => {
  const s = await startLogin("attr-sub");
  console.log("[r2] /auth/login Set-Cookie:", s.loginCookieFull);
  expect(s.loginCookieFull).toMatch(/HttpOnly/i);
  expect(s.loginCookieFull).toMatch(/SameSite=Lax/i);
  expect(s.loginCookieFull).toMatch(/Path=\//);
  expect(s.loginCookieFull).toMatch(/Max-Age=600/);
});

it("R2-2: the round-1 attack is refused: the victim's browser stays signed in as the victim, nothing is consumed", async () => {
  const v = await startLogin("victim-sub");
  const vcb = await cb(v.code, v.state, v.loginCookie);
  const victimSession = sessionCookieOf(vcb.headers["set-cookie"]);
  expect((await me(victimSession)).body.user.displayName).toBe("victim-sub");

  const a = await startLogin("attacker-sub"); // attacker's browser; attacker authenticates at the IdP and stops
  // (a) victim's browser: own session, no login cookie
  const h1 = await cb(a.code, a.state, victimSession);
  console.log("[r2] victim-browser callback:", h1.status, h1.headers["location"], "set-cookie:", setCookies(h1.headers["set-cookie"]));
  expect(h1.status).toBe(302);
  expect(String(h1.headers["location"])).toBe("/login?error=state_invalid");
  expect(sessionCookieOf(h1.headers["set-cookie"])).toBe("");
  expect((await me(victimSession)).body.user.displayName).toBe("victim-sub");

  // (b) victim's browser with a forged login cookie value
  const h2 = await cb(a.code, a.state, `${victimSession}; mth_login=${"A".repeat(43)}`);
  expect(String(h2.headers["location"])).toBe("/login?error=state_invalid");

  // (c) the attacker's state was not burned: the attacker's own browser can still finish (proves "not consumed")
  const own = await cb(a.code, a.state, a.loginCookie);
  expect(own.status).toBe(302);
  expect(sessionCookieOf(own.headers["set-cookie"])).not.toBe("");

  const audits = await api.db
    .selectFrom("audit_event")
    .select(["action", "reason"])
    .where("action", "=", "session.login_failed")
    .execute();
  console.log("[r2] login_failed audit reasons:", audits.map((x) => x.reason));
  expect(audits.some((x) => /not bound to this browser/.test(String(x.reason)))).toBe(true);
  expect(audits.some((x) => /different browser/.test(String(x.reason)))).toBe(true);
});

it("R2-3: a cookie/state swap between two pending logins is refused", async () => {
  const one = await startLogin("swap-one");
  const two = await startLogin("swap-two");
  const r = await cb(one.code, one.state, two.loginCookie);
  expect(String(r.headers["location"])).toBe("/login?error=state_invalid");
  expect(sessionCookieOf(r.headers["set-cookie"])).toBe("");
});

it("R2-4: a completed callback cannot be replayed, even with the original cookie", async () => {
  const s = await startLogin("replay-sub");
  const first = await cb(s.code, s.state, s.loginCookie);
  expect(sessionCookieOf(first.headers["set-cookie"])).not.toBe("");
  const again = await cb(s.code, s.state, s.loginCookie);
  expect(String(again.headers["location"])).toBe("/login?error=state_invalid");
  expect(sessionCookieOf(again.headers["set-cookie"])).toBe("");
});
