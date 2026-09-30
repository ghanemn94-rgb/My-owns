import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, auditRows, createSnapshot, decisionOfType, orgOf, sar, setupFinance, setupGovernance, Gov, Personas } from './finance-kit';

/**
 * P4 domain review, part 2 (docs/reviews/P4-domain-review.md) — finance side, through the API on a synthetic demo-flagged
 * project:
 *  - DOM-P4-06 [REQ-FIN-006]: one `valuation_and_ownership_terms` decision approves the values of ONE model version
 *    (decision-use registry, kind `financial_model_version`).
 *  - DOM-P4-07 [REQ-FIN-003]: one budget decision backs ONE budget line (kind `budget_line`), within the amount it STATES —
 *    a decision without a stated amount backs no (non-zero) approval; a concurrent approval on the same decision is 409.
 *  - DOM-P4-08 [REQ-FIN-006, REQ-FIN-003, REQ-FIN-004]: an external approval whose evidence was rejected no longer backs
 *    approved valuation values, a budget approval or an opening balance.
 * All data is synthetic (amounts are test values, not Mobily figures).
 */
let projectId: string;
let orgId: string;
let p: Personas;
let gov: Gov;

const uses = async (decisionId: string) =>
  (await owner().query<{ use_kind: string; subject_type: string; subject_id: string }>(`select use_kind, subject_type, subject_id from decision_use where decision_id = $1 order by used_at, id`, [decisionId])).rows;
const line = async (name: string) => {
  const r = await p.finance.post(`${P(projectId)}/budget-lines`, { name, category: 'one_off_separation', currency: 'SAR', unitScale: 1 });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: r.body.id as string, version: r.body.version as number };
};
const approvedOf = async (id: string) => ((await p.finance.get(`${P(projectId)}/budget-lines/${id}`).expect(200)).body as { approved: unknown }).approved ?? null;

/** Legal rejects, as defective, the verified evidence of the decision's external approval (documents module). */
async function rejectDecisionEvidence(decisionId: string) {
  const links = (await p.pm.get(`${P(projectId)}/evidence?targetType=decision&targetId=${decisionId}`).expect(200)).body.items as { id: string; status: string; version: number; reviewedBy: string | null }[];
  const active = links.filter((l) => l.status === 'active' && l.reviewedBy);
  expect(active).toHaveLength(1);
  const rej = await p.legal.post(`${P(projectId)}/evidence/${active[0]!.id}/verify`, { expectedVersion: active[0]!.version, decision: 'reject', note: 'Board resolution found defective (synthetic)' });
  expect(rej.status, JSON.stringify(rej.body)).toBe(201);
  expect(rej.body.status).toBe('rejected');
}

/** A validated version of a new valuation model (EV in SAR millions, synthetic). */
async function validatedVersion(ev: string) {
  const m = await p.finance.post(`${P(projectId)}/financial-models`, { kind: 'valuation', name: `Reliance valuation ${ev} (synthetic)` });
  expect(m.status, JSON.stringify(m.body)).toBe(201);
  const out = [{ key: 'ev', label: 'Enterprise value', amount: ev, currency: 'SAR', unitScale: 1000000, basis: 'enterprise_value' }];
  const v = await p.finance.post(`${P(projectId)}/financial-models/${m.body.id}/versions`, { modelCase: 'base', versionLabel: 'v1', headlineBasis: 'enterprise_value', sourceRef: 'Adviser output (synthetic)', outputs: out });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  const path = `${P(projectId)}/financial-models/${m.body.id}/versions/${v.body.id}`;
  const cur = (await p.finance.get(path).expect(200)).body;
  const val = await p.approver.post(`${path}/validate`, { expectedVersion: cur.version, note: 'Validated (synthetic)' });
  expect(val.status, JSON.stringify(val.body)).toBe(201);
  return { id: v.body.id as string, path, version: val.body.version as number };
}

