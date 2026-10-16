// The PDF writer (ADR-0046 §2, §3, §9; REQ-S13-005, REQ-S13-008, REQ-S13-009), over pdfkit.
//
// One snapshot, one language: the header block (product name, output title, transformation, subject, period, as-of
// time, snapshot ID, the issue version or "Draft — not an issued report", methodology version, approval state of the
// sources), every section in content order (fields and metrics as label/value tables, tables with every row and their
// totals, text, lists, "No records" for an empty section), the legend of the validation labels, and on every page a
// footer with the issue line and "Page n of m". The header carries the product name it is given (the worker reads slice I's
// branding port at generation time, T-DG5-BE-R) and a band in the configured primary colour, and the configured report
// header; under the footer line, the configured report footer and the provenance statement (B0004).
//
// Direction and fonts: Arabic documents have a right-to-left base direction (text aligned right, tables mirrored with
// the first column on the right, `/Lang (ar-SA)` and `/ViewerPreferences << /Direction /R2L >>`); English documents are
// left to right (`/Lang (en-GB)`). Every run is set in a bundled face (fonts.ts) that pdfkit embeds as a subset; the
// bidirectional order, identifiers and line breaks come from layout/bidi.ts, and fontkit applies the Arabic joining
// forms from GSUB. Values print as layout/values.ts decides: Unknown and Stale print their label and never a number.
//
// Pure: no database, no network, no clock (the PDF's dates are the snapshot's as-of time, so the bytes are
// reproducible for one snapshot, format and language).
import PDFDocument from "pdfkit";
import { reportDocument, type ReportDocument } from "@mth/shared/schemas";
import { fontBytes, fontStack, FONT_FACES, type FontWeight } from "../fonts.ts";
import { createLabels, type Labels } from "../labels.ts";
import { layoutText, type BaseDirection, type Line, type Shaper } from "../layout/bidi.ts";
import { pagedDocument, type Block, type TableBlock } from "../layout/blocks.ts";
import { withPagedLabels } from "../layout/values.ts";
import { EXPORT_CONTENT_TYPES, issueLine, RenderError, type RenderOptions, type RenderResult } from "../model.ts";

/** A4 portrait; a document with a table wider than LANDSCAPE_COLUMNS columns is set in A4 landscape. */
const A4 = { short: 595.28, long: 841.89 } as const;
const LANDSCAPE_COLUMNS = 7;
/** Rows sampled to size a table's columns (the widest words and texts of a long table are found in its first rows). */
const WIDTH_SAMPLE_ROWS = 400;
const MARGIN_X = 42;
const MARGIN_TOP = 46;
const MARGIN_BOTTOM = 56;
const FOOTER_SIZE = 7.5;
/** T-DG5-BE-R: the size of the report footer and provenance lines under the issue line. */
const EXTRA_FOOTER_SIZE = 6;

const INK = "#1A1F36";
const MUTED = "#5A6275";
const RULE = "#C9CED8";
const HEADER_FILL = "#EEF1F5";

/** The parts of pdfkit's current font object the layout uses (pdfkit's EmbeddedFont over a fontkit font). */
interface PdfFont {
  widthOfString(text: string, size: number, features?: readonly string[]): number;
  readonly font: {
    hasGlyphForCodePoint(cp: number): boolean;
    layout(text: string): { readonly direction: string };
  };
}

type Doc = PDFKit.PDFDocument;

/**
 * pdfkit lays a string out word by word and concatenates the words in string order, unless OpenType features are
 * given; then it shapes the whole string as one run. A right-to-left run of several Arabic words must be shaped as one
 * run, so fontkit returns all its glyphs in visual order: every draw and measure passes an (empty) feature list, which
 * keeps fontkit's default features (including the Arabic joining forms) and only switches off the word split.
 */
const WHOLE_RUN: readonly string[] = [];

/** A Shaper over pdfkit's embedded faces (coverage and direction memoized). */
export function pdfShaper(doc: Doc): Shaper {
  const fonts = new Map<string, PdfFont>();
  const coverage = new Map<string, Map<number, boolean>>();
  const fontOf = (face: string): PdfFont => {
    let f = fonts.get(face);
    if (f === undefined) {
      doc.font(face);
      f = (doc as unknown as { _font: PdfFont })._font;
      fonts.set(face, f);
    }
    return f;
  };
  return {
    covers(face, cp) {
      let m = coverage.get(face);
      if (m === undefined) coverage.set(face, (m = new Map()));
      let c = m.get(cp);
      if (c === undefined) m.set(cp, (c = fontOf(face).font.hasGlyphForCodePoint(cp)));
      return c;
    },
    width: (face, text, size) => fontOf(face).widthOfString(text, size, WHOLE_RUN),
    shapesRtl: (face, text) => fontOf(face).font.layout(text).direction === "rtl",
  };
}

