// REQ-S13-005, REQ-S13-006, REQ-S13-008, REQ-S13-009 (ADR-0046 §3, §4): the XLSX writer, read back part by part.
import { describe, expect, it } from "vitest";
import { options, sampleDocument } from "../test-fixtures.ts";
import { renderXlsx, sheetName } from "./index.ts";
import { cellText, readXlsx, type ReadSheet } from "./read.ts";
import { columnName, sumFormula, xmlText } from "./sheet.ts";

const find = (s: ReadSheet, ref: string) => s.rows.flat().find((c) => c.ref === ref);

describe("renderXlsx", () => {
  const doc = sampleDocument(
    [
      { code: "RAID-014", description: '=HYPERLINK("http://x","y")', amount: "1200.50" },
      { code: "RAID-015", description: "+cmd|' /C calc'!A0", amount: "-200.25", provisional: true },
      { code: "RAID-016", description: "@SUM(A1)", amount: "0.75" },
      { code: "RAID-017", description: "\tTabbed", amount: "100" },
      { code: "RAID-018", description: "\rCarriage", amount: "1" },
      { code: "RAID-019", description: "-1+1", amount: "2" },
      { code: "RAID-020", description: "Normal text", amount: "3" },
    ],
    "1107.00",
  );

  it("user text starting like a formula is an inline string with quotePrefix, never a formula (REQ-S13-006)", async () => {
    const wb = await readXlsx((await renderXlsx(doc, options("xlsx"))).bytes);
    const sheet = wb.sheets[1]!;
    const formulas = sheet.rows.flat().filter((c) => c.formula !== null);
    expect(formulas.map((c) => c.formula)).toEqual(["SUM(D3:D9)"]);
    const expected: Record<string, string> = {
      C3: '=HYPERLINK("http://x","y")',
      C4: "+cmd|' /C calc'!A0",
      C5: "@SUM(A1)",
      C6: "\tTabbed",
      C7: "\rCarriage",
      C8: "-1+1",
    };
    for (const [ref, text] of Object.entries(expected)) {
      const c = find(sheet, ref)!;
      expect([c.type, c.text, c.formula, wb.quotePrefix[c.style]], ref).toEqual(["inlineStr", text, null, true]);
    }
    const normal = find(sheet, "C9")!;
    expect([normal.type, normal.text, wb.quotePrefix[normal.style]]).toEqual(["inlineStr", "Normal text", false]);
  });

  it("the system SUM total is <f>SUM(...)</f> with the decimal.js total as cached value (REQ-S13-006)", async () => {
    const wb = await readXlsx((await renderXlsx(doc, options("xlsx"))).bytes);
    const sheet = wb.sheets[1]!;
    expect(sheet.xml).toContain("<f>SUM(D3:D9)</f><v>1107.00</v>");
    const total = find(sheet, "D10")!;
    expect([total.formula, total.value]).toEqual(["SUM(D3:D9)", "1107.00"]);
    expect(cellText(find(sheet, "A10"))).toBe("Total");
  });

  it("numbers are number cells with the canonical decimal; provisional is italic with its companion status", async () => {
    const wb = await readXlsx((await renderXlsx(doc, options("xlsx"))).bytes);
    const sheet = wb.sheets[1]!;
    expect(cellText(find(sheet, "E2"))).toBe("Amount — status");
    const d4 = find(sheet, "D4")!;
    expect([d4.type, d4.value, wb.italic[d4.style]]).toEqual([null, "-200.25", true]);
    expect(cellText(find(sheet, "E4"))).toBe("Provisional");
    expect(cellText(find(sheet, "E3"))).toBe("Validated");
  });

  it("Unknown is an empty cell with status Unknown, never 0; then the total is not a formula", async () => {
    const d = sampleDocument(
      [
        { code: "RAID-001", description: "x", amount: null },
        { code: "RAID-002", description: "y", amount: "5" },
      ],
      null,
    );
    const sheet = (await readXlsx((await renderXlsx(d, options("xlsx"))).bytes)).sheets[1]!;
    expect(find(sheet, "D3")).toBeUndefined();
    expect(cellText(find(sheet, "E3"))).toBe("Unknown");
    expect(sheet.rows.flat().some((c) => c.formula !== null)).toBe(false);
    expect(find(sheet, "D5")).toBeUndefined();
    expect(cellText(find(sheet, "E5"))).toBe("Unknown");
  });

  it("a declared total that the rows do not sum to is written as its value, not as a formula", async () => {
    const d = sampleDocument([{ code: "RAID-001", description: "x", amount: "5" }], "6");
    const sheet = (await readXlsx((await renderXlsx(d, options("xlsx"))).bytes)).sheets[1]!;
    const t = find(sheet, "D4")!;
    expect([t.formula, t.value]).toEqual([null, "6"]);
  });

  it("more than 15 significant digits is written as text (no binary rounding)", async () => {
    const d = sampleDocument(
      [{ code: "RAID-001", description: "x", amount: "123456789012345.678" }],
      "123456789012345.678",
    );
    const sheet = (await readXlsx((await renderXlsx(d, options("xlsx"))).bytes)).sheets[1]!;
    const c = find(sheet, "D3")!;
    expect([c.type, c.text]).toEqual(["inlineStr", "123456789012345.678"]);
    expect(sheet.rows.flat().some((x) => x.formula !== null)).toBe(false);
  });

  it("a negative decimal of more than 15 significant digits is text without quotePrefix (F-DG5-101, ADR-0046 §4)", async () => {
    const d = sampleDocument(
      [{ code: "RAID-001", description: "x", amount: "-12345678901.23456" }],
      "-12345678901.23456",
    );
    const wb = await readXlsx((await renderXlsx(d, options("xlsx"))).bytes);
    const c = find(wb.sheets[1]!, "D3")!;
    expect([c.type, c.text, wb.quotePrefix[c.style]]).toEqual(["inlineStr", "-12345678901.23456", false]);
  });

  it("Arabic sheets are right-to-left in IBM Plex Sans Arabic; English left-to-right in IBM Plex Sans (REQ-S13-009)", async () => {
    const ar = await readXlsx((await renderXlsx(doc, options("xlsx", "ar"))).bytes);
    expect(ar.sheets.every((s) => s.rtl)).toBe(true);
    expect(ar.styles).toContain('<name val="IBM Plex Sans Arabic"/>');
    expect(ar.sheets.map((s) => s.name)).toEqual(["حول", "Title", "دليل الرموز"]);
    expect(ar.sheets[0]!.rows.flat().some((c) => c.text === "مسودة — ليس تقريراً صادراً")).toBe(true);
    const en = await readXlsx((await renderXlsx(doc, options("xlsx"))).bytes);
    expect(en.sheets.some((s) => s.rtl)).toBe(false);
    expect(en.styles).toContain('<name val="IBM Plex Sans"/>');
  });

  it("the About sheet carries the frame and the non-table sections; the legend sheet the labels", async () => {
    const wb = await readXlsx((await renderXlsx(doc, options("xlsx"))).bytes);
    const about = wb.sheets[0]!.rows.map((r) => r.map((c) => cellText(c)));
    expect(about).toContainEqual(["Issue", "Draft — not an issued report"]);
    expect(about).toContainEqual(["Transformation", "TR-001 — Synthetic roaming transformation"]);
    // An untranslated code shows its code value (the fallback), never an invented label.
    expect(about).toContainEqual(["Status", "open", "Validated"]);
    const legend = wb.sheets[2]!.rows.map((r) => cellText(r[0]));
    expect(legend).toEqual(expect.arrayContaining(["Validated", "Provisional", "Unknown", "Stale", "n/a"]));
    expect(wb.files).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/styles.xml",
        "xl/worksheets/sheet2.xml",
      ]),
    );
  });

  it("an empty table prints No records; the bytes are deterministic for one snapshot", async () => {
    const empty = sampleDocument([], "0");
    const wb = await readXlsx((await renderXlsx(empty, options("xlsx"))).bytes);
    expect(cellText(find(wb.sheets[1]!, "A3"))).toBe("No records");
    const a = (await renderXlsx(doc, options("xlsx"))).bytes;
    const b = (await renderXlsx(doc, options("xlsx"))).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  it("helpers: column names, the SUM template takes integers only, XML escaping, sheet names", () => {
    expect([columnName(0), columnName(25), columnName(26), columnName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
    expect(sumFormula(3, 2, 9)).toBe("SUM(D2:D9)");
    expect(() => sumFormula(3, 0, 1)).toThrow();
    expect(() => sumFormula(3, 5, 4)).toThrow();
    expect(xmlText('<a&"b">\r\u0001')).toBe("&lt;a&amp;&quot;b&quot;&gt;&#13;�");
    const taken = new Set<string>();
    expect(sheetName("A/B:C", taken)).toBe("A B C");
    expect(sheetName("a b c", taken)).toBe("a b c (2)");
    expect(sheetName("x".repeat(40), taken)).toHaveLength(31);
  });
});
