// T-R10 (p7-work-split §C.12; D-258 item 2): `secureIssuerAllowed` drives the OIDC client's `allowHttp`. In production a
// plain-http issuer is used only on a loopback host (a drill IdP on the same machine); https never needs it; outside
// production any http issuer does. Unit only, on the constructor; the loader's refusal is in packages/config's
// load.test.ts. Synthetic values.
import type { AppConfig } from "@mth/config";
import { describe, expect, it } from "vitest";
import { OidcService } from "./oidc.ts";

function allowHttpFor(issuer: string, nodeEnv: string): boolean {
  const config = {
    nodeEnv,
    appBaseUrl: new URL("https://hub.example.test"),
    oidc: { issuerUrl: new URL(issuer), clientId: "mth", clientSecret: "s", scopes: "openid" },
  } as unknown as AppConfig;
  return (new OidcService(config) as unknown as { allowHttp: boolean }).allowHttp;
}

describe("OidcService allowHttp (T-R10)", () => {
  it("production: true only for a plain-http loopback issuer", () => {
    expect(allowHttpFor("http://127.0.0.1:28080/realms/drill", "production")).toBe(true);
    expect(allowHttpFor("http://localhost:28080/realms/drill", "production")).toBe(true);
    expect(allowHttpFor("http://[::1]:28080/realms/drill", "production")).toBe(true);
    expect(allowHttpFor("http://idp.example.test/realms/mth", "production")).toBe(false);
    expect(allowHttpFor("https://idp.example.test/realms/mth", "production")).toBe(false);
  });

  it("outside production: true for any plain-http issuer, false for https", () => {
    expect(allowHttpFor("http://idp.example.test/realms/mth", "development")).toBe(true);
    expect(allowHttpFor("https://idp.example.test/realms/mth", "test")).toBe(false);
  });
});
