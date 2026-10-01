import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, check, clock, createCheck, decisionOfType, drainWorker, insertSite, plusDays, runExpirySchedule, setupGovernance, setupProject, tsa, Gov, Personas } from './readiness-kit';

/**
 * Fixes of the P3 domain review for TSA services and Day-1 descriptive fields (docs/reviews/P3-domain-review.md):
 * DOM-P3-06 / -13 / -07 (what an extension decision authorizes), and the code-review findings DOM-P3-15 (descriptive fields
 * that feed rules), DOM-P3-16 (summary counts expired waivers as cleared) and DOM-P3-17 (TSA guards). The tests of the
 * code-review findings were written first and failed before the fix. All data is synthetic.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3FIX-TSA'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  (await clock()).setFixed(null);
  await drainWorker();
  await closeApp();
  await closePools();
});

const cmd = (id: string, path: string, body: Record<string, unknown>) => p.pm.post(`${P(projectId)}/tsa-services/${id}/${path}`, body);

/** A complete TSA, terms approved on its own FINAL decision; activated unless `activate: false`. */
async function approvedTsa(name: string, startDate: string, endDate: string, opts: { activate?: boolean } = {}) {
  const c = await p.pm.post(`${P(projectId)}/tsa-services`, {
    name,
    scope: 'Out-of-hours monitoring (synthetic)',
    startDate,
    endDate,
    ownerUserId: p.approver.userId,
    replacementService: 'NewCo monitoring platform (synthetic)',
    exitMilestones: [{ title: 'Replacement accepted with evidence (synthetic)' }],
  });
  expect(c.status, JSON.stringify(c.body)).toBe(201);
  const id = c.body.id as string;
  const neg = await cmd(id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
  expect(neg.status, JSON.stringify(neg.body)).toBe(201);
  const terms = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
  const ap = await cmd(id, 'approve', { expectedVersion: neg.body.version, decisionId: terms.id });
  expect(ap.status, JSON.stringify(ap.body)).toBe(201);
  if (opts.activate !== false) {
    const act = await cmd(id, 'transition', { expectedVersion: ap.body.version, command: 'activate' });
    expect(act.status, JSON.stringify(act.body)).toBe(201);
  }
  return { id, termsDecisionId: terms.id };
}

describe('DOM-P3-15 — descriptive fields that feed rules (code review; tests first) [REQ-RDY-001, REQ-LCY-014]', () => {
  it('readiness: the recorded test result of a failed check cannot be rewritten by a descriptive PATCH (400; text unchanged)', async () => {
    const checkId = await createCheck(p.pm, projectId, { area: 'noc', title: 'NOC hand-over tested (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver' });
    let c = await check(p.pm, projectId, checkId);
    const t = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: c.version, result: 'failed', note: 'Escalation path untested (synthetic)' });
    expect(t.status).toBe(201);
    c = await check(p.pm, projectId, checkId);
    const r = await p.pm.patch(`${P(projectId)}/readiness-checks/${checkId}`, { expectedVersion: c.version, testResult: 'passed: all good' });
    expect(r.status).toBe(400);
    expect((await check(p.pm, projectId, checkId)).testResult).toMatch(/^failed/);
  });

  it('TSA: whether a service is an enduring arrangement is part of its approved terms — no PATCH after approval (422 tsa.enduring_locked)', async () => {
    const { id } = await approvedTsa('Facility access service (synthetic)', plusDays(-30), plusDays(200));
    const t = await tsa(p.pm, projectId, id);
    const r = await p.pm.patch(`${P(projectId)}/tsa-services/${id}`, { expectedVersion: t.version, isEnduringArrangement: true });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('tsa.enduring_locked');
    expect((await tsa(p.pm, projectId, id)).isEnduringArrangement).toBe(false);
  });
});

