// REQ-S13-009, REQ-S13-008, REQ-S13-005 (ADR-0046 §2, §3, §9): the PDF writer, read back from the file itself.
// The reader (./read.ts) inflates the streams, decodes each text-showing operator's glyph ids through its font's
// ToUnicode map, and keeps the position and the embedded subset font, so the tests check what a viewer draws:
// the base direction, the embedded IBM Plex Sans Arabic, identifiers and numbers in left-to-right order, and the
// Arabic joining forms (the glyph-run check: the drawn glyphs are GSUB's joined forms, not the isolated forms).
// All content is synthetic.
import { createRequire } from "node:module";
import type { ReportDocument } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { fontBytes, FONT_FACES } from "../fonts.ts";
import type { LabelTable } from "../labels.ts";
import { render, RENDERED_FORMATS } from "../render.ts";
import { options as baseOptions, sampleDocument, SNAPSHOT_ID } from "../test-fixtures.ts";
import { RenderError, type RenderOptions } from "../model.ts";
import { renderPdf } from "./index.ts";
import { drawsArabic, lines, plain, readPdf, rev } from "./read.ts";

/** Shaping Arabic PDFs is slow under a loaded run (F-DG4-143 to F-DG4-148): a generous, deterministic bound. */
const PDF_TEST_TIMEOUT_MS = 60_000;

// ------------------------------------------------------------------------------------------------ fixtures

const DESCRIPTION_AR = "مخاطرة RAID-014 بقيمة 1,250.50";
const CONTENT_LABELS: LabelTable = {
  en: {
    "report.registers.raid.title": "RAID register",
    "report.registers.raid.code": "Code",
    "report.registers.raid.type": "Type",
    "report.registers.raid.description": "Description",
    "report.registers.raid.amount": "Amount",
    "report.registers.raid.status": "Status",
    "report.registers.filters": "Filters",
    "report.raid_type.risk": "Risk",
    "report.raid_status.open": "Open",
  },
  ar: {
    "report.registers.raid.title": "سجل المخاطر والقضايا",
    "report.registers.raid.code": "الرمز",
    "report.registers.raid.type": "النوع",
    "report.registers.raid.description": "الوصف",
    "report.registers.raid.amount": "المبلغ",
    "report.registers.raid.status": "الحالة",
    "report.registers.filters": "عوامل التصفية",
    "report.raid_type.risk": "مخاطرة",
    "report.raid_status.open": "مفتوح",
  },
};

const doc = (): ReportDocument =>
  sampleDocument(
    [
      { code: "RAID-014", description: DESCRIPTION_AR, amount: "1250.50" },
      { code: "RAID-015", description: "Supplier delay on the roaming partner", amount: "-200.25", provisional: true },
      { code: "RAID-016", description: null, amount: null },
    ],
    null,
  );

const opts = (language: "en" | "ar", over: Partial<RenderOptions> = {}): RenderOptions => ({
  ...baseOptions("pdf", language),
  labels: CONTENT_LABELS,
  ...over,
});

const pdfOf = async (language: "en" | "ar", d: ReportDocument = doc(), over: Partial<RenderOptions> = {}) =>
  readPdf((await renderPdf(d, opts(language, over))).bytes);

// fontkit is pdfkit's own dependency (not one of @mth/reporting's): loaded through pdfkit for the glyph-run check.
const requireHere = createRequire(import.meta.url);
const fontkit = createRequire(requireHere.resolve("pdfkit"))("fontkit") as {
  create(b: Buffer): {
    getGlyph(id: number): { path: { toSVG(): string } };
    glyphForCodePoint(cp: number): { path: { toSVG(): string } };
    layout(t: string): { glyphs: { path: { toSVG(): string } }[] };
  };
};

// ------------------------------------------------------------------------------------------------ tests

