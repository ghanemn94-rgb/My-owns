import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, demoUserId, loginAs, owner, Client } from '../helpers';
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
  workstreamId,
  Gov,
  Personas,
} from '../readiness/readiness-kit';

/**
 * P3 DOMAIN REVIEW — Day-1 go/no-go probes (docs/reviews/P3-domain-review.md; AT-09, REQ-RDY-001/004, business-gates.md §5
 * "Any open blocker check forces a no-go [server]"). One DC project for this file (demo-login rate limit), real API only;
 * the owner pool is used for sites (no site API in the readiness kit) and for assertions.
 *
 * `DEFECT …` probes assert the REQUIRED behaviour and are declared with `it.fails` while the defect is open (the suite stays
 * green; the probe turns red once fixed — then rename it `… (fixed, regression)` and make it a plain `it`).
 * `P3D_PROBE_PLAIN=1` runs them as plain tests to show the failure message. `CONTROL …` / `OBSERVED …` are plain tests.
 * All data is synthetic.
 */
// Implementer (fix of the P3 domain review): every DEFECT probe of this file is fixed and renamed `… (fixed, regression)` —
// a plain `it`, assertion unchanged. The alias stays so that P3D_PROBE_PLAIN=1 keeps working for any probe added later.
const defect = process.env['P3D_PROBE_PLAIN'] ? it : it.fails;
void defect;

let projectId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('P3D-GO'));
  gov = await setupGovernance(projectId, p);
});
afterAll(async () => {
  await drainWorker();
  await closeApp();
  await closePools();
});

/** A site plan (the project-level template checks gate only project-wide plans) with one blocker bound to it. */
async function planWithBlocker(siteCode: string, title: string) {
  const siteId = await insertSite(projectId, siteCode);
  const planId = await completePlan(p.pm, projectId, { siteId, accountableUserId: p.pm.userId, title: `${title} (synthetic)` });
  const checkId = await createCheck(p.pm, projectId, {
    area: 'connectivity',
    title: `${title}: connectivity to customers and NOC tested end to end (synthetic)`,
    mandatory: true,
    blocker: true,
    signoffRole: 'functional_approver',
    cutoverPlanId: planId,
    siteId,
    failureContingency: 'Contingency: keep traffic on the current carrier path (synthetic)',
  });
  return { siteId, planId, checkId };
}

async function failTest(checkId: string, c: Client = p.pm) {
  const cur = await check(p.pm, projectId, checkId);
  const r = await c.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: cur.version, result: 'failed', note: 'Carrier path down during the test (synthetic)' });
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

