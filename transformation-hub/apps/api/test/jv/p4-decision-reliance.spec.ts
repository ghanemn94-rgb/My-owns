import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { P, auditRows, doc, finalDecision, ok, partnerAt, passG5, plusDays, setupJvProject, JvProject } from './jv-kit';

/**
 * P4 domain review, part 2 (docs/reviews/P4-domain-review.md) — JV side, through the API on a synthetic demo-flagged project:
 *  - DOM-P4-01 [REQ-JV-017, REQ-JV-018, REQ-LCY-009; AT-12]: one `jv_closing_confirmation` decision confirms ONE closing
 *    (decision-use registry, kind `closing`): refused at the request and inside the confirmation (audited), a concurrent
 *    confirmation on the same decision is 409, the registry's unique index is the backstop. A signing relies on the decision
 *    that approved the current G5 cycle without a registry row of its own (the G5 cycle use covers it).
 *  - DOM-P4-08 [REQ-JV-017, REQ-JV-018]: an external approval whose evidence was rejected no longer backs a closing
 *    confirmation (request and confirm), a signing, a CP long-stop extension or a negotiation issue; a confirmed closing on
 *    such a decision is shown with `evidence_invalid` (never modified).
 * All data is synthetic.
 */
let j: JvProject;
let pid: string;
let orgId: string;
let signingId: string;
let g5Decision: string;

const event = async (kind: 'signings' | 'closings', id: string) => (await j.p.pm.get(`${P(pid)}/${kind}/${id}`).expect(200)).body as Record<string, any>;
const uses = async (decisionId: string) =>
  (await owner().query<{ use_kind: string; subject_type: string; subject_id: string }>(`select use_kind, subject_type, subject_id from decision_use where decision_id = $1 order by used_at, id`, [decisionId])).rows;

/** A closing of the confirmed signing, moved to ready_for_confirmation (no CP / checklist item). */
async function readyClosing(name: string) {
  const c = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name }));
  let v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c.id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
  v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c.id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
  return { id: c.id as string, version: v as number };
}

