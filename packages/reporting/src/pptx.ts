// The PPTX writer (ADR-0046 §2, §3, §9; REQ-S13-005, REQ-S13-008, REQ-S13-009), over pptxgenjs.
//
// The same paged view as the PDF and DOCX (layout/blocks.ts), as 16:9 slides: a title slide with the header block
// (product name, output, transformation, ..., the issue version or "Draft — not an issued report"), then every
// section in content order, each table split over as many slides as its rows need with the header row repeated and
// "<title> (continued)" on the following slides, then the legend and "About this file". Every slide carries the issue
// line and "Slide n of m". A gate pack therefore lists every criterion of the gate, each with its state and evidence
// (REQ-S13-005). Until slice I's branding port ships (BE-R) the title slide carries the shipped product name it is given and
// no provenance line.
//
// Direction: in Arabic the presentation is `rtlMode`, every text box and table cell is right-to-left (`rtl="1"`) and
// right-aligned with `lang="ar-SA"`, and table columns are mirrored (the first column on the right). The families are
// named (pptxgenjs does not embed fonts); the presentation application shapes Arabic itself.
import pptxModule from "pptxgenjs";
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { primaryFamily } from "./fonts.ts";
import { createLabels, type Labels } from "./labels.ts";
import { pagedDocument, type Block, type TableBlock } from "./layout/blocks.ts";
import { withPagedLabels } from "./layout/values.ts";
import { EXPORT_CONTENT_TYPES, issueLine, RenderError, type RenderOptions, type RenderResult } from "./model.ts";

// pptxgenjs is a CommonJS module whose `module.exports` is the class; its types declare it as `export default`.
type Pptx = typeof pptxModule.default;
const PptxGenJS = ((pptxModule as unknown as { default?: Pptx }).default ?? (pptxModule as unknown as Pptx)) as Pptx;
type TableRow = Parameters<ReturnType<InstanceType<Pptx>["addSlide"]>["addTable"]>[0][number];
type TableCell = TableRow[number];

const SLIDE_W = 10; // inches, 16:9
const SLIDE_H = 5.625;
const X = 0.4;
const W = SLIDE_W - 2 * X;
const BODY_TOP = 0.95;
const BODY_BOTTOM = SLIDE_H - 0.45;

type Item =
  | { readonly kind: "text"; readonly text: string; readonly size: number; readonly bold: boolean }
  | { readonly kind: "table"; readonly table: TableBlock; readonly rows: readonly (readonly string[])[] };

interface SlideSpec {
  readonly title: string;
  readonly items: Item[];
}

/** Estimated lines of `text` in a box `width` inches wide at `size` points (half an em per character). */
function estimateLines(text: string, size: number, width: number): number {
  const perLine = Math.max(1, Math.floor((width * 72 - 8) / (size * 0.52)));
  return text.split("\n").reduce((n, l) => n + Math.max(1, Math.ceil(l.length / perLine)), 0);
}

const tableSize = (cols: number) => (cols > 9 ? 7 : cols > 6 ? 8 : 9.5);

function columnWidths(t: TableBlock): number[] {
  const sum = t.weights.reduce((a, w) => a + w, 0);
  return t.weights.map((w) => (W * w) / sum);
}

function rowHeight(cells: readonly string[], t: TableBlock): number {
  const size = tableSize(t.weights.length);
  const widths = columnWidths(t);
  const lines = Math.max(1, ...cells.map((c, j) => estimateLines(c, size, widths[j]!)));
  return (lines * size * 1.25) / 72 + 0.1;
}

/** Plans the slides: each table's rows are split so every slide fits, its header row repeated. */
function planSlides(sections: readonly { title: string; blocks: readonly Block[] }[], labels: Labels): SlideSpec[] {
  const slides: SlideSpec[] = [];
  for (const s of sections) {
    let slide: SlideSpec = { title: s.title, items: [] };
    let used = 0;
    const room = BODY_BOTTOM - BODY_TOP;
    const next = () => {
      slides.push(slide);
      slide = { title: labels.text("export.continued", { title: s.title }), items: [] };
      used = 0;
    };
    for (const b of s.blocks) {
      if (b.kind !== "table") {
        const text = b.kind === "list" ? b.items.map((i) => `• ${i}`).join("\n") : b.text;
        const h = (estimateLines(text, 11, W) * 11 * 1.3) / 72 + 0.15;
        if (used > 0 && used + h > room) next();
        slide.items.push({ kind: "text", text, size: 11, bold: false });
        used += h;
        continue;
      }
      const header = b.header === null ? 0 : rowHeight(b.header, b);
      const rows = b.rows.length === 0 && b.empty !== null ? [[b.empty]] : [...b.rows];
      if (b.totals !== null) rows.push(b.totals);
      let chunk: (readonly string[])[] = [];
      let h = header;
      for (const r of rows) {
        const rh = rowHeight(r, b);
        if (chunk.length > 0 && used + h + rh > room) {
          slide.items.push({ kind: "table", table: b, rows: chunk });
          next();
          chunk = [];
          h = header;
        }
        chunk.push(r);
        h += rh;
      }
      slide.items.push({ kind: "table", table: b, rows: chunk });
      used += h + 0.15;
    }
    slides.push(slide);
  }
  return slides;
}

