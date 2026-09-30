import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, owner } from '../helpers';
import { setupProject, setupGovernance, gateByKey, runWorker, Personas, Gov } from '../gates/gate-test-kit';
import { Actors, P, decisionRow, decisionVersion, openMeeting, paper, tabledDecision, uniq, verifiedDecisionEvidence, vote } from '../governance/gov-fixtures';
import { task, workstreams } from '../planning/fixtures';

/**
 * P2 DOMAIN FINAL REVIEW — probes (docs/reviews/P2-domain-final-review.md): focused re-verification of the fixes for the
 * P2 domain re-review (DOM-P2R-01..05, -07, GOV-015 / F-01, DOM-P2-14) and of the shared "relying on a governance
 * decision" mechanism, including bypass and concurrency attempts.
 *
 *  - `RE …` tests re-verify a fix through the real API; they are expected to pass.
 *  - `DEFECT …` tests assert the behaviour REQUIRED by the specification or by the platform's own documented rule for a NEW
 *    finding of this review; at the reviewed revision they FAIL — the failure is the reproduction. As in the P2 QA and P4
 *    domain reviews they are declared with `it.fails`, so the shared suite stays green while the defect is open and turns
 *    red once it is fixed (then drop `.fails` / `DEFECT`). `P2F_PROBE_PLAIN=1` runs them as plain tests to show the failure
 *    messages. Do not weaken them.
 *  - `OBSERVATION …` tests pin current behaviour behind a finding whose rule is for the governance owner; they pass.
 * All data is synthetic (the project is created by the test and flagged demo, like every gate-kit project).
 */

const defect = process.env['P2F_PROBE_PLAIN'] ? it : it.fails;

let pid: string;
let p: Personas;
let gov: Gov;
const A = () => p as unknown as Actors;
const SAR = (amount: string) => ({ amount, currency: 'SAR', unitScale: 1 });

beforeAll(async () => {
  ({ projectId: pid, p } = await setupProject('DFR-A'));
  gov = await setupGovernance(pid, p);
}, 600_000);

afterAll(async () => {
  await closeApp();
  await closePools();
});

// ---------------------------------------------------------------------------------------------------------------
// helpers

const crVersion = async (id: string) => (await p.pm.get(`${P(pid)}/change-requests/${id}`).expect(200)).body.version as number;

/** A change request raised by `requester` (draft). */
const draftCr = async (title: string, over: Record<string, unknown> = {}, requester = p.pm) => {
  const cr = await requester.post(`${P(pid)}/change-requests`, { title: uniq(title), rationale: 'Synthetic rationale (final review)', alternatives: ['Do nothing'], impacts: { scope: 'Synthetic' }, ...over });
  expect(cr.status, JSON.stringify(cr.body)).toBe(201);
  return cr.body.id as string;
};

/** Draft → submit → under review (PM), cost confirmed by Finance when given. */
const crUnderReview = async (title: string, cost: string | null) => {
  const id = await draftCr(title, cost ? { costImpact: SAR(cost) } : {});
  await p.pm.post(`${P(pid)}/change-requests/${id}/submit`, { expectedVersion: 1 }).expect(201);
  await p.pm.post(`${P(pid)}/change-requests/${id}/start-review`, { expectedVersion: 2 }).expect(201);
  if (cost) await p.finance.post(`${P(pid)}/change-requests/${id}/assess`, { expectedVersion: await crVersion(id), impacts: {}, costImpact: SAR(cost), note: 'Assessed (synthetic)' }).expect(201);
  return id;
};
const approveCr = async (id: string, decisionId?: string, approver = p.sponsor) =>
  approver.post(`${P(pid)}/change-requests/${id}/approve`, { expectedVersion: await crVersion(id), note: 'Final-review probe (synthetic)', ...(decisionId ? { decisionId } : {}) });

