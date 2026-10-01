import ExcelJS from 'exceljs';
import { deflateRawSync, crc32 } from 'node:zlib';
import { expect } from 'vitest';
import { owner } from '../helpers';
import { drainWorker, type DocClient } from '../documents/doc-helpers';

export const IP = (pid: string, path = '') => `/api/v1/projects/${pid}/imports${path}`;

export type CellInput = string | number | boolean | null | { formula: string; result?: string | number } | { text: string; hyperlink: string } | Date;

/** A genuine XLSX workbook (exceljs) with one or more sheets of rows (first row = headers). */
export async function xlsx(sheets: { name: string; rows: CellInput[][]; dateColumns?: number[] }[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  for (const s of sheets) {
    const ws = wb.addWorksheet(s.name);
    s.rows.forEach((r, i) => {
      const row = ws.getRow(i + 1);
      r.forEach((v, j) => {
        row.getCell(j + 1).value = v as ExcelJS.CellValue;
        if (v instanceof Date) row.getCell(j + 1).numFmt = 'dd/mm/yyyy';
      });
      row.commit();
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function csv(rows: (string | number)[][]): Buffer {
  return Buffer.from(rows.map((r) => r.map((v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',')).join('\r\n') + '\r\n', 'utf8');
}

/** ZIP writer with deflated entries and optionally LYING sizes in the central directory (zip-bomb fixtures). */
export function deflatedZip(entries: { name: string; data: Buffer | string; declaredSize?: number }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const raw = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data, 'utf8');
    const data = deflateRawSync(raw);
    const name = Buffer.from(e.name, 'utf8');
    const crc = crc32(raw);
    const usize = e.declaredSize ?? raw.length;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(usize, 22);
    lh.writeUInt16LE(name.length, 26);
    locals.push(lh, name, data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(usize, 24);
    ch.writeUInt16LE(name.length, 28);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** Minimal hand-written XLSX package around one sheet XML (for fixtures exceljs cannot produce). */
export function rawXlsx(sheetXml: string, opts: { sharedStrings?: string[]; extra?: { name: string; data: string | Buffer; declaredSize?: number }[]; sheetTarget?: string } = {}): Buffer {
  const ss = opts.sharedStrings ?? [];
  return deflatedZip([
    { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>' },
    { name: 'xl/workbook.xml', data: '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${opts.sheetTarget ?? 'worksheets/sheet1.xml'}"/></Relationships>` },
    { name: 'xl/sharedStrings.xml', data: `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${ss.map((s) => `<si><t>${s}</t></si>`).join('')}</sst>` },
    { name: 'xl/worksheets/sheet1.xml', data: `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetXml}</sheetData></worksheet>` },
    ...(opts.extra ?? []),
  ]);
}

export async function upload(c: DocClient, pid: string, bytes: Buffer, filename: string, query: Record<string, string>) {
  const qs = new URLSearchParams(query).toString();
  return c.upload(`${IP(pid)}?${qs}`, bytes, filename);
}

/** Upload, run the worker (sandboxed parse) and return the batch detail. */
export async function uploadAndParse(c: DocClient, pid: string, bytes: Buffer, filename: string, query: Record<string, string>) {
  const up = await upload(c, pid, bytes, filename, query);
  if (up.status !== 201) throw new Error(`upload ${filename} → ${up.status} ${JSON.stringify(up.body)}`);
  await drainWorker();
  const d = await c.get(IP(pid, `/${up.body.id}`));
  expect(d.status, JSON.stringify(d.body)).toBe(200);
  return d.body;
}

/** Map with the suggested mapping (or the given one) and return the validated detail. */
export async function mapBatch(c: DocClient, pid: string, batch: { id: string; version: number; suggestedMapping: Record<string, string> | null; sheets: { name: string }[] }, mapping?: Record<string, string>, sheet?: string) {
  const r = await c.post(IP(pid, `/${batch.id}/mapping`), { expectedVersion: batch.version, sheet: sheet ?? batch.sheets[0]!.name, headerRow: 1, mapping: mapping ?? batch.suggestedMapping });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

export async function rowsOf(c: DocClient, pid: string, batchId: string) {
  const r = await c.get(IP(pid, `/${batchId}/rows?pageSize=100`));
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.items as { rowNo: number; action: string; values: Record<string, unknown>; errors: { code: string; params: Record<string, unknown> }[]; warnings: { code: string }[]; notes: { code: string }[]; match: { type: string; id: string; code: string | null } | null; diff: { field: string; from: unknown; to: unknown }[]; formulaFields: string[]; duplicateOfRow: number | null; decision: string | null }[];
}

export async function submit(c: DocClient, pid: string, batch: { id: string; version: number }) {
  const r = await c.post(IP(pid, `/${batch.id}/submit`), { expectedVersion: batch.version });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

export async function auditCount(action: string, entityId: string, outcome?: string): Promise<number> {
  const r = await owner().query<{ n: number }>(`select count(*)::int n from audit_event where action = $1 and entity_id = $2 ${outcome ? 'and outcome = $3' : ''}`, outcome ? [action, entityId, outcome] : [action, entityId]);
  return r.rows[0]!.n;
}

export { drainWorker };
