import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { docxBytes, login, type DocClient } from '../documents/doc-helpers';
import { IP, mapBatch, rowsOf, submit, upload, uploadAndParse, xlsx } from './import-kit';

let dc: string;
let pm: DocClient;
let secretary: DocClient;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await login('pm');
  secretary = await login('secretary');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);

describe('REQ-INT-004 / REQ-INT-005 image, PDF and DOCX imports through the safe pipeline — unclear content never fills official fields', () => {
  it('DOCX minutes: extracted paragraphs become UNVERIFIED claims for review (no target, no confidence); nothing else changes', async () => {
    const bytes = docxBytes([
      { text: 'Minutes of the synthetic steering meeting', style: 'Title' },
      { text: 'Item 1: the data-centre separation workstream reported its status as Completed.' },
      { text: '' },
      { text: 'Item 2: action — legal to confirm the consent register (synthetic).' },
    ]);
    const tasksBefore = (await owner().query(`select count(*)::int n, max(updated_at) m from task where project_id = $1`, [dc])).rows[0];
    const b0 = await uploadAndParse(pm, dc, bytes, 'minutes.docx', { target: 'document_claims' });
    expect(b0).toMatchObject({ status: 'validated', fileType: 'docx', canMap: false });
    expect(b0.findings).toEqual([{ code: 'imports.file.paragraphs', params: { count: 3 } }]);
    const rows = await rowsOf(pm, dc, b0.id);
    expect(rows.map((r) => [r.rowNo, r.action, r.values['text']])).toEqual([
      [1, 'create', 'Minutes of the synthetic steering meeting'],
      [2, 'create', 'Item 1: the data-centre separation workstream reported its status as Completed.'],
      [3, 'create', 'Item 2: action — legal to confirm the consent register (synthetic).'],
    ]);
    expect(rows[1]!.notes.map((n) => n.code)).toEqual(['imports.row.document_claim']);
    const b = await submit(pm, dc, b0);
    const ok = await secretary.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2, 3] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const claims = (await owner().query(`select subject, location, target_type, target_id, field, confidence, verification_status, origin_status, applied_to_record from source_claim where source_id = $1 order by location`, [b.sourceId])).rows;
    expect(claims).toEqual([
      { subject: 'Paragraph 2', location: 'paragraph 2', target_type: null, target_id: null, field: null, confidence: null, verification_status: 'unknown', origin_status: 'unknown', applied_to_record: false },
      { subject: 'Paragraph 3', location: 'paragraph 3', target_type: null, target_id: null, field: null, confidence: null, verification_status: 'unknown', origin_status: 'unknown', applied_to_record: false },
    ]);
    const tasksAfter = (await owner().query(`select count(*)::int n, max(updated_at) m from task where project_id = $1`, [dc])).rows[0];
    expect(tasksAfter).toEqual(tasksBefore);
    const src = (await owner().query(`select source_type, extraction_status, checksum from source_record where id = $1`, [b.sourceId])).rows[0];
    expect(src).toEqual({ source_type: 'docx', extraction_status: 'performed', checksum: b.sha256 });
  });

  it('PDF and images: no OCR / PDF text extractor is configured — stated honestly, the file is preserved as a source, nothing is extracted or applied', async () => {
    const pdf = await uploadAndParse(pm, dc, Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF', 'latin1'), 'scanned-minutes.pdf', { target: 'document_claims' });
    const png = await uploadAndParse(pm, dc, PNG, 'whiteboard.png', { target: 'document_claims' });
    for (const b of [pdf, png]) {
      expect(b).toMatchObject({ status: 'validated', summary: { rows: 0, create: 0 } });
      expect(b.findings).toEqual([{ code: 'imports.file.extraction_not_configured', params: {} }]);
      const src = (await owner().query(`select extraction_status, extraction_note from source_record where id = $1`, [b.sourceId])).rows[0];
      expect(src.extraction_status).toBe('not_performed');
      expect(src.extraction_note).toMatch(/no OCR \/ PDF text extractor is configured/);
      const sub = await pm.post(IP(dc, `/${b.id}/submit`), { expectedVersion: b.version });
      expect(sub.body.code).toBe('imports.nothing_to_apply');
    }
    const policy = await pm.get(IP(dc, '/policy'));
    expect(policy.body).toMatchObject({ ocr: 'not_configured', pdfText: 'not_configured', parser: { isolation: 'child_process', permissionModel: true, osNetworkIsolation: 'not_configured', formulas: 'never_evaluated' } });
  });

  it('UT: confidence below threshold creates claim, not field value — a low-confidence extracted status stays a claim; the record keeps its value', async () => {
    const task = (await owner().query(`select id, wbs_code, status, version from task where project_id = $1 and status = 'not_started' order by sort_order offset 3 limit 1`, [dc])).rows[0];
    const bytes = await xlsx([{ name: 'Claims', rows: [['Subject', 'Value', 'Record type', 'Record code', 'Field', 'Confidence', 'Verification'], [`Status of ${task.wbs_code}`, 'Completed', 'task', task.wbs_code, 'status', 0.3, 'proposed']] }]);
    const parsed = await uploadAndParse(pm, dc, bytes, 'extracted.xlsx', { target: 'source_claims' });
    expect(parsed.suggestedMapping).toEqual({ subject: 'Subject', value: 'Value', targetType: 'Record type', targetCode: 'Record code', field: 'Field', confidence: 'Confidence', verification: 'Verification' });
    let b = await mapBatch(pm, dc, parsed);
    const [row] = await rowsOf(pm, dc, b.id);
    expect(row).toMatchObject({ action: 'create', match: { type: 'task', id: task.id, code: task.wbs_code }, diff: [{ field: 'status', from: task.status, to: 'Completed' }] });
    b = await submit(pm, dc, b);
    const ok = await secretary.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2] });
    expect(ok.status).toBe(201);
    const claim = (await owner().query(`select target_id, field, confidence, verification_status, applied_to_record from source_claim where source_id = $1`, [b.sourceId])).rows[0];
    expect(claim).toEqual({ target_id: task.id, field: 'status', confidence: '0.300', verification_status: 'proposed', applied_to_record: false });
    expect((await owner().query(`select status, version from task where id = $1`, [task.id])).rows[0]).toEqual({ status: task.status, version: task.version });
  });
});

