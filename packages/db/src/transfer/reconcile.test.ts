// Unit tests of the reconciliation report rule and its C.5 lines (ADR-0064 §6 step 8; 0133
// migration_reconciliation_result; T-DG7-BE-D). The live comparison runs on PostgreSQL in
// packages/db/test/integration/transfer-roundtrip.test.ts.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildReport, EMPTY_DIGEST, reconcileLine, type TableResult } from "./reconcile.ts";

const d = (s: string) => createHash("sha256").update(s).digest("hex");
const table = (name: string, expected: string, actual: string, same = true): TableResult => ({
  tableName: name,
  expectedRows: expected,
  actualRows: actual,
  expectedDigest: d(name),
  actualDigest: same ? d(name) : d(`${name}*`),
  matched: expected === actual && same,
});

describe("buildReport", () => {
  it("matches only when every table and attachment matches; sums are exact decimal strings", () => {
    const big = "9007199254740993"; // above 2^53: summed as bigint, never a float
    const ok = buildReport([table("a", big, big), table("b", "1", "1")], 2, []);
    expect(ok).toMatchObject({ result: "matched", tablesMismatched: 0, rowsExpected: "9007199254740994" });
    expect(reconcileLine(ok)).toBe("reconcile-migration: matched");
  });
  it("a differing digest with equal counts is a mismatch, never hidden", () => {
    const r = buildReport([table("a", "3", "3", false), table("b", "1", "1")], 0, []);
    expect(r).toMatchObject({ result: "mismatched", tablesMismatched: 1, rowsExpected: "4", rowsActual: "4" });
    expect(reconcileLine(r)).toBe("reconcile-migration: mismatch: 1 tables, 0 attachments differ");
  });
  it("an attachment mismatch alone makes the run mismatched", () => {
    const r = buildReport([table("a", "1", "1")], 1, [
      {
        parentTable: "evidence_content",
        objectName: "o",
        problem: "missing",
        expectedSize: "3",
        actualSize: null,
        expectedSha256: d("x"),
        actualSha256: null,
      },
    ]);
    expect(reconcileLine(r)).toBe("reconcile-migration: mismatch: 0 tables, 1 attachments differ");
  });
  it("EMPTY_DIGEST is the SHA-256 of no line", () => {
    expect(EMPTY_DIGEST).toBe(d(""));
  });
});