export async function renderPptx(input: ReportDocument, o: RenderOptions): Promise<RenderResult> {
  const parsed = reportDocument.safeParse(input);
  if (!parsed.success) throw new RenderError("the snapshot content is not a valid report document");
  const content = parsed.data;
  const labels = createLabels(o.language, withPagedLabels(o.labels));
  const paged = pagedDocument(content, o, labels);
  const rtl = o.language === "ar";
  const fontFace = primaryFamily(o.language);
  const lang = rtl ? "ar-SA" : "en-GB";
  const align = rtl ? ("right" as const) : ("left" as const);
  const textProps = { fontFace, lang, rtlMode: rtl, align, color: "1A1F36" };

  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.rtlMode = rtl;
  pptx.author = o.branding.productName;
  pptx.company = o.branding.productName;
  pptx.title = `${o.title} — ${content.transformation.code}`;
  pptx.subject = `${content.transformation.code} — ${content.transformation.name}; snapshot ${o.snapshot.id}`;

  const titleSlide: SlideSpec = {
    title: paged.title,
    items: [{ kind: "table", table: paged.frame, rows: paged.frame.rows }],
  };
  const total = paged.sections.length;
  const sectionSlides: SlideSpec[] = [];
  let done = 0;
  for (const s of paged.sections) {
    sectionSlides.push(...planSlides([s], labels));
    done += 1;
    await o.onSection?.(done, total);
  }
  const closing = planSlides(
    [
      { title: paged.legendTitle, blocks: [paged.legend] },
      {
        title: labels.text("export.about"),
        blocks: [{ kind: "paragraph", text: labels.text("export.fonts_note.pptx") }],
      },
    ],
    labels,
  );
  const specs = [titleSlide, ...sectionSlides, ...closing];
  const issue = issueLine(o.snapshot, labels);

  specs.forEach((spec, index) => {
    const slide = pptx.addSlide();
    if (index === 0)
      slide.addText(paged.productName, { ...textProps, x: X, y: 0.15, w: W, h: 0.35, fontSize: 12, bold: true });
    slide.addText(spec.title, {
      ...textProps,
      x: X,
      y: index === 0 ? 0.45 : 0.25,
      w: W,
      h: 0.45,
      fontSize: 18,
      bold: true,
    });
    let y = BODY_TOP;
    for (const item of spec.items) {
      if (item.kind === "text") {
        const h = (estimateLines(item.text, item.size, W) * item.size * 1.3) / 72 + 0.1;
        slide.addText(item.text, { ...textProps, x: X, y, w: W, h, fontSize: item.size, valign: "top" });
        y += h + 0.05;
        continue;
      }
      const t = item.table;
      const size = tableSize(t.weights.length);
      const widths = columnWidths(t);
      const order = (cells: readonly string[]) => (rtl ? [...cells].reverse() : [...cells]);
      const cellOf = (text: string, header: boolean): TableCell => ({
        text,
        options: { ...textProps, fontSize: size, bold: header, ...(header ? { fill: { color: "EEF1F5" } } : {}) },
      });
      const rows: TableRow[] = [];
      if (t.header !== null) rows.push(order(t.header).map((h) => cellOf(h, true)));
      for (const r of item.rows) {
        // A one-cell row is the empty-state line ("No records"): it spans the table.
        if (r.length === 1 && t.weights.length > 1)
          rows.push([{ text: r[0]!, options: { ...textProps, fontSize: size, colspan: t.weights.length } }]);
        else rows.push(order(r).map((c) => cellOf(c, r === t.totals)));
      }
      const h = (t.header === null ? 0 : rowHeight(t.header, t)) + item.rows.reduce((a, r) => a + rowHeight(r, t), 0);
      slide.addTable(rows, {
        x: X,
        y,
        w: W,
        colW: rtl ? [...widths].reverse() : widths,
        fontFace,
        fontSize: size,
        border: { type: "solid", pt: 0.5, color: "C9CED8" },
        valign: "top",
        margin: 0.04,
      });
      y += h + 0.15;
    }
    const footer = labels.text("export.slide", { n: index + 1, m: specs.length });
    slide.addText(issue, {
      ...textProps,
      x: rtl ? X + W / 2 : X,
      y: SLIDE_H - 0.38,
      w: W / 2,
      h: 0.28,
      fontSize: 8,
      color: "5A6275",
    });
    slide.addText(footer, {
      ...textProps,
      x: rtl ? X : X + W / 2,
      y: SLIDE_H - 0.38,
      w: W / 2,
      h: 0.28,
      fontSize: 8,
      color: "5A6275",
      align: rtl ? "left" : "right",
    });
  });

  // Only pptxgenjs's STREAM output (a Node Buffer) honours `compression` (DEFLATE); the other outputs are stored.
  const out = await pptx.write({ outputType: "STREAM", compression: true });
  if (!(out instanceof Uint8Array)) throw new RenderError("the presentation writer returned no bytes");
  return {
    bytes: new Uint8Array(out.buffer, out.byteOffset, out.byteLength),
    contentType: EXPORT_CONTENT_TYPES.pptx,
    extension: "pptx",
    sections: total,
    missingLabels: [...labels.missing].sort(),
  };
}
