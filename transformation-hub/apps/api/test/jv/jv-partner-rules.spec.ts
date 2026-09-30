import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { decisionVersion, vote } from '../governance/gov-fixtures';
import { P, doc, gateDecision, ok, partner, partnerAt, setupJvProject, JvProject } from './jv-kit';

/**
 * Partner process rules: longlist with criteria weights and conflicts (REQ-JV-002), outreach approval separate and
 * authorized (REQ-JV-004), fact vs judgement (REQ-JV-006), ownership scenarios without default percentages (REQ-JV-007),
 * negotiation issues linked to their approving decision (REQ-JV-008).
 */
let j: JvProject;
let pid: string;

beforeAll(async () => {
  j = await setupJvProject('JV-RULES');
  pid = j.projectId;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-JV-002 — longlist / shortlist with criteria, weights and conflict disclosures', () => {
  it('UT: a new project has no partners (no real default names); weights must sum to 100', async () => {
    expect((await j.p.pm.get(`${P(pid)}/partners`).expect(200)).body.total).toBe(0);
    expect((await j.p.pm.get(`${P(pid)}/partner-criteria`).expect(200)).body.criteriaSet).toBeNull();
    const bad = await j.p.pm.agent.put(`${P(pid)}/partner-criteria`).set('x-csrf-token', j.p.pm.csrf).send({ expectedVersion: 0, criteria: [{ key: 'capability', name: 'Capability', weight: '60' }, { key: 'funding', name: 'Funding', weight: '30' }] });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('jv.criteria.weights_sum');
    expect(bad.body.details.total).toBe('90.00');
    const good = await j.p.pm.agent.put(`${P(pid)}/partner-criteria`).set('x-csrf-token', j.p.pm.csrf).send({ expectedVersion: 0, criteria: [{ key: 'capability', name: 'Capability', weight: '60' }, { key: 'funding', name: 'Funding', weight: '40' }] });
    expect(good.status, JSON.stringify(good.body)).toBe(200);
    const stale = await j.p.pm.agent.put(`${P(pid)}/partner-criteria`).set('x-csrf-token', j.p.pm.csrf).send({ expectedVersion: 0, criteria: [{ key: 'capability', name: 'Capability', weight: '100' }] });
    expect(stale.status).toBe(409);
    const c = (await j.p.pm.get(`${P(pid)}/partner-criteria`).expect(200)).body.criteriaSet;
    expect(c).toMatchObject({ totalWeight: '100.00', version: 1 });
  });

  it('shortlist, conflict disclosures and the comparison (scores only when complete, never estimated)', async () => {
    const a = await partnerAt(j, 'Rules Partner One (fictional)', 'identified');
    const b = await partnerAt(j, 'Rules Partner Two (fictional)', 'identified');
    const v = (await partner(j.p.pm, pid, a)).version;
    await ok(await j.p.pm.post(`${P(pid)}/partners/${a}/shortlist`, { expectedVersion: v, shortlisted: true, reason: 'Meets the screening threshold (test)' }));
    await ok(await j.p.pm.post(`${P(pid)}/partners/${b}/conflicts`, { declarantUserId: j.p.sponsor.userId, description: 'Synthetic declared interest (test)' }));
    await ok(await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { basis: 'judgement', statement: 'Team view (synthetic)', criterionKey: 'capability', score: '4' }));
    let cmp = (await j.p.pm.get(`${P(pid)}/partner-comparison`).expect(200)).body;
    let row = cmp.items.find((x: { partnerId: string }) => x.partnerId === a);
    expect(row).toMatchObject({ weightedScore: null, missing: ['funding'], judgements: 1, facts: 0, shortlisted: true });
    await ok(await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { basis: 'fact', statement: 'Audited funding letter (synthetic)', criterionKey: 'funding', score: '3', sourceReference: 'Proposal annex 2 (synthetic)' }));
    cmp = (await j.p.pm.get(`${P(pid)}/partner-comparison`).expect(200)).body;
    row = cmp.items.find((x: { partnerId: string }) => x.partnerId === a);
    expect(row).toMatchObject({ weightedScore: '3.60', missing: [], facts: 1, judgements: 1 }); // (60×4 + 40×3) / 100
    const list = (await j.p.pm.get(`${P(pid)}/partners?shortlisted=true`).expect(200)).body;
    expect(list.items.map((x: { id: string; weightedScore: string | null }) => [x.id, x.weightedScore])).toEqual([[a, '3.60']]);
    const detail = await partner(j.p.pm, pid, b);
    expect(detail.conflicts).toHaveLength(1);
    expect(detail.conflicts[0]).toMatchObject({ declarantUserId: j.p.sponsor.userId, status: 'open' });
  });
});