/** A decision approved WITHIN the committee mandate (the four present voting members approve). */
const approvedDecision = async (over: Record<string, unknown>) => {
  const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Final-review decision (synthetic)'), ...over });
  const v = await decisionVersion(p.chair, pid, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  expect(out.body.status).toBe('approved');
  return d.id;
};

/** A change_request_budget decision above the DEMO limit → recommended → approved by the external body on verified evidence. */
const externallyApproved = async (over: Record<string, unknown>) => {
  const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('External approval (final review, synthetic)'), decisionTypeKey: 'change_request_budget', amount: SAR('1500000.0000'), ...over });
  const v = await decisionVersion(p.chair, pid, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'approve', v)).status).toBe(201);
  const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.body.status, JSON.stringify(out.body)).toBe('recommended');
  const linkId = await verifiedDecisionEvidence(pid, p.pm, p.legal, d.id);
  const ext = await gov.secretary2.post(`${P(pid)}/decisions/${d.id}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, pid, d.id), outcome: 'approved', externalReference: 'DEMO-EXTERNAL-REF (synthetic)', evidenceLinkId: linkId });
  expect(ext.status, JSON.stringify(ext.body)).toBe(201);
  return { decisionId: d.id, linkId };
};
const linkVersion = async (linkId: string) => (await owner().query(`select version from evidence_link where id = $1`, [linkId])).rows[0].version as number;

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2R-03 subject binding [REQ-GOV-022, REQ-PLN-013]', () => {
  it('RE DOM-P2R-03 (baselines): only the decision raised for THIS baseline version backs its approval', async () => {
    const b1 = (await p.pm.post(`${P(pid)}/baselines`, { note: 'Baseline 1 (final review, synthetic)' }).expect(201)).body as { id: string; version: number };
    const openCr = await draftCr('Open change (subject of a baseline-type paper)');
    const forB1 = await approvedDecision({ decisionTypeKey: 'baseline_approval', subjectType: 'baseline_version', subjectId: b1.id });
    const forCr = await approvedDecision({ decisionTypeKey: 'baseline_approval', subjectType: 'change_request', subjectId: openCr });
    const unbound = await approvedDecision({ decisionTypeKey: 'baseline_approval' });
    // Baseline 1 is rejected; baseline 2 is proposed (another snapshot the committee never saw).
    await p.sponsor.post(`${P(pid)}/baselines/${b1.id}/reject`, { expectedVersion: b1.version, reason: 'Rework the plan (synthetic)' }).expect(201);
    const b2 = (await p.pm.post(`${P(pid)}/baselines`, { note: 'Baseline 2 (final review, synthetic)' }).expect(201)).body as { id: string; version: number };
    const tryWith = (decisionId: string) => p.sponsor.post(`${P(pid)}/baselines/${b2.id}/approve`, { expectedVersion: b2.version, note: 'probe', decisionId });
    const r1 = await tryWith(forB1);
    expect(r1.status, JSON.stringify(r1.body)).toBe(422);
    expect(r1.body.code).toBe('change_control.decision_other_subject');
    const r2 = await tryWith(forCr);
    expect(r2.status, JSON.stringify(r2.body)).toBe(422);
    expect(r2.body.code).toBe('change_control.decision_other_subject');
    const r3 = await tryWith(unbound);
    expect(r3.status, JSON.stringify(r3.body)).toBe(422);
    expect(r3.body.code).toBe('change_control.decision_no_subject');
    const forB2 = await approvedDecision({ decisionTypeKey: 'baseline_approval', subjectType: 'baseline_version', subjectId: b2.id });
    const ok = await tryWith(forB2);
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect((await owner().query(`select use_kind, subject_id from decision_use where decision_id = $1`, [forB2])).rows).toEqual([{ use_kind: 'baseline_version', subject_id: b2.id }]);
  });

  it('RE DOM-P2R-03 (bypass attempts): after submission the subject cannot be changed by a partial or re-typed edit, and a racing edit/submit never leaves a changed subject on a submitted paper', async () => {
    const cr1 = await draftCr('Subject lock 1');
    const cr2 = await draftCr('Subject lock 2');
    // Partial / re-typed edits after the first submission (returned to draft by the secretariat).
    const d = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Subject lock (probe)'), subjectType: 'change_request', subjectId: cr1 })).expect(201)).body;
    const sub = await p.pm.post(`${P(pid)}/decisions/${d.id}/submit`, { expectedVersion: d.version });
    expect(sub.status, JSON.stringify(sub.body)).toBe(201);
    const ret = await p.secretary.post(`${P(pid)}/decisions/${d.id}/return`, { expectedVersion: sub.body.version, note: 'Clarify (synthetic)' });
    expect(ret.status, JSON.stringify(ret.body)).toBe(201);
    const idOnly = await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: ret.body.version, subjectId: cr2 });
    expect(idOnly.status, JSON.stringify(idOnly.body)).not.toBe(200);
    const retyped = await p.pm.patch(`${P(pid)}/decisions/${d.id}`, { expectedVersion: ret.body.version, subjectType: 'baseline_version', subjectId: cr1 });
    expect(retyped.status, JSON.stringify(retyped.body)).not.toBe(200);
    expect(await decisionRow(d.id)).toMatchObject({ subject_type: 'change_request', subject_id: cr1 });

    // Concurrency: the requester edits the subject while submitting the same version (three attempts).
    for (let i = 0; i < 3; i++) {
      const x = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq(`Race ${i} (probe)`), subjectType: 'change_request', subjectId: cr1 })).expect(201)).body;
      const [edit, submit] = await Promise.all([
        p.pm.patch(`${P(pid)}/decisions/${x.id}`, { expectedVersion: x.version, subjectType: 'change_request', subjectId: cr2 }).then((r) => r),
        p.pm.post(`${P(pid)}/decisions/${x.id}/submit`, { expectedVersion: x.version }).then((r) => r),
      ]);
      const ok = [edit.status === 200, submit.status === 201].filter(Boolean).length;
      expect(ok, `edit ${edit.status} ${JSON.stringify(edit.body)} / submit ${submit.status} ${JSON.stringify(submit.body)}`).toBe(1);
      const row = await decisionRow(x.id);
      if (row['status'] === 'submitted') expect(row).toMatchObject({ subject_id: cr1 });
      else expect(row).toMatchObject({ status: 'draft', subject_id: cr2, first_submitted_at: null });
    }
  });

  it('OBSERVATION (shared mechanism): the gate path ignores the subject — a paper raised FOR a change request, of the operational gate type, is accepted as the G1 decision; exclusivity with the change request rests on the decision type only', async () => {
    const cr = await draftCr('Change named by a gate-type paper');
    const d = await approvedDecision({ decisionTypeKey: 'gate_decision_operational', gateKey: 'G1', amount: null, subjectType: 'change_request', subjectId: cr, requiredAuthority: 'Per the DEMO matrix (synthetic)' });
    const g1 = await gateByKey(p.pm, pid, 'G1');
    const link = await p.pm.post(`${P(pid)}/gates/${g1.id}/assessment/link-decision`, { expectedVersion: g1.assessment.version, decisionId: d });
    expect(link.status, JSON.stringify(link.body)).toBe(201);
    const after = await gateByKey(p.pm, pid, 'G1');
    expect(after.assessment.decisionId).toBe(d);
    expect(after.blockers.filter((b) => b.kind === 'decision' && b.ref === d)).toEqual([]);
    // The same decision cannot back the change request it names (type mismatch) — the only thing keeping the two apart.
    await p.pm.post(`${P(pid)}/change-requests/${cr}/submit`, { expectedVersion: 1 }).expect(201);
    await p.pm.post(`${P(pid)}/change-requests/${cr}/start-review`, { expectedVersion: 2 }).expect(201);
    const onCr = await approveCr(cr, d);
    expect(onCr.status, JSON.stringify(onCr.body)).toBe(422);
    expect(onCr.body.code).toBe('change_control.decision_type_mismatch');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2R-04 external-approval evidence at every reliance [REQ-LCY-015, REQ-DAT-014, DOM-P2-12]', () => {
  defect('DEFECT DOM-P2F-02: after an evidence conflict, the person who RECORDED the external approval re-verifies its evidence and the decision backs approvals again', async () => {
    const x = await crUnderReview('Change X (conflict probe)', '1500000.0000');
    const { decisionId, linkId } = await externallyApproved({ subjectType: 'change_request', subjectId: x });
    // A contradicting record is linked to the decision: both links become conflicting.
    const contra = await p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: decisionId, note: 'Contradicting record (synthetic)', conflictsWithLinkId: linkId, conflictNote: 'Does not match the resolution (synthetic)' });
    expect(contra.status, JSON.stringify(contra.body)).toBe(201);
    const refused = await approveCr(x, decisionId);
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.code).toBe('change_control.decision_evidence_invalid');
    // The contradicting link is superseded, then the RECORDER of the external approval (second secretariat member, who holds
    // documents.evidence.verify) re-verifies the original link: it is active again, now "verified" by the recorder.
    await p.pm.post(`${P(pid)}/evidence/${contra.body.id}/supersede`, { expectedVersion: await linkVersion(contra.body.id), note: 'Withdrawn (synthetic)' }).expect(201);
    const reverify = await gov.secretary2.post(`${P(pid)}/evidence/${linkId}/verify`, { expectedVersion: await linkVersion(linkId), decision: 'accept', note: 'Re-checked (synthetic)' });
    expect(reverify.status, JSON.stringify(reverify.body)).toBe(201);
    const link = (await owner().query(`select status, reviewed_by from evidence_link where id = $1`, [linkId])).rows[0];
    const recorder = (await decisionRow(decisionId))['outcome_recorded_by'] ?? null;
    const r = await approveCr(x, decisionId);
    // Required (DOM-P2-12 as documented in module-guide.md "Relying on a governance decision" and decision-reliance.ts: the
    // evidence of the external approval must STILL be an active link VERIFIED BY A SECOND PERSON; recordExternalApproval
    // refuses a recorder who verified the evidence): evidence whose only current verification is by the recorder of the
    // external approval does not back a new approval.
    expect(r.status, `approved on evidence verified by the external-approval recorder: link ${JSON.stringify(link)}, recorder ${gov.secretary2.userId}, outcome recorder ${recorder}; response ${JSON.stringify(r.body)}`).toBe(422);
  });

  it('OBSERVATION DOM-P2F-05: once the external-approval evidence of an APPROVED change request is rejected, the change request is not flagged and no escalation is raised; the decision can never be re-evidenced', async () => {
    const y = await crUnderReview('Change Y (flag probe)', '1500000.0000');
    const { decisionId, linkId } = await externallyApproved({ subjectType: 'change_request', subjectId: y });
    expect((await approveCr(y, decisionId)).status).toBe(201);
    const t0 = (await owner().query(`select now() as t`)).rows[0].t as Date;
    const rej = await p.finance.post(`${P(pid)}/evidence/${linkId}/verify`, { expectedVersion: await linkVersion(linkId), decision: 'reject', note: 'Defective: does not match the resolution (synthetic)' });
    expect(rej.status, JSON.stringify(rej.body)).toBe(201);
    await runWorker();
    // Anything raised AFTER the rejection (the recommendation's own escalation was raised and resolved before it).
    const esc = await owner().query(`select count(*)::int n from escalation where project_id = $1 and created_at >= $4 and (source_id in ($2, $3) or title like '%' || (select code from change_request where id = $3) || '%')`, [pid, decisionId, y, t0]);
    const flags = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and created_at >= $4 and action like '%reassess%' and (entity_id = $2 or after::text like $3)`, [pid, y, `%${decisionId}%`, t0]);
    // Current behaviour: the approval stands silently (only APPROVED GATE CYCLES are flagged by the reassessment job).
    expect((await owner().query(`select status from change_request where id = $1`, [y])).rows[0].status).toBe('approved');
    expect(esc.rows[0].n).toBe(0);
    expect(flags.rows[0].n).toBe(0);
    // No command re-evidences the external approval of an approved decision (the refusal says "until the external approval is
    // evidenced again"): a fresh verified link cannot be recorded.
    const fresh = await verifiedDecisionEvidence(pid, p.pm, p.legal, decisionId, 'Corrected record of the external decision (synthetic)');
    const again = await gov.secretary2.post(`${P(pid)}/decisions/${decisionId}/record-external-approval`, { expectedVersion: await decisionVersion(p.chair, pid, decisionId), outcome: 'approved', externalReference: 'DEMO-EXTERNAL-REF (corrected, synthetic)', evidenceLinkId: fresh });
    expect(again.status, JSON.stringify(again.body)).toBe(422);
    expect(again.body.code).toBe('governance.external.not_recommended');
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2R-01 vote closing and GOV-015 declarations [REQ-GOV-015, REQ-GOV-016; proposed rules Q-40, A-49, A-50]', () => {
  defect('DEFECT DOM-P2F-01: a chair RECUSED from the item closes voting on it after one approve vote — approved 1 to 0', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Recused chair (probe)') });
    const rec = await p.chair.post(`${P(pid)}/decisions/${d.id}/recusals`, { reason: 'Conflict: related party (synthetic)' });
    expect(rec.status, JSON.stringify(rec.body)).toBe(201);
    const v = await decisionVersion(p.chair, pid, d.id);
    expect((await vote(pid, p.sponsor, d.id, 'approve', v)).status).toBe(201);
    const close = await p.chair.post(`${P(pid)}/decisions/${d.id}/close-voting`, { expectedVersion: v, reason: 'Enough votes (synthetic)' });
    let outcome: unknown = null;
    if (close.status === 201) {
      const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: close.body.version });
      outcome = { status: out.status, body: out.body };
    } else {
      for (const k of ['finance', 'legal'] as const) await vote(pid, p[k], d.id, 'approve', v);
      await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
    }
    // Required: REQ-GOV-015 ("recused members are excluded from quorum and voting"), committee-charter-draft.md §14.2 (a
    // conflicted member takes no part in the item): a member recused from the item — the chair included — cannot close the
    // vote on it (and decide who is counted). Proposed voting-closure rule A-49 / Q-40 gives this step to the chair.
    expect(close.status, `recused chair closed the vote; outcome ${JSON.stringify(outcome)}`).not.toBe(201);
  });

  defect('DEFECT DOM-P2F-03 (concurrency): a vote whose request passed the "voting open" check lands after the chair closed voting', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Close vs vote race (probe)') });
    // Finance declares "no conflict" first (own declaration, so the vote request writes nothing before the vote row).
    expect((await p.finance.post(`${P(pid)}/meetings/${gov.meetingId}/conflicts`, { decisionId: d.id, declaration: 'no_conflict' })).status).toBe(201);
    const v = await decisionVersion(p.chair, pid, d.id);
    expect((await vote(pid, p.chair, d.id, 'approve', v)).status).toBe(201);
    // Deterministic interleaving: hold the vote table so Finance's vote request stops at its INSERT (after its checks).
    const lock = await owner().connect();
    let financeVote: Promise<{ status: number; body: Record<string, unknown> }>;
    let close: { status: number; body: Record<string, unknown> };
    try {
      await lock.query('begin');
      await lock.query('lock table vote in exclusive mode');
      financeVote = vote(pid, p.finance, d.id, 'approve', v, { declare: false }).then((r) => r as unknown as { status: number; body: Record<string, unknown> });
      let waiting = 0;
      for (let i = 0; i < 100 && waiting === 0; i++) {
        await new Promise((res) => setTimeout(res, 50));
        waiting = (await owner().query(`select count(*)::int n from pg_locks where relation = 'vote'::regclass and not granted`)).rows[0].n;
      }
      expect(waiting, 'the vote request is waiting at its INSERT').toBeGreaterThan(0);
      close = (await p.chair.post(`${P(pid)}/decisions/${d.id}/close-voting`, { expectedVersion: v, reason: 'Closing (race probe, synthetic)' })) as unknown as typeof close;
    } finally {
      await lock.query('commit');
      lock.release();
    }
    expect(close.status, JSON.stringify(close.body)).toBe(201);
    const fv = await financeVote!;
    const out = await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: await decisionVersion(p.chair, pid, d.id) });
    const closeAudit = (await owner().query(`select after from audit_event where entity_id = $1 and action = 'governance.decision.close_voting'`, [d.id])).rows[0]?.after;
    const votes = (await owner().query(`select user_id from vote where decision_id = $1 and round = 1`, [d.id])).rows.map((r) => r.user_id);
    // Required (authority-matrix.md §3 step 5 (b), proposed rule A-49: "no further vote is accepted in that round",
    // 422 governance.vote.voting_closed): the vote is refused, or the close waits for it — never both committed.
    expect(fv.status, `vote ${fv.status}; close audit notVoted ${JSON.stringify(closeAudit)}; round-1 votes ${JSON.stringify(votes)}; outcome ${out.status} ${JSON.stringify(out.body)}`).toBe(422);
  });

  it('OBSERVATION DOM-P2F-07: a "no conflict" declaration given at one meeting still counts when the item is voted again at a later meeting (new round)', async () => {
    const d = await tabledDecision(pid, A(), p.pm, gov.committeeId, gov.meetingId, { title: uniq('Declaration carried over (probe)') });
    const v = await decisionVersion(p.chair, pid, d.id);
    expect((await vote(pid, p.chair, d.id, 'approve', v)).status).toBe(201); // declares "no conflict" with the vote (meeting 1)
    const df = await p.secretary.post(`${P(pid)}/decisions/${d.id}/defer`, { expectedVersion: v, note: 'Deferred to the next meeting (synthetic)' });
    expect(df.status, JSON.stringify(df.body)).toBe(201);
    const seats = (await owner().query(`select id, user_id from committee_membership where committee_id = $1`, [gov.committeeId])).rows as { id: string; user_id: string }[];
    const memberships: Record<string, string> = {};
    for (const k of ['chair', 'sponsor', 'secretary', 'finance', 'legal', 'approver'] as const) memberships[k] = seats.find((s) => s.user_id === p[k].userId)!.id;
    const m2 = await openMeeting(pid, A(), { id: gov.committeeId, memberships, matrixId: null }, ['chair', 'sponsor', 'secretary', 'finance', 'legal']);
    const rs = await p.secretary.post(`${P(pid)}/decisions/${d.id}/resume`, { expectedVersion: df.body.version, meetingId: m2.id });
    expect(rs.status, JSON.stringify(rs.body)).toBe(201);
    expect(rs.body.voteRound).toBe(2);
    // Round 2 at meeting 2: the chair votes WITHOUT a new declaration (charter §14.1: "at the start of each meeting, per agenda item").
    const again = await vote(pid, p.chair, d.id, 'approve', rs.body.version, { declare: false });
    expect(again.status, JSON.stringify(again.body)).toBe(201);
    const decls = (await owner().query(`select meeting_id from conflict_declaration where decision_id = $1 and user_id = $2`, [d.id, p.chair.userId])).rows.map((r) => r.meeting_id);
    expect(decls).toEqual([gov.meetingId]);
    for (const k of ['sponsor', 'finance', 'legal'] as const) expect((await vote(pid, p[k], d.id, 'approve', rs.body.version)).status).toBe(201);
    expect((await p.secretary.post(`${P(pid)}/decisions/${d.id}/record-outcome`, { expectedVersion: rs.body.version })).status).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2R-02 cost impact confirmation [REQ-GOV-022; proposed rule A-51 / Q-43]', () => {
  it('OBSERVATION DOM-P2F-06: an assessor confirms 0 on the DRAFT; the requester then states 1,500,000 in the impact text — the stale confirmation still decides the approval', async () => {
    // The sponsor raises the change (the chair will approve it: not the requester).
    const id = await draftCr('Stale confirmation', {}, p.sponsor);
    // The PM (an assessor, not the requester) records a cost impact of 0 while the request is still a draft.
    await p.pm.patch(`${P(pid)}/change-requests/${id}`, { expectedVersion: 1, costImpact: SAR('0.0000') }).expect(200);
    let cr = (await p.pm.get(`${P(pid)}/change-requests/${id}`).expect(200)).body;
    expect(cr).toMatchObject({ costImpactConfirmed: true, costImpactRecordedBy: p.pm.userId });
    // The requester then restates the change and its cost in text; the confirmation is kept.
    await p.sponsor.patch(`${P(pid)}/change-requests/${id}`, {
      expectedVersion: cr.version,
      impacts: { scope: 'Synthetic, larger scope', cost: '1,500,000 DEMO-SAR one-off (synthetic) — above the DEMO limit of 1,000,000' },
      proposedChange: { summary: 'Extended scope (synthetic)' },
    }).expect(200);
    cr = (await p.pm.get(`${P(pid)}/change-requests/${id}`).expect(200)).body;
    expect(cr).toMatchObject({ costImpactConfirmed: true, costImpact: { amount: '0.0000' } });
    await p.sponsor.post(`${P(pid)}/change-requests/${id}/submit`, { expectedVersion: cr.version }).expect(201);
    await p.pm.post(`${P(pid)}/change-requests/${id}/start-review`, { expectedVersion: await crVersion(id) }).expect(201);
    const r = await approveCr(id, undefined, p.chair);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    const audit = (await owner().query(`select after from audit_event where entity_id = $1 and action = 'planning.change_request.approve' and outcome = 'success'`, [id])).rows[0];
    expect(audit.after).toMatchObject({ costImpactConfirmed: true, authority: { basis: 'delegated_authority' } });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2R-07 prerequisite removal [REQ-PLN-006; proposed rule A-53]', () => {
  const pendingAgreement = async () => {
    const agr = await p.pm.post(`${P(pid)}/agreements`, { kindLabel: 'ATA', title: uniq('Agreement pending (final review, synthetic)'), ownerUserId: p.pm.userId });
    expect(agr.status, JSON.stringify(agr.body)).toBe(201);
    return agr.body.id as string;
  };

  defect('DEFECT DOM-P2F-04: a task with NO accountable person — the workstream lead removes the blocking prerequisite and starts the task (the separation-of-duties rule fails open)', async () => {
    const ws = (await workstreams(p.pm, pid)).values().next().value!.id; // led by the tech lead in the kit
    const t = await task(p.pm, pid, ws, 'Task without an accountable person (synthetic)', { durationDays: 2 });
    const pre = (await p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t, predecessorType: 'agreement', predecessorId: await pendingAgreement() }).expect(201)).body;
    const removed = await p.techLead.post(`${P(pid)}/prerequisites/${pre.id}/remove`, { reason: 'Not needed (synthetic)' });
    const started = removed.status === 201 ? await p.techLead.post(`${P(pid)}/tasks/${t}/start`, { expectedVersion: 1 }) : null;
    // Required (module-guide.md I-R3: separation of duties fails CLOSED — an unknown subject is 403 policy.sod_subject_unknown;
    // A-53): when nobody is recorded as accountable, the removal of a still-blocking prerequisite is not left to whoever can
    // start the task.
    expect(removed.status, `removed ${JSON.stringify(removed.body)}; task start by the same person ${started?.status} ${JSON.stringify(started?.body)}`).toBe(403);
  });

  it('OBSERVATION DOM-P2F-04: the accountable person is a contributor — the workstream lead (who may start the task) removes the blocking prerequisite and starts it', async () => {
    const ws = (await workstreams(p.pm, pid)).values().next().value!.id;
    const t = await task(p.pm, pid, ws, 'Task of a contributor (synthetic)', { durationDays: 2, accountableUserId: p.contributor.userId });
    const pre = (await p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t, predecessorType: 'agreement', predecessorId: await pendingAgreement() }).expect(201)).body;
    const removed = await p.techLead.post(`${P(pid)}/prerequisites/${pre.id}/remove`, { reason: 'Agreement not required (synthetic)' });
    expect(removed.status, JSON.stringify(removed.body)).toBe(201);
    const started = await p.techLead.post(`${P(pid)}/tasks/${t}/start`, { expectedVersion: 1 });
    expect(started.status, JSON.stringify(started.body)).toBe(201);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe('P2 domain final review — DOM-P2-14 paper evidence [REQ-GOV-014]', () => {
  it('RE DOM-P2-14: a blank "none" reason is no reason; OBSERVATION: the rule is checked at submission only (evidence superseded afterwards leaves the paper without evidence)', async () => {
    const blank = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Blank reason (probe)'), evidenceNoneReason: '   ' })).expect(201)).body;
    const refused = await p.pm.post(`${P(pid)}/decisions/${blank.id}/submit`, { expectedVersion: blank.version });
    expect(refused.status, JSON.stringify(refused.body)).toBe(422);
    expect(refused.body.details.missing).toEqual(['supportingEvidence']);
    const d = (await p.pm.post(`${P(pid)}/decisions`, paper(gov.committeeId, { title: uniq('Evidence then superseded (probe)'), evidenceNoneReason: null })).expect(201)).body;
    const link = await p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: d.id, note: 'Supporting analysis (synthetic)' });
    expect(link.status).toBe(201);
    expect((await p.pm.post(`${P(pid)}/decisions/${d.id}/submit`, { expectedVersion: d.version })).status).toBe(201);
    await p.pm.post(`${P(pid)}/evidence/${link.body.id}/supersede`, { expectedVersion: await linkVersion(link.body.id), note: 'Withdrawn (synthetic)' }).expect(201);
    const detail = (await p.pm.get(`${P(pid)}/decisions/${d.id}`).expect(200)).body;
    expect(detail).toMatchObject({ status: 'submitted', supportingEvidenceLinks: 0 });
  });
});
