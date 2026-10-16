// Text scan (c) (ADR-0049 §7; T-DG5-BE-R2, p5-work-split §I.4): the report and export templates.
//  - the literal strings of packages/reporting/src, apps/api/src/modules/reporting, the worker's export runner and the
//    shared report label tables (packages/shared/src/reports), and the values of the label tables the renderers use
//    (FRAME_LABELS, REPORT_CONTENT_LABELS) in en and ar;
//  - the rendered text of one sample export per format (PDF, DOCX, XLSX, PPTX, CSV) in en and ar, rendered with the
//    production label table, the default branding and the provenance footer the worker reads from the database (the
//    verbatim B0004 statement, 0092);
//  - REQ-PB-001: no "official PMI standard", "PMI certified" or equivalent; REQ-S21-001: no DG0-DG7.
// A planted claim and a planted gate name in a cell are found in every format, so the read-back is proven to see the
// text. Every value is SYNTHETIC; nothing here approves anything.
import { REPORT_CONTENT_LABELS } from "@mth/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME_LABELS } from "../../../../../packages/reporting/src/labels.ts";
import { EXPORT_FORMATS, type ExportFormat } from "../../../../../packages/reporting/src/model.ts";
import { render } from "../../../../../packages/reporting/src/render.ts";
import { options, sampleDocument } from "../../../../../packages/reporting/src/test-fixtures.ts";
import { provenanceFooter } from "../../../../worker/src/reports/export-runner.ts";
import { startApi, type TestApi } from "../../support/harness.ts";
import { renderedTexts } from "../../text-scan/rendered.ts";
import { literalsUnder, scan, unreported, type ProductText } from "../../text-scan/scan.ts";

let api: TestApi;
beforeAll(async () => {
  api = await startApi();
}, 120_000);
afterAll(() => api.close());

const ROWS = [
  { code: "R-001", description: "Synthetic roaming partner settlement delay", amount: "1250000.00" },
  { code: "R-002", description: "تأخر تسوية شريك التجوال (بيانات اصطناعية)", amount: "980000.50", provisional: true },
];

async function sample(format: ExportFormat, language: "en" | "ar", rows = ROWS) {
  const provenance = await provenanceFooter(api.db, language);
  const base = options(format, language);
  const result = await render(sampleDocument(rows, "2230000.50"), {
    ...base,
    branding: {
      productName: language === "ar" ? "منصة موبايلي للتحوّل" : "Mobily Transformation Hub",
      provenance,
    },
    labels: REPORT_CONTENT_LABELS,
  });
  return { provenance, texts: await renderedTexts(`sample.${language}.${format}`, format, result.bytes) };
}

describe("the template literals and label tables", () => {
  it("no literal of the report and export code claims official PMI status or names DG0-DG7", () => {
    const literals = literalsUnder([
      "packages/reporting/src",
      "apps/api/src/modules/reporting",
      "apps/worker/src/reports",
      "packages/shared/src/reports",
    ]);
    expect(literals.length).toBeGreaterThan(1000);
    expect(unreported(scan(literals))).toEqual([]);
  });

  it.each(["en", "ar"] as const)("no label of the frame and content tables does (%s)", (lang) => {
    const labels: ProductText[] = [
      ...Object.entries(FRAME_LABELS[lang]).map(([k, text]) => ({ where: `FRAME_LABELS.${lang}.${k}`, text })),
      ...Object.entries(REPORT_CONTENT_LABELS[lang]).map(([k, text]) => ({
        where: `REPORT_CONTENT_LABELS.${lang}.${k}`,
        text,
      })),
    ];
    expect(labels.length).toBeGreaterThan(100);
    expect(scan(labels)).toEqual([]);
  });
});

describe.each(EXPORT_FORMATS.flatMap((f) => (["en", "ar"] as const).map((l) => [f, l] as const)))(
  "a rendered sample export: %s, %s",
  (format, language) => {
    it("REQ-PB-001 and REQ-S21-001: its text has no official-PMI claim and no DG0-DG7", async () => {
      const { provenance, texts } = await sample(format, language);
      expect(texts.length).toBeGreaterThan(3);
      // The read-back sees the content (the synthetic row codes are in every format).
      expect(texts.some((t) => t.text.includes("R-001"))).toBe(true);
      // The provenance footer (B0004) is a true statement and passes the claim rule.
      expect(provenance).not.toBeNull();
      expect(scan([{ where: "B0004", text: provenance! }])).toEqual([]);
      expect(scan(texts)).toEqual([]);
    });

    it("a planted claim and a planted gate name in a cell are found (the scan sees the rendered text)", async () => {
      const planted = [
        {
          code: "R-009",
          description: language === "ar" ? "منهجية معتمدة من PMI" : "A PMI certified product",
          amount: "1.00",
        },
        { code: "R-010", description: "Released at DG7", amount: "2.00" },
      ];
      const { texts } = await sample(format, language, planted);
      expect(new Set(scan(texts).map((v) => v.rule))).toEqual(new Set(["official_pmi_claim", "engineering_gate"]));
    });
  },
);
