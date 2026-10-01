import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import {
  P,
  addEvidence,
  check,
  clearCheck,
  completePlan,
  createCheck,
  decisionOfType,
  drainWorker,
  insertSite,
  plan,
  setupGovernance,
  setupProject,
  Gov,
  Personas,
} from './readiness-kit';

/**
 * Fixes of the P3 domain review for Day-1 readiness (docs/reviews/P3-domain-review.md): a Day-1 blocker keeps blocking the
 * go-live whatever path is tried — re-binding (DOM-P3-01), re-determination (DOM-P3-02), a failure after the GO
 * (DOM-P3-04) and rejected sign-off evidence (DOM-P3-09). The reviewers' probes (`test/reviews/p3-domain-readiness-*.spec.ts`)
 * reproduce the reported bypasses; this file pins the implemented rules around them. All data is synthetic.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3FIX-RD'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

async function sitePlanWithBlocker(code: string) {
  const siteId = await insertSite(projectId, code);
  const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: `Transition ${code} (synthetic)` });
  const checkId = await createCheck(p.pm, projectId, {
    area: 'connectivity',
    title: `Connectivity ${code} tested end to end (synthetic)`,
    mandatory: true,
    blocker: true,
    signoffRole: 'functional_approver',
    cutoverPlanId: planId,
    siteId,
  });
  return { siteId, planId, checkId };
}

async function linkAndSubmit(planId: string) {
  const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
  let v = await plan(p.pm, projectId, planId);
  expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
  v = await plan(p.pm, projectId, planId);
  const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return { decisionId: d.id, version: sub.body.version as number };
}

async function failTest(checkId: string) {
  const c = await check(p.pm, projectId, checkId);
  const r = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: c.version, result: 'failed', note: 'Failed re-test (synthetic)' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

const history = async (planId: string) => (await plan(p.pm, projectId, planId)).decisionHistory as { kind: string; actorUserId: string | null; rationale: string | null; evaluation: { blockers: { id: string }[] } | null }[];

describe('DOM-P3-01 — which transition a check gates is changed only by the re-binding command [AT-09, REQ-RDY-004]', () => {
  it('a descriptive PATCH may not carry cutoverPlanId / siteId (400); the rebind command moves an open check off a plan in planning, with a reason and history entries', async () => {
    const a = await sitePlanWithBlocker('S-FX-1');
    const other = await completePlan(p.pm, projectId, { title: 'Other transition (synthetic)' });
    const c = await check(p.pm, projectId, a.checkId);
    const patch = await p.pm.patch(`${P(projectId)}/readiness-checks/${a.checkId}`, { expectedVersion: c.version, cutoverPlanId: other });
    expect(patch.status).toBe(400);
    const noReason = await p.pm.post(`${P(projectId)}/readiness-checks/${a.checkId}/rebind`, { expectedVersion: c.version, cutoverPlanId: other });
    expect(noReason.status).toBe(400);
    const r = await p.pm.post(`${P(projectId)}/readiness-checks/${a.checkId}/rebind`, { expectedVersion: c.version, cutoverPlanId: other, reason: 'The connectivity test belongs to the core transition (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect((await check(p.pm, projectId, a.checkId)).cutoverPlanId).toBe(other);
    expect((await history(a.planId)).map((h) => h.kind)).toContain('check_unbound');
    expect((await history(other)).map((h) => h.kind)).toContain('check_bound');
    const audit = await owner().query(`select reason from audit_event where project_id = $1 and entity_id = $2 and action = 'readiness.check.rebind'`, [projectId, a.checkId]);
    expect(audit.rows[0]?.reason).toMatch(/core transition/);
  });

  it('a FAILED gating check cannot be re-bound (422 readiness.check.rebind_failed); an open one cannot leave a plan under go/no-go decision (422 readiness.check.rebind_plan_locked)', async () => {
    const a = await sitePlanWithBlocker('S-FX-2');
    const other = await completePlan(p.pm, projectId, { title: 'Parking transition (synthetic)' });
    await failTest(a.checkId);
    let c = await check(p.pm, projectId, a.checkId);
    const failed = await p.pm.post(`${P(projectId)}/readiness-checks/${a.checkId}/rebind`, { expectedVersion: c.version, cutoverPlanId: other, reason: 'probe' });
    expect(failed.status).toBe(422);
    expect(failed.body.code).toBe('readiness.check.rebind_failed');
    // A second, not-started blocker of a plan that goes to decision.
    const b = await sitePlanWithBlocker('S-FX-3');
    await linkAndSubmit(b.planId);
    c = await check(p.pm, projectId, b.checkId);
    const locked = await p.pm.post(`${P(projectId)}/readiness-checks/${b.checkId}/rebind`, { expectedVersion: c.version, cutoverPlanId: other, reason: 'probe' });
    expect(locked.status).toBe(422);
    expect(locked.body.code).toBe('readiness.check.rebind_plan_locked');
    expect((await check(p.pm, projectId, b.checkId)).cutoverPlanId).toBe(b.planId);
    const denied = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action = 'readiness.rebindCheck' and outcome = 'rejected'`, [projectId]);
    expect(denied.rows[0].n).toBeGreaterThanOrEqual(2);
  });
});

describe('DOM-P3-02 — a determination never releases an open gating check [AT-13, REQ-RDY-004]', () => {
  it('lowering a failed blocker is refused (422 readiness.determination.release_not_allowed); raising waivability for the waiver register stays possible', async () => {
    const a = await sitePlanWithBlocker('S-FX-4');
    await failTest(a.checkId);
    let c = await check(p.pm, projectId, a.checkId);
    const lower = await p.approver.post(`${P(projectId)}/readiness-checks/${a.checkId}/determination`, { expectedVersion: c.version, mandatory: true, blocker: false, waivable: false, waiverAuthorityRole: null, basis: 'probe' });
    expect(lower.status).toBe(422);
    expect(lower.body.code).toBe('readiness.determination.release_not_allowed');
    c = await check(p.pm, projectId, a.checkId);
    expect(c).toMatchObject({ blocker: true, mandatory: true, status: 'failed' });
    // Waivability (criticality unchanged) is still the specialist's determination; the release then needs a waiver.
    const waivable = await p.approver.post(`${P(projectId)}/readiness-checks/${a.checkId}/determination`, { expectedVersion: c.version, mandatory: true, blocker: true, waivable: true, waiverAuthorityRole: 'sponsor', basis: 'Waivable with the sponsor authority (synthetic)' });
    expect(waivable.status, JSON.stringify(waivable.body)).toBe(201);
  });

  it('lowering a NOT-STARTED blocker that gates no plan under decision is still a specialist determination', async () => {
    const siteId = await insertSite(projectId, 'S-FX-5');
    const checkId = await createCheck(p.pm, projectId, { area: 'power', title: 'Power feeds verified (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver', siteId });
    const c = await check(p.pm, projectId, checkId);
    const r = await p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/determination`, { expectedVersion: c.version, mandatory: true, blocker: false, waivable: false, waiverAuthorityRole: null, basis: 'Not blocking for Day 1 (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});

describe('DOM-P3-04 — a blocker failing after the GO flags the GO and blocks the execution record [AT-09, REQ-RDY-004, REQ-RDY-006]', () => {
  it('the failed test flags the GO in the history; execution is refused (422, refusal kept in the history); the GO can be withdrawn and a new GO needs a new decision', async () => {
    const a = await sitePlanWithBlocker('S-FX-6');
    await clearCheck(p, projectId, a.checkId);
    const s = await linkAndSubmit(a.planId);
    const go = await p.sponsor.post(`${P(projectId)}/cutover-plans/${a.planId}/go-no-go`, { expectedVersion: s.version, outcome: 'go', rationale: 'GO (synthetic)' });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    await failTest(a.checkId);
    let h = await history(a.planId);
    const flag = h.find((x) => x.kind === 'go_flagged');
    expect(flag?.evaluation?.blockers.map((b) => b.id)).toEqual([a.checkId]);
    let v = await plan(p.pm, projectId, a.planId);
    expect(v.status).toBe('approved_go');
    const exec = await p.pm.post(`${P(projectId)}/cutover-plans/${a.planId}/execution`, { expectedVersion: v.version, note: 'Executed (synthetic)' });
    expect(exec.status).toBe(422);
    expect(exec.body.code).toBe('readiness.execution_blocked');
    h = await history(a.planId);
    expect(h.map((x) => x.kind)).toContain('execution_blocked'); // kept although the command rolled back
    v = await plan(p.pm, projectId, a.planId);
    expect(v.status).toBe('approved_go');
    // The GO is withdrawn for a new decision.
    const back = await p.pm.post(`${P(projectId)}/cutover-plans/${a.planId}/return-to-planning`, { expectedVersion: v.version, note: 'GO withdrawn: connectivity failed after the GO (synthetic)' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body.status).toBe('planning');
  });
});

describe('DOM-P3-09 — rejected sign-off evidence re-opens the check; the GO rule refuses it even before the reaction runs [REQ-RDY-001, AT-14]', () => {
  it('evidence rejected: the GO is refused at once (blocker evidenceInvalid), then the worker returns the check to in_progress with an audit record', async () => {
    const a = await sitePlanWithBlocker('S-FX-7');
    let c = await check(p.pm, projectId, a.checkId);
    await p.pm.post(`${P(projectId)}/readiness-checks/${a.checkId}/test-runs`, { expectedVersion: c.version, result: 'passed' }).expect(201);
    const linkId = await addEvidence(p.pm, projectId, 'readiness_check', a.checkId, 'Synthetic test report');
    c = await check(p.pm, projectId, a.checkId);
    expect((await p.approver.post(`${P(projectId)}/readiness-checks/${a.checkId}/sign-off`, { expectedVersion: c.version, outcome: 'passed', note: 'Signed off (synthetic)' })).status).toBe(201);
    const s = await linkAndSubmit(a.planId);
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0].version as number;
    expect((await p.secretary.post(`${P(projectId)}/evidence/${linkId}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Defective (synthetic)' })).status).toBe(201);
    // No worker run yet: the check still reads "passed", but the GO rule does not count it.
    expect((await check(p.pm, projectId, a.checkId)).status).toBe('passed');
    const go = await p.sponsor.post(`${P(projectId)}/cutover-plans/${a.planId}/go-no-go`, { expectedVersion: s.version, outcome: 'go', rationale: 'GO attempt (synthetic)' });
    expect(go.status).toBe(422);
    expect(go.body.code).toBe('readiness.go_blocked');
    expect(go.body.details.blockers).toEqual([expect.objectContaining({ id: a.checkId, status: 'passed', evidenceInvalid: true })]);
    await drainWorker();
    c = await check(p.pm, projectId, a.checkId);
    expect(c).toMatchObject({ status: 'in_progress', signedOffBy: null });
    const audit = await owner().query(`select actor_user_id, after from audit_event where project_id = $1 and entity_id = $2 and action = 'readiness.check.evidence_invalidated'`, [projectId, a.checkId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].after).toMatchObject({ status: 'in_progress', activeEvidence: 0 });
    // The earlier sign-off is preserved in the audit trail.
    const signoff = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and entity_id = $2 and action = 'readiness.check.signoff' and outcome = 'success'`, [projectId, a.checkId]);
    expect(signoff.rows[0].n).toBe(1);
  });
});