describe("renderPdf: Arabic (REQ-S13-009)", { timeout: PDF_TEST_TIMEOUT_MS }, () => {
  it("has a right-to-left base direction: /Lang (ar-SA), /Direction /R2L, right-aligned text, mirrored tables", async () => {
    const pdf = await pdfOf("ar");
    const catalog = [...pdf.objects.values()].find((o) => /\/Type \/Catalog/.test(o.dict))!.dict;
    expect(catalog).toContain("/Lang (ar-SA)");
    const prefs = pdf.objects.get(Number(/\/ViewerPreferences (\d+) 0 R/.exec(catalog)![1]))!.dict;
    expect(prefs).toMatch(/\/Direction \/R2L/);
    // The product name line is aligned to the right margin (it starts well right of the left margin).
    const product = pdf.shown.find((s) => s.text.includes("Mobily"))!;
    expect(product.x).toBeGreaterThan(200);
    // The first table column (Code) is on the right of the amount column.
    const code = pdf.shown.find((s) => s.logical.trim() === "الرمز")!;
    const amount = pdf.shown.find((s) => s.logical.trim() === "المبلغ")!;
    expect(code.x).toBeGreaterThan(amount.x);
  });

  it("embeds IBM Plex Sans Arabic (every font is an embedded subset of it, with its TrueType program)", async () => {
    const pdf = await pdfOf("ar");
    const bases = new Set(pdf.shown.map((s) => s.baseFont));
    expect(bases.size).toBeGreaterThan(0);
    for (const b of bases) {
      expect(b).toMatch(/^[A-Z]{6}\+IBMPlexSansArabic-(Regular|Bold)$/);
      expect(pdf.fontFile.get(b)!.length).toBeGreaterThan(1000);
    }
  });

  it("identifiers and numbers keep their left-to-right order inside Arabic text (text extraction)", async () => {
    const pdf = await pdfOf("ar");
    const all = lines(pdf);
    // The description cell, read left to right on the page: number, Arabic word, identifier, Arabic word.
    expect(all.some((l) => l.includes(`1,250.50 ${rev("بقيمة")} RAID-014 ${rev("مخاطرة")}`))).toBe(true);
    // The identifiers of the code column, the snapshot ID (a UUID) and the as-of time in their own order.
    for (const id of ["RAID-014", "RAID-015", "RAID-016", SNAPSHOT_ID])
      expect(
        all.some((l) => l.includes(id)),
        id,
      ).toBe(true);
    expect(all.some((l) => l.includes("2026-10-15 13:00 (Asia/Riyadh)"))).toBe(true);
    // A negative amount keeps its sign in front of the digits.
    expect(all.some((l) => l.includes("-200.25 SAR"))).toBe(true);
  });

  it("a multi-word Arabic phrase reads right to left, word by word (the leftmost word is the last one)", async () => {
    const pdf = await pdfOf("ar");
    // "Draft — not an issued report": مسودة — ليس تقريراً صادراً. From the left: صادراً, تقريراً, ليس, —, مسودة.
    const footer = pdf.shown.filter((s) => s.page === 1 && s.y < 60).sort((a, b) => a.x - b.x);
    const order = ["صادرا", "ليس", "مسودة"].map((w) => footer.findIndex((s) => plain(s.logical).includes(w)));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("the glyph-run check: the drawn Arabic word uses GSUB's joined forms, not the isolated forms", async () => {
    const pdf = await pdfOf("ar");
    const word = "مخاطرة";
    const drawn = pdf.shown.find((s) => s.logical.trim() === word)!;
    expect(drawn).toBeDefined();
    const subset = fontkit.create(pdf.fontFile.get(drawn.baseFont)!);
    const drawnPaths = drawn.gids.map((g) => subset.getGlyph(g).path.toSVG()).filter((p) => p !== "");
    const face = FONT_FACES.find((f) => f.name === "PlexArabic-arabic-400")!;
    const original = fontkit.create(fontBytes(face));
    // Equal to the shaped run of the original font (in visual order) ...
    expect(drawnPaths).toEqual(original.layout(word).glyphs.map((g) => g.path.toSVG()));
    // ... and different from the isolated forms: initial meem, medial khah and the final forms are joined forms.
    const isolated = [...word].reverse().map((c) => original.glyphForCodePoint(c.codePointAt(0)!).path.toSVG());
    const differing = drawnPaths.filter((p, k) => p !== isolated[k]).length;
    expect(differing).toBeGreaterThanOrEqual(3);
  });

  it("a provisional value prints مؤقت, an Unknown value prints غير معروف and no number, never 0", async () => {
    const pdf = await pdfOf("ar");
    expect(drawsArabic(pdf, "مؤقت")).toBe(true);
    expect(drawsArabic(pdf, "غير معروف")).toBe(true);
    const unknownRow = lines(pdf).find((l) => l.includes("RAID-016"))!;
    expect(unknownRow).toBeDefined();
    expect(/\d/.test(unknownRow.replace("RAID-016", ""))).toBe(false);
  });

  it("a generated snapshot carries مسودة — ليس تقريراً صادراً on every page", async () => {
    const pdf = await pdfOf("ar");
    for (let p = 1; p <= pdf.pages; p++) {
      expect(drawsArabic(pdf, "مسودة", p)).toBe(true);
      expect(drawsArabic(pdf, "صادراً", p)).toBe(true);
    }
  });
});

describe("renderPdf: English (REQ-S13-009, REQ-S13-008)", { timeout: PDF_TEST_TIMEOUT_MS }, () => {
  it("is left to right: /Lang (en-GB), no R2L preference, left-aligned text, IBM Plex Sans embedded", async () => {
    const pdf = await pdfOf("en");
    expect(pdf.raw).toContain("/Lang (en-GB)");
    expect(pdf.raw).not.toContain("/Direction /R2L");
    const product = pdf.shown.find((s) => s.text.includes("Mobily"))!;
    expect(product.x).toBeCloseTo(42, 1);
    expect(product.baseFont).toMatch(/^[A-Z]{6}\+IBMPlexSans-Bold$/);
    const code = pdf.shown.find((s) => s.text === "Code")!;
    const amount = pdf.shown.find((s) => s.text === "Amount")!;
    expect(code.x).toBeLessThan(amount.x);
    // User-authored Arabic inside an English export is still shaped with IBM Plex Sans Arabic and reads right to left.
    expect(pdf.shown.some((s) => s.logical.trim() === "مخاطرة" && /IBMPlexSansArabic/.test(s.baseFont))).toBe(true);
  });

  it("prints Provisional under a pending value, Unknown with no number, and the legend", async () => {
    const all = lines(await pdfOf("en"));
    expect(all.some((l) => l.endsWith("SAR -200.25"))).toBe(true);
    expect(all).toContain("Provisional");
    const unknownRow = all.find((l) => l.includes("RAID-016"))!;
    expect(unknownRow).toContain("Unknown");
    expect(/\d/.test(unknownRow.replace("RAID-016", ""))).toBe(false);
    expect(all.some((l) => l.includes("The value is provisional"))).toBe(true);
  });

  it("a generated snapshot carries 'Draft — not an issued report'; an issued one its version and no Draft line", async () => {
    const draft = await pdfOf("en");
    for (let p = 1; p <= draft.pages; p++)
      expect(lines(draft, p).some((l) => l.includes("Draft — not an issued report"))).toBe(true);
    const issued = await pdfOf("en", doc(), { snapshot: { id: SNAPSHOT_ID, status: "issued", issueVersion: 2 } });
    const all = lines(issued);
    expect(all.some((l) => l.includes("Issued report, version 2"))).toBe(true);
    expect(all.join("\n")).not.toContain("Draft");
  });
});

describe("renderPdf: content and pagination (REQ-S13-005)", { timeout: PDF_TEST_TIMEOUT_MS }, () => {
  it("prints every row of a long register once, repeats the table header on each page, and numbers the pages", async () => {
    const rows = Array.from({ length: 140 }, (_, i) => ({
      code: `RAID-${String(i + 1).padStart(3, "0")}`,
      description: i % 2 === 0 ? `تأخر مورد رقم ${i + 1}` : `Synthetic supplier delay ${i + 1}`,
      amount: `${i + 1}.50`,
    }));
    const total = rows.reduce((a, r) => a + Number(r.amount), 0).toFixed(2);
    for (const language of ["en", "ar"] as const) {
      const pdf = readPdf((await renderPdf(sampleDocument(rows, total), opts(language))).bytes);
      expect(pdf.pages).toBeGreaterThan(2);
      const all = lines(pdf);
      for (const r of rows)
        expect(all.filter((l) => l.includes(r.code)).length, `${language} ${r.code}`).toBeGreaterThanOrEqual(1);
      // Each code appears in its code cell exactly once (the description of the even rows repeats no code).
      const codeCells = pdf.shown.filter((s) => /^RAID-\d{3}$/.test(s.text.trim())).map((s) => s.text.trim());
      expect(codeCells.sort()).toEqual(rows.map((r) => r.code).sort());
      const header = language === "en" ? "Description" : "الوصف";
      const pagesWithHeader = new Set(
        pdf.shown.filter((s) => (language === "en" ? s.text : s.logical).trim() === header).map((s) => s.page),
      );
      expect(pagesWithHeader.size).toBeGreaterThanOrEqual(pdf.pages - 1);
      if (language === "en")
        expect(lines(pdf, pdf.pages).some((l) => l.includes(`Page ${pdf.pages} of ${pdf.pages}`))).toBe(true);
      else expect(drawsArabic(pdf, "الصفحة", pdf.pages)).toBe(true);
    }
  }, 60_000);

  it("an empty table prints its empty line; progress is reported per section; an invalid document is refused", async () => {
    const seen: number[] = [];
    const empty = readPdf(
      (await renderPdf(sampleDocument([], null), { ...opts("en"), onSection: (d) => void seen.push(d) })).bytes,
    );
    expect(lines(empty)).toContain("No records");
    expect(seen).toEqual([1, 2]);
    await expect(
      renderPdf({ ...doc(), schemaVersion: 2 } as unknown as ReportDocument, opts("en")),
    ).rejects.toBeInstanceOf(RenderError);
  });

  it("render() dispatches every export format, PDF included", async () => {
    expect([...RENDERED_FORMATS].sort()).toEqual(["csv", "docx", "pdf", "pptx", "xlsx"]);
    const r = await render(doc(), opts("en"));
    expect([r.contentType, r.extension, r.sections]).toEqual(["application/pdf", "pdf", 2]);
    expect(Buffer.from(r.bytes.subarray(0, 5)).toString("latin1")).toBe("%PDF-");
  });
});
