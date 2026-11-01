// qa-verifier DG6 round 1 probe (T-DG6-REV-QA-R1), NOT part of the candidate. Copied into a disposable copy as
// packages/reporting/src/zz-qa-dg6r1-arabic-export-literals.test.ts (unit-node project).
// REQ-S15-007 clause 3, tested LITERALLY: "an Arabic export keeps 'KPI-001' and '12.5%' readable". The register notes
// say no test uses the literal strings (the DG5 tests use RAID-014 and 1,250.50). This renders an Arabic document with
// the KPI code KPI-001 (in its own cell and inside an Arabic sentence) and the percentage 12.5 through the product's
// own renderer in every rendered format, and reads the text back: each identifier must appear contiguous, in its own
// left-to-right order (not reversed, not split), with the Arabic text around it. Synthetic data only.
import type { ReportDocument, ReportValue } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import type { LabelTable } from "./labels.ts";
import { render, RENDERED_FORMATS } from "./render.ts";
import { options, T_ID } from "./test-fixtures.ts";
import { lines, plain, readPdf } from "./pdf/read.ts";
import { readXlsx, cellText } from "./xlsx/read.ts";
import { readOoxml, xmlTexts } from "./ooxml-read.ts";

const SENTENCE_AR = "المؤشر KPI-001 بلغ 12.5% هذا الشهر";
const LABELS: LabelTable = {
  en: { "t.title": "KPIs", "t.code": "Code", "t.name": "Name", "t.value": "Value" },
  ar: { "t.title": "مؤشرات الأداء", "t.code": "الرمز", "t.name": "الاسم", "t.value": "القيمة" },
};
const txt = (value: string, authored: "user" | "system" = "user"): ReportValue => ({
  type: "text",
  value,
  authored,
  validation: "validated",
  reason: null,
});
const pct = (value: string): ReportValue =>
  ({ type: "decimal", value, unitKind: "percentage", currency: null, valueBasis: "actual", validation: "validated", reason: null }) as unknown as ReportValue;

const doc = (): ReportDocument => ({
  schemaVersion: 1,
  definitionCode: "registers",
  transformation: { id: T_ID, code: "TR-001", name: "تحول تجريبي" },
  subject: { type: "transformation", id: T_ID, code: "TR-001", label: "تحول تجريبي" },
  period: null,
  asOf: "2026-10-15T10:00:00.000Z",
  methodology: { versionId: "0190a000-0000-7000-8000-000000000900", key: "playbook", versionNo: 3 },
  approvalState: "not_applicable",
  sections: [
    {
      key: "kpis",
      titleKey: "t.title",
      kind: "table",
      sources: [],
      columns: [
        { key: "code", labelKey: "t.code", valueKind: "text", unitKind: null },
        { key: "name", labelKey: "t.name", valueKind: "text", unitKind: null },
        { key: "value", labelKey: "t.value", valueKind: "decimal", unitKind: "percentage" },
      ],
      rows: [
        {
          recordType: "kpi_definition",
          recordId: "0190a000-0000-7000-8000-000000000001",
          recordVersion: 1,
          cells: [txt("KPI-001", "system"), txt(SENTENCE_AR), pct("12.5")],
        },
      ],
      totals: [],
      emptyKey: "report.empty.no_records",
    },
  ],
} as unknown as ReportDocument);

const strip = (s: string) => s.replace(/[‎‏⁦-⁩‪-‮؜]/g, "");

describe("QA-DG6R1 probe: REQ-S15-007 an Arabic export keeps 'KPI-001' and '12.5%' readable", () => {
  it("lists the rendered formats", () => {
    console.log(`PROBE formats: ${RENDERED_FORMATS.join(",")}`);
    expect(RENDERED_FORMATS.length).toBeGreaterThan(0);
  });
  for (const format of ["pdf", "xlsx", "csv", "docx", "pptx"] as const) {
    it(`${format} (ar): 'KPI-001' and '12.5%' appear contiguous and in reading order`, async () => {
      if (!(RENDERED_FORMATS as readonly string[]).includes(format)) {
        console.log(`PROBE ${format}: not a rendered format`);
        return;
      }
      const result = await render(doc(), { ...options(format, "ar"), title: "مؤشرات", labels: LABELS } as never);
      let texts: string[] = [];
      if (format === "pdf") texts = lines(readPdf(result.bytes)).map(plain);
      else if (format === "xlsx") {
        const wb = await readXlsx(result.bytes);
        texts = wb.sheets.flatMap((s) => s.rows.flatMap((r) => r.map((c) => cellText(c) ?? "")));
      } else if (format === "csv") texts = new TextDecoder().decode(result.bytes).split(/\r?\n/);
      else {
        const parts = await readOoxml(result.bytes, format === "docx" ? /^word\/document\.xml$/ : /^ppt\/slides\/.*\.xml$/);
        texts = [...parts.parts.values()].flatMap((x) => xmlTexts(x));
      }
      const joined = texts.map(strip).join("\n");
      const hasKpi = /(^|[^A-Za-z0-9-])KPI-001([^0-9]|$)/m.test(joined);
      const hasPct = /(^|[^0-9.])12\.5%/m.test(joined);
      const reversed = joined.includes("100-IPK") || joined.includes("%5.21");
      console.log(
        `PROBE ${format}: KPI-001 ${hasKpi}, 12.5% ${hasPct}, reversed ${reversed}; lines with them: ${JSON.stringify(
          texts.filter((t) => /KPI|12[.,]5|5\.21|IPK/.test(t)).slice(0, 8),
        )}`,
      );
      expect(hasKpi, `${format}: KPI-001 readable`).toBe(true);
      expect(hasPct, `${format}: 12.5% readable`).toBe(true);
      expect(reversed, `${format}: no reversed identifier`).toBe(false);
    }, 120_000);
  }
});
