import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner } from '../helpers';
import { syntheticUser, DocClient } from '../jv/jv-kit';
import { Personas, base, carveoutProject, createItem, grantWorkstreamLead, item, linkEvidence, ok, workstreamId } from './carveout-kit';

/**
 * Carve-out and NewCo rules through the API: agreements (REQ-AGR-001/002/003), perimeter versions (REQ-SET-012),
 * reconciliation / categories (REQ-PER-001/003/006), workstream scope, reference-value restriction, and the regulatory /
 * external / internal approval register (REQ-AGR-004/005/007).
 */
let pid: string;
let p: Personas;
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());
const daysAgo = (n: number) => new Date(Date.parse(today()) - n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  ({ projectId: pid, p } = await carveoutProject('CO-RULES'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Agreements [REQ-AGR-001, REQ-AGR-002, REQ-AGR-003]', () => {
  let agrId: string;
  it('labels are stored as found; a proposed expansion stays "Unconfirmed" until the owner confirms it', async () => {
    const a = await ok<{ id: string; code: string }>(p.pm.post(`${base(pid)}/agreements`, { kindLabel: 'ATA', kindExpansionProposed: 'Asset Transfer Agreement', title: 'Test ATA (synthetic)', ownerUserId: p.pm.userId }));
    agrId = a.id;
    const d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    expect(d).toMatchObject({ kindLabel: 'ATA', kindExpansionDisplay: 'Unconfirmed', kindExpansionConfirmed: false, kindExpansionProposed: 'Asset Transfer Agreement', stage: 'identified' });
    const notOwner = await p.legal.post(`${base(pid)}/agreements/${agrId}/confirm-expansion`, { expectedVersion: d.version, expansion: 'Asset Transfer Agreement', basis: 'x' });
    expect(notOwner.status).toBe(422);
    expect(notOwner.body.code).toBe('agreement.expansion_not_owner');
    const c = await ok<{ kindExpansionDisplay: string }>(p.pm.post(`${base(pid)}/agreements/${agrId}/confirm-expansion`, { expectedVersion: d.version, expansion: 'Asset Transfer Agreement', basis: 'Confirmed in the term sheet (synthetic)' }));
    expect(c.kindExpansionDisplay).toBe('Asset Transfer Agreement');
    const list = (await p.contributor.get(`${base(pid)}/agreements`).expect(200)).body;
    expect(list.items.map((x: { code: string }) => x.code)).toEqual([a.code]);
  });

  it('stage is a command: PATCH cannot move it; signing needs a legal reviewer and the executed copy', async () => {
    let d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    expect((await p.pm.patch(`${base(pid)}/agreements/${agrId}`, { expectedVersion: d.version, stage: 'signed' })).status).toBe(400);
    for (const command of ['start_drafting', 'start_negotiation']) {
      d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
      await ok(p.pm.post(`${base(pid)}/agreements/${agrId}/stage`, { expectedVersion: d.version, command }));
    }
    d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    const noReviewer = await p.pm.post(`${base(pid)}/agreements/${agrId}/stage`, { expectedVersion: d.version, command: 'agree_in_principle' });
    expect(noReviewer.status).toBe(422);
    expect(noReviewer.body.code).toBe('agreement.legal_reviewer_required');
    await ok(p.pm.patch(`${base(pid)}/agreements/${agrId}`, { expectedVersion: d.version, legalReviewerUserId: p.legal.userId }), 200);
    d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    const v = await ok<{ version: number }>(p.pm.post(`${base(pid)}/agreements/${agrId}/versions`, { expectedVersion: d.version, versionLabel: 'v0.1', note: 'First draft (synthetic)' }));
    await ok(p.pm.post(`${base(pid)}/agreements/${agrId}/stage`, { expectedVersion: v.version, command: 'agree_in_principle' }));
    d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    expect(d.currentDraftVersion).toBe('v0.1');
    const noCopy = await p.pm.post(`${base(pid)}/agreements/${agrId}/stage`, { expectedVersion: d.version, command: 'record_signing', signingDate: today() });
    expect(noCopy.body.code).toBe('agreement.executed_copy_required');
    await linkEvidence(p.legal, pid, 'agreement', agrId, 'Executed copy held by Legal (synthetic)');
    const signed = await ok<{ stage: string }>(p.pm.post(`${base(pid)}/agreements/${agrId}/stage`, { expectedVersion: d.version, command: 'record_signing', signingDate: today() }));
    expect(signed.stage).toBe('signed');
    d = (await p.pm.get(`${base(pid)}/agreements/${agrId}`).expect(200)).body;
    expect(d).toMatchObject({ signingDate: today(), evidence: { active: 1, conflicting: 0 } });
    expect(d.versions.map((x: { versionLabel: string }) => x.versionLabel)).toEqual(['v0.1']);
    // No new draft versions after signing.
    expect((await p.pm.post(`${base(pid)}/agreements/${agrId}/versions`, { expectedVersion: d.version, versionLabel: 'v0.2' })).status).toBe(422);
  });

  it('a record cannot be classified above the creator clearance (403)', async () => {
    expect((await p.pm.post(`${base(pid)}/agreements`, { kindLabel: 'SHA', title: 'Restricted (test)', classification: 'strictly_confidential' })).status).toBe(403);
  });
});

describe('Perimeter register rules [REQ-PER-001, REQ-PER-003, REQ-PER-006]', () => {
  it('reference values are shown only to holders of finance.record.read', async () => {
    const r = await createItem(p.pm, pid, { type: 'receivable', name: 'Receivables (synthetic)', disposition: 'included', referenceValue: { amount: '1.0000', currency: 'SAR', unitScale: 1000 }, referenceValueSource: 'Synthetic', workstreamId: await workstreamId(p.pm, pid, 'WS04'), ownerUserId: p.pm.userId });
    const pmView = await item(p.pm, pid, r.id);
    expect(pmView).toMatchObject({ referenceValue: { amount: '1.0000', currency: 'SAR', unitScale: 1000 }, referenceValueRestricted: false });
    // A contributor (no finance.record.read) sees that a value exists but not the value.
    const contributorView = await item(p.contributor, pid, r.id);
    expect(contributorView).toMatchObject({ referenceValue: null, referenceValueRestricted: true, referenceValueSource: null });
  });

  it('reconciliation flags unassessed categories; a reviewed category is recorded with its conclusion', async () => {
    let rec = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    const cat = (c: string) => rec.categories.find((x: { category: string }) => x.category === c);
    expect(cat('guarantee').status).toBe('unassessed');
    expect(cat('receivable').status).toBe('items_registered');
    expect(rec.findings.some((f: { issue: string }) => f.issue === 'no_transfer_plan')).toBe(true);
    await ok(p.pm.post(`${base(pid)}/perimeter/categories/guarantee/review`, { conclusion: 'No guarantees identified (synthetic)' }));
    rec = (await p.pm.get(`${base(pid)}/perimeter/reconciliation`).expect(200)).body;
    expect(cat('guarantee')).toMatchObject({ status: 'reviewed_none_in_perimeter', conclusion: 'No guarantees identified (synthetic)' });
    // A second review needs expectedVersion (no silent overwrite).
    expect((await p.pm.post(`${base(pid)}/perimeter/categories/guarantee/review`, { conclusion: 'again' })).status).toBe(409);
  });

  it('own_workstream: a workstream-only lead manages and sees only its workstream', async () => {
    const techLead = await grantWorkstreamLead(pid, 'tech.lead', 'WS06');
    const ws05 = await workstreamId(p.pm, pid, 'WS05');
    const ws06 = await workstreamId(p.pm, pid, 'WS06');
    expect((await techLead.post(`${base(pid)}/perimeter-items`, { type: 'data', name: 'WS05 data (test)', workstreamId: ws05 })).status).toBe(403);
    const own = await createItem(techLead, pid, { type: 'data', name: 'WS06 data (test)', workstreamId: ws06 });
    expect(own.applied).toBe(true);
    const other = await createItem(p.pm, pid, { type: 'asset', name: 'WS05 asset (test)', workstreamId: ws05 });
    const list = (await techLead.get(`${base(pid)}/perimeter-items`).expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([own.id]);
    expect(list.total).toBe(1);
    expect((await techLead.get(`${base(pid)}/perimeter-items/${other.id}`)).status).toBe(404);
    // Project-level registers are not visible through a workstream-only grant.
    expect((await techLead.get(`${base(pid)}/agreements`)).status).toBe(404);
  });
});

describe('Regulatory / external / internal approvals [REQ-AGR-004, REQ-AGR-005, REQ-AGR-007]', () => {
  let reqId: string;
  // SEC-P34-05 (REQ-AGR-004): applicability, outcomes and conditions are recorded by Legal / regulatory roles only — and never
  // by the registrant, the outcome recorder or the evidence linker (not_self). Two more synthetic Legal members stand in for
  // the Legal team (the demo has a single Legal persona).
  let legal2: DocClient;
  let legal3: DocClient;
  beforeAll(async () => {
    const orgId = (await owner().query<{ org_id: string }>('select org_id from project where id = $1', [pid])).rows[0]!.org_id;
    const admin = await loginAs('portfolio.admin');
    legal2 = await syntheticUser(orgId, 'co-rules.legal2', 'internal', 'confidential');
    legal3 = await syntheticUser(orgId, 'co-rules.legal3', 'internal', 'confidential');
    for (const u of [legal2, legal3]) {
      const g = await admin.post(`${base(pid)}/members`, { userId: u.userId, role: 'legal_restricted', reason: 'carve-out rules test (Legal team member, synthetic)' });
      expect(g.status, JSON.stringify(g.body)).toBe(201);
    }
  });
  it("only Legal maintains the register; an entry from a source starts 'Assessment pending — specialist'", async () => {
    // REQ-AGR-004: edits to the regulatory register are for Legal / Regulatory roles only — not the PM or a workstream lead.
    expect((await p.pm.post(`${base(pid)}/regulatory-requirements`, { category: 'regulatory', authority: 'CST', title: 'PM entry (test)' })).status).toBe(403);
    expect((await p.legal.post(`${base(pid)}/regulatory-requirements`, { category: 'regulatory', authority: 'CST', title: 'x', applicability: 'applicable' })).status).toBe(400);
    const r = await ok<{ id: string; code: string }>(p.legal.post(`${base(pid)}/regulatory-requirements`, { category: 'regulatory', authority: 'CST', title: 'Licence item from the source summary (test)', origin: 'source_extraction', sourceReference: 'Reference summary (unverified)' }));
    reqId = r.id;
    const d = (await p.pm.get(`${base(pid)}/regulatory-requirements/${reqId}`).expect(200)).body;
    expect(d).toMatchObject({ applicability: 'assessment_pending', applicabilityLabel: 'Assessment pending — specialist', status: 'not_started', verificationStatus: 'historical_unverified', validityState: 'not_granted', conditionsState: 'none' });
    expect((await p.pm.post(`${base(pid)}/regulatory-requirements/${reqId}/status`, { expectedVersion: d.version, command: 'start_preparation' })).status).toBe(403);
  });

  it('nothing is submitted or recorded as obtained before a specialist applicability assessment', async () => {
    let d = (await p.legal.get(`${base(pid)}/regulatory-requirements/${reqId}`).expect(200)).body;
    const s = await ok<{ status: string; version: number }>(p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/status`, { expectedVersion: d.version, command: 'start_preparation' }));
    const sub = await p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/status`, { expectedVersion: s.version, command: 'submit', date: today() });
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe('newco.regulatory.applicability_not_assessed');
    // the PM cannot assess (not a specialist); the registrant cannot assess its own entry; a non-legal functional approver
    // cannot either (SEC-P34-05); another Legal member can
    expect((await p.pm.post(`${base(pid)}/regulatory-requirements/${reqId}/assess-applicability`, { expectedVersion: s.version, applicability: 'applicable', basis: 'x' })).status).toBe(403);
    expect((await p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/assess-applicability`, { expectedVersion: s.version, applicability: 'applicable', basis: 'self' })).status).toBe(403);
    expect((await p.approver.post(`${base(pid)}/regulatory-requirements/${reqId}/assess-applicability`, { expectedVersion: s.version, applicability: 'applicable', basis: 'not Legal' })).status).toBe(403);
    await ok(legal2.post(`${base(pid)}/regulatory-requirements/${reqId}/assess-applicability`, { expectedVersion: s.version, applicability: 'applicable', basis: 'Specialist assessment (synthetic)' }));
    d = (await p.pm.get(`${base(pid)}/regulatory-requirements/${reqId}`).expect(200)).body;
    expect(d.applicabilityAssessment.assessedBy.userId).toBe(legal2.userId);
    await ok(p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/status`, { expectedVersion: d.version, command: 'submit', date: today() }));
  });

  it('the registrant cannot assess its own entry (not_self)', async () => {
    const own = await ok<{ id: string }>(p.legal.post(`${base(pid)}/regulatory-requirements`, { category: 'external_party', authority: 'Fictional landlord', title: 'Landlord consent (test)' }));
    expect((await p.legal.post(`${base(pid)}/regulatory-requirements/${own.id}/assess-applicability`, { expectedVersion: 1, applicability: 'applicable', basis: 'self' })).status).toBe(403);
  });

  it('an outcome needs evidence; a conditional grant keeps conditions open until evidenced; expired validity is flagged', async () => {
    let d = (await p.pm.get(`${base(pid)}/regulatory-requirements/${reqId}`).expect(200)).body;
    expect((await p.pm.post(`${base(pid)}/regulatory-requirements/${reqId}/record-outcome`, { expectedVersion: d.version, command: 'record_grant', date: today() })).status).toBe(403);
    // the registrant (Legal) does not record the authority's outcome on its own entry; nor does a non-legal approver
    expect((await p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/record-outcome`, { expectedVersion: d.version, command: 'record_grant', date: today() })).status).toBe(403);
    expect((await p.approver.post(`${base(pid)}/regulatory-requirements/${reqId}/record-outcome`, { expectedVersion: d.version, command: 'record_grant', date: today() })).status).toBe(403);
    const noEv = await legal2.post(`${base(pid)}/regulatory-requirements/${reqId}/record-outcome`, { expectedVersion: d.version, command: 'record_grant', date: today() });
    expect(noEv.body.code).toBe('newco.regulatory.evidence_required');
    await linkEvidence(p.legal, pid, 'regulatory_requirement', reqId, 'Decision letter (synthetic)');
    const g = await ok<{ status: string; conditionsState: string; validityState: string; version: number }>(
      legal2.post(`${base(pid)}/regulatory-requirements/${reqId}/record-outcome`, { expectedVersion: d.version, command: 'record_grant_with_conditions', date: daysAgo(10), conditions: 'Quarterly reporting (synthetic)', validFrom: daysAgo(10), validTo: daysAgo(1) }),
    );
    expect(g).toMatchObject({ status: 'granted_with_conditions', conditionsState: 'open', validityState: 'expired' });
    const expired = (await p.pm.get(`${base(pid)}/regulatory-requirements?validity=expired`).expect(200)).body;
    expect(expired.items.map((x: { id: string }) => x.id)).toContain(reqId);
    // The recorder of the grant cannot confirm its conditions, nor can the person who linked the evidence (DOM-P3-10 /
    // SEC-P34-01); another Legal verifier can, with evidence.
    expect((await legal2.post(`${base(pid)}/regulatory-requirements/${reqId}/conditions-satisfied`, { expectedVersion: g.version, note: 'done' })).status).toBe(403);
    expect((await p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/conditions-satisfied`, { expectedVersion: g.version, note: 'on my own evidence' })).status).toBe(403);
    const c = await ok<{ conditionsState: string }>(legal3.post(`${base(pid)}/regulatory-requirements/${reqId}/conditions-satisfied`, { expectedVersion: g.version, note: 'Report filed (synthetic)' }));
    expect(c.conditionsState).toBe('satisfied');
    d = (await p.legal.get(`${base(pid)}/regulatory-requirements/${reqId}`).expect(200)).body;
    const m = await ok<{ status: string }>(p.legal.post(`${base(pid)}/regulatory-requirements/${reqId}/status`, { expectedVersion: d.version, command: 'mark_expired' }));
    expect(m.status).toBe('expired');
  });
});
