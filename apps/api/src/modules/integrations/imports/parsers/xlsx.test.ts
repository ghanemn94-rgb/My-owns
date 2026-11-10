// XLSX import parser limits and cells (ADR-0056 §3; p6-work-split §B/A.3 tests; T-DG6-BE-M). The workbooks are built
// here byte by byte (a ZIP writer on node:zlib), so every container limit can be reached without a dependency.
import { crc32, deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { HttpProblem } from "../../../platform/index.ts";
import { parseXlsx } from "./xlsx.ts";

/**
 * Budget of the tests that build or parse files near the limits (10 MiB, 5,000 rows, 20-51 MiB containers): the
 * loaded worst case measured in a full parallel `pnpm test` was 5.96 s (the 10 MiB CSV, before the chunked scan); the
 * budget is about 5x that (F-DG4-143..148: deterministic under load).
 */
const LARGE_INPUT = { timeout: 30_000 };

// ------------------------------------------------------------------------------------------------ test ZIP writer

interface TestEntry {
  readonly name: string;
  readonly data: Uint8Array | string;
  /** Default: deflate. */
  readonly stored?: boolean;
  /** Overrides of the central-directory fields (to forge a lying header). */
  readonly declaredSize?: number;
  readonly declaredCompressed?: number;
  readonly flags?: number;
}

function zip(entries: readonly TestEntry[]): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = typeof e.data === "string" ? Buffer.from(e.data, "utf8") : Buffer.from(e.data);
    const body = e.stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(e.name, "utf8");
    const crc = crc32(raw) >>> 0;
    const method = e.stored ? 0 : 8;
    const size = e.declaredSize ?? raw.length;
    const comp = e.declaredCompressed ?? body.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(e.flags ?? 0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(e.flags ?? 0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, cd, eocd]));
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>`;
const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
const WORKBOOK = `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Actuals" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="2" r:id="rId2"/></sheets></workbook>`;
const WB_RELS = (extra = "") =>
  `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>${extra}</Relationships>`;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const col = (i: number) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/** A cell: a string (inline), {n} a numeric cell's stored text, {f} a formula with an optional cached value. */
type TestCell = string | null | { n: string } | { f: string; v?: string } | { s: number } | { b: "0" | "1" };

