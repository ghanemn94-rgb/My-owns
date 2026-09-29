import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import {
  P,
  addEvidence,
  addPlanEvidenceViaOwner,
  check,
  clearCheck,
  completePlan,
  createCheck,
  decisionOfType,
  grantWorkstreamRole,
  insertSite,
  plan,
  setupGovernance,
  setupProject,
  workstreamId,
  Gov,
  Personas, drainWorker } from './readiness-kit';

/**
 * AT-09: a failed connectivity / access / incident-response readiness test blocks go-live according to the blocker, and
 * the contingency runbook and the decision history are shown. GO is evaluated on the server at decision time.
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let opsLead: Client;
let siteId: string;
let planId: string;
let goDecisionId: string;
const checks: Record<'connectivity' | 'access' | 'incident', string> = { connectivity: '', access: '', incident: '' };

beforeAll(async () => {
  ({ projectId, p } = await setupProject('RD-AT09'));
  gov = await setupGovernance(projectId, p);
  siteId = await insertSite(projectId, 'S-AT09');
  // Operations workstream lead (workstream-scoped role only) records the execution; the PM is the accountable owner.
  const ws07 = await workstreamId(p.pm, projectId, 'WS07');
  await grantWorkstreamRole(projectId, 'tech.lead', 'workstream_lead', ws07);
  opsLead = await loginAs('tech.lead');
  goDecisionId = (await decisionOfType(projectId, p, gov, 'day1_go_no_go')).id;
});
afterAll(async () => {
  await drainWorker(); // leave no queued job of this spec behind (full handler registry)
  await closeApp();
  await closePools();
});

describe('AT-09 — failed readiness test blocks go-live; contingency and decision history shown [REQ-RDY-001, REQ-RDY-003, REQ-RDY-004, REQ-RDY-005, REQ-RDY-006]', () => {
  it('REQ-RDY-003: a plan without a rollback plan cannot be submitted for go/no-go', async () => {
    const r = await p.pm.post(`${P(projectId)}/cutover-plans`, { title: 'Incomplete plan (synthetic)', siteId, runbookSummary: 'Runbook (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const s = await p.pm.post(`${P(projectId)}/cutover-plans/${r.body.id}/submit-for-decision`, { expectedVersion: r.body.version });
    expect(s.status).toBe(422);
    expect(s.body.code).toBe('readiness.cutover.incomplete');
    expect(s.body.details.missing).toEqual(expect.arrayContaining(['contingency/rollback plan', 'transition window', 'service-impact assessment', 'accountable owner', 'testing / rehearsal', 'approved communications']));
    expect((await plan(p.pm, projectId, r.body.id)).status).toBe('planning');
  });

  it('sets up a complete site transition gated by connectivity, access and incident-response blockers', async () => {
    const ws07 = await workstreamId(p.pm, projectId, 'WS07');
    planId = await completePlan(p.pm, projectId, { siteId, workstreamId: ws07, accountableUserId: p.pm.userId });
    const base = { mandatory: true, blocker: true, signoffRole: 'functional_approver', cutoverPlanId: planId, siteId };
    checks.connectivity = await createCheck(p.pm, projectId, { ...base, area: 'connectivity', title: 'Connectivity to customers and NOC tested end to end (test)', failureContingency: 'Contingency: keep traffic on the current carrier path; invoke rollback step 3 (synthetic)' });
    checks.access = await createCheck(p.pm, projectId, { ...base, area: 'physical_access', title: 'Physical access rights for NewCo staff tested (test)', failureContingency: 'Contingency: escorted access by current operator (synthetic)' });
    checks.incident = await createCheck(p.pm, projectId, { ...base, area: 'incident_management', title: 'Incident-response process tested (test)', failureContingency: 'Contingency: current operator NOC handles P1 incidents (synthetic)' });
    const v = await plan(p.pm, projectId, planId);
    expect(v.prerequisites).toEqual({ hasRunbook: true, hasRollbackPlan: true, communicationsApproved: true, hasWindow: true, hasServiceImpact: true, hasAccountableOwner: true, testingDone: true, hasApprovedGoDecision: false });
    expect(v.checks.map((c: { id: string }) => c.id).sort()).toEqual(Object.values(checks).sort());
  });

  it('a failed connectivity test sets the check failed; the test history is append-only', async () => {
    const c = await check(p.pm, projectId, checks.connectivity);
    const r = await p.pm.post(`${P(projectId)}/readiness-checks/${checks.connectivity}/test-runs`, { expectedVersion: c.version, result: 'failed', note: 'Carrier path B down during the test (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'failed', seq: 1 });
    const after = await check(p.pm, projectId, checks.connectivity);
    expect(after.testRuns).toHaveLength(1);
    expect(after.testRuns[0]).toMatchObject({ result: 'failed', recordedBy: p.pm.userId });
    await expect(owner().query(`update readiness_test_run set result = 'passed' where readiness_check_id = $1`, [checks.connectivity])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from readiness_test_run where readiness_check_id = $1`, [checks.connectivity])).rejects.toThrow(/append_only_violation/);
  });

  it('only the go/no-go authority decides; the plan is submitted by another person first', async () => {
    let v = await plan(p.pm, projectId, planId);
    const link = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/go-decision`, { expectedVersion: v.version, decisionId: goDecisionId });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    // Deciding before the plan is submitted is an invalid transition.
    v = await plan(p.pm, projectId, planId);
    const early = await p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: v.version, outcome: 'go', rationale: 'Too early (test)' });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('cutover.invalid_transition');
    const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version, note: 'Ready for the Day-1 go/no-go (test)' });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    expect(sub.body.status).toBe('ready_for_decision');
    for (const c of [p.pm, p.contributor, p.approver]) {
      const r = await c.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: sub.body.version, outcome: 'go', rationale: 'Not my decision (test)' });
      expect(r.status, `${c.persona}: ${JSON.stringify(r.body)}`).toBe(403);
    }
  });

  it('GO is refused while the connectivity blocker is failed — even with an approved decision; refusal kept in the history', async () => {
    const before = await plan(p.pm, projectId, planId);
    expect(before.goDecision).toMatchObject({ id: goDecisionId, status: 'approved', issue: null });
    expect(before.prerequisites.hasApprovedGoDecision).toBe(true);
    const r = await p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: before.version, outcome: 'go', rationale: 'Attempted GO (test)' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('readiness.go_blocked');
    const blockers = r.body.details.blockers as { id: string; status: string; blocker: boolean }[];
    expect(blockers.find((b) => b.id === checks.connectivity)).toMatchObject({ status: 'failed', blocker: true });
    expect(r.body.details.missing).toEqual([]);

    const v = await plan(p.pm, projectId, planId);
    expect(v.status).toBe('ready_for_decision');
    expect(v.goNoGo).toBe('pending');
    expect(v.version).toBe(before.version);
    expect(v.goEvaluation.allowed).toBe(false);
    const conn = v.checks.find((c: { id: string }) => c.id === checks.connectivity);
    expect(conn).toMatchObject({ status: 'failed', blocker: true, latestTest: { result: 'failed' } });
    expect(conn.failureContingency).toMatch(/Contingency: keep traffic/);
    expect(v.contingencyPlan).toMatch(/Contingency runbook/);
    expect(v.rollbackPlan).toMatch(/Rollback/);
    const kinds = v.decisionHistory.map((h: { kind: string }) => h.kind);
    expect(kinds).toEqual(['rehearsal', 'submitted', 'go_blocked']);
    const refused = v.decisionHistory[2];
    expect(refused).toMatchObject({ actorUserId: p.sponsor.userId, rationale: 'Attempted GO (test)', goDecisionId });
    expect(refused.evaluation.blockers.map((b: { id: string }) => b.id)).toContain(checks.connectivity);

    const audit = await owner().query(`select outcome, actor_user_id, reason from audit_event where project_id = $1 and action = 'readiness.cutover.decide_go' and entity_id = $2`, [projectId, planId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ outcome: 'rejected', actor_user_id: p.sponsor.userId });
    expect(audit.rows[0].reason).toMatch(/GO refused: 3 open blocker/);
  });

  it('a stale expectedVersion is a 409 (no lost update)', async () => {
    const v = await plan(p.pm, projectId, planId);
    const r = await p.chair.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: v.version - 1, outcome: 'no_go', rationale: 'Stale (test)' });
    expect(r.status).toBe(409);
  });

  it('NO-GO is recorded with its rationale; the plan returns to planning with the history preserved', async () => {
    let v = await plan(p.pm, projectId, planId);
    const r = await p.chair.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: v.version, outcome: 'no_go', rationale: 'Connectivity blocker failed; re-test after carrier remediation (test)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'no_go', goNoGo: 'no_go' });
    const back = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/return-to-planning`, { expectedVersion: r.body.version, note: 'Remediate and re-test (test)' });
    expect(back.status, JSON.stringify(back.body)).toBe(201);
    v = await plan(p.pm, projectId, planId);
    expect(v.decisionHistory.map((h: { kind: string }) => h.kind)).toEqual(['rehearsal', 'submitted', 'go_blocked', 'no_go', 'returned_to_planning']);
    expect(v.decisionHistory[3]).toMatchObject({ actorUserId: p.chair.userId, fromStatus: 'ready_for_decision', toStatus: 'no_go' });
  });

  it('REQ-RDY-001: sign-off only by the assigned specialist role, never by whoever recorded the latest test, and on evidence', async () => {
    const other = await createCheck(p.pm, projectId, { area: 'security', title: 'Legal-assigned check (test)', mandatory: false, blocker: false, signoffRole: 'legal_restricted' });
    let c = await check(p.pm, projectId, other);
    await addEvidence(p.pm, projectId, 'readiness_check', other);
    c = await check(p.pm, projectId, other);
    const wrongRole = await p.approver.post(`${P(projectId)}/readiness-checks/${other}/sign-off`, { expectedVersion: c.version, outcome: 'passed' });
    expect(wrongRole.status).toBe(403);
    expect(wrongRole.body.code).toBe('readiness.signoff.not_assigned_role');
    const noPerm = await p.sponsor.post(`${P(projectId)}/readiness-checks/${other}/sign-off`, { expectedVersion: c.version, outcome: 'passed' });
    expect(noPerm.status).toBe(403);
    const ok = await p.legal.post(`${P(projectId)}/readiness-checks/${other}/sign-off`, { expectedVersion: c.version, outcome: 'passed', note: 'Legal sign-off (test)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body.status).toBe('passed');

    // Evidence is required; the latest failing test blocks sign-off.
    c = await check(p.pm, projectId, checks.connectivity);
    const failedLatest = await p.approver.post(`${P(projectId)}/readiness-checks/${checks.connectivity}/sign-off`, { expectedVersion: c.version, outcome: 'passed' });
    expect(failedLatest.status).toBe(422);
    expect(failedLatest.body.code).toBe('readiness.signoff.latest_test_failed');
    const pass = await p.pm.post(`${P(projectId)}/readiness-checks/${checks.connectivity}/test-runs`, { expectedVersion: c.version, result: 'passed', note: 'Re-test after carrier remediation (synthetic)' });
    expect(pass.body.status).toBe('in_progress');
    const noEvidence = await p.approver.post(`${P(projectId)}/readiness-checks/${checks.connectivity}/sign-off`, { expectedVersion: pass.body.version, outcome: 'passed' });
    expect(noEvidence.status).toBe(422);
    expect(noEvidence.body.code).toBe('readiness.signoff.no_evidence');
  });

  it('after remediation (passed re-tests, evidence, specialist sign-offs) GO is allowed and recorded', async () => {
    for (const id of Object.values(checks)) await clearCheck(p, projectId, id);
    const conn = await check(p.pm, projectId, checks.connectivity);
    expect(conn.testRuns.map((t: { result: string }) => t.result)).toEqual(['failed', 'passed', 'passed']); // the failure stays visible
    expect(conn).toMatchObject({ status: 'passed', signedOffBy: p.approver.userId });
    let v = await plan(p.pm, projectId, planId);
    expect(v.goEvaluation).toEqual({ allowed: true, blockers: [], missing: [] });
    const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/submit-for-decision`, { expectedVersion: v.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const go = await p.sponsor.post(`${P(projectId)}/cutover-plans/${planId}/go-no-go`, { expectedVersion: sub.body.version, outcome: 'go', rationale: 'All blockers cleared; approved decision linked (test)' });
    expect(go.status, JSON.stringify(go.body)).toBe(201);
    expect(go.body).toMatchObject({ status: 'approved_go', goNoGo: 'go' });
    v = await plan(p.pm, projectId, planId);
    expect(v).toMatchObject({ goNoGoDecidedBy: p.sponsor.userId, goNoGoRationale: 'All blockers cleared; approved decision linked (test)' });
    expect(v.decisionHistory.at(-1)).toMatchObject({ kind: 'go', toStatus: 'approved_go', goDecisionId, evaluation: { blockers: [], missing: [] } });
    // The plan is locked after GO (descriptive edits need a return to planning, never silently).
    const edit = await p.pm.patch(`${P(projectId)}/cutover-plans/${planId}`, { expectedVersion: v.version, rollbackPlan: 'Changed after GO (test)' });
    expect(edit.status).toBe(422);
    expect(edit.body.code).toBe('readiness.cutover.locked');
  });

  it('REQ-RDY-006 / REQ-RDY-005: execution is recorded (never performed); acceptance needs evidence, by the accountable owner, not the executor', async () => {
    let v = await plan(p.pm, projectId, planId);
    const exec = await opsLead.post(`${P(projectId)}/cutover-plans/${planId}/execution`, { expectedVersion: v.version, note: 'Executed in the operational change system, change ref CHG-TEST (synthetic)' });
    expect(exec.status, JSON.stringify(exec.body)).toBe(201);
    expect(exec.body.status).toBe('executed');
    const noEv = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/accept`, { expectedVersion: exec.body.version, note: 'Accept (test)' });
    expect(noEv.status).toBe(422);
    expect(noEv.body.code).toBe('readiness.acceptance.no_evidence');
    await addPlanEvidenceViaOwner(projectId, planId, p.pm.userId);
    const byExecutor = await opsLead.post(`${P(projectId)}/cutover-plans/${planId}/accept`, { expectedVersion: exec.body.version, note: 'Self-accept (test)' });
    expect(byExecutor.status).toBe(403);
    const ok = await p.pm.post(`${P(projectId)}/cutover-plans/${planId}/accept`, { expectedVersion: exec.body.version, note: 'Post-transition checks passed (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    v = await plan(p.pm, projectId, planId);
    expect(v).toMatchObject({ status: 'accepted', postTransitionAccepted: true, postTransitionAcceptedBy: p.pm.userId, executedBy: opsLead.userId, acceptanceEvidence: { active: 1, conflicting: 0 } });
    expect(v.decisionHistory.map((h: { kind: string }) => h.kind).slice(-3)).toEqual(['go', 'executed', 'accepted']);
  });

  it('GO needs a FINAL governance decision of the go/no-go type (under review / wrong type are refused)', async () => {
    const site2 = await insertSite(projectId, 'S-AT09-B');
    const pid2 = await completePlan(p.pm, projectId, { siteId: site2, accountableUserId: p.pm.userId });
    const wrongType = (await decisionOfType(projectId, p, gov, 'tsa_approval_or_extension')).id;
    let v = await plan(p.pm, projectId, pid2);
    const wrong = await p.pm.post(`${P(projectId)}/cutover-plans/${pid2}/go-decision`, { expectedVersion: v.version, decisionId: wrongType });
    expect(wrong.status).toBe(422);
    expect(wrong.body.code).toBe('readiness.decision.wrong_type');
    const pending = (await decisionOfType(projectId, p, gov, 'day1_go_no_go', { vote: false })).id;
    const link = await p.pm.post(`${P(projectId)}/cutover-plans/${pid2}/go-decision`, { expectedVersion: v.version, decisionId: pending });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const sub = await p.pm.post(`${P(projectId)}/cutover-plans/${pid2}/submit-for-decision`, { expectedVersion: link.body.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const go = await p.chair.post(`${P(projectId)}/cutover-plans/${pid2}/go-no-go`, { expectedVersion: sub.body.version, outcome: 'go', rationale: 'GO without a final decision (test)' });
    expect(go.status).toBe(422);
    expect(go.body.details).toMatchObject({ blockers: [], missing: ['approved go/no-go decision'] });
    v = await plan(p.pm, projectId, pid2);
    expect(v.goDecision.issue).toMatch(/under_review/);
    expect(v.status).toBe('ready_for_decision');
  });

  it('the project-wide Day-1 plan is gated by every unbound check, incl. the template defaults (REQ-RDY-002)', async () => {
    const day1 = await completePlan(p.pm, projectId, { accountableUserId: p.pm.userId, title: 'Day-1 go-live (synthetic)' });
    const v = await plan(p.pm, projectId, day1);
    // The factory-created DC defaults (all 14 areas) plus the site checks: none bound to another plan.
    expect(v.checks.length).toBeGreaterThanOrEqual(31); // 31 DC template defaults (+ unbound test checks)
    expect(new Set(v.checks.map((c: { area: string }) => c.area)).size).toBe(14);
    expect(v.goEvaluation.allowed).toBe(false);
    expect(v.checks.some((c: { id: string }) => Object.values(checks).includes(c.id))).toBe(false); // bound to another plan
    const summary = (await p.pm.get(`${P(projectId)}/readiness/summary`).expect(200)).body;
    expect(summary.checks.uncoveredAreas).toEqual([]);
    expect(summary.checks.openBlockers).toBeGreaterThan(0);
  });
});
