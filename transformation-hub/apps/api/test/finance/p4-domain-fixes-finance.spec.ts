import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { P, createSnapshot, plusDays, sar, setupFinance, Personas } from './finance-kit';

/**
 * Regression tests of the P4 domain-review fixes on the finance side (docs/reviews/P4-domain-review.md), through the API on
 * a synthetic demo-flagged project:
 *  - DOM-P4-12 [REQ-FIN-009]: a benefit's definition, baseline, target and value accepted into the register are not edited
 *    in place — the benefit is reopened for revision (reason required, back to proposed) and accepted again independently.
 *  - DOM-P4-16 [REQ-FIN-004]: a reconciliation is reviewed by a person other than its creator AND its last preparer.
 */
let projectId: string;
let p: Personas;

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('FIN-P4FIX'));
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P4-12 — an accepted benefit definition needs re-acceptance after a change [REQ-FIN-009]', () => {
  it('definition / baseline / target / value locked after acceptance; revision returns it to proposed; a fresh independent acceptance', async () => {
    const c = await p.pm.post(`${P(projectId)}/benefits`, {
      title: 'Standalone facility cost avoidance (synthetic)',
      measurementDefinition: 'Annual facility run cost vs pre-separation allocation (synthetic definition)',
      baselineValue: 'TBD',
      targetValue: 'TBD',
      ownerUserId: p.pm.userId,
      realizationDate: plusDays(120),
    });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    const path = `${P(projectId)}/benefits/${c.body.id}`;
    const ap = await p.finance.post(`${path}/approve`, { expectedVersion: 1 });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    let v = ap.body.version as number;
    for (const change of [{ targetValue: '10% lower (synthetic)' }, { baselineValue: 'FY-1 allocation (synthetic)' }, { measurementDefinition: 'Changed definition (synthetic)' }, { value: sar('500000') }]) {
      const r = await p.pm.patch(path, { expectedVersion: v, ...change });
      expect(r.status, JSON.stringify(change)).toBe(422);
      expect(r.body.code).toBe('finance.benefit.accepted_definition_locked');
    }
    const title = await p.pm.patch(path, { expectedVersion: v, title: 'Standalone facility cost avoidance — renamed (synthetic)' });
    expect(title.status, JSON.stringify(title.body)).toBe(200);
    v = title.body.version;
    const tr = await p.pm.post(`${path}/start-tracking`, { expectedVersion: v });
    expect(tr.status).toBe(201);
    v = tr.body.version;
    expect((await p.pm.patch(path, { expectedVersion: v, targetValue: 'x' })).body.code).toBe('finance.benefit.accepted_definition_locked');
    const noReason = await p.pm.post(`${path}/revise-definition`, { expectedVersion: v, note: '  ' });
    expect(noReason.status).toBe(400);
    const rev = await p.pm.post(`${path}/revise-definition`, { expectedVersion: v, note: 'Target restated after the cost review (synthetic)' });
    expect(rev.status, JSON.stringify(rev.body)).toBe(201);
    expect(rev.body.status).toBe('proposed');
    let b = (await p.finance.get(path).expect(200)).body;
    expect(b).toMatchObject({ status: 'proposed', approvedBy: null });
    const edited = await p.pm.patch(path, { expectedVersion: b.version, targetValue: '10% lower (synthetic)' });
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const again = await p.approver.post(`${path}/approve`, { expectedVersion: edited.body.version });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    b = (await p.finance.get(path).expect(200)).body;
    expect(b).toMatchObject({ status: 'approved', approvedBy: p.approver.userId, targetValue: '10% lower (synthetic)' });
  });
});

describe('DOM-P4-16 — reconciliation reviewer independent of the creator and the last preparer [REQ-FIN-004]', () => {
  it('the creator cannot review after another person edited the explanation; a third person can', async () => {
    const ic = (await createSnapshot(p.finance, projectId, { kind: 'actual', category: 'intercompany', amount: sar('2000'), label: 'Intercompany receivable (synthetic)', period: '2026-08' })).id;
    const r = await p.finance.post(`${P(projectId)}/financial-snapshots/${ic}/reconciliations`, { counterpartyLabel: 'Parent company (synthetic)', theirBalance: sar('1900'), sourceRef: 'Counterparty confirmation (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const path = `${P(projectId)}/intercompany-reconciliations/${r.body.id}`;
    let rec = (await p.legal.get(path).expect(200)).body;
    const explain = await p.legal.patch(path, { expectedVersion: rec.version, explanation: 'Credit note CN-TEST-1 in transit at period end (synthetic)' });
    expect(explain.status, JSON.stringify(explain.body)).toBe(200);
    rec = (await p.legal.get(path).expect(200)).body;
    expect(rec.preparedBy).toBe(p.legal.userId);
    // Finance recorded the balance (creator); Legal (finance_restricted here) is now the last preparer. Both hold
    // finance.snapshot.approve — neither may review.
    const byCreator = await p.finance.post(`${path}/reconcile`, { expectedVersion: explain.body.version });
    expect(byCreator.status, JSON.stringify(byCreator.body)).toBe(403);
    expect(byCreator.body.code).toBe('finance.recon.self');
    expect((await p.legal.post(`${path}/reconcile`, { expectedVersion: explain.body.version })).status).toBe(403);
    const ok = await p.approver.post(`${path}/reconcile`, { expectedVersion: explain.body.version, note: 'Reviewed (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    rec = (await p.legal.get(path).expect(200)).body;
    expect(rec).toMatchObject({ status: 'reconciled', reviewerUserId: p.approver.userId });
  });
});
