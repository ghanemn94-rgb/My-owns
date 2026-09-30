import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, RATE, auditRows, createSnapshot, decisionOfType, lineRef, sar, setupFinance, setupGovernance, usd, Gov, Personas } from './finance-kit';

/**
 * AT-29: combining financial data with different currencies / units — invalid aggregation is prevented; where a
 * conversion is used its basis and source are shown (REQ-DAT-004). Also REQ-FIN-007: EV vs equity value and
 * currency / unit confusion are flagged; mixed units are rejected (never silently normalized).
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let sarUnits: string;
let usdUnits: string;
let sarThousands: string;
let baselineSar: string;

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('FIN-AT29'));
  gov = await setupGovernance(projectId, p);
  sarUnits = (await createSnapshot(p.finance, projectId, { kind: 'actual', period: '2026-Q3', amount: sar('1000'), label: 'Separation IT cost (synthetic)' })).id;
  usdUnits = (await createSnapshot(p.finance, projectId, { kind: 'actual', period: '2026-Q3', amount: usd('100'), label: 'Advisor fee in USD (synthetic)' })).id;
  sarThousands = (await createSnapshot(p.finance, projectId, { kind: 'actual', period: '2026-Q3', amount: sar('2', 1000), label: 'Facility cost in thousands (synthetic)' })).id;
  baselineSar = (await createSnapshot(p.finance, projectId, { kind: 'baseline', period: '2026-Q3', amount: sar('900'), label: 'Baseline cost (synthetic)' })).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const agg = (body: Record<string, unknown>) => p.finance.post(`${P(projectId)}/finance/aggregate`, body);

describe('AT-29 — different currencies / units cannot be combined without an explicit, disclosed basis [REQ-DAT-004, REQ-FIN-007, REQ-FIN-001]', () => {
  it('SAR + USD without a conversion basis is rejected (422) and the rejection is audited', async () => {
    const r = await agg({ snapshotIds: [sarUnits, usdUnits] });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('money.mixed_currency');
    const rows = await auditRows(projectId, 'finance.aggregate', 'rejected', p.finance.userId);
    expect(rows.some((x) => x.reason?.startsWith('money.mixed_currency'))).toBe(true);
  });

  it('with an explicit basis (rate, source, date) the total shows its basis and source', async () => {
    const r = await agg({ snapshotIds: [sarUnits, usdUnits], targetCurrency: 'SAR', conversions: [RATE] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.total).toEqual({ amount: '1375.0000', currency: 'SAR', unitScale: 1 });
    expect(r.body.count).toBe(2);
    expect(r.body.conversions).toEqual([RATE]);
    expect(r.body.basisI18n).toEqual([{ code: 'finance.aggregate.converted', params: { from: 'USD', to: 'SAR', rate: '3.75', source: RATE.source, asOf: RATE.asOf } }]);
    expect(r.body.basis).toContain(RATE.source);
    expect(r.body.items.map((i: { id: string }) => i.id).sort()).toEqual([sarUnits, usdUnits].sort());
  });

  it('a basis without its source or date is refused (the platform never invents a rate)', async () => {
    const noSource = await agg({ snapshotIds: [sarUnits, usdUnits], targetCurrency: 'SAR', conversions: [{ ...RATE, source: '' }] });
    expect(noSource.status).toBe(400);
    const noDate = await agg({ snapshotIds: [sarUnits, usdUnits], targetCurrency: 'SAR', conversions: [{ from: 'USD', to: 'SAR', rate: '3.75', source: 'x' }] });
    expect(noDate.status).toBe(400);
    const zero = await agg({ snapshotIds: [sarUnits, usdUnits], targetCurrency: 'SAR', conversions: [{ ...RATE, rate: '0' }] });
    expect(zero.status).toBe(400);
    expect(zero.body.code).toBe('money.invalid_rate');
  });

  it('units vs thousands are rejected unless normalization is explicit — and then disclosed', async () => {
    const mixed = await agg({ snapshotIds: [sarUnits, sarThousands] });
    expect(mixed.status).toBe(422);
    expect(mixed.body.code).toBe('money.mixed_unit_scale');
    const ok = await agg({ snapshotIds: [sarUnits, sarThousands], normalizeUnits: true, targetUnitScale: 1 });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.total).toEqual({ amount: '3000.0000', currency: 'SAR', unitScale: 1 });
    expect(ok.body.normalizedUnitScales).toEqual([1, 1000]);
    expect(ok.body.basisI18n.map((b: { code: string }) => b.code)).toEqual(['finance.aggregate.units_normalized']);
  });

  it('baseline and actual figures are never added together', async () => {
    const r = await agg({ snapshotIds: [sarUnits, baselineSar] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('finance.aggregate.mixed_kinds');
  });

  it('a filtered aggregate covers every visible figure of the kind and needs the same explicit basis', async () => {
    expect((await agg({ kind: 'actual', period: '2026-Q3' })).status).toBe(422);
    const r = await agg({ kind: 'actual', period: '2026-Q3', targetCurrency: 'SAR', targetUnitScale: 1, normalizeUnits: true, conversions: [RATE] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.count).toBe(3);
    expect(r.body.total).toEqual({ amount: '3375.0000', currency: 'SAR', unitScale: 1 });
    expect(r.body.basisI18n.map((b: { code: string }) => b.code).sort()).toEqual(['finance.aggregate.converted', 'finance.aggregate.units_normalized']);
  });

  it('commitments recorded in another unit than the budget line are rejected; the line is unchanged', async () => {
    const line = await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'Separation programme office (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1000 });
    expect(line.status, JSON.stringify(line.body)).toBe(201);
    const wrongUnit = await p.finance.post(`${P(projectId)}/budget-lines/${line.body.id}/actuals`, { expectedVersion: 1, committed: sar('1200000'), asOf: '2026-09-01', sourceRef: 'PO register (synthetic)' });
    expect(wrongUnit.status).toBe(422);
    expect(wrongUnit.body.code).toBe('money.mixed_unit_scale');
    const wrongCcy = await p.finance.post(`${P(projectId)}/budget-lines/${line.body.id}/actuals`, { expectedVersion: 1, committed: usd('1200', 1000), asOf: '2026-09-01', sourceRef: 'PO register (synthetic)' });
    expect(wrongCcy.status).toBe(422);
    expect(wrongCcy.body.code).toBe('money.mixed_currency');
    const row = (await owner().query(`select committed_amount, version from budget_line where id = $1`, [line.body.id])).rows[0];
    expect(row).toEqual({ committed_amount: '0.0000', version: 1 });
    const ok = await p.finance.post(`${P(projectId)}/budget-lines/${line.body.id}/actuals`, { expectedVersion: 1, committed: sar('1200', 1000), asOf: '2026-09-01', sourceRef: 'PO register (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
  });

  it('an approved budget stated in another unit than the decision paper is rejected (no silent conversion)', async () => {
    const line = await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'Standalone licences (synthetic)', category: 'recurring_standalone', currency: 'SAR', unitScale: 1000 });
    expect(line.status).toBe(201);
    // The decision paper states 100 000 SAR in units (gov-fixtures default); the line is kept in thousands.
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget');
    expect(d.status).toBe('approved');
    const r = await p.finance.post(`${P(projectId)}/budget-lines/${line.body.id}/record-approval`, { expectedVersion: 1, decisionId: d.id, approvedAmount: sar('100', 1000) });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('finance.budget.decision_unit_mismatch');
    expect((await owner().query(`select approved_amount from budget_line where id = $1`, [line.body.id])).rows[0].approved_amount).toBeNull();
  });
});

describe('AT-29 / REQ-FIN-007 — EV vs equity value and unit / currency confusion in valuation outputs', () => {
  let modelId: string;
  let v1: string;
  let v2: string;
  const out = (o: Record<string, unknown>) => ({ measure: 'money', currency: 'SAR', unitScale: 1000000, basis: 'other', ...o });

  beforeAll(async () => {
    const m = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'valuation', name: 'Synthetic valuation case (test)' });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    modelId = m.body.id;
    const a = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, {
      modelCase: 'base',
      versionLabel: 'v1',
      headlineBasis: 'enterprise_value',
      sourceRef: 'Synthetic model run 1 (test)',
      outputs: [
        out({ key: 'headline', label: 'Headline value', amount: '500', basis: 'enterprise_value' }),
        out({ key: 'equity', label: 'Equity value', amount: '420', basis: 'equity_value' }),
        out({ key: 'capex', label: 'Capex', amount: '12' }),
        out({ key: 'debt', label: 'Debt', amount: '30' }),
      ],
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    v1 = a.body.id;
    const b = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, {
      modelCase: 'base',
      versionLabel: 'v2',
      headlineBasis: 'equity_value',
      sourceRef: 'Synthetic model run 2 (test)',
      outputs: [
        out({ key: 'headline', label: 'Headline value', amount: '430', basis: 'equity_value' }),
        out({ key: 'capex', label: 'Capex', amount: '12500', unitScale: 1000 }),
        out({ key: 'debt', label: 'Debt', amount: '8', currency: 'USD' }),
      ],
    });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    v2 = b.body.id;
  });

  it('a version mixing EV and equity value is flagged (a consistency check, not a valuation)', async () => {
    const v = (await p.finance.get(`${P(projectId)}/financial-models/${modelId}/versions/${v1}`).expect(200)).body;
    expect(v.findingsI18n.map((f: { code: string }) => f.code)).toEqual(['finance.value.ev_equity_mix']);
    expect(v.findings[0]).toMatch(/not a professional valuation/);
  });

  it('comparing EV with equity, units with thousands, SAR with USD produces no difference — each is reported', async () => {
    const r = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions/${v1}/check`, { compareToVersionId: v2 });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const rows = Object.fromEntries(r.body.comparison.rows.map((x: { key: string; status: string; difference: string | null }) => [x.key, [x.status, x.difference]]));
    expect(rows).toEqual({ headline: ['basis_mismatch', null], equity: ['missing', null], capex: ['unit_mismatch', null], debt: ['currency_without_basis', null] });
    const withRate = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions/${v1}/check`, { compareToVersionId: v2, conversions: [RATE] });
    const debt = withRate.body.comparison.rows.find((x: { key: string }) => x.key === 'debt');
    expect(debt).toMatchObject({ status: 'compared', difference: '0.0000' });
    expect(debt.notesI18n[0]).toMatchObject({ code: 'finance.compare.converted', params: { source: RATE.source } });
  });

  it('a valuation version must state its headline basis; a money output needs currency and unit', async () => {
    const noBasis = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'downside', versionLabel: 'd1', sourceRef: 'x', outputs: [out({ key: 'h', label: 'H', amount: '1' })] });
    expect(noBasis.status).toBe(400);
    expect(noBasis.body.code).toBe('finance.model.headline_basis_required');
    const noUnit = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'downside', versionLabel: 'd1', headlineBasis: 'equity_value', sourceRef: 'x', outputs: [{ key: 'h', label: 'H', amount: '1', basis: 'equity_value', currency: 'SAR' }] });
    expect(noUnit.status).toBe(400);
    expect(noUnit.body.code).toBe('finance.output.money_unit_required');
    expect((await owner().query(`select count(*)::int n from financial_model_version where model_id = $1 and model_case = 'downside'`, [modelId])).rows[0].n).toBe(0);
  });
});

describe('REQ-FIN-001 — figures need currency, unit and period', () => {
  it('UT: snapshot without currency/unit/period rejected', async () => {
    const base = { kind: 'forecast', category: 'opex', lineRef: lineRef(), label: 'x', period: '2026-Q4', amount: sar('1'), sourceRef: 'Synthetic source' };
    for (const body of [
      { ...base, amount: { amount: '1', unitScale: 1 } },
      { ...base, amount: { amount: '1', currency: 'SAR' } },
      { ...base, amount: { amount: '1', currency: 'SAR', unitScale: 10 } },
      { ...base, period: undefined },
      { ...base, amount: { amount: '1.5e3', currency: 'SAR', unitScale: 1 } },
    ]) {
      const r = await p.finance.post(`${P(projectId)}/financial-snapshots`, body);
      expect(r.status, JSON.stringify(body)).toBe(400);
    }
    const badPeriod = await p.finance.post(`${P(projectId)}/financial-snapshots`, { ...base, period: 'Q4-2026' });
    expect(badPeriod.status).toBe(400);
    expect(badPeriod.body.code).toBe('finance.period.invalid');
    const noSource = await p.finance.post(`${P(projectId)}/financial-snapshots`, { ...base, sourceRef: undefined });
    expect(noSource.status).toBe(400);
    expect(noSource.body.code).toBe('finance.source.required');
    expect((await owner().query(`select count(*)::int n from financial_snapshot where line_ref = $1`, [base.lineRef])).rows[0].n).toBe(0);
  });
});
