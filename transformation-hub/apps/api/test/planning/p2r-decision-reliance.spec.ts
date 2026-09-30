import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, setupGovernance, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, P, decisionVersion, tabledDecision, uniq, verifiedDecisionEvidence, vote } from '../governance/gov-fixtures';
import { task, workstreams } from './fixtures';

/**
 * P2 domain re-review fixes where planning relies on governance decisions (docs/reviews/P2-domain-rereview.md):
 *  - DOM-P2R-03 — a decision backs only the record it was raised for (change request / baseline version);
 *  - DOM-P2R-04 — an external approval backs change control and prerequisites only while its evidence is active + verified;
 *  - DOM-P2R-02 — a requester-stated cost impact never makes an approval pass (conservative option, Q-43);
 *  - DOM-P2R-07 — removing a blocking prerequisite needs a reason and someone other than the person it blocks;
 *  - QA-P2-01 — one decision backs one approval (row lock + decision-use registry; unique indexes as backstops).
 * One gate-kit project (synthetic, demo-flagged; DEMO change_request_budget limit 1,000,000 DEMO-SAR).
 */
let pid: string;
let p: Personas;
let gov: Gov;
const A = () => p as unknown as Actors;
const SAR = (amount: string) => ({ amount, currency: 'SAR', unitScale: 1 });

