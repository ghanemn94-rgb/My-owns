import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { closeApp, closePools, DC, getApp, owner, projectIdByCode } from '../helpers';
import { EICAR, buildZip, drainWorker, login, type DocClient } from '../documents/doc-helpers';
import { OBJECT_STORAGE, type ObjectStorage } from '../../src/modules/documents/storage/object-storage';
import { runSandboxedParse } from '../../src/modules/imports/sandbox/sandbox';
import { IP, deflatedZip, mapBatch, rawXlsx, rowsOf, submit, upload, uploadAndParse, xlsx } from './import-kit';

let dc: string;
let secretary: DocClient;
let pm: DocClient;
let server: Server;
let hits = 0;
let stub = '';

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  secretary = await login('secretary');
  pm = await login('pm');
  // A local "internal" service: any request reaching it would be an SSRF — the tests assert it is never contacted.
  server = createServer((_req, res) => {
    hits++;
    res.end('internal secret');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  stub = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await closeApp();
  await closePools();
});

async function batchRow(id: string) {
  return (await owner().query(`select status, failure_code, document_version_id, source_id, quarantine_key, file_type from import_batch where id = $1`, [id])).rows[0];
}

/** The API still serves after a refused file (no service disruption). */
async function stillServing() {
  const r = await pm.get(IP(dc, '/policy'));
  expect(r.status).toBe(200);
}

