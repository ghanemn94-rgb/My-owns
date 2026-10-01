import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { decisionOfType as decisionWith } from '../finance/finance-kit';
import { P, approveTabledDecision, completePlan, decisionOfType, drainWorker, insertSite, plan, plusDays, setupGovernance, setupProject, Gov, Personas } from './readiness-kit';

/**
 * P2 domain final review DOM-P2F-09 (docs/reviews/P2-domain-final-review.md; P3 scope, REQ-TSA-001, REQ-TSA-005,
 * REQ-RDY-004, REQ-GOV-022): the readiness module relies on governance decisions through the shared mechanism
 * (docs/architecture/module-guide.md, "Relying on a governance decision") — decision-use registry kinds `tsa_service` (terms
 * approval), `tsa_extension` (each recorded extension) and `cutover_plan` (the GO of a plan), the row lock, and the re-check
 * of the external approval's evidence. All data is synthetic.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

const uses = async (decisionId: string) =>
  (await owner().query<{ use_kind: string; subject_type: string; subject_id: string }>(`select use_kind, subject_type, subject_id from decision_use where decision_id = $1 order by used_at, id`, [decisionId])).rows;
const tsa = async (id: string) => (await p.pm.get(`${P(projectId)}/tsa-services/${id}`).expect(200)).body as Record<string, any>;
const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);

/** A TSA with the §7.3 essentials, in negotiation, ready for approval. */
async function negotiatedTsa(name: string): Promise<{ id: string; version: number }> {
  const r = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: `${name} — scope (synthetic)`,
    startDate: plusDays(-30),
    endDate: plusDays(60),
    ownerUserId: p.approver.userId,
    replacementService: 'NewCo service (synthetic)',
    exitMilestones: [{ title: 'Replacement live (synthetic)' }],
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const neg = await cmd(r.body.id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
  expect(neg.status, JSON.stringify(neg.body)).toBe(201);
  return { id: r.body.id as string, version: neg.body.version as number };
}

/** Approved on `decisionId` and activated; returns the current version. */
async function activeTsa(name: string, decisionId: string) {
  const t = await negotiatedTsa(name);
  const a = await cmd(t.id, 'approve', { expectedVersion: t.version, decisionId });
  expect(a.status, JSON.stringify(a.body)).toBe(201);
  const act = await cmd(t.id, 'transition', { expectedVersion: a.body.version, command: 'activate' });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  return { id: t.id, version: act.body.version as number };
}

/** Legal rejects, as defective, the verified evidence of the decision's external approval (documents module). */
async function rejectDecisionEvidence(decisionId: string) {
  const links = (await p.pm.get(`${P(projectId)}/evidence?targetType=decision&targetId=${decisionId}`).expect(200)).body.items as { id: string; status: string; version: number; reviewedBy: string | null }[];
  const active = links.filter((l) => l.status === 'active' && l.reviewedBy);
  expect(active).toHaveLength(1);
  const rej = await p.legal.post(`${P(projectId)}/evidence/${active[0]!.id}/verify`, { expectedVersion: active[0]!.version, decision: 'reject', note: 'Board resolution found defective (synthetic)' });
  expect(rej.status, JSON.stringify(rej.body)).toBe(201);
}

/** A complete plan on its own site, the go decision linked, submitted by the PM: ready for the sponsor's go/no-go. */
async function submittedPlan(code: string, goDecisionId: string) {
  const id = await completePlan(p.pm, projectId, { siteId: await insertSite(projectId, code), accountableUserId: p.pm.userId, title: `Transition ${code} (synthetic)` });
  const link = await p.pm.post(`${P(projectId)}/cutover-plans/${id}/go-decision`, { expectedVersion: (await plan(p.pm, projectId, id)).version, decisionId: goDecisionId });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${id}/submit-for-decision`, { expectedVersion: link.body.version, note: 'Ready (synthetic)' });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return { id, version: sub.body.version as number };
}
const go = (planId: string, expectedVersion: number) => p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion, outcome: 'go', rationale: 'GO on the linked decision (synthetic)' });

beforeAll(async () => {
  ({ projectId, p } = await setupProject('RD-P2F'));
  gov = await setupGovernance(projectId, p);
}, 600_000);
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

describe('DOM-P2F-09 — TSA terms approval and extensions rely on the decision-use registry [REQ-TSA-001, REQ-TSA-005, REQ-GOV-022]', () => {
  it('one decision approves the terms of one TSA (registry kind tsa_service); another TSA needs its own', async () => {
    const d = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    const a = await negotiatedTsa('Registry TSA A (synthetic)');
    const b = await negotiatedTsa('Registry TSA B (synthetic)');
    const okA = await cmd(a.id, 'approve', { expectedVersion: a.version, decisionId: d });
    expect(okA.status, JSON.stringify(okA.body)).toBe(201);
    expect(await uses(d)).toEqual([{ use_kind: 'tsa_service', subject_type: 'tsa_service', subject_id: a.id }]);
    const reuse = await cmd(b.id, 'approve', { expectedVersion: b.version, decisionId: d });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(422);
    expect(reuse.body.code).toBe('tsa.approve.decision_already_used');
    expect(reuse.body.details).toMatchObject({ decisionId: d, usedBySubjectId: a.id });
    expect((await tsa(b.id)).status).toBe('negotiating');
    const d2 = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    expect((await cmd(b.id, 'approve', { expectedVersion: b.version, decisionId: d2 })).status).toBe(201);
  });

  it('an external approval whose evidence was rejected approves no TSA (tsa.approve.decision_evidence_invalid)', async () => {
    // Above the DEMO committee limit (2 000 000 SAR, synthetic): the committee recommends, the authorized body approves.
    const d = await decisionWith(projectId, p, gov, 'tsa_approval_or_extension', { externalApproval: true, amount: { amount: '2500000.0000', currency: 'SAR', unitScale: 1 } });
    expect(d.status).toBe('approved');
    await rejectDecisionEvidence(d.id);
    const t = await negotiatedTsa('Evidence TSA (synthetic)');
    const r = await cmd(t.id, 'approve', { expectedVersion: t.version, decisionId: d.id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('tsa.approve.decision_evidence_invalid');
    expect((await tsa(t.id)).status).toBe('negotiating');
    expect(await uses(d.id)).toEqual([]);
  });

  // Implementer (DOM-P34R2-01): the last part asserted the former rule 6 ("the terms decision may authorize one extension").
  // Rule 6 as amended (business-gates.md §6 rules 5–6): a decision that already has an outcome binds no extension terms, so
  // the decision that approved Y's terms authorizes no extension. Renamed accordingly; the extension paper of X is now
  // tabled, requested on and then approved (the real flow); the registry assertions are unchanged.
  it('one decision authorizes one extension (kind tsa_extension): not a second TSA, not a further extension; the terms decision, final before any extension was requested on it, authorizes none (DOM-P34R2-01)', async () => {
    const terms1 = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    const terms2 = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    const x = await activeTsa('Extension TSA X (synthetic)', terms1);
    const y = await activeTsa('Extension TSA Y (synthetic)', terms2);
    const paper = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    const e = paper.id;
    const reqX = await cmd(x.id, 'request-extension', { expectedVersion: x.version, decisionId: e, proposedEndDate: plusDays(120), continuityPlan: 'Current operator continues (synthetic)' });
    expect(reqX.status, JSON.stringify(reqX.body)).toBe(201);
    await approveTabledDecision(projectId, p, paper);
    const recX = await cmd(x.id, 'record-extension', { expectedVersion: reqX.body.version, note: 'Extension per approved decision (synthetic)' });
    expect(recX.status, JSON.stringify(recX.body)).toBe(201);
    expect(await uses(e)).toEqual([{ use_kind: 'tsa_extension', subject_type: 'tsa_service', subject_id: x.id }]);
    // The same decision for another TSA's extension, or for a further extension of X: refused at the request.
    const onY = await cmd(y.id, 'request-extension', { expectedVersion: y.version, decisionId: e, proposedEndDate: plusDays(120), continuityPlan: 'x (synthetic)' });
    expect(onY.status, JSON.stringify(onY.body)).toBe(422);
    expect(onY.body.code).toBe('tsa.extension.decision_already_used');
    const again = await cmd(x.id, 'request-extension', { expectedVersion: recX.body.version, decisionId: e, proposedEndDate: plusDays(200), continuityPlan: 'x (synthetic)' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('tsa.extension.decision_already_used');
    // The decision that approved Y's terms was final before any extension was requested on it: it authorizes none.
    const reqY = await cmd(y.id, 'request-extension', { expectedVersion: y.version, decisionId: terms2, proposedEndDate: plusDays(150), continuityPlan: 'Current operator continues (synthetic)' });
    expect(reqY.status, JSON.stringify(reqY.body)).toBe(422);
    expect(reqY.body.code).toBe('tsa.extension.terms_after_outcome');
    expect((await uses(terms2)).map((u) => [u.use_kind, u.subject_id])).toEqual([['tsa_service', y.id]]);
  });
});

describe('DOM-P2F-09 — the GO of a cutover plan consumes its go/no-go decision (kind cutover_plan) [REQ-RDY-004, REQ-GOV-022]', () => {
  it('one decision authorizes the GO of one plan: refused when linked to another plan, and at the GO of a plan linked before (recorded in its history)', async () => {
    const g = (await decisionOfType(projectId, p, gov, 'day1_go_no_go')).id;
    const a = await submittedPlan('S-P2F-A', g);
    const c = await submittedPlan('S-P2F-C', g); // linked while g backs nothing yet
    const okA = await go(a.id, a.version);
    expect(okA.status, JSON.stringify(okA.body)).toBe(201);
    expect(await uses(g)).toEqual([{ use_kind: 'cutover_plan', subject_type: 'cutover_plan', subject_id: a.id }]);
    // Plan C: the GO on the decision already used is refused and kept in the plan's decision history (AT-09 pattern).
    expect((await plan(p.pm, projectId, c.id)).goEvaluation.missing).toEqual(['approved go/no-go decision']);
    const onC = await go(c.id, c.version);
    expect(onC.status, JSON.stringify(onC.body)).toBe(422);
    expect(onC.body.code).toBe('readiness.go_no_go.decision_already_used');
    const cv = await plan(p.pm, projectId, c.id);
    expect(cv.status).toBe('ready_for_decision');
    expect(cv.decisionHistory.at(-1)).toMatchObject({ kind: 'go_blocked', goDecisionId: g });
    // A further plan cannot even link it.
    const bId = await completePlan(p.pm, projectId, { siteId: await insertSite(projectId, 'S-P2F-B'), accountableUserId: p.pm.userId });
    const link = await p.pm.post(`${P(projectId)}/cutover-plans/${bId}/go-decision`, { expectedVersion: (await plan(p.pm, projectId, bId)).version, decisionId: g });
    expect(link.status).toBe(422);
    expect(link.body.code).toBe('readiness.go_no_go.decision_already_used');
  });

  it('after a rollback, a new GO of the same plan needs a new decision', async () => {
    const g = (await decisionOfType(projectId, p, gov, 'day1_go_no_go')).id;
    const r = await submittedPlan('S-P2F-R', g);
    const first = await go(r.id, r.version);
    expect(first.status, JSON.stringify(first.body)).toBe(201);
    const rb = await p.pm.post(`${P(projectId)}/cutover-plans/${r.id}/rollback`, { expectedVersion: first.body.version, note: 'Contingency invoked (synthetic)' });
    expect(rb.status, JSON.stringify(rb.body)).toBe(201);
    const back = await p.pm.post(`${P(projectId)}/cutover-plans/${r.id}/return-to-planning`, { expectedVersion: rb.body.version, note: 'Re-plan after rollback (synthetic)' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${r.id}/submit-for-decision`, { expectedVersion: back.body.version, note: 'Resubmitted (synthetic)' });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const again = await go(r.id, sub.body.version);
    expect(again.status, JSON.stringify(again.body)).toBe(422);
    expect(again.body.code).toBe('readiness.go_no_go.decision_already_used');
    const g2 = (await decisionOfType(projectId, p, gov, 'day1_go_no_go')).id;
    const link = await p.pm.post(`${P(projectId)}/cutover-plans/${r.id}/go-decision`, { expectedVersion: (await plan(p.pm, projectId, r.id)).version, decisionId: g2 });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const second = await go(r.id, link.body.version);
    expect(second.status, JSON.stringify(second.body)).toBe(201);
    expect((await uses(g2)).map((u) => u.subject_id)).toEqual([r.id]);
  });
});
