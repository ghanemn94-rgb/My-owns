import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, owner, projectIdByCode } from '../helpers';
import { login, type DocClient } from '../documents/doc-helpers';
import { IP, mapBatch, rowsOf, submit, uploadAndParse, xlsx } from './import-kit';

let dc: string;
let secretary: DocClient;
let pm: DocClient;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  secretary = await login('secretary');
  pm = await login('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function approve(c: DocClient, b: { id: string; version: number }, rows: number[]) {
  const r = await c.post(IP(dc, `/${b.id}/approve`), { expectedVersion: b.version, acceptedRows: rows });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

describe('REQ-INT-015 imports cannot overwrite governed records — proposals only', () => {
  it('IT: import row targeting approved decision produces CR proposal, not update', async () => {
    const dec = (await owner().query(`select id, code, title, status, version from decision where project_id = $1 and status = 'approved' order by code limit 1`, [dc])).rows[0];
    const same = (await owner().query(`select code, title, status from decision where project_id = $1 and status = 'approved' and code <> $2 order by code limit 1`, [dc, dec.code])).rows[0];
    const bytes = await xlsx([
      {
        name: 'Decision log',
        rows: [
          ['Decision code', 'Subject', 'Outcome'],
          [dec.code, dec.title, 'Rejected'],
          ['DEC-999', 'Unknown decision', 'Approved'],
          [same.code, same.title, 'approved'],
        ],
      },
    ]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'decision-log.xlsx', { target: 'decision' });
    expect(parsed.suggestedMapping).toEqual({ code: 'Decision code', title: 'Subject', reportedStatus: 'Outcome' });
    let b = await mapBatch(secretary, dc, parsed);
    const rows = await rowsOf(secretary, dc, b.id);
    expect(rows.map((r) => [r.rowNo, r.action])).toEqual([
      [2, 'conflict'],
      [3, 'error'],
      [4, 'skip'],
    ]);
    expect(rows[0]).toMatchObject({ match: { type: 'decision', id: dec.id, code: dec.code }, diff: [{ field: 'status', from: 'approved', to: 'Rejected' }] });
    expect(rows[0]!.notes.map((n) => n.code)).toEqual(['imports.row.governed_change_request']);
    expect(rows[1]!.errors.map((e) => e.code)).toEqual(['imports.row.decision_unknown']);
    b = await submit(secretary, dc, b);
    const applied = await approve(pm, b, [2]);
    expect(applied.outputs).toEqual([expect.objectContaining({ rowNo: 2, recordType: 'change_request' })]);
    const cr = (await owner().query(`select status, subject_type, subject_id, proposed_change, requested_by from change_request where id = $1`, [applied.outputs[0].recordId])).rows[0];
    expect(cr).toMatchObject({ status: 'draft', subject_type: 'decision', subject_id: dec.id, requested_by: pm.userId });
    expect(cr.proposed_change).toMatchObject({ source: 'import', importCode: b.code, fields: [{ field: 'status', from: 'approved', to: 'Rejected' }] });
    // The committee decision itself is untouched.
    const after = (await owner().query(`select title, status, version from decision where id = $1`, [dec.id])).rows[0];
    expect(after).toEqual({ title: dec.title, status: dec.status, version: dec.version });
  });

  it('AT-01: source-reported "Completed" / "On Track" become historical-unverified claims; a baselined task gets a change request; a new task is a Draft proposal', async () => {
    const baselined = (await owner().query(
      `select t.id, t.wbs_code, t.status, t.planned_finish, t.version, w.code as ws from task t join workstream w on w.id = t.workstream_id
        where t.project_id = $1 and t.status = 'not_started' and t.id::text in (select jsonb_array_elements(b.snapshot->'tasks')->>'id' from baseline_version b where b.project_id = $1 and b.status = 'approved')
        order by t.sort_order limit 1`,
      [dc],
    )).rows[0];
    expect(baselined, 'a not-started task of the approved baseline').toBeTruthy();
    const bytes = await xlsx([
      {
        name: 'Tracker',
        rows: [
          ['WBS', 'Task', 'Workstream', 'Planned finish', 'Status'],
          [baselined.wbs_code, null, null, '2031-12-31', 'Completed'],
          ['WS-IMP-01', 'Synthetic imported activity', baselined.ws, '2031-06-30', 'On Track'],
        ],
      },
    ]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'tracker.xlsx', { target: 'task' });
    let b = await mapBatch(secretary, dc, parsed);
    const rows = await rowsOf(secretary, dc, b.id);
    expect(rows.map((r) => [r.rowNo, r.action])).toEqual([
      [2, 'conflict'],
      [3, 'create'],
    ]);
    expect(rows[0]!.notes.map((n) => n.code)).toEqual(['imports.row.reported_status_claim', 'imports.row.governed_change_request']);
    b = await submit(secretary, dc, b);
    const applied = await approve(pm, b, [2, 3]);
    const outputs = applied.outputs as { rowNo: number; recordType: string; recordId: string }[];
    expect(outputs.map((o) => [o.rowNo, o.recordType])).toEqual([
      [2, 'change_request'],
      [2, 'source_claim'],
      [3, 'task'],
      [3, 'source_claim'],
    ]);
    // The baselined task is unchanged (status and dates); its reported status is a historical claim.
    const t = (await owner().query(`select status, planned_finish, version from task where id = $1`, [baselined.id])).rows[0];
    expect(t).toEqual({ status: baselined.status, planned_finish: baselined.planned_finish, version: baselined.version });
    const claims = (await owner().query(`select target_type, target_id, field, extracted_value, verification_status, origin_status, created_by from source_claim where id = any($1::uuid[]) order by extracted_value`, [outputs.filter((o) => o.recordType === 'source_claim').map((o) => o.recordId)])).rows;
    const newTask = (await owner().query(`select id, status, verification_status, wbs_code from task where id = $1`, [outputs.find((o) => o.recordType === 'task')!.recordId])).rows[0];
    expect(newTask).toMatchObject({ status: 'draft', verification_status: 'proposed', wbs_code: 'WS-IMP-01' });
    expect(claims).toEqual([
      { target_type: 'task', target_id: baselined.id, field: 'status', extracted_value: 'Completed', verification_status: 'historical_unverified', origin_status: 'historical_unverified', created_by: secretary.userId },
      { target_type: 'task', target_id: newTask.id, field: 'status', extracted_value: 'On Track', verification_status: 'historical_unverified', origin_status: 'historical_unverified', created_by: secretary.userId },
    ]);
    // A historical claim can never be applied as the current status.
    const claimId = outputs.filter((o) => o.recordType === 'source_claim')[0]!.recordId;
    const claim = (await owner().query(`select version from source_claim where id = $1`, [claimId])).rows[0];
    const apply = await pm.post(`/api/v1/projects/${dc}/claims/${claimId}/propose-change`, { expectedVersion: claim.version });
    expect(apply.status).toBe(422);
    expect(apply.body.code).toBe('claims.historical_not_applicable');
    const cr = (await owner().query(`select status, subject_type, subject_id from change_request where id = $1`, [outputs[0]!.recordId])).rows[0];
    expect(cr).toEqual({ status: 'draft', subject_type: 'task', subject_id: baselined.id });
  });
});

describe('REQ-INT-003 import rollback where feasible', () => {
  async function appliedRiskBatch(titles: string[]) {
    const bytes = await xlsx([{ name: 'Risks', rows: [['Title', 'Probability', 'Impact'], ...titles.map((t) => [t, 2, 2])] }]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'rollback.xlsx', { target: 'risk' });
    let b = await mapBatch(secretary, dc, parsed);
    b = await submit(secretary, dc, b);
    return approve(pm, b, titles.map((_, i) => i + 2));
  }

  it('IT: rollback restores previous versions — records created by the batch are cancelled, its claims removed; history kept', async () => {
    const b = await appliedRiskBatch(['Synthetic rollback risk one', 'Synthetic rollback risk two']);
    const ids = (b.outputs as { recordId: string }[]).map((o) => o.recordId);
    const r = await pm.post(IP(dc, `/${b.id}/rollback`), { expectedVersion: b.version, reason: 'Wrong register version uploaded' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'rolled_back', rolledBackBy: pm.userId, rollbackReason: 'Wrong register version uploaded' });
    expect(r.body.outputs.every((o: { rolledBack: boolean }) => o.rolledBack)).toBe(true);
    const risks = (await owner().query(`select status, version from risk where id = any($1::uuid[])`, [ids])).rows;
    expect(risks).toEqual([
      { status: 'cancelled', version: 2 },
      { status: 'cancelled', version: 2 },
    ]);
    expect((await owner().query(`select count(*)::int n from audit_event where action = 'imports.record.rollback' and entity_id = any($1::uuid[])`, [ids])).rows[0].n).toBe(2);
    const again = await pm.post(IP(dc, `/${b.id}/rollback`), { expectedVersion: r.body.version, reason: 'again' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('imports.invalid_transition');
  });

  it('rollback is refused for records changed since the import, and while the preserved file is on legal hold', async () => {
    const b = await appliedRiskBatch(['Synthetic changed risk', 'Synthetic untouched risk']);
    const [changed, untouched] = (b.outputs as { recordId: string }[]).map((o) => o.recordId);
    await owner().query(`update risk set probability = 5, version = version + 1 where id = $1`, [changed]);
    const r = await pm.post(IP(dc, `/${b.id}/rollback`), { expectedVersion: b.version, reason: 'probe' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('imports.rollback.not_feasible');
    expect(r.body.details.blockers).toEqual([expect.objectContaining({ recordType: 'risk', reason: 'changed_since_import' })]);
    expect((await owner().query(`select status from risk where id = $1`, [untouched])).rows[0].status).toBe('open');
    expect((await owner().query(`select count(*)::int n from audit_event where action = 'imports.batch.rollback' and entity_id = $1 and outcome = 'rejected'`, [b.id])).rows[0].n).toBe(1);

    const b2 = await appliedRiskBatch(['Synthetic held risk']);
    await owner().query(`update document set legal_hold = true, legal_hold_reason = 'Synthetic hold' where id = $1`, [b2.documentId]);
    try {
      const h = await pm.post(IP(dc, `/${b2.id}/rollback`), { expectedVersion: b2.version, reason: 'probe' });
      expect(h.status).toBe(422);
      expect(h.body.code).toBe('imports.rollback.legal_hold');
    } finally {
      await owner().query(`update document set legal_hold = false, legal_hold_reason = null where id = $1`, [b2.documentId]);
    }
  });

  it('a submitted batch can be rejected by the approver with a reason (nothing applied); the uploader cannot reject their own', async () => {
    const bytes = await xlsx([{ name: 'Risks', rows: [['Title', 'Probability', 'Impact'], ['Synthetic rejected risk', 1, 1]] }]);
    const parsed = await uploadAndParse(secretary, dc, bytes, 'reject.xlsx', { target: 'risk' });
    let b = await mapBatch(secretary, dc, parsed);
    b = await submit(secretary, dc, b);
    expect((await secretary.post(IP(dc, `/${b.id}/reject`), { expectedVersion: b.version, reason: 'self' })).status).toBe(403);
    const r = await pm.post(IP(dc, `/${b.id}/reject`), { expectedVersion: b.version, reason: 'Duplicates the existing register' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'rejected', decisionNote: 'Duplicates the existing register' });
    expect((await owner().query(`select count(*)::int n from risk where title = 'Synthetic rejected risk'`)).rows[0].n).toBe(0);
  });
});