describe('REQ-JV-006 — assessments separate facts from team judgement', () => {
  it('UT: assessment entries require the fact/judgement tag; a fact needs its source', async () => {
    const a = await partnerAt(j, 'Assessed Partner (fictional)', 'identified');
    const none = await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { statement: 'Untagged (probe)' });
    expect(none.status).toBe(422);
    expect(none.body.code).toBe('jv.assessment.basis_required');
    const fact = await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { basis: 'fact', statement: 'Unsourced fact (probe)' });
    expect(fact.body.code).toBe('jv.assessment.fact_source_required');
    const unknown = await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { basis: 'judgement', statement: 'x', criterionKey: 'price', score: '3' });
    expect(unknown.body.code).toBe('jv.assessment.unknown_criterion');
    const proposalDoc = await doc(j.p.pm, pid, 'Proposal document (synthetic)');
    const prop = await ok(await j.p.pm.post(`${P(pid)}/partners/${a}/proposals`, { title: 'Indicative proposal (synthetic)', scope: 'Synthetic scope', documentId: proposalDoc.id }));
    await ok(await j.p.finance.post(`${P(pid)}/partners/${a}/assessments`, { basis: 'fact', statement: 'Stated in the proposal (synthetic)', proposalId: prop.id, documentId: proposalDoc.id }));
    const entries = (await j.p.pm.get(`${P(pid)}/partners/${a}/assessments`).expect(200)).body.items;
    expect(entries.map((e: { basis: string }) => e.basis)).toEqual(['fact']);
    expect((await j.p.pm.get(`${P(pid)}/partners/${a}/proposals`).expect(200)).body.items.map((p: { code: string }) => p.code)).toEqual([prop.code]);
    // The database refuses an unsourced fact and any change to an entry (append-only).
    await expect(owner().query(`insert into partner_assessment_entry (org_id, project_id, partner_id, basis, statement) values ($1,$2,$3,'fact','probe')`, [j.orgId, pid, a])).rejects.toMatchObject({ code: '23514' });
    await expect(owner().query(`update partner_assessment_entry set basis = 'judgement' where partner_id = $1`, [a])).rejects.toThrow(/append_only_violation/);
  });
});