class PdfWriter {
  readonly doc: Doc;
  readonly direction: BaseDirection;
  readonly faces: Readonly<Record<FontWeight, readonly string[]>>;
  readonly shaper: Shaper;
  readonly pageHeight: number;
  readonly left = MARGIN_X;
  readonly right: number;
  readonly top = MARGIN_TOP;
  readonly bottom: number;
  y = MARGIN_TOP;

  constructor(doc: Doc, labels: Labels, page: { width: number; height: number }) {
    this.doc = doc;
    this.pageHeight = page.height;
    this.right = page.width - MARGIN_X;
    this.bottom = page.height - MARGIN_BOTTOM;
    this.direction = labels.language === "ar" ? "rtl" : "ltr";
    this.faces = {
      400: fontStack(labels.language, 400).map((f) => f.name),
      700: fontStack(labels.language, 700).map((f) => f.name),
    };
    this.shaper = pdfShaper(doc);
  }

  get rtl(): boolean {
    return this.direction === "rtl";
  }

  lines(text: string, size: number, weight: FontWeight, maxWidth: number): Line[] {
    return layoutText(text, {
      direction: this.direction,
      maxWidth,
      size,
      faces: this.faces[weight],
      shaper: this.shaper,
    });
  }

  /** Draws one laid-out line in the box [x0, x1], aligned to the base direction's start side. */
  drawLine(line: Line, x0: number, x1: number, y: number, size: number, color = INK): void {
    let x = this.rtl ? x1 - line.width : x0;
    for (const p of line.pieces) {
      this.doc.font(p.face).fontSize(size).fillColor(color).text(p.draw, x, y, { lineBreak: false, features: [] });
      x += p.width;
    }
  }

  newPage(): void {
    this.doc.addPage();
    this.y = this.top;
  }

  ensure(height: number): void {
    if (this.y + height > this.bottom && this.y > this.top) this.newPage();
  }

  text(text: string, size: number, weight: FontWeight = 400, color = INK, gapAfter = 4): void {
    const lh = size * 1.35;
    for (const line of this.lines(text, size, weight, this.right - this.left)) {
      this.ensure(lh);
      this.drawLine(line, this.left, this.right, this.y, size, color);
      this.y += lh;
    }
    this.y += gapAfter;
  }

  heading(text: string, size: number): void {
    // Keep a heading with at least three lines of what follows.
    this.ensure(size * 1.35 + 40);
    this.text(text, size, 700, INK, 3);
  }

  block(b: Block): void {
    switch (b.kind) {
      case "paragraph":
        this.text(b.text, 9);
        return;
      case "list":
        for (const item of b.items) this.text(`• ${item}`, 9, 400, INK, 1);
        this.y += 3;
        return;
      case "table":
        this.table(b);
    }
  }

  /**
   * Column widths from the content (the automatic table layout of HTML, simplified): each column gets at least its
   * widest word, the rest of the width is shared in proportion to how much wider each column's longest text is, and
   * a column with nothing to share keeps its weight. Words break between characters only when the widest words of all
   * columns do not fit side by side.
   */
  columnWidths(t: TableBlock, size: number, pad: number): number[] {
    const width = this.right - this.left;
    const cache = new Map<string, number>();
    const measure = (word: string, weight: FontWeight) => {
      const key = `${weight}|${word}`;
      let v = cache.get(key);
      if (v === undefined) {
        v = this.lines(word, size, weight, Number.POSITIVE_INFINITY).reduce((a, l) => Math.max(a, l.width), 0);
        cache.set(key, v);
      }
      return v;
    };
    const space = measure("a a", 400) - measure("aa", 400);
    const rows: { cells: readonly string[]; weight: FontWeight }[] = [
      ...(t.header === null ? [] : [{ cells: t.header, weight: 700 as const }]),
      ...t.rows.slice(0, WIDTH_SAMPLE_ROWS).map((cells) => ({ cells, weight: 400 as const })),
      ...(t.totals === null ? [] : [{ cells: t.totals, weight: 700 as const }]),
    ];
    const min = t.weights.map(() => 0);
    const max = t.weights.map(() => 0);
    for (const r of rows)
      r.cells.forEach((cell, j) => {
        for (const line of cell.split("\n")) {
          const words = line.split(/\s+/).filter((x) => x.length > 0);
          const ws = words.map((x) => measure(x, r.weight));
          min[j] = Math.max(min[j]!, ...ws);
          max[j] = Math.max(max[j]!, ws.reduce((a, x) => a + x, 0) + space * Math.max(0, words.length - 1));
        }
      });
    const cap = width * 0.45;
    const lo = min.map((m) => Math.min(cap, m + 2 * pad + 1));
    const hi = max.map((m, j) => Math.max(lo[j]!, Math.min(width, m + 2 * pad + 1)));
    const sum = (a: readonly number[]) => a.reduce((x, y) => x + y, 0);
    const weights = sum(t.weights);
    if (sum(lo) > width) return lo.map((m) => (width * m) / sum(lo));
    if (sum(hi) <= width) {
      const extra = width - sum(hi);
      return hi.map((h, j) => h + (extra * t.weights[j]!) / weights);
    }
    const room = width - sum(lo);
    const want = sum(hi) - sum(lo);
    return lo.map((l, j) => l + (room * (hi[j]! - l)) / want);
  }

