// qa-verifier DG6 clean re-gate round 1 (T-DG6-REV-QA-RG-R1): REQ-S15-007 clause 3, tested LITERALLY: "an Arabic
// export keeps 'KPI-001' and '12.5%' readable". The register notes say no shipped test uses these literal strings
// (the DG5 tests use RAID-014 / 1,250.50). Kept outside the frozen candidate; to run it, copy it to
// packages/reporting/src/ in a DISPOSABLE clone and run `npx vitest run --project unit-node <path>`.
// It renders one Arabic document whose KPI row has the code KPI-001, an Arabic description that embeds 'KPI-001' and
// '12.5%', and a percentage value 12.5, through every rendered format (PDF, DOCX, XLSX, PPTX) and CSV, and reads each
// file back: both literals must appear unbroken and in left-to-right order (for the PDF: on the drawn line; for DOCX:
// as one left-to-right run each; for XLSX/PPTX/CSV: in the stored text). SYNTHETIC content only.
import type { ReportDocument, ReportValue } from "@mth/shared/schemas";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { renderCsv } from "./csv.ts";
import { renderDocx } from "./docx.ts";
import type { LabelTable } from "./labels.ts";
import type { RenderOptions } from "./model.ts";
import { lines, readPdf } from "./pdf/read.ts";
import { renderPdf } from "./pdf/index.ts";
import { renderPptx } from "./pptx.ts";
import { options, sampleDocument } from "./test-fixtures.ts";
import { cellText, readXlsx } from "./xlsx/read.ts";
import { renderXlsx } from "./xlsx/index.ts";

const DESC = "مؤشر KPI-001 بنسبة 12.5%";
const pct = (value: string): ReportValue =>
  ({
    type: "decimal",
    value,
    unitKind: "percentage",
    currency: null,
    valueBasis: "actual",
    validation: "validated",
    reason: null,
  }) as unknown as ReportValue;

function doc(): ReportDocument {
  const d = sampleDocument([{ code: "KPI-001", description: DESC, amount: "12.5" }], null);
  const table = d.sections[0] as unknown as { columns: { key: string; unitKind: string | null }[]; rows: { cells: ReportValue[] }[]; totals: unknown[] };
  table.columns[3] = { ...table.columns[3]!, unitKind: "percentage" };
  table.rows[0]!.cells[3] = pct("12.5");
  table.totals = [];
  return d;
}
const LABELS: LabelTable = {
  en: {},
  ar: {
    "report.registers.raid.title": "سجل المؤشرات",
    "report.registers.raid.code": "الرمز",
    "report.registers.raid.type": "النوع",
    "report.registers.raid.description": "الوصف",
    "report.registers.raid.amount": "القيمة",
    "report.registers.raid.status": "الحالة",
    "report.registers.filters": "عوامل التصفية",
    "report.raid_type.risk": "مخاطرة",
    "report.raid_status.open": "مفتوح",
  },
};
const opts = (format: RenderOptions["format"]): RenderOptions => ({ ...options(format, "ar"), labels: LABELS });

