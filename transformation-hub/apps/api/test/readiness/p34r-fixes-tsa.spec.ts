import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { decisionVersion, paper, vote } from '../governance/gov-fixtures';
import { P, addEvidence, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, tsa, Gov, Personas } from './readiness-kit';

/**
 * DOM-P34R-04 (docs/reviews/P3-P4-domain-rereview.md; business-gates.md §6 rule 5): the extension terms are bound to the
 * DECISION — one TSA, one end date, one continuity plan per `tsa_approval_or_extension` decision (`tsa_extension_terms`) —
 * not to the TSA row's current link, so re-linking the request through another decision never releases them, and
 * `record-extension` applies only the terms the linked decision carries. Real API; synthetic data.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34RF-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);
const req = async (id: string, decisionId: string, proposedEndDate: string, continuityPlan = 'Keep the legacy service until the replacement is accepted (synthetic)') =>
  cmd(id, 'request-extension', { expectedVersion: (await tsa(p.pm, projectId, id)).version, decisionId, proposedEndDate, continuityPlan });
const record = async (id: string) => cmd(id, 'record-extension', { expectedVersion: (await tsa(p.pm, projectId, id)).version, note: 'Extension per the approved decision (test)' });
const termsOf = async (decisionId: string) => (await owner().query(`select tsa_service_id, proposed_end_date::text as end_date from tsa_extension_terms where decision_id = $1`, [decisionId])).rows;

/** A complete TSA, terms approved on its own FINAL decision, activated. */
async function activeTsa(name: string) {
  const c = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: 'Out-of-hours monitoring (synthetic)',
    startDate: plusDays(-60),
    endDate: plusDays(20),
    ownerUserId: p.approver.userId,
    replacementService: 'NewCo monitoring platform (synthetic)',
    exitMilestones: [{ title: 'Replacement accepted with evidence (synthetic)' }],
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.id as string;
  const neg = await cmd(id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
  const terms = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
  const ap = await cmd(id, 'approve', { expectedVersion: neg.body.version, decisionId: terms.id });
  expect(ap.status, JSON.stringify(ap.body)).toBe(201);
  const act = await cmd(id, 'transition', { expectedVersion: ap.body.version, command: 'activate' });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  return id;
}

/** A DRAFT `tsa_approval_or_extension` paper of the PM (not yet before the committee). */
async function draftDecision(): Promise<string> {
  const d = await p.pm.post(`${P(projectId)}/decisions`, paper(gov.committeeId, { decisionTypeKey: 'tsa_approval_or_extension', requiredAuthority: 'Per the DEMO authority matrix (synthetic)' }));
  expect(d.status, JSON.stringify(d.body)).toBe(201);
  expect((await p.pm.get(`${P(projectId)}/decisions/${d.body.id}`).expect(200)).body.status).toBe('draft');
  return d.body.id as string;
}

/** Submit a draft paper, table it and approve it (DEMO matrix, within mandate). */
async function approve(decisionId: string) {
  const d = (await p.pm.get(`${P(projectId)}/decisions/${decisionId}`).expect(200)).body;
  const s = await p.pm.post(`${P(projectId)}/decisions/${decisionId}/submit`, { expectedVersion: d.version });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  const r = await p.secretary.post(`${P(projectId)}/decisions/${decisionId}/start-review`, { expectedVersion: s.body.version, meetingId: gov.meetingId });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const v = await decisionVersion(p.chair, projectId, decisionId);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(projectId, p[k], decisionId, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(projectId)}/decisions/${decisionId}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  expect(out.body.status).toBe('approved');
}

describe('DOM-P34R-04 — the extension terms belong to the decision [AT-10, REQ-TSA-005, business-gates.md §6 rule 5]', () => {
  it('a draft decision\'s terms may change; once it left draft they are bound — a detour through another decision does not release them, and the TSA is extended only to the bound date', async () => {
    const id = await activeTsa('Monitoring bridge (synthetic)');
    const d = await draftDecision();
    const [X, Z, Y] = [plusDays(100), plusDays(120), plusDays(3650)];
    expect((await req(id, d, X)).status).toBe(201);
    expect((await req(id, d, Z)).status).toBe(201); // still a draft: the paper is not yet before the committee
    expect(await termsOf(d)).toEqual([{ tsa_service_id: id, end_date: Z }]);
    await approve(d);
    const direct = await req(id, d, Y);
    expect(direct.status, JSON.stringify(direct.body)).toBe(422);
    expect(direct.body.code).toBe('tsa.extension.terms_bound');
    // Detour: another paper (under review) with Y, then back to the approved decision with Y — still refused.
    const d2 = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false })).id;
    expect((await req(id, d2, Y)).status).toBe(201);
    const back = await req(id, d, Y);
    expect(back.status, JSON.stringify(back.body)).toBe(422);
    expect(back.body.code).toBe('tsa.extension.terms_bound');
    // The pending paper cannot be recorded; re-linking the approved decision with ITS terms records them.
    const pending = await record(id);
    expect(pending.status).toBe(422);
    expect(pending.body.code).toBe('tsa.extension_requires_decision');
    expect((await req(id, d, Z)).status).toBe(201);
    const ok = await record(id);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await tsa(p.pm, projectId, id)).toMatchObject({ status: 'extended', endDate: Z, extensionDecisionId: d });
    expect(await termsOf(d)).toEqual([{ tsa_service_id: id, end_date: Z }]);
  });

  it('a decision carries ONE TSA\'s extension: once it left draft another TSA is refused (422 tsa.extension.decision_other_tsa), and a TSA whose draft link was re-purposed cannot record (422 tsa.extension.terms_mismatch)', async () => {
    const a = await activeTsa('NOC service A (synthetic)');
    const b = await activeTsa('Facility service B (synthetic)');
    const d = await draftDecision();
    expect((await req(a, d, plusDays(90))).status).toBe(201);
    expect((await req(b, d, plusDays(95))).status).toBe(201); // draft: the paper is re-purposed for B
    expect(await termsOf(d)).toEqual([{ tsa_service_id: b, end_date: plusDays(95) }]);
    await approve(d);
    const other = await req(a, d, plusDays(90));
    expect(other.status, JSON.stringify(other.body)).toBe(422);
    expect(other.body.code).toBe('tsa.extension.decision_other_tsa');
    const recA = await record(a); // A still links D with its old request
    expect(recA.status, JSON.stringify(recA.body)).toBe(422);
    expect(recA.body.code).toBe('tsa.extension.terms_mismatch');
    expect((await tsa(p.pm, projectId, a)).endDate).toBe(plusDays(20));
    const recB = await record(b);
    expect(recB.status, JSON.stringify(recB.body)).toBe(201);
    expect((await tsa(p.pm, projectId, b)).endDate).toBe(plusDays(95));
  });
});