  /** A table: header row repeated on every page, rows split across pages only when taller than a page. */
  table(t: TableBlock): void {
    const cols = t.weights.length;
    const size = cols > 9 ? 6.5 : cols > 6 ? 7.5 : 8.5;
    const lh = size * 1.3;
    const pad = 3;
    const width = this.right - this.left;
    const widths = this.columnWidths(t, size, pad);
    // Column j's box; in a right-to-left table the first column is on the right.
    const boxes = widths.map((w, j) => {
      const before = widths.slice(0, j).reduce((a, x) => a + x, 0);
      const x0 = this.rtl ? this.right - before - w : this.left + before;
      return [x0, x0 + w] as const;
    });
    const layoutRow = (cells: readonly string[], weight: FontWeight) =>
      cells.map((c, j) => this.lines(c, size, weight, widths[j]! - 2 * pad));
    const header = t.header === null ? null : layoutRow(t.header, 700);
    const height = (cells: Line[][]) => Math.max(1, ...cells.map((c) => c.length)) * lh + 2 * pad;
    const pageRoom = this.bottom - this.top - (header === null ? 0 : height(header));

    const drawCells = (cells: Line[][], from: number, count: number, fill: string | null) => {
      const h = count * lh + 2 * pad;
      boxes.forEach(([x0, x1], j) => {
        if (fill !== null) this.doc.rect(x0, this.y, x1 - x0, h).fill(fill);
        this.doc
          .lineWidth(0.5)
          .rect(x0, this.y, x1 - x0, h)
          .stroke(RULE);
        cells[j]!.slice(from, from + count).forEach((line, k) => {
          this.drawLine(line, x0 + pad, x1 - pad, this.y + pad + k * lh, size, INK);
        });
      });
      this.y += h;
    };
    const drawHeader = () => {
      if (header !== null) drawCells(header, 0, Math.max(1, ...header.map((c) => c.length)), HEADER_FILL);
    };
    const row = (cells: Line[][], fill: string | null) => {
      const total = Math.max(1, ...cells.map((c) => c.length));
      // A row that fits on a page is never split: it moves to the next page with the header.
      if (height(cells) <= pageRoom && this.y + height(cells) > this.bottom) {
        this.newPage();
        drawHeader();
      }
      let from = 0;
      while (from < total) {
        let room = Math.floor((this.bottom - this.y - 2 * pad) / lh);
        if (room < 1) {
          this.newPage();
          drawHeader();
          room = Math.floor((this.bottom - this.y - 2 * pad) / lh);
        }
        const count = Math.min(room, total - from);
        drawCells(cells, from, count, fill);
        from += count;
        if (from < total) {
          this.newPage();
          drawHeader();
        }
      }
    };

    if (header !== null) {
      this.ensure(height(header) + lh + 2 * pad);
      drawHeader();
    }
    if (t.rows.length === 0 && t.empty !== null) {
      const span = this.lines(t.empty, size, 400, width - 2 * pad);
      this.ensure(span.length * lh + 2 * pad);
      span.forEach((line, k) => this.drawLine(line, this.left + pad, this.right - pad, this.y + pad + k * lh, size));
      this.y += span.length * lh + 2 * pad;
    }
    for (const r of t.rows) row(layoutRow(r, 400), null);
    if (t.totals !== null) row(layoutRow(t.totals, 700), HEADER_FILL);
    this.y += 8;
  }

