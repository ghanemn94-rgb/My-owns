import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner, projectIdByCode, GEN } from '../helpers';
import { setupProject, setupGovernance, gateDecision, gateByKey, makeReady, insertDecisionRow, Personas, Gov } from './gate-test-kit';

/**
 * AT-04 (gate side): a committee recommendation outside its delegation is not a final approval — the gate stays blocked
 * until the authorized body's approval is recorded. Decisions are produced by the real governance API (committee, DEMO
 * authority matrix, meeting, votes, outcome, external approval).
 */
let projectId: string;
let orgId: string;
let p: Personas;
let gov: Gov;
let g0Id: string;
let recommended: { id: string; code: string; status: string };

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-AT04'));
  gov = await setupGovernance(projectId, p);
  await makeReady(p, projectId, 'G0');
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

  it('a committee recommendation on a reserved matter is linked as the blocker; approving the gate is refused (422) and logged', async () => {
    recommended = await gateDecision(projectId, p, gov, 'G0'); // reserved matter in the DEMO matrix → recommended
    expect(recommended.status).toBe('recommended');
    let g = await gateByKey(p.pm, projectId, 'G0');
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0Id}/assessment/link-decision`, { expectedVersion: g.assessment.version, decisionId: recommended.id }).expect(201);
    g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.blockers.find((b) => b.kind === 'decision')?.message).toMatch(/recommended — pending the external authority/);
    expect(g.decisions.find((d) => d.id === recommended.id)?.status).toBe('recommended');

    const r = await decide('sponsor', { outcome: 'approve' }); // uses the linked decision
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.decide.decision_not_final');
    g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.assessment.status).toBe('ready_for_decision'); // still blocked, nothing changed
    expect(g.assessment.decidedBy).toBeNull();
    const audit = await owner().query(`select outcome from audit_event where project_id = $1 and action = 'gates.decide' order by seq desc limit 1`, [projectId]);
    expect(audit.rows[0]?.outcome).toBe('rejected');
  });

  it('other non-final decisions are refused too: still under review, approved for another gate, impossible "approved outside mandate without the authorized body"', async () => {
    const underReview = await gateDecision(projectId, p, gov, 'G0', { vote: false });
    expect((await decide('sponsor', { outcome: 'approve', decisionId: underReview.id })).body.code).toBe('gates.decide.decision_not_final');
    const otherGate = await gateDecision(projectId, p, gov, 'G2');
    expect(otherGate.status).toBe('approved');
    const r = await decide('sponsor', { outcome: 'approve', decisionId: otherGate.id });
    expect(r.status).toBe(422);
    expect(r.body.detail).toMatch(/raised for gate G2/);
    // Defense in depth: a state the governance API never produces (owner-inserted) is still refused.
    const noExternal = await insertDecisionRow(orgId, projectId, { code: 'AT04-NOEXT', status: 'approved', authorityOutcome: 'pending_external_authority', gateKey: 'G0' });
    const r2 = await decide('sponsor', { outcome: 'approve', decisionId: noExternal });
    expect(r2.status).toBe(422);
    expect(r2.body.detail).toMatch(/no approval by the authorized body/);
  });

  it('a decision of another project is invisible (404), and only the gate approver role may decide (403)', async () => {
    const genId = await projectIdByCode(GEN);
    const genOrg = (await owner().query('select org_id from project where id = $1', [genId])).rows[0].org_id;
    const foreign = await insertDecisionRow(genOrg, genId, { code: 'AT04-FOREIGN', status: 'approved', authorityOutcome: 'within_mandate' });
    expect((await decide('sponsor', { outcome: 'approve', decisionId: foreign })).status).toBe(404);
    // G0 approver is the sponsor: the chair holds gates.assessment.decide but not this gate's authority.
    expect((await decide('chair', { outcome: 'approve' })).status).toBe(403);
    expect((await decide('pm', { outcome: 'approve' })).status).toBe(403);
  });

  it('once the authorized body approves the recommendation (recorded by a second secretary), the sponsor passes the gate', async () => {
    const v = (await p.chair.get(`/api/v1/projects/${projectId}/decisions/${recommended.id}`).expect(200)).body.version;
    const ext = await gov.secretary2.post(`/api/v1/projects/${projectId}/decisions/${recommended.id}/record-external-approval`, {
      expectedVersion: v,
      outcome: 'approved',
      externalReference: 'DEMO-BOARD-RESOLUTION-G0 (synthetic)',
    });
    expect(ext.status, JSON.stringify(ext.body)).toBe(201);
    expect(ext.body.status).toBe('approved');
    let g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.blockers.some((b) => b.kind === 'decision')).toBe(false);

    const noExceptions = await decide('sponsor', { outcome: 'approve_with_exceptions' });
    expect(noExceptions.body.code).toBe('gates.decide.no_exceptions');
    const r = await decide('sponsor', { outcome: 'approve' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.status).toBe('approved');
    const row = await owner().query(`select status, decision_id, decided_by, evaluation from gate_assessment where id = $1`, [r.body.assessmentId]);
    expect(row.rows[0]).toMatchObject({ status: 'approved', decision_id: recommended.id, decided_by: p.sponsor.userId });
    expect(row.rows[0].evaluation.atDecision.decision).toMatchObject({
      id: recommended.id,
      status: 'approved',
      authorityOutcome: 'pending_external_authority',
      externalAuthorityReference: 'DEMO-BOARD-RESOLUTION-G0 (synthetic)',
    });
    expect(row.rows[0].evaluation.atDecision.criteria.length).toBeGreaterThan(0);
    const job = await owner().query(`select count(*)::int as n from job where project_id = $1 and kind = 'gates.recompute_dimensions'`, [projectId]);
    expect(job.rows[0].n).toBeGreaterThan(0);
    g = await gateByKey(p.pm, projectId, 'G0');
    expect(g.rag).toBe('green');
  });

  it('a decision approved within the committee mandate backs an operational gate (G1)', async () => {
    await makeReady(p, projectId, 'G1');
    const d = await gateDecision(projectId, p, gov, 'G1');
    expect(d.status).toBe('approved');
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    const r = await p.chair.post(`/api/v1/projects/${projectId}/gates/${g1.id}/assessment/decide`, { expectedVersion: g1.assessment.version, outcome: 'approve', decisionId: d.id, note: 'Within mandate' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  });
});