describe('REQ-SRC-009 compare-before-merge for workbook or minutes uploads', () => {
  it('IT: merge preview lists diffs; previous source version retained — accepted item by item', async () => {
    const tasks = (await owner().query(`select id, wbs_code, status, planned_finish from task where project_id = $1 and status = 'not_started' order by sort_order offset 5 limit 2`, [dc])).rows;
    const sheet = (v: string) => [['Subject', 'Value', 'Record type', 'Record code', 'Field'], ...tasks.map((t) => [`Status of ${t.wbs_code}`, v, 'task', t.wbs_code, 'status'])];
    // Version 1 of the tracker.
    let v1 = await uploadAndParse(pm, dc, await xlsx([{ name: 'Tracker', rows: sheet('In progress') }]), 'tracker-v1.xlsx', { target: 'source_claims' });
    v1 = await mapBatch(pm, dc, v1);
    v1 = await submit(pm, dc, v1);
    expect((await secretary.post(IP(dc, `/${v1.id}/approve`), { expectedVersion: v1.version, acceptedRows: [2, 3] })).status).toBe(201);
    // Version 2 supersedes version 1: the preview compares every claim with the CURRENT record value.
    const up = await upload(pm, dc, await xlsx([{ name: 'Tracker', rows: sheet('Completed') }]), 'tracker-v2.xlsx', { target: 'source_claims', supersedesSourceId: v1.sourceId });
    expect(up.status).toBe(201);
    let v2 = (await pm.get(IP(dc, `/${up.body.id}`))).body;
    const { drainWorker } = await import('../documents/doc-helpers');
    await drainWorker();
    v2 = (await pm.get(IP(dc, `/${up.body.id}`))).body;
    v2 = await mapBatch(pm, dc, v2);
    const rows = await rowsOf(pm, dc, v2.id);
    expect(rows.map((r) => r.diff)).toEqual(tasks.map((t) => [{ field: 'status', from: t.status, to: 'Completed' }]));
    v2 = await submit(pm, dc, v2);
    // Item by item: only the first item is accepted.
    const ok = await secretary.post(IP(dc, `/${v2.id}/approve`), { expectedVersion: v2.version, acceptedRows: [2] });
    expect(ok.status).toBe(201);
    expect((await rowsOf(pm, dc, v2.id)).map((r) => r.decision)).toEqual(['accepted', 'declined']);
    const sources = (await owner().query(`select id, supersedes_source_id from source_record where id = any($1::uuid[]) order by created_at`, [[v1.sourceId, v2.sourceId]])).rows;
    expect(sources).toEqual([
      { id: v1.sourceId, supersedes_source_id: null },
      { id: v2.sourceId, supersedes_source_id: v1.sourceId },
    ]);
    // The previous source and its claims are kept; the new one has only the accepted claim; no record changed.
    expect((await owner().query(`select count(*)::int n from source_claim where source_id = $1`, [v1.sourceId])).rows[0].n).toBe(2);
    expect((await owner().query(`select count(*)::int n from source_claim where source_id = $1`, [v2.sourceId])).rows[0].n).toBe(1);
    expect((await owner().query(`select status from task where id = any($1::uuid[]) order by sort_order`, [tasks.map((t) => t.id)])).rows.map((r) => r.status)).toEqual(tasks.map((t) => t.status));
    // A source is superseded once.
    const again = await upload(pm, dc, await xlsx([{ name: 'Tracker', rows: sheet('x') }]), 'tracker-v2b.xlsx', { target: 'source_claims', supersedesSourceId: v1.sourceId });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('sources.already_superseded');
  });
});
