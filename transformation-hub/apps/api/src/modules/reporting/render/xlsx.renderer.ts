import ExcelJS from 'exceljs';
import { neutralizeSpreadsheetText } from '@hub/domain';
import type { RenderDoc } from './document';

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Excel sheet names: ≤ 31 characters, none of []:*?/\ , unique in the workbook. */
function sheetName(raw: string, used: Set<string>): string {
  const base = raw.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 28) || 'Sheet';
  let name = base;
  for (let i = 2; used.has(name.toLowerCase()); i++) name = `${base.slice(0, 26)} ${i}`;
  used.add(name.toLowerCase());
  return name;
}

/** Every text cell goes through the C-17 neutralisation: a formula-like value is written with a leading apostrophe. */
const text = (s: string) => neutralizeSpreadsheetText(s);

/**
 * Genuine OOXML workbook (exceljs) of a report view (REQ-RPT-007, REQ-SEC-017): a "report" sheet with the metadata, the
 * key figures and the notes of every section, one sheet per table (numbers as numbers), and a sources sheet. No cell is a
 * formula; text that would start a formula is neutralised. Arabic workbooks use right-to-left sheets.
 */
export async function renderXlsx(doc: RenderDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Transformation Hub';
  wb.title = text(`${doc.title} — ${doc.projectLine}`);
  wb.subject = text(doc.classificationLabel);
  wb.created = new Date(doc.asOf);
  wb.modified = new Date(doc.asOf);
  const rtl = doc.dir === 'rtl';
  const used = new Set<string>();
  const L = doc.labels;

  const main = wb.addWorksheet(sheetName(doc.locale === 'ar' ? 'التقرير' : 'Report', used), { views: [{ rightToLeft: rtl }] });
  main.columns = [{ width: 48 }, { width: 60 }, { width: 22 }];
  const title = main.addRow([text(doc.title), text(doc.projectLine)]);
  title.font = { bold: true, size: 14 };
  main.addRow([text(L.classification), text(doc.classificationLabel)]).font = { bold: true, color: { argb: 'FF9C0006' } };
  if (doc.demo) main.addRow([text(L.demoBanner)]).font = { bold: true, color: { argb: 'FF9C5700' } };
  main.addRow([text(L.snapshotNote)]);
  if (doc.partialNote) main.addRow([text(doc.partialNote)]).font = { italic: true };
  main.addRow([]);
  main.addRow([text(L.metadata)]).font = { bold: true };
  for (const [k, v] of doc.meta) main.addRow([text(k), text(v)]);
  for (const s of doc.sections) {
    main.addRow([]);
    main.addRow([text(s.title), s.classification ? text(s.classification) : '']).font = { bold: true, size: 12 };
    if (s.withheld) {
      main.addRow([text(L.withheld)]).font = { italic: true };
      continue;
    }
    for (const f of s.figures) {
      const r = main.addRow([text(f.label), f.value ?? text(f.text), f.previousText ? text(f.previousText) : '']);
      if (typeof f.value === 'number') r.getCell(2).numFmt = '#,##0.0##';
    }
    for (const n of s.notes) main.addRow([text(n)]).font = { italic: true, color: { argb: 'FF555555' } };
  }

  for (const s of doc.sections) {
    if (s.withheld) continue;
    for (const t of s.tables) {
      const ws = wb.addWorksheet(sheetName(`${s.title} - ${t.title}`, used), { views: [{ rightToLeft: rtl, state: 'frozen', ySplit: 2 }] });
      ws.addRow([text(`${s.title} — ${t.title}`)]).font = { bold: true };
      const head = ws.addRow(t.headers.map(text));
      head.font = { bold: true };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCE6F2' } };
      for (const row of t.rows) {
        ws.addRow(row.map((c) => (c.number !== null && (c.type === 'number' || c.type === 'percent') ? c.number : text(c.text))));
      }
      if (!t.rows.length) ws.addRow([text(L.noRows)]).font = { italic: true };
      if (t.truncatedNote) ws.addRow([text(t.truncatedNote)]).font = { italic: true };
      ws.columns = t.headers.map((h, i) => ({ width: Math.min(60, Math.max(12, h.length + 4, ...t.rows.slice(0, 50).map((r) => Math.min(60, (r[i]?.text.length ?? 0) + 2)))) }));
    }
  }

  const src = wb.addWorksheet(sheetName(doc.locale === 'ar' ? 'المصادر' : 'Sources', used), { views: [{ rightToLeft: rtl }] });
  src.columns = [{ width: 40 }, { width: 50 }, { width: 50 }];
  src.addRow(['', text(L.sources), text(L.unverifiedData)]).font = { bold: true };
  for (const s of doc.sections) {
    if (s.withheld) continue;
    const n = Math.max(s.sources.length, s.unverified.length);
    for (let i = 0; i < n; i++) src.addRow([i === 0 ? text(s.title) : '', s.sources[i] ? text(s.sources[i]!) : '', s.unverified[i] ? text(s.unverified[i]!) : '']);
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}