describe('DOM-P34R-06 — TSA replacement accepted on evidence that is later rejected (DOM-P3-09 residual) [AT-10, AT-14, REQ-TSA-006]', () => {
  it('the evidence reaction withdraws the replacement acceptance (audited, by the service identity); it is accepted again only on valid evidence', async () => {
    const id = await activeTsa('Ticketing bridge (synthetic)');
    const link = (await p.pm.post(`${P(projectId)}/evidence`, { targetType: 'tsa_service', targetId: id, note: 'Replacement acceptance test report (synthetic)' })).body as { id: string };
    expect(link.id).toBeTruthy();
    let t = await tsa(p.pm, projectId, id);
    const acc = await cmd(id, 'accept-replacement', { expectedVersion: t.version, note: 'Replacement accepted after a parallel run (synthetic)' });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    expect((await tsa(p.pm, projectId, id)).replacementAccepted).toBe(true);
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [link.id])).rows[0].version as number;
    const rej = await p.secretary.post(`${P(projectId)}/evidence/${link.id}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Report of another service — defective (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await drainWorker();
    t = await tsa(p.pm, projectId, id);
    expect(t).toMatchObject({ replacementAccepted: false, replacementAcceptedBy: null });
    const audit = (await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'readiness.tsa.replacement_evidence_invalidated' and entity_id = $2`, [projectId, id])).rows;
    expect(audit).toEqual([{ actor_kind: 'service' }]);
    // The exit approval needs an accepted replacement (REQ-TSA-006): it is accepted again on new, valid evidence.
    await addEvidence(p.pm, projectId, 'tsa_service', id, 'Corrected acceptance test report (synthetic)');
    t = await tsa(p.pm, projectId, id);
    expect((await cmd(id, 'accept-replacement', { expectedVersion: t.version, note: 'Accepted again on the corrected report (synthetic)' })).status).toBe(201);
  });
});
