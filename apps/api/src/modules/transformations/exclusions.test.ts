// Unit test: "Are explicit exclusions documented?" (B0041, REQ-PB-031 A01; F-DG2-150). On a saved charter an empty,
// null or whitespace-only Out of scope documents no exclusion, so the pre-check fails (`attention`) and the G1
// "initial charter" criterion lacks its scope out; only a non-blank text counts. The full pre-check is exercised
// against PostgreSQL in test/integration/registers.test.ts.
import { describe, expect, it } from "vitest";
import { hasText } from "@mth/shared/schemas";
import { hasExclusions } from "./charter.ts";

describe("hasExclusions (F-DG2-150)", () => {
  it.each([
    ["null (never set or cleared)", null],
    ["empty", ""],
    ["spaces", "   "],
    ["tabs and line breaks", "\t\n \r\n"],
  ])("%s documents no exclusion", (_label, value) => {
    expect(hasExclusions(value)).toBe(false);
  });

  it.each([["Enterprise fixed-line products"], ["  B2B roaming  "], ["-"]])("%j documents an exclusion", (value) => {
    expect(hasExclusions(value)).toBe(true);
  });
});

describe("one shared free-text presence test (T-DG2-BE5)", () => {
  it.each([null, "", "   ", "\t\n", " ", "x", "  B2B  "])("hasExclusions(%j) equals hasText", (value) => {
    expect(hasExclusions(value)).toBe(hasText(value));
  });
});
