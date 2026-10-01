import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { login, type DocClient } from '../documents/doc-helpers';
import { IP, auditCount, mapBatch, rowsOf, submit, uploadAndParse, xlsx } from './import-kit';

let dc: string;
let secretary: DocClient;
let pm: DocClient;
let existingRisk: { id: string; code: string; title: string; probability: number; impact: number };

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  secretary = await login('secretary');
  pm = await login('pm');
  existingRisk = (await owner().query(`select id, code, title, probability, impact from risk where project_id = $1 and status = 'open' order by code limit 1`, [dc])).rows[0];
  expect(existingRisk, 'demo project has an open risk').toBeTruthy();
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const RISK_HEADERS = ['Code', 'Risk title', 'Probability', 'Impact', 'Due date', 'Response strategy'];

async function riskWorkbook(rows: (string | number | null | Date)[][]) {
  return xlsx([
    { name: 'Notes', rows: [['This sheet is not data']] },
    { name: 'Risks', rows: [RISK_HEADERS, ...rows] },
  ]);
}

describe('REQ-INT-001 Excel/CSV import wizard: mapping, preview, validation, duplicate detection', () => {
  it('IT: reviewed sample workbook imports with validation report', async () => {
    const bytes = await riskWorkbook([
      [null, 'Synthetic import risk A — vendor lead time', 3, 4, new Date(Date.UTC(2027, 2, 15)), 'Mitigate'],
      [null, 'Synthetic import risk B — licence transfer', 2, 2, '2027-04-01', 'accept'],
      [null, 'Synthetic import risk A — vendor lead time', 3, 4, null, null],
      [null, 'Synthetic import risk C — bad scale', 9, 2, null, null],
      [existingRisk.code, existingRisk.title, existingRisk.probability === 5 ? 4 : existingRisk.probability + 1, existingRisk.impact, null, null],
    ]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'risk-register-sample.xlsx', { target: 'risk', classification: 'confidential' });
    expect(parsed).toMatchObject({ status: 'parsed', target: 'risk', fileType: 'xlsx', classification: 'confidential' });
    expect(parsed.sheets.map((s: { name: string }) => s.name)).toEqual(['Notes', 'Risks']);
    expect(parsed.sheetPreview['Risks'][0]).toEqual(RISK_HEADERS);
    const b = await mapBatch(secretary, dc, { ...parsed, suggestedMapping: { code: 'Code', title: 'Risk title', probability: 'Probability', impact: 'Impact', dueDate: 'Due date', responseStrategy: 'Response strategy' } }, undefined, 'Risks');
    expect(b.status).toBe('validated');
    expect(b.summary).toMatchObject({ rows: 5, create: 2, update: 1, error: 2 });
    const rows = await rowsOf(secretary, dc, b.id);
    expect(rows.map((r) => [r.rowNo, r.action])).toEqual([
      [2, 'create'],
      [3, 'create'],
      [4, 'error'],
      [5, 'error'],
      [6, 'update'],
    ]);
    expect(rows[0]!.values).toMatchObject({ probability: 3, impact: 4, dueDate: '2027-03-15', responseStrategy: 'mitigate' });
    expect(rows[2]!.errors[0]).toMatchObject({ code: 'imports.row.duplicate_in_batch', params: { row: 2 } });
    expect(rows[2]!.duplicateOfRow).toBe(2);
    expect(rows[3]!.errors.map((e) => e.code)).toEqual(['imports.row.not_scale5']);
    expect(rows[4]!.match).toEqual({ type: 'risk', id: existingRisk.id, code: existingRisk.code });
    expect(rows[4]!.diff).toEqual([{ field: 'probability', from: existingRisk.probability, to: existingRisk.probability === 5 ? 4 : existingRisk.probability + 1 }]);
    // Validation alone changed nothing in the register.
    expect((await owner().query(`select count(*)::int n from risk where project_id = $1 and title like 'Synthetic import risk%'`, [dc])).rows[0].n).toBe(0);
  });

  it('UT: duplicate row flagged with matching record id', async () => {
    const bytes = await riskWorkbook([[null, `  ${existingRisk.title.toUpperCase()}  `, 1, 1, null, null]]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'dup.xlsx', { target: 'risk' });
    const b = await mapBatch(secretary, dc, { ...parsed, suggestedMapping: { title: 'Risk title', probability: 'Probability', impact: 'Impact' } }, undefined, 'Risks');
    const [row] = await rowsOf(secretary, dc, b.id);
    expect(row).toMatchObject({ action: 'skip', match: { type: 'risk', id: existingRisk.id, code: existingRisk.code } });
    expect(row!.notes.map((n) => n.code)).toEqual(['imports.row.possible_duplicate']);
  });

  it('a CSV file uses the same mapping and checks (values are text; Arabic digits and day-first dates)', async () => {
    const bytes = Buffer.from('﻿العنوان,الاحتمالية,الأثر,تاريخ الاستحقاق\r\n"Synthetic CSV risk, with comma",٣,2,01/02/2027\r\n', 'utf8');
    const parsed = await uploadAndParse(secretary, dc, bytes, 'risks.csv', { target: 'risk' });
    expect(parsed.suggestedMapping).toEqual({ title: 'العنوان', probability: 'الاحتمالية', impact: 'الأثر', dueDate: 'تاريخ الاستحقاق' });
    const b = await mapBatch(secretary, dc, parsed);
    const [row] = await rowsOf(secretary, dc, b.id);
    expect(row).toMatchObject({ action: 'create', values: { title: 'Synthetic CSV risk, with comma', probability: 3, impact: 2, dueDate: '2027-02-01' } });
  });

  it('a mapping without a required field, with an unknown column or by someone other than the uploader is refused', async () => {
    const parsed = await uploadAndParse(secretary, dc, await riskWorkbook([[null, 'Synthetic mapping probe', 1, 1, null, null]]), 'map.xlsx', { target: 'risk' });
    const path = IP(dc, `/${parsed.id}/mapping`);
    const missing = await secretary.post(path, { expectedVersion: parsed.version, sheet: 'Risks', headerRow: 1, mapping: { title: 'Risk title', probability: 'Probability' } });
    expect(missing.status).toBe(422);
    expect(missing.body.code).toBe('imports.mapping.required_missing');
    const unknown = await secretary.post(path, { expectedVersion: parsed.version, sheet: 'Risks', headerRow: 1, mapping: { title: 'Nope', probability: 'Probability', impact: 'Impact' } });
    expect(unknown.body.code).toBe('imports.mapping.unknown_column');
    const other = await pm.post(path, { expectedVersion: parsed.version, sheet: 'Risks', headerRow: 1, mapping: { title: 'Risk title', probability: 'Probability', impact: 'Impact' } });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('imports.not_uploader');
  });
});

