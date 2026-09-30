import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DomainError } from '@hub/domain';
import { closeApp, closePools, getApp, owner, Client } from '../helpers';
import { JobContextFactory } from '../../src/platform/jobs/job-context';
import { DbService } from '../../src/platform/db.service';
import { GatesService } from '../../src/modules/gates/gates.service';
import { setupProject, setupGovernance, gateDecision, gateByKey, crit, addEvidence, meetAllMandatory, Personas, Gov } from './gate-test-kit';

/**
 * DOM-P2-16 (REQ-LCY-010; docs/reviews/P2-domain-review.md) — gate-level owner and reviewer roles are enforced:
 *  - OWNER commands (start, mark ready, back to assessment, link decision) need the gate's owner role or the project manager
 *    (access-matrix §2.4 own_workstream); a workstream lead owns G1 through its workstream, but not the legal-owned G2;
 *  - the gate's designated REVIEWER role endorses or returns the assessment while the cycle is in assessment — never the
 *    person who started the cycle (fail closed when unknown);
 *  - mark ready needs an endorsement recorded after the cycle's last criterion change, by someone other than the submitter;
 *  - decide is refused to the submitter and to the gate reviewer; My Work offers `gate_review` to the designated reviewer.
 * The sponsor persona also holds `project_manager` in this project: it can act as G0/G1 owner (PM override) and as their
 * gate reviewer, and it is the G0 approver — so both separation-of-duties rules at decision time can be exercised.
 */
let projectId: string;
let orgId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-ROLES', [['sponsor', 'project_manager']]));
  gov = await setupGovernance(projectId, p);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

const url = (gateId: string, cmd: string) => `/api/v1/projects/${projectId}/gates/${gateId}/assessment/${cmd}`;
const row = async (assessmentId: string) =>
  (await owner().query(`select status, started_by, started_at, submitted_by, reviewed_by, review_outcome, review_note, review_basis, version from gate_assessment where id = $1`, [assessmentId])).rows[0];
const denied = async (action: string, actor: Client, code: string) =>
  (await owner().query(`select 1 from audit_event where project_id = $1 and action = $2 and outcome = 'denied' and actor_user_id = $3 and reason like $4`, [projectId, action, actor.userId, `${code}%`])).rowCount;
type WorkItem = { type: string; entityId: string; code: string | null; status: string; projectId: string; linkPath: string };
const myWork = async (c: Client) => ((await c.get('/api/v1/me/work').expect(200)).body.items as WorkItem[]).filter((i) => i.projectId === projectId);
const review = (c: Client, gateId: string, version: number, outcome: 'endorse' | 'return', note = 'Gate assessment reviewed (synthetic)') => c.post(url(gateId, 'review'), { expectedVersion: version, outcome, note });

