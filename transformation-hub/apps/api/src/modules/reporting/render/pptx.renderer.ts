import PptxGenJS from 'pptxgenjs';
import { fill, textIsRtl, type RenderDoc, type RenderTable } from './document';

export const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

/** Office font with Latin and Arabic glyphs on every Office platform (the PDF embeds IBM Plex; PPTX uses installed fonts). */
const FONT = 'Arial';
const NAVY = '0F2F57';
const GREY = '3B4A5C';
const LINE = 'C8D3E0';
const HEAD = 'E8EEF6';
/** 16:9 wide layout: 13.33 × 7.5 in. */
const W = 13.33;
const MARGIN = 0.45;

type Cell = PptxGenJS.TableCell;
/** Cell options: pptxgenjs applies `rtlMode` / `lang` of a cell to its paragraphs at runtime; its typings omit them. */
const co = (o: PptxGenJS.TableCellProps & { rtlMode?: boolean; lang?: string }) => o as PptxGenJS.TableCellProps;

/**
 * Basic committee pack as a genuine PowerPoint package (pptxgenjs, REQ-RPT-009): a title slide with the report metadata,
 * one slide per section (figures and notes) and its tables (split over as many slides as needed, header repeated). Arabic
 * decks are right-to-left: presentation `rtl`, paragraphs `rtl`, right alignment and tables with their first column on the
 * right. Every slide carries the classification (and the Demo label for sandbox data).
 */
