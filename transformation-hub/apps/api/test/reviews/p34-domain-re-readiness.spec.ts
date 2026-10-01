import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools } from '../helpers';
import { P, check, completePlan, createCheck, decisionOfType, drainWorker, insertSite, plan, setupGovernance, setupProject, Gov, Personas } from '../readiness/readiness-kit';

/**
 * P3/P4 FOCUSED DOMAIN RE-REVIEW — Day-1 blockers after the DOM-P3-01 / DOM-P3-02 fixes (docs/reviews/P3-P4-domain-rereview.md;
 * AT-09, REQ-RDY-001/004, business-gates.md §5 rules 1 and 3 "a failed gating check keeps gating the transition(s) it was raised
 * for until it is cleared"; "a determination never releases an open blocker … a non-waivable one cannot be released").
 * One DC project for this file, real API only (owner pool only for sites — no site API — through the readiness kit).
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open (the suite stays
 * green; the probe turns red once fixed — then rename it `… (fixed, regression)` and make it a plain `it`).
 * `P34DRE_PROBE_PLAIN=1` runs them as plain tests to show the failure message. `CONTROL …` are plain tests. All data is synthetic.
 */
// Implementer (fix of the P3/P4 domain re-review): every DEFECT probe of this file is fixed and renamed `… (fixed, regression)`
// — plain `it`, assertions unchanged. The alias stays so that P34DRE_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P34DRE_PROBE_PLAIN'] ? it : it.fails;
void defect;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P34R-GO'));
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
  expect(r.body.status).toBe('failed');
}

/** Link a fresh FINAL day1_go_no_go decision and submit the plan (PM); returns the plan version ready for decision. */
async function linkAndSubmit(planId: string) {
  const d = await decisionOfType(projectId, p, gov, 'day1_go_no_go');
  let v = await plan(p.pm, projectId, planId);
  const link = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: d.id });
  expect(link.status, JSON.stringify(link.body)).toBe(201);
  v = await plan(p.pm, projectId, planId);
  const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version, note: 'For the Day-1 go/no-go (synthetic)' });
  expect(sub.status, JSON.stringify(sub.body)).toBe(201);
  return { decisionId: d.id, version: sub.body.version as number };
}

const go = (planId: string, version: number, rationale: string) => p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: version, outcome: 'go', rationale });

/** A SITE checklist blocker (bound to the site only, as the per-site template checklist binds it — no cutoverPlanId). */
async function siteBlocker(siteId: string, title: string) {
  return createCheck(p.pm, projectId, {
    area: 'connectivity',
    title: `${title}: connectivity to customers and NOC tested end to end (synthetic)`,
    mandatory: true,
    blocker: true,
    signoffRole: 'functional_approver',
    siteId,
    failureContingency: 'Contingency: keep traffic on the current carrier path (synthetic)',
  });
}