describe('P3 domain review — a failed Day-1 blocker must keep blocking the GO [AT-09, REQ-RDY-001, REQ-RDY-004]', () => {
  it('CONTROL: GO is refused while a failed blocker is bound to the plan (server re-evaluation, AT-09)', async () => {
    const x = await planWithBlocker('S-P3D-C', 'Control transition');
    await failTest(x.checkId);
    const s = await linkAndSubmit(x.planId);
    const r = await go(x.planId, s.version, 'Attempted GO (control, synthetic)');
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('readiness.go_blocked');
    expect((r.body.details.blockers as { id: string }[]).map((b) => b.id)).toContain(x.checkId);
  });

  it('DOM-P3-01: a descriptive PATCH re-binds the FAILED blocker to another plan and the GO of the original plan is accepted (fixed, regression)', async () => {
    const a = await planWithBlocker('S-P3D-1', 'Transition A');
    await failTest(a.checkId);
    const s = await linkAndSubmit(a.planId);
    const blocked = await go(a.planId, s.version, 'First GO attempt (probe)');
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(422);
    // Another plan of the project (any state) — the failed blocker is parked on it through the generic PATCH.
    const other = await completePlan(p.pm, projectId, { title: 'Unrelated transition (synthetic)' });
    const c = await check(p.pm, projectId, a.checkId);
    const patch = await p.pm.patch(`${P(projectId)}/readiness-checks/${a.checkId}`, { expectedVersion: c.version, cutoverPlanId: other });
    const after = await plan(p.pm, projectId, a.planId);
    const r = await go(a.planId, after.version, 'GO after the blocker was moved (probe)');
    const row = (await owner().query(`select status, cutover_plan_id from readiness_check where id = $1`, [a.checkId])).rows[0];
    // Required (spec §7.4 "mandatory blockers"; business-gates.md §5 "Any open blocker check forces a no-go [server]";
    // AT-09; the PATCH contract itself says "never its status, criticality, waivability or sign-off"): the check is still
    // FAILED and still blocks go-live of the transition it was raised for — a descriptive edit cannot take it out of the
    // GO evaluation (refuse the re-binding while failed / while the plan is before its decision, or keep it gating).
    expect(r.status, `PATCH ${patch.status} ${JSON.stringify(patch.body)}; check now ${JSON.stringify(row)}; GO ${r.status} ${JSON.stringify(r.body)}`).not.toBe(201);
  });

  it('DOM-P3-02: the sign-off specialist alone re-determines a FAILED non-waivable blocker as non-blocking and the GO is accepted (fixed, regression)', async () => {
    const b = await planWithBlocker('S-P3D-2', 'Transition B');
    await failTest(b.checkId);
    const s = await linkAndSubmit(b.planId);
    const c = await check(p.pm, projectId, b.checkId);
    expect(c).toMatchObject({ status: 'failed', blocker: true, mandatory: true, waivable: false });
    // The assigned specialist (functional_approver, not the author) lowers the criticality of the failed check.
    const det = await p.approver.post(`${P(projectId)}/readiness-checks/${b.checkId}/determination`, {
      expectedVersion: c.version,
      mandatory: false,
      blocker: false,
      waivable: false,
      waiverAuthorityRole: null,
      basis: 'Re-assessed as not critical for Day 1 (probe, synthetic)',
    });
    const after = await plan(p.pm, projectId, b.planId);
    const r = await go(b.planId, after.version, 'GO after the re-determination (probe)');
    // Required (spec §3 "An exception cannot override a non-waivable condition"; AT-13; the platform rule adopted for CPs
    // in DOM-P4-03, business-gates.md §7: "a determination never releases a blocking condition; a waivable one is released
    // only through the waiver register"): an open (failed) non-waivable blocker is not released by one person's
    // re-determination — the GO stays refused (or the determination is refused / needs a second person).
    expect(r.status, `determination ${det.status} ${JSON.stringify(det.body)}; GO ${r.status} ${JSON.stringify(r.body)}`).not.toBe(201);
  });

  it('DOM-P3-04: after the GO, a blocker test fails — the go-live execution is still recorded; the GO is not flagged (fixed, regression)', async () => {
    const d = await planWithBlocker('S-P3D-4', 'Transition D');
    await clearCheck(p, projectId, d.checkId);
    const s = await linkAndSubmit(d.planId);
    const ok = await go(d.planId, s.version, 'GO — every blocker cleared (probe)');
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('approved_go');
    // Before the window, the connectivity test is re-run and FAILS.
    await failTest(d.checkId);
    const v = await plan(p.pm, projectId, d.planId);
    const exec = await p.pm.post(`${P(projectId)}/cutover-plans/${d.planId}/execution`, { expectedVersion: v.version, note: 'Transition executed in the operational systems (probe, synthetic)' });
    const hist = (await plan(p.pm, projectId, d.planId)).decisionHistory.map((h: { kind: string }) => h.kind);
    // Required (AT-09 "a failed connectivity / access / incident-response test blocks go-live according to the blocker";
    // spec §3 "If approved evidence is found defective, reopen … through a controlled process"): a blocker that fails
    // after the GO blocks the go-live — recording the execution is refused (or the GO is withdrawn / flagged for a new
    // decision) until the blocker is cleared, waived or the contingency is decided.
    expect(exec.status, `plan before execution: status ${v.status}, goEvaluation ${JSON.stringify(v.goEvaluation)}; execution ${exec.status} ${JSON.stringify(exec.body)}; history ${JSON.stringify(hist)}`).not.toBe(201);
  });

  it('DOM-P3-09: the evidence the specialist signed off on is rejected as defective — the check stays "passed" and the GO is accepted (fixed, regression)', async () => {
    const e = await planWithBlocker('S-P3D-9', 'Transition E');
    let c = await check(p.pm, projectId, e.checkId);
    const t = await p.pm.post(`${P(projectId)}/readiness-checks/${e.checkId}/test-runs`, { expectedVersion: c.version, result: 'passed', note: 'Test passed (synthetic)' });
    expect(t.status, JSON.stringify(t.body)).toBe(201);
    const linkId = await addEvidence(p.pm, projectId, 'readiness_check', e.checkId, 'Synthetic test report for the connectivity check');
    c = await check(p.pm, projectId, e.checkId);
    const so = await p.approver.post(`${P(projectId)}/readiness-checks/${e.checkId}/sign-off`, { expectedVersion: c.version, outcome: 'passed', note: 'Signed off on the synthetic test report' });
    expect(so.status, JSON.stringify(so.body)).toBe(201);
    // The documents module's evidence verification (not the linker) rejects the only evidence as defective.
    const lv = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0].version as number;
    const rej = await p.secretary.post(`${P(projectId)}/evidence/${linkId}/verify`, { expectedVersion: lv, decision: 'reject', note: 'Report belongs to another site — defective (probe, synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await drainWorker();
    const s = await linkAndSubmit(e.planId);
    const after = await check(p.pm, projectId, e.checkId);
    const r = await go(e.planId, s.version, 'GO on a check whose evidence was rejected (probe)');
    // Required (business-gates.md §4 rule 9 "a rejected (defective) link stops counting as active evidence at once, returns
    // an accepted criterion … to unmet" — the same evidence rule for Day-1 sign-offs, REQ-RDY-001 "signed off on evidence";
    // spec §3 controlled reopen): a blocker whose only sign-off evidence was rejected no longer clears the GO.
    expect(r.status, `check after rejection: status ${after.status}, evidence ${JSON.stringify(after.evidence)}; GO ${r.status} ${JSON.stringify(r.body)}`).not.toBe(201);
  });
});

describe('P3 domain review — separation of duties on the Day-1 sign-off [REQ-RDY-001, access-matrix §2.4]', () => {
  it('DOM-P3-10: a second project manager who also holds the sign-off role links the evidence and then signs the check off on it (evidence recorder = sign-off) (fixed, regression)', async () => {
    const ws = await workstreamId(p.pm, projectId, 'WS07');
    // workstream_lead cannot be granted at project scope (membership.scope_not_allowed) and a workstream-scoped lead has no
    // project-level documents.evidence.link, so the reachable combination is a (second) project manager who is also
    // functional_approver — both grantable (portfolio admin; PM_GRANTABLE includes functional_approver).
    // The grants are revoked in `finally`: pm.b is the Project-B persona of the isolation tests (AT-03) that run later.
    const admin = await loginAs('portfolio.admin');
    const second = await demoUserId('pm.b');
    const grants: string[] = [];
    try {
      for (const role of ['project_manager', 'functional_approver']) {
        const g = await admin.post(`${P(projectId)}/members`, { userId: second, role, reason: 'P3 domain review probe (second PM with a specialist role)' });
        expect(g.status, JSON.stringify(g.body)).toBe(201);
        grants.push(g.body.id as string);
      }
      const lead = await loginAs('pm.b');
      const checkId = await createCheck(p.pm, projectId, {
        area: 'noc',
        title: 'NOC escalation matrix published (synthetic)',
        mandatory: true,
        blocker: true,
        signoffRole: 'functional_approver',
        workstreamId: ws,
      });
      let c = await check(p.pm, projectId, checkId);
      const t = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: c.version, result: 'passed', note: 'Matrix reviewed (synthetic)' });
      expect(t.status, JSON.stringify(t.body)).toBe(201);
      // The second PM (who also holds the check's assigned sign-off role) records the evidence …
      const link = await lead.post(`${P(projectId)}/evidence`, { targetType: 'readiness_check', targetId: checkId, note: 'Escalation matrix extract (synthetic)' });
      expect(link.status, JSON.stringify(link.body)).toBe(201);
      c = await check(p.pm, projectId, checkId);
      // … and signs the check off on the evidence it recorded itself.
      const so = await lead.post(`${P(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: c.version, outcome: 'passed', note: 'Signed off (probe)' });
      // Required (access-matrix.md §2.4: `readiness.check.signoff` is not_self against "record owner and the person who
      // recorded the status/evidence"; packages/domain/src/readiness.ts `assertReadinessSignoffAllowed` docstring "never by
      // … whoever recorded its latest status/evidence"): the person who linked the evidence cannot sign the check off on it.
      expect(so.status, `evidence linked by pm.b ${link.body.id}; sign-off by pm.b ${so.status} ${JSON.stringify(so.body)}`).toBe(403);
    } finally {
      for (const id of grants) {
        const r = await admin.post(`${P(projectId)}/members/${id}/revoke`, { reason: 'P3 domain review probe done' });
        expect(r.status, JSON.stringify(r.body)).toBe(201);
      }
    }
  });
});
