// D-163 repairs (T-DG5-BE-N2): the B0004 provenance statement in every XLSX sheet and in CSV (F-DG5-qa-c-1; ADR-0046
// §2 "Every file carries ... slice I's provenance footer (B0004)"; REQ-PB-001, REQ-S20-015), and the illustrative label
// of a demo snapshot in every format (F-DG5-qa-c-2; ADR-0050 §2 (d); REQ-PB-089, REQ-S18-001): in the header and on
// every page (PDF, DOCX), slide (PPTX) or sheet (XLSX), and as a row in CSV, in the file's language. The renderer
// decides from the snapshot's recorded `synthetic` member only. Also the ADR-0046 §9 display rule of decimals
// (QA-C O3). Synthetic fixtures only; nothing here approves anything.
import { describe, expect, it } from "vitest";
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { cellText as displayCell } from "./layout/values.ts";
import { createLabels } from "./labels.ts";
import { readOoxml, xmlTexts } from "./ooxml-read.ts";
import { drawsArabic, lines, readPdf } from "./pdf/read.ts";
import { render } from "./render.ts";
import { options, sampleDocument } from "./test-fixtures.ts";
import { readXlsx, cellText } from "./xlsx/read.ts";
import type { ExportFormat, RenderOptions } from "./model.ts";

const B0004 = {
  en: "Practical synthesis inspired by PMI Organizational Transformation, Brightline Transformation Compass and PMI Benefits Realization Management; extended with a custom Target Operating Model toolkit.",
  // The catalogue rows of 0092 (the Arabic is its provisional translation), copied verbatim.
  ar: "توليفة عملية مستوحاة من سلسلة PMI للتحول المؤسسي وبوصلة برايتلاين للتحول وإدارة تحقيق المنافع من PMI؛ ومُوسَّعة بمجموعة أدوات مخصصة لنموذج التشغيل المستهدف.",
} as const;
/** RFC 4180 parse of a rendered CSV (BOM dropped; CRLF records). */
function parseCsvForTest(bytes: Uint8Array): string[][] {
  const text = new TextDecoder().decode(bytes).replace(/^\uFEFF/, "");
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\r" && text[i + 1] === "\n") {
      row.push(field);
      out.push(row);
      row = [];
      field = "";
      i++;
    } else field += ch;
  }
  return out;
}

const LABEL = { en: "Illustrative example — synthetic", ar: "مثال توضيحي — اصطناعي" } as const;
const LANGS = ["en", "ar"] as const;
/** Rendering many files is slow under a loaded run (F-DG4-143 to F-DG4-148): a generous, deterministic bound. */
const RENDER_TIMEOUT_MS = 120_000;

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    code: `RAID-${String(i + 1).padStart(3, "0")}`,
    description: `Synthetic risk ${i + 1}`,
    amount: "10.00",
  }));
const production = (n = 1): ReportDocument => sampleDocument(rows(n), (10 * n).toFixed(2));
const demo = (n = 1): ReportDocument => ({ ...production(n), synthetic: true });
const withProvenance = (format: ExportFormat, language: "en" | "ar", provenance: string | null): RenderOptions => {
  const o = options(format, language);
  return { ...o, branding: { ...o.branding, provenance } };
};

describe(
  "the ReportDocument contract: `synthetic` is optional and only ever true (D-163)",
  { timeout: RENDER_TIMEOUT_MS },
  () => {
    it("absent (production) and true (demo) parse; false and other values are refused", () => {
      expect(reportDocument.safeParse(production()).success).toBe(true);
      expect(reportDocument.parse(production())).not.toHaveProperty("synthetic");
      expect(reportDocument.parse(demo()).synthetic).toBe(true);
      for (const bad of [false, "true", 1, null])
        expect(reportDocument.safeParse({ ...production(), synthetic: bad }).success, String(bad)).toBe(false);
    });
  },
);

