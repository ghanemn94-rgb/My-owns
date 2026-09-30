import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { P, tabledDecision, type Actors } from '../governance/gov-fixtures';
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
  insertDecisionRow,
  meetCriterion,
  runWorker,
  startGate,
  Personas,
  Gov,
} from './gate-test-kit';

/**
 * P2 domain review fixes on the gates side (docs/reviews/P2-domain-review.md): DOM-P2-01 (the decision backing a gate must be
 * of a type the approved authority matrix assigns to THAT gate, decided by the body holding that authority), DOM-P2-05
 * (superseded / defective evidence triggers a controlled reassessment), DOM-P2-15 (waivability by the designated specialist,
 * applicability from the recorded determination) and DOM-P2-09 (gate items in My Work). One gate-kit project (synthetic).
 */
let projectId: string;
let orgId: string;
let p: Personas;
let gov: Gov;

beforeAll(async () => {
  ({ projectId, orgId, p } = await setupProject('GT-P2FX'));
  gov = await setupGovernance(projectId, p);
  await makeReady(p, projectId, 'G0');
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

type WorkItem = { type: string; entityId: string; code: string | null; projectId: string };
const myWork = async (c: Personas[keyof Personas]) => ((await c.get('/api/v1/me/work').expect(200)).body.items as WorkItem[]).filter((i) => i.projectId === projectId);

describe('DOM-P2-01 — a gate is backed only by a decision of the type its approved authority matrix assigns to it [REQ-GOV-003, REQ-GOV-022, REQ-GOV-023, AT-04]', () => {
  it('link-decision refuses a decision raised for no gate, and one of a decision type not assigned to this gate (422, nothing linked)', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const url = `${P(projectId)}/gates/${g0.id}/assessment/link-decision`;
    const noGate = await tabledDecision(projectId, p as unknown as Actors, p.pm, gov.committeeId, gov.meetingId, { decisionTypeKey: 'baseline_approval', amount: null, requiredAuthority: 'Steering committee (DEMO matrix)' });
    const r1 = await p.pm.post(url, { expectedVersion: g0.assessment.version, decisionId: noGate.id });
    expect(r1.status, JSON.stringify(r1.body)).toBe(422);
    expect(r1.body.code).toBe('gates.decision.not_for_gate');
    expect(r1.body.detail).toMatch(/not raised for a gate/);

    const wrongType = await gateDecision(projectId, p, gov, 'G0', { decisionTypeKey: 'gate_decision_operational', vote: false });
    const r2 = await p.pm.post(url, { expectedVersion: g0.assessment.version, decisionId: wrongType.id });
    expect(r2.status, JSON.stringify(r2.body)).toBe(422);
    expect(r2.body.code).toBe('gates.decision.not_for_gate');
    expect(r2.body.detail).toMatch(/does not assign decision type gate_decision_operational to gate G0/);

    const after = await gateByKey(p.pm, projectId, 'G0');
    expect(after.assessment.decisionId).toBeNull();
    expect(after.assessment.version).toBe(g0.assessment.version);
    // The gate view explains why the decision raised for G0 cannot back it (translatable code).
    const listed = (after as unknown as { decisions: { id: string; blockerI18n: { code: string }[] }[] }).decisions.find((d) => d.id === wrongType.id);
    expect(listed?.blockerI18n[0]?.code).toBe('gate.blocker.decision_type_not_for_gate');
  });

  it('a decision of a committee with no approved authority matrix cannot back a gate (owner-inserted state; 422)', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const noMatrix = await insertDecisionRow(orgId, projectId, { code: 'P2FX-NOMX', status: 'approved', authorityOutcome: 'within_mandate', gateKey: 'G0' });
    const r = await p.sponsor.post(`${P(projectId)}/gates/${g0.id}/assessment/decide`, { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: noMatrix, note: 'probe (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('gates.decide.decision_not_for_gate');
    expect(r.body.detail).toMatch(/no approved authority matrix/);
    expect((await gateByKey(p.pm, projectId, 'G0')).assessment.status).toBe('ready_for_decision');
    const audit = await owner().query(`select outcome from audit_event where project_id = $1 and action = 'gates.decide' order by seq desc limit 1`, [projectId]);
    expect(audit.rows[0]?.outcome).toBe('rejected');
  });

  it('G0 passes on the dedicated reserved type once the authorized body approved it; the decision snapshot records type and matrix', async () => {
    const { decisionId } = await approveGate(p, gov, projectId, 'G0');
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.assessment.status).toBe('approved');
    const row = (await owner().query(`select evaluation from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    expect(row.evaluation.atDecision.decision).toMatchObject({ id: decisionId, decisionTypeKey: 'gate_decision_mandate', gateKey: 'G0', committeeId: gov.committeeId, authorityOutcome: 'pending_external_authority' });
    expect(row.evaluation.atDecision.decision.matrixVersionId).toEqual(expect.any(String));
    // The evidence relied upon is recorded per criterion (it drives the DOM-P2-05 reassessment).
    const c01 = row.evaluation.atDecision.criteria.find((c: { key: string }) => c.key === 'G0-C01');
    expect(c01.activeEvidenceLinkIds.length).toBeGreaterThan(0);
  });
});

describe('DOM-P2-05 — superseded or defective evidence triggers a controlled reassessment [REQ-LCY-015, REQ-DAT-014, AT-14]', () => {
  it('superseding evidence relied upon by the approved G0 flags the gate (REQ-DAT-014), escalates once, notifies and emits gate.blocked', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const before = (await owner().query(`select status, decided_by, decision_id, version from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    const c = crit(g0, 'G0-C02');
    const relied = (await evidenceLinks(p.pm, projectId, c.id)).find((l) => l.status === 'active')!;
    await addEvidence(p.pm, projectId, c.id, 'Replacement charter evidence (synthetic)');
    await p.pm.post(`${P(projectId)}/evidence/${relied.id}/supersede`, { expectedVersion: relied.version, note: 'Replaced by a newer charter version (synthetic)' }).expect(201);
    await runWorker();

    const after = await gateByKey(p.pm, projectId, 'G0');
    expect(after.assessment.status).toBe('approved'); // the decided cycle is never modified
    expect(after.assessment.reassessment.needsReassessment).toBe(true);
    const flag = (after.assessment.reassessment.criteria as { key: string; reason: string; evidenceLinkIds: string[] }[]).find((x) => x.key === 'G0-C02');
    expect(flag).toMatchObject({ reason: 'evidence_superseded', evidenceLinkIds: [relied.id] });
    expect(after.rag).toBe('red');
    const now = (await owner().query(`select status, decided_by, decision_id, version from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    expect(now).toEqual(before);
    const esc = await owner().query(`select requested_action from escalation where project_id = $1 and source_type = 'gate_assessment' and source_id = $2`, [projectId, g0.assessment.id]);
    expect(esc.rows).toHaveLength(1);
    expect(esc.rows[0].requested_action).toMatch(/G0-C02 was superseded/);
    const notes = await owner().query(`select body from notification where project_id = $1 and kind = 'gate.reassessment_requested'`, [projectId]);
    expect(notes.rows.some((n) => /was superseded/.test(n.body))).toBe(true);
    const ev = await owner().query(`select payload from outbox_event where project_id = $1 and type = 'gate.blocked' and aggregate_id = $2`, [projectId, g0.assessment.id]);
    expect(ev.rows.some((r) => r.payload.reason === 'evidence_change_on_decided_gate' && r.payload.reasons.some((x: { criterion: string; reason: string }) => x.criterion === 'G0-C02' && x.reason === 'evidence_superseded'))).toBe(true);
    const audit = await owner().query(`select actor_kind, after from audit_event where project_id = $1 and action = 'gates.assessment.flag_reassessment' and entity_id = $2`, [projectId, g0.assessment.id]);
    expect(audit.rows.some((a) => a.actor_kind === 'service' && a.after.criteria.some((x: { key: string; reason: string }) => x.key === 'G0-C02' && x.reason === 'evidence_superseded'))).toBe(true);

    // Idempotent: another evidence change does not raise a second escalation for the same cycle.
    await addEvidence(p.pm, projectId, crit(after, 'G0-C04').id, 'Additional appointment record (synthetic)');
    await runWorker();
    expect((await owner().query(`select count(*)::int n from escalation where project_id = $1 and source_type = 'gate_assessment' and source_id = $2`, [projectId, g0.assessment.id])).rows[0].n).toBe(1);
  });

  it('on an undecided cycle a criterion accepted as met returns to unmet when its accepted evidence is rejected as defective', async () => {
    await startGate(p, projectId, 'G1');
    await meetCriterion(p, projectId, 'G1', 'G1-C05'); // reviewer: PM; evidence linked by the contributor
    let g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(crit(g1, 'G1-C05').assessment.status).toBe('met');
    const link = (await evidenceLinks(p.pm, projectId, crit(g1, 'G1-C05').id)).find((l) => l.status === 'active')!;
    await p.finance.post(`${P(projectId)}/evidence/${link.id}/verify`, { expectedVersion: link.version, decision: 'reject', note: 'Defective: unsigned draft (synthetic)' }).expect(201);
    await runWorker();
    g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(crit(g1, 'G1-C05').assessment.status).toBe('unmet');
    expect(g1.blockers.some((b) => b.ref === 'G1-C05')).toBe(true);
    const audit = await owner().query(`select actor_kind, after from audit_event where project_id = $1 and action = 'gates.criterion.evidence_defective'`, [projectId]);
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]).toMatchObject({ actor_kind: 'service', after: { status: 'unmet', criterionKey: 'G1-C05', rejectedEvidenceLinkIds: [link.id] } });
  });
});

describe('DOM-P2-15 — waivability by the designated specialist while the cycle is assessed; applicability from the recorded determination [REQ-LCY-005]', () => {
  it('another specialist cannot set waivability (403); a decided gate cannot be changed (422); the designated specialist can', async () => {
    const g5 = await gateByKey(p.pm, projectId, 'G5');
    const c = crit(g5, 'G5-C01'); // reviewer finance_restricted
    const url = `${P(projectId)}/gates/${g5.id}/criteria/${c.id}/waivability`;
    const body = { expectedVersion: c.version, waivable: true, waiverAuthorityRole: 'committee_chair', waivabilityBasis: 'Corporate Development specialist view (synthetic)' };
    const other = await p.legal.post(url, body); // legal + functional approver, not the designated finance specialist
    expect(other.status, JSON.stringify(other.body)).toBe(403);
    expect(other.body.code).toBe('gates.waivability.not_designated_specialist');
    const ok = await p.finance.post(url, body);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const snap = await owner().query(`select snapshot from record_version where entity_type = 'gate_criterion' and entity_id = $1 order by version_no desc limit 1`, [c.id]);
    expect(snap.rows[0].snapshot).toMatchObject({ waivable: true, determinedRole: 'finance_restricted', determinedBy: p.finance.userId });

    const g0 = await gateByKey(p.pm, projectId, 'G0'); // approved (decided): criteria are frozen
    const c06 = crit(g0, 'G0-C06'); // reviewer functional_approver
    const decided = await p.approver.post(`${P(projectId)}/gates/${g0.id}/criteria/${c06.id}/waivability`, { expectedVersion: c06.version, waivable: false, waivabilityBasis: 'x (synthetic)' });
    expect(decided.status, JSON.stringify(decided.body)).toBe(422);
    expect(decided.body.code).toBe('gates.assessment.not_editable');
  });

  it('an approved not-applicable determination sets applicability = not_applicable; a rejected one sets applicable (versioned, audited)', async () => {
    await startGate(p, projectId, 'G5');
    let g5 = await gateByKey(p.pm, projectId, 'G5');
    for (const [key, approve, by] of [['G5-C06', true, p.approver], ['G5-C08', false, p.finance]] as const) {
      const c = crit(g5, key); // owner legal_restricted, reviewer functional_approver
      expect((c as unknown as { applicability: string }).applicability).toBe('proposed');
      await p.legal.post(`${P(projectId)}/gates/${g5.id}/criteria/${c.id}/propose-not-applicable`, { expectedVersion: c.assessment.version, basis: `No such requirement for this transaction (${key}, synthetic)` }).expect(201);
      g5 = await gateByKey(p.pm, projectId, 'G5');
      const r = await by.post(`${P(projectId)}/gates/${g5.id}/criteria/${c.id}/determine-not-applicable`, { expectedVersion: crit(g5, key).assessment.version, approve, note: 'Specialist determination (synthetic)' });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      g5 = await gateByKey(p.pm, projectId, 'G5');
      expect((crit(g5, key) as unknown as { applicability: string }).applicability).toBe(approve ? 'not_applicable' : 'applicable');
      const audit = await owner().query(`select actor_user_id, after from audit_event where project_id = $1 and action = 'gates.criterion.set_applicability' and entity_id = $2`, [projectId, c.id]);
      expect(audit.rows).toHaveLength(1);
      expect(audit.rows[0]).toMatchObject({ actor_user_id: by.userId, after: { applicability: approve ? 'not_applicable' : 'applicable', determinedRole: 'functional_approver' } });
    }
  });
});

describe('DOM-P2-09 — gate reviews and gate decisions appear in My Work with the same checks as the commands [REQ-UX-018]', () => {
  it('a criterion with submitted evidence is offered to its designated reviewer only — never to the evidence submitter', async () => {
    let g1 = await gateByKey(p.pm, projectId, 'G1');
    const c = crit(g1, 'G1-C08'); // owner finance_restricted, reviewer project_manager
    await addEvidence(p.finance, projectId, c.id, 'Finance evidence for G1-C08 (synthetic)');
    g1 = await gateByKey(p.pm, projectId, 'G1');
    await p.finance.post(`${P(projectId)}/gates/${g1.id}/criteria/${c.id}/submit-evidence`, { expectedVersion: crit(g1, 'G1-C08').assessment.version, note: 'Submitted (synthetic)' }).expect(201);
    expect((await myWork(p.pm)).some((i) => i.type === 'gate_criterion_review' && i.entityId === c.id && i.code === 'G1-C08')).toBe(true);
    expect((await myWork(p.finance)).some((i) => i.type === 'gate_criterion_review' && i.entityId === c.id)).toBe(false);
    expect((await myWork(p.chair)).some((i) => i.type === 'gate_criterion_review' && i.entityId === c.id)).toBe(false);
  });

  it('a gate ready for decision is offered to its approver role, not to the submitter or another approver role', async () => {
    await makeReady(p, projectId, 'G1');
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    expect(g1.assessment.status).toBe('ready_for_decision');
    expect((await myWork(p.chair)).some((i) => i.type === 'gate_decision' && i.entityId === g1.assessment.id && i.code === 'G1')).toBe(true);
    expect((await myWork(p.pm)).some((i) => i.type === 'gate_decision')).toBe(false); // submitter (and no approver role)
    expect((await myWork(p.sponsor)).some((i) => i.type === 'gate_decision' && i.entityId === g1.assessment.id)).toBe(false); // G1 approver is the chair
  });
});