/** The PM requests the confirmation (201) — returns the event version to confirm with. */
async function requested(c: { id: string; version: number }, decisionId: string) {
  return (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${c.id}/request-confirmation`, { expectedVersion: c.version, decisionId }))).version as number;
}

/** Legal rejects, as defective, the verified evidence of the decision's external approval (documents module). */
async function rejectDecisionEvidence(decisionId: string) {
  const links = (await j.p.pm.get(`${P(pid)}/evidence?targetType=decision&targetId=${decisionId}`).expect(200)).body.items as { id: string; status: string; version: number; reviewedBy: string | null }[];
  const active = links.filter((l) => l.status === 'active' && l.reviewedBy);
  expect(active).toHaveLength(1);
  const rej = await j.p.legal.post(`${P(pid)}/evidence/${active[0]!.id}/verify`, { expectedVersion: active[0]!.version, decision: 'reject', note: 'Board resolution found defective (synthetic)' });
  expect(rej.status, JSON.stringify(rej.body)).toBe(201);
  expect(rej.body.status).toBe('rejected');
  expect((await j.p.pm.get(`${P(pid)}/decisions/${decisionId}`).expect(200)).body.status).toBe('approved'); // the decision itself is unchanged
}

/**
 * Deterministic interleaving of concurrent commands (no timing assumption): a test-only owner transaction holds the
 * organization's audit-chain advisory lock. Each command performs its unlocked checks, and the first one to lock the
 * decision row writes its record and its registered use and then waits on its first audit insert — still holding the
 * decision row lock, on which the other command waits. Once both wait, the lock is released.
 */
async function race(calls: (() => PromiseLike<{ status: number; body: Record<string, any> }>)[]) {
  const locker = await owner().connect();
  try {
    await locker.query('begin');
    await locker.query(`select pg_advisory_xact_lock(hashtextextended('hub_audit:' || $1::text, 0))`, [orgId]);
    const pending = calls.map((c) => Promise.resolve(c()).then((r) => r));
    let waiting = 0;
    for (let i = 0; i < 150 && waiting < calls.length; i++) {
      await new Promise((r) => setTimeout(r, 100));
      waiting = (await owner().query<{ n: number }>(`select count(*)::int n from pg_locks where not granted`)).rows[0]!.n;
    }
    await locker.query('commit');
    return { results: await Promise.all(pending), waiting };
  } finally {
    locker.release();
  }
}

beforeAll(async () => {
  j = await setupJvProject('JV-P4REL');
  pid = j.projectId;
  orgId = j.orgId;
  const partnerId = await partnerAt(j, 'P4 reliance partner (fictional)');
  g5Decision = await passG5(j);
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P4 reliance signing (synthetic)', partnerId }));
  let v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s.id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
  v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s.id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
  const executed = await doc(j.p.pm, pid, 'P4 reliance executed agreement (synthetic)', { kind: 'agreement' });
  const req = await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s.id}/request-confirmation`, { expectedVersion: v, decisionId: g5Decision, executedDocumentId: executed.id }));
  await ok(await j.p.sponsor.post(`${P(pid)}/signings/${s.id}/record`, { expectedVersion: req.version }));
  signingId = s.id;
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('DOM-P4-01 — one closing-confirmation decision confirms one closing [REQ-JV-017, REQ-JV-018, REQ-LCY-009, AT-12]', () => {
  it('a signing relies on the decision that approved G5 without a registry row of its own (the G5 cycle use covers it)', async () => {
    expect((await event('signings', signingId)).status).toBe('confirmed');
    expect(await uses(g5Decision)).toEqual([expect.objectContaining({ use_kind: 'gate_cycle', subject_type: 'gate_assessment' })]);
  });

  it('refused inside the confirmation (audited) and at a new request; the registry records the one closing; a fresh decision confirms the other', async () => {
    const d = await finalDecision(j, 'jv_closing_confirmation');
    const a = await readyClosing('Reliance closing A (synthetic)');
    const b = await readyClosing('Reliance closing B (synthetic)');
    // Both requests name D while it backs nothing yet.
    const va = await requested(a, d);
    const vb = await requested(b, d);
    expect((await event('closings', b.id)).decision).toMatchObject({ id: d, issueCode: null });
    await ok(await j.p.sponsor.post(`${P(pid)}/closings/${a.id}/confirm`, { expectedVersion: va, note: 'Closing A (synthetic)' }));
    expect((await event('closings', a.id)).status).toBe('confirmed');
    expect(await uses(d)).toEqual([{ use_kind: 'closing', subject_type: 'closing', subject_id: a.id }]);
    // The confirmed closing's own use is not a reuse; the pending request on closing B now shows the decision as used.
    expect((await event('closings', a.id)).decision).toMatchObject({ id: d, issueCode: null });
    expect((await event('closings', b.id)).decision).toMatchObject({ id: d, issueCode: 'already_used' });
    const reuse = await j.p.sponsor.post(`${P(pid)}/closings/${b.id}/confirm`, { expectedVersion: vb, note: 'Reuse attempt (synthetic)' });
    expect(reuse.status, JSON.stringify(reuse.body)).toBe(422);
    expect(reuse.body.code).toBe('jv.closing.decision_already_used');
    expect(reuse.body.details).toMatchObject({ decisionId: d, usedBySubjectId: a.id });
    expect((await event('closings', b.id)).status).toBe('ready_for_confirmation');
    const audit = await auditRows(pid, 'jv.closing.declare', b.id);
    expect(audit.map((x) => x.outcome)).toContain('rejected');
    // A new request naming D for another closing is refused at once.
    const c = await readyClosing('Reliance closing C (synthetic)');
    const early = await j.p.pm.post(`${P(pid)}/transaction-events/${c.id}/request-confirmation`, { expectedVersion: c.version, decisionId: d });
    expect(early.status, JSON.stringify(early.body)).toBe(422);
    expect(early.body.code).toBe('jv.closing.decision_already_used');
    // Database backstop: one row per decision and kind.
    await expect(owner().query(`insert into decision_use (org_id, project_id, decision_id, use_kind, subject_type, subject_id) values ($1, $2, $3, 'closing', 'closing', $4)`, [orgId, pid, d, c.id])).rejects.toMatchObject({
      code: '23505',
      constraint: 'decision_use_kind_uq',
    });
    // Each closing is confirmed on its own decision.
    const d2 = await finalDecision(j, 'jv_closing_confirmation');
    const vb2 = await requested({ id: b.id, version: (await event('closings', b.id)).version }, d2);
    await ok(await j.p.sponsor.post(`${P(pid)}/closings/${b.id}/confirm`, { expectedVersion: vb2, note: 'Closing B on its own decision (synthetic)' }));
    expect(await uses(d2)).toEqual([{ use_kind: 'closing', subject_type: 'closing', subject_id: b.id }]);
  });

  it('two confirmations on ONE decision at the same time: exactly one closing is confirmed, the other is 409', async () => {
    const d = await finalDecision(j, 'jv_closing_confirmation');
    const e = await readyClosing('Race closing E (synthetic)');
    const f = await readyClosing('Race closing F (synthetic)');
    const ve = await requested(e, d);
    const vf = await requested(f, d);
    const { results, waiting } = await race([
      () => j.p.sponsor.post(`${P(pid)}/closings/${e.id}/confirm`, { expectedVersion: ve, note: 'Race E (synthetic)' }),
      () => j.p.sponsor.post(`${P(pid)}/closings/${f.id}/confirm`, { expectedVersion: vf, note: 'Race F (synthetic)' }),
    ]);
    expect(waiting).toBeGreaterThanOrEqual(2);
    expect(results.map((r) => r.status).sort(), JSON.stringify(results.map((r) => r.body))).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.code).toBe('jv.closing.decision_already_used');
    const statuses = [(await event('closings', e.id)).status, (await event('closings', f.id)).status].sort();
    expect(statuses).toEqual(['confirmed', 'ready_for_confirmation']);
    expect(await uses(d)).toHaveLength(1);
  });
});

