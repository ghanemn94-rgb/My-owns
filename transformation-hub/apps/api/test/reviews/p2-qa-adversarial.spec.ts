import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner, projectIdByCode, Client, DC } from '../helpers';
import { setupProject, setupGovernance, gateByKey, crit, evidenceLinks, meetAllMandatory, startGate, gateDecision, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, DEMO_AUTHORITY_POLICY, P, decisionVersion, paper, tabledDecision, uniq, verifiedDecisionEvidence, vote } from '../governance/gov-fixtures';
import { task, workstreams } from '../planning/fixtures';
import { createWithVersion, login as docLogin } from '../documents/doc-helpers';

/**
 * P2 QA gate review — adversarial probes through the real API (docs/reviews/P2-qa-review.md §7). Written by the independent
 * qa-test-engineer; no implementation code was changed. Each probe asserts the behaviour the specification or the
 * platform's own documented rule requires. A probe that reproduces a defect is recorded with `it.fails` and the finding id
 * of the QA report, so the suite stays green while the defect is open and turns red once it is fixed (then drop `.fails`).
 *
 * Project: a synthetic demo project created through the portfolio API (gate kit) with the DEMO matrix in force and an open
 * meeting with every voting member present. The Demo Committee Chair also holds `project_manager` here so that G0
 * (owner secretary, reviewer project_manager, approver sponsor) has two eligible gate reviewers. The Demo Project
 * Manager is also a member of DEMO-DC, so every cross-project id below is visible to the caller in its own project:
 * a 404 proves the binding of the id to the path's project, not a lack of access.
 */
let projectId: string;
let p: Personas;
let gov: Gov;
let dcId: string;
const A = () => p as unknown as Actors;
const gUrl = (gateId: string, cmd: string) => `${P(projectId)}/gates/${gateId}/assessment/${cmd}`;
const review = (c: Client, gateId: string, expectedVersion: number, outcome: 'endorse' | 'return', note = 'QA probe gate review (synthetic)') =>
  c.post(gUrl(gateId, 'review'), { expectedVersion, outcome, note });
const count = async (sqlText: string, params: unknown[]) => (await owner().query<{ n: number }>(sqlText, params)).rows[0]!.n;

