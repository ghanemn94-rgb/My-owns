import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import {
  setupProject,
  setupGovernance,
  gateDecision,
  gateByKey,
  crit,
  makeReady,
  approveGate,
  addEvidence,
  evidenceLinks,
  contradictEvidence,
  supersedeAll,
  runWorker,
  startGate,
  Personas,
  Gov,
} from './gate-test-kit';

/**
 * AT-14: new evidence conflicts with evidence previously relied upon → conflict flagged and a controlled reassessment,
 * preserving prior decisions and sources. The contradicting evidence is linked through the DOCUMENTS API (which flags both
 * links and emits `evidence.changed`); the worker then runs the gates handlers through the real outbox → job path.
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let g0Cycle1: Record<string, unknown>;
let g0Decision: string;

const activeLink = async (criterionId: string) => (await evidenceLinks(p.pm, projectId, criterionId)).find((l) => l.status === 'active')!.id;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('GT-AT14'));
  gov = await setupGovernance(projectId, p);
  await makeReady(p, projectId, 'G0');
  ({ decisionId: g0Decision } = await approveGate(p, gov, projectId, 'G0'));
  await makeReady(p, projectId, 'G1');
  const g0 = await gateByKey(p.pm, projectId, 'G0');
  g0Cycle1 = (await owner().query(`select * from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-14 — conflicting evidence triggers a controlled reassessment [REQ-LCY-015]', () => {
  it('on an undecided gate: the criterion becomes conflicting and a ready gate is reported blocked (gate.blocked)', async () => {
    let g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.assessment.status).toBe('ready_for_decision');
    const c = crit(g1, 'G1-C03');
    await contradictEvidence(p.pm, projectId, c.id, await activeLink(c.id), 'Newer register extract contradicts the earlier one (synthetic)');
    await runWorker();

    g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(crit(g1, 'G1-C03').assessment.status).toBe('conflicting');
    expect(crit(g1, 'G1-C03').evidence.conflicting).toBe(2); // both links preserved and flagged by documents
    expect(g1.evaluation.ready).toBe(false);
    expect(g1.blockers.some((b) => b.kind === 'evidence_conflict' && b.ref === 'G1-C03')).toBe(true);
    expect(g1.rag).toBe('red');
    const ev = await owner().query(`select payload from outbox_event where project_id = $1 and type = 'gate.blocked' and aggregate_id = $2`, [projectId, g1.assessment.id]);
    expect(ev.rows.length).toBeGreaterThan(0);
    expect(ev.rows[0].payload.gateKey).toBe('G1');
    const audit = await owner().query(`select actor_kind from audit_event where project_id = $1 and action = 'gates.criterion.mark_conflicting'`, [projectId]);
    expect(audit.rows[0]?.actor_kind).toBe('service');
    // a decision is refused at decision time (re-evaluation), even though the status is still ready_for_decision
    const d = await gateDecision(projectId, p, gov, 'G1');
    expect(d.status).toBe('approved');
    const r = await p.chair.post(`/api/v1/projects/${projectId}/gates/${g1.id}/assessment/decide`, { expectedVersion: g1.assessment.version, outcome: 'approve', decisionId: d.id, note: 'x' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.decide.not_ready');
  });

  it('on an approved gate: the approval is NOT modified — it is flagged for reassessment with an escalation and notifications', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = crit(g0, 'G0-C01');
    await contradictEvidence(p.pm, projectId, c.id, await activeLink(c.id), 'Charter version conflict (synthetic)');
    await runWorker();

    const row = (await owner().query(`select * from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    for (const k of ['status', 'decided_by', 'decided_at', 'decision_id', 'decision_note', 'cycle', 'is_current', 'version']) expect(row[k]).toEqual(g0Cycle1[k]);
    expect(row.status).toBe('approved');
    expect(row.evaluation.needsReassessment).toBe(true);
    expect(row.evaluation.reassessment.criteria.map((x: { key: string }) => x.key)).toEqual(['G0-C01']);
    expect(row.evaluation.atDecision).toEqual((g0Cycle1['evaluation'] as { atDecision: unknown }).atDecision);
    const ca = await owner().query(`select status from criterion_assessment where assessment_id = $1 and criterion_id = $2`, [g0.assessment.id, c.id]);
    expect(ca.rows[0].status).toBe('met'); // criterion rows of the decided cycle are preserved

    const esc = await owner().query(`select code, status, is_system_generated, source_type from escalation where project_id = $1 and source_id = $2`, [projectId, g0.assessment.id]);
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0]).toMatchObject({ status: 'open', is_system_generated: true, source_type: 'gate_assessment' });
    const notes = await owner().query(`select user_id from notification where project_id = $1 and kind = 'gate.reassessment_requested'`, [projectId]);
    const notified = new Set(notes.rows.map((n) => n.user_id));
    for (const who of [p.sponsor, p.chair, p.secretary]) expect(notified.has(who.userId)).toBe(true);
    expect(notified.has(p.contributor.userId)).toBe(false);

    const view = await gateByKey(p.pm, projectId, 'G0');
    expect(view.assessment.status).toBe('approved');
    expect(view.assessment.reassessment.needsReassessment).toBe(true);
    expect(view.rag).toBe('red');

    // a further evidence change is processed idempotently (no second escalation)
    await addEvidence(p.pm, projectId, crit(view, 'G0-C02').id, 'Additional note (synthetic)');
    await runWorker();
    expect((await owner().query(`select count(*)::int as n from escalation where project_id = $1 and source_type = 'gate_assessment'`, [projectId])).rows[0].n).toBe(1);
  });

  it('only authorized roles reopen, with a reason; reopen creates cycle 2 and leaves cycle 1 untouched', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const url = `/api/v1/projects/${projectId}/gates/${g0.id}/assessment/reopen`;
    expect((await p.contributor.post(url, { expectedVersion: g0.assessment.version, reason: 'x' })).status).toBe(403);
    expect((await p.chair.post(url, { expectedVersion: g0.assessment.version, reason: '  ' })).status).toBe(400);
    const r = await p.chair.post(url, { expectedVersion: g0.assessment.version, reason: 'Charter evidence found conflicting (AT-14 test)' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ cycle: 2, status: 'reopened' });

    const rows = (await owner().query(`select * from gate_assessment where gate_id = $1 order by cycle`, [g0.id])).rows;
    expect(rows).toHaveLength(2);
    const [c1, c2] = rows;
    for (const k of ['status', 'decided_by', 'decided_at', 'decision_id', 'decision_note', 'cycle']) expect(c1[k]).toEqual(g0Cycle1[k]);
    expect(c1.is_current).toBe(false);
    expect(c2).toMatchObject({ cycle: 2, status: 'reopened', is_current: true, supersedes_assessment_id: c1.id, decision_id: null });
    const snap = await owner().query(`select snapshot from record_version where entity_type = 'gate_assessment' and entity_id = $1`, [c1.id]);
    expect(snap.rows[0].snapshot.status).toBe('approved');

    const view = await gateByKey(p.pm, projectId, 'G0');
    expect(view.history.map((h) => `${h.cycle}:${h.status}`)).toEqual(['1:approved']);
    expect(crit(view, 'G0-C01').assessment.status).toBe('conflicting');
    expect(crit(view, 'G0-C02').assessment.status).toBe('met');
    expect(view.cycles.find((x) => x.cycle === 1)!.criteria.find((x) => x.key === 'G0-C01')!.status).toBe('met');
    // downstream G1 now sees its prerequisite as not approved
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.evaluation.blockers.some((b) => b.kind === 'prerequisite' && b.ref === 'G0')).toBe(true);
  });

  it('the new cycle needs the conflict resolved, a fresh review and a fresh decision', async () => {
    await startGate(p, projectId, 'G0');
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    const c = crit(g0, 'G0-C01');
    const url = `/api/v1/projects/${projectId}/gates/${g0.id}/criteria/${c.id}/review`;
    const blocked = await p.secretary.post(url, { expectedVersion: c.assessment.version, outcome: 'met' });
    expect(blocked.status).toBe(422);
    expect(blocked.body.code).toBe('gates.criterion.evidence_conflict');
    // Documents resolves the conflict: both links superseded (kept for history), corrected evidence linked.
    await supersedeAll(p.pm, projectId, c.id);
    await addEvidence(p.pm, projectId, c.id, 'Corrected charter evidence (synthetic)');
    await p.secretary.post(url, { expectedVersion: c.assessment.version, outcome: 'met', note: 'Re-reviewed against the corrected charter' }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/mark-ready`, { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const reuse = await p.sponsor.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/decide`, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: g0Decision, note: 'x' });
    expect(reuse.status).toBe(422);
    expect(reuse.body.code).toBe('gates.decide.decision_reused');
    const fresh = await gateDecision(projectId, p, gov, 'G0', { externalApproval: true });
    const ok = await p.sponsor.post(`/api/v1/projects/${projectId}/gates/${g0.id}/assessment/decide`, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: fresh.id, note: 'Re-approved after reassessment' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const view = await gateByKey(p.pm, projectId, 'G0');
    expect(view.assessment).toMatchObject({ cycle: 2, status: 'approved', decisionId: fresh.id });
    expect(view.assessment.reassessment.needsReassessment).toBe(false);
    expect(view.history[0]).toMatchObject({ cycle: 1, status: 'approved' });
  });
});
