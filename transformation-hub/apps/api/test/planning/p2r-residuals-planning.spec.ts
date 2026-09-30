import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, Client, DC, loginAs, owner, projectIdByCode } from '../helpers';
import { createProject, grant, workstreams } from './fixtures';
import { Actors, P, actors, decisionVersion, openMeeting, setupCommittee, tabledDecision, uniq, verifiedDecisionEvidence, voteOutstanding } from '../governance/gov-fixtures';

/**
 * P2 residuals — planning (docs/phases/P2-P4-requirement-disposition.md, "Update at the P2 gate"):
 *  REQ-WS-003 a workstream without an accountable workstream lead is flagged in the data-quality issues;
 *  REQ-UX-018 My Work item types for agenda screening, external-authority recording and claim reviews — each offered only
 *             to someone the command would accept, never to a person it would refuse (the refusal is exercised too).
 * Synthetic test data only.
 */

interface WorkItem {
  type: string;
  projectId: string;
  entityId: string;
  code: string | null;
  title: string;
  status: string;
  linkPath: string;
}
const myWork = async (c: Client, projectId: string) => ((await c.get('/api/v1/me/work').expect(200)).body.items as WorkItem[]).filter((i) => i.projectId === projectId);
const offered = async (c: Client, projectId: string, type: string, entityId: string) => (await myWork(c, projectId)).find((i) => i.type === type && i.entityId === entityId) ?? null;

