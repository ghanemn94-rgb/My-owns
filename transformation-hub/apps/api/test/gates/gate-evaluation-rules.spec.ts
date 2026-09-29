import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner } from '../helpers';
import { setupProject, gateByKey, crit, startGate, meetCriterion, meetAllMandatory, addEvidence, Personas } from './gate-test-kit';

/**
 * Server-side gate evaluation rules (spec §3): 100% task completion never unlocks a gate; "not applicable" needs an
 * approved specialist determination; prerequisite gates block; met needs evidence reviewed by someone else; criteria of
 * a cycle that is ready for decision are frozen; the gates API is project-isolated.
 */
let projectId: string;

let p: Personas;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('GT-RULES'));
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('Task completion never unlocks a gate [REQ-LCY-011]', () => {
  it('all tasks, deliverables and milestones of G2 complete → G2 still not ready and cannot be submitted', async () => {
    const t = await owner().query(`update task set status = 'done', reported_progress = 100 where project_id = $1 and gate_key = 'G2' returning id`, [projectId]);
    expect(t.rowCount).toBeGreaterThan(0);
    await owner().query(`update deliverable set status = 'accepted' where project_id = $1 and gate_key = 'G2'`, [projectId]);
    await owner().query(`update milestone set status = 'achieved_verified' where project_id = $1 and gate_key = 'G2'`, [projectId]);
    await startGate(p, projectId, 'G2');
    const g2 = await gateByKey(p.pm, projectId, 'G2');
    expect(g2.evaluation.ready).toBe(false);
    expect(g2.evaluation.counts.met).toBe(0);
    expect(g2.evaluation.blockers.filter((b) => b.kind === 'criterion').length).toBeGreaterThan(0);
    expect(g2.rag).toBe('red');
    const r = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g2.id}/assessment/mark-ready`, { expectedVersion: g2.assessment.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.assessment.not_ready');
    expect((await gateByKey(p.pm, projectId, 'G2')).assessment.status).toBe('in_assessment');
  });
});

describe('Criterion review — evidence and separation of duties [REQ-LCY-010]', () => {
  it('met without evidence is refused (422)', async () => {
    await startGate(p, projectId, 'G0');
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = crit(g0, 'G0-C04');
    const r = await p.legal.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.criterion.no_evidence');
  });

  it('the evidence owner cannot accept their own evidence (403); the PM cannot review at all (403)', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = crit(g0, 'G0-C04');
    await addEvidence(p.legal, projectId, c.id);
    const self = await p.legal.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met' });
    expect(self.status).toBe(403);
    expect((await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met' })).status).toBe(403);
    // evidence submitted by the owner, accepted by a different reviewer
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/submit-evidence`, { expectedVersion: c.assessment.version, note: 'Appointment records linked' }).expect(201);
    const c2 = crit(await gateByKey(p.pm, projectId, 'G0'), 'G0-C04');
    expect(c2.assessment.status).toBe('evidence_submitted');
    await p.finance.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c2.assessment.version, outcome: 'met' }).expect(201);
    // stale version → 409
    const stale = await p.finance.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c2.assessment.version, outcome: 'unmet' });
    expect(stale.status).toBe(409);
  });
});