describe('REQ-INT-002 source preservation, approval by a second person, batch history', () => {
  it('IT: rows created only after approval and linked to batch; the file is preserved as a source with its hash', async () => {
    const bytes = await riskWorkbook([
      [null, 'Synthetic approved risk one', 2, 3, null, 'avoid'],
      [null, 'Synthetic approved risk two', 4, 4, null, null],
      [null, 'Synthetic declined risk three', 1, 1, null, null],
    ]);
    const sha = createHash('sha256').update(bytes).digest('hex');
    const parsed = await uploadAndParse(secretary, dc, bytes, 'approved.xlsx', { target: 'risk' });
    expect(parsed.sha256).toBe(sha);
    const src = (await owner().query(`select s.code, s.checksum, s.source_type, s.extraction_status, v.sha256, v.storage_key from source_record s join document_version v on v.id = s.document_version_id where s.id = $1`, [parsed.sourceId])).rows[0];
    expect(src).toMatchObject({ checksum: sha, sha256: sha, source_type: 'excel', extraction_status: 'performed' });
    expect(parsed.sourceCode).toBe(src.code);
    let b = await mapBatch(secretary, dc, { ...parsed, suggestedMapping: { title: 'Risk title', probability: 'Probability', impact: 'Impact', responseStrategy: 'Response strategy' } }, undefined, 'Risks');
    b = await submit(secretary, dc, b);
    expect(b.status).toBe('submitted');
    expect((await owner().query(`select count(*)::int n from risk where project_id = $1 and (title like 'Synthetic approved risk%' or title like 'Synthetic declined risk%')`, [dc])).rows[0].n).toBe(0);

    // Separation of duties: the uploader cannot approve (403, audited) — even through the API directly.
    const self = await secretary.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2, 3] });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('policy.forbidden');
    const denied = (await owner().query(`select count(*)::int n from audit_event where action = 'imports.approve' and outcome = 'denied' and actor_user_id = $1 and after->'attempted'->>'batchId' = $2`, [secretary.userId, b.id])).rows[0].n;
    expect(denied).toBe(1);

    // Item by item: rows 2 and 3 accepted, row 4 declined.
    const ok = await pm.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2, 3], note: 'Reviewed against the register' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'applied', approvedBy: pm.userId });
    expect(ok.body.outputs.map((o: { rowNo: number; recordType: string }) => [o.rowNo, o.recordType])).toEqual([
      [2, 'risk'],
      [3, 'risk'],
    ]);
    const created = (await owner().query(`select id, code, title, status, created_by from risk where project_id = $1 and (title like 'Synthetic approved risk%' or title like 'Synthetic declined risk%') order by title`, [dc])).rows;
    expect(created.map((r) => r.title)).toEqual(['Synthetic approved risk one', 'Synthetic approved risk two']);
    expect(created.every((r) => r.created_by === secretary.userId && r.status === 'open')).toBe(true);
    const rows = await rowsOf(pm, dc, b.id);
    expect(rows.map((r) => r.decision)).toEqual(['accepted', 'accepted', 'declined']);
    const outputs = (await owner().query(`select record_type, record_id from import_output where batch_id = $1 order by row_no`, [b.id])).rows;
    expect(outputs.map((o) => o.record_id).sort()).toEqual(created.map((r) => r.id).sort());
    expect(await auditCount('imports.batch.approve', b.id, 'success')).toBe(1);

    // Batch history.
    const list = await pm.get(IP(dc, '?status=applied&pageSize=100'));
    expect(list.status).toBe(200);
    expect(list.body.items.some((x: { id: string; code: string }) => x.id === b.id)).toBe(true);
  });

  it('the approval binds to the submitted preview: a record changed since submission → 409, the uploader re-validates', async () => {
    const target = (await owner().query(`select id, code, title, probability, impact, version from risk where project_id = $1 and status = 'open' order by code offset 1 limit 1`, [dc])).rows[0];
    const bytes = await riskWorkbook([[target.code, target.title, target.probability === 1 ? 2 : 1, target.impact, null, null]]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'stale.xlsx', { target: 'risk' });
    let b = await mapBatch(secretary, dc, { ...parsed, suggestedMapping: { code: 'Code', title: 'Risk title', probability: 'Probability', impact: 'Impact' } }, undefined, 'Risks');
    b = await submit(secretary, dc, b);
    await owner().query(`update risk set impact = case when impact = 5 then 4 else impact + 1 end, version = version + 1 where id = $1`, [target.id]);
    try {
      const r = await pm.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: [2] });
      expect(r.status).toBe(409);
      expect(r.body.code).toBe('imports.preview_stale');
      const claims = (await owner().query(`select count(*)::int n from source_claim where source_id = $1`, [parsed.sourceId])).rows[0].n;
      expect(claims).toBe(0);
    } finally {
      await owner().query(`update risk set impact = $2 where id = $1`, [target.id, target.impact]);
    }
  });

  it('a batch above the reader’s clearance is invisible: 404 by id and for its commands, not listed, not counted', async () => {
    // The secretary (cleared to restricted) uploads a restricted batch; the PM is cleared to confidential.
    const parsed = await uploadAndParse(secretary, dc, await riskWorkbook([[null, 'Synthetic restricted import', 1, 1, null, null]]), 'restricted.xlsx', { target: 'risk', classification: 'restricted' });
    expect(parsed.classification).toBe('restricted');
    expect((await pm.get(IP(dc, `/${parsed.id}`))).status).toBe(404);
    expect((await pm.get(IP(dc, `/${parsed.id}/rows`))).status).toBe(404);
    expect((await pm.post(IP(dc, `/${parsed.id}/reject`), { expectedVersion: parsed.version, reason: 'probe' })).status).toBe(404);
    const list = await pm.get(IP(dc, '?pageSize=100'));
    expect(list.body.items.some((x: { id: string }) => x.id === parsed.id)).toBe(false);
    const all = (await owner().query(`select count(*)::int n from import_batch where project_id = $1 and classification in ('public', 'internal', 'confidential')`, [dc])).rows[0].n;
    expect(list.body.total).toBe(all);
    // Uploading above one's own clearance is refused.
    const contributor = await login('pm');
    const above = await contributor.upload(`${IP(dc)}?target=risk&classification=restricted`, await riskWorkbook([[null, 'x', 1, 1, null, null]]), 'above.xlsx');
    expect(above.status).toBe(422);
    expect(above.body.code).toBe('imports.classification_above_clearance');
  });
});
