// F-DG2-231 / F-DG2-260 (T-DG2-BE11): pure checks of the ID-token claim values the server stores. A claim with U+0000
// or a lone UTF-16 surrogate cannot be stored faithfully; identifying claims also have to fit their columns. Unit only.
import { describe, expect, it } from "vitest";
import { displayNameCandidate, identityClaimsStorable } from "./oidc.ts";

const ISS = "https://idp.example.invalid/realms/synthetic";

describe("identityClaimsStorable (F-DG2-231, F-DG2-260)", () => {
  it("refuses an issuer or subject with U+0000 or a lone surrogate", () => {
    for (const bad of ["a\u0000b", "a\uD800", "\uDC00b", "\uD800\uD800", "x\uDFFF"]) {
      expect(identityClaimsStorable({ iss: ISS, sub: bad }), JSON.stringify(bad)).toBe(false);
      expect(identityClaimsStorable({ iss: `${ISS}${bad}`, sub: "s" }), JSON.stringify(bad)).toBe(false);
    }
  });

  it("refuses an empty value or one longer than its column (issuer 512, subject 255 code points)", () => {
    expect(identityClaimsStorable({ iss: ISS, sub: "" })).toBe(false);
    expect(identityClaimsStorable({ iss: "", sub: "s" })).toBe(false);
    expect(identityClaimsStorable({ iss: ISS, sub: "s".repeat(256) })).toBe(false);
    expect(identityClaimsStorable({ iss: "i".repeat(513), sub: "s" })).toBe(false);
    expect(identityClaimsStorable({ iss: ISS, sub: "s".repeat(255) })).toBe(true);
    expect(identityClaimsStorable({ iss: "i".repeat(512), sub: "s" })).toBe(true);
  });

  it("counts code points, not UTF-16 units: 255 emoji fit, and emoji or Arabic subjects are accepted", () => {
    expect(identityClaimsStorable({ iss: ISS, sub: "\u{1F600}".repeat(255) })).toBe(true);
    expect(identityClaimsStorable({ iss: ISS, sub: "\u{1F600}".repeat(256) })).toBe(false);
    expect(identityClaimsStorable({ iss: ISS, sub: "مستخدم-1" })).toBe(true);
  });
});

describe("displayNameCandidate (F-DG2-231, F-DG2-260)", () => {
  it("treats a value with U+0000 or a lone surrogate as absent (never stored as U+FFFD)", () => {
    for (const bad of ["Synthetic\u0000Name", "Synthetic\uD800Name", "\uDC00Synthetic", "Name\uDBFF"])
      expect(displayNameCandidate(bad), JSON.stringify(bad)).toBeNull();
  });

  it("keeps emoji and Arabic verbatim, and never splits a pair at the 200 code-point limit", () => {
    expect(displayNameCandidate("مستخدم \u{1F600}")).toBe("مستخدم \u{1F600}");
    const cut = displayNameCandidate(`${"a".repeat(199)}\u{1F600}\u{1F600}`);
    expect(cut).toBe(`${"a".repeat(199)}\u{1F600}`);
  });
});
