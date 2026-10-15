// REQ-S13-005, REQ-S13-009, REQ-S13-008 (ADR-0046 §2, §3): the PPTX writer, read back from the slides' XML. A
// gate-pack-shaped document (the `gate_pack` assembler's criteria table: one row per criterion of the gate with its
// state and evidence) must yield every criterion in the presentation. Synthetic content only; the gate is a product
// gate (a business approval inside the product), and nothing here approves anything.
import JSZip from "jszip";
import type { ReportDocument, ReportValue } from "@mth/shared/schemas";
import { describe, expect, it } from "vitest";
import { renderPptx } from "./pptx.ts";
import { options, T_ID } from "./test-fixtures.ts";

const rid = (n: number) => `0190b000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (value: string): ReportValue => ({
  type: "text",
  value,
  authored: "system",
  validation: "validated",
  reason: null,
});
const code = (value: string | null, prefix: string): ReportValue =>
  value === null
    ? { type: "code", value: null, labelKey: null, validation: "unknown", reason: "not_computable" }
    : { type: "code", value, labelKey: `${prefix}.${value}`, validation: "validated", reason: null };
const count = (value: number): ReportValue => ({ type: "count", value, validation: "validated", reason: null });

const CRITERIA = Array.from({ length: 14 }, (_, i) => ({
  key: `g2_criterion_${i + 1}`,
  en: `Synthetic G2 criterion ${i + 1}: the diagnostic evidence is recorded`,
  ar: `معيار تجريبي ${i + 1} للبوابة G2: دليل التشخيص مسجل`,
  state: i % 3 === 0 ? null : i % 3 === 1 ? "met" : "not_met",
}));

function gatePack(): ReportDocument {
  return {
    schemaVersion: 1,
    definitionCode: "gate_pack",
    transformation: { id: T_ID, code: "TR-001", name: "Synthetic roaming transformation" },
    subject: { type: "gate_instance", id: rid(500), code: "G2", label: "TR-001 G2" },
    period: null,
    asOf: "2026-10-15T10:00:00.000Z",
    methodology: { versionId: rid(900), key: "playbook", versionNo: 1 },
    approvalState: "pending",
    sections: [
      {
        key: "gate",
        titleKey: "report.gate_pack.title",
        kind: "fields",
        sources: [],
        fields: [{ key: "gate", labelKey: "report.gate_pack.gate", value: code("G2", "report.gate") }],
      },
      {
        key: "criteria",
        titleKey: "report.gate_pack.criteria",
        kind: "table",
        sources: [],
        columns: [
          { key: "ordinal", labelKey: "report.gate_pack.ordinal", valueKind: "count", unitKind: null },
          { key: "criterion", labelKey: "report.gate_pack.criterion", valueKind: "code", unitKind: null },
          { key: "label_en", labelKey: "report.gate_pack.label_en", valueKind: "text", unitKind: null },
          { key: "label_ar", labelKey: "report.gate_pack.label_ar", valueKind: "text", unitKind: null },
          { key: "state", labelKey: "report.gate_pack.state", valueKind: "code", unitKind: null },
          { key: "missing_count", labelKey: "report.gate_pack.missing_count", valueKind: "count", unitKind: null },
          { key: "missing", labelKey: "report.gate_pack.missing", valueKind: "text", unitKind: null },
          { key: "review_finding", labelKey: "report.gate_pack.review_finding", valueKind: "text", unitKind: null },
        ],
        rows: CRITERIA.map((c, i) => ({
          recordType: "gate_criterion",
          recordId: rid(i + 1),
          recordVersion: 1,
          cells: [
            count(i + 1),
            { type: "code", value: c.key, labelKey: null, validation: "validated", reason: null },
            text(c.en),
            text(c.ar),
            code(c.state, "report.criterion_state"),
            count(i % 2),
            text(i % 2 === 0 ? "None" : "Evidence register entry"),
            text("Synthetic review finding"),
          ],
        })),
        totals: [],
        emptyKey: "report.empty.no_records",
      },
      {
        key: "evidence",
        titleKey: "report.gate_pack.evidence",
        kind: "table",
        sources: [],
        columns: [{ key: "title", labelKey: "report.gate_pack.evidence_title", valueKind: "text", unitKind: null }],
        rows: [],
        totals: [],
        emptyKey: "report.empty.no_records",
      },
    ],
  };
}

async function slides(language: "en" | "ar") {
  const r = await renderPptx(gatePack(), { ...options("pptx", language), title: "Gate pack" });
  const zip = await JSZip.loadAsync(r.bytes);
  const names = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));
  const xml = await Promise.all(names.map((n) => zip.file(n)!.async("string")));
  const textsOf = (x: string) => [...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]!);
  return { r, xml, texts: xml.map(textsOf) };
}

const unescape = (s: string) =>
  s
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

describe("renderPptx: a gate pack contains each criterion of the gate (REQ-S13-005)", () => {
  for (const language of ["en", "ar"] as const)
    it(`${language}: every criterion with its labels and state, over several slides with the header repeated`, async () => {
      const { r, texts } = await slides(language);
      expect(r.contentType).toBe("application/vnd.openxmlformats-officedocument.presentationml.presentation");
      const all = texts.flat().map(unescape);
      for (const c of CRITERIA) {
        expect(all, c.key).toContain(c.key);
        expect(all, c.key).toContain(c.en);
        expect(all, c.key).toContain(c.ar);
      }
      // States: a criterion without a computed state prints Unknown (never "met").
      expect(all.filter((t) => t === (language === "en" ? "Unknown" : "غير معروف")).length).toBeGreaterThanOrEqual(5);
      // The criteria table spans more than one slide; each of its slides repeats the header.
      const header = language === "en" ? "Label en" : "Label en";
      const withHeader = texts.filter((t) => t.includes(header)).length;
      expect(withHeader).toBeGreaterThanOrEqual(2);
      // The empty evidence table prints its empty line.
      expect(all).toContain(language === "en" ? "No records" : "لا توجد سجلات");
    });
});

describe("renderPptx: direction and labels (REQ-S13-009, REQ-S13-008)", () => {
  it("Arabic: right-to-left paragraphs with lang ar-SA, right-aligned, mirrored tables; the Arabic Draft line on every slide", async () => {
    const { xml, texts } = await slides("ar");
    const body = xml.join("");
    expect(body).toMatch(/<a:pPr[^>]*rtl="1"/);
    expect(body).toMatch(/lang="ar-SA"/);
    expect(body).toMatch(/algn="r"/);
    expect(body).toContain('typeface="IBM Plex Sans Arabic"');
    for (const t of texts) expect(t).toContain("مسودة — ليس تقريراً صادراً");
    // Mirrored: the last column's header comes first in the row's XML (pptxgenjs writes cells left to right).
    const row = /<a:tr[\s\S]*?<\/a:tr>/.exec(xml.find((x) => x.includes("Ordinal"))!)![0];
    const cells = [...row.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    expect(cells[0]).toBe("Review finding");
    expect(cells.at(-1)).toBe("Ordinal");
  });

  it("English: left to right, IBM Plex Sans, slide numbers and the Draft line on every slide", async () => {
    const { xml, texts } = await slides("en");
    const body = xml.join("");
    expect(body).not.toMatch(/rtl="1"/);
    expect(body).toContain('typeface="IBM Plex Sans"');
    texts.forEach((t, i) => {
      expect(t).toContain("Draft — not an issued report");
      expect(t).toContain(`Slide ${i + 1} of ${texts.length}`);
    });
    const row = /<a:tr[\s\S]*?<\/a:tr>/.exec(xml.find((x) => x.includes("Ordinal"))!)![0];
    expect([...row.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1])[0]).toBe("Ordinal");
  });

  it("a provisional value prints Provisional and مؤقت", async () => {
    const doc = gatePack();
    const provisional: ReportValue = {
      type: "decimal",
      value: "1250.5",
      unitKind: "currency",
      currency: "SAR",
      valueBasis: "submitted",
      validation: "provisional",
      reason: null,
    };
    doc.sections[0] = {
      key: "gate",
      titleKey: "report.gate_pack.title",
      kind: "fields",
      sources: [],
      fields: [{ key: "value", labelKey: "report.benefits.value", value: provisional }],
    };
    for (const [language, label] of [
      ["en", "Provisional"],
      ["ar", "مؤقت"],
    ] as const) {
      const r = await renderPptx(doc, options("pptx", language));
      const zip = await JSZip.loadAsync(r.bytes);
      const xml = await zip.file("ppt/slides/slide2.xml")!.async("string");
      expect(xml).toContain(label);
    }
  });
});
