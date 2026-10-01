import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { P, check, completePlan, createCheck, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P3/P4 DOMAIN RE-REVIEW, RE-CHECK OF THE FIXES (lead request) — equivalent paths around the DOM-P34R-01 / -02 fixes
 * (docs/reviews/P3-P4-domain-rereview.md "Re-check of the fixes"; business-gates.md §5 rules 1 and 3). The plan's site now
 * changes only through `POST …/cutover-plans/:planId/site` (reason, history, refused while a FAILED gating check would stop
 * gating the plan); "not applicable" is refused on a FAILED gating check. Both rules key on the check's CURRENT status: a
 * passing test recorded by the check manager turns `failed` into `in_progress` (open, not cleared).
 *
 * `CONTROL …` / `OBSERVED …` are plain tests (OBSERVED pins current behaviour that the re-check does not count as a defect —
 * see the report). All data is synthetic.
 */
let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R2-GO'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

async function testRun(checkId: string, result: 'passed' | 'failed', note: string) {
  const cur = await check(p.pm, projectId, checkId);
  const r = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: cur.version, result, note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.status as string;
}

async function linkAndSubmit(planId: string) {
  const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
  let v = await plan(p.pm, projectId, planId);
  expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
  v = await plan(p.pm, projectId, planId);
  const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version, note: 'For the Day-1 go/no-go (synthetic)' });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return sub.body.version as number;
}

const go = (planId: string, version: number) => p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: version, outcome: 'go', rationale: 'GO (re-check probe, synthetic)' });

async function siteBlocker(siteId: string, title: string, extra: Record<string, unknown> = {}) {
  return createCheck(p.pm, projectId, {
    area: 'connectivity',
    title: `${title}: connectivity to customers and NOC tested end to end (synthetic)`,
    mandatory: true,
    blocker: true,
    signoffRole: 'functional_approver',
    siteId,
    failureContingency: 'Contingency: keep traffic on the current carrier path (synthetic)',
    ...extra,
  });
}

describe('P3/P4 domain re-review, re-check — the plan site command and the "failed" rule [AT-09, REQ-RDY-004, business-gates.md §5 rule 1]', () => {
  it('CONTROL: the site command refuses to move a plan away from its FAILED site blocker (422 readiness.cutover.site_change_failed_check), the plan unchanged', async () => {
    const siteA = await insertSite(projectId, 'S-P34R2-CA');
    const siteB = await insertSite(projectId, 'S-P34R2-CB');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Control transition (synthetic)' });
    const checkId = await siteBlocker(siteA, 'Control hall');
    expect(await testRun(checkId, 'failed', 'Carrier path down (synthetic)')).toBe('failed');
    const v = await plan(p.pm, projectId, planId);
    const r = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/site`, { expectedVersion: v.version, siteId: siteB, reason: 'Move the transition to hall B (probe)' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.cutover.site_change_failed_check');
    expect((await plan(p.pm, projectId, planId)).siteId).toBe(siteA);
  });

  it('OBSERVED DOM-P34R2-O1: after the PM records a passing test (failed → in_progress, never signed off), the site command moves the plan away from that blocker with a reason; the decision history names it; the GO is accepted', async () => {
    const siteA = await insertSite(projectId, 'S-P34R2-1A');
    const siteB = await insertSite(projectId, 'S-P34R2-1B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Transition of hall A (synthetic)' });
    const checkId = await siteBlocker(siteA, 'Hall A');
    expect(await testRun(checkId, 'failed', 'Carrier path down (synthetic)')).toBe('failed');
    expect(await testRun(checkId, 'passed', 'Re-test passed (claim, no evidence linked; synthetic)')).toBe('in_progress');
    let v = await plan(p.pm, projectId, planId);
    const moved = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/site`, { expectedVersion: v.version, siteId: siteB, reason: 'Transition re-planned for hall B (probe)' });
    expect(moved.status, JSON.stringify(moved.body)).toBe(201);
    const version = await linkAndSubmit(planId);
    const r = await go(planId, version);
    v = await plan(p.pm, projectId, planId);
    const c = await check(p.pm, projectId, checkId);
    const hist = v.decisionHistory as { kind: string; rationale: string | null }[];
    // Current behaviour pinned: the rule keys on the check's current status ("failed"); an open check may leave a plan in
    // planning / rehearsal — with a reason and a `site_changed` entry naming it — as the check-side rebind rule allows.
    expect(c.status).toBe('in_progress');
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(hist.map((h) => h.kind)).toEqual(expect.arrayContaining(['site_changed', 'submitted', 'go']));
    expect(hist.find((h) => h.kind === 'site_changed')!.rationale).toContain(c.code);
  });

  it('OBSERVED DOM-P34R2-O2: after the PM records a passing test, the sign-off specialist determines the open blocker "not applicable" while its plan is in planning; the GO is accepted (two people, basis recorded)', async () => {
    const siteId = await insertSite(projectId, 'S-P34R2-2');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Transition of hall C (synthetic)' });
    const checkId = await siteBlocker(siteId, 'Hall C', { cutoverPlanId: planId });
    expect(await testRun(checkId, 'failed', 'Badge access failed (synthetic)')).toBe('failed');
    expect(await testRun(checkId, 'passed', 'Re-test passed (claim; synthetic)')).toBe('in_progress');
    const c0 = await check(p.pm, projectId, checkId);
    const na = await p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: c0.version, outcome: 'not_applicable', note: 'Not part of this transition (probe, synthetic)' });
    const version = await linkAndSubmit(planId);
    const r = await go(planId, version);
    // Current behaviour pinned: the "not applicable" refusal of DOM-P34R-02 covers a FAILED check (status or latest test) and
    // an open check of a plan under decision / with a GO; here the latest test passed and the plan was in rehearsal.
    expect(na.status, JSON.stringify(na.body)).toBe(201);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