export async function renderPptx(doc: RenderDoc): Promise<Buffer> {
  const rtl = doc.dir === 'rtl';
  const lang = rtl ? 'ar-SA' : 'en-GB';
  const align = rtl ? 'right' : 'left';
  const L = doc.labels;
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.rtlMode = rtl;
  pptx.title = `${doc.title} — ${doc.projectLine}`;
  pptx.subject = doc.classificationLabel;
  pptx.company = 'Transformation Hub';
  pptx.author = 'Transformation Hub';
  const text = (t: string, o: PptxGenJS.TextPropsOptions = {}): [string, PptxGenJS.TextPropsOptions] => [t, { fontFace: FONT, color: GREY, fontSize: 12, align, rtlMode: rtl && textIsRtl(t, true), lang, valign: 'top', margin: 0, ...o }];
  const footer = `${L.classification}: ${doc.classificationLabel}${doc.demo ? ` · ${L.demoBanner}` : ''}`;
  pptx.defineSlideMaster({
    title: 'HUB',
    background: { color: 'FFFFFF' },
    objects: [
      { rect: { x: 0, y: 0, w: W, h: 0.12, fill: { color: NAVY } } },
      { text: { text: footer, options: { x: MARGIN, y: 7.05, w: W - 2 * MARGIN - 1, h: 0.3, fontFace: FONT, fontSize: 9, color: GREY, align, rtlMode: rtl, lang } } },
    ],
    slideNumber: { x: rtl ? MARGIN : W - MARGIN - 0.8, y: 7.05, w: 0.8, h: 0.3, fontFace: FONT, fontSize: 9, color: GREY, align: rtl ? 'left' : 'right' },
  });

  // Title slide with the metadata of the snapshot.
  const first = pptx.addSlide({ masterName: 'HUB' });
  first.addText(...text(doc.title, { x: MARGIN, y: 0.35, w: W - 2 * MARGIN, h: 0.7, fontSize: 30, bold: true, color: NAVY }));
  first.addText(...text(doc.projectLine, { x: MARGIN, y: 1.05, w: W - 2 * MARGIN, h: 0.4, fontSize: 16 }));
  first.addText(...text(`${L.classification}: ${doc.classificationLabel}`, { x: MARGIN, y: 1.5, w: W - 2 * MARGIN, h: 0.35, fontSize: 13, bold: true, color: 'A3261F' }));
  if (doc.demo) first.addText(...text(L.demoBanner, { x: MARGIN, y: 1.85, w: W - 2 * MARGIN, h: 0.35, fontSize: 13, bold: true, color: '9C5700' }));
  const metaRows: Cell[][] = doc.meta.map(([k, v]) => {
    const key: Cell = { text: k, options: co({ bold: true, fontFace: FONT, fontSize: 11, color: GREY, align, rtlMode: rtl && textIsRtl(k, true), lang }) };
    const val: Cell = { text: v, options: co({ fontFace: FONT, fontSize: 11, color: GREY, align, rtlMode: rtl && textIsRtl(v, true), lang }) };
    return rtl ? [val, key] : [key, val];
  });
  first.addTable(metaRows, { x: MARGIN, y: 2.35, w: W - 2 * MARGIN, colW: rtl ? [W - 2 * MARGIN - 3.2, 3.2] : [3.2, W - 2 * MARGIN - 3.2], border: { type: 'none' }, autoPage: false });
  const notes = [L.snapshotNote, ...(doc.partialNote ? [doc.partialNote] : [])].join('\n');
  first.addText(...text(notes, { x: MARGIN, y: 6.2, w: W - 2 * MARGIN, h: 0.7, fontSize: 11, italic: true }));

  for (const s of doc.sections) {
    const slide = pptx.addSlide({ masterName: 'HUB' });
    slide.addText(...text(s.title, { x: MARGIN, y: 0.3, w: W - 2 * MARGIN, h: 0.6, fontSize: 24, bold: true, color: NAVY }));
    if (s.withheld) {
      slide.addText(...text(L.withheld, { x: MARGIN, y: 1.1, w: W - 2 * MARGIN, h: 0.5, fontSize: 14, italic: true }));
      continue;
    }
    if (s.classification) slide.addText(...text(fill(L.sectionClassification, { classification: s.classification }), { x: MARGIN, y: 0.9, w: W - 2 * MARGIN, h: 0.3, fontSize: 11 }));
    let y = 1.3;
    if (s.figures.length) {
      const withPrevious = s.figures.some((f) => !!f.previousText);
      const rows: Cell[][] = s.figures.map((f) => {
        const cells: Cell[] = [
          { text: f.label, options: co({ fontFace: FONT, fontSize: 12, color: GREY, align, rtlMode: rtl && textIsRtl(f.label, true), lang }) },
          { text: f.text, options: co({ fontFace: FONT, fontSize: 14, bold: true, color: NAVY, align: rtl ? 'left' : 'right', lang }) },
          ...(withPrevious ? [{ text: f.previousText ?? '', options: co({ fontFace: FONT, fontSize: 10, color: '6B7685', align, rtlMode: rtl, lang }) }] : []),
        ];
        return rtl ? cells.reverse() : cells;
      });
      const colW = withPrevious ? [6.2, 1.6, 2.2] : [6.2, 1.6];
      const w = colW.reduce((a, b) => a + b, 0);
      // Right-to-left decks anchor the figures on the right, under the title.
      slide.addTable(rows, { x: rtl ? W - MARGIN - w : MARGIN, y, w, colW: rtl ? [...colW].reverse() : colW, border: { type: 'solid', pt: 0.5, color: LINE }, autoPage: false, rowH: 0.32 });
      y += 0.32 * rows.length + 0.2;
    }
    const notes = [...s.notes, ...s.tables.map((t) => (t.truncatedNote ? `${t.title}: ${t.truncatedNote}` : null)).filter((x): x is string => !!x)];
    if (notes.length && y < 6.4) slide.addText(...text(notes.map((n) => `• ${n}`).join('\n'), { x: MARGIN, y, w: W - 2 * MARGIN, h: Math.min(1.4, 6.9 - y), fontSize: 11 }));
    for (const t of s.tables) addTable(pptx, t, s.title, doc, text);
  }
  return (await pptx.write({ outputType: 'nodebuffer' })) as Buffer;
}