describe(
  "XLSX: the B0004 statement on every sheet, a plain inline string (F-DG5-qa-c-1)",
  { timeout: RENDER_TIMEOUT_MS },
  () => {
    for (const language of LANGS)
      it(`${language}: every sheet carries the statement exactly, as inlineStr, never a formula`, async () => {
        const r = await render(production(3), withProvenance("xlsx", language, B0004[language]));
        const wb = await readXlsx(r.bytes);
        expect(wb.sheets.length).toBeGreaterThanOrEqual(3);
        for (const sheet of wb.sheets) {
          const hits = sheet.rows.flat().filter((c) => cellText(c) === B0004[language]);
          expect(hits, sheet.name).toHaveLength(1);
          expect(hits[0]!.type, sheet.name).toBe("inlineStr");
          expect(hits[0]!.formula, sheet.name).toBeNull();
          expect(wb.quotePrefix[hits[0]!.style], sheet.name).toBe(false);
          expect(sheet.rtl, sheet.name).toBe(language === "ar");
        }
      });

    it("the SUM total still covers exactly the data rows (the statement is after them)", async () => {
      const r = await render(production(3), withProvenance("xlsx", "en", B0004.en));
      const wb = await readXlsx(r.bytes);
      const formulas = wb.sheets.flatMap((s) => s.rows.flat()).flatMap((c) => (c.formula === null ? [] : [c]));
      expect(formulas.map((c) => c.formula)).toEqual(["SUM(D3:D5)"]);
      expect(formulas[0]!.value).toBe("30.00");
    });

    it("a statement that starts like a formula stays text with the quote prefix (REQ-S13-006)", async () => {
      const r = await render(production(), withProvenance("xlsx", "en", '=HYPERLINK("http://x","y")'));
      const wb = await readXlsx(r.bytes);
      for (const sheet of wb.sheets) {
        const c = sheet.rows.flat().find((x) => cellText(x) === '=HYPERLINK("http://x","y")')!;
        expect(c.type).toBe("inlineStr");
        expect(c.formula).toBeNull();
        expect(wb.quotePrefix[c.style]).toBe(true);
      }
    });

    it("no statement given: nothing is printed in its place", async () => {
      const without = await readXlsx((await render(production(3), withProvenance("xlsx", "en", null))).bytes);
      const plain = await readXlsx((await render(production(3), options("xlsx", "en"))).bytes);
      expect(without.sheets.map((s) => s.xml)).toEqual(plain.sheets.map((s) => s.xml));
      expect(
        without.sheets.flatMap((s) => s.rows.flat()).some((c) => /Practical synthesis/.test(cellText(c) ?? "")),
      ).toBe(false);
    });
  },
);

describe("CSV: one B0004 row after the header rows (F-DG5-qa-c-1)", { timeout: RENDER_TIMEOUT_MS }, () => {
  for (const language of LANGS)
    it(`${language}: the statement is one row right after the header block`, async () => {
      const r = await render(production(), withProvenance("csv", language, B0004[language]));
      const csv = parseCsvForTest(r.bytes);
      const at = csv.findIndex((row) => row.length === 1 && row[0] === B0004[language]);
      expect(at).toBeGreaterThan(0);
      expect(csv.filter((row) => row.includes(B0004[language]))).toHaveLength(1);
      // The ten header rows (label, value) come first; the statement follows them, then the blank separator.
      expect(at).toBe(10);
      expect(csv[at + 1]).toEqual([""]);
    });

  it("a statement that starts like a formula is neutralized with a leading apostrophe", async () => {
    const r = await render(production(), withProvenance("csv", "en", "@SUM(1)"));
    expect(parseCsvForTest(r.bytes).some((row) => row[0] === "'@SUM(1)")).toBe(true);
  });

  it("no statement given: the file is byte-identical to one rendered without the member", async () => {
    const a = await render(production(), withProvenance("csv", "en", null));
    const b = await render(production(), options("csv", "en"));
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
  });
});

