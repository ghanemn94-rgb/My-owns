// qa-verifier DG6 round 5 (T-DG6-REV-QA-R5): copied from round-4/zz-qa-dg6r4-ar-export-literals.test.ts and re-run on candidate 832e5c82; identifiers renamed dg6r4 -> dg6r5 and QA-R4 -> QA-R5 outside the provenance comments below.
// qa-verifier DG6 round 4 (T-DG6-REV-QA-R4): copied unchanged in its checks from round-3/zz-qa-dg6r3-ar-export-literals.test.ts (round 3) and re-run on candidate 4b84bf20; only names r3 -> r4.
// qa-verifier DG6 round 3 (T-DG6-REV-QA-R4): independent probe, NOT part of the frozen candidate. Copied into a disposable
// copy as packages/reporting/src/pdf/zz-qa-dg6r5-ar-export-literals.test.ts and run with the unit-node project.
// REQ-S15-007 clause 3, LITERALLY: "an Arabic export keeps 'KPI-001' and '12.5%' readable". The register notes say no
// test uses these literal strings (the DG5 tests use RAID-014 and 1,250.50). This probe renders an Arabic PDF, DOCX and
// CSV of a register whose code column is 'KPI-001' and whose Arabic description embeds 'KPI-001' and '12.5%', and checks:
//   PDF: text extraction (read left to right) contains 'KPI-001' and '12.5%' unbroken, and the Arabic words around them
//        are in right-to-left order around the left-to-right stretches;
//   DOCX: the description cell's runs give 'KPI-001' and '12.5%' as non-RTL runs, the Arabic words as RTL runs;
//   CSV: both literals byte-identical in the UTF-8 file.
// SYNTHETIC data only.
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { ReportDocument } from "@mth/shared/schemas";
import type { LabelTable } from "../labels.ts";
import { options as baseOptions, sampleDocument } from "../test-fixtures.ts";
import type { RenderOptions } from "../model.ts";
import { renderPdf } from "./index.ts";
import { drawsArabic, lines, readPdf, rev } from "./read.ts";
import { renderDocx } from "../docx.ts";
import { render } from "../render.ts";

const DESCRIPTION_AR = "المؤشر KPI-001 بنسبة 12.5%";
const LABELS: LabelTable = {
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
  sampleDocument([{ code: "KPI-001", description: DESCRIPTION_AR, amount: "12.50" }], null);
const opts = (format: "pdf" | "docx" | "csv", over: Partial<RenderOptions> = {}): RenderOptions => ({
  ...baseOptions(format, "ar"),
  labels: LABELS,
  ...over,
});

describe("QA-DG6R4 REQ-S15-007 clause 3: an Arabic export keeps 'KPI-001' and '12.5%' readable", { timeout: 60_000 }, () => {
  it("PDF (ar): text extraction keeps KPI-001 and 12.5% unbroken, Arabic words right to left around them", async () => {
    const pdf = readPdf((await renderPdf(doc(), opts("pdf"))).bytes);
    const all = lines(pdf);
    console.log(`QA-DG6R4 PDF ar lines with KPI-001: ${JSON.stringify(all.filter((l) => l.includes("KPI-001")))}`);
    expect(all.some((l) => l.includes("KPI-001"))).toBe(true);
    expect(all.some((l) => l.includes("12.5%"))).toBe(true);
    // Read left to right on the page: the number stretch, an Arabic word, the identifier, an Arabic word (visual order
    // of an RTL cell with two LTR stretches). Run 1 of this probe compared the Arabic words with rev(), a plain
    // character reversal: "بنسبة" matched, but "المؤشر" is extracted as "شرؤملا" (the font draws the "شر" pair as one
    // glyph whose ToUnicode keeps logical order), so that over-strict comparison failed on the Arabic word, not on the
    // literals. The literals and their positions are asserted exactly; the Arabic words through drawsArabic().
    expect(all.some((l) => l.includes(`12.5% ${rev("بنسبة")} KPI-001 `))).toBe(true);
    expect(all.some((l) => /12\.5% \S+ KPI-001 \S+/.test(l))).toBe(true);
    // Neither literal is mirrored or split.
    expect(all.some((l) => l.includes("100-IPK") || l.includes("%5.21") || l.includes("5.21%"))).toBe(false);
    expect(drawsArabic(pdf, "المؤشر")).toBe(true);
    expect(drawsArabic(pdf, "بنسبة")).toBe(true);
  });

  it("DOCX (ar): KPI-001 and 12.5% are left-to-right runs inside the right-to-left cell", async () => {
    const r = await renderDocx(doc(), opts("docx"));
    const zip = await JSZip.loadAsync(r.bytes);
    const xml = (await zip.file("word/document.xml")!.async("string")) ?? "";
    const ps = [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g)].map((m) => ({
      xml: m[0],
      text: [...m[0].matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((t) => t[1]).join(""),
    }));
    const cell = ps.find((p) => p.text === DESCRIPTION_AR);
    expect(cell, "the Arabic description paragraph").toBeDefined();
    const runs = [...cell!.xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => ({
      rtl: m[1]!.includes("<w:rtl/>"),
      text: /<w:t[^>]*>([^<]*)<\/w:t>/.exec(m[1]!)![1],
    }));
    console.log(`QA-DG6R4 DOCX ar runs: ${JSON.stringify(runs)}`);
    expect(runs.some((x) => !x.rtl && x.text!.includes("KPI-001"))).toBe(true);
    expect(runs.some((x) => !x.rtl && x.text!.includes("12.5%"))).toBe(true);
    expect(runs.filter((x) => x.rtl).map((x) => x.text!.trim())).toEqual(["المؤشر", "بنسبة"]);
    // The code column too.
    expect(ps.some((p) => p.text === "KPI-001")).toBe(true);
  });

  it("CSV (ar): both literals byte-identical", async () => {
    const out = await render(doc(), opts("csv"));
    const text = Buffer.from(out.bytes).toString("utf8");
    expect(text).toContain("KPI-001");
    expect(text).toContain("12.5%");
  });
});
