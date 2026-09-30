import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { assertActionExecutable, DomainError } from '@hub/domain';
import { closeApp, closePools, getApp, owner } from '../helpers';
import { runWorker } from '../gates/gate-test-kit';
import { DbService } from '../../src/platform/db.service';
import { ScopeService } from '../../src/platform/auth/scope.service';
import { withDbScope, RequestContext } from '../../src/platform/context';
import { TransactionsService } from '../../src/modules/jv/transactions.service';
import { WaiverService } from '../../src/modules/gates/waiver.service';
import { P, auditRows, doc, finalDecision, ok, partnerAt, passG5, setupJvProject, JvProject } from './jv-kit';

/**
 * AT-12 — all workstreams are green but a mandatory CP lacks evidence: closing is blocked; the AI (or any service
 * identity) cannot bypass the condition or create a waiver (REQ-JV-013, REQ-JV-017, REQ-JV-018).
 */
let j: JvProject;
let pid: string;
let closing: string;
let cpMet: { id: string; code: string };
let cpMissing: { id: string; code: string };

async function confirmedSigning(partnerId: string) {
  const pm = j.p.pm;
  const s = await ok(await pm.post(`${P(pid)}/signings`, { name: 'AT-12 signing (synthetic)', partnerId }));
  let v = (await ok(await pm.post(`${P(pid)}/transaction-events/${s.id}/transition`, { expectedVersion: 1, command: 'start_preparation' }))).version;
  v = (await ok(await pm.post(`${P(pid)}/transaction-events/${s.id}/transition`, { expectedVersion: v, command: 'mark_ready' }))).version;
  const executed = await doc(pm, pid, 'AT-12 executed agreement (synthetic)', { kind: 'agreement' });
  // DOM-P4-02: the signing is authorized by the decision that approved gate G5 (passed through the gate API first).
  const req = await ok(await pm.post(`${P(pid)}/transaction-events/${s.id}/request-confirmation`, { expectedVersion: v, decisionId: await passG5(j), executedDocumentId: executed.id }));
  await ok(await j.p.sponsor.post(`${P(pid)}/signings/${s.id}/record`, { expectedVersion: req.version }));
  return s.id as string;
}

async function cp(title: string) {
  const c = await ok(await j.p.legal.post(`${P(pid)}/closing-conditions`, { closingId: closing, title, ownerUserId: j.p.pm.userId, blocking: true }));
  return { id: c.id as string, code: c.code as string };
}

async function verifyWithEvidence(c: { id: string }) {
  const link = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Synthetic CP evidence (test)' }));
  const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
  const s = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: cur.version }));
  await ok(await j.p.legal.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: s.version, outcome: 'verify' }));
  return link.id as string;
}

async function closingDetail() {
  return (await j.p.pm.get(`${P(pid)}/closings/${closing}`).expect(200)).body;
}