describe(
  "the illustrative label of a demo snapshot (F-DG5-qa-c-2; ADR-0050 §2 (d))",
  { timeout: RENDER_TIMEOUT_MS },
  () => {
    for (const language of LANGS) {
      const label = LABEL[language];

      it(`XLSX ${language}: the first row of every sheet`, async () => {
        const wb = await readXlsx((await render(demo(3), options("xlsx", language))).bytes);
        for (const sheet of wb.sheets) {
          expect(sheet.rows[0]!.map(cellText), sheet.name).toEqual([label]);
          expect(sheet.rows[0]![0]!.type).toBe("inlineStr");
        }
        // The SUM range moved down with the label row and still covers exactly the three data rows.
        const sums = wb.sheets.flatMap((s) => s.rows.flat()).flatMap((c) => (c.formula === null ? [] : [c.formula]));
        expect(sums).toEqual(["SUM(D4:D6)"]);
      });

      it(`CSV ${language}: the first row of the file`, async () => {
        const csv = parseCsvForTest((await render(demo(), options("csv", language))).bytes);
        expect(csv[0]).toEqual([label]);
      });

      it(`PDF ${language}: in the header and on every page`, async () => {
        const r = await render(demo(160), options("pdf", language));
        const pdf = readPdf(r.bytes);
        expect(pdf.pages).toBeGreaterThan(2);
        for (let page = 1; page <= pdf.pages; page++)
          if (language === "en")
            expect(
              lines(pdf, page).some((l) => l.includes(label)),
              `page ${page}`,
            ).toBe(true);
          else
            for (const word of ["مثال توضيحي", "اصطناعي"])
              expect(drawsArabic(pdf, word, page), `page ${page}: ${word}`).toBe(true);
        // The header block of page 1 carries it too (twice on page 1: the page line and the header line).
        if (language === "en") expect(lines(pdf, 1).filter((l) => l.includes(label)).length).toBe(2);
      });

      it(`DOCX ${language}: in the body's header block and in the page header (every page)`, async () => {
        const r = await render(demo(), options("docx", language));
        const body = await readOoxml(r.bytes, /^word\/document\.xml$/);
        const header = await readOoxml(r.bytes, /^word\/header\d*\.xml$/);
        expect(header.parts.size).toBeGreaterThan(0);
        const bodyText = xmlTexts([...body.parts.values()].join("")).join("");
        expect(bodyText).toContain(label);
        expect(bodyText.indexOf(label)).toBeLessThan(bodyText.indexOf(options("docx", language).title));
        expect(xmlTexts([...header.parts.values()].join("")).join("")).toBe(label);
        const doc = body.parts.get("word/document.xml")!;
        expect(doc).toMatch(/<w:headerReference w:type="default"/);
      });

      it(`PPTX ${language}: on every slide`, async () => {
        const r = await render(demo(40), options("pptx", language));
        const slides = await readOoxml(r.bytes, /^ppt\/slides\/slide\d+\.xml$/);
        expect(slides.parts.size).toBeGreaterThan(3);
        for (const [name, xml] of slides.parts) expect(xmlTexts(xml).join(""), name).toContain(label);
      });
    }

    it("production (no `synthetic` member): no format prints the label in any language", async () => {
      for (const format of ["pdf", "docx", "xlsx", "pptx", "csv"] as const)
        for (const language of LANGS) {
          const r = await render(production(), options(format, language));
          const text =
            format === "pdf"
              ? lines(readPdf(r.bytes)).join("\n")
              : format === "csv"
                ? Buffer.from(r.bytes).toString("utf8")
                : format === "xlsx"
                  ? (await readXlsx(r.bytes)).sheets.map((s) => s.xml).join("")
                  : xmlTexts(
                      [...(await readOoxml(r.bytes, /^(word|ppt\/slides)\/[^/]+\.xml$/)).parts.values()].join(""),
                    ).join("");
          expect(text, `${format}/${language}`).not.toContain("Illustrative");
          expect(text, `${format}/${language}`).not.toContain("توضيحي");
          expect(r.missingLabels, `${format}/${language}`).toEqual(
            (await render(production(), options(format, language))).missingLabels,
          );
        }
    });

    it("production: the DOCX has no page header part referenced", async () => {
      const r = await render(production(), options("docx", "en"));
      const body = await readOoxml(r.bytes, /^word\/document\.xml$/);
      expect(body.parts.get("word/document.xml")!).not.toMatch(/<w:headerReference/);
    });

    it("the label is translated (no missing label key in either language)", async () => {
      for (const format of ["pdf", "docx", "xlsx", "pptx", "csv"] as const)
        for (const language of LANGS) {
          const r = await render(demo(), options(format, language));
          expect(r.missingLabels, `${format}/${language}`).not.toContain("export.illustrative");
        }
    });
  },
);

describe(
  "ADR-0046 §9: decimals are printed with half-up display rounding, the stored value unchanged (QA-C O3)",
  { timeout: RENDER_TIMEOUT_MS },
  () => {
    it("a decimal of unit kind `other` stored as 100.000000 prints 100 (en and ar); the document keeps 100.000000", () => {
      const v = {
        type: "decimal" as const,
        value: "100.000000",
        unitKind: "other" as const,
        currency: null,
        valueBasis: null,
        validation: "validated" as const,
        reason: null,
      };
      expect(displayCell(v, createLabels("en"))).toBe("100");
      expect(displayCell(v, createLabels("ar"))).toBe("100");
      expect(displayCell({ ...v, value: "12.3456785" }, createLabels("en"))).toBe("12.345679");
      expect(displayCell({ ...v, unitKind: "percentage", value: "87.500000" }, createLabels("en"))).toBe("87.5%");
      expect(v.value).toBe("100.000000");
    });
  },
);