function sheetXml(rows: readonly (readonly TestCell[])[], firstRow = 1): string {
  const body = rows
    .map((cells, r) => {
      const rn = r + firstRow;
      const cs = cells
        .map((c, i) => {
          const ref = `${col(i)}${rn}`;
          if (c === null) return "";
          if (typeof c === "string") return `<c r="${ref}" t="inlineStr"><is><t>${esc(c)}</t></is></c>`;
          if ("n" in c) return `<c r="${ref}"><v>${c.n}</v></c>`;
          if ("s" in c) return `<c r="${ref}" t="s"><v>${c.s}</v></c>`;
          if ("b" in c) return `<c r="${ref}" t="b"><v>${c.b}</v></c>`;
          return `<c r="${ref}"><f>${esc(c.f)}</f>${c.v === undefined ? "" : `<v>${c.v}</v>`}</c>`;
        })
        .join("");
      return `<row r="${rn}">${cs}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

const SHARED = `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="2" uniqueCount="2"><si><t>shared text</t></si><si><r><t>rich </t></r><r><t>run</t></r><rPh><t>ignored</t></rPh></si></sst>`;

function workbook(
  rows: readonly (readonly TestCell[])[],
  opts: { extra?: TestEntry[]; contentTypes?: string; wbRelsExtra?: string; firstRow?: number } = {},
): Uint8Array {
  return zip([
    { name: "[Content_Types].xml", data: opts.contentTypes ?? CONTENT_TYPES },
    { name: "_rels/.rels", data: ROOT_RELS },
    { name: "xl/workbook.xml", data: WORKBOOK },
    { name: "xl/_rels/workbook.xml.rels", data: WB_RELS(opts.wbRelsExtra) },
    { name: "xl/sharedStrings.xml", data: SHARED },
    { name: "xl/worksheets/sheet1.xml", data: sheetXml(rows, opts.firstRow) },
    { name: "xl/worksheets/sheet2.xml", data: sheetXml([["second"], ["sheet"]]) },
    ...(opts.extra ?? []),
  ]);
}

function refusal(fn: () => unknown): { status: number; code: string } {
  try {
    fn();
  } catch (err) {
    if (err instanceof HttpProblem) return { status: err.status, code: err.code };
    throw err;
  }
  throw new Error("expected a refusal");
}

const HEADER = ["source_record_id", "kpi_id", "value", "comment"];

// ------------------------------------------------------------------------------------------------ tests

describe("parseXlsx: cells (ADR-0056 §3)", () => {
  it("reads the first worksheet only: header row 1, inline, shared and rich strings as text", () => {
    const sheet = parseXlsx(workbook([HEADER, ["r-1", { s: 0 }, { n: "12.5" }, { s: 1 }]]));
    expect(sheet.header).toEqual(HEADER);
    expect(sheet.rows).toEqual([
      { rowNumber: 2, values: ["r-1", "shared text", "12.5", "rich run"], formulaIndexes: [] },
    ]);
  });

  it("takes a numeric cell's stored text verbatim, never a JavaScript number", () => {
    const stored = ["12.5", "0.30000000000000004", "1E-3", "123456789012345678", "-0"];
    const sheet = parseXlsx(workbook([HEADER, ...stored.map((n, i) => [`r-${i}`, "k", { n }, null])]));
    expect(sheet.rows.map((r) => r.values[2])).toEqual(stored);
    for (const r of sheet.rows) for (const v of r.values) expect(v === null || typeof v === "string").toBe(true);
  });

  it("reports a formula cell in formulaIndexes with a null value, never its cached result (D-195 Q11)", () => {
    const sheet = parseXlsx(workbook([HEADER, ["r-1", "k", { f: "SUM(1,2)", v: "3" }, null]]));
    expect(sheet.rows[0]!.values[2]).toBeNull();
    expect(sheet.rows[0]!.formulaIndexes).toEqual([2]);
    expect(JSON.stringify(sheet)).not.toContain('"3"');
  });

  it("reports a formula in the header row", () => {
    const sheet = parseXlsx(
      workbook([
        ["source_record_id", { f: "A1" }],
        ["r-1", "x"],
      ]),
    );
    expect(sheet.headerFormulaIndexes).toEqual([1]);
  });

  it("keeps a numeric date serial as its digits (the target reports import.row.date_invalid)", () => {
    const sheet = parseXlsx(workbook([HEADER, ["r-1", "k", { n: "45291" }, null]]));
    expect(sheet.rows[0]!.values[2]).toBe("45291");
  });

  it("reads booleans as true/false and keeps formula-like text as text", () => {
    const sheet = parseXlsx(workbook([HEADER, ["r-1", { b: "1" }, { b: "0" }, "=HYPERLINK(1)"]]));
    expect(sheet.rows[0]!.values).toEqual(["r-1", "true", "false", "=HYPERLINK(1)"]);
    expect(sheet.rows[0]!.formulaIndexes).toEqual([]);
  });

  it("decodes XML entities and character references, and keeps Arabic text", () => {
    const sheet = parseXlsx(workbook([HEADER, ["r-1", "a & b < c", { n: "1" }, "مؤشر الأداء"]]));
    expect(sheet.rows[0]!.values[1]).toBe("a & b < c");
    expect(sheet.rows[0]!.values[3]).toBe("مؤشر الأداء");
  });

  it("skips empty rows and keeps the source row numbers", () => {
    const sheet = parseXlsx(
      workbook([HEADER, ["r-1", "k", { n: "1" }, null], [null, null], ["r-3", "k", { n: "2" }, null]]),
    );
    expect(sheet.rows.map((r) => r.rowNumber)).toEqual([2, 4]);
  });

  it("has no header when row 1 is missing", () => {
    expect(parseXlsx(workbook([HEADER], { firstRow: 2 })).header).toEqual([]);
  });

  it("accepts stored (uncompressed) entries", () => {
    const bytes = zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES, stored: true },
      { name: "xl/workbook.xml", data: WORKBOOK, stored: true },
      { name: "xl/_rels/workbook.xml.rels", data: WB_RELS(), stored: true },
      { name: "xl/sharedStrings.xml", data: SHARED, stored: true },
      { name: "xl/worksheets/sheet1.xml", data: sheetXml([HEADER, ["r-1", "k", { n: "7" }, null]]), stored: true },
    ]);
    expect(parseXlsx(bytes).rows[0]!.values[2]).toBe("7");
  });
});

describe("parseXlsx: the container limits (ADR-0056 §3, import.xlsx_unsafe 422)", () => {
  const unsafe = { status: 422, code: "import.xlsx_unsafe" };

  it("refuses more than 100 entries", () => {
    const extra = Array.from({ length: 94 }, (_, i) => ({ name: `docProps/x${i}.xml`, data: "<x/>" }));
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra })))).toEqual(unsafe);
    // 100 entries exactly are accepted.
    const ok = Array.from({ length: 93 }, (_, i) => ({ name: `docProps/x${i}.xml`, data: "<x/>" }));
    expect(parseXlsx(workbook([HEADER], { extra: ok })).header).toEqual(HEADER);
  });

  it("refuses an entry larger than 20 MiB unpacked", LARGE_INPUT, () => {
    const big = { name: "xl/media/big.xml", data: new Uint8Array(20 * 1_048_576 + 1), stored: true };
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra: [big] })))).toEqual(unsafe);
  });

  it("refuses more than 50 MiB unpacked in total", LARGE_INPUT, () => {
    // Three stored entries of 17 MiB (each under the 20 MiB entry limit, ratio 1:1): 51 MiB together.
    const chunk = new Uint8Array(17 * 1_048_576);
    const extra = [0, 1, 2].map((i) => ({ name: `xl/media/p${i}.xml`, data: chunk, stored: true }));
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra })))).toEqual(unsafe);
  });

  it("refuses an entry whose compression ratio exceeds 100:1", () => {
    const bomb = { name: "xl/media/zeros.xml", data: new Uint8Array(1_048_576) };
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra: [bomb] })))).toEqual(unsafe);
  });

  it("refuses an entry that unpacks larger than it declares", () => {
    const sheet = sheetXml([HEADER, ["r-1", "k", { n: "1" }, null]]);
    const bytes = zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "xl/workbook.xml", data: WORKBOOK },
      { name: "xl/_rels/workbook.xml.rels", data: WB_RELS() },
      { name: "xl/worksheets/sheet1.xml", data: sheet, declaredSize: 50 },
    ]);
    expect(refusal(() => parseXlsx(bytes))).toEqual(unsafe);
  });

  it("refuses macros (xl/vbaProject.bin, a macro-enabled content type)", () => {
    const vba = { name: "xl/vbaProject.bin", data: "macro" };
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra: [vba] })))).toEqual(unsafe);
    const ct = CONTENT_TYPES.replace("sheet.main+xml", "sheet.macroEnabled.main+xml");
    expect(refusal(() => parseXlsx(workbook([HEADER], { contentTypes: ct })))).toEqual(unsafe);
  });

  it("refuses external links (xl/externalLinks/*, an external relationship)", () => {
    const link = { name: "xl/externalLinks/externalLink1.xml", data: "<externalLink/>" };
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra: [link] })))).toEqual(unsafe);
    const rel = `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLink" Target="https://example.invalid/x.xlsx" TargetMode="External"/>`;
    expect(refusal(() => parseXlsx(workbook([HEADER], { wbRelsExtra: rel })))).toEqual(unsafe);
  });

  it("refuses an encrypted entry and a document type declaration", () => {
    const enc = { name: "docProps/app.xml", data: "<x/>", flags: 1 };
    expect(refusal(() => parseXlsx(workbook([HEADER], { extra: [enc] })))).toEqual(unsafe);
    const dtd = sheetXml([HEADER]).replace("<worksheet", '<!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet');
    const bytes = zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "xl/workbook.xml", data: WORKBOOK },
      { name: "xl/_rels/workbook.xml.rels", data: WB_RELS() },
      { name: "xl/worksheets/sheet1.xml", data: dtd },
    ]);
    expect(refusal(() => parseXlsx(bytes))).toEqual(unsafe);
  });
});

