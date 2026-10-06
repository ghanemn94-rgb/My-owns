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
    ["RLM only (F-DG2-160)", "\u200f"],
    ["NEXT LINE only (F-DG2-160)", "\u0085"],
    ["word joiners only (F-DG2-160)", "\u2060\u2060\u2060"],
    ["Arabic letter mark only (F-DG2-160)", "\u061c"],
  ])("%s documents no exclusion", (_label, value) => {
    expect(hasExclusions(value)).toBe(false);
  });

  it.each([["Enterprise fixed-line products"], ["  B2B roaming  "], ["-"], ["\u200fقطاع الشركات\u200f"]])(
    "%j documents an exclusion",
    (value) => {
      expect(hasExclusions(value)).toBe(true);
    },
  );
});

describe("one shared free-text presence test (T-DG2-BE5)", () => {
  it.each([null, "", "   ", "\t\n", " ", "x", "  B2B  "])("hasExclusions(%j) equals hasText", (value) => {
    expect(hasExclusions(value)).toBe(hasText(value));
  });
});
