// CSV import parser limits and syntax (ADR-0056 §3; p6-work-split §B/A.3 tests; T-DG6-BE-M).
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../../../platform/index.ts";
import { parseCsv } from "./csv.ts";

/**
 * Budget of the tests that build or parse files near the limits (10 MiB, 5,000 rows, 20-51 MiB containers): the
 * loaded worst case measured in a full parallel `pnpm test` was 5.96 s (the 10 MiB CSV, before the chunked scan); the
 * budget is about 5x that (F-DG4-143..148: deterministic under load).
 */
const LARGE_INPUT = { timeout: 30_000 };

const enc = (s: string) => new TextEncoder().encode(s);

function refusal(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

describe("parseCsv: RFC 4180 (ADR-0056 §3)", () => {
  it("reads the header (row 1) and the data rows as text; an empty cell is null", () => {
    const sheet = parseCsv(enc("source_record_id,value,comment\r\nr-1,12.5,\r\nr-2,,note\r\n"));
    expect(sheet.header).toEqual(["source_record_id", "value", "comment"]);
    expect(sheet.rows).toEqual([
      { rowNumber: 2, values: ["r-1", "12.5", null], formulaIndexes: [] },
      { rowNumber: 3, values: ["r-2", null, "note"], formulaIndexes: [] },
    ]);
  });

  it("keeps quoted commas, quoted line breaks and doubled quotes in one cell", () => {
    const sheet = parseCsv(enc('a,b,c\n"x, y","line 1\nline 2","say ""hi"""\nnext,2,3\n'));
    expect(sheet.rows[0]!.values).toEqual(["x, y", "line 1\nline 2", 'say "hi"']);
    // The quoted line break does not start a new row: the next record is source row 3.
    expect(sheet.rows[1]).toEqual({ rowNumber: 3, values: ["next", "2", "3"], formulaIndexes: [] });
  });

  it("keeps a quoted empty string apart from an empty cell; a record of empty cells only is blank", () => {
    expect(parseCsv(enc('a,b,c\n"",,x\n')).rows[0]!.values).toEqual(["", null, "x"]);
    expect(parseCsv(enc('a,b\n"",\n')).rows).toEqual([]);
  });

  it("removes a UTF-8 byte-order mark", () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...enc("source_record_id,value\nr-1,1\n")]);
    expect(parseCsv(bom).header).toEqual(["source_record_id", "value"]);
  });

  it("reads a last line without a line break, LF and CRLF line ends alike", () => {
    expect(parseCsv(enc("a,b\n1,2")).rows[0]!.values).toEqual(["1", "2"]);
    expect(parseCsv(enc("a,b\r\n1,2\r\n3,4")).rows.map((r) => r.values)).toEqual([
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("skips blank records and keeps the source row numbers", () => {
    const sheet = parseCsv(enc("a,b\n1,2\n\n,\n3,4\n"));
    expect(sheet.rows.map((r) => r.rowNumber)).toEqual([2, 5]);
  });

  it("keeps formula-like text as text (D-195 Q11), and never converts a number", () => {
    const sheet = parseCsv(enc("a,b,c,d,e\n=SUM(A1),+1,-2,@x,0012.50\n"));
    expect(sheet.rows[0]!.values).toEqual(["=SUM(A1)", "+1", "-2", "@x", "0012.50"]);
    expect(sheet.rows[0]!.formulaIndexes).toEqual([]);
  });

  it("keeps Arabic text and astral characters", () => {
    expect(parseCsv(enc("a,b\nمؤشر,😀\n")).rows[0]!.values).toEqual(["مؤشر", "😀"]);
  });

  it("has an empty header for an empty file", () => {
    expect(parseCsv(enc("")).header).toEqual([]);
  });
});

describe("parseCsv: refusals (ADR-0056 §3, §9)", () => {
  it("refuses text that is not UTF-8 with 422 import.csv_not_utf8", () => {
    // Windows-1256 "مؤشر" (bytes that are not valid UTF-8).
    const cp1256 = new Uint8Array([...enc("a,b\n"), 0xe3, 0xc4, 0xd4, 0xd1, 0x2c, 0x31, 0x0a]);
    expect(refusal(() => parseCsv(cp1256))).toEqual({ status: 422, code: "import.csv_not_utf8" });
    // A UTF-16 file (with its BOM) is refused too: its NUL bytes make it binary content (415).
    const utf16 = new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x2c, 0x00, 0x62, 0x00]);
    expect(refusal(() => parseCsv(utf16))).toEqual({ status: 415, code: "import.unsupported_media_type" });
    // A lone invalid byte without NULs is the encoding refusal.
    expect(refusal(() => parseCsv(new Uint8Array([0x61, 0x2c, 0xff, 0x0a])))).toEqual({
      status: 422,
      code: "import.csv_not_utf8",
    });
  });

  it("refuses binary content (a NUL byte, a ZIP container) with 415 import.unsupported_media_type", () => {
    expect(refusal(() => parseCsv(new Uint8Array([0x61, 0x00, 0x62])))).toEqual({
      status: 415,
      code: "import.unsupported_media_type",
    });
    expect(refusal(() => parseCsv(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14])))).toEqual({
      status: 415,
      code: "import.unsupported_media_type",
    });
  });

  it("refuses an unclosed quoted field and text after a closing quote with 422 import.csv_malformed", () => {
    expect(refusal(() => parseCsv(enc('a,b\n"open,1\n')))).toEqual({ status: 422, code: "import.csv_malformed" });
    expect(refusal(() => parseCsv(enc('a,b\n"x"y,1\n')))).toEqual({ status: 422, code: "import.csv_malformed" });
  });

  it("accepts 5,000 data rows and refuses 5,001 with 422 import.too_many_rows", LARGE_INPUT, () => {
    const rows = (n: number) => `a,b\n${Array.from({ length: n }, (_, i) => `r-${i},1`).join("\n")}\n`;
    expect(parseCsv(enc(rows(5000))).rows).toHaveLength(5000);
    expect(refusal(() => parseCsv(enc(rows(5001))))).toEqual({ status: 422, code: "import.too_many_rows" });
  });

  it("refuses a data row beyond source row 100,000 (blank records in between)", LARGE_INPUT, () => {
    const text = `a,b\n${"\n".repeat(100_000)}r-1,1\n`;
    expect(refusal(() => parseCsv(enc(text)))).toEqual({ status: 422, code: "import.too_many_rows" });
  });
});