/** See apps/api/test/jv/p4-decision-reliance.spec.ts: the organization's audit-chain lock makes both commands pass their unlocked checks first. */
async function race(calls: (() => PromiseLike<{ status: number; body: Record<string, any> }>)[]) {
  const locker = await owner().connect();
  try {
    await locker.query('begin');
    await locker.query(`select pg_advisory_xact_lock(hashtextextended('hub_audit:' || $1::text, 0))`, [orgId]);
    const pending = calls.map((c) => Promise.resolve(c()).then((r) => r));
    let waiting = 0;
    for (let i = 0; i < 150 && waiting < calls.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      waiting = (await owner().query<{ n: number }>(`select count(*)::int n from pg_locks where not granted`)).rows[0]!.n;
    }
    await locker.query('commit');
    return { results: await Promise.all(pending), waiting };
  } finally {
    locker.release();
  }
}

beforeAll(async () => {
  ({ projectId, p } = await setupFinance('FIN-P4REL'));
  gov = await setupGovernance(projectId, p);
  orgId = await orgOf(projectId);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P4-06 — one valuation decision approves the values of one model version [REQ-FIN-006]', () => {
  it('the decision that approved one version is refused (audited) for another; the registry records the one version; a fresh decision approves', async () => {
    const v1 = await validatedVersion('500');
    const v2 = await validatedVersion('900');
    const d = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    expect(d.status).toBe('approved');
    const ok1 = await p.legal.post(`${v1.path}/approve-values`, { expectedVersion: v1.version, decisionId: d.id, note: 'Values of v1 (synthetic)' });
    expect(ok1.status, JSON.stringify(ok1.body)).toBe(201);
    expect(await uses(d.id)).toEqual([{ use_kind: 'financial_model_version', subject_type: 'financial_model_version', subject_id: v1.id }]);
    const reuse = await p.legal.post(`${v2.path}/approve-values`, { expectedVersion: v2.version, decisionId: d.id, note: 'Reuse attempt (synthetic)' });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(422);
    expect(reuse.body.code).toBe('finance.model.decision_already_used');
    expect(reuse.body.details).toMatchObject({ decisionId: d.id, usedBySubjectId: v1.id });
    expect((await p.finance.get(v2.path).expect(200)).body.approvedValues).toBeNull();
    // The refusal is audited (problem filter, route id).
    expect((await auditRows(projectId, 'finance.approveModelValues', 'rejected', p.legal.userId)).length).toBeGreaterThanOrEqual(1);
    const d2 = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    const ok2 = await p.legal.post(`${v2.path}/approve-values`, { expectedVersion: v2.version, decisionId: d2.id, note: 'Values of v2 on their own decision (synthetic)' });
    expect(ok2.status, JSON.stringify(ok2.body)).toBe(201);
    expect((await p.finance.get(v2.path).expect(200)).body.approvedValues).not.toBeNull();
  });
});

