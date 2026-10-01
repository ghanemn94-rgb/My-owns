import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, ok, setupJvProject, JvProject } from '../jv/jv-kit';
import { P as FP, createTsa, sar, setupFinance, usd } from '../finance/finance-kit';
import type { Personas } from '../finance/finance-kit';

/**
 * Independent QA — P4 review (docs/reviews/P3-P4-qa-review.md §3): acceptance criteria of §20 that the delivered AT specs
 * assert only in part.
 *  - AT-13 "Reject / LOG; the condition remains unmet": the delivered spec asserts the audit row only for the waiver REQUEST
 *    on a non-waivable CP; the two unauthorized APPROVALS (a person without jv.cp.waive; the sponsor when the specialist set
 *    another authority) are checked for status only. Here: both are logged as denied, the waiver stays requested, the CP open.
 *  - AT-29 "prevent invalid aggregation" beyond /finance/aggregate: the Finance summary and the separation-cost view with
 *    budget lines and TSA charges in SAR units, SAR thousands and USD never add them up (one group per currency and unit).
 */
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('QA-P34 AT-13 — unauthorized CP waiver approvals are refused AND logged; the waiver stays requested and the CP unmet [AT-13, REQ-JV-013, REQ-JV-018]', () => {
  let j: JvProject;
  let pid: string;
  beforeAll(async () => {
    j = await setupJvProject('QA34-AT13');
    pid = j.projectId;
  });

  it('CONTROL: approval by a person without the waiver permission and by a role other than the specialist-set authority → 403, each audited as denied', async () => {
    const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'QA34 signing (synthetic)' }));
    const closing = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: 'QA34 closing (synthetic)' }));
    const cp = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing.id, title: 'QA34 consent, Legal authority (synthetic)', ownerUserId: j.p.pm.userId }));
    const c0 = (await j.p.pm.get(`${P(pid)}/closing-conditions/${cp.id}`).expect(200)).body;
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${cp.id}/determine-waivability`, { expectedVersion: c0.version, blocking: true, waivable: true, waiverAuthorityRole: 'legal_restricted', basis: 'QA specialist determination (synthetic)' }));
    const w = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${cp.id}/waivers`, { basis: 'QA commercial basis (synthetic)', impact: 'QA accepted risk (synthetic)' }));
    const before = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action = 'jv.approveConditionWaiver' and outcome = 'denied'`, [pid]);
    const byLegal = await j.p.legal.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version });
    const bySponsor = await j.p.sponsor.post(`${P(pid)}/closing-condition-waivers/${w.id}/approve`, { expectedVersion: w.version });
    console.log(`QA-P34 AT-13: legal (no jv.cp.waive) → ${byLegal.status} ${byLegal.body.code}; sponsor (not the determined authority) → ${bySponsor.status} ${bySponsor.body.code}`);
    expect(byLegal.status).toBe(403);
    expect(bySponsor.status).toBe(403);
    const rows = await owner().query(
      `select actor_user_id, outcome, reason, after from audit_event where project_id = $1 and action = 'jv.approveConditionWaiver' and outcome = 'denied' order by seq`,
      [pid],
    );
    expect(rows.rows.length - before.rows[0].n).toBe(2);
    expect(rows.rows.map((r) => r.actor_user_id).slice(-2)).toEqual([j.p.legal.userId, j.p.sponsor.userId]);
    expect(rows.rows.slice(-2).every((r) => JSON.stringify(r.after).includes(w.id))).toBe(true);
    const waiver = await owner().query(`select status from waiver where id = $1`, [w.id]);
    expect(waiver.rows[0].status).toBe('requested');
    const c = (await j.p.pm.get(`${P(pid)}/closing-conditions/${cp.id}`).expect(200)).body;
    expect(c).toMatchObject({ status: 'open', waiverEffective: false });
    const d = (await j.p.pm.get(`${P(pid)}/closings/${closing.id}`).expect(200)).body;
    expect(d.blockers.map((b: { ref: string }) => b.ref)).toContain(c.reference);
  });
});

describe('QA-P34 AT-29 — the Finance summary and the separation-cost view never add up different currencies or units [AT-29, REQ-DAT-004, REQ-FIN-002, REQ-FIN-003]', () => {
  let pid: string;
  let p: Personas;
  beforeAll(async () => {
    ({ projectId: pid, p } = await setupFinance('QA34-AT29'));
  });

  it('CONTROL: SAR units, SAR thousands and USD lines (and TSA charges) stay in separate groups; no cross-currency or cross-unit total exists', async () => {
    const lines = [
      { name: 'QA34 programme office, SAR units (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1, committedAmount: '1000', actualsAsOf: '2026-09-01', actualsSourceRef: 'QA PO register (synthetic)' },
      { name: 'QA34 facilities, SAR thousands (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1000, committedAmount: '2', actualsAsOf: '2026-09-01', actualsSourceRef: 'QA PO register (synthetic)' },
      { name: 'QA34 advisers, USD (synthetic)', category: 'one_off_separation', currency: 'USD', unitScale: 1, committedAmount: '100', actualsAsOf: '2026-09-01', actualsSourceRef: 'QA PO register (synthetic)' },
    ];
    for (const l of lines) {
      const r = await p.finance.post(`${FP(pid)}/budget-lines`, l);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const tsaSar = await createTsa(p.pm, pid, 'QA34 NOC TSA in SAR (synthetic)', sar('500'));
    const tsaUsd = await createTsa(p.pm, pid, 'QA34 billing TSA in USD (synthetic)', usd('40'));
    for (const [tsaId, currency, amount] of [[tsaSar, 'SAR', '500'], [tsaUsd, 'USD', '40']] as const) {
      const r = await p.finance.post(`${FP(pid)}/budget-lines`, { name: `QA34 TSA charge ${currency} (synthetic)`, category: 'tsa_charge', tsaServiceId: tsaId, currency, unitScale: 1, committedAmount: amount, actualsAsOf: '2026-09-01', actualsSourceRef: 'QA TSA schedule (synthetic)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const summary = (await p.finance.get(`${FP(pid)}/finance/summary`).expect(200)).body;
    const groups = summary.budget.groups as { currency: string; unitScale: number; lineCount: number; committed: { amount: string; currency: string; unitScale: number } }[];
    console.log(`QA-P34 AT-29 summary groups: ${JSON.stringify(groups.map((g) => [g.currency, g.unitScale, g.lineCount, g.committed.amount]))}`);
    const key = (g: { currency: string; unitScale: number }) => `${g.currency}/${g.unitScale}`;
    expect(groups.map(key).sort()).toEqual(['SAR/1', 'SAR/1000', 'USD/1']);
    for (const g of groups) expect(g.committed).toMatchObject({ currency: g.currency, unitScale: g.unitScale });
    expect(Object.fromEntries(groups.map((g) => [key(g), g.committed.amount]))).toEqual({ 'SAR/1': '1500.0000', 'SAR/1000': '2.0000', 'USD/1': '140.0000' });
    // No field of the summary carries a total across the groups.
    expect(JSON.stringify(summary)).not.toMatch(/"(grandTotal|total(Committed|Approved|Spent))"/);
    const costs = (await p.finance.get(`${FP(pid)}/finance/separation-costs`).expect(200)).body;
    const cg = costs.groups as { category: string; currency: string; unitScale: number; committed: { amount: string } }[];
    console.log(`QA-P34 AT-29 separation-cost groups: ${JSON.stringify(cg.map((g) => [g.category, g.currency, g.unitScale, g.committed.amount]))}`);
    expect(cg.filter((g) => g.category === 'tsa_charge').map((g) => `${g.currency}/${g.unitScale}:${g.committed.amount}`).sort()).toEqual(['SAR/1:500.0000', 'USD/1:40.0000']);
    expect(cg.filter((g) => g.category === 'one_off_separation').map((g) => `${g.currency}/${g.unitScale}:${g.committed.amount}`).sort()).toEqual(['SAR/1000:2.0000', 'SAR/1:1000.0000', 'USD/1:100.0000']);
  });
});
