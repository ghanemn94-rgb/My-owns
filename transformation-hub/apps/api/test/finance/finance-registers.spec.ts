import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, getApp, loginAs, owner } from '../helpers';
import { BenefitsService } from '../../src/modules/finance/benefits.service';
import { P, asService, createSnapshot, createTsa, decisionOfType, lineRef, plusDays, sar, setupFinance, setupGovernance, today, Gov, Personas } from './finance-kit';

/**
 * Finance registers: separation cost categories with each TSA charge counted once (REQ-FIN-002), committed vs spent
 * (REQ-FIN-003), versioned business plans preserving prior assumptions (REQ-FIN-005), proposed vs approved valuation /
 * ownership values (REQ-FIN-006), the benefits register with independent verification (REQ-FIN-009), and KPIs.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('FIN-REG'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const line = (c: Personas['pm'], body: Record<string, unknown>) => c.post(`${P(projectId)}/budget-lines`, { currency: 'SAR', unitScale: 1, ...body });
const getLine = async (id: string) => (await p.finance.get(`${P(projectId)}/budget-lines/${id}`).expect(200)).body;

describe('REQ-FIN-002 — separation cost categories without double counting', () => {
  let tsa1: string;
  let tsa2: string;
  let tsa3: string;

  beforeAll(async () => {
    tsa1 = await createTsa(p.pm, projectId, 'Synthetic NOC monitoring TSA (test)', sar('1000'));
    tsa2 = await createTsa(p.pm, projectId, 'Synthetic billing TSA (test)', sar('250'));
    tsa3 = await createTsa(p.pm, projectId, 'Synthetic facilities TSA (test)', null);
  });

  it('UT: TSA charge counted once across TSA and cost views', async () => {
    const unlinked = await line(p.finance, { name: 'TSA charge without its TSA (synthetic)', category: 'tsa_charge' });
    expect(unlinked.status).toBe(422);
    expect(unlinked.body.code).toBe('finance.tsa_charge.link_required');
    const wrongCat = await line(p.finance, { name: 'One-off with a TSA (synthetic)', category: 'one_off_separation', tsaServiceId: tsa1 });
    expect(wrongCat.status).toBe(422);
    expect(wrongCat.body.code).toBe('finance.tsa_charge.category_required');
    const l1 = await line(p.finance, { name: 'NOC TSA charge (synthetic)', category: 'tsa_charge', tsaServiceId: tsa1, committedAmount: '1000', actualsAsOf: plusDays(-1), actualsSourceRef: 'TSA schedule (synthetic)' });
    expect(l1.status, JSON.stringify(l1.body)).toBe(201);
    const twice = await line(p.finance, { name: 'Same TSA again (synthetic)', category: 'tsa_charge', tsaServiceId: tsa1, committedAmount: '1000', actualsAsOf: plusDays(-1), actualsSourceRef: 'x' });
    expect(twice.status).toBe(409);
    expect(twice.body.code).toBe('finance.budget.tsa_already_counted');
    const org = (await owner().query(`select org_id from project where id = $1`, [projectId])).rows[0].org_id;
    await expect(
      owner().query(`insert into budget_line (id, org_id, project_id, code, name, category, currency, unit_scale, tsa_service_id) values (gen_random_uuid(), $1, $2, 'BL-DUP', 'dup', 'tsa_charge', 'SAR', 1, $3)`, [org, projectId, tsa1]),
    ).rejects.toThrow(/budget_line_tsa_uq/);
    await line(p.finance, { name: 'Programme office (synthetic)', category: 'one_off_separation', committedAmount: '500', actualsAsOf: plusDays(-1), actualsSourceRef: 'PO register (synthetic)' });

    const v = (await p.finance.get(`${P(projectId)}/finance/separation-costs`).expect(200)).body;
    const tsaGroup = v.groups.filter((g: { category: string }) => g.category === 'tsa_charge');
    expect(tsaGroup).toEqual([expect.objectContaining({ currency: 'SAR', unitScale: 1, lineCount: 1, committed: sar('1000.0000') })]); // not 2000
    const rows = Object.fromEntries(v.tsa.map((t: { tsaServiceId: string; countedIn: string; notesI18n: { code: string }[] }) => [t.tsaServiceId, [t.countedIn, t.notesI18n.map((n) => n.code)]]));
    expect(rows[tsa1]).toEqual(['budget_line', ['finance.tsa.counted_in_line']]);
    expect(rows[tsa2]).toEqual(['none', ['finance.tsa.not_in_cost_view']]);
    expect(rows[tsa3]).toEqual(['none', ['finance.tsa.no_charge_recorded']]);
    expect(v.groups.find((g: { category: string }) => g.category === 'one_off_separation').committed).toEqual(sar('500.0000'));
  });

  it('a line keeps one category across kinds and a TSA is charged under one line reference', async () => {
    const ref = lineRef('DC');
    await createSnapshot(p.finance, projectId, { kind: 'baseline', category: 'stranded', lineRef: ref });
    const conflict = await p.finance.post(`${P(projectId)}/financial-snapshots`, { kind: 'forecast', category: 'one_off_separation', lineRef: ref, label: 'x', period: '2026-Q3', amount: sar('1'), sourceRef: 'x-ref' });
    expect(conflict.status).toBe(422);
    expect(conflict.body.code).toBe('finance.double_count.category_conflict');
    const a = lineRef('TSA');
    await createSnapshot(p.finance, projectId, { kind: 'forecast', category: 'tsa_charge', tsaServiceId: tsa2, lineRef: a, period: '2026-Q4', amount: sar('250') });
    const b = await p.finance.post(`${P(projectId)}/financial-snapshots`, { kind: 'forecast', category: 'tsa_charge', tsaServiceId: tsa2, lineRef: lineRef('TSA'), label: 'x', period: '2027-Q1', amount: sar('250'), sourceRef: 'x-ref' });
    expect(b.status).toBe(422);
    expect(b.body.code).toBe('finance.double_count.tsa_line_conflict');
  });
});

describe('REQ-FIN-003 — committed versus spent', () => {
  let id: string;

  it('UT: committed and spent tracked separately', async () => {
    const noSource = await line(p.finance, { name: 'x', category: 'opex', committedAmount: '10' });
    expect(noSource.status).toBe(400);
    expect(noSource.body.code).toBe('finance.budget.actuals_source_required');
    const r = await line(p.finance, { name: 'Standalone ERP licences (synthetic)', category: 'recurring_standalone', proposedAmount: '800' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    id = r.body.id;
    const a = await p.finance.post(`${P(projectId)}/budget-lines/${id}/actuals`, { expectedVersion: 1, committed: sar('600'), spent: sar('250'), asOf: today(), sourceRef: 'PO + AP register (synthetic)' });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const l = await getLine(id);
    expect(l).toMatchObject({ proposed: sar('800.0000'), approved: null, committed: sar('600.0000'), spent: sar('250.0000'), openCommitment: sar('350.0000'), uncommitted: null, approvalState: 'proposed', actualsAsOf: today() });
    expect(l.flagsI18n.map((f: { code: string }) => f.code)).toEqual(['finance.budget.no_approved_budget']);
  });

  it('the approved budget comes only from a FINAL governance decision, within its amount', async () => {
    let l = await getLine(id);
    const pending = await decisionOfType(projectId, p, gov, 'change_request_budget', { vote: false });
    const notFinal = await p.finance.post(`${P(projectId)}/budget-lines/${id}/record-approval`, { expectedVersion: l.version, decisionId: pending.id, approvedAmount: sar('800') });
    expect(notFinal.status).toBe(422);
    expect(notFinal.body.code).toBe('finance.budget.decision_not_final');
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget'); // paper: 100 000 SAR (synthetic)
    expect(d.status).toBe('approved');
    const tooMuch = await p.finance.post(`${P(projectId)}/budget-lines/${id}/record-approval`, { expectedVersion: l.version, decisionId: d.id, approvedAmount: sar('150000') });
    expect(tooMuch.status).toBe(422);
    expect(tooMuch.body.code).toBe('finance.budget.exceeds_decision');
    expect((await getLine(id)).approved).toBeNull();
    const ok = await p.finance.post(`${P(projectId)}/budget-lines/${id}/record-approval`, { expectedVersion: l.version, decisionId: d.id, approvedAmount: sar('800') });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    l = await getLine(id);
    expect(l).toMatchObject({ approved: sar('800.0000'), uncommitted: sar('200.0000'), approvalState: 'approved', approvalDecisionId: d.id, approvedBy: p.finance.userId });
    const again = await p.finance.post(`${P(projectId)}/budget-lines/${id}/record-approval`, { expectedVersion: l.version, decisionId: d.id, approvedAmount: sar('700') });
    expect(again.status).toBe(409);
    await expect(owner().query(`update budget_line set approved_amount = 900 where id = $1`, [id])).rejects.toThrow(/append_only_violation/);
  });

  it('spend above commitments and commitments above the approved budget are flagged; dates are checked', async () => {
    let l = await getLine(id);
    const r = await p.finance.post(`${P(projectId)}/budget-lines/${id}/actuals`, { expectedVersion: l.version, committed: sar('900'), spent: sar('950'), asOf: today(), sourceRef: 'AP register (synthetic)' });
    expect(r.status).toBe(201);
    l = await getLine(id);
    expect(l.flagsI18n.map((f: { code: string }) => f.code)).toEqual(['finance.budget.spent_exceeds_committed', 'finance.budget.committed_exceeds_approved']);
    const future = await p.finance.post(`${P(projectId)}/budget-lines/${id}/actuals`, { expectedVersion: l.version, spent: sar('1'), asOf: plusDays(5), sourceRef: 'x-ref' });
    expect(future.status).toBe(422);
    expect(future.body.code).toBe('finance.budget.actuals_in_future');
    const back = await p.finance.post(`${P(projectId)}/budget-lines/${id}/actuals`, { expectedVersion: l.version, spent: sar('1'), asOf: plusDays(-30), sourceRef: 'x-ref' });
    expect(back.status).toBe(422);
    const neg = await p.finance.post(`${P(projectId)}/budget-lines/${id}/actuals`, { expectedVersion: l.version, spent: sar('-1'), asOf: today(), sourceRef: 'x-ref' });
    expect(neg.status).toBe(400);
  });

  it('no PATCH of the approved amount or state; the database refuses an approved amount on an unapproved line', async () => {
    const l = await getLine(id);
    expect((await p.finance.patch(`${P(projectId)}/budget-lines/${id}`, { expectedVersion: l.version, approvedAmount: '1' })).status).toBe(400);
    expect((await p.finance.patch(`${P(projectId)}/budget-lines/${id}`, { expectedVersion: l.version, approvalState: 'approved' })).status).toBe(400);
    const other = (await line(p.finance, { name: 'Unapproved line (synthetic)', category: 'opex' })).body.id;
    await expect(owner().query(`update budget_line set approved_amount = 5 where id = $1`, [other])).rejects.toThrow(/budget_line_approved_chk/); // amount without an approved state
  });
});

describe('REQ-FIN-005 — versioned business plans and valuation cases', () => {
  let modelId: string;
  let v1: string;
  let v2: string;

  it('UT: new version preserves prior assumptions', async () => {
    const m = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'business_plan', name: 'NewCo business plan (synthetic)' });
    expect(m.status).toBe(201);
    modelId = m.body.id;
    const a = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, {
      modelCase: 'base',
      versionLabel: 'BP v1',
      sourceRef: 'Business plan workbook v1 (synthetic)',
      assumptionChanges: { set: [{ key: 'growth', value: '3', unit: '%', source: 'Strategy memo (synthetic)' }, { key: 'capex', value: '10', unit: 'SAR m' }] },
      outputs: [{ key: 'revenue.2027', label: 'Revenue 2027', amount: '40', currency: 'SAR', unitScale: 1000000, basis: 'other' }],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    v1 = a.body.id;
    expect(a.body.versionNo).toBe(1);
    const b = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, {
      modelCase: 'base',
      versionLabel: 'BP v2',
      sourceRef: 'Business plan workbook v2 (synthetic)',
      assumptionChanges: { set: [{ key: 'growth', value: '4', unit: '%', source: 'Strategy memo rev (synthetic)' }, { key: 'churn', value: '1', unit: '%' }], remove: ['capex'] },
      outputs: [{ key: 'revenue.2027', label: 'Revenue 2027', amount: '41.5', currency: 'SAR', unitScale: 1000000, basis: 'other' }],
      changeNote: 'Growth revised; capex moved to the capex plan (synthetic)',
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    v2 = b.body.id;
    expect(b.body).toMatchObject({ versionNo: 2, diff: { added: ['churn'], changed: ['growth'], removed: ['capex'], unchanged: 0 } });
    const old = (await p.finance.get(`${P(projectId)}/financial-models/${modelId}/versions/${v1}`).expect(200)).body;
    expect(old.assumptions).toEqual([
      { key: 'growth', value: '3', unit: '%', source: 'Strategy memo (synthetic)' },
      { key: 'capex', value: '10', unit: 'SAR m', source: null },
    ]);
    expect(old).toMatchObject({ frozen: true, supersededById: v2, approvalState: 'superseded' });
    const cur = (await p.finance.get(`${P(projectId)}/financial-models/${modelId}/versions/${v2}`).expect(200)).body;
    expect(cur.assumptions.map((x: { key: string; value: string }) => [x.key, x.value])).toEqual([
      ['growth', '4'],
      ['churn', '1'],
    ]);
    expect(cur.diffFromBasedOn).toEqual({ added: ['churn'], changed: ['growth'], removed: ['capex'] });
    const model = (await p.finance.get(`${P(projectId)}/financial-models/${modelId}`).expect(200)).body;
    expect(model.latest).toEqual([{ modelCase: 'base', versionId: v2, versionNo: 2, versionLabel: 'BP v2', approvalState: 'proposed' }]);
  });

  it('a version is frozen: the database refuses to change or delete it; a new version derives from the latest only', async () => {
    await expect(owner().query(`update financial_model_version set assumptions = '[]'::jsonb where id = $1`, [v1])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from financial_model_version where id = $1`, [v1])).rejects.toThrow(/append_only_violation/);
    const stale = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'base', versionLabel: 'from v1', basedOnVersionId: v1, sourceRef: 'x-ref', outputs: [] });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe('finance.model.not_latest');
    const downside = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'downside', versionLabel: 'BP downside v1', sourceRef: 'x-ref', outputs: [] });
    expect(downside.body.versionNo).toBe(1);
  });

  it('business plan approval is not configured in the authority matrix (no approval is invented)', async () => {
    const d = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    const r = await p.legal.post(`${P(projectId)}/financial-models/${modelId}/versions/${v2}/approve-values`, { expectedVersion: 1, decisionId: d.id });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('finance.model.approval_not_configured');
  });
});

describe('REQ-FIN-006 — proposed versus approved valuation and ownership', () => {
  let modelId: string;
  let vid: string;
  const vpath = () => `${P(projectId)}/financial-models/${modelId}/versions/${vid}`;
  const row = async () => (await owner().query(`select approval_state, approved_values from financial_model_version where id = $1`, [vid])).rows[0];

  beforeAll(async () => {
    const m = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'valuation', name: 'JV valuation case (synthetic)' });
    modelId = m.body.id;
    const v = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, {
      modelCase: 'base',
      versionLabel: 'Val v1',
      headlineBasis: 'enterprise_value',
      sourceRef: 'Adviser valuation output (synthetic)',
      outputs: [
        { key: 'ev', label: 'Enterprise value', amount: '500', currency: 'SAR', unitScale: 1000000, basis: 'enterprise_value' },
        { key: 'ownership.newco_parent', label: 'Parent ownership share', measure: 'percent', amount: '40', basis: 'other' },
      ],
    });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    vid = v.body.id;
  });

  it('UT: approved value field empty until approval recorded', async () => {
    let v = (await p.finance.get(vpath()).expect(200)).body;
    expect(v.approvedValues).toBeNull();
    expect(v.outputs.map((o: { key: string; amount: string }) => [o.key, o.amount])).toEqual([
      ['ev', '500.0000'],
      ['ownership.newco_parent', '40.0000'],
    ]);
    const val = await p.approver.post(`${vpath()}/validate`, { expectedVersion: v.version, note: 'Outputs agreed to the adviser report (synthetic)' });
    expect(val.status, JSON.stringify(val.body)).toBe(201);
    v = (await p.finance.get(vpath()).expect(200)).body;

    const recommended = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms'); // reserved matter → recommended only
    expect(recommended.status).toBe('recommended');
    const r1 = await p.legal.post(`${vpath()}/approve-values`, { expectedVersion: v.version, decisionId: recommended.id });
    expect(r1.status).toBe(422);
    expect(r1.body.code).toBe('finance.model.decision_not_final');
    const wrong = await decisionOfType(projectId, p, gov, 'change_request_budget');
    const r2 = await p.legal.post(`${vpath()}/approve-values`, { expectedVersion: v.version, decisionId: wrong.id });
    expect(r2.status).toBe(422);
    expect(r2.body.details.issueCode).toBe('wrong_type');
    expect(await row()).toEqual({ approval_state: 'under_review', approved_values: null });

    const final = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    expect(final.status).toBe('approved');
    expect((await p.approver.post(`${vpath()}/approve-values`, { expectedVersion: v.version, decisionId: final.id })).status).toBe(403); // validator
    expect((await p.finance.post(`${vpath()}/approve-values`, { expectedVersion: v.version, decisionId: final.id })).status).toBe(403); // preparer
    const ok = await p.legal.post(`${vpath()}/approve-values`, { expectedVersion: v.version, decisionId: final.id, note: 'Recorded from the board resolution (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    v = (await p.finance.get(vpath()).expect(200)).body;
    expect(v.approvedValues).toEqual(v.outputs);
    expect(v.approval).toMatchObject({ state: 'approved', approvalDecisionId: final.id, approvedBy: p.legal.userId, validatedBy: p.approver.userId });
    expect(v.hasApprovedValues).toBe(true);
  });

  it('approved values are immutable and can never exist without an approval decision (database)', async () => {
    await expect(owner().query(`update financial_model_version set approved_values = '[]'::jsonb where id = $1`, [vid])).rejects.toThrow(/append_only_violation/);
    const other = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'upside', versionLabel: 'Up v1', headlineBasis: 'equity_value', sourceRef: 'x-ref', outputs: [] });
    await expect(owner().query(`update financial_model_version set approved_values = outputs where id = $1`, [other.body.id])).rejects.toThrow(/financial_model_approved_values_chk/);
  });
});

describe('REQ-FIN-009 — benefits register: realization needs a verification source and an independent verifier', () => {
  let id: string;
  const bpath = () => `${P(projectId)}/benefits/${id}`;
  const get = async () => (await p.finance.get(bpath()).expect(200)).body;

  it('UT: benefit realization requires verification source', async () => {
    const outsider = await loginAs('pm.b');
    const notMember = await p.pm.post(`${P(projectId)}/benefits`, { title: 'x', measurementDefinition: 'x', ownerUserId: outsider.userId });
    expect(notMember.status).toBe(400);
    expect(notMember.body.code).toBe('finance.user_not_member');
    const c = await p.pm.post(`${P(projectId)}/benefits`, {
      title: 'Standalone NOC cost avoidance (synthetic)',
      measurementDefinition: 'Annual NOC run cost vs pre-separation allocation (synthetic definition)',
      baselineValue: 'TBD',
      targetValue: 'TBD',
      ownerUserId: p.pm.userId,
      realizationDate: plusDays(90),
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    id = c.body.id;
    expect((await p.pm.post(`${bpath()}/approve`, { expectedVersion: 1 })).status).toBe(403); // no finance.benefit.verify
    const ap = await p.finance.post(`${bpath()}/approve`, { expectedVersion: 1 });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    const tr = await p.pm.post(`${bpath()}/start-tracking`, { expectedVersion: ap.body.version });
    expect(tr.status).toBe(201);
    const noSource = await p.pm.post(`${bpath()}/record-realization`, { expectedVersion: tr.body.version, actualValue: '12% lower run cost (synthetic)', realizedOn: today() });
    expect(noSource.status).toBe(422);
    expect(noSource.body.code).toBe('finance.benefit.verification_source_required');
    const future = await p.pm.post(`${bpath()}/record-realization`, { expectedVersion: tr.body.version, actualValue: 'x', realizedOn: plusDays(3), verificationSource: 'Cost report (synthetic)' });
    expect(future.status).toBe(422);
    expect(future.body.code).toBe('finance.benefit.realized_in_future');
    expect((await get()).status).toBe('tracking');
    const ok = await p.pm.post(`${bpath()}/record-realization`, { expectedVersion: tr.body.version, actualValue: '12% lower run cost (synthetic)', realizedOn: today(), verificationSource: 'Monthly NOC cost report (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('realized_unverified');
  });

  it('the owner / reporter cannot verify, nor can a service identity; an independent Finance verifier can', async () => {
    let b = await get();
    expect((await p.pm.post(`${bpath()}/verify`, { expectedVersion: b.version, note: 'self' })).status).toBe(403);
    const svc = asService(projectId, ['finance.benefit.verify'], async (ctx) => (await getApp()).get(BenefitsService).verify(ctx, projectId, id, { expectedVersion: b.version, note: 'automated' }));
    await expect(svc).rejects.toMatchObject({ code: 'finance.human_required' });
    const v = await p.approver.post(`${bpath()}/verify`, { expectedVersion: b.version, note: 'Checked against the monthly cost report (synthetic)' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    b = await get();
    expect(b).toMatchObject({ status: 'realized_verified', verifiedBy: p.approver.userId, realizationRecordedBy: p.pm.userId, verificationSource: 'Monthly NOC cost report (synthetic)' });
    expect((await p.pm.patch(bpath(), { expectedVersion: b.version, status: 'tracking' })).status).toBe(400);
  });

  it('a Finance member who reported the realization cannot verify it (not_self); the database enforces it too', async () => {
    const c = await p.finance.post(`${P(projectId)}/benefits`, { title: 'Shared-service exit saving (synthetic)', measurementDefinition: 'x (synthetic)', ownerUserId: p.pm.userId, verificationSource: 'AP ledger (synthetic)' });
    const bid = c.body.id;
    expect((await p.finance.post(`${P(projectId)}/benefits/${bid}/approve`, { expectedVersion: 1 })).status).toBe(403); // creator
    const ap = await p.approver.post(`${P(projectId)}/benefits/${bid}/approve`, { expectedVersion: 1 });
    const tr = await p.finance.post(`${P(projectId)}/benefits/${bid}/start-tracking`, { expectedVersion: ap.body.version });
    const rr = await p.finance.post(`${P(projectId)}/benefits/${bid}/record-realization`, { expectedVersion: tr.body.version, actualValue: 'Contract terminated (synthetic)', realizedOn: today() });
    expect(rr.status, JSON.stringify(rr.body)).toBe(201);
    expect((await p.finance.post(`${P(projectId)}/benefits/${bid}/verify`, { expectedVersion: rr.body.version, note: 'self' })).status).toBe(403);
    await expect(owner().query(`update benefit set status = 'realized_verified', verified_by = realization_recorded_by, verified_at = now() where id = $1`, [bid])).rejects.toThrow(/benefit_verified_chk/);
    const rej = await p.legal.post(`${P(projectId)}/benefits/${bid}/reject-realization`, { expectedVersion: rr.body.version, note: 'The ledger does not show the saving yet (synthetic)' });
    expect(rej.status).toBe(201);
    expect(rej.body.status).toBe('tracking');
  });

  it('KPIs measure benefits; a ratio is computed from numerator / denominator; observations are append-only', async () => {
    const k = await p.finance.post(`${P(projectId)}/kpis`, {
      key: `benefit.realised.${Date.now().toString(36)}`,
      name: 'Benefits realised (share)',
      definition: 'Verified benefits / registered benefits (synthetic)',
      formula: 'verified / registered',
      unit: 'ratio',
      period: 'quarter',
      source: 'Benefits register',
      thresholds: { green: '>= 0.8', amber: '>= 0.5', red: '< 0.5' },
      direction: 'higher_is_better',
      frequency: 'quarterly',
      benefitId: id,
      ownerRole: 'finance_restricted', // REQ-RPT-013: every KPI has an owner (role or member)
    });
    expect(k.status, JSON.stringify(k.body)).toBe(201);
    expect((await p.finance.post(`${P(projectId)}/kpis/${k.body.id}/observations`, { period: '2026-Q3', numerator: '3', denominator: '0', sourceRef: 'x-ref' })).status).toBe(400);
    const o = await p.finance.post(`${P(projectId)}/kpis/${k.body.id}/observations`, { period: '2026-Q3', numerator: '3', denominator: '4', sourceRef: 'Benefits register export (synthetic)' });
    expect(o.status, JSON.stringify(o.body)).toBe(201);
    const kpi = (await p.finance.get(`${P(projectId)}/kpis/${k.body.id}`).expect(200)).body;
    expect(kpi.latestObservation).toMatchObject({ value: '0.7500', numerator: '3.0000', denominator: '4.0000', recordedBy: p.finance.userId, computedBy: 'manual' });
    const b = (await p.finance.get(`${P(projectId)}/benefits/${id}`).expect(200)).body;
    expect(b.kpis.map((x: { id: string }) => x.id)).toEqual([k.body.id]);
    await expect(owner().query(`update kpi_observation set value = 1 where id = $1`, [o.body.id])).rejects.toThrow(/append_only_violation/);
  });
});