describe('DOM-P4-08 — an external approval whose evidence was rejected backs no JV record [REQ-JV-017, REQ-JV-018]', () => {
  it('closing: refused inside the confirmation (audited) and at the request; the detail shows evidence_invalid', async () => {
    const e = await finalDecision(j, 'jv_closing_confirmation');
    const g = await readyClosing('Evidence closing G (synthetic)');
    const vg = await requested(g, e);
    await rejectDecisionEvidence(e);
    expect((await event('closings', g.id)).decision).toMatchObject({ id: e, issueCode: 'evidence_invalid' });
    const r = await j.p.sponsor.post(`${P(pid)}/closings/${g.id}/confirm`, { expectedVersion: vg, note: 'Confirmation on rejected evidence (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.closing.decision_evidence_invalid');
    expect(r.body.details).toMatchObject({ decisionId: e, evidence: 'not_active', evidenceStatus: 'rejected' });
    expect((await event('closings', g.id)).status).toBe('ready_for_confirmation');
    expect((await auditRows(pid, 'jv.closing.declare', g.id)).map((x) => x.outcome)).toContain('rejected');
    expect(await uses(e)).toEqual([]);
    const h = await readyClosing('Evidence closing H (synthetic)');
    const early = await j.p.pm.post(`${P(pid)}/transaction-events/${h.id}/request-confirmation`, { expectedVersion: h.version, decisionId: e });
    expect(early.status).toBe(422);
    expect(early.body.code).toBe('jv.closing.decision_evidence_invalid');
  });

  it('a closing confirmed before the rejection stays confirmed (never modified) and is shown as resting on an external approval no longer evidenced', async () => {
    const e = await finalDecision(j, 'jv_closing_confirmation');
    const i = await readyClosing('Evidence closing I (synthetic)');
    await ok(await j.p.sponsor.post(`${P(pid)}/closings/${i.id}/confirm`, { expectedVersion: await requested(i, e), note: 'Closing I (synthetic)' }));
    expect((await event('closings', i.id)).decision).toMatchObject({ id: e, issueCode: null });
    await rejectDecisionEvidence(e);
    const after = await event('closings', i.id);
    expect(after.status).toBe('confirmed');
    expect(after.decision).toMatchObject({ id: e, issueCode: 'evidence_invalid' });
    const snap = await owner().query(`select readiness_snapshot from closing where id = $1`, [i.id]);
    expect(snap.rows[0].readiness_snapshot.decision).toMatchObject({ id: e, registeredUse: 'closing' });
    expect(snap.rows[0].readiness_snapshot.decision.externalEvidenceLinkId).toBeTruthy();
  });

  it('CP long-stop extension: refused on a decision whose external approval evidence was rejected; the condition is unchanged', async () => {
    const k = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId, name: 'Long-stop closing K (synthetic)' }));
    const cp = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: k.id, title: 'Regulatory approval (synthetic)', ownerUserId: j.p.pm.userId, blocking: true, longStopDate: plusDays(10) }));
    const x = await finalDecision(j, 'jv_closing_confirmation');
    await rejectDecisionEvidence(x);
    const r = await j.p.pm.post(`${P(pid)}/closing-conditions/${cp.id}/extend-long-stop`, { expectedVersion: 1, longStopDate: plusDays(40), decisionId: x, reason: 'Extension on rejected evidence (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.cp.decision_evidence_invalid');
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${cp.id}`).expect(200)).body;
    expect(cur).toMatchObject({ longStopDate: plusDays(10), longStopExtensionDecisionId: null, version: 1 });
    const y = await finalDecision(j, 'jv_closing_confirmation');
    await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${cp.id}/extend-long-stop`, { expectedVersion: 1, longStopDate: plusDays(40), decisionId: y, reason: 'Approved extension (synthetic)' }));
    // A long-stop extension relies on its decision without consuming it (no registry row).
    expect(await uses(y)).toEqual([]);
  });

  it('negotiation issue: not agreed on a decision whose external approval evidence was rejected; the register shows evidence_invalid', async () => {
    const z = await finalDecision(j, 'jv_closing_confirmation');
    const issue = await ok(await j.p.legal.post(`${P(pid)}/negotiation-issues`, { issue: 'Reserved matters list (synthetic)', requiresApproval: true, decisionId: z, requiredApproval: 'Authorized body (synthetic)' }));
    const v = (await ok(await j.p.legal.post(`${P(pid)}/negotiation-issues/${issue.id}/transition`, { expectedVersion: 1, command: 'propose_resolution' }))).version;
    await rejectDecisionEvidence(z);
    const r = await j.p.legal.post(`${P(pid)}/negotiation-issues/${issue.id}/transition`, { expectedVersion: v, command: 'agree' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.negotiation.decision_evidence_invalid');
    const row = ((await j.p.legal.get(`${P(pid)}/negotiation-issues`).expect(200)).body.items as { id: string; status: string; decision: Record<string, unknown> }[]).find((x) => x.id === issue.id)!;
    expect(row.status).toBe('proposed_resolution');
    expect(row.decision).toMatchObject({ id: z, issueCode: 'evidence_invalid' });
  });

  it('signing: the decision that approved G5 no longer authorizes a signing once its external approval evidence is rejected (then G5 is flagged for reassessment)', async () => {
    const s2 = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: 'P4 reliance signing #2 (synthetic)' }));
    let v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s2.id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
    v = (await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${s2.id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
    const executed = await doc(j.p.pm, pid, 'P4 reliance executed agreement #2 (synthetic)', { kind: 'agreement' });
    await rejectDecisionEvidence(g5Decision);
    // Before the worker flags G5 (DOM-P2R-04), the signing request itself re-checks the evidence.
    const r = await j.p.pm.post(`${P(pid)}/transaction-events/${s2.id}/request-confirmation`, { expectedVersion: v, decisionId: g5Decision, executedDocumentId: executed.id });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.signing.decision_evidence_invalid');
    // The signing recorded earlier is never modified; it is shown as resting on an external approval no longer evidenced.
    expect(await event('signings', signingId)).toMatchObject({ status: 'confirmed', decision: { id: g5Decision, issueCode: 'evidence_invalid' } });
    // The gates job then flags the approved G5 cycle for controlled reassessment: the signing is refused on that ground too.
    await runWorker();
    const again = await j.p.pm.post(`${P(pid)}/transaction-events/${s2.id}/request-confirmation`, { expectedVersion: v, decisionId: g5Decision, executedDocumentId: executed.id });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('jv.signing.g5_under_reassessment');
    expect((await event('signings', s2.id)).status).toBe('ready_for_confirmation');
  });
});