describe('DOM-P3-17 — TSA guards (code review; tests first) [REQ-TSA-002, business-gates.md §6]', () => {
  it('activate needs the service start date reached (422 tsa.activate.not_started)', async () => {
    const { id } = await approvedTsa('Future service (synthetic)', plusDays(10), plusDays(100), { activate: false });
    const t = await tsa(p.pm, projectId, id);
    const r = await cmd(id, 'transition', { expectedVersion: t.version, command: 'activate' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('tsa.activate.not_started');
    expect((await tsa(p.pm, projectId, id)).status).toBe('approved');
  });

  it('a remedied breach returns the TSA to the state it had before the breach (extended stays extended)', async () => {
    const { id } = await approvedTsa('Extended bridge (synthetic)', plusDays(-60), plusDays(20));
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
    let t = await tsa(p.pm, projectId, id);
    expect((await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: plusDays(120), continuityPlan: 'Keep the bridge (synthetic)' })).status).toBe(201);
    t = await tsa(p.pm, projectId, id);
    expect((await cmd(id, 'record-extension', { expectedVersion: t.version })).status).toBe(201);
    t = await tsa(p.pm, projectId, id);
    expect(t.status).toBe('extended');
    const b = await cmd(id, 'transition', { expectedVersion: t.version, command: 'record_breach', note: 'SLA missed twice (synthetic)' });
    expect(b.status, JSON.stringify(b.body)).toBe(201);
    const r = await cmd(id, 'transition', { expectedVersion: b.body.version, command: 'remedy_breach', note: 'Service credits applied and SLA restored (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('extended');
  });

  it('a breach can accelerate the exit (breached → exit_in_progress, reason required)', async () => {
    const { id } = await approvedTsa('Breached service (synthetic)', plusDays(-60), plusDays(90));
    let t = await tsa(p.pm, projectId, id);
    const b = await cmd(id, 'transition', { expectedVersion: t.version, command: 'record_breach', note: 'Outage (synthetic)' });
    expect(b.status).toBe(201);
    t = await tsa(p.pm, projectId, id);
    expect(t.allowedCommands).toContain('accelerate_exit');
    const r = await cmd(id, 'transition', { expectedVersion: t.version, command: 'accelerate_exit', note: 'Exit accelerated by the steering decision (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('exit_in_progress');
  });
});

describe('DOM-P3-16 — the Day-1 summary counts a waived blocker as cleared only while its waiver is effective (code review; tests first)', () => {
  it('a waiver that expired: the blocker is open again in the summary (as in the GO evaluation)', async () => {
    const siteId = await insertSite(projectId, 'S-FX-W');
    const checkId = await createCheck(p.pm, projectId, { area: 'spares', title: 'Spares stock verified (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver', siteId });
    let c = await check(p.pm, projectId, checkId);
    const det = await p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/determination`, { expectedVersion: c.version, mandatory: true, blocker: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Waivable by the sponsor (synthetic)' });
    expect(det.status, JSON.stringify(det.body)).toBe(201);
    const w = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/waivers`, { basis: 'Spares arrive in week 2 (synthetic)', impact: 'Longer repair times in week 1 (synthetic)', expiresOn: plusDays(2) });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    const ap = await p.sponsor.post(`${P(projectId)}/readiness-waivers/${w.body.id}/approve`, { expectedVersion: w.body.version, note: 'Approved (synthetic)' });
    expect(ap.status, JSON.stringify(ap.body)).toBe(201);
    c = await check(p.pm, projectId, checkId);
    expect(c.status).toBe('waived');
    const open = async () => (await p.pm.get(`${P(projectId)}/readiness/summary`).expect(200)).body.checks.openBlockers as number;
    const before = await open();
    // Owner pool (setup): the waiver's expiry passes (moving the app clock would also expire the HTTP session).
    await owner().query(`update waiver set expires_on = $2 where id = $1`, [w.body.id, plusDays(-1)]);
    expect(await open()).toBe(before + 1);
  });
});

describe('DOM-P3-06 / DOM-P3-13 / DOM-P3-07 — what an approved extension decision authorizes [AT-10, REQ-TSA-005]', () => {
  it('DOM-P3-06: once its decision left draft, the requested extension terms are frozen on that decision (422 tsa.extension.terms_bound); a new end date needs a new decision', async () => {
    const { id } = await approvedTsa('Frozen terms bridge (synthetic)', plusDays(-40), plusDays(30));
    const d1 = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension', { vote: false });
    let t = await tsa(p.pm, projectId, id);
    expect((await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1.id, proposedEndDate: plusDays(120), continuityPlan: 'Keep the bridge (synthetic)' })).status).toBe(201);
    t = await tsa(p.pm, projectId, id);
    const moved = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1.id, proposedEndDate: plusDays(400), continuityPlan: 'Keep the bridge (synthetic)' });
    expect(moved.status).toBe(422);
    expect(moved.body.code).toBe('tsa.extension.terms_bound');
    // The same terms again are accepted (idempotent); another decision may carry another date.
    expect((await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d1.id, proposedEndDate: plusDays(120), continuityPlan: 'Keep the bridge (synthetic)' })).status).toBe(201);
    const d2 = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
    t = await tsa(p.pm, projectId, id);
    expect((await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: d2.id, proposedEndDate: plusDays(150), continuityPlan: 'Keep the bridge (synthetic)' })).status).toBe(201);
    t = await tsa(p.pm, projectId, id);
    const rec = await cmd(id, 'record-extension', { expectedVersion: t.version });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    expect((await tsa(p.pm, projectId, id)).endDate).toBe(plusDays(150));
  });

  it('DOM-P3-13 (conservative, governance owner to confirm): the decision that approved the terms of TSA A does not back an extension of TSA B — nor the reverse', async () => {
    const a = await approvedTsa('Service A (synthetic)', plusDays(-30), plusDays(40));
    const b = await approvedTsa('Service B (synthetic)', plusDays(-30), plusDays(45));
    let t = await tsa(p.pm, projectId, b.id);
    const r = await cmd(b.id, 'request-extension', { expectedVersion: t.version, decisionId: a.termsDecisionId, proposedEndDate: plusDays(200), continuityPlan: 'Continuity for B (synthetic)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('tsa.extension.decision_other_tsa');
    // The same decision extends A itself.
    t = await tsa(p.pm, projectId, a.id);
    expect((await cmd(a.id, 'request-extension', { expectedVersion: t.version, decisionId: a.termsDecisionId, proposedEndDate: plusDays(200), continuityPlan: 'Continuity for A (synthetic)' })).status).toBe(201);
    // The reverse: a decision used for an extension of A does not approve the terms of another TSA.
    t = await tsa(p.pm, projectId, a.id);
    expect((await cmd(a.id, 'record-extension', { expectedVersion: t.version })).status).toBe(201);
    const c = await p.pm.post(`${P(projectId)}/tsa-services`, { name: 'Service C (synthetic)', scope: 'x (synthetic)', startDate: plusDays(-5), endDate: plusDays(90), ownerUserId: p.approver.userId, replacementService: 'y (synthetic)', exitMilestones: [{ title: 'z (synthetic)' }] });
    const neg = await cmd(c.body.id, 'transition', { expectedVersion: 1, command: 'start_negotiation' });
    const ap = await cmd(c.body.id, 'approve', { expectedVersion: neg.body.version, decisionId: a.termsDecisionId });
    expect(ap.status).toBe(422);
    expect(['tsa.approve.decision_other_tsa', 'tsa.approve.decision_already_used']).toContain(ap.body.code);
  });

  it('DOM-P3-07: the new end date must be after today (project timezone) — an expired TSA is not "extended" into the past', async () => {
    const { id } = await approvedTsa('Lapsed service (synthetic)', plusDays(-120), plusDays(-10));
    await runExpirySchedule(projectId);
    let t = await tsa(p.pm, projectId, id);
    expect(t.status).toBe('expired_unresolved');
    const ext = await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension');
    const past = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: plusDays(-5), continuityPlan: 'x (synthetic)' });
    expect(past.status).toBe(422);
    expect(past.body.code).toBe('tsa.extension.end_date_past');
    // A request made while the date was still ahead is refused at the record once that date has passed.
    const ok = await cmd(id, 'request-extension', { expectedVersion: t.version, decisionId: ext.id, proposedEndDate: plusDays(2), continuityPlan: 'x (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    // Owner pool (setup): the requested date passes before the extension is recorded (the app clock would expire the session).
    // The terms bound to the decision (DOM-P34R-04) carry the same date, as they would after time passed.
    await owner().query(`update tsa_service set proposed_end_date = $2 where id = $1`, [id, plusDays(-1)]);
    await owner().query(`update tsa_extension_terms set proposed_end_date = $2 where decision_id = $1`, [ext.id, plusDays(-1)]);
    t = await tsa(p.pm, projectId, id);
    const rec = await cmd(id, 'record-extension', { expectedVersion: t.version });
    expect(rec.status).toBe(422);
    expect(rec.body.code).toBe('tsa.extension.end_date_past');
    const r = await owner().query(`select status::text, end_date::text from tsa_service where id = $1`, [id]);
    expect(r.rows[0]).toEqual({ status: 'expired_unresolved', end_date: plusDays(-10) });
  });
});