describe('DOM-P2-16 — gate owner role on the owner commands [REQ-LCY-010]', () => {
  it('a workstream lead can submit G1 but not G2: 403 gates.not_gate_owner (audited, nothing changed); the legal owner starts G2', async () => {
    const g2 = await gateByKey(p.pm, projectId, 'G2');
    expect(g2.ownerRole).toBe('legal_restricted');
    const wsl = await p.techLead.post(url(g2.id, 'start'), { expectedVersion: g2.assessment.version });
    expect(wsl.status).toBe(403);
    expect(wsl.body.code).toBe('gates.not_gate_owner');
    expect(await denied('gates.startAssessment', p.techLead, 'gates.not_gate_owner')).toBe(1);
    // the secretary holds gates.assessment.submit too (G0 owner), but does not own G2
    const sec = await p.secretary.post(url(g2.id, 'start'), { expectedVersion: g2.assessment.version });
    expect(sec.status).toBe(403);
    expect(sec.body.code).toBe('gates.not_gate_owner');
    // a contributor does not hold the permission at all
    const con = await p.contributor.post(url(g2.id, 'start'), { expectedVersion: g2.assessment.version });
    expect(con.status).toBe(403);
    expect(con.body.code).toBe('policy.forbidden');
    expect((await row(g2.assessment.id)).status).toBe('not_started');
    const ok = await p.legal.post(url(g2.id, 'start'), { expectedVersion: g2.assessment.version });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(await row(g2.assessment.id)).toMatchObject({ status: 'in_assessment', started_by: p.legal.userId });
    const audit = await owner().query(`select actor_user_id, after from audit_event where project_id = $1 and action = 'gates.assessment.start' and entity_id = $2`, [projectId, g2.assessment.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: p.legal.userId, after: { startedBy: p.legal.userId, ownerRole: 'legal_restricted', gateKey: 'G2' } });
  });

  it('the workstream lead owns G4 through its workstream; a PM acts as owner of any gate (G1, owner override); others may not link a decision', async () => {
    const g4 = await gateByKey(p.pm, projectId, 'G4');
    expect(g4.ownerRole).toBe('workstream_lead');
    const wsl = await p.techLead.post(url(g4.id, 'start'), { expectedVersion: g4.assessment.version });
    expect(wsl.status, JSON.stringify(wsl.body)).toBe(201);
    expect((await row(g4.assessment.id)).started_by).toBe(p.techLead.userId);
    // access-matrix §2.4: owner OR project manager — the sponsor holds project_manager in this project
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.ownerRole).toBe('workstream_lead');
    const pm = await p.sponsor.post(url(g1.id, 'start'), { expectedVersion: g1.assessment.version });
    expect(pm.status, JSON.stringify(pm.body)).toBe(201);
    expect((await row(g1.assessment.id)).started_by).toBe(p.sponsor.userId);
    const d = await gateDecision(projectId, p, gov, 'G1', { vote: false });
    const link = await p.secretary.post(url(g1.id, 'link-decision'), { expectedVersion: pm.body.version, decisionId: d.id });
    expect(link.status).toBe(403);
    expect(link.body.code).toBe('gates.not_gate_owner');
    const owned = await p.techLead.post(url(g1.id, 'link-decision'), { expectedVersion: pm.body.version, decisionId: d.id });
    expect(owned.status, JSON.stringify(owned.body)).toBe(201);
    expect((await gateByKey(p.pm, projectId, 'G1')).assessment.decisionId).toBe(d.id);
  });

  it('an AI / service identity can neither start nor review a gate (human only)', async () => {
    const app = await getApp();
    const ctx = await app.get(JobContextFactory).forService({ org_id: orgId, project_id: projectId, id: 'dom-p2-16-test' }, 'svc-ai-pm', ['gates.gate.read', 'gates.assessment.submit', 'gates.assessment.review']);
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const gates = app.get(GatesService);
    for (const fn of [
      () => gates.startAssessment(ctx, projectId, g0.id, { expectedVersion: g0.assessment.version }),
      () => gates.reviewAssessment(ctx, projectId, g0.id, { expectedVersion: g0.assessment.version, outcome: 'return', note: 'AI review attempt' }),
    ]) {
      const err = await app
        .get(DbService)
        .run(ctx, fn)
        .then(
          () => null,
          (e: unknown) => e,
        );
      expect(err).toBeInstanceOf(DomainError);
      expect((err as DomainError).code).toBe('gates.human_only');
    }
    expect((await row(g0.assessment.id)).status).toBe('not_started');
  });
});