describe('DOM-P4-07 — one budget decision backs one budget line, within the amount it states [REQ-FIN-003]', () => {
  it('a decision recorded on line A backs no other line (even for a smaller amount); the registry records line A', async () => {
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget'); // DEMO paper amount: 100 000 SAR (synthetic)
    const a = await line('Reliance line A (synthetic)');
    const b = await line('Reliance line B (synthetic)');
    const okA = await p.finance.post(`${P(projectId)}/budget-lines/${a.id}/record-approval`, { expectedVersion: a.version, decisionId: d.id, approvedAmount: sar('60000') });
    expect(okA.status, JSON.stringify(okA.body)).toBe(201);
    expect(await uses(d.id)).toEqual([{ use_kind: 'budget_line', subject_type: 'budget_line', subject_id: a.id }]);
    const reuse = await p.finance.post(`${P(projectId)}/budget-lines/${b.id}/record-approval`, { expectedVersion: b.version, decisionId: d.id, approvedAmount: sar('40000') });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(422);
    expect(reuse.body.code).toBe('finance.budget.decision_already_used');
    expect(await approvedOf(b.id)).toBeNull();
    // Re-recording the same decision on line A is a change without a new decision.
    const again = await p.finance.post(`${P(projectId)}/budget-lines/${a.id}/record-approval`, { expectedVersion: okA.body.version, decisionId: d.id, approvedAmount: sar('50000') });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('finance.budget.decision_already_recorded');
  });

  it('a decision that states no amount sets no limit, so it backs no (non-zero) approved budget — fail closed', async () => {
    // Without an amount the committee cannot decide within its limit (it only recommends); the authorized body approves a
    // paper that states no amount.
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget', { amount: null, externalApproval: true });
    expect(d.status).toBe('approved');
    const c = await line('Reliance line C (synthetic)');
    const r = await p.finance.post(`${P(projectId)}/budget-lines/${c.id}/record-approval`, { expectedVersion: c.version, decisionId: d.id, approvedAmount: sar('50000') });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('finance.budget.decision_amount_missing');
    expect(await approvedOf(c.id)).toBeNull();
    expect(await uses(d.id)).toEqual([]);
  });

  it('two approvals on ONE decision at the same time: exactly one line is approved, the other is 409', async () => {
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget');
    const e = await line('Race line E (synthetic)');
    const f = await line('Race line F (synthetic)');
    const { results, waiting } = await race([
      () => p.finance.post(`${P(projectId)}/budget-lines/${e.id}/record-approval`, { expectedVersion: e.version, decisionId: d.id, approvedAmount: sar('100000') }),
      () => p.finance.post(`${P(projectId)}/budget-lines/${f.id}/record-approval`, { expectedVersion: f.version, decisionId: d.id, approvedAmount: sar('100000') }),
    ]);
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('finance.budget.decision_already_used');
    const approved = [await approvedOf(e.id), await approvedOf(f.id)].filter((x) => x !== null);
    expect(approved).toEqual([sar('100000.0000')]);
    expect(await uses(d.id)).toHaveLength(1);
  });
});

describe('DOM-P4-08 — an external approval whose evidence was rejected backs no finance approval [REQ-FIN-006, REQ-FIN-003, REQ-FIN-004]', () => {
  it('approved valuation values', async () => {
    const v = await validatedVersion('700');
    const d = await decisionOfType(projectId, p, gov, 'valuation_and_ownership_terms', { externalApproval: true });
    await rejectDecisionEvidence(d.id);
    const r = await p.legal.post(`${v.path}/approve-values`, { expectedVersion: v.version, decisionId: d.id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('finance.model.decision_evidence_invalid');
    expect(r.body.details).toMatchObject({ decisionId: d.id, evidence: 'not_active', evidenceStatus: 'rejected' });
    expect((await p.finance.get(v.path).expect(200)).body.approvedValues).toBeNull();
    expect(await uses(d.id)).toEqual([]);
  });

  it('budget approval (a decision of the authorized body above the committee limit)', async () => {
    const d = await decisionOfType(projectId, p, gov, 'change_request_budget', { externalApproval: true, amount: sar('1500000') });
    expect(d.status).toBe('approved');
    await rejectDecisionEvidence(d.id);
    const g = await line('Evidence line G (synthetic)');
    const r = await p.finance.post(`${P(projectId)}/budget-lines/${g.id}/record-approval`, { expectedVersion: g.version, decisionId: d.id, approvedAmount: sar('1000') });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('finance.budget.decision_evidence_invalid');
    expect(await approvedOf(g.id)).toBeNull();
  });

  it('opening balance', async () => {
    const ob = (await createSnapshot(p.finance, projectId, { kind: 'baseline', category: 'opening_balance', amount: sar('5000'), label: 'Opening balance — payables (synthetic)' })).id;
    const v = await p.approver.post(`${P(projectId)}/financial-snapshots/${ob}/validate`, { expectedVersion: 1, note: 'Agreed to the synthetic trial balance' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    const d = await decisionOfType(projectId, p, gov, 'opening_balance_sheet', { externalApproval: true });
    await rejectDecisionEvidence(d.id);
    const r = await p.legal.post(`${P(projectId)}/financial-snapshots/${ob}/approve`, { expectedVersion: v.body.version, decisionId: d.id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('finance.approval.decision_evidence_invalid');
    expect((await owner().query(`select approval_state, approval_decision_id from financial_snapshot where id = $1`, [ob])).rows[0]).toEqual({ approval_state: 'under_review', approval_decision_id: null });
  });
});
