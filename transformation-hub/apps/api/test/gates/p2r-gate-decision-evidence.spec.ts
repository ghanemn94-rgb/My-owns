import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, setupGovernance, gateByKey, gateDecision, makeReady, reviewGate, markReady, startGate, Personas, Gov } from './gate-test-kit';

/**
 * P2 domain re-review fixes on gate decisions (docs/reviews/P2-domain-rereview.md, docs/reviews/P2-qa-review.md):
 *  - DOM-P2R-04 — a decision approved by the external authority backs a gate only while the evidence of that approval is an
 *    active, verified evidence link (blocker shown on the gate; decide refused with `gates.decide.decision_evidence_invalid`);
 *  - O-1 (QA) — a decision linked to a REJECTED cycle cannot back a later cycle of the gate (proposed, pending the governance
 *    owner): `gates.decide.decision_reused`.
 * G0 (owner secretary, reviewer PM, approver sponsor; reserved decision type → recommendation → external approval).
 */
let pid: string;
let p: Personas;
let gov: Gov;
const url = (gateId: string, cmd: string) => `/api/v1/projects/${pid}/gates/${gateId}/assessment/${cmd}`;

beforeAll(async () => {
  ({ projectId: pid, p } = await setupProject('P2R-GATE'));
  gov = await setupGovernance(pid, p);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

const rejectDecisionEvidence = async (decisionId: string) => {
  const linkId = (await owner().query(`select external_evidence_link_id from decision where id = $1`, [decisionId])).rows[0].external_evidence_link_id as string;
  const l = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0];
  const r = await p.finance.post(`/api/v1/projects/${pid}/evidence/${linkId}/verify`, { expectedVersion: l.version, decision: 'reject', note: 'Defective record of the external approval (synthetic)' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
};

describe('O-1 / DOM-P2R-04 — gate decisions [REQ-LCY-010, REQ-LCY-015, REQ-GOV-022, AT-04]', () => {
  it('O-1: a decision linked to a rejected cycle cannot approve the reopened cycle (422 decision_reused); a fresh one can', async () => {
    await makeReady(p, pid, 'G0');
    const d1 = await gateDecision(pid, p, gov, 'G0', { externalApproval: true });
    expect(d1.status).toBe('approved');
    let g0 = await gateByKey(p.pm, pid, 'G0');
    const rejected = await p.sponsor.post(url(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'reject', decisionId: d1.id, note: 'Rejected: the mandate evidence is not sufficient (synthetic)' });
    expect(rejected.status, JSON.stringify(rejected.body)).toBe(201);
    g0 = await gateByKey(p.pm, pid, 'G0');
    expect(g0.assessment).toMatchObject({ status: 'rejected', decisionId: d1.id });
    // Decision-use registry: the rejected cycle is recorded as relying on d1 (kind gate_cycle).
    const cycle1 = (await owner().query(`select id from gate_assessment where project_id = $1 and decision_id = $2 and status = 'rejected'`, [pid, d1.id])).rows[0].id as string;
    expect((await owner().query(`select use_kind, subject_type, subject_id from decision_use where decision_id = $1`, [d1.id])).rows).toEqual([
      { use_kind: 'gate_cycle', subject_type: 'gate_assessment', subject_id: cycle1 },
    ]);
    const re = await p.chair.post(url(g0.id, 'reopen'), { expectedVersion: g0.assessment.version, reason: 'Re-assess after the rejection (synthetic)' });
    expect(re.status, JSON.stringify(re.body)).toBe(201);
    await startGate(p, pid, 'G0');
    if ((await gateByKey(p.pm, pid, 'G0')).review.state !== 'endorsed') await reviewGate(p, pid, 'G0');
    await markReady(p, pid, 'G0');
    g0 = await gateByKey(p.pm, pid, 'G0');
    const reused = await p.sponsor.post(url(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d1.id, note: 'Approve on the earlier decision (probe)' });
    expect(reused.status, JSON.stringify(reused.body)).toBe(422);
    expect(reused.body.code).toBe('gates.decide.decision_reused');
  });

  it('DOM-P2R-04: rejected evidence of the external approval → blocker on the gate and decide refused; a decision with standing evidence approves', async () => {
    const d2 = await gateDecision(pid, p, gov, 'G0', { externalApproval: true });
    let g0 = await gateByKey(p.pm, pid, 'G0');
    const linked = await p.secretary.post(url(g0.id, 'link-decision'), { expectedVersion: g0.assessment.version, decisionId: d2.id });
    expect(linked.status, JSON.stringify(linked.body)).toBe(201);
    await rejectDecisionEvidence(d2.id);
    g0 = await gateByKey(p.pm, pid, 'G0');
    const blocker = g0.blockers.find((b) => b.kind === 'decision') as { message: string; messageI18n: { code: string; params: Record<string, string> }[] } | undefined;
    expect(blocker?.messageI18n[0]).toEqual({ code: 'gate.blocker.decision_external_evidence_invalid', params: { status: 'rejected' } });
    expect(g0.rag).not.toBe('green');
    const refused = await p.sponsor.post(url(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d2.id, note: 'Probe (synthetic)' });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('gates.decide.decision_evidence_invalid');
    expect((await gateByKey(p.pm, pid, 'G0')).assessment.status).toBe('ready_for_decision');
    // The recorded decision itself is never changed by the evidence rejection.
    expect((await owner().query(`select status from decision where id = $1`, [d2.id])).rows[0].status).toBe('approved');
    const d3 = await gateDecision(pid, p, gov, 'G0', { externalApproval: true });
    g0 = await gateByKey(p.pm, pid, 'G0');
    const ok = await p.sponsor.post(url(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d3.id, note: 'Approved on a decision with standing evidence (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const snap = (await owner().query(`select evaluation from gate_assessment where id = $1`, [g0.assessment.id])).rows[0].evaluation as { atDecision: { decision: { externalEvidenceLinkId: string } } };
    expect(snap.atDecision.decision.externalEvidenceLinkId).toBeTruthy();
  });
});
