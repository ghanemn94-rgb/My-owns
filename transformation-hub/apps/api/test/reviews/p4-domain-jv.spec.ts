import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { gateByKey } from '../gates/gate-test-kit';
import { P, doc, finalDecision, gateDecision, grant, in30, ok, partnerAt, plusDays, room, setupJvProject, syntheticUser, DocClient, JvProject } from '../jv/jv-kit';
import { docsPath } from '../documents/doc-helpers';

/**
 * P4 DOMAIN REVIEW — JV defect probes (docs/reviews/P4-domain-review.md).
 *
 * Each `DEFECT DOM-P4-nn` probe asserts the behaviour REQUIRED by the specification or by the platform's own governance
 * documents. At the reviewed revision the required assertion FAILS (that failure is the reproduction). The probes are
 * declared with `it.fails` so the suite stays green while the defect is open; once the defect is fixed the probe itself
 * fails and must be turned into a plain `it` (never weakened). Run with `P4_PROBE_PLAIN=1` to execute the probes as plain
 * tests and see the failing assertion. The probe bodies avoid throwing helpers: the only assertion that can fail is the
 * one encoding the required behaviour, and all setup runs in plain `it` steps before it.
 *
 * All data is synthetic (a demo-flagged project created by the test through the API).
 */
const probe = process.env['P4_PROBE_PLAIN'] ? it : it.fails;

let j: JvProject;
let pid: string;
let partnerId: string;
let signingId: string;

const event = async (c: DocClient, kind: 'signings' | 'closings', id: string) => (await c.get(`${P(pid)}/${kind}/${id}`)).body as Record<string, any>;

/** start_preparation → mark_ready (no CP / checklist item on the event). */
async function readyEvent(id: string) {
  let v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
  v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
  return v as number;
}

