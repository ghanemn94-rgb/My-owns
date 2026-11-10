// REQ-S16-007 (ADR-0054 §1; T-DG6-DO-B): "A18;A12: e2e tests log in through the Keycloak test realm; a token from
// another realm is rejected".
//
// 1. Sign-in through realm mth-test: the hub's sign-in page -> the Keycloak login form of realm mth-test -> back in the
//    hub with a session (/api/v1/me 200, the bootstrapped synthetic user).
// 2. Another realm is refused: the hub's own authorization request (its state, nonce, PKCE challenge, client id
//    mth-hub and redirect URI, all unchanged) is answered by realm mth-other of the SAME Keycloak server, where a user
//    with the same user name and e-mail exists. Keycloak returns a code issued by mth-other; the hub's callback must
//    refuse it: /login?error=token_invalid with the translated alert, and no session (/api/v1/me 401). Whichever check
//    fires first (the authorization response's `iss`, the code at mth-test's token endpoint, or the ID token's issuer
//    and signature), a response or token of another realm never yields a session.
//    The forged-token cases (another issuer, another audience, another signing key) are proven at the API level by
//    apps/api/test/integration/identity/other-realm.test.ts (BE-G, local fake OP), which also asserts the single
//    `session.login_failed` audit event.
//
// Prerequisites and how to run: e2e/support/keycloak-login.ts. Without a Keycloak test-idp stack the tests SKIP with a
// "BLOCKED: ..." reason (never a pass). Users and credentials are SYNTHETIC; nothing here names DG0-DG7.
//
// Budget: 60 s per test (twice Playwright's default). Measured so far ONLY against a stand-in IdP, not Keycloak: the
// build sandbox has no container runtime (T-DG6-DO-B handback, Keycloak run BLOCKED). In the stand-in rehearsal
// (docs/delivery/handbacks/DG6/T-DG6-DO-B-evidence/standin/), with the real built API and SPA and host load average 17-19
// on 4 CPUs, the slowest test took 4.5 s, so 60 s is more than 13x that. Keycloak's own login pages are heavier. The
// first run against the pinned Keycloak image records its loaded worst case, and the budget stays at least 2x that
// (F-DG5-145/146/151 class).
import { expect, test } from "@playwright/test";
import { ensureLanguage, langOf, tr } from "../../apps/web/e2e/support/ui.ts";
import {
  FOREIGN_REALM,
  HUB_REALM,
  idpHostResolverArgs,
  inRealm,
  keycloakE2eConfig,
  realmPath,
  submitKeycloakLogin,
} from "../support/keycloak-login.ts";

const cfg = keycloakE2eConfig();

// Top level (launchOptions force a worker of their own, which Playwright allows only file-wide). The TEST IdP's
// throwaway CA is not in Chromium's trust store (see the support file); this file only.
if (cfg.enabled) test.use({ ignoreHTTPSErrors: true, launchOptions: { args: idpHostResolverArgs(cfg) } });

test.describe("REQ-S16-007: Keycloak test realm sign-in; another realm is refused", () => {
  test.skip(!cfg.enabled, cfg.enabled ? "" : cfg.reason);
  test.setTimeout(60_000);

  test("signs in through realm mth-test and gets a session", async ({ page }, info) => {
    if (!cfg.enabled) return;
    const lang = langOf(info);
    await page.goto("/login");
    await ensureLanguage(page, lang);
    await page.getByRole("link", { name: tr(lang, "auth.oidcButton"), exact: true }).click();
    await page.waitForURL((u) => u.origin === cfg.idpOrigin.origin && u.pathname.startsWith(realmPath(HUB_REALM)));
    await submitKeycloakLogin(page, HUB_REALM, cfg);
    await page.waitForURL((u) => u.origin !== cfg.idpOrigin.origin && !u.pathname.startsWith("/login"));
    const me = await page.request.get("/api/v1/me");
    expect(me.status()).toBe(200);
    const body = (await me.json()) as { user?: { id?: string; email?: string } };
    expect(body.user?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  test("refuses the authorization response and token of realm mth-other: token_invalid, no session", async ({
    page,
  }, info) => {
    if (!cfg.enabled) return;
    const lang = langOf(info);
    const callbacks: URL[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname === "/api/v1/auth/callback") callbacks.push(u);
    });

    await page.goto("/login");
    await ensureLanguage(page, lang);
    await page.getByRole("link", { name: tr(lang, "auth.oidcButton"), exact: true }).click();
    // The hub's own authorization request, as it reached realm mth-test (the browser now holds the hub's login cookie).
    await page.waitForURL((u) => u.origin === cfg.idpOrigin.origin && u.pathname.startsWith(realmPath(HUB_REALM)));
    // Re-address that request to the other realm; nothing else in it changes. (A route on the authorization URL would
    // not fire: Playwright does not intercept requests reached through a redirect.)
    await page.goto(inRealm(page.url(), HUB_REALM, FOREIGN_REALM));
    await submitKeycloakLogin(page, FOREIGN_REALM, cfg);

    await page.waitForURL((u) => u.pathname === "/login" && u.searchParams.get("error") === "token_invalid");
    await ensureLanguage(page, lang);
    // The callback really carried a code issued by the other realm (not an IdP error, not a missing state).
    expect(callbacks.length).toBe(1);
    expect(callbacks[0]!.searchParams.get("code")).toBeTruthy();
    expect(callbacks[0]!.searchParams.get("error")).toBeNull();
    const iss = callbacks[0]!.searchParams.get("iss");
    if (iss !== null) expect(iss).toBe(`${cfg.idpOrigin.origin}/realms/${FOREIGN_REALM}`);

    await expect(page.getByRole("alert")).toHaveText(tr(lang, "auth.errors.token_invalid"));
    expect((await page.request.get("/api/v1/me")).status()).toBe(401);
  });
});
