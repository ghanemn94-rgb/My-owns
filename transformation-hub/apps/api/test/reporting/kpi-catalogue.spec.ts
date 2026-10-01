import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, DC, GEN, loginAs, owner, projectIdByCode } from '../helpers';
import { generate, RP } from './report-kit';

type Entry = {
  key: string;
  definition: string;
  formula: string;
  unit: string;
  period: string;
  ownerRole: string | null;
  source: string;
  target: string | null;
  thresholds: { green: string; amber: string; red: string };
  direction: string;
  frequency: string;
  lastVerifiedAt: string | null;
  isProposal: boolean;
  current: { state: string; value: number | null; numerator: number | null; denominator: number | null; notes: string[]; sourcePermission: string | null };
};

const PROPOSED_KPIS = [
  'deliverables_accepted_vs_due',
  'milestone_delay_days',
  'overdue_decisions',
  'action_closure_time',
  'perimeter_items_transferred',
  'perimeter_items_outstanding',
  'contracts_awaiting_consent',
  'day1_readiness_by_site',
  'cps_verified',
  'tsas_at_risk',
  'separation_cost_vs_budget',
  'update_freshness',
  'benefits_realized',
];

let dc: string;
let gen: string;
beforeAll(async () => {
  dc = await projectIdByCode(DC);
  gen = await projectIdByCode(GEN);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-RPT-012 / REQ-RPT-013 / REQ-RPT-014 proposed KPI catalogue computed only from system data', () => {
  it('the §11 KPIs are listed with every attribute and a value computed now from the records (never stored as history)', async () => {
    const pm = await loginAs('pm');
    const body = (await pm.get(RP(dc, '/kpi-catalogue')).expect(200)).body as { asOfLocalDate: string; definitionsReadable: boolean; items: Entry[] };
    expect(body.definitionsReadable).toBe(true);
    const keys = body.items.map((i) => i.key);
    for (const k of PROPOSED_KPIS) expect(keys, k).toContain(k);
    for (const i of body.items) {
      for (const f of ['definition', 'formula', 'unit', 'period', 'source', 'direction', 'frequency'] as const) expect(i[f], `${i.key}.${f}`).toBeTruthy();
      expect(i.thresholds).toMatchObject({ green: expect.any(String), amber: expect.any(String), red: expect.any(String) });
      expect(i).toHaveProperty('ownerRole');
      expect(i).toHaveProperty('target');
      expect(i).toHaveProperty('lastVerifiedAt');
      expect(i.isProposal).toBe(true); // template KPIs are proposals until confirmed
      expect(['computed', 'no_data']).toContain(i.current.state); // the PM reads every source
      if (i.current.state === 'no_data') expect(i.current.value).toBeNull();
    }
    // Reconciles to an independent query of the decision register (decisions the PM may read).
    const overdue = (
      await owner().query<{ n: number }>(
        `select count(*)::int as n from decision where project_id = $1 and status in ('draft','submitted','under_review','recommended') and latest_safe_date < $2::date and classification in ('public','internal','confidential')`,
        [dc, body.asOfLocalDate],
      )
    ).rows[0]!.n;
    expect(body.items.find((i) => i.key === 'overdue_decisions')!.current).toMatchObject({ state: 'computed', value: overdue, sourcePermission: 'governance.decision.read' });
    // Nothing was written as an observation (values are not history).
    const obs = (await owner().query<{ n: number }>(`select count(*)::int as n from kpi_observation o join kpi k on k.id = o.kpi_id where k.project_id = $1 and o.computed_by = 'system'`, [dc])).rows[0]!.n;
    expect(obs).toBe(0);
  });

  it("UT: KPI with no observations renders 'Proposed — no data' — a KPI whose source has no records has no value", async () => {
    const pmB = await loginAs('pm.b');
    const body = (await pmB.get(RP(gen, '/kpi-catalogue')).expect(200)).body as { items: Entry[] };
    const benefits = (await owner().query<{ n: number }>(`select count(*)::int as n from benefit where project_id = $1`, [gen])).rows[0]!.n;
    const entry = body.items.find((i) => i.key === 'benefits_realized')!;
    if (benefits === 0) expect(entry.current).toMatchObject({ state: 'no_data', value: null, numerator: null, denominator: null });
    const noData = body.items.filter((i) => i.current.state === 'no_data');
    expect(noData.length).toBeGreaterThan(0);
    for (const i of noData) {
      expect(i.current.value).toBeNull();
      expect(i.isProposal).toBe(true);
    }
  });

  it('a KPI whose source the caller cannot read reveals nothing; without the finance read the definitions are not listed', async () => {
    const approver = await loginAs('approver'); // functional approver: finance read, no JV deal read
    const body = (await approver.get(RP(dc, '/kpi-catalogue')).expect(200)).body as { items: Entry[] };
    const cps = body.items.find((i) => i.key === 'cps_verified')!;
    expect(cps.current).toEqual({ state: 'restricted', value: null, numerator: null, denominator: null, notes: [], sourcePermission: 'jv.deal.read' });
    const lead = await loginAs('tech.lead'); // finance read only through workstream WS06
    const l = (await lead.get(RP(dc, '/kpi-catalogue')).expect(200)).body;
    expect(l).toMatchObject({ definitionsReadable: false, items: [] });
  });

  it('the health & data quality snapshot freezes the KPI values with their definitions; no-data KPIs stay proposals without a value', async () => {
    const pm = await loginAs('pm');
    const s = await generate(pm, dc, { kind: 'health_data_quality' });
    const d = (await pm.get(RP(dc, `/report-snapshots/${s.id}`)).expect(200)).body as { sections: { key: string; tables: { key: string; rows: { key: string; value: number | null; state: string; definitionStatus: string }[] }[] }[] };
    const kpiRows = d.sections.filter((x) => x.key.startsWith('kpis.')).flatMap((x) => x.tables.find((t) => t.key === 'kpis')!.rows);
    expect(kpiRows.map((r) => r.key)).toEqual(expect.arrayContaining(PROPOSED_KPIS));
    for (const r of kpiRows) if (r.state === 'no_data') expect(r.value).toBeNull();
    const cat = (await pm.get(RP(dc, '/kpi-catalogue')).expect(200)).body as { items: Entry[] };
    for (const r of kpiRows) expect(r.value, r.key).toBe(cat.items.find((i) => i.key === r.key)!.current.value);
  });
});