function addTable(pptx: PptxGenJS, t: RenderTable, sectionTitle: string, doc: RenderDoc, text: (t: string, o?: PptxGenJS.TextPropsOptions) => [string, PptxGenJS.TextPropsOptions]) {
  const rtl = doc.dir === 'rtl';
  const lang = rtl ? 'ar-SA' : 'en-GB';
  const slide = pptx.addSlide({ masterName: 'HUB' });
  slide.addText(...text(`${sectionTitle} — ${t.title}`, { x: MARGIN, y: 0.3, w: W - 2 * MARGIN, h: 0.5, fontSize: 18, bold: true, color: NAVY }));
  const numeric = t.types.map((x) => x === 'number' || x === 'percent' || x === 'money');
  const order = <T>(xs: T[]) => (rtl ? [...xs].reverse() : xs);
  const cellAlign = (i: number) => (numeric[i] ? (rtl ? 'left' : 'right') : rtl ? 'right' : 'left');
  const header: Cell[] = order(t.headers.map((h, i) => ({ text: h, options: co({ bold: true, fill: { color: HEAD }, fontFace: FONT, fontSize: 9, color: '1B2430', align: cellAlign(i), rtlMode: rtl && textIsRtl(h, true), lang }) })));
  const body: Cell[][] = t.rows.length
    ? t.rows.map((r) => order(r.map((c, i) => ({ text: c.text, options: co({ fontFace: FONT, fontSize: 9, color: '1B2430', align: cellAlign(i), rtlMode: rtl && textIsRtl(c.text, true), lang }) }))))
    : [order(t.headers.map((_, i) => ({ text: i === 0 ? doc.labels.noRows : '', options: co({ fontFace: FONT, fontSize: 9, italic: true, color: '6B7685', align: cellAlign(i), rtlMode: rtl, lang }) })))];
  // Column widths in proportion to the longest text of each column (bounded), filling the slide width.
  // Column widths: a column of codes, dates, numbers or statuses gets the width of its longest word (never broken or cut
  // inside a word, ~0.075 in per character at 9 pt plus padding); free-text columns share the rest and wrap at spaces.
  const longestWord = (x: string) => Math.max(0, ...x.split(/\s+/).map((w) => w.length));
  const free = (i: number) => t.types[i] === 'text' || t.types[i] === 'bilingual' || t.types[i] === 'person';
  const width = W - 2 * MARGIN;
  const need = t.headers.map((h, i) => Math.max(longestWord(h), ...t.rows.slice(0, 80).map((r) => longestWord(r[i]?.text ?? ''))) * 0.075 + 0.15);
  const fixed = t.headers.map((_, i) => (free(i) ? 0 : need[i]!));
  const freeIdx = t.headers.map((_, i) => i).filter(free);
  let rest = width - fixed.reduce((a, b) => a + b, 0);
  let widths: number[];
  if (freeIdx.length && rest > freeIdx.length * 0.9) {
    const share = freeIdx.map((i) => Math.max(4, Math.min(40, Math.max(0, ...t.rows.slice(0, 80).map((r) => (r[i]?.text.length ?? 0) / 2)))));
    const sum = share.reduce((a, b) => a + b, 0);
    widths = t.headers.map((_, i) => (free(i) ? Math.max(0.9, (share[freeIdx.indexOf(i)]! / sum) * rest) : fixed[i]!));
  } else {
    // Too many columns for the slide: scale everything down proportionally (rare; smaller text keeps words whole).
    const total = need.reduce((a, b) => a + b, 0);
    widths = need.map((x) => (x / total) * width);
    rest = 0;
  }
  const scale = width / widths.reduce((a, b) => a + b, 0);
  const colW = order(widths.map((x) => x * scale));
  slide.addTable([header, ...body], {
    x: MARGIN,
    y: 0.95,
    w: width,
    colW,
    border: { type: 'solid', pt: 0.5, color: LINE },
    autoPage: true,
    autoPageRepeatHeader: true,
    autoPageHeaderRows: 1,
    autoPageSlideStartY: 0.95,
    autoPageLineWeight: -0.3,
    margin: 0.04,
  } as PptxGenJS.TableProps);
}
