import { expect } from 'vitest';
import { addCalendarDays, localDate } from '@hub/domain';
import { Client, loginAs, owner } from '../helpers';
import { DEMO_AUTHORITY_POLICY } from '../../src/modules/governance/demo-policy';
import { createWithVersion, login as docLogin } from '../documents/doc-helpers';

export { DEMO_AUTHORITY_POLICY };

export const P = (pid: string) => `/api/v1/projects/${pid}`;
export const today = () => localDate(new Date(), 'Asia/Riyadh');
export const plusDays = (n: number) => addCalendarDays(today(), n);
let seq = 0;
export const uniq = (prefix: string) => `${prefix} ${Date.now().toString(36)}-${++seq}`;

export type Actors = Record<'secretary' | 'sponsor' | 'chair' | 'pm' | 'finance' | 'legal' | 'approver' | 'contributor', Client>;

export async function actors(): Promise<Actors> {
  const keys = ['secretary', 'sponsor', 'chair', 'pm', 'finance', 'legal', 'approver', 'contributor'] as const;
  const out = {} as Actors;
  for (const k of keys) out[k] = await loginAs(k);
  return out;
}

/** Voting seats used by the test committees (validFrom in the past so terms can be ended without rewriting history). */
export const SEATS = [
  ['chair', 'chair', true],
  ['sponsor', 'sponsor', true],
  ['secretary', 'secretary', false],
  ['finance', 'voting_member', true],
  ['legal', 'voting_member', true],
  ['approver', 'voting_member', true],
] as const;

export interface TestCommittee {
  id: string;
  memberships: Record<string, string>;
  matrixId: string | null;
}