describe('DOM-P2-16 — gate-level review, submission and decision (G0: owner secretary, reviewer PM, approver sponsor) [REQ-LCY-010]', () => {
  it('the review needs the designated gate reviewer role (403) and a cycle in assessment (422)', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    expect([g0.ownerRole, g0.reviewerRole, g0.approverRole]).toEqual(['secretary_cpmo', 'project_manager', 'sponsor']);
    const early = await review(p.pm, g0.id, g0.assessment.version, 'return');
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('gates.review.invalid_state');
    await p.secretary.post(url(g0.id, 'start'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review).toMatchObject({ state: 'not_reviewed', reviewerRole: 'project_manager', startedBy: p.secretary.userId, startedByName: 'Demo Secretary / CPMO' });
    // finance holds gates.assessment.review (criterion reviews) but is not the G0 gate reviewer
    const fin = await review(p.finance, g0.id, g0.assessment.version, 'return');
    expect(fin.status).toBe(403);
    expect(fin.body.code).toBe('gates.not_designated_gate_reviewer');
    expect(await denied('gates.reviewAssessment', p.finance, 'gates.not_designated_gate_reviewer')).toBe(1);
    const con = await review(p.contributor, g0.id, g0.assessment.version, 'return');
    expect(con.status).toBe(403);
    expect(con.body.code).toBe('policy.forbidden');
    expect((await row(g0.assessment.id)).review_outcome).toBeNull();
  });

  it('an endorsement needs every criterion satisfied (422); a return is recorded on the cycle and audited', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const endorse = await review(p.pm, g0.id, g0.assessment.version, 'endorse');
    expect(endorse.status).toBe(422);
    expect(endorse.body.code).toBe('gates.review.criteria_incomplete');
    const ret = await review(p.pm, g0.id, g0.assessment.version, 'return', 'Evidence for C01–C07 is still missing (synthetic)');
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    expect(ret.body).toMatchObject({ status: 'in_assessment', reviewState: 'returned' });
    expect(await row(g0.assessment.id)).toMatchObject({ status: 'in_assessment', reviewed_by: p.pm.userId, review_outcome: 'return', review_note: 'Evidence for C01–C07 is still missing (synthetic)' });
    const audit = await owner().query(`select actor_user_id, reason, after from audit_event where project_id = $1 and action = 'gates.assessment.review_return' and entity_id = $2`, [projectId, g0.assessment.id]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_user_id: p.pm.userId, reason: 'Evidence for C01–C07 is still missing (synthetic)', after: { reviewOutcome: 'return', reviewerRole: 'project_manager', gateKey: 'G0', startedBy: p.secretary.userId } });
  });

  it('a returned cycle cannot be submitted (422); once complete it is offered in My Work to the designated reviewers, not the starter', async () => {
    await meetAllMandatory(p, projectId, 'G0');
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.evaluation.ready).toBe(true);
    expect(g0.review.state).toBe('returned');
    const r = await p.secretary.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.assessment.review_returned');
    const item = (await myWork(p.pm)).find((i) => i.type === 'gate_review' && i.entityId === g0.assessment.id);
    expect(item).toMatchObject({ code: 'G0', status: 'returned', linkPath: `/projects/${projectId}/gates/${g0.id}` });
    expect((await myWork(p.sponsor)).some((i) => i.type === 'gate_review' && i.entityId === g0.assessment.id)).toBe(true); // also a PM here
    expect((await myWork(p.secretary)).some((i) => i.type === 'gate_review')).toBe(false); // the starter
    expect((await myWork(p.finance)).some((i) => i.type === 'gate_review')).toBe(false); // not the gate reviewer role
  });

  it('mark ready is refused without a current endorsement (422) and to the endorsing reviewer (403); a later criterion change makes it stale', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    const ok = await review(p.pm, g0.id, g0.assessment.version, 'endorse', 'All G0 criteria evidenced and accepted (synthetic)');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.reviewState).toBe('endorsed');
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review).toMatchObject({ state: 'endorsed', outcome: 'endorse', reviewedBy: p.pm.userId, reviewedByName: 'Demo Project Manager', note: 'All G0 criteria evidenced and accepted (synthetic)' });
    expect((await myWork(p.pm)).some((i) => i.type === 'gate_review' && i.entityId === g0.assessment.id)).toBe(false);
    const endorseAudit = await owner().query(`select after from audit_event where project_id = $1 and action = 'gates.assessment.review_endorse' and entity_id = $2`, [projectId, g0.assessment.id]);
    expect(endorseAudit.rows).toHaveLength(1);
    expect(endorseAudit.rows[0].after.reviewBasis).toBe((await row(g0.assessment.id)).review_basis);

    // the PM may act as owner (override), but not submit an assessment it endorsed itself
    const self = await p.pm.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version });
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('gates.assessment.reviewer_cannot_submit');
    expect(await denied('gates.markReady', p.pm, 'gates.assessment.reviewer_cannot_submit')).toBe(1);

    // a criterion change after the endorsement (new evidence on G0-C08) makes it stale
    await addEvidence(p.pm, projectId, crit(g0, 'G0-C08').id, 'Stakeholder map (synthetic) added after the review');
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review.state).toBe('stale');
    const stale = await p.secretary.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version });
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('gates.assessment.review_stale');
    expect((await myWork(p.pm)).find((i) => i.type === 'gate_review' && i.entityId === g0.assessment.id)?.status).toBe('stale');
    // … and so does a change of a criterion's status
    const c08 = crit(g0, 'G0-C08');
    await p.secretary.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c08.id}/review`, { expectedVersion: c08.assessment.version, outcome: 'met', note: 'Accepted (synthetic)' }).expect(201);
    expect((await gateByKey(p.pm, projectId, 'G0')).review.state).toBe('stale');
    expect((await row(g0.assessment.id)).status).toBe('in_assessment');
  });

  it('the decision is refused to the gate reviewer and to the submitter (403); approved when both are someone else', async () => {
    // The sponsor (also a PM here) endorses the current state; the secretary (owner) submits.
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    await review(p.sponsor, g0.id, g0.assessment.version, 'endorse').expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.secretary.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(await row(g0.assessment.id)).toMatchObject({ status: 'ready_for_decision', submitted_by: p.secretary.userId, reviewed_by: p.sponsor.userId });
    const d = await gateDecision(projectId, p, gov, 'G0', { externalApproval: true });
    expect(d.status).toBe('approved');
    const decide = (version: number) => p.sponsor.post(url(g0.id, 'decide'), { expectedVersion: version, outcome: 'approve', decisionId: d.id, note: 'G0 approval (synthetic)' });
    const asReviewer = await decide(g0.assessment.version);
    expect(asReviewer.status).toBe(403);
    expect(asReviewer.body.code).toBe('policy.forbidden'); // not_self: the sponsor endorsed this assessment
    expect((await row(g0.assessment.id)).status).toBe('ready_for_decision');

    // PM override: the PM sends it back and endorses; the sponsor (as PM) submits → still refused (submitter).
    await p.pm.post(url(g0.id, 'back-to-assessment'), { expectedVersion: g0.assessment.version, note: 'Re-review (synthetic)' }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review.state).toBe('endorsed'); // nothing changed: the sponsor's endorsement is still current
    await review(p.pm, g0.id, g0.assessment.version, 'endorse').expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.sponsor.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const asSubmitter = await decide(g0.assessment.version);
    expect(asSubmitter.status).toBe(403);
    expect(asSubmitter.body.code).toBe('policy.forbidden');

    // The PM sends it back; the secretary submits on the PM's (still current) endorsement; the sponsor decides.
    await p.pm.post(url(g0.id, 'back-to-assessment'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.secretary.post(url(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const ok = await decide(g0.assessment.version);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const snap = (await owner().query(`select status, evaluation from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    expect(snap.status).toBe('approved');
    expect(snap.evaluation.atDecision.review).toMatchObject({ startedBy: p.secretary.userId, submittedBy: p.secretary.userId, reviewedBy: p.pm.userId, outcome: 'endorse' });
  });
});