beforeAll(async () => {
  j = await setupJvProject('JV-AT12');
  pid = j.projectId;
  const partnerId = await partnerAt(j, 'AT-12 Partner (fictional)');
  const signing = await confirmedSigning(partnerId);
  closing = (await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: signing, name: 'AT-12 closing (synthetic)' }))).id;
  await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${closing}/transition`, { expectedVersion: 1, command: 'start_preparation' }));
  cpMet = await cp('Board approvals (synthetic)');
  cpMissing = await cp('Mandatory third-party consent (synthetic)');
  await verifyWithEvidence(cpMet);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('AT-12 — a mandatory CP without evidence blocks closing even when every workstream is green [AT-12, REQ-JV-013, REQ-JV-017, REQ-JV-018]', () => {
  it('UT: all tasks done but no confirmation keeps the closing open (task completion is not an input)', async () => {
    // Fixture: every task of the project reported done (simulates "all workstreams green"; planning is tested elsewhere).
    await owner().query(`update task set status = 'done' where project_id = $1`, [pid]);
    await runWorker();
    const d = await closingDetail();
    expect(d.status).toBe('in_preparation');
    expect(d.confirmedAt).toBeNull();
    expect(d.ready).toBe(false);
    expect(d.blockers.map((b: { ref: string }) => b.ref)).toEqual([cpMissing.code]);
    expect(d.blockers[0].messageI18n).toEqual([{ code: 'jv.closing.cp_unmet', params: { ref: cpMissing.code, status: 'open' } }]);
    const dims = (await j.p.pm.get(`${P(pid)}/status-dimensions`).expect(200)).body.items as { key: string; state: string }[];
    expect(dims.find((x) => x.key === 'jv_transaction')?.state).not.toBe('closed');
  });

  it('mark_ready is refused while the CP is unmet', async () => {
    const d = await closingDetail();
    const r = await j.p.pm.post(`${P(pid)}/transaction-events/${closing}/transition`, { expectedVersion: d.version, command: 'mark_ready' });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.closing.not_ready');
    expect(r.body.details.blockers[0].ref).toBe(cpMissing.code);
    expect((await closingDetail()).status).toBe('in_preparation');
  });

  it('UT: verifyCP without evidence is rejected (and logged); submitting without evidence is rejected', async () => {
    const c = (await j.p.pm.get(`${P(pid)}/closing-conditions/${cpMissing.id}`).expect(200)).body;
    const sub = await j.p.pm.post(`${P(pid)}/closing-conditions/${cpMissing.id}/submit-evidence`, { expectedVersion: c.version });
    expect(sub.status).toBe(422);
    expect(sub.body.code).toBe('jv.cp.evidence_required');
    const ver = await j.p.legal.post(`${P(pid)}/closing-conditions/${cpMissing.id}/verify`, { expectedVersion: c.version, outcome: 'verify' });
    expect(ver.status).toBe(422);
    expect(ver.body.code).toBe('jv.cp.evidence_required');
    expect((await auditRows(pid, 'jv.cp.verify', cpMissing.id)).map((r) => r.outcome)).toContain('rejected');
    expect((await j.p.pm.get(`${P(pid)}/closing-conditions/${cpMissing.id}`).expect(200)).body.status).toBe('open');
  });

  it('IT: confirm with one unverified blocking CP is rejected and logged — the CP set is re-evaluated inside the confirm transaction', async () => {
    // Make the closing ready (both CPs verified), request the authorized confirmation …
    const missingLink = await verifyWithEvidence(cpMissing);
    let d = await closingDetail();
    const ready = await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${closing}/transition`, { expectedVersion: d.version, command: 'mark_ready' }));
    const decisionId = await finalDecision(j, 'jv_closing_confirmation');
    const req = await ok(await j.p.pm.post(`${P(pid)}/transaction-events/${closing}/request-confirmation`, { expectedVersion: ready.version, decisionId }));
    // … then the evidence the CP relied on is withdrawn: the CP is "verified" without active evidence.
    const links = (await j.p.pm.get(`${P(pid)}/evidence?targetType=closing_condition&targetId=${cpMissing.id}`).expect(200)).body.items as { id: string; version: number }[];
    const link = links.find((l) => l.id === missingLink)!;
    await ok(await j.p.pm.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: link.version, note: 'Evidence withdrawn (test)' }));
    const r = await j.p.sponsor.post(`${P(pid)}/closings/${closing}/confirm`, { expectedVersion: req.version });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('jv.closing.blocked');
    expect(r.body.details.blockers.map((b: { ref: string }) => b.ref)).toEqual([cpMissing.code]);
    expect(r.body.details.blockers[0].messageI18n[0].code).toBe('jv.closing.cp_verified_without_evidence');
    const logged = await auditRows(pid, 'jv.closing.declare', closing);
    expect(logged.map((x) => x.outcome)).toEqual(['rejected']);
    expect(logged[0]!.reason).toContain(cpMissing.code);
    d = await closingDetail();
    expect(d.status).toBe('ready_for_confirmation');
    expect(d.confirmedAt).toBeNull();
    // A blocking CP added after readiness blocks the confirmation too.
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: cpMissing.id, note: 'Replacement evidence (test)' }));
    const late = await cp('Late blocking CP (synthetic)');
    const r2 = await j.p.sponsor.post(`${P(pid)}/closings/${closing}/confirm`, { expectedVersion: req.version });
    expect(r2.status).toBe(422);
    expect(r2.body.details.blockers.map((b: { ref: string }) => b.ref)).toEqual([late.code]);
    // Once every blocking CP is met, the authorized confirmation (not the requester) closes it.
    await verifyWithEvidence(late);
    const byRequester = await j.p.pm.post(`${P(pid)}/closings/${closing}/confirm`, { expectedVersion: req.version });
    expect(byRequester.status).toBe(403); // PM has no closing authority
    const done = await ok(await j.p.sponsor.post(`${P(pid)}/closings/${closing}/confirm`, { expectedVersion: req.version, note: 'Authorized confirmation (test)' }));
    expect(done.status).toBe('confirmed');
    const final = await closingDetail();
    expect(final.confirmedBy).toBe(j.p.sponsor.userId);
    expect(final.confirmationAuthority).toMatch(/jv_closing_confirmation/);
    expect((await auditRows(pid, 'jv.closing.declare', closing)).map((x) => x.outcome)).toEqual(['rejected', 'rejected', 'success']);
  });

  it('the AI / any service identity cannot confirm a closing, verify a CP or create a waiver — even with the permission allow-listed', async () => {
    for (const action of ['declare_closing', 'create_waiver', 'verify_condition']) {
      expect(() => assertActionExecutable({ mode: 'autopilot', killSwitch: false, approved: true, autopilot: null, actionsToday: 0, today: '2026-10-01', action })).toThrow(/may not perform/);
    }
    const app = await getApp();
    const principal = app.get(ScopeService).servicePrincipal(j.orgId, pid, 'svc-ai-pm', ['jv.closing.declare', 'jv.cp.verify', 'jv.cp.manage', 'jv.cp.waive', 'jv.deal.read']);
    const ctx: RequestContext = withDbScope({ principal, correlationId: 'at12-ai-probe', sessionId: null, ip: null, authMethod: null, projectIds: [], locale: 'en' });
    const db = app.get(DbService);
    const tx = app.get(TransactionsService);
    const waivers = app.get(WaiverService);
    const code = async (fn: () => Promise<unknown>) => {
      try {
        await db.run(ctx, fn);
        return 'no error';
      } catch (e) {
        return e instanceof DomainError ? e.code : String(e);
      }
    };
    expect(await code(() => tx.confirm(ctx, pid, closing, 'closing', { expectedVersion: 1 }))).toBe('jv.human_only');
    expect(await code(() => tx.verify(ctx, pid, cpMet.id, { expectedVersion: 1, outcome: 'verify' }))).toBe('jv.human_only');
    expect(await code(() => waivers.request(ctx, pid, 'closing_condition', cpMissing.id, { basis: 'AI', impact: 'AI' }))).toBe('gates.human_only');
  });
});
