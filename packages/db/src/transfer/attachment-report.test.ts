// T-R8 (unit part; ADR-0064 Amendment 1 §A1.8; p7-work-split §C.12): the reader of `mth-attachment-verify/1` refuses,
// with each A1.8 line, a report that is not exactly the canonical format, that belongs to another package or that
// checked another count; a package with attachments and no report is refused, never counted as 0. Three mismatches come
// back as three entries with the same fields in order. Synthetic values only.
import { describe, expect, it } from "vitest";
import {
  AttachmentReportRefused,
  parseAttachmentReport,
  requireAttachmentReport,
  type ReportCommand,
} from "./attachment-report.ts";

const SHA = "a".repeat(64);
const OTHER = "b".repeat(64);
const mismatches = [
  {
    parentTable: "evidence_content",
    objectName: "evidence/1",
    problem: "missing",
    expectedSize: "10",
    actualSize: null,
    expectedSha256: "c".repeat(64),
    actualSha256: null,
  },
  {
    parentTable: "evidence_content",
    objectName: "evidence/2",
    problem: "size_mismatch",
    expectedSize: "20",
    actualSize: "21",
    expectedSha256: "d".repeat(64),
    actualSha256: "e".repeat(64),
  },
  {
    parentTable: "evidence_content",
    objectName: "evidence/3",
    problem: "sha256_mismatch",
    expectedSize: "30",
    actualSize: "30",
    expectedSha256: "f".repeat(64),
    actualSha256: "0".repeat(64),
  },
];
const report = (over: Record<string, unknown> = {}) => ({
  schemaVersion: "mth-attachment-verify/1",
  attachmentManifestSha256: SHA,
  checked: 3,
  result: "mismatched",
  mismatches,
  ...over,
});
const bytes = (v: unknown) => new TextEncoder().encode(`${JSON.stringify(v)}\n`);
const refusal = (b: Uint8Array, count = 3, cmd: ReportCommand = "import-migration"): string => {
  try {
    parseAttachmentReport(b, { attachmentManifestSha256: SHA, count }, cmd);
  } catch (err) {
    expect(err).toBeInstanceOf(AttachmentReportRefused);
    return (err as Error).message;
  }
  return "accepted";
};

describe("parseAttachmentReport (A1.8)", () => {
  it("returns the three mismatches with the same fields in order", () => {
    const r = parseAttachmentReport(bytes(report()), { attachmentManifestSha256: SHA, count: 3 });
    expect(r.checked).toBe(3);
    expect(r.mismatches).toEqual(mismatches);
  });

  it("accepts a matched report with no mismatch", () => {
    const r = parseAttachmentReport(bytes(report({ result: "matched", mismatches: [] })), {
      attachmentManifestSha256: SHA,
      count: 3,
    });
    expect(r.mismatches).toEqual([]);
  });

  it("refuses an invalid report with the A1.8 line, for both commands", () => {
    const invalid = /^import-migration: refused: invalid attachment report: .+$/;
    expect(refusal(new Uint8Array([0xff, 0xfe]))).toMatch(invalid);
    expect(refusal(new TextEncoder().encode("not json\n"))).toMatch(invalid);
    expect(refusal(bytes(report({ schemaVersion: "mth-attachment-verify/2" })))).toMatch(invalid);
    expect(refusal(bytes({ ...report(), extra: 1 }))).toMatch(invalid);
    expect(refusal(bytes(report({ result: "matched" })))).toMatch(invalid);
    expect(refusal(bytes(report({ checked: "3" })))).toMatch(invalid);
    expect(refusal(bytes(report({ mismatches: [{ ...mismatches[0], actualSize: "1" }] })))).toMatch(invalid);
    expect(refusal(bytes(report({ mismatches: [{ ...mismatches[1], expectedSize: 20 }] })))).toMatch(invalid);
    expect(refusal(new TextEncoder().encode(`${JSON.stringify(report(), null, 2)}\n`))).toMatch(invalid);
    expect(refusal(new TextEncoder().encode(JSON.stringify(report())))).toMatch(invalid);
    expect(refusal(new Uint8Array([0xff]), 3, "reconcile-migration")).toMatch(
      /^reconcile-migration: refused: invalid attachment report: /,
    );
  });

  it("refuses a report of another package, and one that checked another count", () => {
    expect(refusal(bytes(report({ attachmentManifestSha256: OTHER })))).toBe(
      `import-migration: refused: the attachment report belongs to another package (${OTHER}, the import recorded ${SHA})`,
    );
    expect(refusal(bytes(report()), 4)).toBe(
      "import-migration: refused: the attachment report checked 3 of 4 attachments",
    );
  });

  it("refuses a package with attachments and no report; one without attachments needs none", () => {
    expect(() => requireAttachmentReport(2, false, "reconcile-migration")).toThrow(
      "reconcile-migration: refused: the package lists 2 attachments; give --attachments-report <file> written by transfer-attachments verify",
    );
    expect(() => requireAttachmentReport(0, false, "import-migration")).not.toThrow();
    expect(() => requireAttachmentReport(2, true, "import-migration")).not.toThrow();
  });
});
