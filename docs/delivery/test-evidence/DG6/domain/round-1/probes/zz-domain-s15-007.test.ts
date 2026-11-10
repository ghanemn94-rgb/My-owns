// domain-reviewer probe (not part of the candidate): REQ-S15-007 clause 3 with the literal strings 'KPI-001' and '12.5%'.
import type { ReportDocument } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import type { LabelTable } from "../labels.ts";
import { render } from "../render.ts";
import { options as baseOptions, sampleDocument } from "../test-fixtures.ts";
import { lines, readPdf, rev } from "./read.ts";
import { readOoxml, xmlTexts } from "../ooxml-read.ts";
import { markLtrStretches } from "../layout/bidi.ts";

const AR = "المؤشر KPI-001 بلغ 12.5% هذا الشهر";
const LABELS: LabelTable = {
  en: { "report.registers.raid.title": "RAID register", "report.registers.raid.code": "Code", "report.registers.raid.type": "Type", "report.registers.raid.description": "Description", "report.registers.raid.amount": "Amount", "report.registers.raid.status": "Status", "report.registers.filters": "Filters", "report.raid_type.risk": "Risk", "report.raid_status.open": "Open" },
  ar: { "report.registers.raid.title": "سجل المخاطر والقضايا", "report.registers.raid.code": "الرمز", "report.registers.raid.type": "النوع", "report.registers.raid.description": "الوصف", "report.registers.raid.amount": "المبلغ", "report.registers.raid.status": "الحالة", "report.registers.filters": "عوامل التصفية", "report.raid_type.risk": "مخاطرة", "report.raid_status.open": "مفتوح" },
};
const doc = (): ReportDocument => sampleDocument([{ code: "KPI-001", description: AR, amount: "12.5" }], null);

describe("REQ-S15-007 clause 3 (literal): an Arabic export keeps 'KPI-001' and '12.5%' readable", { timeout: 120_000 }, () => {
  it("markLtrStretches isolates both as LTR runs", () => {
    const out = markLtrStretches(AR, "rtl");
    console.log("marked:", JSON.stringify(out));
    expect(out).toContain("‎KPI-001‎");
    expect(out).toContain("‎12.5%‎");
  });
  it("PDF (ar): text extraction reads KPI-001 and 12.5% in left-to-right order", async () => {
    const r = await render(doc(), { ...baseOptions("pdf", "ar"), labels: LABELS });
    const all = lines(readPdf(r.bytes));
    const hit = all.filter((l) => l.includes("KPI-001") || l.includes("12.5%"));
    console.log("pdf lines:", JSON.stringify(hit));
    expect(all.some((l) => l.includes(`12.5% ${rev("بلغ")} KPI-001`))).toBe(true);
  });
  for (const fmt of ["docx", "xlsx", "pptx"] as const) {
    it(`${fmt} (ar): the cell text keeps KPI-001 and 12.5% intact`, async () => {
      const r = await render(doc(), { ...baseOptions(fmt, "ar"), labels: LABELS });
      const parts = await readOoxml(r.bytes, /\.xml$/);
      const texts = [...parts.parts.values()].flatMap((x) => (fmt === "xlsx" ? [...x.matchAll(/<t[^>]*>([^<]*)<\/t>/g)].map((m) => m[1]!) : xmlTexts(x)));
      const joined = texts.join(" | ");
      const hit = texts.filter((t) => t.includes("KPI-001") || t.includes("12.5"));
      console.log(fmt, "texts:", JSON.stringify(hit.slice(0, 6)));
      expect(joined).toContain("KPI-001");
      expect(joined).toMatch(/12\.5‎?%|12\.5%/);
    });
  }
  it("csv (ar): the cell text keeps KPI-001 and 12.5% intact", async () => {
    const r = await render(doc(), { ...baseOptions("csv", "ar"), labels: LABELS });
    const s = new TextDecoder().decode(r.bytes);
    console.log("csv:", JSON.stringify(s.split("\n").filter((l) => l.includes("KPI-001"))));
    expect(s).toContain("KPI-001");
    expect(s).toContain("12.5%");
  });
});
