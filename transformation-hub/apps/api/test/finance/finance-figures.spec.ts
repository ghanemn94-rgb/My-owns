import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, getApp, owner, projectIdByCode, GEN } from '../helpers';
import { SnapshotsService } from '../../src/modules/finance/snapshots.service';
import {
  P,
  asService,
  auditRows,
  createSnapshot,
  decisionOfType,
  lineRef,
  orgOf,
  sar,
  setupFinance,
  setupGovernance,
  snapshot,
  sourceDocument,
  today,
  usd,
  Gov,
  Personas,
} from './finance-kit';

/**
 * Financial figures (REQ-FIN-001/004/008/010): human financial validation (not by the preparer, never a service identity)
 * before approval by a third person; approvals bind to the validated content and are recorded as approval records;
 * approved figures are locked; opening balances need a final opening_balance_sheet decision; imported model outputs keep
 * their source document and sheet/cell; intercompany differences are flagged until reconciled.
 * Personas: finance prepares, approver validates, legal approves (both granted finance_restricted in this project).
 */
let projectId: string;
let orgId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupFinance('FIN-FIG'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const cmd = (c: Personas['pm'], id: string, verb: string, body: Record<string, unknown>) => c.post(`${P(projectId)}/financial-snapshots/${id}/${verb}`, body);
const dbRow = async (id: string) => (await owner().query(`select * from financial_snapshot where id = $1`, [id])).rows[0] as Record<string, unknown>;

describe('REQ-FIN-010 — human financial validation before approval', () => {
  let id: string;

  beforeAll(async () => {
    id = (await createSnapshot(p.finance, projectId, { kind: 'actual', category: 'one_off_separation', amount: sar('1000'), label: 'Separation advisory cost (synthetic)' })).id;
  });

  it('UT: approve without validation rejected; service identity cannot validate', async () => {
    const r = await cmd(p.legal, id, 'approve', { expectedVersion: 1 });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('finance.approval.not_validated');
    expect((await dbRow(id))['approval_state']).toBe('proposed');
    expect((await auditRows(projectId, 'finance.approveSnapshot', 'rejected', p.legal.userId)).length).toBeGreaterThan(0);

    // The worker / AI runtime identity — even with the permission on its allowlist — can never validate.
    const svc = asService(projectId, ['finance.snapshot.approve'], async (ctx) => (await getApp()).get(SnapshotsService).validate(ctx, projectId, id, { expectedVersion: 1, note: 'automated validation attempt' }));
    await expect(svc).rejects.toMatchObject({ code: 'finance.human_required' });
    const noPerm = asService(projectId, [], async (ctx) => (await getApp()).get(SnapshotsService).validate(ctx, projectId, id, { expectedVersion: 1, note: 'x' }));
    await expect(noPerm).rejects.toMatchObject({ kind: 'forbidden' });
    const row = await dbRow(id);
    expect(row['validated_by']).toBeNull();
    expect(row['approval_state']).toBe('proposed');
  });

  it('the preparer cannot validate; a human Finance validation opens a pending approval request', async () => {
    const self = await cmd(p.finance, id, 'validate', { expectedVersion: 1, note: 'Self validation attempt' });
    expect(self.status).toBe(403);
    const v = await cmd(p.approver, id, 'validate', { expectedVersion: 1, note: 'Checked against the synthetic ledger extract' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    expect(v.body.approvalState).toBe('under_review');
    const req = (await owner().query(`select status, requested_by, subject_type, subject_id, required_permission from approval_request where id = $1`, [v.body.approvalRequestId])).rows[0];
    expect(req).toEqual({ status: 'pending', requested_by: p.approver.userId, subject_type: 'financial_snapshot', subject_id: id, required_permission: 'finance.snapshot.approve' });
    const ob = await owner().query(`select count(*)::int n from outbox_event where type = 'approval.pending' and aggregate_id = $1`, [v.body.approvalRequestId]);
    expect(ob.rows[0].n).toBe(1);
  });

  it('the validator cannot approve; a change after validation invalidates it (approval binds to the validated content)', async () => {
    let s = await snapshot(p.finance, projectId, id);
    expect((await cmd(p.approver, id, 'approve', { expectedVersion: s.version })).status).toBe(403);
    const reqId = s.approval.approvalRequestId;
    const edit = await p.finance.patch(`${P(projectId)}/financial-snapshots/${id}`, { expectedVersion: s.version, amount: sar('1100') });
    expect(edit.status, JSON.stringify(edit.body)).toBe(200);
    expect(edit.body.approvalState).toBe('proposed');
    expect((await owner().query(`select status from approval_request where id = $1`, [reqId])).rows[0].status).toBe('invalidated');
    s = await snapshot(p.finance, projectId, id);
    expect(s.approval).toMatchObject({ state: 'proposed', validatedBy: null, validationCurrent: false, approvalRequestId: null });
    const r = await cmd(p.legal, id, 'approve', { expectedVersion: s.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('finance.approval.not_validated');
    const again = await cmd(p.approver, id, 'validate', { expectedVersion: s.version, note: 'Re-checked the corrected amount' });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
  });

  it('a third person approves; the approval record is appended, the approval date is the project-local date, the figure is locked', async () => {
    const s = await snapshot(p.finance, projectId, id);
    expect((await cmd(p.legal, id, 'approve', { expectedVersion: s.version - 1 })).status).toBe(409);
    const a = await cmd(p.legal, id, 'approve', { expectedVersion: s.version, note: 'Approved on the validated content' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(a.body.approvalState).toBe('approved');
    const after = await snapshot(p.finance, projectId, id);
    expect(after).toMatchObject({ approvalState: 'approved', approvedBy: p.legal.userId, validatedBy: p.approver.userId, approvalDate: today() });
    expect(after.approval).toMatchObject({ validationCurrent: true, approvalRequestStatus: 'approved' });
    const rec = (await owner().query(`select approver_user_id, decision from approval_record where approval_request_id = $1`, [after.approval.approvalRequestId])).rows;
    expect(rec).toEqual([{ approver_user_id: p.legal.userId, decision: 'approve' }]);
    // Locked while approved: the API refuses edits, and so does the database.
    const edit = await p.finance.patch(`${P(projectId)}/financial-snapshots/${id}`, { expectedVersion: after.version, amount: sar('1')});
    expect(edit.status).toBe(422);
    expect(edit.body.code).toBe('finance.snapshot.locked');
    await expect(owner().query(`update financial_snapshot set amount = 1 where id = $1`, [id])).rejects.toThrow(/append_only_violation/);
    // Reopening (reason required) returns it to proposed; the approval stays in history.
    const reopen = await cmd(p.legal, id, 'reopen', { expectedVersion: after.version, note: 'Invoice credit note received (synthetic)' });
    expect(reopen.status, JSON.stringify(reopen.body)).toBe(201);
    expect(reopen.body.approvalState).toBe('proposed');
    const hist = await owner().query(`select reason from record_version where entity_type = 'financial_snapshot' and entity_id = $1 order by version_no`, [id]);
    expect(hist.rows.map((r) => r.reason)).toContain('approved');
    expect(hist.rows.map((r) => r.reason)).toContain('reopen');
  });

  it('the database refuses an approved figure without a distinct validator and approver', async () => {
    const x = (await createSnapshot(p.finance, projectId, { kind: 'forecast' })).id;
    await expect(owner().query(`update financial_snapshot set approval_state = 'approved', approved_by = $2, approved_at = now() where id = $1`, [x, p.legal.userId])).rejects.toThrow(/financial_snapshot_approved_chk/);
    await expect(owner().query(`update financial_snapshot set validated_by = prepared_by, validated_at = now(), validated_hash = 'x' where id = $1`, [x])).rejects.toThrow(/financial_snapshot_validator_chk/);
  });

  it('opening balances are approved only with a FINAL opening_balance_sheet decision (never invented)', async () => {
    const ob = (await createSnapshot(p.finance, projectId, { kind: 'baseline', category: 'opening_balance', amount: sar('5000'), label: 'Opening balance — receivables (synthetic)' })).id;
    const v = await cmd(p.approver, ob, 'validate', { expectedVersion: 1, note: 'Agreed to the synthetic trial balance' });
    expect(v.status).toBe(201);
    const noDecision = await cmd(p.legal, ob, 'approve', { expectedVersion: 2 });
    expect(noDecision.status).toBe(422);
    expect(noDecision.body.code).toBe('finance.approval.decision_required');
    const recommended = await decisionOfType(projectId, p, gov, 'opening_balance_sheet');
    expect(recommended.status).toBe('recommended');
    const notFinal = await cmd(p.legal, ob, 'approve', { expectedVersion: 2, decisionId: recommended.id });
    expect(notFinal.status).toBe(422);
    expect(notFinal.body.code).toBe('finance.approval.decision_not_final');
    expect(notFinal.body.details.issueCode).toBe('recommended'); // reserved matter: recommended, pending the authorized body
    const wrongType = await decisionOfType(projectId, p, gov, 'change_request_budget');
    const wt = await cmd(p.legal, ob, 'approve', { expectedVersion: 2, decisionId: wrongType.id });
    expect(wt.status).toBe(422);
    expect(wt.body.details.issueCode).toBe('wrong_type');
    expect((await dbRow(ob))['approval_state']).toBe('under_review');
    const final = await decisionOfType(projectId, p, gov, 'opening_balance_sheet', { externalApproval: true });
    expect(final.status).toBe('approved');
    const ok = await cmd(p.legal, ob, 'approve', { expectedVersion: 2, decisionId: final.id });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await dbRow(ob))['approval_decision_id']).toBe(final.id);
  });

  it('status is never PATCHed; a stale expectedVersion is a 409', async () => {
    const x = await createSnapshot(p.finance, projectId, {});
    expect((await p.finance.patch(`${P(projectId)}/financial-snapshots/${x.id}`, { expectedVersion: 1, approvalState: 'approved' })).status).toBe(400);
    const u = await p.finance.patch(`${P(projectId)}/financial-snapshots/${x.id}`, { expectedVersion: 1, label: 'Renamed (synthetic)' });
    expect(u.status).toBe(200);
    const stale = await p.finance.patch(`${P(projectId)}/financial-snapshots/${x.id}`, { expectedVersion: 1, label: 'Lost update (synthetic)' });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('concurrency.version_mismatch');
  });
});

describe('REQ-FIN-008 — imported model outputs keep their source document and sheet / cell reference', () => {
  let doc: { documentId: string; versionId: string };
  beforeAll(async () => {
    doc = await sourceDocument('finance', projectId);
  });

  it('UT: imported output retains source and cell reference', async () => {
    const refA = lineRef('IMP');
    const refB = lineRef('IMP');
    const r = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, {
      sourceDocumentId: doc.documentId,
      sourceDocumentVersionId: doc.versionId,
      rows: [
        { kind: 'forecast', category: 'recurring_standalone', lineRef: refA, label: 'Standalone IT run cost (synthetic)', period: 'FY2027', amount: sar('12.5', 1000000), sheet: 'Standalone costs', cell: 'D14' },
        { kind: 'forecast', category: 'stranded', lineRef: refB, label: 'Stranded shared-service cost (synthetic)', period: 'FY2027', amount: sar('3.2', 1000000), sheet: 'Standalone costs', cell: '$D$15' },
      ],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.items).toHaveLength(2);
    const s = await snapshot(p.finance, projectId, r.body.items[0].id);
    expect(s).toMatchObject({ sourceType: 'excel', sourceDocumentId: doc.documentId, sourceDocumentVersionId: doc.versionId, sourceSheet: 'Standalone costs', sourceCell: 'D14', amount: sar('12.5000', 1000000) });
    // An imported figure keeps the value of its model output: corrections are re-imported, not edited.
    const edit = await p.finance.patch(`${P(projectId)}/financial-snapshots/${s.id}`, { expectedVersion: s.version, amount: sar('13', 1000000) });
    expect(edit.status).toBe(422);
    expect(edit.body.code).toBe('finance.snapshot.imported_locked');
    // All-or-nothing: a batch re-importing an existing line inserts nothing.
    const dup = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, {
      sourceDocumentId: doc.documentId,
      rows: [
        { kind: 'forecast', category: 'opex', lineRef: lineRef('IMP'), label: 'New line (synthetic)', period: 'FY2027', amount: sar('1'), sheet: 'S', cell: 'A1' },
        { kind: 'forecast', category: 'recurring_standalone', lineRef: refA, label: 'Again (synthetic)', period: 'FY2027', amount: sar('1'), sheet: 'S', cell: 'A2' },
      ],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.code).toBe('finance.snapshot.duplicate_line');
    expect((await owner().query(`select count(*)::int n from financial_snapshot where project_id = $1 and label = 'New line (synthetic)'`, [projectId])).rows[0].n).toBe(0);
  });

  it('an import without sheet / cell, or with an invalid cell, is rejected', async () => {
    const base = { kind: 'actual', category: 'opex', label: 'x', period: '2026-09', amount: sar('1') };
    const noCell = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, { sourceDocumentId: doc.documentId, rows: [{ ...base, lineRef: lineRef('IMP'), sheet: 'S' }] });
    expect(noCell.status).toBe(400);
    const noSheet = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, { sourceDocumentId: doc.documentId, rows: [{ ...base, lineRef: lineRef('IMP'), cell: 'B2' }] });
    expect(noSheet.status).toBe(400);
    expect(noSheet.body.code).toBe('finance.source.cell_reference_required');
    const badCell = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, { sourceDocumentId: doc.documentId, rows: [{ ...base, lineRef: lineRef('IMP'), sheet: 'S', cell: 'B 2;' }] });
    expect(badCell.status).toBe(400);
    expect(badCell.body.code).toBe('finance.source.invalid_cell');
    const noDoc = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, { rows: [{ ...base, lineRef: lineRef('IMP'), sheet: 'S', cell: 'B2' }] });
    expect(noDoc.status).toBe(400);
  });

  it('a source document of another project is never accepted (404)', async () => {
    const genId = await projectIdByCode(GEN);
    const foreign = (await owner().query(`insert into document (id, org_id, project_id, title, kind) values (gen_random_uuid(), $1, $2, 'Project B workbook (synthetic)', 'financial_model') returning id`, [orgId, genId])).rows[0].id;
    const r = await p.finance.post(`${P(projectId)}/financial-snapshots/import`, { sourceDocumentId: foreign, rows: [{ kind: 'actual', category: 'opex', lineRef: lineRef('IMP'), label: 'x', period: '2026-09', amount: sar('1'), sheet: 'S', cell: 'B2' }] });
    expect(r.status).toBe(404);
    const m = await p.finance.post(`${P(projectId)}/financial-snapshots`, { kind: 'actual', category: 'opex', lineRef: lineRef(), label: 'x', period: '2026-09', amount: sar('1'), sourceDocumentId: foreign });
    expect(m.status).toBe(404);
  });

  it('an imported model version keeps the source document and each output’s sheet / cell', async () => {
    const model = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'business_plan', name: 'Imported business plan (synthetic)' });
    expect(model.status).toBe(201);
    const missing = await p.finance.post(`${P(projectId)}/financial-models/${model.body.id}/versions/import`, {
      modelCase: 'base',
      versionLabel: 'Import 1',
      sourceDocumentId: doc.documentId,
      outputs: [{ key: 'revenue.2027', label: 'Revenue 2027', amount: '44.1', currency: 'SAR', unitScale: 1000000, basis: 'other', sheet: 'P&L' }],
    });
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('finance.source.cell_reference_required');
    const ok = await p.finance.post(`${P(projectId)}/financial-models/${model.body.id}/versions/import`, {
      modelCase: 'base',
      versionLabel: 'Import 1',
      sourceDocumentId: doc.documentId,
      sourceDocumentVersionId: doc.versionId,
      outputs: [{ key: 'revenue.2027', label: 'Revenue 2027', amount: '44.1', currency: 'SAR', unitScale: 1000000, basis: 'other', sheet: 'P&L', cell: 'F12' }],
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const v = (await p.finance.get(`${P(projectId)}/financial-models/${model.body.id}/versions/${ok.body.id}`).expect(200)).body;
    expect(v).toMatchObject({ sourceType: 'excel', sourceDocumentId: doc.documentId, sourceDocumentVersionId: doc.versionId });
    expect(v.outputs[0]).toMatchObject({ key: 'revenue.2027', amount: '44.1000', sheet: 'P&L', cell: 'F12' });
  });
});

describe('REQ-FIN-004 — working capital, opening balances and intercompany reconciliation', () => {
  let icId: string;
  let reconId: string;

  beforeAll(async () => {
    icId = (await createSnapshot(p.finance, projectId, { kind: 'actual', category: 'intercompany', amount: sar('1000'), label: 'Intercompany payable to parent (synthetic)', period: '2026-08' })).id;
  });

  it('UT: unreconciled intercompany difference flagged', async () => {
    const r = await p.finance.post(`${P(projectId)}/financial-snapshots/${icId}/reconciliations`, { counterpartyLabel: 'Parent company (synthetic)', theirBalance: sar('950'), sourceRef: 'Counterparty confirmation letter (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    reconId = r.body.id;
    const list = (await p.finance.get(`${P(projectId)}/intercompany-reconciliations?unreconciled=true`).expect(200)).body;
    const rec = list.items.find((x: { id: string }) => x.id === reconId);
    expect(rec).toMatchObject({ flag: 'unreconciled_difference', unreconciled: true, difference: sar('50.0000'), ourBalance: sar('1000.0000'), classification: 'restricted', financialSnapshotId: icId });
    expect(rec.notesI18n[0].code).toBe('finance.recon.unreconciled_difference');
    const s = await snapshot(p.finance, projectId, icId);
    expect(s.reconciliations.map((x: { id: string }) => x.id)).toEqual([reconId]);
    const sum = (await p.finance.get(`${P(projectId)}/finance/summary`).expect(200)).body;
    expect(sum.intercompany.unreconciled).toBeGreaterThanOrEqual(1);
    expect(sum.intercompany.differences).toContainEqual({ currency: 'SAR', unitScale: 1, amount: '50.0000', count: 1 });
  });

  it('balances in another currency / unit and non-balance figures are refused', async () => {
    const ccy = await p.finance.post(`${P(projectId)}/financial-snapshots/${icId}/reconciliations`, { counterpartyLabel: 'Parent (synthetic)', theirBalance: usd('950'), sourceRef: 'x-ref' });
    expect(ccy.status).toBe(422);
    expect(ccy.body.code).toBe('money.mixed_currency');
    const other = (await createSnapshot(p.finance, projectId, { category: 'one_off_separation' })).id;
    const cat = await p.finance.post(`${P(projectId)}/financial-snapshots/${other}/reconciliations`, { counterpartyLabel: 'Parent (synthetic)', sourceRef: 'x-ref' });
    expect(cat.status).toBe(422);
    expect(cat.body.code).toBe('finance.recon.category');
  });

  it('reconciling needs an explained difference and a reviewer other than the preparer', async () => {
    let rec = (await p.finance.get(`${P(projectId)}/intercompany-reconciliations/${reconId}`).expect(200)).body;
    expect((await p.finance.post(`${P(projectId)}/intercompany-reconciliations/${reconId}/reconcile`, { expectedVersion: rec.version })).status).toBe(403);
    const unexplained = await p.approver.post(`${P(projectId)}/intercompany-reconciliations/${reconId}/reconcile`, { expectedVersion: rec.version });
    expect(unexplained.status).toBe(422);
    expect(unexplained.body.code).toBe('finance.recon.unexplained_difference');
    const explain = await p.finance.patch(`${P(projectId)}/intercompany-reconciliations/${reconId}`, { expectedVersion: rec.version, explanation: 'Invoice INV-TEST-9 in transit at period end (synthetic)' });
    expect(explain.status, JSON.stringify(explain.body)).toBe(200);
    expect(explain.body.flag).toBe('unreconciled_difference');
    const ok = await p.approver.post(`${P(projectId)}/intercompany-reconciliations/${reconId}/reconcile`, { expectedVersion: explain.body.version, note: 'Reviewed (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ status: 'reconciled', flag: 'explained_difference' });
    rec = (await p.finance.get(`${P(projectId)}/intercompany-reconciliations/${reconId}`).expect(200)).body;
    expect(rec).toMatchObject({ reviewerUserId: p.approver.userId, unreconciled: false });
    const locked = await p.finance.patch(`${P(projectId)}/intercompany-reconciliations/${reconId}`, { expectedVersion: rec.version, theirBalance: sar('1000') });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('finance.recon.locked');
    await expect(owner().query(`update intercompany_reconciliation set reviewer_user_id = prepared_by where id = $1`, [reconId])).rejects.toThrow(/intercompany_reconciliation_reconciled_chk/);
  });

  it('a balance without its counterparty confirmation is flagged; working capital is tracked as a reference figure', async () => {
    const r = await p.finance.post(`${P(projectId)}/intercompany-reconciliations`, { counterpartyLabel: 'Parent treasury (synthetic)', period: '2026-08', ourBalance: sar('10', 1000), sourceRef: 'Ledger extract (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const g = (await p.finance.get(`${P(projectId)}/intercompany-reconciliations/${r.body.id}`).expect(200)).body;
    expect(g).toMatchObject({ flag: 'counterparty_missing', unreconciled: true, theirBalance: null, difference: null });
    const d = await p.finance.post(`${P(projectId)}/intercompany-reconciliations/${r.body.id}/dispute`, { expectedVersion: g.version, note: 'Counterparty disputes the balance (synthetic)' });
    expect(d.status).toBe(201);
    expect(d.body.flag).toBe('disputed');
    const wc = await createSnapshot(p.finance, projectId, { kind: 'baseline', category: 'working_capital', amount: sar('2.4', 1000000), label: 'Net working capital at carve-out (synthetic)' });
    const s = await snapshot(p.finance, projectId, wc.id);
    expect(s).toMatchObject({ category: 'working_capital', classification: 'restricted', sourceRef: 'Synthetic test source reference' });
  });
});
