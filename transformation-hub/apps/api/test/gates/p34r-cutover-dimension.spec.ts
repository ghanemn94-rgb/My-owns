import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner } from '../helpers';
import {
  P,
  addPlanEvidenceViaOwner,
  clearCheck,
  completePlan,
  createCheck,
  decisionOfType,
  drainWorker,
  grantWorkstreamRole,
  insertSite,
  plan,
  setupGovernance,
  setupProject,
  workstreamId,
  Gov,
  Personas,
} from '../readiness/readiness-kit';

/**
 * DOM-P34R-03 (docs/reviews/P3-P4-domain-rereview.md; business-gates.md §1 rule 8 "What moves it: … go/no-go decision,
 * post-transition acceptance"): the cutover commands emit `readiness.changed`, so the STORED operational dimension follows a
 * real GO, the recorded execution and the post-transition acceptance (the withdrawal is covered by the re-review probe
 * `p34-domain-re-dimension.spec.ts`). One DC project holding one plan and one check; the template's 28 project-level Day-1
 * checks are set not applicable in setup (owner pool, as in the probe) so the project-wide dimension depends on them only.
 */
let projectId: string;
let p: Personas;
let gov: Gov;
type Dim = { key: string; state: string; explanation: string };
const storedOps = async () => ((await p.pm.get(`${P(projectId)}/status-dimensions`).expect(200)).body as { items: Dim[] }).items.find((d) => d.key === 'operational_readiness')!;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34RF-DIM'));
  gov = await setupGovernance(projectId, p);
  await owner().query(`update readiness_check set status = 'not_applicable' where project_id = $1 and site_id is null and cutover_plan_id is null`, [projectId]);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

describe('DOM-P34R-03 — the GO, the execution and the post-transition acceptance move the stored operational dimension [REQ-LCY-006, REQ-LCY-014]', () => {
  it('GO → day1_go_approved; execution keeps it; acceptance → operating_with_transitional_services (worker drained, no explicit recompute)', async () => {
    const ws07 = await workstreamId(p.pm, projectId, 'WS07');
    await grantWorkstreamRole(projectId, 'tech.lead', 'workstream_lead', ws07);
    const opsLead = await loginAs('tech.lead');
    const siteId = await insertSite(projectId, 'S-P34RF-DIM');
    const planId = await completePlan(p.pm, projectId, { siteId, workstreamId: ws07, accountableUserId: p.pm.userId, title: 'Single transition (synthetic)' });
    const checkId = await createCheck(p.pm, projectId, {
      area: 'connectivity',
      title: 'Connectivity to customers and NOC tested end to end (synthetic)',
      mandatory: true,
      blocker: true,
      signoffRole: 'functional_approver',
      cutoverPlanId: planId,
      siteId,
      failureContingency: 'Contingency: keep traffic on the current carrier path (synthetic)',
    });
    await clearCheck(p, projectId, checkId);
    const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
    let v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id })).status).toBe(201);
    v = await plan(p.pm, projectId, planId);
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version })).status).toBe(201);
    await drainWorker();
    expect((await storedOps()).state).toBe('readiness_in_progress');

    v = await plan(p.pm, projectId, planId);
    const go = await p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: v.version, outcome: 'go', rationale: 'GO — the only blocker is cleared (test)' });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    await drainWorker();
    expect((await storedOps()).state).toBe('day1_go_approved');

    const exec = await opsLead.post(`${P(projectId)}/cutover-plans/${planId}/execution`, { expectedVersion: go.body.version, note: 'Executed in the operational change system (synthetic)' });
    expect(exec.status, JSON.stringify(exec.body)).toBe(201);
    await drainWorker();
    expect((await storedOps()).state).toBe('day1_go_approved');

    await addPlanEvidenceViaOwner(projectId, planId, p.pm.userId);
    const acc = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/accept`, { expectedVersion: exec.body.version, note: 'Post-transition checks passed (synthetic)' });
    expect(acc.status, JSON.stringify(acc.body)).toBe(201);
    await drainWorker();
    const o = await storedOps();
    expect(o.state, JSON.stringify(o)).toBe('operating_with_transitional_services');
  });
});
