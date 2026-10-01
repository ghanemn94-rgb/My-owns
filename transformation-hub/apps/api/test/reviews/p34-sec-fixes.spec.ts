import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POLICY_MATRIX } from '@hub/domain';
import { ROUTES } from '@hub/contracts';
import { closeApp, closePools, getApp, owner } from '../helpers';
import { P, doc, grant, login, ok, plusDays, room, setupJvProject, today, DocClient, JvProject } from '../jv/jv-kit';
import { paper } from '../governance/gov-fixtures';
import { drain, serviceHandles, setAi } from '../ai/ai-fixtures';
import { JobContextFactory } from '../../src/platform/jobs/job-context';
import type { RequestContext } from '../../src/platform/context';
import { DbService } from '../../src/platform/db.service';
import { PostCloseService } from '../../src/modules/jv/postclose.service';
import { TransactionsService } from '../../src/modules/jv/transactions.service';
import { JV_LONG_STOP_SCAN_PERMISSIONS, JV_OBLIGATION_SCAN_PERMISSIONS } from '../../src/modules/jv/jv.jobs';

/**
 * Regression tests of the P3/P4 security review fixes (docs/reviews/P3-P4-security-review.md, "Fix status"), written by the
 * implementer for the paths the reviewer's probe specs (p34-sec-registers / p34-sec-jv) do not reach: the other
 * verification commands with the evidence-linker pattern (SEC-P34-01), every AI knowledge source against its owning
 * module's read rule (SEC-P34-02 / -03), the external-role route invariant (SEC-P34-04), the DD request list (SEC-P34-09),
 * the "not required" request lifecycle (SEC-P34-10), decisions and the activity feed for workstream-only readers
 * (SEC-P34-12), the requester's own evidence (SEC-P34-13) and the JV service allowlists (SEC-P34-17).
 * One JV test project, synthetic data only. `j.gp.techLead` holds ONLY `workstream_lead` on the first workstream (a
 * workstream-only principal: finance.record.read, readiness.register.read, governance.decision.read… on that workstream).
 * The owner pool is used only for setup no API offers (a TSA's active status, an approved valuation's approval columns) and
 * for assertions; each use is commented.
 */
type Handles = Awaited<ReturnType<typeof serviceHandles>>;
let j: JvProject;
let pid: string;
let ws: string[];
let wsl: DocClient;
const TAG = 'P34FIX';