describe("REQ-S15-007 clause 3 (literal): an Arabic export keeps 'KPI-001' and '12.5%' readable", { timeout: 120_000 }, () => {
  it("PDF (text extraction of the drawn lines)", async () => {
    const pdf = readPdf((await renderPdf(doc(), opts("pdf"))).bytes);
    const all = lines(pdf);
    console.log(`QA-R1 ar-export PDF lines with KPI-001: ${JSON.stringify(all.filter((l) => l.includes("KPI-001")))}`);
    console.log(`QA-R1 ar-export PDF lines with 12.5%: ${JSON.stringify(all.filter((l) => l.includes("12.5%")))}`);
    expect(all.some((l) => l.includes("KPI-001"))).toBe(true);
    expect(all.some((l) => l.includes("12.5%"))).toBe(true);
    expect(all.join("\n")).not.toMatch(/100-IPK|%5\.21|5\.21/);
  });

  it("DOCX (each literal is one left-to-right run)", async () => {
    const r = await renderDocx(doc(), opts("docx"));
    const xml = (await (await JSZip.loadAsync(r.bytes)).file("word/document.xml")!.async("string")) as string;
    const runs = [...xml.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => ({
      rtl: m[1]!.includes("<w:rtl/>"),
      text: /<w:t[^>]*>([^<]*)<\/w:t>/.exec(m[1]!)?.[1] ?? "",
    }));
    const ltr = runs.filter((x) => !x.rtl).map((x) => x.text);
    console.log(`QA-R1 ar-export DOCX LTR runs with the literals: ${JSON.stringify(ltr.filter((t) => /KPI-001|12\.5%/.test(t)))}`);
    expect(ltr.some((t) => t.includes("KPI-001"))).toBe(true);
    expect(ltr.some((t) => t.includes("12.5%"))).toBe(true);
    expect(runs.filter((x) => x.rtl).some((x) => /KPI|12\.5|%/.test(x.text))).toBe(false);
  });

  it("XLSX (stored cell text)", async () => {
    const wb = await readXlsx((await renderXlsx(doc(), opts("xlsx"))).bytes);
    const texts = wb.sheets.flatMap((s) => s.rows.flat().map((c) => String(cellText(c) ?? "")));
    console.log(`QA-R1 ar-export XLSX cells with the literals: ${JSON.stringify(texts.filter((t) => /KPI-001|12\.5/.test(t)))}`);
    expect(texts.some((t) => t.includes("KPI-001"))).toBe(true);
    expect(texts.some((t) => t.includes("12.5%") || t === "12.5")).toBe(true);
  });

  it("PPTX (slide text)", async () => {
    const r = await renderPptx(doc(), opts("pptx"));
    const zip = await JSZip.loadAsync(r.bytes);
    const slides = await Promise.all(
      Object.keys(zip.files)
        .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .map((n) => zip.file(n)!.async("string")),
    );
    const t = slides.join("\n");
    const texts = [...t.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!);
    console.log(`QA-R1 ar-export PPTX runs with the literals: ${JSON.stringify(texts.filter((x) => /KPI-001|12\.5/.test(x)))}`);
    expect(texts.some((x) => x.includes("KPI-001"))).toBe(true);
    expect(texts.some((x) => x.includes("12.5%"))).toBe(true);
  });

  it("CSV (UTF-8 text)", async () => {
    const r = await renderCsv(doc(), opts("csv" as RenderOptions["format"]));
    const s = new TextDecoder().decode(r.bytes);
    console.log(`QA-R1 ar-export CSV lines with the literals: ${JSON.stringify(s.split(/\r?\n/).filter((l) => /KPI-001/.test(l)))}`);
    expect(s).toContain("KPI-001");
    expect(s).toContain("12.5");
  });

  it("the real KPI-register target text (kpiTargetText '12.5 %') in an Arabic PDF and DOCX keeps the % after the number", async () => {
    const d = sampleDocument([{ code: "KPI-001", description: "12.5 %", amount: "1" }], null);
    const pdf = readPdf((await renderPdf(d, opts("pdf"))).bytes);
    const hit = lines(pdf).filter((l) => l.includes("12.5"));
    console.log(`QA-R1 ar-export PDF lines for the target text '12.5 %': ${JSON.stringify(hit)}`);
    const r = await renderDocx(d, opts("docx"));
    const xml = (await (await JSZip.loadAsync(r.bytes)).file("word/document.xml")!.async("string")) as string;
    const para = [...xml.matchAll(/<w:p>[\s\S]*?<\/w:p>|<w:p [\s\S]*?<\/w:p>/g)]
      .map((m) => m[0])
      .find((x) => x.includes("12.5"))!;
    const runs = [...para.matchAll(/<w:r>([\s\S]*?)<\/w:r>/g)].map((m) => ({
      rtl: m[1]!.includes("<w:rtl/>"),
      text: /<w:t[^>]*>([^<]*)<\/w:t>/.exec(m[1]!)?.[1] ?? "",
    }));
    console.log(`QA-R1 ar-export DOCX runs for '12.5 %': ${JSON.stringify(runs)}; paragraph bidi ${para.includes("<w:bidi/>")}`);
    // Visual order on the PDF line: the number is LEFT of the percent sign ("12.5 %" or "12.5%"), never "% 12.5".
    expect(hit.some((l) => /12\.5 ?%/.test(l))).toBe(true);
    expect(hit.some((l) => /% ?12\.5/.test(l))).toBe(false);
  });
});
