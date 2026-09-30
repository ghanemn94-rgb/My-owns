import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { closeApp, closePools, loginAs, owner, projectIdByCode, runtimePool, Client, GEN } from '../helpers';
import { insertDecisionRow } from '../gates/gate-test-kit';
import { P, createSnapshot, createTsa, lineRef, orgOf, sar, setupFinance, workstreamId, Personas } from './finance-kit';

/**
 * Finance isolation (AT-03, ARCH-02/14; access-matrix §2.3/§2.5): another project's users and room-only principals get
 * 404 everywhere; LOWER clearance sees nothing above it — lists, totals, summary counts AND aggregates are computed
 * inside SQL over visible rows only; the finance-domain clearance of finance_restricted (strictly_confidential) applies
 * to finance records only; workstream-scoped readers see only their workstreams; foreign ids are never trusted (404 +
 * composite FKs) and PostgreSQL RLS hides the rows from another project's runtime context.
 */
let projectId: string;
let genId: string;
let orgId: string;
let p: Personas;
let pmB: Client;
let auditor: Client;
let restrictedSnap: string;
let confidentialSnap: string;
let valuationModel: string;
let lineWs07: string;
let lineProject: string;
let ws07: string;

async function asRuntime<T>(projects: string[], fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await runtimePool().connect();
  try {
    await c.query('begin');
    await c.query(`select set_config('app.org_id',$1,true), set_config('app.project_ids',$2,true), set_config('app.full_project_ids',$2,true)`, [orgId, projects.join(',')]);
    return await fn(c);
  } finally {
    await c.query('rollback').catch(() => undefined);
    c.release();
  }
}

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('FIN-ISO'));
  genId = await projectIdByCode(GEN);
  orgId = await orgOf(projectId);
  pmB = await loginAs('pm.b');
  auditor = await loginAs('auditor');
  ws07 = await workstreamId(p.pm, projectId, 'WS07');
  restrictedSnap = (await createSnapshot(p.finance, projectId, { kind: 'actual', amount: sar('700'), label: 'Restricted figure (synthetic)' })).id; // default: restricted
  confidentialSnap = (await createSnapshot(p.finance, projectId, { kind: 'actual', amount: sar('300'), label: 'Confidential figure (synthetic)', classification: 'confidential' })).id;
  valuationModel = (await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'valuation', name: 'Strictly confidential valuation (synthetic)' })).body.id; // default: strictly_confidential
  lineWs07 = (await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'WS07 operations cost (synthetic)', category: 'opex', currency: 'SAR', unitScale: 1, workstreamId: ws07 })).body.id;
  lineProject = (await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'Programme-wide cost (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1 })).body.id;
  // A workstream-only principal: tech.lead with ONLY a workstream_lead role on WS07 (the gates kit's first-workstream grant is revoked).
  await owner().query(`update project_membership set revoked_at = now(), revoked_by = granted_by where project_id = $1 and user_id = (select id from app_user where email = $2) and revoked_at is null`, [projectId, 'demo.tech.lead@demo.invalid']);
  const admin = await loginAs('portfolio.admin');
  const g = await admin.post(`${P(projectId)}/members`, { userId: (await loginAs('tech.lead')).userId, role: 'workstream_lead', workstreamId: ws07, reason: 'finance isolation test (workstream role)' });
  expect(g.status, JSON.stringify(g.body)).toBe(201);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const GETS = (id: string) => [
  '/finance/summary',
  '/finance/separation-costs',
  '/financial-snapshots',
  `/financial-snapshots/${id}`,
  '/budget-lines',
  '/intercompany-reconciliations',
  '/financial-models',
  '/benefits',
  '/kpis',
];

describe('Finance isolation — other projects, clearance, workstream reach, foreign ids, RLS [AT-03, REQ-FIN-001, REQ-DAT-004]', () => {
  it('a Project-B user gets 404 on every finance read and command of Project A (existence not leaked)', async () => {
    for (const g of GETS(restrictedSnap)) expect((await pmB.get(`${P(projectId)}${g}`)).status, g).toBe(404);
    const posts: [string, Record<string, unknown>][] = [
      ['/financial-snapshots', { kind: 'actual', category: 'opex', lineRef: 'X', label: 'x', period: '2026-09', amount: sar('1'), sourceRef: 'x' }],
      [`/financial-snapshots/${restrictedSnap}/validate`, { expectedVersion: 1, note: 'x' }],
      ['/finance/aggregate', { snapshotIds: [restrictedSnap] }],
      [`/budget-lines/${lineProject}/actuals`, { expectedVersion: 1, committed: sar('1'), asOf: '2026-09-01', sourceRef: 'x' }],
    ];
    for (const [path, body] of posts) expect((await pmB.post(`${P(projectId)}${path}`, body)).status, path).toBe(404);
    expect((await pmB.get(`${P(genId)}/financial-snapshots/${restrictedSnap}`)).status).toBe(404);
    expect((await pmB.get(`${P(genId)}/budget-lines/${lineProject}`)).status).toBe(404);
  });

  it('room-only principals (partner / clean team) see nothing', async () => {
    for (const persona of ['partner.alpha', 'cleanteam']) {
      const c = await loginAs(persona);
      expect((await c.get(`${P(projectId)}/financial-snapshots`)).status, persona).toBe(404);
      expect((await c.get(`${P(projectId)}/finance/summary`)).status, persona).toBe(404);
    }
  });

  it('a project member without finance.record.read is refused (403); with it, lower clearance sees nothing above it', async () => {
    expect((await p.contributor.get(`${P(projectId)}/financial-snapshots`)).status).toBe(403);
    // PM (confidential): the confidential figure and budget lines only — list, count, summary and aggregate agree.
    const list = (await p.pm.get(`${P(projectId)}/financial-snapshots?pageSize=100`).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([confidentialSnap]);
    expect(list.total).toBe(1);
    expect((await p.pm.get(`${P(projectId)}/financial-snapshots/${restrictedSnap}`)).status).toBe(404);
    const sum = (await p.pm.get(`${P(projectId)}/finance/summary`).expect(200)).body;
    expect(sum.snapshots.total).toBe(1);
    expect(sum.models.total).toBe(0);
    expect(sum.budget.lines).toBe(2);
    const agg = await p.pm.post(`${P(projectId)}/finance/aggregate`, { kind: 'actual' });
    expect(agg.status, JSON.stringify(agg.body)).toBe(201);
    expect(agg.body).toMatchObject({ count: 1, total: sar('300.0000') });
    // Naming an invisible figure in an aggregate is a 404 (indistinguishable from a missing one).
    expect((await p.pm.post(`${P(projectId)}/finance/aggregate`, { snapshotIds: [confidentialSnap, restrictedSnap] })).status).toBe(404);
    expect((await p.pm.get(`${P(projectId)}/financial-models/${valuationModel}`)).status).toBe(404);
    expect((await p.pm.get(`${P(projectId)}/financial-models`).expect(200)).body.total).toBe(0);
    // The organization auditor (confidential) — same view.
    const a = (await auditor.get(`${P(projectId)}/financial-snapshots`).expect(200)).body;
    expect(a.items.map((x: { id: string }) => x.id)).toEqual([confidentialSnap]);
  });

  it('writers cannot create finance data above their own clearance (403, never silently downgraded)', async () => {
    const r = await p.pm.post(`${P(projectId)}/financial-snapshots`, { kind: 'forecast', category: 'opex', lineRef: lineRef(), label: 'x', period: '2026-09', amount: sar('1'), sourceRef: 'x-ref' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('policy.classification_exceeds_clearance');
    const ok = await p.pm.post(`${P(projectId)}/financial-snapshots`, { kind: 'forecast', category: 'opex', lineRef: lineRef(), label: 'x', period: '2026-09', amount: sar('1'), sourceRef: 'x-ref', classification: 'confidential' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const s = (await p.finance.get(`${P(projectId)}/financial-snapshots/${ok.body.id}`).expect(200)).body;
    const down = await p.finance.patch(`${P(projectId)}/financial-snapshots/${restrictedSnap}`, { expectedVersion: 1, classification: 'internal' });
    expect(down.status).toBe(422);
    expect(down.body.code).toBe('finance.declassification');
    void s;
  });

  it('finance_restricted reads finance records up to strictly_confidential; the chair (restricted) sees snapshots but not the valuation', async () => {
    const f = (await p.finance.get(`${P(projectId)}/financial-models`).expect(200)).body;
    expect(f.items.map((x: { id: string }) => x.id)).toContain(valuationModel);
    const chairSnaps = (await p.chair.get(`${P(projectId)}/financial-snapshots?pageSize=100`).expect(200)).body;
    expect(chairSnaps.items.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([restrictedSnap, confidentialSnap]));
    expect((await p.chair.get(`${P(projectId)}/financial-models`).expect(200)).body.total).toBe(0);
    expect((await p.sponsor.get(`${P(projectId)}/financial-models`).expect(200)).body.total).toBe(1);
  });

  it('evidence and history of finance records follow the finance-domain clearance and reach, like the finance lists', async () => {
    const ev = (target: string, id: string) => `${P(projectId)}/evidence?targetType=${target}&targetId=${id}`;
    const hist = (type: string, id: string) => `${P(projectId)}/activity?entityType=${type}&entityId=${id}`;
    // finance_restricted (general clearance below the figure, finance-domain clearance strictly_confidential): readable.
    expect((await p.finance.get(ev('financial_snapshot', restrictedSnap))).status).toBe(200);
    expect((await p.finance.get(hist('financial_snapshot', restrictedSnap)).expect(200)).body.total).toBeGreaterThan(0);
    expect((await p.finance.get(hist('financial_model', valuationModel)).expect(200)).body.total).toBeGreaterThan(0);
    // The PM (confidential, no finance-domain clearance): the same records are invisible — 404 / nothing in the history.
    expect((await p.pm.get(ev('financial_snapshot', restrictedSnap))).status).toBe(404);
    expect((await p.pm.get(hist('financial_snapshot', restrictedSnap)).expect(200)).body.total).toBe(0);
    expect((await p.pm.get(hist('financial_model', valuationModel)).expect(200)).body.total).toBe(0);
    expect((await p.pm.get(hist('financial_snapshot', confidentialSnap)).expect(200)).body.total).toBeGreaterThan(0);
    // A workstream-only finance reader: a budget line of another workstream / of the whole programme is not in its history.
    const lead = await loginAs('tech.lead');
    expect((await lead.get(hist('budget_line', lineWs07)).expect(200)).body.total).toBeGreaterThan(0);
    expect((await lead.get(hist('budget_line', lineProject)).expect(200)).body.total).toBe(0);
  });

  it('a workstream-only reader sees and counts only its workstream (reach in SQL); records without a workstream are 404', async () => {
    const lead = await loginAs('tech.lead');
    const lines = (await lead.get(`${P(projectId)}/budget-lines?pageSize=100`).expect(200)).body;
    expect(lines.items.map((x: { id: string }) => x.id)).toEqual([lineWs07]);
    expect(lines.total).toBe(1);
    expect((await lead.get(`${P(projectId)}/budget-lines/${lineProject}`)).status).toBe(404);
    const sum = (await lead.get(`${P(projectId)}/finance/summary`).expect(200)).body;
    expect(sum.budget.lines).toBe(1);
    expect(sum.snapshots.total).toBe(0);
    expect((await lead.get(`${P(projectId)}/intercompany-reconciliations`).expect(200)).body.total).toBe(0);
    // No finance write permission at all for a workstream lead.
    expect((await lead.post(`${P(projectId)}/budget-lines`, { name: 'x', category: 'opex', currency: 'SAR', unitScale: 1, workstreamId: ws07 })).status).toBe(403);
  });

  it('foreign ids submitted by a Project-A user are rejected (404) — TSA, workstream, decision; the database refuses them too', async () => {
    const tsaB = await createTsa(pmB, genId, 'Project B TSA (synthetic)', null);
    const wsB = (await owner().query(`select id from workstream where project_id = $1 limit 1`, [genId])).rows[0].id as string;
    const decisionB = await insertDecisionRow(orgId, genId, { code: 'DEC-FIN-ISO-B', status: 'approved', authorityOutcome: 'within_mandate' });
    await owner().query(`update decision set decision_type_key = 'change_request_budget' where id = $1`, [decisionB]);
    expect((await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'x', category: 'tsa_charge', currency: 'SAR', unitScale: 1, tsaServiceId: tsaB })).status).toBe(404);
    expect((await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'x', category: 'opex', currency: 'SAR', unitScale: 1, workstreamId: wsB })).status).toBe(404);
    expect((await p.finance.post(`${P(projectId)}/budget-lines/${lineProject}/record-approval`, { expectedVersion: 1, decisionId: decisionB, approvedAmount: sar('1') })).status).toBe(404);
    await expect(owner().query(`update budget_line set tsa_service_id = $1, category = 'tsa_charge' where id = $2`, [tsaB, lineProject])).rejects.toThrow(/foreign key/);
    await expect(owner().query(`update financial_snapshot set workstream_id = $1 where id = $2`, [wsB, restrictedSnap])).rejects.toThrow(/foreign key/);
    await expect(owner().query(`update budget_line set approval_decision_id = $1 where id = $2`, [decisionB, lineProject])).rejects.toThrow(/foreign key/);
    await expect(owner().query(`update financial_snapshot set project_id = $1 where id = $2`, [genId, restrictedSnap])).rejects.toThrow(/immutable_scope/);
  });

  it('PostgreSQL RLS hides Project-A finance rows from a Project-B runtime context', async () => {
    const n = await asRuntime([genId], async (c) => {
      const r = await c.query(
        `select (select count(*) from financial_snapshot where project_id = $1)::int a, (select count(*) from budget_line where project_id = $1)::int b,
                (select count(*) from financial_model where project_id = $1)::int c, (select count(*) from benefit where project_id = $1)::int d`,
        [projectId],
      );
      return r.rows[0];
    });
    expect(n).toEqual({ a: 0, b: 0, c: 0, d: 0 });
    const own = await asRuntime([projectId], async (c) => (await c.query(`select count(*)::int n from financial_snapshot where project_id = $1`, [projectId])).rows[0].n);
    expect(own).toBeGreaterThan(0);
  });

  it('search terms are literal and sort keys are allow-listed', async () => {
    expect((await p.finance.get(`${P(projectId)}/financial-snapshots?q=${encodeURIComponent('%')}`).expect(200)).body.total).toBe(0);
    expect((await p.finance.get(`${P(projectId)}/financial-snapshots?sort=amount`)).status).toBe(400);
    const sorted = (await p.finance.get(`${P(projectId)}/budget-lines?sort=-code`).expect(200)).body;
    expect(sorted.items.map((x: { code: string }) => x.code)).toEqual([...sorted.items.map((x: { code: string }) => x.code)].sort().reverse());
  });
});