beforeAll(async () => {
  ({ projectId: pid, p } = await setupProject('P2R-PLN'));
  gov = await setupGovernance(pid, p);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

/** A change request under review whose cost impact the requester (PM) stated. */
const crUnderReview = async (title: string, cost: string | null) => {
  const cr = await p.pm.post(`${P(pid)}/change-requests`, { title: uniq(title), rationale: 'Synthetic rationale (test)', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' }, ...(cost ? { costImpact: SAR(cost) } : {}) });
  expect(cr.status, JSON.stringify(cr.body)).toBe(201);
  await p.pm.post(`${P(pid)}/change-requests/${cr.body.id}/submit`, { expectedVersion: 1 }).expect(201);
  await p.pm.post(`${P(pid)}/change-requests/${cr.body.id}/start-review`, { expectedVersion: 2 }).expect(201);
  return cr.body.id as string;
};
const crVersion = async (id: string) => (await p.pm.get(`${P(pid)}/change-requests/${id}`).expect(200)).body.version as number;
const approve = async (id: string, decisionId?: string) => p.sponsor.post(`${P(pid)}/change-requests/${id}/approve`, { expectedVersion: await crVersion(id), note: 'Test approval (synthetic)', ...(decisionId ? { decisionId } : {}) });

/**
 * A committee decision above the DEMO limit → recommended → approved by the external body on verified evidence. Returns the
 * decision id and its evidence link id.
 */
const externallyApproved = async (over: Record<string, unknown>) => {
  const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('External approval (test)'), decisionTypeKey: 'change_request_budget', amount: SAR('1500000.0000'), ...over });
  const v = await decisionVersion(p.chair, pid, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.body.status, JSON.stringify(out.body)).toBe('recommended');
  const linkId = await verifiedDecisionEvidence(pid, p.pm, p.legal, d.id);
  const ext = await gov.secretary2.post(`${P(pid)}/decisions/${d.id}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, pid, d.id), outcome: 'approved', externalReference: 'DEMO-EXTERNAL-REF (synthetic)', evidenceLinkId: linkId });
  expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  return { decisionId: d.id, linkId };
};
const rejectEvidence = async (linkId: string) => {
  const l = (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0];
  const r = await p.finance.post(`${P(pid)}/evidence/${linkId}/verify`, { expectedVersion: l.version, decision: 'reject', note: 'Defective: does not match the resolution (synthetic)' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
};

describe('DOM-P2R-03 / DOM-P2R-02 — a decision backs only the change request it was raised for; the amount must be confirmed', () => {
  it('the decision about X cannot approve Y (422 decision_other_subject); X is approved on it once an assessor confirmed the amount', async () => {
    const x = await crUnderReview('Change X', '1500000.0000');
    const y = await crUnderReview('Change Y', '1200000.0000');
    const { decisionId } = await externallyApproved({ subjectType: 'change_request', subjectId: x });
    const onY = await approve(y, decisionId);
    expect(onY.status, JSON.stringify(onY.body)).toBe(422);
    expect(onY.body.code).toBe('change_control.decision_other_subject');
    // The requester's own figure does not decide (DOM-P2R-02) — even on the decision raised for X.
    const unconfirmed = await approve(x, decisionId);
    expect(unconfirmed.status).toBe(422);
    expect(unconfirmed.body.code).toBe('change_control.amount_unconfirmed');
    // The PM (the requester, who also holds the assessor role) re-recording the amount does not confirm it.
    await p.pm.post(`${P(pid)}/change-requests/${x}/assess`, { expectedVersion: await crVersion(x), impacts: {}, costImpact: SAR('1500000.0000') }).expect(201);
    expect((await p.pm.get(`${P(pid)}/change-requests/${x}`).expect(200)).body.costImpactConfirmed).toBe(false);
    await p.finance.post(`${P(pid)}/change-requests/${x}/assess`, { expectedVersion: await crVersion(x), impacts: {}, costImpact: SAR('1500000.0000'), note: 'Assessed (synthetic)' }).expect(201);
    expect((await p.pm.get(`${P(pid)}/change-requests/${x}`).expect(200)).body).toMatchObject({ costImpactConfirmed: true, costImpactRecordedBy: p.finance.userId });
    const ok = await approve(x, decisionId);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    const audit = (await owner().query(`select after from audit_event where entity_id = $1 and action = 'planning.change_request.approve' and outcome = 'success'`, [x])).rows[0];
    expect(audit.after).toMatchObject({ costImpactConfirmed: true, authority: { basis: 'governance_decision', decisionId } });
    // A refused attempt is audited as rejected with its code (the problem filter's detached audit row).
    const refusedAudit = await owner().query(
      `select count(*)::int n from audit_event where action = 'planning.approveChangeRequest' and outcome = 'rejected' and reason like 'change_control.decision_other_subject%' and after->'attempted'->>'changeRequestId' = $1`,
      [y],
    );
    expect(refusedAudit.rows[0].n).toBe(1);
  });

  it('within the delegation, an unconfirmed amount is refused and a confirmed one approved (no decision needed)', async () => {
    const c = await crUnderReview('Within limit', '250000.0000');
    expect((await approve(c)).body.code).toBe('change_control.amount_unconfirmed');
    await p.finance.post(`${P(pid)}/change-requests/${c}/assess`, { expectedVersion: await crVersion(c), impacts: {}, costImpact: SAR('250000.0000') }).expect(201);
    expect((await approve(c)).status).toBe(201);
    // No monetary impact at all is not an amount to confirm.
    const none = await crUnderReview('No cost', null);
    expect((await approve(none)).status).toBe(201);
  });

  it('QA-P2-01 backstop: the database refuses a second approved change request on the same decision (partial unique index)', async () => {
    const used = (await owner().query<{ decision_id: string }>(`select decision_id from change_request where project_id = $1 and status = 'approved' and decision_id is not null limit 1`, [pid])).rows[0]!;
    const other = await crUnderReview('Backstop', null);
    await expect(owner().query(`update change_request set status = 'approved', decision_id = $1 where id = $2`, [used.decision_id, other])).rejects.toMatchObject({ code: '23505', constraint: 'change_request_decision_uq' });
  });
});

describe('Decision-use registry (QA-P2-01, DOM-P2R-05; the generic facility of docs/architecture/module-guide.md)', () => {
  const org = async () => (await owner().query(`select org_id from project where id = $1`, [pid])).rows[0].org_id as string;
  const insertUse = async (decisionId: string, kind: string, subjectType: string, subjectId: string, projectId = pid) =>
    owner().query(`insert into decision_use (org_id, project_id, decision_id, use_kind, subject_type, subject_id) values ($1, $2, $3, $4, $5, $6)`, [await org(), projectId, decisionId, kind, subjectType, subjectId]);

  it('an approval on a decision registers its use; the registry is unique per decision and kind, append-only, same-project', async () => {
    const w = await crUnderReview('Change W', '1500000.0000');
    await p.finance.post(`${P(pid)}/change-requests/${w}/assess`, { expectedVersion: await crVersion(w), impacts: {}, costImpact: SAR('1500000.0000') }).expect(201);
    const { decisionId } = await externallyApproved({ subjectType: 'change_request', subjectId: w });
    expect((await approve(w, decisionId)).status).toBe(201);
    const uses = await owner().query(`select use_kind, subject_type, subject_id, used_by from decision_use where decision_id = $1`, [decisionId]);
    expect(uses.rows).toEqual([{ use_kind: 'change_request', subject_type: 'change_request', subject_id: w, used_by: p.sponsor.userId }]);
    // One record per decision and kind (the backstop when a caller skipped the lock → mapped to 409 by the facility).
    const other = await crUnderReview('Change U', null);
    await expect(insertUse(decisionId, 'change_request', 'change_request', other)).rejects.toMatchObject({ code: '23505', constraint: 'decision_use_kind_uq' });
    // Append-only: a use is never rewritten or removed.
    await expect(owner().query(`update decision_use set subject_id = $1 where decision_id = $2`, [other, decisionId])).rejects.toThrow(/append_only_violation/);
    await expect(owner().query(`delete from decision_use where decision_id = $1`, [decisionId])).rejects.toThrow(/append_only_violation/);
    // The record backed is a record of the decision's own project (polymorphic same-project trigger).
    const foreignCycle = (await owner().query(`select id from gate_assessment where project_id <> $1 limit 1`, [pid])).rows[0].id as string;
    await expect(insertUse(decisionId, 'gate_cycle', 'gate_assessment', foreignCycle)).rejects.toThrow(/cross_project_reference/);
  });

  it('a use already registered for another record (as a concurrent approval that committed first) refuses the approval: 422 decision_already_used', async () => {
    const t = await crUnderReview('Change T', '1500000.0000');
    await p.finance.post(`${P(pid)}/change-requests/${t}/assess`, { expectedVersion: await crVersion(t), impacts: {}, costImpact: SAR('1500000.0000') }).expect(201);
    const { decisionId } = await externallyApproved({ subjectType: 'change_request', subjectId: t });
    const winner = await crUnderReview('Change S (concurrent winner)', null);
    await insertUse(decisionId, 'change_request', 'change_request', winner);
    const r = await approve(t, decisionId);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('change_control.decision_already_used');
    expect(r.body.details).toMatchObject({ decisionId });
    expect((await owner().query(`select status, decision_id from change_request where id = $1`, [t])).rows[0]).toMatchObject({ status: 'under_review', decision_id: null });
  });
});

describe('DOM-P2R-04 — an external approval whose evidence was rejected stops backing change control and prerequisites', () => {
  it('change request: refused with decision_evidence_invalid even on the decision raised for it', async () => {
    const z = await crUnderReview('Change Z', '1500000.0000');
    await p.finance.post(`${P(pid)}/change-requests/${z}/assess`, { expectedVersion: await crVersion(z), impacts: {}, costImpact: SAR('1500000.0000') }).expect(201);
    const { decisionId, linkId } = await externallyApproved({ subjectType: 'change_request', subjectId: z });
    await rejectEvidence(linkId);
    const r = await approve(z, decisionId);
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('change_control.decision_evidence_invalid');
    expect((await owner().query(`select status from change_request where id = $1`, [z])).rows[0].status).toBe('under_review');
  });

  it('prerequisite: satisfied while the evidence stands, unsatisfied (task start refused) once it is rejected', async () => {
    const ws = (await workstreams(p.pm, pid)).get('WS02')!.id;
    const t = await task(p.pm, pid, ws, 'Task after the external approval (synthetic)', { durationDays: 2 });
    const { decisionId, linkId } = await externallyApproved({});
    const pre = await p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t, predecessorType: 'decision', predecessorId: decisionId });
    expect(pre.status, JSON.stringify(pre.body)).toBe(201);
    expect((await p.pm.get(`${P(pid)}/prerequisites?successorId=${t}`).expect(200)).body.items[0].satisfied).toBe(true);
    await rejectEvidence(linkId);
    expect((await p.pm.get(`${P(pid)}/prerequisites?successorId=${t}`).expect(200)).body.items[0].satisfied).toBe(false);
    const start = await p.pm.post(`${P(pid)}/tasks/${t}/start`, { expectedVersion: 1 });
    expect(start.status).toBe(422);
    expect(start.body.code).toBe('planning.prerequisite_pending');
  });
});

describe('DOM-P2R-07 — removing a blocking prerequisite: a reason, and not by the person it blocks', () => {
  it('reason required (400); the accountable person of the blocked task is refused (403, audited); the PM removes it with a reason', async () => {
    const ws = (await workstreams(p.pm, pid)).values().next().value!.id; // the tech lead leads the first workstream
    const t = await task(p.pm, pid, ws, 'Task led by the workstream lead (synthetic)', { durationDays: 2, accountableUserId: p.techLead.userId });
    const agr = await p.pm.post(`${P(pid)}/agreements`, { kindLabel: 'ATA', title: uniq('Agreement pending (synthetic)'), ownerUserId: p.pm.userId });
    expect(agr.status, JSON.stringify(agr.body)).toBe(201);
    const pre = (await p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t, predecessorType: 'agreement', predecessorId: agr.body.id }).expect(201)).body;
    expect((await p.techLead.post(`${P(pid)}/prerequisites/${pre.id}/remove`, {})).status).toBe(400);
    const blocked = await p.techLead.post(`${P(pid)}/prerequisites/${pre.id}/remove`, { reason: 'I want to start (synthetic)' });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(403);
    expect(blocked.body.code).toBe('planning.prerequisite.removal_by_blocked_party');
    expect((await owner().query(`select count(*)::int n from record_dependency where id = $1`, [pre.id])).rows[0].n).toBe(1);
    const denied = await owner().query(
      `select count(*)::int n from audit_event where action = 'planning.removePrerequisite' and actor_user_id = $1 and outcome = 'denied' and reason like 'planning.prerequisite.removal_by_blocked_party%'`,
      [p.techLead.userId],
    );
    expect(denied.rows[0].n).toBe(1);
    await p.pm.post(`${P(pid)}/prerequisites/${pre.id}/remove`, { reason: 'Agreement no longer required (synthetic)' }).expect(201);
    const done = (await owner().query(`select reason, before from audit_event where action = 'planning.prerequisite.remove' and entity_id = $1 and outcome = 'success'`, [pre.id])).rows[0];
    expect(done.reason).toBe('Agreement no longer required (synthetic)');
    expect(done.before).toMatchObject({ satisfied: false, accountableUserId: p.techLead.userId });
  });

  it('a satisfied prerequisite may be removed by the accountable person (it no longer blocks), with a reason', async () => {
    const ws = (await workstreams(p.pm, pid)).values().next().value!.id;
    const t = await task(p.pm, pid, ws, 'Task with satisfied evidence (synthetic)', { durationDays: 2, accountableUserId: p.techLead.userId });
    const ev = await p.pm.post(`${P(pid)}/evidence`, { targetType: 'task', targetId: t, note: 'Signed record (synthetic)' });
    expect(ev.status, JSON.stringify(ev.body)).toBe(201);
    const pre = (await p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t, predecessorType: 'evidence_link', predecessorId: ev.body.id }).expect(201)).body;
    await p.finance.post(`${P(pid)}/evidence/${ev.body.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked (synthetic)' }).expect(201);
    await p.techLead.post(`${P(pid)}/prerequisites/${pre.id}/remove`, { reason: 'Satisfied; no longer needed (synthetic)' }).expect(201);
  });
});
