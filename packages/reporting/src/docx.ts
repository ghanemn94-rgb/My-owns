// The DOCX writer (ADR-0046 §2, §3, §9; REQ-S13-005, REQ-S13-008, REQ-S13-009), over `docx`.
//
// The same paged view as the PDF (layout/blocks.ts): the header block, every section in content order, the legend,
// an "About this file" section, and a footer with the issue line ("Draft — not an issued report" for a generated
// snapshot) and "Page n of m" as page fields. The header carries the product name it is given and the
// configured report header; the footer the configured report footer and the provenance statement (B0004), all read by
// the worker from slice I's branding port at generation time (T-DG5-BE-R).
//
// Direction: in Arabic every paragraph is `bidirectional` (`<w:bidi/>`), tables are `visuallyRightToLeft`
// (`<w:bidiVisual/>`) and paragraphs are aligned to their start; runs holding right-to-left script are `rightToLeft`
// (`<w:rtl/>`), while identifiers, numbers and Latin text stay left-to-right runs, so the word processor's bidi
// algorithm keeps `RAID-014` and `1,250.50` in their own order. Fonts: the complex-script font is IBM Plex Sans Arabic
// and the ASCII/high-ANSI font IBM Plex Sans Arabic (Arabic) or IBM Plex Sans (English); `w:lang` is `ar-SA`/`en-GB`.
// The word processor shapes Arabic itself.
//
// Font embedding (ADR-0046 §3): the two families are NAMED, not embedded. Embedding is allowed only when a test proves
// the embedded file opens in LibreOffice 24.2 without a font warning; this task did not establish that proof, so the
// file says so in its "About this file" section (`export.fonts_note.docx`), and a viewer without the families shows a
// substitute font.
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  Packer,
  PageNumber,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type ParagraphChild,
} from "docx";
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { FONT_FAMILIES } from "./fonts.ts";
import { createLabels, type ExportLanguage } from "./labels.ts";
import { pagedDocument, type Block, type TableBlock } from "./layout/blocks.ts";
import { withPagedLabels } from "./layout/values.ts";
import { EXPORT_CONTENT_TYPES, issueLine, RenderError, type RenderOptions, type RenderResult } from "./model.ts";

/** A run boundary: a stretch of right-to-left script (with the spaces and punctuation inside it) or of anything else. */
const RTL_STRETCH =
  /[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]+(?:[\s\u060C\u061B\u061F().\u060C:-]+[\u0590-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]+)*/g;

interface RunStyle {
  readonly bold?: boolean;
  readonly size?: number;
  readonly color?: string;
}

/** The text of one line as runs: right-to-left script stretches as `rightToLeft` runs, the rest left to right. */
export function scriptRuns(text: string, language: ExportLanguage, style: RunStyle = {}): TextRun[] {
  const runs: TextRun[] = [];
  const font = {
    ascii: language === "ar" ? FONT_FAMILIES.arabic : FONT_FAMILIES.latin,
    hAnsi: language === "ar" ? FONT_FAMILIES.arabic : FONT_FAMILIES.latin,
    cs: FONT_FAMILIES.arabic,
  };
  const lang = { value: language === "ar" ? "ar-SA" : "en-GB", bidirectional: "ar-SA" };
  const push = (t: string, rtl: boolean) => {
    if (t.length === 0) return;
    runs.push(
      new TextRun({
        text: t,
        font,
        language: lang,
        rightToLeft: rtl,
        ...(style.bold === true ? { bold: true, boldComplexScript: true } : {}),
        ...(style.size === undefined ? {} : { size: style.size, sizeComplexScript: style.size }),
        ...(style.color === undefined ? {} : { color: style.color }),
      }),
    );
  };
  let at = 0;
  for (const m of text.matchAll(RTL_STRETCH)) {
    push(text.slice(at, m.index), false);
    push(m[0], true);
    at = m.index + m[0].length;
  }
  push(text.slice(at), false);
  return runs;
}

class DocxBuilder {
  readonly language: ExportLanguage;
  readonly rtl: boolean;
  readonly children: (Paragraph | Table)[] = [];

  constructor(language: ExportLanguage) {
    this.language = language;
    this.rtl = language === "ar";
  }

  /** One paragraph per line of `text` (values print their status label on a second line). */
  paragraphs(text: string, style: RunStyle = {}, spacingAfter = 60): Paragraph[] {
    return text.split("\n").map(
      (line) =>
        new Paragraph({
          bidirectional: this.rtl,
          alignment: AlignmentType.START,
          spacing: { after: spacingAfter },
          children: scriptRuns(line, this.language, style),
        }),
    );
  }

  add(...items: (Paragraph | Table)[]): void {
    this.children.push(...items);
  }

  heading(text: string, size: number): void {
    this.add(...this.paragraphs(text, { bold: true, size }, 120));
  }

  block(b: Block): void {
    switch (b.kind) {
      case "paragraph":
        this.add(...this.paragraphs(b.text));
        return;
      case "list":
        for (const item of b.items) this.add(...this.paragraphs(`\u2022 ${item}`));
        return;
      case "table":
        this.add(this.table(b));
        if (b.rows.length === 0 && b.empty !== null) this.add(...this.paragraphs(b.empty));
        this.add(new Paragraph({ bidirectional: this.rtl, children: [] }));
    }
  }