afterAll(async () => {
  await closeApp();
  await closePools();
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-WS-003
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-WS-003 — a workstream without an accountable workstream lead is flagged in data quality', () => {
  let pid: string;
  let pm: Client;
  let lead: Client;

  beforeAll(async () => {
    const admin = await loginAs('portfolio.admin');
    pm = await loginAs('pm');
    lead = await loginAs('ops.lead');
    pid = await createProject(admin, pm, 'WS003-P2R');
    // A lead must be a member of the project (the assignment command checks it).
    await grant(admin, pid, lead, 'contributor');
  }, 300_000);

  const health = async () => (await pm.get(`/api/v1/projects/${pid}/progress`).expect(200)).body as { workstreams: { id: string; code: string; leadName: string | null; dataQuality: string[]; dataQualityI18n: { code: string }[] }[] };

  it('every workstream created without a lead carries the no-accountable-lead flag (plan.dq.no_lead) in its data-quality list', async () => {
    const h = await health();
    expect(h.workstreams.length).toBeGreaterThan(1);
    for (const w of h.workstreams) {
      expect(w.leadName, w.code).toBeNull();
      expect(w.dataQualityI18n.map((m) => m.code), w.code).toContain('plan.dq.no_lead');
      expect(w.dataQuality, w.code).toContain('No accountable workstream lead');
      // One English line per code, same order (the web translates the codes).
      expect(w.dataQuality.length).toBe(w.dataQualityI18n.length);
    }
  });

  it('assigning the accountable lead clears the flag for that workstream only', async () => {
    const ws = await workstreams(pm, pid);
    const ws01 = ws.get('WS01')!;
    const r = await pm.post(`/api/v1/projects/${pid}/workstreams/${ws01.id}/lead`, { userId: lead.userId, expectedVersion: ws01.version });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const h = await health();
    const w1 = h.workstreams.find((w) => w.code === 'WS01')!;
    expect(w1.leadName).not.toBeNull();
    expect(w1.dataQualityI18n.map((m) => m.code)).not.toContain('plan.dq.no_lead');
    const w2 = h.workstreams.find((w) => w.code === 'WS02')!;
    expect(w2.dataQualityI18n.map((m) => m.code)).toContain('plan.dq.no_lead');
    const lead01 = await owner().query(`select lead_user_id from workstream where id = $1`, [ws01.id]);
    expect(lead01.rows[0].lead_user_id).toBe(lead.userId);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
// REQ-UX-018
// ---------------------------------------------------------------------------------------------------------------------

describe('REQ-UX-018 — My Work offers agenda screening, external-authority recording and claim reviews only to someone the command would accept', () => {
  let pid: string;
  let a: Actors;

  beforeAll(async () => {
    pid = await projectIdByCode(DC);
    a = await actors();
  }, 300_000);

  describe('agenda screening (secretariat)', () => {
    let committeeId: string;
    let meetingId: string;

    beforeAll(async () => {
      committeeId = (await setupCommittee(pid, a, { name: uniq('My Work screening committee (UX-018 test)'), matrix: false })).id;
      meetingId = (await a.secretary.post(`${P(pid)}/committees/${committeeId}/meetings`, { title: uniq('My Work meeting (UX-018 test)'), scheduledAt: '2027-04-04T07:00:00.000Z' }).expect(201)).body.id;
    }, 300_000);

    it('a request awaiting screening is offered to the secretariat, not to the requester or roles without the screening permission', async () => {
      const title = uniq('Request to screen (UX-018 test)');
      const r = (await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId, title, kind: 'discussion', meetingId }).expect(201)).body;
      const item = await offered(a.secretary, pid, 'agenda_screening', r.id);
      expect(item).toMatchObject({ status: 'requested', title });
      // The link opens the agenda-request register filtered on the request (where the secretariat screens it).
      expect(item!.linkPath.startsWith(`/projects/${pid}/committee/meetings?aStatus=requested&aq=`)).toBe(true);
      for (const c of [a.pm, a.chair, a.sponsor, a.finance]) expect(await offered(c, pid, 'agenda_screening', r.id), c.persona).toBeNull();
      // The command accepts the person it was offered to; the item then leaves My Work.
      const s = await a.secretary.post(`${P(pid)}/agenda-requests/${r.id}/screen`, { expectedVersion: r.version, outcome: 'defer', note: 'Next meeting (synthetic)' });
      expect(s.status, JSON.stringify(s.body)).toBe(201);
      expect(await offered(a.secretary, pid, 'agenda_screening', r.id)).toMatchObject({ status: 'deferred' });
      const acc = await a.secretary.post(`${P(pid)}/agenda-requests/${r.id}/screen`, { expectedVersion: s.body.version, outcome: 'accept', meetingId });
      expect(acc.status, JSON.stringify(acc.body)).toBe(201);
      expect(await offered(a.secretary, pid, 'agenda_screening', r.id)).toBeNull();
    });

    it("the secretariat's own request is never offered to them — the screening command would refuse it (403)", async () => {
      const own = (await a.secretary.post(`${P(pid)}/agenda-requests`, { committeeId, title: uniq('Own request (UX-018 test)'), kind: 'information', meetingId }).expect(201)).body;
      expect(await offered(a.secretary, pid, 'agenda_screening', own.id)).toBeNull();
      expect((await a.secretary.post(`${P(pid)}/agenda-requests/${own.id}/screen`, { expectedVersion: own.version, outcome: 'accept', meetingId })).status).toBe(403);
    });
  });

  describe('external-authority recording (the role that records it)', () => {
    let decisionId: string;

    beforeAll(async () => {
      const tc = await setupCommittee(pid, a, { name: uniq('My Work external committee (UX-018 test)') });
      const m = await openMeeting(pid, a, tc, ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver']);
      decisionId = (await tabledDecision(pid, a, a.pm, tc.id, m.id, { decisionTypeKey: 'jv_signing_authorization', amount: null, requiredAuthority: 'Board of Directors — to be confirmed' })).id;
      await voteOutstanding(pid, a, decisionId, 'approve');
      const r = await a.secretary.post(`${P(pid)}/decisions/${decisionId}/record-outcome`, { expectedVersion: await decisionVersion(a.secretary, pid, decisionId) });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(r.body.status).toBe('recommended');
    }, 300_000);

    it('no one is offered the recording while no verified evidence exists (the command would refuse: evidence required)', async () => {
      for (const c of [a.chair, a.secretary]) expect(await offered(c, pid, 'external_approval_recording', decisionId), c.persona).toBeNull();
      const r = await a.chair.post(`${P(pid)}/decisions/${decisionId}/record-external-approval`, { expectedVersion: await decisionVersion(a.chair, pid, decisionId), externalReference: 'DEMO-REF (synthetic)' });
      expect(r.status).toBe(422);
      expect(r.body.code).toBe('governance.external.evidence_required');
    });

    it('with verified evidence it is offered to the chair, never to the recorder of the recommendation (who would be refused)', async () => {
      const evidenceLinkId = await verifiedDecisionEvidence(pid, a.pm, a.legal, decisionId);
      expect(await offered(a.chair, pid, 'external_approval_recording', decisionId)).toMatchObject({ status: 'recommended', linkPath: `/projects/${pid}/committee/decisions/${decisionId}` });
      for (const c of [a.secretary, a.pm, a.legal, a.sponsor]) expect(await offered(c, pid, 'external_approval_recording', decisionId), c.persona).toBeNull();
      const refused = await a.secretary.post(`${P(pid)}/decisions/${decisionId}/record-external-approval`, { expectedVersion: await decisionVersion(a.secretary, pid, decisionId), externalReference: 'DEMO-REF (synthetic)', evidenceLinkId });
      expect(refused.status).toBe(422);
      expect(refused.body.code).toBe('governance.approval.same_recorder');
      const ok = await a.chair.post(`${P(pid)}/decisions/${decisionId}/record-external-approval`, { expectedVersion: await decisionVersion(a.chair, pid, decisionId), externalReference: 'DEMO-REF (synthetic)', evidenceLinkId });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      expect(await offered(a.chair, pid, 'external_approval_recording', decisionId)).toBeNull();
    });
  });

  describe('claim reviews', () => {
    let sourceId: string;
    const S = () => `${P(pid)}/sources`;

    beforeAll(async () => {
      sourceId = (await a.secretary.post(S(), { sourceType: 'minutes', filename: 'synthetic-minutes-ux018.pdf', extractionStatus: 'performed', classification: 'internal' }).expect(201)).body.id;
    }, 300_000);

    const claim = async (author: Client) => {
      const r = await author.post(`${S()}/${sourceId}/claims`, { location: 'Page 2 (synthetic)', subject: uniq('Synthetic claim (UX-018 test)'), extractedValue: 'value (synthetic)', verificationStatus: 'proposed' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      return r.body.id as string;
    };

    it('an unreviewed claim is offered to verifiers other than its author; the author (who would be refused) is not offered it', async () => {
      const id = await claim(a.secretary);
      for (const c of [a.finance, a.legal, a.approver]) expect(await offered(c, pid, 'claim_review', id), c.persona).toMatchObject({ status: 'proposed', linkPath: `/projects/${pid}/documents/sources/${sourceId}` });
      expect(await offered(a.secretary, pid, 'claim_review', id)).toBeNull();
      expect(await offered(a.pm, pid, 'claim_review', id)).toBeNull();
      expect((await a.secretary.post(`${P(pid)}/claims/${id}/review`, { expectedVersion: 1, verificationStatus: 'confirmed', confirmedValue: 'value (synthetic)' })).status).toBe(403);
      const ok = await a.finance.post(`${P(pid)}/claims/${id}/review`, { expectedVersion: 1, verificationStatus: 'confirmed', confirmedValue: 'value (synthetic)', note: 'Checked (synthetic)' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
      for (const c of [a.finance, a.legal]) expect(await offered(c, pid, 'claim_review', id), c.persona).toBeNull();
    });

    it('a claim flagged conflicting is offered again for review (to a verifier the command accepts)', async () => {
      const x = await claim(a.pm);
      const y = await claim(a.pm);
      const r = await a.finance.post(`${P(pid)}/claims/${x}/review`, { expectedVersion: 1, verificationStatus: 'conflicting', conflictWithClaimId: y, note: 'The two claims disagree (synthetic)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await offered(a.legal, pid, 'claim_review', x)).toMatchObject({ status: 'conflicting' });
      expect(await offered(a.legal, pid, 'claim_review', y)).toMatchObject({ status: 'conflicting' });
      const ok = await a.legal.post(`${P(pid)}/claims/${x}/review`, { expectedVersion: r.body.version, verificationStatus: 'confirmed', confirmedValue: 'value (synthetic)' });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });
  });
});