describe('AT-25 — malicious, oversized or malformed imports are blocked or quarantined without formula execution, SSRF or service disruption [REQ-INT-004, REQ-SEC-014, REQ-SEC-015]', () => {
  it('an oversized import is refused (413) and nothing is created', async () => {
    const before = (await owner().query(`select count(*)::int n from import_batch where project_id = $1`, [dc])).rows[0].n;
    const r = await upload(secretary, dc, Buffer.alloc(25 * 1024 * 1024 + 1, 0x61), 'huge.csv', { target: 'risk' });
    expect(r.status).toBe(413);
    expect((await owner().query(`select count(*)::int n from import_batch where project_id = $1`, [dc])).rows[0].n).toBe(before);
    await stillServing();
  });

  it('a malware test signature is quarantined: held in the quarantine area, never stored as a document, never parsed; audited', async () => {
    const r = await upload(secretary, dc, Buffer.from(`Title,Probability,Impact\r\n${EICAR},1,1\r\n`), 'risks.csv', { target: 'risk' });
    expect(r.status).toBe(201);
    expect(r.body.status).toBe('quarantined');
    const b = await batchRow(r.body.id);
    expect(b).toMatchObject({ status: 'quarantined', failure_code: 'imports.upload.quarantined', document_version_id: null, source_id: null });
    expect(b.quarantine_key).toMatch(new RegExp(`^quarantine/${dc}/${r.body.id}$`));
    const storage = (await getApp()).get<ObjectStorage>(OBJECT_STORAGE);
    expect(await storage.exists(b.quarantine_key)).toBe(true);
    expect((await owner().query(`select count(*)::int n from job where idempotency_key = $1`, [`import-parse:${r.body.id}`])).rows[0].n).toBe(0);
    expect((await owner().query(`select count(*)::int n from audit_event where action = 'security.file_quarantined' and entity_id = $1`, [r.body.id])).rows[0].n).toBe(1);
    // No mapping, submission or approval is possible on a quarantined batch.
    const map = await secretary.post(IP(dc, `/${r.body.id}/mapping`), { expectedVersion: 1, sheet: 'CSV', headerRow: 1, mapping: { title: 'Title' } });
    expect(map.status).toBe(422);
  });

  it('IT: malicious PDF quarantined (JavaScript / launch actions, also hex-escaped names)', async () => {
    for (const [name, pdf] of [
      ['js.pdf', '%PDF-1.7\n1 0 obj << /Type /Catalog /OpenAction << /S /JavaScript /JS (app.alert(1)) >> >> endobj\n%%EOF'],
      ['escaped.pdf', '%PDF-1.7\n1 0 obj << /Type /Catalog /AA << /O << /S /J#61vaScript /JS (x) >> >> >> endobj\n%%EOF'],
      ['launch.pdf', '%PDF-1.4\n1 0 obj << /S /Launch /F (cmd.exe) >> endobj\n%%EOF'],
    ] as const) {
      const r = await upload(pm, dc, Buffer.from(pdf, 'latin1'), name, { target: 'document_claims' });
      expect(r.status, name).toBe(201);
      expect(r.body, name).toMatchObject({ status: 'quarantined', fileType: 'pdf' });
      expect((await batchRow(r.body.id)).document_version_id, name).toBeNull();
    }
  });

  it('IT: zip-bomb / decompression bomb terminated without service disruption (declared ratio and lying sizes)', async () => {
    const huge = Buffer.concat([Buffer.from('<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'), Buffer.alloc(48 * 1024 * 1024, 0x20), Buffer.from('</sheetData></worksheet>')]);
    const wb = (declaredSize?: number) =>
      deflatedZip([
        { name: '[Content_Types].xml', data: '<Types/>' },
        { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Bomb" sheetId="1" r:id="rId1"/></sheets></workbook>' },
        { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', data: huge, declaredSize },
      ]);
    const declared = wb();
    expect(declared.length).toBeLessThan(200 * 1024); // ~48 MB inflate from a tiny file
    const a = await uploadAndParse(secretary, dc, declared, 'bomb.xlsx', { target: 'risk' });
    expect(a).toMatchObject({ status: 'failed', failureCode: 'imports.parse.zip_bomb' });
    // The central directory LIES about the size: the limit applies to the bytes actually inflated.
    const lying = wb(4096);
    const b = await uploadAndParse(secretary, dc, lying, 'liar.xlsx', { target: 'risk' });
    expect(b).toMatchObject({ status: 'failed', failureCode: 'imports.parse.zip_bomb' });
    const src = (await owner().query(`select extraction_status, extraction_note from source_record where id = $1`, [b.sourceId])).rows[0];
    expect(src.extraction_status).toBe('failed');
    expect((await owner().query(`select count(*)::int n from import_sheet where batch_id = any($1::uuid[])`, [[a.id, b.id]])).rows[0].n).toBe(0);
    await stillServing();
  });

  it('entity declarations (XXE / billion laughs) and path traversal in package relationships are refused', async () => {
    // A shared-strings part that declares entities (billion laughs + an external entity).
    const evil = deflatedZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/sharedStrings.xml', data: '<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]><sst><si><t>&lol2;&xxe;</t></si></sst>' },
      { name: 'xl/worksheets/sheet1.xml', data: '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData></worksheet>' },
    ]);
    const a = await uploadAndParse(secretary, dc, evil, 'xxe.xlsx', { target: 'risk' });
    expect(a).toMatchObject({ status: 'failed', failureCode: 'imports.parse.dtd_refused' });
    const traversal = rawXlsx('<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c></row>', { sheetTarget: '../../../../etc/passwd' });
    const b = await uploadAndParse(secretary, dc, traversal, '..%2F..%2Fevil.xlsx', { target: 'risk' });
    expect(b).toMatchObject({ status: 'failed', failureCode: 'imports.parse.path_traversal' });
    // The client-supplied name never reaches a storage path: keys are server-generated UUID paths.
    expect(b.filename).not.toContain('/');
    const key = (await owner().query(`select storage_key from document_version where id = $1`, [b.documentVersionId])).rows[0].storage_key;
    expect(key).toMatch(/^documents\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/);
  });

  it('formulas are never evaluated, harmful ones block their row, links are inert and URLs are never fetched (stub server: zero hits)', async () => {
    const bytes = await xlsx([
      {
        name: 'Risks',
        rows: [
          ['Title', 'Probability', 'Impact', 'Description'],
          [{ formula: `WEBSERVICE("${stub}/meta")`, result: 'cached text' }, 2, 2, null],
          [{ formula: `HYPERLINK("${stub}/click","Click")`, result: 'Click' }, 1, 1, null],
          ['Synthetic formula probe', { formula: '1+1', result: 2 }, 3, { text: 'internal link', hyperlink: `${stub}/doc` }],
          ['Synthetic metadata probe', 1, 1, 'see http://169.254.169.254/latest/meta-data/iam/security-credentials'],
          ['=cmd|\' /C calc\'!A0', 1, 1, null],
          ['Synthetic external link', 1, 1, 'Spec: https://example.com/spec'],
        ],
      },
    ]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'formulas.xlsx', { target: 'risk' });
    expect(parsed.findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['imports.file.formula_cells', 'imports.file.harmful_formulas', 'imports.file.hyperlinks']));
    let b = await mapBatch(secretary, dc, { ...parsed, suggestedMapping: { title: 'Title', probability: 'Probability', impact: 'Impact', description: 'Description' } });
    const rows = await rowsOf(secretary, dc, b.id);
    const byRow = new Map(rows.map((r) => [r.rowNo, r]));
    expect(byRow.get(2)).toMatchObject({ action: 'error', errors: [{ code: 'imports.row.harmful_formula', params: { field: 'title', function: 'WEBSERVICE' } }] });
    expect(byRow.get(3)!.errors[0]).toMatchObject({ code: 'imports.row.harmful_formula', params: { function: 'HYPERLINK' } });
    // A benign formula keeps its CACHED value (never evaluated) with a warning; the hyperlink is inert text.
    expect(byRow.get(4)).toMatchObject({ action: 'create', values: { probability: 2 }, formulaFields: ['probability'] });
    expect(byRow.get(4)!.warnings.map((w) => w.code)).toContain('imports.row.formula_cached_value');
    expect(byRow.get(5)!.errors).toEqual([{ code: 'imports.row.internal_url', params: { field: 'description', host: '169.254.169.254' } }]);
    // DDE text in a cell is formula-like TEXT: kept as text (never evaluated), flagged.
    expect(byRow.get(6)!.warnings.map((w) => w.code)).toContain('imports.row.formula_like_text');
    expect(byRow.get(7)).toMatchObject({ action: 'create' });
    expect(byRow.get(7)!.warnings.map((w) => w.code)).toEqual(['imports.row.url_inert']);
    b = await submit(secretary, dc, b);
    // A blocked row can never be accepted.
    const bad = await pm.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2, 4] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('imports.accept.not_applicable');
    const ok = await pm.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [4, 6, 7] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const created = (await owner().query(`select title, probability from risk where id = any($1::uuid[]) order by title`, [ok.body.outputs.map((o: { recordId: string }) => o.recordId)])).rows;
    expect(created).toEqual([
      { title: "=cmd|' /C calc'!A0", probability: 1 },
      { title: 'Synthetic external link', probability: 1 },
      { title: 'Synthetic formula probe', probability: 2 },
    ]);
    // External workbook links / data connections are counted, never followed.
    const ext = rawXlsx('<row r="1"><c r="A1" t="inlineStr"><is><t>Title</t></is></c><c r="B1" t="inlineStr"><is><t>Probability</t></is></c><c r="C1" t="inlineStr"><is><t>Impact</t></is></c></row><row r="2"><c r="A2"><f>[1]Sheet1!A1</f><v>7</v></c><c r="B2"><v>1</v></c><c r="C2"><v>1</v></c></row>', {
      extra: [
        { name: 'xl/externalLinks/externalLink1.xml', data: '<externalLink/>' },
        { name: 'xl/externalLinks/_rels/externalLink1.xml.rels', data: `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/externalLinkPath" Target="${stub}/book.xlsx" TargetMode="External"/></Relationships>` },
        { name: 'xl/connections.xml', data: `<connections><connection id="1" name="q"><webPr url="${stub}/query"/></connection></connections>` },
      ],
    });
    const e = await uploadAndParse(secretary, dc, ext, 'external.xlsx', { target: 'risk' });
    expect(e.findings.map((f: { code: string }) => f.code)).toEqual(expect.arrayContaining(['imports.file.external_links', 'imports.file.data_connections', 'imports.file.harmful_formulas']));
    await drainWorker();
    expect(hits).toBe(0);
  });

  it('IT: import referencing http://169.254.169.254 rejected (row blocked, never fetched)', async () => {
    const parsed = await uploadAndParse(secretary, dc, Buffer.from('Title,Probability,Impact\r\nhttp://169.254.169.254/latest/meta-data/,1,1\r\nhttps://[::ffff:169.254.169.254]/x,1,1\r\nhttp://2852039166/,1,1\r\n'), 'meta.csv', { target: 'risk' });
    const b = await mapBatch(secretary, dc, parsed);
    const rows = await rowsOf(secretary, dc, b.id);
    expect(rows.map((r) => r.errors[0]?.code)).toEqual(['imports.row.internal_url', 'imports.row.internal_url', 'imports.row.internal_url']);
    expect(b.summary).toMatchObject({ error: 3, create: 0 });
    const sub = await secretary.post(IP(dc, `/${b.id}/submit`), { expectedVersion: b.version });
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe('imports.nothing_to_apply');
  });

  it('malformed or disallowed files are refused: truncated package, invalid UTF-8, macros, a type the target does not accept, unterminated CSV quote', async () => {
    const good = await xlsx([{ name: 'S', rows: [['Title'], ['x']] }]);
    const truncated = await upload(secretary, dc, good.subarray(0, Math.floor(good.length / 2)), 'cut.xlsx', { target: 'risk' });
    expect(truncated.status).toBe(422);
    expect(truncated.body.code).toMatch(/^imports\.upload\./);
    const latin = await upload(secretary, dc, Buffer.from([0x54, 0x69, 0x74, 0x6c, 0x65, 0x0d, 0x0a, 0xe9, 0xff, 0xfe, 0x00]), 'bad.csv', { target: 'risk' });
    expect(latin.status).toBe(422);
    const macro = await upload(secretary, dc, buildZip([{ name: '[Content_Types].xml', data: '<Types/>' }, { name: 'xl/workbook.xml', data: '<workbook/>' }, { name: 'xl/vbaProject.bin', data: 'VBA' }]), 'macro.xlsx', { target: 'risk' });
    expect(macro.status).toBe(422);
    expect(macro.body.code).toBe('imports.upload.macro_enabled');
    const wrong = await upload(secretary, dc, Buffer.from('%PDF-1.7\n%%EOF', 'latin1'), 'register.pdf', { target: 'risk' });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('imports.upload.type_not_for_target');
    const quote = await uploadAndParse(secretary, dc, Buffer.from('Title,Probability\r\n"never closed,1\r\n'), 'quote.csv', { target: 'risk' });
    expect(quote).toMatchObject({ status: 'failed', failureCode: 'imports.parse.malformed' });
    await stillServing();
  });

  it('REQ-SEC-015: the isolated parser is stopped at its time and memory limits; the process keeps running', async () => {
    const big = Buffer.from(`Title,Probability,Impact\r\n${'Synthetic row,1,1\r\n'.repeat(4000)}`);
    const t = await runSandboxedParse(big, 'csv', { timeoutMs: 1 });
    expect(t).toMatchObject({ ok: false, code: 'imports.parse.timeout' });
    const sheet = `<worksheet><sheetData>${'<row><c t="inlineStr"><is><t>xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx</t></is></c></row>'.repeat(200_000)}</sheetData></worksheet>`;
    const pkg = deflatedZip([
      { name: '[Content_Types].xml', data: '<Types/>' },
      { name: 'xl/workbook.xml', data: '<workbook xmlns:r="r"><sheets><sheet name="M" sheetId="1" r:id="rId1"/></sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
      { name: 'xl/worksheets/sheet1.xml', data: sheet },
    ]);
    const m = await runSandboxedParse(pkg, 'xlsx', { heapMb: 16, maxRows: 1_000_000, maxCells: 1_000_000, maxRatio: 1_000_000 });
    expect(m.ok).toBe(false);
    if (!m.ok) expect(m.code).toBe('imports.parse.memory_limit');
    // A normal parse right after works.
    const n = await runSandboxedParse(Buffer.from('Title\r\nok\r\n'), 'csv');
    expect(n).toMatchObject({ ok: true });
  });
});
