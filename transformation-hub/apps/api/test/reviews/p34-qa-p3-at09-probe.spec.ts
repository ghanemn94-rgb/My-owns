import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { ok } from '../carveout/carveout-kit';
import { P, createCheck, completePlan, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, check } from '../readiness/readiness-kit';
import type { Gov, Personas } from '../readiness/readiness-kit';

/**
 * Independent QA — P3 review (docs/reviews/P3-P4-qa-review.md §3): acceptance criteria of §20 that the delivered AT specs
 * assert only in part (AT-07: p34-qa-p3-at07-probe.spec.ts).
 *  - AT-09 "block go-live ACCORDING TO THE BLOCKER": the delivered spec fails only the connectivity test. Here the physical
 *    access and incident-response tests fail, and an optional (non-mandatory, non-blocker) check fails too: GO is refused
 *    naming exactly the two blockers — the optional check does not block.
 */
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

describe('QA-P34 AT-09 — GO is blocked according to the blocker: failed access and incident-response blockers block, a failed optional check does not [AT-09, REQ-RDY-001, REQ-RDY-004]', () => {
  let pid: string;
  let p: Personas;
  let gov: Gov;
  beforeAll(async () => {
    ({ projectId: pid, p } = await setupProject('QA34-AT09'));
    gov = await setupGovernance(pid, p);
  });

  it('CONTROL: the refusal names exactly the two failed blockers; the failed optional check is not among them', async () => {
    const site = await insertSite(pid, 'S-QA34');
    const planId = await completePlan(p.pm, pid, { siteId: site, accountableUserId: p.pm.userId, title: 'QA34 site transition (synthetic)' });
    const common = { cutoverPlanId: planId, siteId: site, signoffRole: 'functional_approver' };
    const access = await createCheck(p.pm, pid, { ...common, area: 'physical_access', title: 'QA34 physical access tested (synthetic)', mandatory: true, blocker: true, failureContingency: 'Escorted access by the current operator (synthetic)' });
    const incident = await createCheck(p.pm, pid, { ...common, area: 'incident_management', title: 'QA34 incident response tested (synthetic)', mandatory: true, blocker: true, failureContingency: 'Current operator desk handles P1 incidents (synthetic)' });
    const optional = await createCheck(p.pm, pid, { ...common, area: 'support', title: 'QA34 optional support note (synthetic)', mandatory: false, blocker: false });
    for (const id of [access, incident, optional]) {
      const c = await check(p.pm, pid, id);
      const r = await p.pm.post(`${P(pid)}/readiness-checks/${id}/test-runs`, { expectedVersion: c.version, result: 'failed', note: 'QA failed test (synthetic)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
    }
    const goDecision = (await decisionOfType(pid, p, gov, 'day1_go_no_go')).id;
    let v = await plan(p.pm, pid, planId);
    await ok(p.pm.post(`${P(pid)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: goDecision }));
    v = await plan(p.pm, pid, planId);
    const sub = await ok<{ version: number }>(p.pm.post(`${P(pid)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version }));
    const go = await p.sponsor.post(`${P(pid)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: sub.version, outcome: 'go', rationale: 'QA attempted GO (synthetic)' });
    console.log(`QA-P34 AT-09: GO with failed access + incident blockers and a failed optional check → ${go.status} ${go.body.code}; blockers ${JSON.stringify(go.body.details?.blockers?.map((b: { title: string; status: string; blocker: boolean }) => [b.title, b.status, b.blocker]))}`);
    expect(go.status).toBe(422);
    expect(go.body.code).toBe('readiness.go_blocked');
    expect((go.body.details.blockers as { id: string }[]).map((b) => b.id).sort()).toEqual([access, incident].sort());
    expect(go.body.details.missing).toEqual([]);
    const after = await plan(p.pm, pid, planId);
    expect(after).toMatchObject({ status: 'ready_for_decision', goNoGo: 'pending' });
    expect(after.decisionHistory.at(-1)).toMatchObject({ kind: 'go_blocked' });
    const optionalView = after.checks.find((c: { id: string }) => c.id === optional);
    expect(optionalView).toMatchObject({ status: 'failed', blocker: false, mandatory: false });
    expect(after.goEvaluation.blockers.map((b: { id: string }) => b.id)).not.toContain(optional);
  });
});
