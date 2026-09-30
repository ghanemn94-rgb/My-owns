import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { tallyVotes, type AuthorityPolicy } from '@hub/domain';
import { closeApp, closePools, loginAs, owner, Client } from '../helpers';
import { setupProject, setupGovernance, gateDecision, gateByKey, crit, makeReady, approveGate, evidenceLinks, runWorker, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, DEMO_AUTHORITY_POLICY, P, decisionRow, decisionVersion, tabledDecision, vote } from '../governance/gov-fixtures';
import { addDays, addEvidence, createProject, grant, riyadhToday, task, workstreams } from '../planning/fixtures';

/**
 * P2 DOMAIN REVIEW — defect probes (docs/reviews/P2-domain-review.md).
 *
 * Each `DEFECT DOM-P2-nn` test asserts the behaviour REQUIRED by the specification or by the platform's own governance
 * documents. At the reviewed revision these tests FAIL: the failure is the reproduction of the finding. They must not be
 * weakened to pass; they pass once the defect is fixed. All data is synthetic (projects created by the test).
 */

const DEMO: AuthorityPolicy = DEMO_AUTHORITY_POLICY;

// ---------------------------------------------------------------------------------------------------------------
// Project A: demo project (flagged demo by the gate kit) with an active committee, the approved DEMO matrix and an open
// meeting where every voting member is present. One gate-kit project only: the public demo-login rate limit
// (60/min per process) does not allow several gate-kit projects in one test file.
let pA: string;
let a: Personas;
let govA: Gov;
// Project D: ordinary (non-demo) project created through the API — no committee, no authority matrix.
let pD: string;
let admin: Client;
let pm: Client;
let wsD: Map<string, { id: string; version: number }>;

