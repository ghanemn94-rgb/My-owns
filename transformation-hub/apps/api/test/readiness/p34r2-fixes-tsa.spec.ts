import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { decisionVersion, tabledDecision, verifiedDecisionEvidence, vote, type Actors } from '../governance/gov-fixtures';
import { P, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, tsa, Gov, Personas } from './readiness-kit';

/**
 * DOM-P34R2-01 (docs/reviews/P3-P4-domain-rereview.md §9.3; business-gates.md §6 rules 5–6): extension terms are bound to a
 * decision for the FIRST time only while its paper is before the committee (draft / submitted / under review). This file
 * covers the escalated path the re-check did not execute (§9.7): a `tsa_approval_or_extension` paper above the DEMO limit is
 * RECOMMENDED by the committee (pending the external authority), then approved externally. Real API; synthetic data.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R2F-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);
const req = async (id: string, decisionId: string, proposedEndDate: string) =>
  cmd(id, 'request-extension', { expectedVersion: (await tsa(p.pm, projectId, id)).version, decisionId, proposedEndDate, continuityPlan: 'Keep the legacy service until the replacement is accepted (synthetic)' });
const record = async (id: string) => cmd(id, 'record-extension', { expectedVersion: (await tsa(p.pm, projectId, id)).version, note: 'Extension per the approved decision (test)' });
const termsOf = async (decisionId: string) => (await owner().query(`select tsa_service_id, proposed_end_date::text as end_date from tsa_extension_terms where decision_id = $1`, [decisionId])).rows;

/** A complete TSA, terms approved on its own FINAL decision (within the DEMO limit), activated. */
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

/** A `tsa_approval_or_extension` paper ABOVE the DEMO limit (2,000,000 SAR), tabled — under review. */
async function escalatedPaper() {
  return tabledDecision(projectId, p as unknown as Actors, p.pm, gov.committeeId, gov.meetingId, {
    decisionTypeKey: 'tsa_approval_or_extension',
    requiredAuthority: 'Per the DEMO authority matrix (synthetic)',
    amount: { amount: '2500000.0000', currency: 'SAR', unitScale: 1 },
  });
}

/** The committee votes the paper through: above the limit it is RECOMMENDED, pending the external authority. */
async function recommend(decisionId: string) {
  const v = await decisionVersion(p.chair, projectId, decisionId);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(projectId, p[k], decisionId, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(projectId)}/decisions/${decisionId}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  expect(out.body).toMatchObject({ status: 'recommended', authorityOutcome: 'pending_external_authority' });
}

/** The external authority approves (DOM-P2-12: on a verified evidence link). */
async function approveExternally(decisionId: string) {
  const evidenceLinkId = await verifiedDecisionEvidence(projectId, p.pm, p.legal, decisionId);
  const ev = await decisionVersion(p.chair, projectId, decisionId);
  const ext = await gov.secretary2.post(`${P(projectId)}/decisions/${decisionId}/record-external-approval`, {
    expectedVersion: ev,
    outcome: 'approved',
    externalReference: 'DEMO-DELEGATING-AUTHORITY (synthetic)',
    evidenceLinkId,
    note: 'Synthetic external decision (test)',
  });
  expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  expect(ext.body.status).toBe('approved');
}

describe('DOM-P34R2-01 — escalated extension papers (recommended, pending the external authority)', () => {
  it('DOM-P34R2-01: an extension requested on the paper while under review survives the escalation — recommended, approved externally, then recorded to the bound date', async () => {
    const id = await activeTsa('Escalated extension in time (synthetic)');
    const d = await escalatedPaper();
    const end = plusDays(120);
    const r = await req(id, d.id, end);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(await termsOf(d.id)).toEqual([{ tsa_service_id: id, end_date: end }]);
    await recommend(d.id);
    // Recommended is not a final approval: nothing is recorded yet.
    const early = await record(id);
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body.code).toBe('tsa.extension_requires_decision');
    expect((await tsa(p.pm, projectId, id)).status).not.toBe('extended');
    await approveExternally(d.id);
    const rec = await record(id);
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect(await tsa(p.pm, projectId, id)).toMatchObject({ status: 'extended', endDate: end, extensionDecisionId: d.id });
  });

  it('DOM-P34R2-01: a paper first linked once the committee recommended it (pending the external authority) — or once approved externally — carries no extension (422 tsa.extension.terms_after_outcome)', async () => {
    const id = await activeTsa('Escalated extension linked late (synthetic)');
    const d = await escalatedPaper();
    await recommend(d.id);
    const r1 = await req(id, d.id, plusDays(3650));
    expect(r1.status, JSON.stringify(r1.body)).toBe(422);
    expect(r1.body.code).toBe('tsa.extension.terms_after_outcome');
    await approveExternally(d.id);
    const r2 = await req(id, d.id, plusDays(3650));
    expect(r2.status, JSON.stringify(r2.body)).toBe(422);
    expect(r2.body.code).toBe('tsa.extension.terms_after_outcome');
    expect(await termsOf(d.id)).toEqual([]);
    const t = await tsa(p.pm, projectId, id);
    expect(t.status).toBe('active');
    expect(t.endDate).toBe(plusDays(20));
    // The refusals are audited.
    const audit = await owner().query(
      `select count(*)::int as n from audit_event where project_id = $1 and action = 'readiness.requestExtension' and outcome = 'rejected' and reason like 'tsa.extension.terms_after_outcome:%'`,
      [projectId],
    );
    expect(audit.rows[0].n).toBe(2);
  });
});
