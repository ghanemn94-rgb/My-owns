import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, clearCheck, completePlan, createCheck, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P3/P4 FOCUSED DOMAIN RE-REVIEW — the operational-readiness dimension after the DOM-P3-12 fix (docs/reviews/
 * P3-P4-domain-rereview.md; business-gates.md §1 rule 8 "day1_go_approved when … every transition plan has a Day-1 GO that is
 * not flagged"; "What moves it: readiness sign-offs, go/no-go decision, post-transition acceptance, TSA exits"; AT-06, AT-09).
 * One DC project for this file holding exactly ONE transition plan and ONE open readiness check (the template's project-level
 * checks are set not applicable in setup, see beforeAll), so the project-wide dimension depends on them only. The behaviour
 * under test runs through the real API; the worker is drained exactly as production runs it.
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open;
 * `P34DRE_PROBE_PLAIN=1` runs them as plain tests. `CONTROL …` are plain tests. All data is synthetic.
 */
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;

let projectId: string;
let p: Personas;
let gov: Gov;
let planId: string;

type Dim = { key: string; state: string; explanation: string };
const stored = async () => (await p.pm.get(`${P(projectId)}/status-dimensions`).expect(200)).body as { items: Dim[] };
const recomputed = async () => (await p.pm.post(`${P(projectId)}/status-dimensions/recompute`, {})).body as { items: Dim[] };
const ops = (d: { items: Dim[] }) => d.items.find((x) => x.key === 'operational_readiness')!;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R-DIM'));
  gov = await setupGovernance(projectId, p);
  // Setup only (owner pool): the DC template instantiates 28 project-level Day-1 checks at project creation; they gate only
  // project-wide plans but count in the project-wide dimension. They are set "not applicable" here so that the dimension
  // depends on this file's single plan and single check — the behaviour under test (the GO / its withdrawal) runs through
  // the real API.
  await owner().query(`update readiness_check set status = 'not_applicable' where project_id = $1 and site_id is null and cutover_plan_id is null`, [projectId]);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

describe('P3/P4 domain re-review — the Day-1 GO moves the operational dimension [business-gates.md §1 rule 8, REQ-LCY-006]', () => {
  it('CONTROL: one plan, its only blocker cleared, plan submitted — the dimension (explicit recompute) is readiness_in_progress, not day1_go_approved', async () => {
    const siteId = await insertSite(projectId, 'S-P34R-D');
    planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Single transition (synthetic)' });
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
    expect((await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version, note: 'For the Day-1 go/no-go (synthetic)' })).status).toBe(201);
    await drainWorker();
    const o = ops(await recomputed());
    expect(o.state, JSON.stringify(o)).toBe('readiness_in_progress');
  });

  defect('DEFECT DOM-P34R-03a: after the GO is recorded (worker drained), the stored dimension still reads readiness_in_progress — the GO does not trigger a recompute', async () => {
    const v = await plan(p.pm, projectId, planId);
    const g = await p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: v.version, outcome: 'go', rationale: 'GO — the only blocker is cleared (probe)' });
    expect(g.status, JSON.stringify(g.body)).toBe(201);
    await drainWorker();
    const o = ops(await stored());
    // Required (business-gates.md §1 rule 8; module guide: dimensions are recomputed "whenever an input may have changed"):
    // the recorded Day-1 GO moves the operational dimension to day1_go_approved without waiting for an unrelated event.
    expect(o.state, `plan ${g.body.status}; stored dimension ${JSON.stringify(o)}`).toBe('day1_go_approved');
  });

  it('CONTROL: an explicit recompute after the GO gives day1_go_approved (the rule is right; only the trigger is missing)', async () => {
    const o = ops(await recomputed());
    expect(o.state, JSON.stringify(o)).toBe('day1_go_approved');
  });

  defect('DEFECT DOM-P34R-03b: the GO is withdrawn (return to planning) — the stored dimension still says "Day-1 GO approved for every transition plan"', async () => {
    const v = await plan(p.pm, projectId, planId);
    expect(v.status).toBe('approved_go');
    const back = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/return-to-planning`, { expectedVersion: v.version, note: 'GO withdrawn for re-planning (probe, synthetic)' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    expect(back.body.status).toBe('planning');
    await drainWorker();
    const o = ops(await stored());
    // Required (business-gates.md §1 rule 8 "never Day-1 ready without a GO decision"; AT-06 states kept accurate): once the
    // only plan is back in planning, no dimension states that every transition plan has an approved Day-1 GO.
    expect(o.state, `plan ${back.body.status}; stored dimension ${JSON.stringify(o)}`).not.toBe('day1_go_approved');
  });
});
