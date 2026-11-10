// Keycloak TEST-realm login helpers for e2e/identity/keycloak-login.spec.ts (T-DG6-DO-B; ADR-0054 §1; REQ-S16-007).
//
// What runs where. The spec needs a container runtime: the Compose stack with profile `test-idp` (Keycloak
// quay.io/keycloak/keycloak:26.8.1 pinned by digest in deploy/images.lock.json, realms mth-test and mth-other from
// deploy/keycloak/) and the API in AUTH_MODE=oidc against realm mth-test. Where no container runtime exists (the build
// sandbox: `docker info` cannot reach a daemon), the spec SKIPS with the reason below, and that is reported as BLOCKED,
// never as a pass. The cross-realm rejection is then proven by the API integration test
// apps/api/test/integration/identity/other-realm.test.ts (BE-G, the local fake OP).
//
// Running it (a host with Docker; every user and credential is SYNTHETIC):
//   deploy/scripts/init-secrets.sh                  # random secrets OUTSIDE the repository; writes deploy/compose/.env
//   deploy/scripts/build-image.sh                   # mth-app:local
//   docker compose -f deploy/compose/compose.yaml --profile test-idp up -d --wait
//   docker compose -f deploy/compose/compose.yaml run --rm -T migrate db bootstrap --org-code MTH-E2E \
//     --org-name-en "E2E org (synthetic)" --org-name-ar "مؤسسة الاختبار (اصطناعية)" \
//     --admin-name "Synthetic Access Admin" --admin-email smoke.admin@example.invalid \
//     --admin-issuer https://keycloak:8443/realms/mth-test --admin-subject 5f0c7a52-1d1e-4c9a-9a51-6a0d0e5a0001
//   MTH_E2E_KEYCLOAK=1 MTH_E2E_KEYCLOAK_PASSWORD_FILE="$MTH_SECRETS_DIR/test_idp_user_password" \
//     E2E_BASE_URL=http://localhost:3000 pnpm exec playwright test e2e/identity/keycloak-login.spec.ts
//
// Environment (all optional except the two that enable it):
//   MTH_E2E_KEYCLOAK=1                     enables the spec (otherwise it is skipped as BLOCKED)
//   MTH_E2E_KEYCLOAK_PASSWORD_FILE         file holding the synthetic users' password (never an environment value)
//   MTH_E2E_KEYCLOAK_URL                   the IdP origin the API and the browser use (default https://keycloak:8443,
//                                          Compose's KC_HOSTNAME); the host name is mapped to 127.0.0.1 in Chromium
//   MTH_E2E_KEYCLOAK_HOST_PORT             the published host port (default $MTH_TEST_IDP_PORT, else 8443)
//   MTH_E2E_KEYCLOAK_USER                  the mth-test user bound by the bootstrap (default smoke.admin)
//
// TLS: the TEST IdP's certificate chains to the throwaway CA of init-secrets.sh, which Chromium does not trust, so the
// spec sets ignoreHTTPSErrors for this spec only. The API itself validates the IdP with NODE_EXTRA_CA_CERTS. No
// production path relaxes TLS.
import { existsSync, readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";

/** The realm the hub is configured for (deploy/keycloak/realm-mth-test.json). */
export const HUB_REALM = "mth-test";
/** The SYNTHETIC foreign realm whose responses and tokens the hub must refuse (deploy/keycloak/realm-mth-other.json). */
export const FOREIGN_REALM = "mth-other";

export type KeycloakE2eConfig =
  | { enabled: false; reason: string }
  | {
      enabled: true;
      /** Origin the IdP announces (KC_HOSTNAME), e.g. https://keycloak:8443. */
      idpOrigin: URL;
      /** Host port on 127.0.0.1 that the IdP host name is mapped to inside Chromium. */
      hostPort: number;
      username: string;
      password: string;
    };

/** Reads the spec's configuration; a missing prerequisite yields a BLOCKED reason, never a default credential. */
export function keycloakE2eConfig(env: NodeJS.ProcessEnv = process.env): KeycloakE2eConfig {
  if (env["MTH_E2E_KEYCLOAK"] !== "1")
    return {
      enabled: false,
      reason:
        "BLOCKED: no Keycloak test-idp stack configured (MTH_E2E_KEYCLOAK is not 1). The Keycloak e2e needs a container " +
        "runtime with the Compose profile test-idp; the cross-realm rejection is proven by " +
        "apps/api/test/integration/identity/other-realm.test.ts.",
    };
  const file = env["MTH_E2E_KEYCLOAK_PASSWORD_FILE"];
  if (!file || !existsSync(file))
    return {
      enabled: false,
      reason: "BLOCKED: MTH_E2E_KEYCLOAK_PASSWORD_FILE does not name a readable file (deploy/scripts/init-secrets.sh)",
    };
  const password = readFileSync(file, "utf8").replace(/\r?\n$/, "");
  if (password === "") return { enabled: false, reason: "BLOCKED: the synthetic users' password file is empty" };
  const idpOrigin = new URL(env["MTH_E2E_KEYCLOAK_URL"] ?? "https://keycloak:8443");
  const hostPort = Number(env["MTH_E2E_KEYCLOAK_HOST_PORT"] ?? env["MTH_TEST_IDP_PORT"] ?? 8443);
  if (!Number.isInteger(hostPort) || hostPort < 1 || hostPort > 65535)
    return { enabled: false, reason: `BLOCKED: MTH_E2E_KEYCLOAK_HOST_PORT is not a port (${String(hostPort)})` };
  return {
    enabled: true,
    idpOrigin,
    hostPort,
    username: env["MTH_E2E_KEYCLOAK_USER"] ?? "smoke.admin",
    password,
  };
}

/**
 * Chromium launch arguments that resolve the IdP host name (a Compose service name) to the published port on the
 * loopback interface, so the browser follows exactly the redirects the API issues.
 */
export function idpHostResolverArgs(cfg: { idpOrigin: URL; hostPort: number }): string[] {
  return [`--host-resolver-rules=MAP ${cfg.idpOrigin.hostname} 127.0.0.1:${cfg.hostPort}`];
}

/** The path prefix of a realm's endpoints on the IdP. */
export const realmPath = (realm: string) => `/realms/${realm}/`;

/** The same authorization request, addressed to another realm of the same server (every parameter unchanged). */
export function inRealm(authorizationUrl: string, fromRealm: string, toRealm: string): string {
  const u = new URL(authorizationUrl);
  const from = `/realms/${fromRealm}/`;
  if (!u.pathname.startsWith(from)) throw new Error(`not an authorization URL of realm ${fromRealm}: ${u.pathname}`);
  u.pathname = `/realms/${toRealm}/${u.pathname.slice(from.length)}`;
  return u.toString();
}

/**
 * Fills and submits the Keycloak login form (theme ids `kc-form-login`, `username`, `password`, `kc-login`, stable in
 * the keycloak.v2 login theme of 26.x). Asserts the form belongs to the expected realm before typing a credential.
 */
export async function submitKeycloakLogin(
  page: Page,
  realm: string,
  user: { username: string; password: string },
): Promise<void> {
  await expect(page.locator("#kc-form-login")).toBeVisible();
  expect(new URL(page.url()).pathname.startsWith(realmPath(realm)), `login form of realm ${realm}: ${page.url()}`).toBe(
    true,
  );
  await page.locator("#username").fill(user.username);
  await page.locator("#password").fill(user.password);
  await page.locator("#kc-login").click();
}
