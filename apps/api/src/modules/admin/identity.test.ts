// P6 slice C (T-DG6-BE-G; ADR-0054 §1; REQ-S16-007): the Administration > Identity read model (getIdentitySettings).
// Unit only; the route, its authorization and the client-secret canary through HTTP are in
// test/integration/identity/other-realm.test.ts. Every value is synthetic.
import { loadConfig } from "@mth/config";
import { describe, expect, it } from "vitest";
import { identitySettings, identitySettingsOf } from "./identity.ts";

const ISSUER = "https://idp.example.invalid/realms/mth-test";
const CLIENT = "mth-hub";

describe("identitySettingsOf (getIdentitySettings)", () => {
  const base = { NODE_ENV: "test", APP_BASE_URL: "http://localhost:5173", DATABASE_URL: "postgres://u@h/db" };

  it("in OIDC mode reports the effective values and only whether a secret is configured", () => {
    const canary = `canary-${Math.random().toString(36).slice(2)}`;
    const config = loadConfig("api", {
      ...base,
      AUTH_MODE: "oidc",
      OIDC_ISSUER_URL: ISSUER,
      OIDC_CLIENT_ID: CLIENT,
      OIDC_CLIENT_SECRET: canary,
      OIDC_SCOPES: "openid  email",
    });
    const settings = identitySettings.parse(identitySettingsOf(config));
    expect(settings).toMatchObject({
      authMode: "oidc",
      issuer: ISSUER,
      clientId: CLIENT,
      expectedAudience: CLIENT,
      clientSecretConfigured: true,
      scopes: ["openid", "email"],
      pkceMethod: "S256",
    });
    expect(JSON.stringify(settings)).not.toContain(canary);
  });

  it("in dev mode without OIDC reports no issuer, client, audience or PKCE method (never invented values)", () => {
    const settings = identitySettings.parse(identitySettingsOf(loadConfig("api", { ...base, AUTH_MODE: "dev" })));
    expect(settings).toEqual({
      authMode: "dev",
      issuer: null,
      clientId: null,
      clientSecretConfigured: false,
      scopes: [],
      expectedAudience: null,
      pkceMethod: null,
      claimMapping: { subject: "sub", email: "email", displayName: "name" },
      samlBrokerDocument: "docs/operations/identity-saml-broker.md",
    });
  });
});
