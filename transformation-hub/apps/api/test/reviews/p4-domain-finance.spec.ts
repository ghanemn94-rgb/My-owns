import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { P, decisionOfType, sar, setupFinance, setupGovernance, Gov, Personas } from '../finance/finance-kit';

/**
 * P4 DOMAIN REVIEW — finance defect probes (docs/reviews/P4-domain-review.md).
 *
 * Each `DEFECT DOM-P4-nn` probe asserts the behaviour REQUIRED by the specification or by the platform's own governance
 * rules. At the reviewed revision the required assertion FAILS (that failure is the reproduction). The probes are declared
 * with `it.fails` so the suite stays green while the defect is open; once fixed, the probe fails and must be turned into a
 * plain `it` (never weakened). Run with `P4_PROBE_PLAIN=1` to execute them as plain tests and see the failing assertion.
 * Setup runs in plain `it` steps; the probe bodies contain no throwing helper, only the required assertion.
 *
 * All data is synthetic (a demo-flagged project created by the test through the API).
 *
 * Fixed findings: DOM-P4-06 (one valuation decision approves the values of one model version — decision-use registry kind
 * `financial_model_version`) and DOM-P4-07 (one budget decision backs one budget line, within its stated amount — kind
 * `budget_line`) are plain regression tests (`… (fixed, regression)`), with their assertions unchanged; no open probe
 * remains in this file (so `P4_PROBE_PLAIN` no longer changes anything here).
 */

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('DRP4-FIN'));
  gov = await setupGovernance(projectId, p);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P4 domain review — finance defect probes [docs/reviews/P4-domain-review.md]', () => {
  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-06: the valuation decision that approved version 1 approves the different values of version 2.
  let modelId: string;
  let v2: { id: string; version: number };
  let decisionV: string;
  const vpath = (vid: string) => `${P(projectId)}/financial-models/${modelId}/versions/${vid}`;

  it('setup DOM-P4-06: valuation v1 values approved on decision V; v2 (different outputs) validated', async () => {
    const m = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'valuation', name: 'P4 probe valuation (synthetic)' });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    modelId = m.body.id;
    const out = (ev: string) => [{ key: 'ev', label: 'Enterprise value', amount: ev, currency: 'SAR', unitScale: 1000000, basis: 'enterprise_value' }];
    const a = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'base', versionLabel: 'Probe v1', headlineBasis: 'enterprise_value', sourceRef: 'Adviser output v1 (synthetic)', outputs: out('500') });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const v1 = a.body.id as string;
    let cur = (await p.finance.get(vpath(v1)).expect(200)).body;
    const val1 = await p.approver.post(`${vpath(v1)}/validate`, { expectedVersion: cur.version, note: 'Validated v1 (synthetic)' });
    expect(val1.status, JSON.stringify(val1.body)).toBe(201);
    const d = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    expect(d.status).toBe('approved');
    decisionV = d.id;
    const ok1 = await p.legal.post(`${vpath(v1)}/approve-values`, { expectedVersion: val1.body.version, decisionId: decisionV, note: 'Values of v1 (synthetic)' });
    expect(ok1.status, JSON.stringify(ok1.body)).toBe(201);
    const b = await p.finance.post(`${P(projectId)}/financial-models/${modelId}/versions`, { modelCase: 'base', versionLabel: 'Probe v2', headlineBasis: 'enterprise_value', sourceRef: 'Adviser output v2 (synthetic)', outputs: out('900') });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    cur = (await p.finance.get(vpath(b.body.id)).expect(200)).body;
    const val2 = await p.approver.post(`${vpath(b.body.id)}/validate`, { expectedVersion: cur.version, note: 'Validated v2 (synthetic)' });
    expect(val2.status, JSON.stringify(val2.body)).toBe(201);
    v2 = { id: b.body.id, version: val2.body.version };
  });

  it('DOM-P4-06: the decision that approved the values of v1 cannot record different values of v2 as approved (REQ-FIN-006; P2 rule: a decision backs one approval only) (fixed, regression)', async () => {
    const r = await p.legal.post(`${vpath(v2.id)}/approve-values`, { expectedVersion: v2.version, decisionId: decisionV, note: 'Reuse attempt (synthetic)' });
    const cur = (await p.finance.get(vpath(v2.id))).body as { approvedValues?: unknown };
    expect(cur.approvedValues ?? null, `v2 (EV 900 SAR m) recorded as approved on the decision that approved v1 (EV 500 SAR m) — status ${r.status}`).toBeNull();
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-07: one budget decision (paper amount 100 000 SAR) is recorded as the full approved budget of two lines.
  let lineB: { id: string; version: number };
  let decisionB: string;

  it('setup DOM-P4-07: line A carries the full amount of decision B (100 000 SAR); line B exists without approval', async () => {
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget'); // DEMO paper amount: 100 000 SAR (synthetic)
    expect(d.status).toBe('approved');
    decisionB = d.id;
    const a = await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'Probe line A (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1 });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const recA = await p.finance.post(`${P(projectId)}/budget-lines/${a.body.id}/record-approval`, { expectedVersion: a.body.version, decisionId: decisionB, approvedAmount: sar('100000') });
    expect(recA.status, JSON.stringify(recA.body)).toBe(201);
    const b = await p.finance.post(`${P(projectId)}/budget-lines`, { name: 'Probe line B (synthetic)', category: 'one_off_separation', currency: 'SAR', unitScale: 1 });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    lineB = { id: b.body.id, version: b.body.version };
  });

  it('DOM-P4-07: approvals recorded from one decision never exceed its amount in total (REQ-FIN-003; spec §4 delegated authority) (fixed, regression)', async () => {
    const r = await p.finance.post(`${P(projectId)}/budget-lines/${lineB.id}/record-approval`, { expectedVersion: lineB.version, decisionId: decisionB, approvedAmount: sar('100000') });
    const cur = (await p.finance.get(`${P(projectId)}/budget-lines/${lineB.id}`)).body as { approved?: unknown };
    expect(cur.approved ?? null, `line B approved 100 000 SAR on a 100 000 SAR decision already fully recorded on line A (status ${r.status})`).toBeNull();
  });
});