describe('REQ-JV-004 — outreach approval is separate, authorized and never by the requester or a conflicted person', () => {
  it('UT: advance to NDA without outreach approval is rejected; approval needs a pending request by someone else', async () => {
    const a = await partnerAt(j, 'Outreach Partner (fictional)', 'identified');
    let v = (await partner(j.p.pm, pid, a)).version;
    const noReq = await j.p.sponsor.post(`${P(pid)}/partners/${a}/outreach-approval`, { expectedVersion: v, outcome: 'approve' });
    expect(noReq.status).toBe(422);
    expect(noReq.body.code).toBe('jv.partner.outreach_not_requested');
    // The sponsor requests … and cannot approve its own request.
    v = (await ok(await j.p.sponsor.post(`${P(pid)}/partners/${a}/outreach-request`, { expectedVersion: v, note: 'Sponsor request (test)' }))).version;
    const self = await j.p.sponsor.post(`${P(pid)}/partners/${a}/outreach-approval`, { expectedVersion: v, outcome: 'approve' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('jv.partner.self_approval');
    const byPm = await j.p.pm.post(`${P(pid)}/partners/${a}/outreach-approval`, { expectedVersion: v, outcome: 'approve' });
    expect(byPm.status).toBe(403); // no jv.partner.approve_contact
    expect((await partner(j.p.pm, pid, a)).stage).toBe('identified');
  });

  it('a person with an open conflict disclosure on the partner cannot approve its outreach', async () => {
    const a = await partnerAt(j, 'Conflicted Partner (fictional)', 'identified');
    await ok(await j.p.pm.post(`${P(pid)}/partners/${a}/conflicts`, { declarantUserId: j.p.sponsor.userId, description: 'Synthetic interest (test)' }));
    let v = (await partner(j.p.pm, pid, a)).version;
    v = (await ok(await j.p.pm.post(`${P(pid)}/partners/${a}/outreach-request`, { expectedVersion: v, note: 'Request (test)' }))).version;
    const r = await j.p.sponsor.post(`${P(pid)}/partners/${a}/outreach-approval`, { expectedVersion: v, outcome: 'approve' });
    expect(r.status).toBe(403);
    expect(r.body.code).toBe('jv.partner.conflicted_approver');
  });

  it('the NDA is recorded by Legal (not the submitter) and grants no access; an approved outreach is kept on the partner', async () => {
    const a = await partnerAt(j, 'NDA Partner (fictional)', 'approved_for_contact');
    let p = await partner(j.p.pm, pid, a);
    expect(p.outreach.approvedBy).toBe(j.p.sponsor.userId);
    expect(p.outreach.request).toMatchObject({ status: 'approved', requestedBy: j.p.pm.userId });
    const nda = await doc(j.p.legal, pid, 'Executed NDA (synthetic)', { kind: 'agreement' });
    const sub = await ok(await j.p.legal.post(`${P(pid)}/partners/${a}/nda`, { expectedVersion: p.version, documentId: nda.id, executedOn: '2026-01-15' }));
    const self = await j.p.legal.post(`${P(pid)}/partners/${a}/nda/record`, { expectedVersion: sub.version, outcome: 'record' });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('jv.partner.self_approval');
    p = await partner(j.p.pm, pid, a);
    expect(p.stage).toBe('approved_for_contact');
    expect(p.nda.request.status).toBe('pending');
  });
});

describe('REQ-JV-007 — versioned ownership / governance scenarios without default percentages', () => {
  it('UT: scenario has no default ownership percentage; a complete split totals 100; versions are immutable', async () => {
    const a = await partnerAt(j, 'Scenario Partner (fictional)', 'identified');
    const s = await ok(await j.p.finance.post(`${P(pid)}/deal-scenarios`, { name: 'Structure A (synthetic)', partnerId: a, ownership: [{ party: 'Party A (label)', percent: null }, { party: 'Party B (label)', percent: null }] }));
    let d = (await j.p.finance.get(`${P(pid)}/deal-scenarios/${s.id}`).expect(200)).body;
    expect(d.ownership).toEqual([
      { party: 'Party A (label)', percent: null, note: null },
      { party: 'Party B (label)', percent: null, note: null },
    ]);
    expect(d).toMatchObject({ ownershipComplete: false, ownershipTotal: null, versionNo: 1 });
    const bad = await j.p.finance.post(`${P(pid)}/deal-scenarios/${s.id}/versions`, { expectedVersion: d.version, ownership: [{ party: 'Party A (label)', percent: '60' }, { party: 'Party B (label)', percent: '30' }], contributions: [], changeNote: 'probe' });
    expect(bad.status).toBe(422);
    expect(bad.body.code).toBe('jv.scenario.ownership_not_100');
    const v2 = await ok(await j.p.finance.post(`${P(pid)}/deal-scenarios/${s.id}/versions`, {
      expectedVersion: d.version,
      ownership: [{ party: 'Party A (label)', percent: '40' }, { party: 'Party B (label)', percent: null }],
      contributions: [{ party: 'Party B (label)', description: 'Cash contribution (synthetic)', amount: '100.0000', currency: 'SAR', unitScale: 1000000 }],
      changeNote: 'Party A position entered by a person (synthetic)',
    }));
    expect(v2.versionNo).toBe(2);
    d = (await j.p.finance.get(`${P(pid)}/deal-scenarios/${s.id}`).expect(200)).body;
    expect(d).toMatchObject({ versionNo: 2, ownershipComplete: false, ownershipTotal: '40.0000' });
    expect(d.versions.map((x: { versionNo: number }) => x.versionNo)).toEqual([1, 2]);
    expect(d.versions[0].ownership.every((o: { percent: string | null }) => o.percent === null)).toBe(true);
    expect(d.contributions[0].amount).toEqual({ amount: '100.0000', currency: 'SAR', unitScale: 1000000 });
    await expect(owner().query(`update deal_scenario_version set ownership = '[]'::jsonb where scenario_id = $1`, [s.id])).rejects.toThrow(/append_only_violation/);
    const pmTry = await j.p.pm.post(`${P(pid)}/deal-scenarios`, { name: 'PM scenario (probe)' });
    expect(pmTry.status).toBe(403); // jv.scenario.manage: Finance / Legal only
  });
});

describe('REQ-JV-008 — terms & negotiation issues', () => {
  it('UT: an issue requiring approval links a decision, and is agreed only after the decision is a FINAL approval', async () => {
    const noDecision = await j.p.legal.post(`${P(pid)}/negotiation-issues`, { issue: 'Reserved matters list (synthetic)', requiresApproval: true });
    expect(noDecision.status).toBe(422);
    expect(noDecision.body.code).toBe('jv.negotiation.decision_required');
    const d = await gateDecision(pid, j.gp, j.gov, 'G5', { decisionTypeKey: 'partner_outreach_and_access', vote: false });
    const issue = await ok(await j.p.legal.post(`${P(pid)}/negotiation-issues`, {
      issue: 'Reserved matters list (synthetic)',
      positions: [
        { party: 'Mobily (label)', position: 'Position A (synthetic)' },
        { party: 'Partner (label)', position: 'Position B (synthetic)' },
      ],
      requiresApproval: true,
      decisionId: d.id,
      requiredApproval: 'Steering committee (synthetic)',
    }));
    let v = (await ok(await j.p.legal.post(`${P(pid)}/negotiation-issues/${issue.id}/transition`, { expectedVersion: 1, command: 'propose_resolution' }))).version;
    const early = await j.p.legal.post(`${P(pid)}/negotiation-issues/${issue.id}/transition`, { expectedVersion: v, command: 'agree' });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('jv.negotiation.approval_pending');
    const unlink = await j.p.legal.patch(`${P(pid)}/negotiation-issues/${issue.id}`, { expectedVersion: v, decisionId: null });
    expect(unlink.status).toBe(422);
    expect(unlink.body.code).toBe('jv.negotiation.decision_required');
    // The committee approves the decision (votes + outcome) — now the issue can be agreed.
    const dv = await decisionVersion(j.gp.chair, pid, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pid, j.gp[k], d.id, 'approve', dv)).status).toBe(201);
    await ok(await j.gp.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: dv }));
    const agreed = await ok(await j.p.legal.post(`${P(pid)}/negotiation-issues/${issue.id}/transition`, { expectedVersion: v, command: 'agree' }));
    expect(agreed.status).toBe('agreed');
    const list = (await j.p.sponsor.get(`${P(pid)}/negotiation-issues`).expect(200)).body;
    const row = list.items.find((x: { id: string }) => x.id === issue.id);
    expect(row.decision).toMatchObject({ id: d.id, status: 'approved', issueCode: null });
    await expect(owner().query(`update negotiation_issue set decision_id = null where id = $1`, [issue.id])).rejects.toMatchObject({ code: '23514' });
    v = agreed.version;
    void v;
  });
});
