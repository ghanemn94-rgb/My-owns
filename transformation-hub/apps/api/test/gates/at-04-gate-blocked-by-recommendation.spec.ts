import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner, projectIdByCode, GEN } from '../helpers';
import { setupProject, gateByKey, makeReady, insertDecision, Personas } from './gate-test-kit';

/**
 * AT-04 (gate side): a committee recommendation outside its delegation is not a final approval — the gate stays blocked
 * until the authorized body's approval is recorded. Governance decisions are inserted with the owner pool because the
 * governance API is not available in this worktree (see gate-test-kit.ts).
 */
let projectId: string;
let orgId: string;
let p: Personas;
let g0Id: string;

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-AT04'));
  await makeReady(p, orgId, projectId, 'G0');
  g0Id = (await gateByKey(p.pm, projectId, 'G0')).id;
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

const decide = async (who: keyof Personas, body: Record<string, unknown>) => {
  const g = await gateByKey(p.pm, projectId, 'G0');
  return p[who].post(`/api/v1/projects/${projectId}/gates/${g0Id}/assessment/decide`, { expectedVersion: g.assessment.version, note: 'AT-04 test', ...body });
};

describe('AT-04 — a recommended / pending-external decision keeps the gate blocked [REQ-LCY-010, REQ-LCY-011, REQ-GOV]', () => {
  it('the gate is ready on criteria but shows a decision blocker until a final decision is linked', async () => {
    const g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.assessment.status).toBe('ready_for_decision');
    expect(g.evaluation.ready).toBe(true);
    expect(g.blockers.some((b) => b.kind === 'decision')).toBe(true);
  });

  it('linking a recommended decision (outside delegation) shows it as the blocker; approving is refused (422) and logged', async () => {
    const rec = await insertDecision(orgId, projectId, { code: 'AT04-REC', status: 'recommended', authorityOutcome: 'pending_external_authority', gateKey: 'G0' });
    let g = await gateByKey(p.pm, projectId, 'G0');
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0Id}/assessment/link-decision`, { expectedVersion: g.assessment.version, decisionId: rec }).expect(201);
    g = await gateByKey(p.pm, projectId, 'G0');
    const blocker = g.blockers.find((b) => b.kind === 'decision');
    expect(blocker?.message).toMatch(/recommended — pending the external authority/);

    const r = await decide('sponsor', { outcome: 'approve' }); // uses the linked decision
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.decide.decision_not_final');
    g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.assessment.status).toBe('ready_for_decision'); // still blocked, nothing changed
    expect(g.assessment.decidedBy).toBeNull();
    const audit = await owner().query(`select outcome from audit_event where project_id = $1 and action = 'gates.decide' order by seq desc limit 1`, [projectId]);
    expect(audit.rows[0]?.outcome).toBe('rejected');
  });

  it('other non-final decisions are refused too: under review, approved outside mandate without the authorized body, another gate', async () => {
    const underReview = await insertDecision(orgId, projectId, { code: 'AT04-UR', status: 'under_review', authorityOutcome: 'not_assessed', gateKey: 'G0' });
    expect((await decide('sponsor', { outcome: 'approve', decisionId: underReview })).body.code).toBe('gates.decide.decision_not_final');
    const noExternal = await insertDecision(orgId, projectId, { code: 'AT04-NOEXT', status: 'approved', authorityOutcome: 'pending_external_authority', gateKey: 'G0' });
    const r2 = await decide('sponsor', { outcome: 'approve', decisionId: noExternal });
    expect(r2.status).toBe(422);
    expect(r2.body.detail).toMatch(/no approval by the authorized body/);
    const otherGate = await insertDecision(orgId, projectId, { code: 'AT04-G2', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G2' });
    expect((await decide('sponsor', { outcome: 'approve', decisionId: otherGate })).status).toBe(422);
  });

  it('a decision of another project is invisible (404), and only the gate approver role may decide (403)', async () => {
    const genId = await projectIdByCode(GEN);
    const genOrg = (await owner().query('select org_id from project where id = $1', [genId])).rows[0].org_id;
    const foreign = await insertDecision(genOrg, genId, { code: 'AT04-FOREIGN', status: 'approved', authorityOutcome: 'within_mandate' });
    expect((await decide('sponsor', { outcome: 'approve', decisionId: foreign })).status).toBe(404);
    const ok = await insertDecision(orgId, projectId, { code: 'AT04-OK-CHAIR', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G0' });
    // G0 approver is the sponsor: the chair holds gates.assessment.decide but not this gate's authority.
    expect((await decide('chair', { outcome: 'approve', decisionId: ok })).status).toBe(403);
    expect((await decide('pm', { outcome: 'approve', decisionId: ok })).status).toBe(403);
  });

  it('an approved decision within mandate lets the approver pass the gate; the decision snapshot is kept', async () => {
    const ok = await insertDecision(orgId, projectId, { code: 'AT04-OK', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G0' });
    const plainWithoutWaivers = await decide('sponsor', { outcome: 'approve_with_exceptions', decisionId: ok });
    expect(plainWithoutWaivers.body.code).toBe('gates.decide.no_exceptions');
    const r = await decide('sponsor', { outcome: 'approve', decisionId: ok });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    const row = await owner().query(`select status, decision_id, decided_by, evaluation from gate_assessment where id = $1`, [r.body.assessmentId]);
    expect(row.rows[0]).toMatchObject({ status: 'approved', decision_id: ok, decided_by: p.sponsor.userId });
    expect(row.rows[0].evaluation.atDecision.decision).toMatchObject({ id: ok, status: 'approved', authorityOutcome: 'within_mandate' });
    expect(row.rows[0].evaluation.atDecision.criteria.length).toBeGreaterThan(0);
    // recompute of the status dimensions was enqueued with the decision
    const job = await owner().query(`select count(*)::int as n from job where project_id = $1 and kind = 'gates.recompute_dimensions'`, [projectId]);
    expect(job.rows[0].n).toBeGreaterThan(0);
  });

  it('a decision approved by the authorized body after a recommendation (external reference recorded) can back a gate', async () => {
    // G1 needs G0 (now approved); make G1 ready and back it with an externally approved decision.
    await makeReady(p, orgId, projectId, 'G1');
    const ext = await insertDecision(orgId, projectId, { code: 'AT04-EXT', status: 'approved', authorityOutcome: 'pending_external_authority', gateKey: 'G1', externalRef: 'Demo board resolution ref (synthetic)' });
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    const r = await p.chair.post(`/api/v1/projects/${projectId}/gates/${g1.id}/assessment/decide`, { expectedVersion: g1.assessment.version, outcome: 'approve', decisionId: ext, note: 'approved by the authorized body' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
