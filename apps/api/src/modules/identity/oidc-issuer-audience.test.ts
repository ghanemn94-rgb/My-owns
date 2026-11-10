// P6 slice C (T-DG6-BE-G; ADR-0054 §1; REQ-S16-007): the explicit post-validation issuer and audience check of the
// ID-token claims. Unit only; the end-to-end refusals through the callback are in
// test/integration/identity/other-realm.test.ts, the settings read model in admin/identity.test.ts. Synthetic values.
import { describe, expect, it } from "vitest";
import { assertIssuerAndAudience, IdTokenRejected } from "./oidc.ts";

const ISSUER = "https://idp.example.invalid/realms/mth-test";
const CLIENT = "mth-hub";
const expected = { issuer: ISSUER, clientId: CLIENT };

function rule(claims: Record<string, unknown>): string | null {
  try {
    assertIssuerAndAudience(claims, expected);
    return null;
  } catch (err) {
    expect(err).toBeInstanceOf(IdTokenRejected);
    return (err as IdTokenRejected).rule;
  }
}

describe("assertIssuerAndAudience (ADR-0054 §1)", () => {
  it("accepts the configured issuer with the client id as the audience, a string or a one-value array", () => {
    expect(rule({ iss: ISSUER, aud: CLIENT })).toBeNull();
    expect(rule({ iss: ISSUER, aud: [CLIENT] })).toBeNull();
    expect(rule({ iss: ISSUER, aud: [CLIENT, "other"], azp: CLIENT })).toBeNull();
  });

  it("refuses any other issuer, compared exactly (another realm, a trailing slash, case, missing)", () => {
    for (const iss of [
      "https://idp.example.invalid/realms/mth-other",
      `${ISSUER}/`,
      ISSUER.toUpperCase(),
      ` ${ISSUER}`,
      undefined,
      42,
    ]) {
      expect(rule({ iss, aud: CLIENT }), String(iss)).toBe("issuer");
    }
  });

  it("refuses an audience that does not contain the client id, or is malformed", () => {
    for (const aud of ["other", ["other"], [], undefined, null, 7, [CLIENT, 7], "MTH-HUB", `${CLIENT} `]) {
      expect(rule({ iss: ISSUER, aud }), JSON.stringify(aud)).toBe("audience");
    }
  });

  it("refuses several audiences unless azp equals the client id", () => {
    expect(rule({ iss: ISSUER, aud: [CLIENT, "other"] })).toBe("authorized_party");
    expect(rule({ iss: ISSUER, aud: [CLIENT, "other"], azp: "other" })).toBe("authorized_party");
  });

  it("never puts a claim value in the error message (the callback logs it)", () => {
    try {
      assertIssuerAndAudience({ iss: "https://secret-issuer.invalid", aud: "secret-aud" }, expected);
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toMatch(/secret|invalid|mth/);
    }
  });
});