describe('P3/P4 domain re-review — which transition a FAILED blocker gates [AT-09, REQ-RDY-004, business-gates.md §5 rule 1]', () => {
  it('CONTROL: a failed SITE blocker gates the plan of that site — the GO is refused (422 readiness.go_blocked)', async () => {
    const siteId = await insertSite(projectId, 'S-P34R-C');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Control transition (synthetic)' });
    const checkId = await siteBlocker(siteId, 'Control');
    await failTest(checkId);
    const s = await linkAndSubmit(planId);
    const r = await go(planId, s.version, 'Attempted GO (control, synthetic)');
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.go_blocked');
    expect((r.body.details.blockers as { id: string }[]).map((b) => b.id)).toContain(checkId);
  });

  it('DOM-P34R-01: a descriptive PATCH of the PLAN\'s siteId (planning / rehearsal) takes a FAILED site blocker out of the plan, and the GO is accepted (fixed, regression)', async () => {
    const siteA = await insertSite(projectId, 'S-P34R-1A');
    const siteB = await insertSite(projectId, 'S-P34R-1B');
    const planId = await completePlan(p.pm, projectId, { siteId: siteA, accountableUserId: p.pm.userId, title: 'Transition of hall A (synthetic)' });
    const checkId = await siteBlocker(siteA, 'Hall A');
    await failTest(checkId);
    const before = await plan(p.pm, projectId, planId);
    expect((before.goEvaluation.blockers as { id: string }[]).map((b) => b.id), 'setup: the failed site blocker gates the plan').toContain(checkId);
    // The rebind command (DOM-P3-01 fix) refuses to move the FAILED check — the plan's own site is still a descriptive field.
    const patch = await p.pm.patch(`${P(projectId)}/cutover-plans/${planId}`, { expectedVersion: before.version, siteId: siteB });
    const s = patch.status === 200 ? await linkAndSubmit(planId) : { version: before.version };
    const r = await go(planId, s.version, 'GO after the plan moved to another site (probe)');
    const cur = await check(p.pm, projectId, checkId);
    const hist = (await plan(p.pm, projectId, planId)).decisionHistory.map((h: { kind: string }) => h.kind);
    // Required (business-gates.md §5 rule 1: "which plans a check gates is not a description … re-binding is refused for a
    // FAILED gating check"; AT-09 "block go-live according to the blocker"; CLAUDE.md "no generic PATCH may change a status"):
    // a FAILED blocker raised for the transition keeps gating it until cleared — changing the plan's site does not release it
    // (refused for a plan with a failed gating check, or a scope command with a reason and a decision-history entry).
    expect(
      r.status,
      `plan PATCH siteId A→B ${patch.status}; check ${cur.code} status ${cur.status}; GO ${r.status} ${JSON.stringify(r.body)}; decision history ${JSON.stringify(hist)}`,
    ).not.toBe(201);
  });
});

describe('P3/P4 domain re-review — a FAILED non-waivable blocker released by one specialist [AT-09, AT-13, business-gates.md §5 rule 3, A-P3-02]', () => {
  it('DOM-P34R-02: the sign-off specialist alone determines a FAILED non-waivable blocker "not applicable" and the GO is accepted (fixed, regression)', async () => {
    const siteId = await insertSite(projectId, 'S-P34R-2');
    const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: 'Transition of hall C (synthetic)' });
    const checkId = await createCheck(p.pm, projectId, {
      area: 'physical_access',
      title: 'Hall C: badge access for the NewCo operations staff tested (synthetic)',
      mandatory: true,
      blocker: true,
      signoffRole: 'functional_approver',
      cutoverPlanId: planId,
      siteId,
      failureContingency: 'Contingency: escorted access by the current operator (synthetic)',
    });
    await failTest(checkId);
    let c = await check(p.pm, projectId, checkId);
    expect(c.waivable, 'setup: the check is not waivable').toBe(false);
    // Control of the DOM-P3-02 fix: the same specialist may NOT lower the failed blocker by a determination.
    const det = await p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/determination`, { expectedVersion: c.version, mandatory: false, blocker: false, waivable: false, waiverAuthorityRole: null, basis: 'Not needed for Day 1 (probe, synthetic)' });
    expect(det.status, JSON.stringify(det.body)).toBe(422);
    expect(det.body.code).toBe('readiness.determination.release_not_allowed');
    // … but the "not applicable" sign-off of the FAILED check is a single specialist's act with a note.
    c = await check(p.pm, projectId, checkId);
    const na = await p.approver.post(`${P(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: c.version, outcome: 'not_applicable', note: 'Badge access is not part of this transition (probe, synthetic)' });
    const s = await linkAndSubmit(planId);
    const r = await go(planId, s.version, 'GO after the failed blocker was determined not applicable (probe)');
    const after = await check(p.pm, projectId, checkId);
    // Required (business-gates.md §5 rule 3 / A-P3-02: "a determination never releases an open blocker … a non-waivable one
    // cannot be released"; spec §3 "an exception cannot override a non-waivable condition"; the platform's rule for gate
    // criteria — not applicable needs a second person, DOM-P2-15): a FAILED non-waivable blocker is not released for the GO
    // by one specialist's "not applicable" (refused on a failed gating check, or a second person).
    expect(r.status, `N/A sign-off ${na.status} ${JSON.stringify(na.body)}; check now ${after.status}; GO ${r.status} ${JSON.stringify(r.body)}`).not.toBe(201);
  });
});
