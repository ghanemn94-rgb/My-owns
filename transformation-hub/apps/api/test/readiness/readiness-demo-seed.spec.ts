import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, DC } from '../helpers';
import { P } from './readiness-kit';

/** The demo sandbox scenario for readiness / TSA was created through the module services (demo-flagged, no invented facts). */
let dc: string;
let pm: Client;

beforeAll(async () => {
  dc = await projectIdByCode(DC);
  pm = await loginAs('pm');
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Readiness demo seed [REQ-RDY-004, REQ-TSA-001, AT-09, AT-13]', () => {
  it('the Day-1 demo plan shows a blocked GO with the failed connectivity test and its contingency', async () => {
    const plans = (await pm.get(`${P(dc)}/cutover-plans`).expect(200)).body.items as { id: string; title: string; isDemo: boolean }[];
    const day1 = plans.find((x) => x.title.startsWith('Day-1 go-live — DEMO'));
    expect(day1?.isDemo).toBe(true);
    const v = (await pm.get(`${P(dc)}/cutover-plans/${day1!.id}`).expect(200)).body;
    expect(v.goEvaluation.allowed).toBe(false);
    expect(v.goEvaluation.missing).toEqual(expect.arrayContaining(['transition window', 'testing / rehearsal', 'approved go/no-go decision']));
    const conn = v.checks.find((c: { area: string; status: string }) => c.area === 'connectivity' && c.status === 'failed');
    expect(conn.failureContingency).toMatch(/DEMO contingency/);
    expect(conn.latestTest.result).toBe('failed');
    expect(v.goEvaluation.blockers.map((b: { id: string }) => b.id)).toContain(conn.id);
  });

  it('the non-waivable waiver attempt was rejected and audited; the TSA is in negotiation with no dates or amounts', async () => {
    const audit = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action = 'readiness_check.waiver.request' and outcome = 'rejected'`, [dc]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    const tsas = (await pm.get(`${P(dc)}/tsa-services`).expect(200)).body.items as { id: string; status: string; isDemo: boolean; endDate: string | null }[];
    const t = tsas.find((x) => x.status === 'negotiating');
    expect(t).toMatchObject({ isDemo: true, endDate: null });
    const d = (await pm.get(`${P(dc)}/tsa-services/${t!.id}`).expect(200)).body;
    expect(d.charge).toBeNull();
    const sched = await owner().query(`select count(*)::int n from scheduled_job where project_id = $1 and kind = 'readiness.tsa_expiry_scan'`, [dc]);
    expect(sched.rows[0].n).toBe(1);
  });
});