beforeAll(async () => {
  j = await setupJvProject('P34FIX-JV');
  pid = j.projectId;
  wsl = j.gp.techLead as unknown as DocClient;
  ws = ((await j.p.pm.get(`${P(pid)}/workstreams`).expect(200)).body.items as { id: string }[]).map((w) => w.id);
  const scope = await owner().query(`select role, workstream_id from project_membership where project_id = $1 and user_id = $2 and revoked_at is null`, [pid, wsl.userId]);
  expect(scope.rows).toEqual([{ role: 'workstream_lead', workstream_id: ws[0] }]);
  await setAi(pid, {}); // owner pool: advisory mode, Simulated mock provider (test-only reset of the AI settings)
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

async function signing() {
  return (await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing (synthetic)` }))).id as string;
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-01 — whoever linked the evidence is "self" for every verification (access-matrix §5.1)', () => {
  it('post-close obligation: the evidence linker cannot verify (403, unchanged); another verifier can', async () => {
    const o = await ok(await j.p.pm.post(`${P(pid)}/post-close-obligations`, { kind: 'obligation', title: `${TAG} post-close filing (synthetic)`, ownerUserId: j.p.pm.userId }));
    const done = await ok(await j.p.pm.post(`${P(pid)}/post-close-obligations/${o.id}/transition`, { expectedVersion: 1, command: 'report_complete', note: 'Filed (synthetic)' }));
    await ok(await j.p.legal.post(`${P(pid)}/evidence`, { targetType: 'post_close_obligation', targetId: o.id, note: 'Filing receipt linked by the future verifier (synthetic)' }));
    const self = await j.p.legal.post(`${P(pid)}/post-close-obligations/${o.id}/verify`, { expectedVersion: done.version, outcome: 'verify' });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('jv.obligation.self_verification');
    expect((await owner().query(`select status from post_close_obligation where id = $1`, [o.id])).rows[0].status).toBe('completed_pending_evidence');
    const v = await ok(await j.p.approver.post(`${P(pid)}/post-close-obligations/${o.id}/verify`, { expectedVersion: done.version, outcome: 'verify' }));
    expect(v.status).toBe('verified');
  });

  it('closing checklist item: whoever linked evidence of the item cannot accept it (403); another verifier can', async () => {
    const eventId = await signing();
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId, title: `${TAG} executed deed (synthetic)`, ownerUserId: j.p.pm.userId }));
    const executed = await doc(j.p.pm, pid, `${TAG} executed deed copy (synthetic)`, { kind: 'agreement' });
    const delivered = await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/deliver`, { expectedVersion: 1, documentId: executed.id }));
    await ok(await j.p.legal.post(`${P(pid)}/evidence`, { targetType: 'closing_deliverable', targetId: item.id, note: 'Signature page linked by the future acceptor (synthetic)' }));
    const self = await j.p.legal.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('jv.checklist_item.self_acceptance');
    const a = await ok(await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/accept`, { expectedVersion: delivered.version }));
    expect(a.status).toBe('verified');
  });

  it('benefit realization: the Finance member who linked its evidence cannot verify it (403, unchanged); an independent verifier can', async () => {
    const admin = await login('portfolio.admin');
    await ok(await admin.post(`${P(pid)}/members`, { userId: j.p.approver.userId, role: 'finance_restricted', reason: 'Second Finance verifier (synthetic test)' }));
    const b = await ok(await j.p.pm.post(`${P(pid)}/benefits`, { title: `${TAG} NOC run-cost avoidance (synthetic)`, measurementDefinition: 'Run cost vs allocation (synthetic definition)', ownerUserId: j.p.pm.userId }));
    const bpath = `${P(pid)}/benefits/${b.id}`;
    const ap = await ok(await j.p.finance.post(`${bpath}/approve`, { expectedVersion: 1 }));
    const tr = await ok(await j.p.pm.post(`${bpath}/start-tracking`, { expectedVersion: ap.version }));
    const rr = await ok(await j.p.pm.post(`${bpath}/record-realization`, { expectedVersion: tr.version, actualValue: 'Lower run cost (synthetic)', realizedOn: today(), verificationSource: 'Monthly cost report (synthetic)' }));
    await ok(await j.p.finance.post(`${P(pid)}/evidence`, { targetType: 'benefit', targetId: b.id, note: 'Cost report linked by the future verifier (synthetic)' }));
    const self = await j.p.finance.post(`${bpath}/verify`, { expectedVersion: rr.version, note: 'Verified on my own evidence (test)' });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('finance.benefit.verify_self');
    expect((await owner().query(`select status from benefit where id = $1`, [b.id])).rows[0].status).toBe('realized_unverified');
    const v = await ok(await j.p.approver.post(`${bpath}/verify`, { expectedVersion: rr.version, note: 'Checked against the cost report (synthetic)' }));
    expect(v.status).toBe('realized_verified');
  });

  it('governance action: the secretary who linked evidence of the action cannot verify its closure (403); another secretary can', async () => {
    const a = await ok(await j.p.secretary.post(`${P(pid)}/actions`, { title: `${TAG} circulate the pack (synthetic)`, meetingId: j.gov.meetingId, ownerUserId: j.p.pm.userId, dueDate: plusDays(7) }));
    const cur = (await j.p.pm.get(`${P(pid)}/actions/${a.id}`).expect(200)).body;
    await ok(await j.p.pm.post(`${P(pid)}/actions/${a.id}/report-done`, { expectedVersion: cur.version, closureEvidenceNote: 'Pack circulated (synthetic)' }));
    await ok(await j.p.secretary.post(`${P(pid)}/evidence`, { targetType: 'action_item', targetId: a.id, note: 'Distribution list linked by the future verifier (synthetic)' }));
    const done = (await j.p.pm.get(`${P(pid)}/actions/${a.id}`).expect(200)).body;
    const self = await j.p.secretary.post(`${P(pid)}/actions/${a.id}/verify-closure`, { expectedVersion: done.version });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('governance.action.linker_verification');
    expect((await owner().query(`select status from action_item where id = $1`, [a.id])).rows[0].status).toBe('done_pending_verification');
    const cpmo2 = j.gov.secretary2 as unknown as DocClient; // a second secretariat member (ops.lead)
    await ok(await cpmo2.post(`${P(pid)}/actions/${a.id}/verify-closure`, { expectedVersion: done.version }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-02 / SEC-P34-03 — every AI knowledge source applies its owning module’s read rule (classification, reach, project-wide registers)', () => {
  let tsaWs0: string;
  let tsaWs1: string;
  let valuationId: string;
  let decisionId: string;
  let roomId: string;
  let roomDocId: string;
  const ROOM_CANARY = 'PELICAN58SECFIXROOM';

  const asUser = async <T,>(c: DocClient, fn: (k: Handles['knowledge'], ctx: RequestContext) => Promise<T>): Promise<T> => {
    const { contexts, db, knowledge } = await serviceHandles();
    const ctx = (await contexts.forUser(c.userId, pid))!;
    expect(ctx).toBeTruthy();
    return db.run(ctx, () => fn(knowledge, ctx));
  };

  beforeAll(async () => {
    // Two TSAs ending in 10 days, one per workstream (confidential by default; the tech lead is cleared confidential).
    tsaWs0 = (await ok(await j.p.pm.post(`${P(pid)}/tsa-services`, { name: `${TAG} WS1 TSA (synthetic)`, startDate: plusDays(-30), endDate: plusDays(10), workstreamId: ws[0] }))).id;
    tsaWs1 = (await ok(await j.p.pm.post(`${P(pid)}/tsa-services`, { name: `${TAG}-TSA-WS2-CANARY (synthetic)`, startDate: plusDays(-30), endDate: plusDays(10), workstreamId: ws[1] }))).id;
    // Owner pool (setup): ACTIVE status — reached in production through the TSA approval / activation commands.
    await owner().query(`update tsa_service set status = 'active' where id = any($1::uuid[])`, [[tsaWs0, tsaWs1]]);

    // An approved valuation (project-level: financial model versions carry no workstream), classified confidential.
    const m = await ok(await j.p.finance.post(`${P(pid)}/financial-models`, { kind: 'valuation', name: `${TAG} valuation case (synthetic)` }));
    const out = { measure: 'money', currency: 'SAR', unitScale: 1000000, basis: 'enterprise_value', key: 'headline', label: 'Headline value', amount: '777' };
    const v = await ok(await j.p.finance.post(`${P(pid)}/financial-models/${m.id}/versions`, { modelCase: 'base', versionLabel: 'v1', headlineBasis: 'enterprise_value', sourceRef: 'Synthetic model run (test)', outputs: [out] }));
    valuationId = v.id;
    const d = await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG} valuation paper (synthetic)` })));
    // Owner pool (setup): APPROVED by two people other than the preparer (validator legal, approver sponsor) on a decision of
    // the project, as the table's check constraints require; production reaches this through validate / approve-values.
    await owner().query(
      `update financial_model_version set classification = 'confidential', validated_by = $2, validated_at = now(), validated_hash = 'p34fix-synthetic',
              approved_values = outputs, approval_decision_id = $4, approved_by = $3, approved_at = now(), approval_state = 'approved' where id = $1`,
      [valuationId, j.p.legal.userId, j.p.sponsor.userId, d.id],
    );

    // A submitted decision paper awaiting action (project-level governance register).
    const paperD = await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG}-DECISION-CANARY awaiting paper (synthetic)` })));
    decisionId = paperD.id;
    await ok(await j.p.pm.post(`${P(pid)}/decisions/${decisionId}/submit`, { expectedVersion: paperD.version }));

    // An internal room: the tech lead (workstream-only) and the PM (creator) hold a room grant; a document is filed in it.
    roomId = (await room(j.p.pm, pid, { name: `${TAG} internal working room (test)`, type: 'internal' })).id;
    await ok(await grant(j.p.legal, pid, roomId, { userId: wsl.userId, accessLevel: 'read' }));
    roomDocId = (await doc(j.p.pm, pid, `${TAG} room working paper (synthetic)`, { roomId, text: `Synthetic working paper ${ROOM_CANARY} for the AI retrieval test.` })).id;
    await drain(); // index the document (documents / AI jobs)
  }, 300_000);

  it('TSA detections: the readiness reach applies (a workstream-only lead sees only its workstream’s TSA); the PM sees both', async () => {
    const mine = await asUser(wsl, (k, ctx) => k.tsaExpiring(ctx, pid, today()));
    expect(mine!.map((t) => t.id)).toContain(tsaWs0);
    expect(mine!.map((t) => t.id)).not.toContain(tsaWs1);
    const pm = await asUser(j.p.pm, (k, ctx) => k.tsaExpiring(ctx, pid, today()));
    expect(pm!.map((t) => t.id)).toEqual(expect.arrayContaining([tsaWs0, tsaWs1]));
    // Through the HTTP route (the workstream-only lead may be refused the AI surface altogether — no leak either way).
    const det = await wsl.get(`${P(pid)}/ai/detections`);
    expect([200, 403]).toContain(det.status);
    expect(JSON.stringify(det.body)).not.toContain('TSA-WS2-CANARY');
    const pmDet = (await j.p.pm.get(`${P(pid)}/ai/detections`).expect(200)).body;
    expect(JSON.stringify(pmDet)).toContain('TSA-WS2-CANARY');
    const keys = await asUser(wsl, (k, ctx) => k.visibleCitationKeys(ctx, pid, [{ type: 'tsa_service', id: tsaWs0 }, { type: 'tsa_service', id: tsaWs1 }]));
    expect([...keys]).toEqual([`tsa_service:${tsaWs0}`]);
  });

  it('approved valuations: only with a project-wide finance grant (finance reach), in retrieval and in the citation re-check', async () => {
    const fin = await asUser(j.p.finance, (k, ctx) => k.approvedFinancials(ctx, pid, true));
    expect(fin!.valuations.map((v) => v.id)).toContain(valuationId);
    const lead = await asUser(wsl, (k, ctx) => k.approvedFinancials(ctx, pid, true));
    expect(lead).not.toBeNull(); // the lead holds finance.record.read — on its workstream only
    expect(lead!.valuations.map((v) => v.id)).not.toContain(valuationId);
    expect((await wsl.get(`${P(pid)}/financial-models/${(await owner().query(`select model_id from financial_model_version where id = $1`, [valuationId])).rows[0].model_id}`)).status).toBe(404);
    const keys = await asUser(wsl, (k, ctx) => k.visibleCitationKeys(ctx, pid, [{ type: 'financial_model_version', id: valuationId }]));
    expect(keys.size).toBe(0);
    const finKeys = await asUser(j.p.finance, (k, ctx) => k.visibleCitationKeys(ctx, pid, [{ type: 'financial_model_version', id: valuationId }]));
    expect([...finKeys]).toEqual([`financial_model_version:${valuationId}`]);
  });

  it('decisions awaiting action: only with a project-wide governance grant (the governance lists’ rule)', async () => {
    const pm = await asUser(j.p.pm, (k, ctx) => k.decisionsAwaiting(ctx, pid, today()));
    expect(pm!.decisions.map((d) => d.id)).toContain(decisionId);
    const lead = await asUser(wsl, (k, ctx) => k.decisionsAwaiting(ctx, pid, today()));
    expect(lead!.decisions.map((d) => d.id)).not.toContain(decisionId);
    expect((await wsl.get(`${P(pid)}/decisions/${decisionId}`)).status).toBe(403); // the module refuses it too
    const keys = await asUser(wsl, (k, ctx) => k.visibleCitationKeys(ctx, pid, [{ type: 'decision', id: decisionId }]));
    expect(keys.size).toBe(0);
  });

  it('document retrieval: a room document is retrieved only where the documents module shows it (grant coverage), not for a workstream-only reader with a room grant', async () => {
    const list = (await wsl.get(`${P(pid)}/documents?pageSize=100`).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain(roomDocId); // the documents module's own rule
    const lead = await asUser(wsl, (k, ctx) => k.searchDocuments(ctx, pid, ROOM_CANARY));
    expect((lead ?? []).map((c) => c.document_id)).not.toContain(roomDocId);
    const pm = await asUser(j.p.pm, (k, ctx) => k.searchDocuments(ctx, pid, ROOM_CANARY));
    expect((pm ?? []).map((c) => c.document_id)).toContain(roomDocId);
    const keys = await asUser(wsl, (k, ctx) => k.visibleCitationKeys(ctx, pid, [{ type: 'document', id: roomDocId }]));
    expect(keys.size).toBe(0);
  });

  it('SEC-P34-09: the DD request list applies the grant coverage too (a room-granted, workstream-only reader is refused the request and does not list it)', async () => {
    const r = await ok(await j.p.pm.post(`${P(pid)}/diligence-requests`, { roomId, question: `${TAG}-DDREQ-CANARY internal question (synthetic)`, domain: 'legal', classification: 'confidential' }));
    expect((await j.p.pm.get(`${P(pid)}/diligence-requests?pageSize=100`).expect(200)).body.items.map((x: { id: string }) => x.id)).toContain(r.id);
    expect((await wsl.get(`${P(pid)}/diligence-requests/${r.id}`)).status).toBe(403);
    const list = (await wsl.get(`${P(pid)}/diligence-requests?pageSize=100`).expect(200)).body;
    expect(JSON.stringify(list)).not.toContain('DDREQ-CANARY');
    expect(list.total).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-04 — internal routes whose permission an external role holds', () => {
  it('invariant: every route whose permission external_partner_limited holds is a partner-access route, except the internal DD request route (refused to room-only principals)', () => {
    const external = new Set(POLICY_MATRIX.roles['external_partner_limited']!.permissions);
    const held = Object.values(ROUTES).filter((r) => typeof r.access === 'string' && external.has(r.access));
    const internal = held.filter((r) => !r.path.includes('/partner-access/')).map((r) => r.id).sort();
    // A new internal route with such a permission must refuse room-only principals in its service (like DiligenceService.create)
    // and be added here with a test.
    expect(internal).toEqual(['jv.createDdRequest']);
  });

  it('the internal route records its real author (created_by) with origin internal', async () => {
    const rm = (await room(j.p.pm, pid, { name: `${TAG} second internal room (test)`, type: 'internal' })).id;
    const r = await ok(await j.p.pm.post(`${P(pid)}/diligence-requests`, { roomId: rm, question: `${TAG} internal question (synthetic)`, domain: 'finance', requesterLabel: 'Mobily Finance (synthetic label)', classification: 'confidential' }));
    const row = (await owner().query(`select origin, created_by from diligence_request where id = $1`, [r.id])).rows[0];
    expect(row).toEqual({ origin: 'internal', created_by: j.p.pm.userId });
    const dto = (await j.p.pm.get(`${P(pid)}/diligence-requests/${r.id}`).expect(200)).body;
    expect(dto).toMatchObject({ origin: 'internal', createdBy: j.p.pm.userId });
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-10 — the "not required" request lifecycle', () => {
  it('a request made on an earlier version of the item no longer applies (422 stale); a new request replaces it', async () => {
    const eventId = await signing();
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId, title: `${TAG} officer certificate (synthetic)` }));
    const req1 = await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: 1, reason: 'Not needed (synthetic)' }));
    const again = await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: 1, reason: 'Twice (synthetic)' });
    expect(again.status).toBe(422);
    expect(again.body.code).toBe('jv.checklist_item.not_required_pending');
    // The item changes after the request (delivered with its document) → the request is stale.
    const executed = await doc(j.p.pm, pid, `${TAG} certificate copy (synthetic)`, { kind: 'agreement' });
    const delivered = await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/deliver`, { expectedVersion: 1, documentId: executed.id }));
    const stale = await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/not-required/decide`, { expectedVersion: delivered.version, decision: 'confirm' });
    expect(stale.status).toBe(422);
    expect(stale.body.code).toBe('jv.checklist_item.not_required_stale');
    const detail = (await j.p.pm.get(`${P(pid)}/signings/${eventId}`).expect(200)).body;
    expect(detail.checklist.find((x: { id: string }) => x.id === item.id).notRequiredRequest).toBeNull();
    const req2 = await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: delivered.version, reason: 'Superseded by the deed (synthetic)' }));
    const states = await owner().query(`select id, status from approval_request where subject_id = $1 order by created_at`, [item.id]);
    expect(states.rows).toEqual([
      { id: req1.approvalRequestId, status: 'invalidated' },
      { id: req2.approvalRequestId, status: 'pending' },
    ]);
  });

  it('the second person may reject with a reason: the item keeps its state and blocker; the request is closed', async () => {
    const eventId = await signing();
    const item = await ok(await j.p.pm.post(`${P(pid)}/checklist-items`, { eventId, title: `${TAG} registry extract (synthetic)` }));
    await ok(await j.p.pm.post(`${P(pid)}/checklist-items/${item.id}/not-required`, { expectedVersion: 1, reason: 'Not needed (synthetic)' }));
    const noReason = await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/not-required/decide`, { expectedVersion: 1, decision: 'reject' });
    expect(noReason.status).toBe(422);
    const rej = await ok(await j.p.approver.post(`${P(pid)}/checklist-items/${item.id}/not-required/decide`, { expectedVersion: 1, decision: 'reject', note: 'Still required by the SPA (synthetic)' }));
    expect(rej.status).toBe('pending');
    const e = (await j.p.pm.get(`${P(pid)}/signings/${eventId}`).expect(200)).body;
    expect(e.blockers.map((b: { ref: string }) => b.ref)).toContain(item.code);
    const rec = await owner().query(`select q.status, r.decision from approval_request q join approval_record r on r.approval_request_id = q.id where q.subject_id = $1`, [item.id]);
    expect(rec.rows).toEqual([{ status: 'rejected', decision: 'reject' }]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-12 — project-level registers are not shown to workstream-only readers through prerequisites or the activity feed', () => {
  it('a decision as the prerequisite of the lead’s own task is not listed; decision events are not in the lead’s activity feed', async () => {
    const d = await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG}-PREREQ-DECISION-CANARY (synthetic)` })));
    const t = await ok(await j.p.pm.post(`${P(pid)}/tasks`, { workstreamId: ws[0], title: `${TAG} task waiting for the decision (synthetic)` }));
    await ok(await j.p.pm.post(`${P(pid)}/prerequisites`, { successorType: 'task', successorId: t.id, predecessorType: 'decision', predecessorId: d.id }));
    expect((await wsl.get(`${P(pid)}/tasks/${t.id}`)).status).toBe(200);
    const pre = (await wsl.get(`${P(pid)}/prerequisites?successorId=${t.id}`).expect(200)).body;
    expect(JSON.stringify(pre)).not.toContain('PREREQ-DECISION-CANARY');
    const pmPre = (await j.p.pm.get(`${P(pid)}/prerequisites?successorId=${t.id}`).expect(200)).body;
    expect(JSON.stringify(pmPre)).toContain('PREREQ-DECISION-CANARY');
    const feed = (await wsl.get(`${P(pid)}/activity?entityType=decision&entityId=${d.id}`).expect(200)).body;
    expect(feed.total).toBe(0);
    const pmFeed = (await j.p.pm.get(`${P(pid)}/activity?entityType=decision&entityId=${d.id}`).expect(200)).body;
    expect(pmFeed.total).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-13 — the requester still shapes their own paper', () => {
  it('the requester links evidence to their draft paper (201); another member is refused (403 governance.decision.not_requester)', async () => {
    const d = await ok(await j.p.pm.post(`${P(pid)}/decisions`, paper(j.gov.committeeId, { title: `${TAG} own paper (synthetic)` })));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: d.id, note: 'Supporting analysis by the requester (synthetic)' }));
    const other = await j.p.legal.post(`${P(pid)}/evidence`, { targetType: 'decision', targetId: d.id, note: 'Added by another member (synthetic)' });
    expect(other.status).toBe(403);
    expect(other.body.code).toBe('governance.decision.not_requester');
    const links = await owner().query(`select added_by from evidence_link where target_type = 'decision' and target_id = $1`, [d.id]);
    expect(links.rows.map((r) => r.added_by)).toEqual([j.p.pm.userId]);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34-17 — the JV service identity holds, per job, only the permission that job uses', () => {
  it('the allowlists are one permission each, never a read / verify / waive / confirm permission; each job cannot run the other', async () => {
    expect(JV_OBLIGATION_SCAN_PERMISSIONS).toEqual(['jv.closing_checklist.manage']);
    expect(JV_LONG_STOP_SCAN_PERMISSIONS).toEqual(['jv.cp.manage']);
    const app = await getApp();
    const contexts = app.get(JobContextFactory);
    const db = app.get(DbService);
    const job = { id: 'p34fix-test', org_id: j.orgId, project_id: pid };
    const obligationCtx = contexts.forService(job, 'svc-jv', [...JV_OBLIGATION_SCAN_PERMISSIONS]);
    const longStopCtx = contexts.forService(job, 'svc-jv', [...JV_LONG_STOP_SCAN_PERMISSIONS]);
    await expect(db.run(obligationCtx, () => app.get(TransactionsService).scanLongStops(obligationCtx, pid))).rejects.toMatchObject({ kind: 'forbidden', code: 'policy.forbidden' });
    await expect(db.run(longStopCtx, () => app.get(PostCloseService).scanOverdue(longStopCtx, pid))).rejects.toMatchObject({ kind: 'forbidden', code: 'policy.forbidden' });
    await expect(db.run(obligationCtx, () => app.get(PostCloseService).scanOverdue(obligationCtx, pid))).resolves.toMatchObject({ scanned: expect.any(Number) });
    await expect(db.run(longStopCtx, () => app.get(TransactionsService).scanLongStops(longStopCtx, pid))).resolves.toMatchObject({ scanned: expect.any(Number) });
  });
});