describe("parseXlsx: not an XLSX workbook (415 import.unsupported_media_type)", () => {
  const unsupported = { status: 415, code: "import.unsupported_media_type" };

  it("refuses bytes without the ZIP signature", () => {
    expect(refusal(() => parseXlsx(new TextEncoder().encode("a,b\n1,2\n")))).toEqual(unsupported);
  });

  it("refuses a ZIP without [Content_Types].xml or without a worksheet", () => {
    expect(refusal(() => parseXlsx(zip([{ name: "a.txt", data: "hello" }])))).toEqual(unsupported);
    const noSheet = zip([
      { name: "[Content_Types].xml", data: CONTENT_TYPES },
      { name: "xl/workbook.xml", data: WORKBOOK },
      { name: "xl/_rels/workbook.xml.rels", data: WB_RELS() },
    ]);
    expect(refusal(() => parseXlsx(noSheet))).toEqual(unsupported);
  });

  it("refuses a truncated ZIP", () => {
    const bytes = workbook([HEADER]);
    expect(refusal(() => parseXlsx(bytes.subarray(0, bytes.length - 30)))).toEqual(unsupported);
  });
});

describe("parseXlsx: row limits (ADR-0056 §3)", () => {
  it("accepts 5,000 data rows and refuses 5,001 with 422 import.too_many_rows", LARGE_INPUT, () => {
    const rows = (n: number) => [HEADER, ...Array.from({ length: n }, (_, i) => [`r-${i}`, "k", { n: "1" }, null])];
    expect(parseXlsx(workbook(rows(5000))).rows).toHaveLength(5000);
    expect(refusal(() => parseXlsx(workbook(rows(5001))))).toEqual({ status: 422, code: "import.too_many_rows" });
  });
});
