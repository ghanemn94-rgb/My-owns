// Source coverage constants (ADR-0039 §6; REQ-S02-001, M0083; T-DG5-BE-B2): the report's sets and expected counts.
// The behaviour against a real PostgreSQL is in test/integration/methodology/source-coverage.test.ts.
import { SOURCE_SET_CODES } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { EXPECTED_SOURCE_COUNTS } from "./source-coverage.ts";

describe("source coverage expected counts (REQ-S02-001)", () => {
  it("covers the ten contract sets in report order with M0083's counts (2/6/6/16/10/5/6/3/1/25 = 80)", () => {
    expect(EXPECTED_SOURCE_COUNTS.map(([set]) => set)).toEqual([...SOURCE_SET_CODES]);
    expect(EXPECTED_SOURCE_COUNTS.map(([, n]) => n)).toEqual([2, 6, 6, 16, 10, 5, 6, 3, 1, 25]);
    expect(EXPECTED_SOURCE_COUNTS.reduce((sum, [, n]) => sum + n, 0)).toBe(80);
    expect(EXPECTED_SOURCE_COUNTS.every(([, n]) => Number.isInteger(n))).toBe(true);
  });
});
