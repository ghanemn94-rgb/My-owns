import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, decisionOfType, drainWorker, plusDays, setupGovernance, setupProject, tsa, Gov, Personas } from '../readiness/readiness-kit';
import { decisionVersion, vote } from '../governance/gov-fixtures';

/**
 * P3/P4 DOMAIN RE-REVIEW, RE-CHECK OF DOM-P34R2-01 (lead request; docs/reviews/P3-P4-domain-rereview.md §9.10). The fix binds
 * extension terms to a decision for the FIRST time only while its status is draft / submitted / under_review
 * (`tsa.extension.terms_after_outcome` otherwise). Equivalent paths:
 *  - a paper deferred and resumed — `resume` opens a NEW vote round (`voteRound + 1`), so terms bound then are before the
 *    committee's next vote (CONTROL);
 *  - a paper whose committee has already cast every vote of the round, the outcome not yet recorded — the status is still
 *    `under_review`, so terms the voters never had can be bound between the last vote and the outcome (DEFECT).
 *
 * `DEFECT …` is declared with `it.fails` while open (`P34DRE_PROBE_PLAIN=1` runs it plain); `CONTROL …` is a plain test.
 * All data is synthetic.
 */
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R3-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);
const decisionRow = async (id: string) => (await owner().query(`select status, vote_round, version from decision where id = $1`, [id])).rows[0] as { status: string; vote_round: number; version: number };

/** A complete TSA whose terms are approved on its own FINAL decision, then activated. */
async function activeTsa(name: string, startDate: string, endDate: string) {
  const c = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: 'Out-of-hours monitoring of the transferred halls (synthetic)',
    startDate,
    endDate,
    ownerUserId: p.approver.userId,
    replacementService: 'NewCo monitoring platform (synthetic)',
    exitMilestones: [{ title: 'Replacement monitoring accepted with evidence (synthetic)' }],
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.id as string;
  const neg = await cmd(id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
  expect(neg.status, JSON.stringify(neg.body)).toBe(201);
  const terms = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
  const ap = await cmd(id, 'approve', { expectedVersion: neg.body.version, decisionId: terms.id });
  expect(ap.status, JSON.stringify(ap.body)).toBe(201);
  const act = await cmd(id, 'transition', { expectedVersion: ap.body.version, command: 'activate' });
  expect(act.status, JSON.stringify(act.body)).toBe(201);
  return id;
}

describe('P3/P4 domain re-review, re-check of DOM-P34R2-01 — when extension terms may first be bound [AT-10, REQ-TSA-005, business-gates.md §6 rule 5]', () => {
  it('CONTROL: a deferred paper binds no terms (422 tsa.extension.terms_after_outcome); resumed, it opens a new vote round and the request binds before that vote', async () => {
    const id = await activeTsa('Monitoring bridge D (re-check probe, synthetic)', plusDays(-60), plusDays(20));
    const paper = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    let d = await decisionRow(paper.id);
    const deferred = await p.secretary.post(`${P(projectId)}/decisions/${paper.id}/defer`, { expectedVersion: d.version, note: 'Deferred to the next meeting (probe, synthetic)' });
    expect(deferred.status, JSON.stringify(deferred.body)).toBe(201);
    let t = await tsa(p.pm, projectId, id);
    const whileDeferred = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: paper.id, proposedEndDate: plusDays(110), continuityPlan: 'Keep the legacy bridge (synthetic)' });
    expect(whileDeferred.status, JSON.stringify(whileDeferred.body)).toBe(422);
    expect(whileDeferred.body.code).toBe('tsa.extension.terms_after_outcome');
    d = await decisionRow(paper.id);
    const roundBefore = d.vote_round;
    const resumed = await p.secretary.post(`${P(projectId)}/decisions/${paper.id}/resume`, { expectedVersion: d.version, meetingId: gov.meetingId, note: 'Back on the agenda (probe, synthetic)' });
    expect(resumed.status, JSON.stringify(resumed.body)).toBe(201);
    d = await decisionRow(paper.id);
    expect(d.status).toBe('under_review');
    expect(d.vote_round).toBe(roundBefore + 1);
    t = await tsa(p.pm, projectId, id);
    const afterResume = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: paper.id, proposedEndDate: plusDays(110), continuityPlan: 'Keep the legacy bridge (synthetic)' });
    expect(afterResume.status, JSON.stringify(afterResume.body)).toBe(201);
  });

  defect('DEFECT DOM-P34R3-01: every committee vote of the round is cast (approve) with no terms bound; the PM binds an end date before the outcome is recorded; the TSA is extended to it', async () => {
    const id = await activeTsa('Facility service E (re-check probe, synthetic)', plusDays(-30), plusDays(25));
    const paper = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    const v = await decisionVersion(p.chair, projectId, paper.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
      const r = await vote(projectId, p[k], paper.id, 'approve', v);
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const votedAt = (await owner().query(`select max(created_at)::text as t, count(*)::int as n from vote where decision_id = $1`, [paper.id])).rows[0];
    const Y = plusDays(3200);
    let t = await tsa(p.pm, projectId, id);
    const req = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: paper.id, proposedEndDate: Y, continuityPlan: 'Keep the legacy bridge (synthetic)' });
    const out = await p.secretary.post(`${P(projectId)}/decisions/${paper.id}/record-outcome`, { expectedVersion: v });
    t = await tsa(p.pm, projectId, id);
    const rec = req.status === 201 && out.status === 201 ? await cmd(id, 'record-extension', { expectedVersion: t.version, note: 'Extension per the approved decision (probe)' }) : req;
    const final = await tsa(p.pm, projectId, id);
    const terms = (await owner().query(`select proposed_end_date::text as end_date, created_at::text as bound_at from tsa_extension_terms where decision_id = $1`, [paper.id])).rows;
    // Required (business-gates.md §6 rule 5 as amended for DOM-P34R2-01: "terms are bound … only while its paper is before the
    // committee", so that "the paper carries the end date and continuity plan it approves"; AT-10; REQ-TSA-005): terms bound
    // after the committee cast its votes on the paper were never before the voters — they back no extension (refused, or a new
    // vote round is required).
    expect(
      final.endDate,
      `votes ${JSON.stringify(votedAt)}; request ${req.status} ${JSON.stringify(req.body)}; outcome ${out.status} ${out.body.status}; record ${rec.status} ${JSON.stringify(rec.body)}; TSA ${final.status} end ${final.endDate}; bound terms ${JSON.stringify(terms)}`,
    ).not.toBe(Y);
  });
});