beforeAll(async () => {
  ({ projectId: pA, p: a } = await setupProject('DRP2-A'));
  govA = await setupGovernance(pA, a);
  await makeReady(a, pA, 'G0');

  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm'); // separate session for project D (own mutation-rate bucket)
  pD = await createProject(admin, pm, 'DRP2-D');
  await grant(admin, pD, a.sponsor, 'sponsor');
  await grant(admin, pD, a.approver, 'functional_approver');
  await grant(admin, pD, a.finance, 'finance_restricted');
  await grant(admin, pD, a.secretary, 'secretary_cpmo');
  wsD = await workstreams(pm, pD);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

const decideGate = async (who: Client, pid: string, key: string, decisionId: string) => {
  const g = await gateByKey(who, pid, key);
  return who.post(`/api/v1/projects/${pid}/gates/${g.id}/assessment/decide`, { expectedVersion: g.assessment.version, outcome: 'approve', decisionId, note: 'P2 domain review probe (synthetic)' });
};

/** G0 approved through the legitimate path (reserved matter → recommendation → external approval), unless already approved. */
const ensureG0Approved = async () => {
  const g0 = await gateByKey(a.pm, pA, 'G0');
  if (g0.assessment.status !== 'approved') await approveGate(a, govA, pA, 'G0');
  expect((await gateByKey(a.pm, pA, 'G0')).assessment.status).toBe('approved');
};

describe('P2 domain review — defect probes [docs/reviews/P2-domain-review.md]', () => {
  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-01a: G0 (committee cannot approve its own mandate) must not pass on a committee decision of the operational gate type (G1–G4/G7)', async () => {
    const d = await gateDecision(pA, a, govA, 'G0', { decisionTypeKey: 'gate_decision_operational' });
    // The committee approved it "within mandate" because the drafter chose the operational gate decision type.
    expect(d.status).toBe('approved');
    const r = await decideGate(a.sponsor, pA, 'G0', d.id);
    // Required (spec §4.2 + AT-04; business-gates.md G0 purpose; authority-matrix.md §4.2): the decision backing a gate
    // must be of the decision type the authority matrix assigns to THAT gate, otherwise the gate stays blocked.
    expect(r.status, `gate approved on a mismatched decision type: ${JSON.stringify(r.body)}`).toBe(422);
  });

  it('DOM-P2-01b: a gate must not pass on an unrelated approved decision that carries no gate key (e.g. a baseline approval)', async () => {
    await ensureG0Approved();
    await makeReady(a, pA, 'G1');
    const x = await tabledDecision(pA, a as unknown as Actors, a.pm, govA.committeeId, govA.meetingId, {
      decisionTypeKey: 'baseline_approval',
      amount: null,
      requiredAuthority: 'Steering committee (DEMO matrix)',
    });
    const v = await decisionVersion(a.chair, pA, x.id);
    for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pA, a[k], x.id, 'approve', v)).status).toBe(201);
    const out = await a.secretary.post(`${P(pA)}/decisions/${x.id}/record-outcome`, { expectedVersion: v });
    expect(out.status, JSON.stringify(out.body)).toBe(201);
    expect(out.body.status).toBe('approved');
    const r = await decideGate(a.chair, pA, 'G1', x.id);
    expect(r.status, `G1 approved on an unrelated baseline-approval decision: ${JSON.stringify(r.body)}`).toBe(422);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-02 (domain): abstentions must count as "not approving" (authority-matrix.md §3 steps 5–6)', () => {
    const oneApproveFourAbstain = tallyVotes({
      votes: [
        { userId: 'u1', choice: 'approve' },
        { userId: 'u2', choice: 'abstain' },
        { userId: 'u3', choice: 'abstain' },
        { userId: 'u4', choice: 'abstain' },
        { userId: 'u5', choice: 'abstain' },
      ],
      chairUserId: null,
      quorumMet: true,
      policy: DEMO,
    });
    // simple_majority → approve votes > half of eligible votes (1 > 2.5 is false).
    expect(oneApproveFourAbstain.outcome).not.toBe('approve');
    const twoThirds = tallyVotes({
      votes: [
        { userId: 'u1', choice: 'approve' },
        { userId: 'u2', choice: 'approve' },
        { userId: 'u3', choice: 'reject' },
        { userId: 'u4', choice: 'abstain' },
        { userId: 'u5', choice: 'abstain' },
      ],
      chairUserId: null,
      quorumMet: true,
      policy: { ...DEMO, approvalThreshold: { type: 'two_thirds' } },
    });
    // two_thirds → approve ×3 ≥ eligible votes ×2 (6 ≥ 10 is false).
    expect(twoThirds.outcome).not.toBe('approve');
  });

  it('DOM-P2-02 (API): one approve and four abstentions must not approve a decision', async () => {
    const x = await tabledDecision(pA, a as unknown as Actors, a.pm, govA.committeeId, govA.meetingId);
    const v = await decisionVersion(a.chair, pA, x.id);
    expect((await vote(pA, a.chair, x.id, 'approve', v)).status).toBe(201);
    for (const k of ['sponsor', 'finance', 'legal', 'approver'] as const) expect((await vote(pA, a[k], x.id, 'abstain', v)).status).toBe(201);
    const out = await a.secretary.post(`${P(pA)}/decisions/${x.id}/record-outcome`, { expectedVersion: v });
    const row = await decisionRow(x.id);
    expect(row['status'], `outcome ${JSON.stringify(out.body)}`).not.toBe('approved');
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-03a: a baseline cannot be approved in a (non-demo) project where no authority matrix has been approved', async () => {
    const ws1 = wsD.get('WS01')!.id;
    await task(pm, pD, ws1, 'DOM-P2-03 probe dated task (synthetic)', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
    const proposed = await pm.post(`/api/v1/projects/${pD}/baselines`, { note: 'DOM-P2-03 probe' });
    expect(proposed.status, JSON.stringify(proposed.body)).toBe(201);
    const mx = await owner().query(`select count(*)::int n from authority_matrix_version where project_id = $1 and status = 'approved'`, [pD]);
    expect(mx.rows[0].n).toBe(0); // precondition: no delegation matrix exists in this project
    const r = await a.sponsor.post(`/api/v1/projects/${pD}/baselines/${proposed.body.id}/approve`, { expectedVersion: 1, note: 'probe' });
    // Required: spec §4.1 "Do not activate production approval authority before the delegation matrix is approved";
    // authority-matrix.md §1.3; G0-C05 (baseline v1 evidenced by a committee decision).
    expect(r.status, `baseline approved without any approved authority matrix: ${JSON.stringify(r.body)}`).toBe(422);
  });

  it('DOM-P2-03b: a change request whose cost impact exceeds the DEMO committee limit cannot be approved by one person without a governance decision', async () => {
    const cr = await a.pm.post(`/api/v1/projects/${pA}/change-requests`, {
      title: 'DOM-P2-03 probe — add a shared cooling asset (synthetic)',
      rationale: 'Probe of authority limits (synthetic)',
      alternatives: ['Keep the asset out of the perimeter'],
      impacts: { cost: '1,500,000 DEMO-SAR one-off — above the DEMO committee limit of 1,000,000 DEMO-SAR (synthetic)' },
    });
    expect(cr.status, JSON.stringify(cr.body)).toBe(201);
    await a.pm.post(`/api/v1/projects/${pA}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
    await a.pm.post(`/api/v1/projects/${pA}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
    const r = await a.sponsor.post(`/api/v1/projects/${pA}/change-requests/${cr.body.id}/approve`, { expectedVersion: 3, note: 'probe' });
    // Required: authority-matrix.md §4.4 ("Change request for 1,500,000 DEMO-SAR → recommended, escalated", AT-04).
    expect(r.status, `change request approved outside the authority matrix: ${JSON.stringify(r.body)}`).toBe(422);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-04: a historical-unverified claim must never end up "confirmed" (not even via an intermediate status)', async () => {
    const t = await task(pm, pD, wsD.get('WS02')!.id, 'DOM-P2-04 probe task (synthetic)', { durationDays: 3 });
    const src = await pm.post(`/api/v1/projects/${pD}/sources`, { sourceType: 'excel', filename: 'probe-tracker.xlsx', extractionStatus: 'partial', classification: 'internal' });
    expect(src.status, JSON.stringify(src.body)).toBe(201);
    const claim = await pm.post(`/api/v1/projects/${pD}/sources/${src.body.id}/claims`, {
      location: 'Sheet "Tracker" row 3 (synthetic)',
      subject: 'Historical status of the probe task',
      targetType: 'task',
      targetId: t,
      field: 'status',
      extractedValue: 'done',
      sourceReportedValue: 'Completed',
      verificationStatus: 'historical_unverified',
    });
    expect(claim.status, JSON.stringify(claim.body)).toBe(201);
    const step1 = await a.finance.post(`/api/v1/projects/${pD}/claims/${claim.body.id}/review`, { expectedVersion: 1, verificationStatus: 'proposed', note: 'probe' });
    const step2 = await a.finance.post(`/api/v1/projects/${pD}/claims/${claim.body.id}/review`, { expectedVersion: step1.body.version ?? 2, verificationStatus: 'confirmed', confirmedValue: 'done', note: 'probe' });
    const row = await owner().query(`select verification_status from source_claim where id = $1`, [claim.body.id]);
    // Required: AT-01 / documents.ts assertClaimReview — a historical report never becomes the confirmed current value.
    expect(row.rows[0].verification_status, `step1=${step1.status} step2=${step2.status}`).not.toBe('confirmed');
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-05: evidence relied upon by an APPROVED gate that is rejected as defective must flag the gate for controlled reassessment', async () => {
    await ensureG0Approved();
    const g0 = await gateByKey(a.pm, pA, 'G0');
    const cr = crit(g0, 'G0-C01');
    const link = (await evidenceLinks(a.pm, pA, cr.id)).find((l) => l.status === 'active')!;
    // A verifier who neither linked nor uploaded it finds the evidence defective.
    const rej = await a.finance.post(`/api/v1/projects/${pA}/evidence/${link.id}/verify`, { expectedVersion: link.version, decision: 'reject', note: 'Defective: wrong charter version (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await runWorker();
    const after = await gateByKey(a.pm, pA, 'G0');
    expect(crit(after, 'G0-C01').evidence.active).toBe(0);
    // Required: spec §3 ("If approved evidence is found defective, reopen the assessment through a controlled process"),
    // spec §14 (evidence changes trigger reassessment of derived records), REQ-DAT-014.
    expect(after.assessment.reassessment.needsReassessment, `rag=${after.rag}`).toBe(true);
    expect(after.rag).not.toBe('green');
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-06: the secretariat must not be able to turn a rejected vote into an approval by recusing voters after they voted', async () => {
    const x = await tabledDecision(pA, a as unknown as Actors, a.pm, govA.committeeId, govA.meetingId);
    const v = await decisionVersion(a.chair, pA, x.id);
    for (const k of ['chair', 'sponsor'] as const) expect((await vote(pA, a[k], x.id, 'approve', v)).status).toBe(201);
    for (const k of ['finance', 'legal', 'approver'] as const) expect((await vote(pA, a[k], x.id, 'reject', v)).status).toBe(201);
    // As cast: 2 approve / 3 reject → rejected. The secretary (non-voting) now records recusals on behalf of two rejecters.
    const r1 = await a.secretary.post(`${P(pA)}/decisions/${x.id}/recusals`, { userId: a.finance.userId, reason: 'Recorded on behalf (probe, synthetic)' });
    const r2 = await a.secretary.post(`${P(pA)}/decisions/${x.id}/recusals`, { userId: a.legal.userId, reason: 'Recorded on behalf (probe, synthetic)' });
    const out = await a.secretary.post(`${P(pA)}/decisions/${x.id}/record-outcome`, { expectedVersion: await decisionVersion(a.chair, pA, x.id) });
    const row = await decisionRow(x.id);
    expect(row['status'], `recusals ${r1.status}/${r2.status}; outcome ${JSON.stringify(out.body)}`).not.toBe('approved');
  });

  // -------------------------------------------------------------------------------------------------------------
  it("DOM-P2-07: a task whose approver role is 'sponsor' must not be accepted by a functional approver", async () => {
    const t = await task(pm, pD, wsD.get('WS01')!.id, 'DOM-P2-07 probe — sponsor-approved deliverable (synthetic)', { approverRole: 'sponsor', requiresAcceptance: true, durationDays: 2 });
    await pm.post(`/api/v1/projects/${pD}/tasks/${t}/start`, { expectedVersion: 1 }).expect(201);
    await pm.post(`/api/v1/projects/${pD}/tasks/${t}/submit-for-acceptance`, { expectedVersion: 2 }).expect(201);
    await addEvidence(pD, 'task', t, pm.userId);
    const r = await a.approver.post(`/api/v1/projects/${pD}/tasks/${t}/accept`, { expectedVersion: 3, note: 'probe' });
    // Required: spec §6 (each activity has an approver role), §9 ("Completion requires acceptance when the task type demands it").
    expect(r.status, `accepted by a role other than the task's approver role: ${JSON.stringify(r.body)}`).toBe(403);
  });

  // -------------------------------------------------------------------------------------------------------------
  it("DOM-P2-09: a pending waiver approval appears in the waiver authority's My Work", async () => {
    const g3 = await gateByKey(a.pm, pA, 'G3');
    const cr = crit(g3, 'G3-C08'); // waivable in the template (committee_chair)
    const w = await a.legal.post(`/api/v1/projects/${pA}/gates/${g3.id}/criteria/${cr.id}/waivers`, { basis: 'Probe basis (synthetic)', impact: 'Probe impact (synthetic)' });
    expect(w.status, JSON.stringify(w.body)).toBe(201);
    const inbox = (await a.chair.get('/api/v1/me/work').expect(200)).body as { items: { entityId: string; type: string }[] };
    // Required: spec §10 screen 15 (My Work: reviews and approvals), REQ-UX-018.
    expect(inbox.items.some((i) => i.entityId === w.body.id || i.entityId === cr.id), `types: ${[...new Set(inbox.items.map((i) => i.type))].join(',')}`).toBe(true);
  });

  // -------------------------------------------------------------------------------------------------------------
  it('DOM-P2-10: a project-level manual override must not display Green while an open blocker exists', async () => {
    const today = riyadhToday();
    const t = await task(pm, pD, wsD.get('WS03')!.id, 'DOM-P2-10 probe blocked task (synthetic)', { durationDays: 2 });
    await pm.post(`/api/v1/projects/${pD}/tasks/${t}/start`, { expectedVersion: 1 }).expect(201);
    await pm.post(`/api/v1/projects/${pD}/tasks/${t}/block`, { expectedVersion: 2, reason: 'Waiting for access (probe)' }).expect(201);
    const ov = await pm.post(`/api/v1/projects/${pD}/rag-overrides`, { entityType: 'project', entityId: pD, overrideStatus: 'green', reason: 'Probe override (synthetic)', expiresOn: addDays(today, 10) });
    expect(ov.status, JSON.stringify(ov.body)).toBe(201);
    await a.secretary.post(`/api/v1/projects/${pD}/rag-overrides/${ov.body.id}/approve`, { expectedVersion: 1, note: 'probe' }).expect(201);
    const h = (await pm.get(`/api/v1/projects/${pD}/progress`).expect(200)).body as { project: { rag: { effective: string }; redCritical: unknown[] } };
    expect(h.project.redCritical.length).toBeGreaterThan(0);
    // Required: spec §9 measurement rule 3 ("A green average must not conceal a red CP or blocker"); measurement.ts calculateRag.
    expect(h.project.rag.effective).not.toBe('green');
  });
});