  table(t: TableBlock): Table {
    const sum = t.weights.reduce((a, w) => a + w, 0);
    const widths = t.weights.map((w) => Math.round((9000 * w) / sum));
    const size = t.weights.length > 9 ? 14 : t.weights.length > 6 ? 16 : 18;
    const border = { style: BorderStyle.SINGLE, size: 4, color: "C9CED8" };
    const cell = (text: string, header: boolean, j: number) =>
      new TableCell({
        width: { size: widths[j]!, type: WidthType.DXA },
        borders: { top: border, bottom: border, left: border, right: border },
        ...(header ? { shading: { type: ShadingType.CLEAR, color: "auto", fill: "EEF1F5" } } : {}),
        children: this.paragraphs(text, { bold: header, size }, 0),
      });
    const rows: TableRow[] = [];
    if (t.header !== null)
      rows.push(new TableRow({ tableHeader: true, children: t.header.map((h, j) => cell(h, true, j)) }));
    for (const r of t.rows) rows.push(new TableRow({ children: r.map((c, j) => cell(c, false, j)) }));
    if (t.totals !== null) rows.push(new TableRow({ children: t.totals.map((c, j) => cell(c, true, j)) }));
    if (rows.length === 0) rows.push(new TableRow({ children: t.weights.map((_, j) => cell("", false, j)) }));
    return new Table({
      rows,
      columnWidths: widths,
      width: { size: 9000, type: WidthType.DXA },
      visuallyRightToLeft: this.rtl,
    });
  }
}

/** "Page {n} of {m}" with live page fields in place of {n} and {m}. */
function pageFieldRuns(label: string, language: ExportLanguage): ParagraphChild[] {
  const out: ParagraphChild[] = [];
  for (const part of label.split(/(\{n\}|\{m\})/)) {
    if (part === "{n}") out.push(new TextRun({ children: [PageNumber.CURRENT], size: 14 }));
    else if (part === "{m}") out.push(new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 14 }));
    else out.push(...scriptRuns(part, language, { size: 14, color: "5A6275" }));
  }
  return out;
}

export async function renderDocx(input: ReportDocument, o: RenderOptions): Promise<RenderResult> {
  const parsed = reportDocument.safeParse(input);
  if (!parsed.success) throw new RenderError("the snapshot content is not a valid report document");
  const content = parsed.data;
  const labels = createLabels(o.language, withPagedLabels(o.labels));
  const paged = pagedDocument(content, o, labels);
  const b = new DocxBuilder(o.language);
  b.heading(paged.productName, 30);
  // D-163 (ADR-0050 §2 (d)): a demo snapshot's illustrative label in the header block, and in every page's header.
  if (paged.illustrative !== null)
    b.add(...b.paragraphs(paged.illustrative, { bold: true, size: 20, color: "7A4B00" }));
  if (paged.reportHeader !== null) b.add(...b.paragraphs(paged.reportHeader, { size: 18, color: "5A6275" })); // T-DG5-BE-R
  b.heading(paged.title, 26);
  b.block(paged.frame);
  const total = paged.sections.length;
  let done = 0;
  for (const s of paged.sections) {
    b.heading(s.title, 23);
    for (const block of s.blocks) b.block(block);
    done += 1;
    await o.onSection?.(done, total);
  }
  b.heading(paged.legendTitle, 22);
  b.block(paged.legend);
  b.heading(labels.text("export.about"), 22);
  b.add(...b.paragraphs(labels.text("export.fonts_note.docx")));

  const rtl = o.language === "ar";
  const footerParagraphs = [
    // T-DG5-BE-R: the configured report footer and the provenance statement (B0004), then the issue line.
    ...paged.footerLines.flatMap((t) => b.paragraphs(t, { size: 12, color: "5A6275" }, 0)),
    ...b.paragraphs(issueLine(o.snapshot, labels), { size: 14, color: "5A6275" }, 0),
    new Paragraph({
      bidirectional: rtl,
      alignment: AlignmentType.END,
      children: pageFieldRuns(labels.text("export.page", { n: "{n}", m: "{m}" }), o.language),
    }),
  ];
  const family = rtl ? FONT_FAMILIES.arabic : FONT_FAMILIES.latin;
  const document = new Document({
    creator: o.branding.productName,
    title: `${o.title} \u2014 ${content.transformation.code}`,
    description: `${content.transformation.code} \u2014 ${content.transformation.name}; snapshot ${o.snapshot.id}`,
    styles: {
      default: {
        document: {
          run: {
            font: { ascii: family, hAnsi: family, cs: FONT_FAMILIES.arabic },
            size: 19,
            language: { value: rtl ? "ar-SA" : "en-GB", bidirectional: "ar-SA" },
          },
        },
      },
    },
    sections: [
      {
        properties: {
          page: { size: { width: 11906, height: 16838 }, margin: { top: 1000, bottom: 1000, left: 900, right: 900 } },
        },
        ...(paged.illustrative === null
          ? {}
          : {
              headers: {
                default: new Header({
                  children: b.paragraphs(paged.illustrative, { bold: true, size: 16, color: "7A4B00" }, 0),
                }),
              },
            }),
        footers: { default: new Footer({ children: footerParagraphs }) },
        children: b.children,
      },
    ],
  });
  const bytes = await Packer.toBuffer(document);
  return {
    bytes: new Uint8Array(bytes),
    contentType: EXPORT_CONTENT_TYPES.docx,
    extension: "docx",
    sections: total,
    missingLabels: [...labels.missing].sort(),
  };
}