describe('Not applicable requires an approved specialist determination [REQ-LCY-005, P0 review D-01]', () => {
  it('a proposed N/A blocks the gate until the criterion reviewer role (not the proposer) approves it', async () => {
    await meetAllMandatory(p, projectId, 'G0', ['G0-C02', 'G0-C06']);
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    const c2 = crit(g0, 'G0-C02'); // reviewer role: legal_restricted
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c2.id}/propose-not-applicable`, { expectedVersion: c2.assessment.version, basis: 'Committee charter covered by group charter (synthetic basis)' }).expect(201);
    await meetCriterion(p, projectId, 'G0', 'G0-C06');
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(crit(g0, 'G0-C02').assessment.status).toBe('not_applicable');
    expect(g0.evaluation.ready).toBe(false);
    expect(g0.evaluation.blockers.find((b) => b.ref === 'G0-C02')?.message).toMatch(/without an approved specialist determination/);
    const notReady = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/mark-ready`, { expectedVersion: g0.assessment.version });
    expect(notReady.status).toBe(422);

    const url = `/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c2.id}/determine-not-applicable`;
    let v = crit(g0, 'G0-C02').assessment.version;
    // a functional approver without the criterion's reviewer role (legal_restricted) cannot determine it
    const wrongRole = await p.approver.post(url, { expectedVersion: v, approve: true });
    expect(wrongRole.status).toBe(422);
    expect(wrongRole.body.code).toBe('gates.na.unauthorized');
    const ok = await p.legal.post(url, { expectedVersion: v, approve: true, note: 'Legal specialist determination (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const det = crit(g0, 'G0-C02').assessment.notApplicable;
    expect(det.approved).toBe(true);
    expect(g0.evaluation.counts.notApplicable).toBe(1);
    expect(g0.evaluation.ready).toBe(true);
    v = crit(g0, 'G0-C02').assessment.version;
    expect((await p.legal.post(url, { expectedVersion: v, approve: true })).status).toBe(422); // nothing pending any more
  });

  it('the proposer cannot approve their own N/A proposal (403)', async () => {
    await startGate(p, projectId, 'G5');
    let g5 = await gateByKey(p.legal, projectId, 'G5');
    const c = crit(g5, 'G5-C06'); // reviewer role functional_approver; legal also holds it
    await p.legal.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/propose-not-applicable`, { expectedVersion: c.assessment.version, basis: 'No external approvals needed (synthetic)' }).expect(201);
    g5 = await gateByKey(p.legal, projectId, 'G5');
    const self = await p.legal.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/determine-not-applicable`, { expectedVersion: crit(g5, 'G5-C06').assessment.version, approve: true });
    expect(self.status).toBe(403);
    // rejection by another reviewer returns it to unmet
    await p.finance.post(`/api/v1/projects/${projectId}/gates/${g5.id}/criteria/${c.id}/determine-not-applicable`, { expectedVersion: crit(g5, 'G5-C06').assessment.version, approve: false, note: 'Needs specialist assessment' }).expect(201);
    expect(crit(await gateByKey(p.pm, projectId, 'G5'), 'G5-C06').assessment.status).toBe('unmet');
  });
});

describe('Prerequisite gates and frozen cycles [REQ-LCY-010]', () => {
  it('G1 with every mandatory criterion met is still blocked while G0 is not approved', async () => {
    await startGate(p, projectId, 'G1');
    await meetAllMandatory(p, projectId, 'G1');
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.evaluation.counts.unmet).toBe(0);
    expect(g1.evaluation.ready).toBe(false);
    expect(g1.evaluation.blockers).toEqual([{ kind: 'prerequisite', ref: 'G0', message: 'Prerequisite gate G0 is not approved' }]);
    const r = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g1.id}/assessment/mark-ready`, { expectedVersion: g1.assessment.version });
    expect(r.status).toBe(422);
    expect(r.body.details.blockers[0].kind).toBe('prerequisite');
  });

  it('G5 (JV signing readiness) depends only on G1 — partner preparation runs in parallel with separation (AT-11)', async () => {
    const g5 = await gateByKey(p.pm, projectId, 'G5');
    expect(g5.assessment.status).toBe('in_assessment');
    expect((await gateByKey(p.pm, projectId, 'G5')).evaluation.blockers.filter((b) => b.kind === 'prerequisite').map((b) => b.ref)).toEqual(['G1']);
  });

  it('once ready for decision, criteria are frozen until the owner sends the gate back to assessment', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/mark-ready`, { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = crit(g0, 'G0-C01');
    const frozen = await p.finance.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'unmet' });
    expect(frozen.status).toBe(422);
    expect(frozen.body.code).toBe('gates.assessment.not_editable');
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/back-to-assessment`, { expectedVersion: g0.assessment.version, note: 'Recheck C01' }).expect(201);
    await p.finance.post(`/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'unmet', note: 'Returned' }).expect(201);
    const after = await gateByKey(p.pm, projectId, 'G0');
    expect(after.assessment.status).toBe('in_assessment');
    expect(after.evaluation.ready).toBe(false);
    // the gate had been ready and is now blocked → gate.blocked emitted
    const ev = await owner().query(`select payload from outbox_event where project_id = $1 and type = 'gate.blocked' and aggregate_id = $2`, [projectId, after.assessment.id]);
    expect(ev.rows.length).toBeGreaterThan(0);
  });
});

describe('Project isolation of the gates API [REQ-SEC]', () => {
  it('a Project B user cannot read or command this project’s gates (404, no leakage)', async () => {
    const pmB = await loginAs('pm.b');
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    expect((await pmB.get(`/api/v1/projects/${projectId}/gates`)).status).toBe(404);
    expect((await pmB.get(`/api/v1/projects/${projectId}/gates/${g0.id}`)).status).toBe(404);
    expect((await pmB.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/start`, { expectedVersion: 1 })).status).toBe(404);
    // a gate id of this project used under another project path is not found
    const genGates = await owner().query(`select g.project_id from gate_definition g join project p on p.id = g.project_id where p.code = 'DEMO-TRANSFORM' limit 1`);
    expect((await pmB.get(`/api/v1/projects/${genGates.rows[0].project_id}/gates/${g0.id}`)).status).toBe(404);
  });
});