beforeAll(async () => {
  ({ projectId, p } = await setupProject('QA-P2-ADV', [['chair', 'project_manager']]));
  gov = await setupGovernance(projectId, p);
  dcId = await projectIdByCode(DC);
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('QA-P2 adversarial — gate review under concurrency and stale state (G0) [REQ-LCY-010, AT-16, DOM-P2-16]', () => {
  it('two designated reviewers endorse the same cycle version at once: exactly one wins, the other gets 409; one audit row; a stale version is 409', async () => {
    await startGate(p, projectId, 'G0');
    await meetAllMandatory(p, projectId, 'G0');
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review.state).toBe('not_reviewed');
    const [r1, r2] = await Promise.all([review(p.pm, g0.id, g0.assessment.version, 'endorse'), review(p.chair, g0.id, g0.assessment.version, 'endorse')]);
    expect([r1.status, r2.status].sort(), JSON.stringify([r1.body, r2.body])).toEqual([201, 409]);
    const winner = r1.status === 201 ? p.pm : p.chair;
    expect(await count(`select count(*)::int n from audit_event where action = 'gates.assessment.review_endorse' and entity_id = $1 and outcome = 'success'`, [g0.assessment.id])).toBe(1);
    expect((await owner().query(`select reviewed_by from gate_assessment where id = $1`, [g0.assessment.id])).rows[0].reviewed_by).toBe(winner.userId);
    // The pre-review version is stale for every gate command.
    const staleReview = await review(p.pm, g0.id, g0.assessment.version, 'return');
    expect(staleReview.status).toBe(409);
    const staleSubmit = await p.secretary.post(gUrl(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version });
    expect(staleSubmit.status).toBe(409);
    expect((await gateByKey(p.pm, projectId, 'G0')).assessment.status).toBe('in_assessment');
  });

  it('verifying a relied-upon evidence link after the endorsement makes it stale: submission refused (422 review_stale)', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review.state).toBe('endorsed');
    const c01 = crit(g0, 'G0-C01');
    const link = (await evidenceLinks(p.pm, projectId, c01.id)).find((l) => l.status === 'active')!;
    const v = await p.legal.post(`${P(projectId)}/evidence/${link.id}/verify`, { expectedVersion: link.version, decision: 'accept', note: 'QA probe: verified after the gate endorsement (synthetic)' });
    expect(v.status, JSON.stringify(v.body)).toBe(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.review.state).toBe('stale');
    const r = await p.secretary.post(gUrl(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('gates.assessment.review_stale');
  });

  // QA-P2-03 (docs/reviews/P2-qa-review.md): the endorsement is checked at submission only. Evidence of a criterion can still
  // change while the cycle is ready for decision (the documents module does not look at the gate state) and `decide` does not
  // re-check the review basis, so the approver decides on a state the gate reviewer never reviewed.
  it('after submission, a change to a criterion’s evidence is not decided on without a fresh review (evidence refused or decision refused)', async () => {
    let g0 = await gateByKey(p.pm, projectId, 'G0');
    await review(p.pm, g0.id, g0.assessment.version, 'endorse', 'Re-endorsed after the verification (synthetic)').expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    await p.secretary.post(gUrl(g0.id, 'mark-ready'), { expectedVersion: g0.assessment.version }).expect(201);
    g0 = await gateByKey(p.pm, projectId, 'G0');
    expect(g0.assessment.status).toBe('ready_for_decision');
    const reviewedBasis = (await owner().query(`select review_basis from gate_assessment where id = $1`, [g0.assessment.id])).rows[0].review_basis as string;
    // New evidence on G0-C02 after the submission (a person other than the reviewer and the submitter).
    const late = await p.contributor.post(`${P(projectId)}/evidence`, { targetType: 'gate_criterion', targetId: crit(g0, 'G0-C02').id, note: 'QA probe: evidence added after submission (synthetic)' });
    const evidenceRefused = late.status === 422 || late.status === 409;
    const d = await gateDecision(projectId, p, gov, 'G0', { externalApproval: true });
    expect(d.status).toBe('approved');
    g0 = await gateByKey(p.pm, projectId, 'G0');
    const decided = await p.sponsor.post(gUrl(g0.id, 'decide'), { expectedVersion: g0.assessment.version, outcome: 'approve', decisionId: d.id, note: 'QA probe decision (synthetic)' });
    const snap = (await owner().query(`select status, evaluation from gate_assessment where id = $1`, [g0.assessment.id])).rows[0];
    // Evidence of what happened (printed so the report can quote it).
    console.log(`QA-P2-03 probe: late evidence ${late.status}; review state before decide ${g0.review.state}; decide ${decided.status} ${decided.body.code ?? decided.body.status}; ` +
      `snapshot review basis == reviewed basis: ${snap.evaluation?.atDecision?.review?.basis === reviewedBasis}; linkIds relied upon on G0-C02: ${JSON.stringify(snap.evaluation?.atDecision?.criteria?.find((c: { key: string }) => c.key === 'G0-C02')?.activeEvidenceLinkIds)}`);
    expect(evidenceRefused || decided.status === 422).toBe(true);
  });
});

describe('QA-P2 adversarial — votes and re-used decisions under concurrency [REQ-GOV-016, REQ-GOV-022, REQ-PLN-013, AT-04, AT-16]', () => {
  it('a member double-submits the same vote at once: one vote row; the duplicate is refused with 409/422, never 500', async () => {
    const d = await tabledDecision(projectId, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('QA double vote probe') });
    const v = await decisionVersion(p.chair, projectId, d.id);
    const [a, b] = await Promise.all([vote(projectId, p.chair, d.id, 'approve', v), vote(projectId, p.chair, d.id, 'approve', v)]);
    const statuses = [a.status, b.status].sort();
    expect(statuses[0], JSON.stringify([a.body, b.body])).toBe(201);
    expect([409, 422]).toContain(statuses[1]);
    expect(await count(`select count(*)::int n from vote where decision_id = $1 and user_id = $2`, [d.id, p.chair.userId])).toBe(1);
  });

  // QA-P2-01 (docs/reviews/P2-qa-review.md): "one decision backs one approval" is a read-then-write check without a lock or a
  // unique constraint (change-control.service.ts evaluateAuthority), so approvals of different change requests running at
  // the same time can all rely on the same committee decision. (Also reproduced without the lock below: 4 simultaneous
  // approvals → 2 approved on one decision in 2 of 4 runs.)
  it('two change requests above the delegated limit approved at the same time on ONE final decision: at most one is approved', async () => {
    // The authorized body's decision: 1,500,000 SAR (above the DEMO committee limit) → recommendation → external approval.
    const d = await tabledDecision(projectId, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('QA reuse race decision'), decisionTypeKey: 'change_request_budget', amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const v = await decisionVersion(p.chair, projectId, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(projectId, p[k], d.id, 'approve', v)).status).toBe(201);
    expect((await p.secretary.post(`${P(projectId)}/decisions/${d.id}/record-outcome`, { expectedVersion: v })).body.status).toBe('recommended');
    const evidenceLinkId = await verifiedDecisionEvidence(projectId, p.pm, p.legal, d.id);
    await gov.secretary2.post(`${P(projectId)}/decisions/${d.id}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, projectId, d.id), outcome: 'approved', externalReference: 'QA-DELEGATING-AUTHORITY (synthetic)', evidenceLinkId }).expect(201);
    // Two change requests of 1,200,000 SAR each: each alone is above the delegated limit and covered by the decision.
    const crs: string[] = [];
    for (let i = 0; i < 2; i++) {
      const cr = await p.pm.post(`${P(projectId)}/change-requests`, { title: uniq(`QA reuse race CR ${i}`), rationale: 'QA probe (synthetic)', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' }, costImpact: { amount: '1200000.0000', currency: 'SAR', unitScale: 1 } });
      expect(cr.status, JSON.stringify(cr.body)).toBe(201);
      await p.pm.post(`${P(projectId)}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
      await p.pm.post(`${P(projectId)}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
      crs.push(cr.body.id);
    }
    // Deterministic interleaving (no sleep-based timing): a test-only owner transaction holds a table lock on outbox_event,
    // the last write of an approval. Each approval then performs its authority check and its update, and waits before it can
    // commit — the first on the outbox lock, the second on the audit-chain lock the first holds. Once both wait, the lock is
    // released and both finish. A correct "one decision backs one approval" rule refuses the second approval whatever the
    // interleaving (a lock on the decision row, or a unique constraint).
    const locker = await owner().connect();
    let results: { status: number; body: Record<string, unknown> }[];
    try {
      await locker.query('begin');
      await locker.query('lock table outbox_event in share row exclusive mode');
      const pending = crs.map((id) => p.sponsor.post(`${P(projectId)}/change-requests/${id}/approve`, { expectedVersion: 3, decisionId: d.id, note: 'QA race probe' }).then((r) => r));
      let waiting = 0;
      for (let i = 0; i < 100 && waiting < 2; i++) {
        await new Promise((r) => setTimeout(r, 100));
        waiting = await count(`select count(*)::int n from pg_locks where not granted and (relation = 'outbox_event'::regclass or locktype = 'advisory')`, []);
      }
      await locker.query('commit');
      results = await Promise.all(pending);
      console.log(`QA-P2-01 probe: requests waiting before release ${waiting}`);
    } finally {
      locker.release();
    }
    const approved = await count(`select count(*)::int n from change_request where decision_id = $1 and status = 'approved'`, [d.id]);
    console.log(`QA-P2-01 probe: approve statuses ${JSON.stringify(results.map((r) => r.status))} codes ${JSON.stringify(results.map((r) => r.body.code ?? r.body.status))}; change requests approved on the decision: ${approved}`);
    expect(results.every((r) => r.status < 500)).toBe(true);
    expect(approved).toBeLessThanOrEqual(1);
  });
});

describe('QA-P2 adversarial — ids of another project or another gate (caller is a member of both projects) [AT-03, REQ-DAT-002, REQ-ENT-010, REQ-PLN-006]', () => {
  it('a criterion of another gate, or of another project, under this gate’s URL is 404 and nothing changes', async () => {
    const g0 = await gateByKey(p.pm, projectId, 'G0');
    const g1 = await gateByKey(p.pm, projectId, 'G1');
    const otherGateCrit = crit(g1, 'G1-C01');
    const r1 = await p.pm.post(`${P(projectId)}/gates/${g0.id}/criteria/${otherGateCrit.id}/review`, { expectedVersion: otherGateCrit.assessment.version, outcome: 'met', note: 'probe' });
    expect(r1.status).toBe(404);
    const dcCrit = (await owner().query<{ id: string }>(`select id from gate_criterion where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const r2 = await p.pm.post(`${P(projectId)}/gates/${g0.id}/criteria/${dcCrit}/review`, { expectedVersion: 1, outcome: 'met', note: 'probe' });
    expect(r2.status).toBe(404);
    const r3 = await p.pm.post(`${P(projectId)}/evidence`, { targetType: 'gate_criterion', targetId: dcCrit, note: 'probe: evidence on a criterion of another project' });
    expect(r3.status).toBe(404);
  });

  it('prerequisites: a successor, a decision or an evidence link of another project is 404; nothing is recorded', async () => {
    const ws = (await workstreams(p.pm, projectId)).get('WS02')!.id;
    const own = await task(p.pm, projectId, ws, 'QA probe task (synthetic)', { durationDays: 2 });
    const dcTask = (await owner().query<{ id: string }>(`select id from task where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const dcDecision = (await owner().query<{ id: string }>(`select id from decision where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const dcEvidence = (await owner().query<{ id: string }>(`select id from evidence_link where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const g7 = (await gateByKey(p.pm, projectId, 'G7')).id;
    const PR = `${P(projectId)}/prerequisites`;
    expect((await p.pm.post(PR, { successorType: 'task', successorId: dcTask, predecessorType: 'gate', predecessorId: g7 })).status).toBe(404);
    expect((await p.pm.post(PR, { successorType: 'task', successorId: own, predecessorType: 'decision', predecessorId: dcDecision })).status).toBe(404);
    expect((await p.pm.post(PR, { successorType: 'task', successorId: own, predecessorType: 'evidence_link', predecessorId: dcEvidence })).status).toBe(404);
    expect(await count(`select count(*)::int n from record_dependency where successor_id in ($1, $2)`, [own, dcTask])).toBe(0);
  });

  it('a cross-project dependency whose LOCAL item belongs to the other project is refused (404), nothing is recorded', async () => {
    const dcTasks = (await owner().query<{ id: string }>(`select id from task where project_id = $1 limit 2`, [dcId])).rows;
    const r = await p.pm.post(`${P(projectId)}/cross-project-dependencies`, {
      otherProjectId: dcId,
      otherItemType: 'task',
      otherItemId: dcTasks[0]!.id,
      localItemType: 'task',
      localItemId: dcTasks[1]!.id,
      description: 'QA probe: the local item is not of this project',
    });
    expect([404, 422], JSON.stringify(r.body)).toContain(r.status);
    expect(await count(`select count(*)::int n from cross_project_dependency where project_id = $1`, [projectId])).toBe(0);
  });

  it('governance: an agenda request for a decision of another project, and an external approval on an evidence link of another project, are 404', async () => {
    const dcDecision = (await owner().query<{ id: string }>(`select id from decision where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const ar = await p.pm.post(`${P(projectId)}/agenda-requests`, { committeeId: gov.committeeId, title: 'QA probe: foreign decision', kind: 'decision', decisionId: dcDecision });
    expect(ar.status, JSON.stringify(ar.body)).toBe(404);
    // A recommendation of this project (reserved type → pending external authority).
    const d = await tabledDecision(projectId, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('QA foreign evidence probe'), decisionTypeKey: 'change_request_budget', amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } });
    const v = await decisionVersion(p.chair, projectId, d.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(projectId, p[k], d.id, 'approve', v)).status).toBe(201);
    expect((await p.secretary.post(`${P(projectId)}/decisions/${d.id}/record-outcome`, { expectedVersion: v })).body.status).toBe('recommended');
    const dcVerified = (await owner().query<{ id: string }>(`select id from evidence_link where project_id = $1 and reviewed_by is not null and status = 'active' limit 1`, [dcId])).rows[0];
    const foreignLink = dcVerified?.id ?? (await owner().query<{ id: string }>(`select id from evidence_link where project_id = $1 limit 1`, [dcId])).rows[0]!.id;
    const ext = await gov.secretary2.post(`${P(projectId)}/decisions/${d.id}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, projectId, d.id), outcome: 'approved', externalReference: 'QA-FOREIGN-EVIDENCE (synthetic)', evidenceLinkId: foreignLink });
    expect(ext.status, JSON.stringify(ext.body)).toBe(404);
    expect((await owner().query(`select status from decision where id = $1`, [d.id])).rows[0].status).toBe('recommended');
  });

  it('a non-demo matrix approval citing a document of another project is refused; the version stays a draft without approval', async () => {
    const m = await p.secretary.post(`${P(projectId)}/committees/${gov.committeeId}/authority-matrix-versions`, { policy: { ...DEMO_AUTHORITY_POLICY, isDemoPolicy: false }, effectiveFrom: '2026-01-01' });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const pmDoc = await docLogin('pm');
    const doc = await createWithVersion(pmDoc, dcId, { title: 'QA probe: document of DEMO-DC (synthetic)', classification: 'internal' }, { bytes: Buffer.from('Synthetic QA probe record - not a real approval.'), name: 'qa-probe.txt' });
    expect(doc.upload.status, JSON.stringify(doc.upload.body)).toBe(201);
    const ap = await p.sponsor.post(`${P(projectId)}/committees/${gov.committeeId}/authority-matrix-versions/${m.body.id}/approve`, { approvalReference: 'QA-FOREIGN-DOC (synthetic)', approvalDocumentId: doc.id });
    expect([404, 422], JSON.stringify(ap.body)).toContain(ap.status);
    expect((await owner().query(`select status, approved_by from authority_matrix_version where id = $1`, [m.body.id])).rows[0]).toMatchObject({ status: 'draft', approved_by: null });
  });
});

describe('QA-P2 adversarial — separation of duties on external authority decisions [REQ-SEC-004, REQ-GOV-023, AT-05]', () => {
  it('the requester of a recommendation cannot record its external approval (403); another secretariat member can', async () => {
    // The secretary drafts (requester); the second secretary reviews and records the outcome (a recommendation).
    const created = await p.secretary.post(`${P(projectId)}/decisions`, paper(gov.committeeId, { title: uniq('QA requester SoD probe'), amount: { amount: '1500000.0000', currency: 'SAR', unitScale: 1 } }));
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const id = created.body.id as string;
    const s = await p.secretary.post(`${P(projectId)}/decisions/${id}/submit`, { expectedVersion: created.body.version });
    expect(s.status, JSON.stringify(s.body)).toBe(201);
    const rv = await gov.secretary2.post(`${P(projectId)}/decisions/${id}/start-review`, { expectedVersion: s.body.version, meetingId: gov.meetingId });
    expect(rv.status, JSON.stringify(rv.body)).toBe(201);
    const v = await decisionVersion(p.chair, projectId, id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(projectId, p[k], id, 'approve', v)).status).toBe(201);
    const out = await gov.secretary2.post(`${P(projectId)}/decisions/${id}/record-outcome`, { expectedVersion: v });
    expect(out.body.status, JSON.stringify(out.body)).toBe('recommended');
    const evidenceLinkId = await verifiedDecisionEvidence(projectId, p.pm, p.legal, id);
    const ev = await decisionVersion(p.chair, projectId, id);
    const own = await p.secretary.post(`${P(projectId)}/decisions/${id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'QA-SOD (synthetic)', evidenceLinkId });
    expect(own.status, JSON.stringify(own.body)).toBe(403);
    expect((await owner().query(`select status from decision where id = $1`, [id])).rows[0].status).toBe('recommended');
    const chair = await p.chair.post(`${P(projectId)}/decisions/${id}/record-external-approval`, { expectedVersion: ev, outcome: 'approved', externalReference: 'QA-SOD (synthetic)', evidenceLinkId });
    expect(chair.status, JSON.stringify(chair.body)).toBe(201);
  });
});

describe('QA-P2 adversarial — agenda numbering under concurrency [REQ-GOV-013]', () => {
  // F-03 (docs/phases/P2-P4-requirement-disposition.md §5, still open): the agenda number is max(number) + 1 without a lock or
  // a unique index per meeting.
  it('three agenda requests accepted onto the same meeting at the same instant get distinct numbers', async () => {
    const m = await p.secretary.post(`${P(projectId)}/committees/${gov.committeeId}/meetings`, { title: uniq('QA numbering probe meeting'), scheduledAt: new Date().toISOString() });
    expect(m.status, JSON.stringify(m.body)).toBe(201);
    const reqs = [];
    for (let i = 0; i < 3; i++) {
      const r = await p.pm.post(`${P(projectId)}/agenda-requests`, { committeeId: gov.committeeId, title: uniq(`QA numbering item ${i}`), kind: 'information', meetingId: m.body.id });
      expect(r.status, JSON.stringify(r.body)).toBe(201);
      reqs.push(r.body as { id: string; version: number });
    }
    const res = await Promise.all(reqs.map((r) => p.secretary.post(`${P(projectId)}/agenda-requests/${r.id}/screen`, { expectedVersion: r.version, outcome: 'accept', meetingId: m.body.id })));
    expect(res.map((r) => r.status)).toEqual([201, 201, 201]);
    const numbers = (await owner().query<{ number: number }>(`select number from agenda_item where meeting_id = $1 and screening_status = 'accepted' order by number`, [m.body.id])).rows.map((r) => r.number);
    console.log(`F-03 probe: agenda numbers ${JSON.stringify(numbers)}`);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
