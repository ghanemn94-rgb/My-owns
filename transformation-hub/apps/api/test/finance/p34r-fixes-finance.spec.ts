import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { P, createSnapshot, sar, setupFinance, Personas } from './finance-kit';

/**
 * DOM-P34R-09 (docs/reviews/P3-P4-domain-rereview.md; DOM-P4-16 residual): the reviewer of an intercompany reconciliation is
 * independent of EVERY person who created or edited it (its record history), not only of the creator and the last preparer —
 * consistent with the evidence-linker rule of SEC-P34-01. Synthetic demo-flagged project; four finance_restricted holders.
 */
let projectId: string;
let p: Personas;

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('P34RF-FIN', [['sponsor', 'finance_restricted']]));
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P34R-09 — every intermediate editor is excluded from the reconciliation review [REQ-FIN-004]', () => {
  it('created by Finance, explained by Legal, re-explained by the approver: Legal (an intermediate editor) is refused (403); a fourth person reviews', async () => {
    const ic = (await createSnapshot(p.finance, projectId, { kind: 'actual', category: 'intercompany', amount: sar('2000'), label: 'Intercompany receivable (synthetic)', period: '2026-08' })).id;
    const r = await p.finance.post(`${P(projectId)}/financial-snapshots/${ic}/reconciliations`, { counterpartyLabel: 'Parent company (synthetic)', theirBalance: sar('1900'), sourceRef: 'Counterparty confirmation (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const path = `${P(projectId)}/intercompany-reconciliations/${r.body.id}`;
    let rec = (await p.legal.get(path).expect(200)).body;
    const byLegal = await p.legal.patch(path, { expectedVersion: rec.version, explanation: 'Credit note CN-TEST-2 in transit at period end (synthetic)' });
    expect(byLegal.status, JSON.stringify(byLegal.body)).toBe(200);
    const byApprover = await p.approver.patch(path, { expectedVersion: byLegal.body.version, explanation: 'Credit note CN-TEST-2 in transit at period end; confirmed by the parent (synthetic)' });
    expect(byApprover.status, JSON.stringify(byApprover.body)).toBe(200);
    rec = (await p.legal.get(path).expect(200)).body;
    expect(rec.preparedBy).toBe(p.approver.userId);
    const intermediate = await p.legal.post(`${path}/reconcile`, { expectedVersion: rec.version, note: 'Review by an intermediate editor (synthetic)' });
    expect(intermediate.status, JSON.stringify(intermediate.body)).toBe(403);
    expect(intermediate.body.code).toBe('finance.recon.self');
    const ok = await p.sponsor.post(`${path}/reconcile`, { expectedVersion: rec.version, note: 'Reviewed (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await p.legal.get(path).expect(200)).body).toMatchObject({ status: 'reconciled', reviewerUserId: p.sponsor.userId });
  });
});