/** Committee created by the secretary, charter approved by the sponsor, activated, seats added, DEMO matrix approved. */
export async function setupCommittee(pid: string, a: Actors, opts: { name?: string; matrix?: boolean; validFrom?: string } = {}): Promise<TestCommittee> {
  const c = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'program_steering', name: opts.name ?? uniq('Test committee'), charter: { purpose: 'Integration test committee (synthetic)' } }).expect(201)).body;
  let v = (await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: 'TEST (synthetic)' }).expect(201)).body.version;
  v = (await a.secretary.post(`${P(pid)}/committees/${c.id}/activate`, { expectedVersion: v }).expect(201)).body.version;
  const memberships: Record<string, string> = {};
  for (const [key, memberRole, voting] of SEATS) {
    const r = await a.secretary.post(`${P(pid)}/committees/${c.id}/memberships`, { userId: a[key].userId, roleLabel: `${key} (test persona)`, memberRole, voting, validFrom: opts.validFrom ?? '2026-01-01' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    memberships[key] = r.body.id;
  }
  let matrixId: string | null = null;
  if (opts.matrix !== false) {
    const m = (await a.secretary.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions`, { policy: DEMO_AUTHORITY_POLICY, effectiveFrom: '2026-01-01' }).expect(201)).body;
    await a.sponsor.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'TEST DEMO matrix (synthetic)' }).expect(201);
    matrixId = m.id;
  }
  return { id: c.id, memberships, matrixId };
}

/**
 * The governing authority of a NON-demo project (DOM-P2-03, DOM-P2-12): an active steering committee and a non-demo matrix
 * (synthetic test values — the DEMO values with `isDemoPolicy: false`) approved by the sponsor with an approval DOCUMENT
 * (uploaded by the PM) and verified by a second person (Legal). The secretary drafts. The personas need, in the project:
 * secretary_cpmo (secretary), sponsor (sponsor), a documents.evidence.verify role (legal), project_manager (pm).
 */
export async function approvedNonDemoMatrix(pid: string, a: Pick<Actors, 'secretary' | 'sponsor' | 'legal'>, opts: { policy?: Record<string, unknown> } = {}) {
  const c = (await a.secretary.post(`${P(pid)}/committees`, { kind: 'program_steering', name: uniq('Steering committee (test, non-demo)'), charter: { purpose: 'Integration test committee (synthetic)' } }).expect(201)).body;
  const v = (await a.sponsor.post(`${P(pid)}/committees/${c.id}/charter/approve`, { expectedVersion: c.version, approvalReference: 'TEST (synthetic)' }).expect(201)).body.version;
  await a.secretary.post(`${P(pid)}/committees/${c.id}/activate`, { expectedVersion: v }).expect(201);
  const policy = opts.policy ?? { ...DEMO_AUTHORITY_POLICY, isDemoPolicy: false };
  const m = (await a.secretary.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions`, { policy, effectiveFrom: '2026-01-01' }).expect(201)).body;
  const pmDoc = await docLogin('pm');
  const doc = await createWithVersion(pmDoc, pid, { title: 'Approved delegation of authority (synthetic test record)', classification: 'internal' }, { bytes: Buffer.from('Synthetic delegation record for an integration test - not a real approval.'), name: 'delegation-test.txt' });
  expect(doc.upload.status, JSON.stringify(doc.upload.body)).toBe(201);
  const ap = await a.sponsor.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions/${m.id}/approve`, { approvalReference: 'TEST-DELEGATION-REF (synthetic test value)', approvalDocumentId: doc.id });
  expect(ap.status, JSON.stringify(ap.body)).toBe(201);
  expect(ap.body).toMatchObject({ status: 'draft', pendingVerification: true });
  const vf = await a.legal.post(`${P(pid)}/committees/${c.id}/authority-matrix-versions/${m.id}/verify-approval`, { decision: 'accept', note: 'Approval record checked against the loaded values (test)' });
  expect(vf.status, JSON.stringify(vf.body)).toBe(201);
  expect(vf.body.status).toBe('approved');
  return { committeeId: c.id as string, matrixId: m.id as string, documentId: doc.id };
}

export function paper(committeeId: string, over: Record<string, unknown> = {}) {
  return {
    committeeId,
    title: uniq('Test decision'),
    decisionTypeKey: 'change_request_budget',
    issue: 'Synthetic issue for an integration test',
    whyNow: 'Needed before the next synthetic milestone',
    alternatives: [{ title: 'Do it' }, { title: 'Do not do it', summary: 'Delays the synthetic plan' }],
    recommendation: 'Approve',
    impacts: { financial: 'Synthetic amount below the DEMO limit', operational: 'None identified', schedule: 'None identified' },
    amount: { amount: '100000.0000', currency: 'SAR', unitScale: 1 },
    risks: 'None identified',
    dependencies: 'None identified',
    latestSafeDate: plusDays(30),
    requiredAuthority: 'Steering committee (DEMO matrix)',
    ...over,
  };
}

/**
 * Evidence of an external authority decision (DOM-P2-12): a note link on the decision through the documents API, verified
 * (accepted) by a second person. Returns the evidence link id to pass as `evidenceLinkId` when recording the decision.
 */
export async function verifiedDecisionEvidence(pid: string, linker: Client, verifier: Client, decisionId: string, note = 'Synthetic record of the external authority decision (test)'): Promise<string> {
  const l = await linker.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: decisionId, note, purpose: 'External authority decision (test)' });
  expect(l.status, JSON.stringify(l.body)).toBe(201);
  const v = await verifier.post(`${P(pid)}/evidence/${l.body.id}/verify`, { expectedVersion: 1, decision: 'accept', note: 'Checked against the synthetic reference (test)' });
  expect(v.status, JSON.stringify(v.body)).toBe(201);
  return l.body.id as string;
}

export async function decisionVersion(c: Client, pid: string, id: string): Promise<number> {
  return (await c.get(`${P(pid)}/decisions/${id}`).expect(200)).body.version;
}

export async function meetingVersion(c: Client, pid: string, id: string): Promise<number> {
  return (await c.get(`${P(pid)}/meetings/${id}`).expect(200)).body.version;
}

/** Meeting with one accepted information item, agenda published, session open and the given members present. */
export async function openMeeting(pid: string, a: Actors, tc: TestCommittee, present: string[], opts: { scheduledAt?: string } = {}) {
  const m = (await a.secretary.post(`${P(pid)}/committees/${tc.id}/meetings`, { title: uniq('Test meeting'), scheduledAt: opts.scheduledAt ?? new Date().toISOString() }).expect(201)).body;
  const req = (await a.pm.post(`${P(pid)}/agenda-requests`, { committeeId: tc.id, title: 'Programme status (information)', kind: 'information', meetingId: m.id }).expect(201)).body;
  await a.secretary.post(`${P(pid)}/agenda-requests/${req.id}/screen`, { expectedVersion: req.version, outcome: 'accept', meetingId: m.id }).expect(201);
  let v = (await a.secretary.post(`${P(pid)}/meetings/${m.id}/publish-agenda`, { expectedVersion: m.version }).expect(201)).body.version;
  v = (await a.secretary.post(`${P(pid)}/meetings/${m.id}/start`, { expectedVersion: v }).expect(201)).body.version;
  if (present.length) {
    await a.secretary.post(`${P(pid)}/meetings/${m.id}/attendance`, { entries: present.map((k) => ({ membershipId: tc.memberships[k], status: 'present' })) }).expect(201);
  }
  return { id: m.id as string, number: m.number as number };
}

/** Draft (by `requester`) → submit → secretariat review, tabled at `meetingId` (or not tabled when null). */
export async function tabledDecision(pid: string, a: Actors, requester: Client, committeeId: string, meetingId: string | null, over: Record<string, unknown> = {}) {
  const d = (await requester.post(`${P(pid)}/decisions`, paper(committeeId, over)).expect(201)).body;
  const s = await requester.post(`${P(pid)}/decisions/${d.id}/submit`, { expectedVersion: d.version });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
  const r = await a.secretary.post(`${P(pid)}/decisions/${d.id}/start-review`, { expectedVersion: s.body.version, ...(meetingId ? { meetingId } : {}) });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { id: d.id as string, code: d.code as string, version: r.body.version as number };
}

export async function vote(pid: string, c: Client, decisionId: string, choice: 'approve' | 'reject' | 'abstain', expectedVersion?: number) {
  const v = expectedVersion ?? (await decisionVersion(c, pid, decisionId));
  return c.post(`${P(pid)}/decisions/${decisionId}/votes`, { expectedVersion: v, choice });
}

export async function auditCount(action: string, actorUserId: string, outcome: 'rejected' | 'denied' | 'success'): Promise<number> {
  const r = await owner().query<{ n: number }>(`select count(*)::int n from audit_event where action = $1 and actor_user_id = $2 and outcome = $3`, [action, actorUserId, outcome]);
  return r.rows[0]!.n;
}

export async function voteRows(decisionId: string): Promise<number> {
  const r = await owner().query<{ n: number }>(`select count(*)::int n from vote where decision_id = $1`, [decisionId]);
  return r.rows[0]!.n;
}

export async function decisionRow(decisionId: string) {
  const r = await owner().query(`select * from decision where id = $1`, [decisionId]);
  return r.rows[0] as Record<string, unknown>;
}
