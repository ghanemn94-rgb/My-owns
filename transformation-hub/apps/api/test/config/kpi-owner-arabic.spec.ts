import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ProjectTemplateDefinition } from '@hub/domain';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, DC } from '../helpers';

/**
 * REQ-RPT-013 (KPI definition attributes, AT "UT: KPI without formula or owner rejected"): every KPI has an owner — a role
 * or a project member — on top of its formula; existing template KPIs (owner role from the template) stay valid.
 * QA-P5-07: the template KPIs of DEMO-DC (created on template version 2) carry the Arabic of the formula, source and
 * thresholds next to the English; a KPI typed by a person has none (shown as entered).
 */
const TEMPLATES = join(__dirname, '..', '..', '..', '..', 'packages', 'db', 'seed', 'templates');
const dcV2 = JSON.parse(readFileSync(join(TEMPLATES, 'dc-carveout.v2.json'), 'utf8')) as ProjectTemplateDefinition;

let pm: Client;
let finance: Client;
let dc: string;
const valid = (over: Record<string, unknown> = {}) => ({
  key: `owner.test.${Math.random().toString(36).slice(2, 8)}`,
  name: 'Owner rule test KPI (synthetic)',
  definition: 'Synthetic KPI for the owner rule',
  formula: 'count(test records)',
  unit: 'count',
  period: 'weekly',
  source: 'test register',
  thresholds: { green: '0', amber: '1-2', red: '3+' },
  direction: 'lower_is_better',
  frequency: 'weekly',
  ...over,
});

beforeAll(async () => {
  pm = await loginAs('pm');
  finance = await loginAs('finance');
  dc = await projectIdByCode(DC);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-RPT-013 — a KPI needs a formula AND an owner (role or member) [UT: KPI without formula or owner rejected]', () => {
  it('UT: KPI without formula or owner rejected (400), nothing written', async () => {
    const before = (await owner().query(`select count(*)::int n from kpi where project_id = $1`, [dc])).rows[0].n;
    const noOwner = await pm.post(`/api/v1/projects/${dc}/kpis`, valid());
    expect(noOwner.status).toBe(400);
    expect(JSON.stringify(noOwner.body.details)).toMatch(/owner/);
    const nullOwners = await pm.post(`/api/v1/projects/${dc}/kpis`, valid({ ownerUserId: null, ownerRole: null }));
    expect(nullOwners.status).toBe(400);
    const { formula: _f, ...noFormula } = valid({ ownerRole: 'project_manager' });
    void _f;
    expect((await pm.post(`/api/v1/projects/${dc}/kpis`, noFormula)).status).toBe(400);
    expect((await pm.post(`/api/v1/projects/${dc}/kpis`, valid({ ownerRole: 'not_a_role' }))).status).toBe(400);
    expect((await owner().query(`select count(*)::int n from kpi where project_id = $1`, [dc])).rows[0].n).toBe(before);
  });

  it('an owner role or a project member is accepted and stored; a non-member owner is refused', async () => {
    const byRole = await pm.post(`/api/v1/projects/${dc}/kpis`, valid({ ownerRole: 'finance_restricted' }));
    expect(byRole.status, JSON.stringify(byRole.body)).toBe(201);
    const k1 = (await finance.get(`/api/v1/projects/${dc}/kpis/${byRole.body.id}`).expect(200)).body;
    expect(k1).toMatchObject({ ownerRole: 'finance_restricted', ownerUserId: null });
    const byMember = await pm.post(`/api/v1/projects/${dc}/kpis`, valid({ ownerUserId: finance.userId }));
    expect(byMember.status, JSON.stringify(byMember.body)).toBe(201);
    expect((await finance.get(`/api/v1/projects/${dc}/kpis/${byMember.body.id}`).expect(200)).body).toMatchObject({ ownerUserId: finance.userId });
    const outsider = await loginAs('pm.b');
    const nonMember = await pm.post(`/api/v1/projects/${dc}/kpis`, valid({ ownerUserId: outsider.userId }));
    expect(nonMember.status).toBe(400);
    expect(nonMember.body.code).toBe('finance.user_not_member');
    const au = await owner().query(`select after from audit_event where entity_id = $1 and action = 'finance.kpi.create'`, [byRole.body.id]);
    expect(au.rows[0].after).toMatchObject({ ownerRole: 'finance_restricted', ownerUserId: null });
  });

  it('existing template KPIs stay valid: each carries the owner role of its template', async () => {
    const rows = (await owner().query(`select key, owner_role, owner_user_id from kpi where project_id = $1 and key = any($2)`, [dc, dcV2.kpis.map((k) => k.key)])).rows;
    expect(rows.length).toBe(dcV2.kpis.length);
    for (const r of rows) expect(r.owner_role).toBe(dcV2.kpis.find((k) => k.key === r.key)!.ownerRole);
  });
});

describe('QA-P5-07 — template KPI texts in Arabic: template value + Arabic, none for a KPI typed by a person', () => {
  it('every DEMO-DC template KPI returns the Arabic formula, source and thresholds of its pinned template version; a user KPI returns none', async () => {
    const items = (await finance.get(`/api/v1/projects/${dc}/kpis?pageSize=100`).expect(200)).body.items as { key: string; formula: string; formulaAr: string | null; source: string; sourceAr: string | null; thresholds: Record<string, string>; thresholdsAr: Record<string, string> | null; definitionAr: string | null }[];
    for (const t of dcV2.kpis) {
      const k = items.find((x) => x.key === t.key)!;
      expect(k, t.key).toMatchObject({ formula: t.formula, formulaAr: t.formulaAr, source: t.source, sourceAr: t.sourceAr, thresholdsAr: t.thresholdsAr, definitionAr: t.definition.ar });
      expect(k.formulaAr).toMatch(/[؀-ۿ]/);
      expect(k.formulaAr).not.toMatch(/[A-Za-z]/);
    }
    const mine = items.filter((x) => x.key.startsWith('owner.test.'));
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((x) => x.formulaAr === null && x.sourceAr === null && x.thresholdsAr === null && x.definitionAr === null)).toBe(true);
  });

  it('the KPI catalogue of the Reports screen carries the same Arabic texts', async () => {
    const sec = await loginAs('secretary');
    const r = await sec.get(`/api/v1/projects/${dc}/kpi-catalogue`);
    expect(r.status, JSON.stringify(r.body).slice(0, 300)).toBe(200);
    const k = (r.body.items as { key: string; formulaAr: string | null; sourceAr: string | null; thresholdsAr: unknown }[]).find((x) => x.key === 'cps_verified')!;
    const t = dcV2.kpis.find((x) => x.key === 'cps_verified')!;
    expect(k).toMatchObject({ formulaAr: t.formulaAr, sourceAr: t.sourceAr, thresholdsAr: t.thresholdsAr });
  });
});
