import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  HeadingLevel,
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
} from 'docx';
import { textIsRtl, type RenderDoc, type RenderTable } from './document';

export const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

const FONT = 'Arial';
const BORDER = { style: BorderStyle.SINGLE, size: 4, color: 'C8D3E0' };
const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

/**
 * Genuine Word document (docx, REQ-RPT-010) — used for minutes and for every other report kind. Arabic documents use
 * bidirectional paragraphs (`w:bidi`), right-to-left runs (`w:rtl`) with Arabic as the complex-script language, and
 * visually right-to-left tables (`w:bidiVisual`). The footer of every page carries the classification and page n / N;
 * approvals in the content are labelled as internal electronic approvals (REQ-GOV-027).
 */
export async function renderDocx(doc: RenderDoc): Promise<Buffer> {
  const rtl = doc.dir === 'rtl';
  const L = doc.labels;
  const run = (text: string, o: { bold?: boolean; italics?: boolean; size?: number; color?: string } = {}) =>
    new TextRun({ text, bold: o.bold, italics: o.italics, size: o.size, color: o.color, rightToLeft: rtl && textIsRtl(text, true), font: { ascii: FONT, hAnsi: FONT, cs: FONT }, language: rtl ? { value: 'ar-SA', bidirectional: 'ar-SA' } : { value: 'en-GB' } });
  // Each paragraph takes the direction of its own text; in an Arabic document a left-to-right paragraph (English record
  // text) is still aligned to the right edge, so the layout stays right-to-left.
  const para = (children: ParagraphChild[], o: { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel]; spacingAfter?: number; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; text?: string } = {}) => {
    const dirRtl = rtl && textIsRtl(o.text ?? '', true);
    return new Paragraph({ children, heading: o.heading, bidirectional: dirRtl, spacing: { after: o.spacingAfter ?? 80 }, alignment: o.align ?? (rtl && !dirRtl ? AlignmentType.RIGHT : undefined) });
  };
  const p = (text: string, o: Parameters<typeof run>[1] & { heading?: (typeof HeadingLevel)[keyof typeof HeadingLevel] } = {}) => para([run(text, o)], { heading: o.heading, text });

  const table = (headers: string[], rows: { text: string; numeric: boolean }[][], header = true) =>
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      visuallyRightToLeft: rtl,
      rows: [
        ...(header
          ? [
              new TableRow({
                tableHeader: true,
                children: headers.map((h) => new TableCell({ borders: BORDERS, shading: { type: ShadingType.CLEAR, color: 'auto', fill: 'E8EEF6' }, children: [para([run(h, { bold: true, size: 17 })], { spacingAfter: 0, text: h })] })),
              }),
            ]
          : []),
        ...rows.map(
          (r) =>
            new TableRow({
              cantSplit: true,
              children: r.map((c) => new TableCell({ borders: BORDERS, children: [para([run(c.text, { size: 17 })], { spacingAfter: 0, text: c.text, align: c.numeric ? (rtl ? AlignmentType.LEFT : AlignmentType.RIGHT) : undefined })] })),
            }),
        ),
      ],
    });

  const dataTable = (t: RenderTable) => {
    const numeric = t.types.map((x) => x === 'number' || x === 'percent' || x === 'money');
    if (!t.rows.length) return [p(t.title, { bold: true }), p(L.noRows, { italics: true, color: '6B7685' })];
    // Long free text (minutes) as paragraphs rather than a one-column table.
    if (t.headers.length === 1) return [p(t.title, { bold: true }), ...t.rows.flatMap((r) => r[0]!.text.split(/\r?\n/).map((line) => p(line)))];
    return [p(t.title, { bold: true }), table(t.headers, t.rows.map((r) => r.map((c, i) => ({ text: c.text, numeric: numeric[i]! })))), ...(t.truncatedNote ? [p(t.truncatedNote, { italics: true, size: 16 })] : [])];
  };

  const children: (Paragraph | Table)[] = [
    p(`${L.classification}: ${doc.classificationLabel}`, { bold: true, color: 'A3261F' }),
    ...(doc.demo ? [p(L.demoBanner, { bold: true, color: '9C5700' })] : []),
    p(doc.title, { heading: HeadingLevel.TITLE }),
    p(doc.projectLine, { size: 24 }),
    table([], doc.meta.map(([k, v]) => [{ text: k, numeric: false }, { text: v, numeric: false }]), false),
    p(L.snapshotNote, { italics: true, size: 18 }),
    ...(doc.partialNote ? [p(doc.partialNote, { bold: true, size: 18 })] : []),
  ];
  for (const s of doc.sections) {
    children.push(p(s.title, { heading: HeadingLevel.HEADING_1 }));
    if (s.withheld) {
      children.push(p(L.withheld, { italics: true, color: '6B7685' }));
      continue;
    }
    if (s.classification) children.push(p(s.classification, { size: 16, color: '1F4E8C' }));
    if (s.figures.length) children.push(table([L.item, L.value, ''], s.figures.map((f) => [{ text: f.label, numeric: false }, { text: f.text, numeric: true }, { text: f.previousText ?? '', numeric: false }])));
    for (const n of s.notes) children.push(p(`• ${n}`, { size: 18 }));
    for (const t of s.tables) children.push(...dataTable(t));
    if (s.unverified.length) children.push(p(`${L.unverifiedData}: ${s.unverified.slice(0, 60).join(' · ')}`, { size: 16, color: '4E5B6B' }));
    if (s.sources.length) children.push(p(`${L.sources}: ${s.sources.slice(0, 60).join(' · ')}`, { size: 16, color: '4E5B6B' }));
  }

  const document = new Document({
    creator: 'Transformation Hub',
    title: `${doc.title} — ${doc.projectLine}`,
    subject: doc.classificationLabel,
    styles: { default: { document: { run: { font: { ascii: FONT, hAnsi: FONT, cs: FONT }, size: 20 } } } },
    sections: [
      {
        properties: { page: { margin: { top: 900, bottom: 900, left: 800, right: 800 } } },
        footers: {
          default: new Footer({
            children: [para([run(`${L.classification}: ${doc.classificationLabel}${doc.demo ? ` · ${L.demoBanner}` : ''}    `, { size: 16 }), new TextRun({ children: [PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], size: 16 })], { text: L.classification })],
          }),
        },
        children,
      },
    ],
  });
  return Packer.toBuffer(document);
}