beforeAll(async () => {
  j = await setupJvProject('DRP4-JV');
  pid = j.projectId;
  partnerId = await partnerAt(j, 'P4 probe partner (fictional)');
  // A confirmed signing through the ordinary path (as in AT-12): a FINAL jv_signing_authorization decision, the executed
  // copy, requested by the PM and recorded by the sponsor.
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P4 probe signing (synthetic)', partnerId }));
  const v = await readyEvent(s.id);
  const executed = await doc(j.p.pm, pid, 'P4 probe executed agreement (synthetic)', { kind: 'agreement' });
  const req = await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s.id}/request-confirmation`, { expectedVersion: v, decisionId: await finalDecision(j, 'jv_signing_authorization'), executedDocumentId: executed.id }));
  await ok(await j.p.sponsor.post(`${P(pid)}/signings/${s.id}/record`, { expectedVersion: req.version }));
  signingId = s.id;
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('P4 domain review — JV defect probes [docs/reviews/P4-domain-review.md]', () => {
  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-01: one closing-confirmation decision confirms several closings.
  let decisionD: string;
  let closing2: { id: string; version: number };

  it('setup DOM-P4-01: closing #1 is confirmed on decision D; closing #2 of the same signing is ready', async () => {
    const c1 = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name: 'P4 probe closing #1 (synthetic)' }));
    const v1 = await readyEvent(c1.id);
    decisionD = await finalDecision(j, 'jv_closing_confirmation');
    const r1 = await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c1.id}/request-confirmation`, { expectedVersion: v1, decisionId: decisionD }));
    await ok(await j.p.sponsor.post(`${P(pid)}/closings/${c1.id}/confirm`, { expectedVersion: r1.version, note: 'Closing #1 (synthetic)' }));
    expect((await event(j.p.pm, 'closings', c1.id)).status).toBe('confirmed');
    const c2 = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name: 'P4 probe closing #2 (synthetic)' }));
    closing2 = { id: c2.id, version: await readyEvent(c2.id) };
    expect((await event(j.p.pm, 'closings', c2.id)).ready).toBe(true);
  });

  probe('DEFECT DOM-P4-01: the decision that confirmed closing #1 must not also confirm closing #2 (G6-C06 "for this closing"; P2 rule: a decision backs one approval only)', async () => {
    const req = await j.p.pm.post(`${P(pid)}/transaction-events/${closing2.id}/request-confirmation`, { expectedVersion: closing2.version, decisionId: decisionD });
    if (req.status === 201) await j.p.sponsor.post(`${P(pid)}/closings/${closing2.id}/confirm`, { expectedVersion: req.body.version, note: 'Reuse attempt (synthetic)' });
    const c2 = await event(j.p.pm, 'closings', closing2.id);
    expect(c2.status, `closing #2 confirmed on the decision already used by closing #1 (request ${req.status})`).not.toBe('confirmed');
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-02: a signing is recorded while gate G5 (JV Signing Readiness) has not passed.
  let signing2: { id: string; version: number };
  let g5Decision: string;
  let executed2: string;

  it('setup DOM-P4-02: G5 is not passed; a second signing is ready; a FINAL jv_signing_authorization decision raised for G5 exists', async () => {
    const g5 = await gateByKey(j.gp.pm, pid, 'G5');
    expect(['approved', 'approved_with_exceptions']).not.toContain(g5.assessment?.status ?? null);
    const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P4 probe signing #2 before G5 (synthetic)', partnerId }));
    signing2 = { id: s.id, version: await readyEvent(s.id) };
    const d = await gateDecision(pid, j.gp, j.gov, 'G5', { decisionTypeKey: 'jv_signing_authorization', externalApproval: true });
    expect(d.status).toBe('approved');
    g5Decision = d.id;
    executed2 = (await doc(j.p.pm, pid, 'P4 probe executed agreement #2 (synthetic)', { kind: 'agreement' })).id;
  });

  probe('DEFECT DOM-P4-02: a signing cannot be recorded before gate G5 (JV Signing Readiness) has passed (business-gates.md §8 rule 5, spec §3 enforceable gates)', async () => {
    const req = await j.p.pm.post(`${P(pid)}/transaction-events/${signing2.id}/request-confirmation`, { expectedVersion: signing2.version, decisionId: g5Decision, executedDocumentId: executed2 });
    if (req.status === 201) await j.p.sponsor.post(`${P(pid)}/signings/${signing2.id}/record`, { expectedVersion: req.body.version });
    const s = await event(j.p.pm, 'signings', signing2.id);
    expect(s.status, `signing recorded while G5 is not passed (request ${req.status})`).not.toBe('confirmed');
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-03: a non-legal functional approver removes the blocking status of a non-waivable CP; closing unblocks.
  let closing3: string;
  let cpBlock: { id: string; code: string; version: number };

  it('setup DOM-P4-03: a blocking, non-waivable CP (Legal) blocks closing #3', async () => {
    const c3 = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name: 'P4 probe closing #3 (synthetic)' }));
    closing3 = c3.id;
    await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${closing3}/transition`, { expectedVersion: 1, command: 'start_preparation' }));
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing3, title: 'Regulatory approval (synthetic, non-waivable)', ownerUserId: j.p.pm.userId, blocking: true }));
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    expect(cur).toMatchObject({ blocking: true, waivable: false, status: 'open' });
    cpBlock = { id: c.id, code: c.code, version: cur.version };
    expect((await event(j.p.pm, 'closings', closing3)).blockers.map((b: { ref: string }) => b.ref)).toContain(c.code);
  });

  probe('DEFECT DOM-P4-03: a functional approver (not a Legal specialist) cannot make a non-waivable blocking CP non-blocking, and the CP keeps blocking the closing (business-gates.md §7; AT-13)', async () => {
    const r = await j.p.approver.post(`${P(pid)}/closing-conditions/${cpBlock.id}/determine-waivability`, {
      expectedVersion: cpBlock.version,
      blocking: false,
      waivable: false,
      waiverAuthorityRole: null,
      basis: 'Probe: not a condition to closing (synthetic)',
    });
    const refs = ((await event(j.p.pm, 'closings', closing3)).blockers ?? []).map((b: { ref: string }) => b.ref);
    expect(refs, `CP no longer blocks the closing after the functional approver's determination (status ${r.status})`).toContain(cpBlock.code);
    expect(r.status).toBe(403);
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-04: the validity of a verified CP has lapsed; editing the date clears the blocker without re-verification.
  let cpValid: { id: string; code: string; version: number };

  it('setup DOM-P4-04: a verified blocking CP whose validity lapsed yesterday blocks closing #3', async () => {
    const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing3, title: 'Third-party consent valid until yesterday (synthetic)', ownerUserId: j.p.pm.userId, blocking: true, validTo: plusDays(-1) }));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Synthetic consent letter (test)' }));
    let cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    const s = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: cur.version }));
    await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: s.version, outcome: 'verify' }));
    cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    expect(cur.status).toBe('verified');
    cpValid = { id: c.id, code: c.code, version: cur.version };
    const bl = (await event(j.p.pm, 'closings', closing3)).blockers.filter((b: { ref: string }) => b.ref === c.code);
    expect(bl.map((b: { messageI18n: { code: string }[] }) => b.messageI18n[0]!.code)).toEqual(['jv.closing.cp_validity_lapsed']);
  });

  probe('DEFECT DOM-P4-04: moving the validity date of a verified CP after it lapsed does not clear the blocker without re-verification (business-gates.md §7 "an expired approval re-opens the CP")', async () => {
    const r = await j.p.pm.patch(`${P(pid)}/closing-conditions/${cpValid.id}`, { expectedVersion: cpValid.version, validTo: plusDays(30) });
    const refs = ((await event(j.p.pm, 'closings', closing3)).blockers ?? []).map((b: { ref: string }) => b.ref);
    expect(refs, `the lapsed CP stopped blocking after a PATCH of validTo by the CP manager (status ${r.status})`).toContain(cpValid.code);
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-05: a DD answer's evidence document changes after the review; the release discloses the unreviewed version.
  let ddRequest: { id: string; version: number };
  let ddRoom: string;
  let evidenceV1: string;
  let evidenceV2: string;

  it('setup DOM-P4-05: a DD answer with an evidence document (v1) is approved for release; the uploader then adds v2', async () => {
    const ext = await syntheticUser(j.orgId, 'p4dom.ext', 'external');
    await ok(await j.p.legal.post(`${P(pid)}/partners/${partnerId}/contacts`, { userId: ext.userId }));
    ddRoom = (await room(j.p.pm, pid, { name: 'P4 probe DD room (synthetic)', type: 'partner', partnerId })).id;
    await ok(await grant(j.p.legal, pid, ddRoom, { userId: j.p.sponsor.userId, accessLevel: 'manage' }));
    await ok(await grant(j.p.sponsor, pid, ddRoom, { userId: j.p.legal.userId, accessLevel: 'manage' }));
    await ok(await grant(j.p.legal, pid, ddRoom, { userId: j.p.finance.userId, accessLevel: 'contribute' }));
    await ok(await grant(j.p.legal, pid, ddRoom, { userId: ext.userId, role: 'external_partner_limited', accessLevel: 'contribute', expiresAt: in30() }));
    const q = await ok(await ext.post(`${P(pid)}/partner-access/rooms/${ddRoom}/dd-requests`, { question: 'Please provide the synthetic site list.', domain: 'technical' }));
    let d = (await j.p.pm.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    await ok(await j.p.pm.post(`${P(pid)}/diligence-requests/${q.id}/assign`, { expectedVersion: d.version, assigneeUserId: j.p.finance.userId, reviewerUserId: j.p.legal.userId }));
    const ev = await doc(j.p.pm, pid, 'Synthetic site list (probe)', { roomId: ddRoom, text: 'Reviewed content v1 (synthetic)' });
    evidenceV1 = ev.versionId;
    d = (await j.p.finance.get(`${P(pid)}/diligence-requests/${q.id}`).expect(200)).body;
    const drafted = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${q.id}/answer`, { expectedVersion: d.version, answerDraft: 'See the attached synthetic site list.', evidenceDocumentIds: [ev.id] }));
    const sub = await ok(await j.p.finance.post(`${P(pid)}/diligence-requests/${q.id}/submit-for-review`, { expectedVersion: drafted.version }));
    const rev = await ok(await j.p.legal.post(`${P(pid)}/diligence-requests/${q.id}/review`, { expectedVersion: sub.version, outcome: 'approve', note: 'Reviewed with evidence v1 (synthetic)' }));
    expect(rev.releaseStatus).toBe('approved_for_release');
    ddRequest = { id: q.id, version: rev.version };
    // After the review approval, a new version of the evidence document is uploaded (never seen by the reviewer).
    const up = await j.p.pm.upload(`${docsPath(pid)}/${ev.id}/versions`, Buffer.from('UNREVIEWED content v2 (synthetic)'), 'site-list-v2.txt');
    expect(up.status, JSON.stringify(up.body)).toBe(201);
    evidenceV2 = up.body.versionId;
    expect(evidenceV2).not.toBe(evidenceV1);
  });

  probe('DEFECT DOM-P4-05: releasing a reviewed DD answer never discloses an evidence version the reviewer did not see (REQ-JV-010 release after review; spec §8 "disclosed version")', async () => {
    await j.p.legal.post(`${P(pid)}/diligence-requests/${ddRequest.id}/release`, { expectedVersion: ddRequest.version, note: 'Release (probe)' });
    const list = (await j.p.legal.get(`${P(pid)}/partner-rooms/${ddRoom}/disclosures`)).body as { items?: { documentVersionId: string; diligenceRequestId: string | null; status: string }[] };
    const disclosed = (list.items ?? []).filter((x) => x.diligenceRequestId === ddRequest.id && x.status === 'released').map((x) => x.documentVersionId);
    expect(disclosed, 'the release disclosed the evidence version uploaded after the review approval').not.toContain(evidenceV2);
  });

  // -------------------------------------------------------------------------------------------------------------
  // DOM-P4-08: the external approval behind a closing decision rests on evidence later rejected as defective.
  let closing4: { id: string; version: number };
  let decisionE: string;

  it('setup DOM-P4-08: decision E (jv_closing_confirmation) was approved by the authorized body on verified evidence, which is then rejected as defective', async () => {
    const c4 = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name: 'P4 probe closing #4 (synthetic)' }));
    closing4 = { id: c4.id, version: await readyEvent(c4.id) };
    decisionE = await finalDecision(j, 'jv_closing_confirmation');
    const links = (await j.p.pm.get(`${P(pid)}/evidence?targetType=decision&targetId=${decisionE}`).expect(200)).body.items as { id: string; status: string; version: number; reviewedBy: string | null }[];
    const active = links.filter((l) => l.status === 'active' && l.reviewedBy);
    expect(active).toHaveLength(1);
    const rej = await j.p.legal.post(`${P(pid)}/evidence/${active[0]!.id}/verify`, { expectedVersion: active[0]!.version, decision: 'reject', note: 'Board resolution found defective (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    expect(rej.body.status).toBe('rejected');
    const d = (await j.p.pm.get(`${P(pid)}/decisions/${decisionE}`).expect(200)).body;
    expect(d.status).toBe('approved'); // the decision itself is unchanged
  });

  probe('DEFECT DOM-P4-08: a closing is not confirmed on an external approval whose only evidence was rejected as defective (DOM-P2-12 carried into P4; spec §3 defective evidence → controlled reassessment)', async () => {
    const req = await j.p.pm.post(`${P(pid)}/transaction-events/${closing4.id}/request-confirmation`, { expectedVersion: closing4.version, decisionId: decisionE });
    if (req.status === 201) await j.p.sponsor.post(`${P(pid)}/closings/${closing4.id}/confirm`, { expectedVersion: req.body.version, note: 'Confirmation on rejected evidence (probe)' });
    const c4 = await event(j.p.pm, 'closings', closing4.id);
    expect(c4.status, `closing confirmed on an external approval whose evidence was rejected (request ${req.status})`).not.toBe('confirmed');
  });
});