  /**
   * The footer of every page: the issue line on the start side, "Page n of m" on the end side; below them (T-DG5-BE-R)
   * the configured report footer and the provenance statement, start-aligned, at most two lines each.
   */
  footers(issue: string, pageLabel: (n: number, m: number) => string, extra: readonly string[] = []): void {
    const range = this.doc.bufferedPageRange();
    const y = this.pageHeight - MARGIN_BOTTOM + 18;
    const half = (this.right - this.left) / 2;
    for (let i = range.start; i < range.start + range.count; i++) {
      this.doc.switchToPage(i);
      this.doc
        .lineWidth(0.5)
        .moveTo(this.left, y - 6)
        .lineTo(this.right, y - 6)
        .stroke(RULE);
      const issueLine = this.lines(issue, FOOTER_SIZE, 400, half - 6)[0];
      const page = this.lines(pageLabel(i - range.start + 1, range.count), FOOTER_SIZE, 400, half - 6)[0];
      // Start side: right in RTL, left in LTR; the page number on the other side.
      if (issueLine !== undefined) {
        const x = this.rtl ? this.right - issueLine.width : this.left;
        this.drawLine(issueLine, x, x + issueLine.width, y, FOOTER_SIZE, MUTED);
      }
      if (page !== undefined) {
        const x = this.rtl ? this.left : this.right - page.width;
        this.drawLine(page, x, x + page.width, y, FOOTER_SIZE, MUTED);
      }
      let ey = y + FOOTER_SIZE + 2;
      for (const text of extra)
        for (const line of this.lines(text, EXTRA_FOOTER_SIZE, 400, this.right - this.left).slice(0, 2)) {
          const x = this.rtl ? this.right - line.width : this.left;
          this.drawLine(line, x, x + line.width, ey, EXTRA_FOOTER_SIZE, MUTED);
          ey += EXTRA_FOOTER_SIZE + 1.5;
        }
    }
  }
}

export async function renderPdf(input: ReportDocument, o: RenderOptions): Promise<RenderResult> {
  const parsed = reportDocument.safeParse(input);
  if (!parsed.success) throw new RenderError("the snapshot content is not a valid report document");
  const content = parsed.data;
  const labels = createLabels(o.language, withPagedLabels(o.labels));
  const paged = pagedDocument(content, o, labels);
  const asOf = new Date(content.asOf);
  const wide = content.sections.some((x) => x.kind === "table" && x.columns.length > LANDSCAPE_COLUMNS);
  const page = wide ? { width: A4.long, height: A4.short } : { width: A4.short, height: A4.long };
  const doc = new PDFDocument({
    size: [page.width, page.height],
    margins: { top: MARGIN_TOP, bottom: MARGIN_BOTTOM, left: MARGIN_X, right: MARGIN_X },
    bufferPages: true,
    autoFirstPage: true,
    compress: true,
    pdfVersion: "1.7",
    lang: o.language === "ar" ? "ar-SA" : "en-GB",
    displayTitle: o.language !== "ar",
    info: {
      Title: `${o.title} — ${content.transformation.code}`,
      Author: o.branding.productName,
      Subject: `${content.transformation.code} — ${content.transformation.name}`,
      Keywords: `snapshot ${o.snapshot.id}`,
      Creator: o.branding.productName,
      Producer: o.branding.productName,
      CreationDate: asOf,
      ModDate: asOf,
    },
  });
  if (o.language === "ar") {
    // The reading order of the document for viewers (PDF 1.7 §12.2 ViewerPreferences /Direction /R2L; pdfkit writes a
    // JavaScript string as a PDF name). pdfkit's own `end()` ends this reference, as it does for `displayTitle`.
    (doc as unknown as { _root: { data: { ViewerPreferences?: unknown } } })._root.data.ViewerPreferences = doc.ref({
      DisplayDocTitle: true,
      Direction: "R2L",
    });
  }
  for (const f of FONT_FACES) doc.registerFont(f.name, fontBytes(f));
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const ended = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  const w = new PdfWriter(doc, labels, page);
  // T-DG5-BE-R (ADR-0049 §8; REQ-S15-004): a configured branding colours the header band of the first page; the
  // product name stays in the ink colour, so a light brand colour never makes text unreadable. Defaults draw no band.
  if (paged.brandColour !== null) doc.rect(0, 0, page.width, 10).fill(paged.brandColour);
  w.text(paged.productName, 15, 700, INK, 2);
  if (paged.reportHeader !== null) w.text(paged.reportHeader, 9, 400, MUTED, 4); // T-DG5-BE-R
  w.text(paged.title, 12.5, 700, INK, 6);
  w.table(paged.frame);
  const total = paged.sections.length;
  let done = 0;
  for (const s of paged.sections) {
    w.heading(s.title, 11.5);
    for (const b of s.blocks) w.block(b);
    done += 1;
    await o.onSection?.(done, total);
  }
  w.heading(paged.legendTitle, 11);
  w.table(paged.legend);
  w.footers(issueLine(o.snapshot, labels), (n, m) => labels.text("export.page", { n, m }), paged.footerLines);
  doc.end();
  await ended;
  return {
    bytes: new Uint8Array(Buffer.concat(chunks)),
    contentType: EXPORT_CONTENT_TYPES.pdf,
    extension: "pdf",
    sections: total,
    missingLabels: [...labels.missing].sort(),
  };
}
