import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, check, clearCheck, completePlan, createCheck, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, Gov, Personas } from './readiness-kit';

/**
 * Fixes of the P3/P4 focused domain re-review (docs/reviews/P3-P4-domain-rereview.md) for Day-1 readiness and cutover:
 * DOM-P34R-01 (the plan's site is a scope command), DOM-P34R-02 ("not applicable" never releases a failed / decided-plan
 * blocker), DOM-P34R-03 (cutover commands move the operational dimension). Real API; synthetic data.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34RF-RDY'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

async function failTest(checkId: string) {
  const cur = await check(p.pm, projectId, checkId);
  const r = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: cur.version, result: 'failed', note: 'Carrier path down during the test (synthetic)' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

const siteBlocker = (siteId: string, title: string) =>
  createCheck(p.pm, projectId, { area: 'connectivity', title: `${title} (synthetic)`, mandatory: true, blocker: true, signoffRole: 'functional_approver', siteId, failureContingency: 'Contingency: keep the current carrier path (synthetic)' });

const changeSite = (planId: string, expectedVersion: number, siteId: string | null, reason = 'The transition moves to the other hall (synthetic)') =>
  p.pm.post(`${P(projectId)}/cutover-plans/${planId}/site`, { expectedVersion, siteId, reason });

describe('DOM-P34R-01 — the site of a transition plan changes only through the scope command [AT-09, REQ-RDY-004]', () => {
  it('a descriptive PATCH may not carry siteId (400; plan unchanged)', async () => {
    const siteA = await insertSite(projectId, 'S-P34RF-0A');
    const siteB = await insertSite(projectId, 'S-P34RF-0B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Patch probe (synthetic)' });
    const before = await plan(p.pm, projectId, planId);
    const r = await p.pm.patch(`${P(projectId)}/cutover-plans/${planId}`, { expectedVersion: before.version, siteId: siteB });
    expect(r.status, JSON.stringify(r.body)).toBe(400);
    const after = await plan(p.pm, projectId, planId);
    expect({ siteId: after.siteId, version: after.version }).toEqual({ siteId: siteA, version: before.version });
  });

  it('refused while a FAILED site blocker would stop gating the plan (422, plan unchanged); the GO stays blocked', async () => {
    const siteA = await insertSite(projectId, 'S-P34RF-1A');
    const siteB = await insertSite(projectId, 'S-P34RF-1B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Hall A transition (synthetic)' });
    const checkId = await siteBlocker(siteA, 'Hall A connectivity');
    await failTest(checkId);
    const before = await plan(p.pm, projectId, planId);
    const r = await changeSite(planId, before.version, siteB);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.cutover.site_change_failed_check');
    expect((r.body.details.checks as { id: string }[]).map((c) => c.id)).toEqual([checkId]);
    const after = await plan(p.pm, projectId, planId);
    expect(after.siteId).toBe(siteA);
    expect(after.version).toBe(before.version);
    expect((after.goEvaluation.blockers as { id: string }[]).map((b) => b.id)).toContain(checkId);
    // Moving the plan to project-wide is allowed: a project-wide plan is gated by every check not bound to another plan, so
    // the failed site check keeps gating it.
    const toProjectWide = await changeSite(planId, after.version, null);
    expect(toProjectWide.status, JSON.stringify(toProjectWide.body)).toBe(201);
    expect((await plan(p.pm, projectId, planId)).goEvaluation.blockers.map((b: { id: string }) => b.id)).toContain(checkId);
  });

  it('an open (not failed) site check may leave a plan before its go/no-go: reason required, decision-history entry with the checks leaving and entering', async () => {
    const siteA = await insertSite(projectId, 'S-P34RF-2A');
    const siteB = await insertSite(projectId, 'S-P34RF-2B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Hall C transition (synthetic)' });
    const leavingId = await siteBlocker(siteA, 'Hall C connectivity');
    const enteringId = await siteBlocker(siteB, 'Hall D connectivity');
    const before = await plan(p.pm, projectId, planId);
    const noReason = await changeSite(planId, before.version, siteB, '');
    expect(noReason.status).toBe(400);
    const r = await changeSite(planId, before.version, siteB);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const after = await plan(p.pm, projectId, planId);
    expect(after.siteId).toBe(siteB);
    const gating = (after.checks as { id: string }[]).map((c) => c.id);
    expect(gating).toContain(enteringId);
    expect(gating).not.toContain(leavingId);
    const entry = (after.decisionHistory as { kind: string; rationale: string }[]).find((h) => h.kind === 'site_changed')!;
    const [leaving, entering] = await Promise.all([check(p.pm, projectId, leavingId), check(p.pm, projectId, enteringId)]);
    expect(entry.rationale).toContain('The transition moves to the other hall (synthetic)');
    expect(entry.rationale).toContain(`no longer gating: ${leaving.code}`);
    expect(entry.rationale).toContain(`now gating: ${entering.code}`);
    const audit = (await owner().query(`select reason from audit_event where project_id = $1 and action = 'readiness.cutover.change_site' and entity_id = $2`, [projectId, planId])).rows;
    expect(audit).toHaveLength(1);
  });

  it('refused once the plan is under go/no-go decision (422 readiness.cutover.locked)', async () => {
    const siteA = await insertSite(projectId, 'S-P34RF-3A');
    const siteB = await insertSite(projectId, 'S-P34RF-3B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Hall E transition (synthetic)' });
    const checkId = await siteBlocker(siteA, 'Hall E connectivity');
    await clearCheck(p, projectId, checkId);
    const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
    let v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
    v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version })).status).toBe(201);
    v = await plan(p.pm, projectId, planId);
    const r = await changeSite(planId, v.version, siteB);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.cutover.locked');
  });
});

describe('DOM-P34R-02 — "not applicable" never releases a failed gating check [AT-09, AT-13, business-gates.md §5 rule 3]', () => {
  const naSignoff = async (checkId: string) => {
    const c = await check(p.pm, projectId, checkId);
    return p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: c.version, outcome: 'not_applicable', note: 'Not part of this transition (synthetic)' });
  };

  it('a FAILED blocker: the specialist\'s "not applicable" is refused (422), the check stays failed and the GO stays blocked', async () => {
    const siteId = await insertSite(projectId, 'S-P34RF-4');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Hall G transition (synthetic)' });
    const checkId = await createCheck(p.pm, projectId, { area: 'physical_access', title: 'Hall G badge access tested (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId, siteId, failureContingency: 'Escorted access (synthetic)' });
    await failTest(checkId);
    const r = await naSignoff(checkId);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.signoff.na_release_not_allowed');
    expect((await check(p.pm, projectId, checkId)).status).toBe('failed');
    expect(((await plan(p.pm, projectId, planId)).goEvaluation.blockers as { id: string }[]).map((b) => b.id)).toContain(checkId);
  });

  it('an open blocker gating a plan under go/no-go decision: refused (422); the same open blocker of a plan in planning may be determined not applicable', async () => {
    const siteId = await insertSite(projectId, 'S-P34RF-5');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Hall H transition (synthetic)' });
    const cleared = await createCheck(p.pm, projectId, { area: 'connectivity', title: 'Hall H connectivity tested (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId, siteId, failureContingency: 'Keep the current carrier path (synthetic)' });
    await clearCheck(p, projectId, cleared);
    const open = await createCheck(p.pm, projectId, { area: 'incident_management', title: 'Hall H incident runbook tested (synthetic)', mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId, siteId, failureContingency: 'Current operator handles incidents (synthetic)' });
    const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
    let v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
    v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version })).status).toBe(201);
    const refused = await naSignoff(open);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('readiness.signoff.na_release_not_allowed');
    v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/return-to-planning`, { expectedVersion: v.version, note: 'Re-planning (synthetic)' })).status).toBe(201);
    const allowed = await naSignoff(open);
    expect(allowed.status, JSON.stringify(allowed.body)).toBe(201);
    expect(allowed.body.status).toBe('not_applicable');
  });
});