describe('DOM-P2-16 — the gate reviewer is never the person who started the cycle (G1: owner workstream lead, reviewer PM) [REQ-LCY-010]', () => {
  it('a PM who started the cycle (owner override) cannot review it (403); an unknown starter fails closed (403 policy.sod_subject_unknown)', async () => {
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.review).toMatchObject({ reviewerRole: 'project_manager', startedBy: p.sponsor.userId });
    // the sponsor holds project_manager (the G1 reviewer role) and started G1 as owner override → not its reviewer
    const self = await review(p.sponsor, g1.id, g1.assessment.version, 'return');
    expect(self.status).toBe(403);
    expect(self.body.code).toBe('policy.forbidden');
    expect(await denied('gates.reviewAssessment', p.sponsor, 'policy.forbidden')).toBe(1);
    // a starter the platform cannot establish (a state the API never produces) fails closed for every reviewer
    await owner().query(`update gate_assessment set started_by = null, started_at = null where id = $1`, [g1.assessment.id]);
    const unknown = await review(p.pm, g1.id, g1.assessment.version, 'return');
    expect(unknown.status).toBe(403);
    expect(unknown.body.code).toBe('policy.sod_subject_unknown');
    await owner().query(`update gate_assessment set started_by = $2, started_at = now() where id = $1`, [g1.assessment.id, p.sponsor.userId]);
    expect((await row(g1.assessment.id)).review_outcome).toBeNull();
  });

  it('with G0 approved and G1 complete: offered to the PM (not the starter), endorsed by the PM, submitted by the workstream lead; the chair gets the decision', async () => {
    expect((await gateByKey(p.pm, projectId, 'G0')).assessment.status).toBe('approved');
    await meetAllMandatory(p, projectId, 'G1');
    let g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.evaluation.ready).toBe(true);
    const unreviewed = await p.techLead.post(url(g1.id, 'mark-ready'), { expectedVersion: g1.assessment.version });
    expect(unreviewed.status).toBe(422);
    expect(unreviewed.body.code).toBe('gates.assessment.review_required');
    expect((await myWork(p.pm)).some((i) => i.type === 'gate_review' && i.entityId === g1.assessment.id && i.status === 'not_reviewed')).toBe(true);
    expect((await myWork(p.sponsor)).some((i) => i.type === 'gate_review' && i.entityId === g1.assessment.id)).toBe(false); // started it
    await review(p.pm, g1.id, g1.assessment.version, 'endorse').expect(201);
    g1 = await gateByKey(p.pm, projectId, 'G1');
    const sub = await p.techLead.post(url(g1.id, 'mark-ready'), { expectedVersion: g1.assessment.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    expect(await row(g1.assessment.id)).toMatchObject({ status: 'ready_for_decision', submitted_by: p.techLead.userId, reviewed_by: p.pm.userId, started_by: p.sponsor.userId });
    expect((await myWork(p.chair)).some((i) => i.type === 'gate_decision' && i.entityId === g1.assessment.id)).toBe(true);
    const mark = await owner().query(`select after from audit_event where project_id = $1 and action = 'gates.assessment.mark_ready' and entity_id = $2`, [projectId, g1.assessment.id]);
    expect(mark.rows).toHaveLength(1);
    expect(mark.rows[0].after).toMatchObject({ submittedBy: p.techLead.userId, reviewedBy: p.pm.userId });
  });
});
