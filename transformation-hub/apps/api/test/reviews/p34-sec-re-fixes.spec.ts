import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiToolByName } from '@hub/domain';
import { closeApp, closePools, owner } from '../helpers';
import { P, doc, login, ok, plusDays, setupJvProject, today, DocClient, JvProject } from '../jv/jv-kit';
import { gateByKey } from '../gates/gate-test-kit';
import { serviceHandles, setAi } from '../ai/ai-fixtures';
import { AiSettingsService } from '../../src/modules/ai/ai-settings.service';

/**
 * Regression tests of the P3/P4 security RE-CHECK fixes (docs/reviews/P3-P4-security-recheck.md, "Fix status"), written by
 * the implementer for the variants the reviewer's probes (p34-sec-re-registers / p34-sec-re-jv-ai) do not run:
 *  - SEC-P34R-07: flag-conflict and supersede of the incorporation, TSA and gate-criterion evidence follow the link rules;
 *    the target's own managers still supersede;
 *  - SEC-P34R-03: the uploader of the evidence document is "self" for the benefit and the action-closure verifications;
 *  - SEC-P34R-09: a CP with conflicting evidence is not verified;
 *  - SEC-P34R-05: a proposal is hidden from a reader who cannot see a record its run gave the model, and cannot be approved
 *    by that reader (404); a free draft is shown to a reader cleared at least as high as the delegating user.
 * One JV test project (jv-kit), synthetic data only. The owner pool resets the project's AI settings and reads rows for
 * assertions; each use is commented.
 */
let j: JvProject;
let pid: string;
const TAG = 'P34RFX';

beforeAll(async () => {
  j = await setupJvProject('P34RFX-JV');
  pid = j.projectId;
  await setAi(pid, {}); // owner pool: advisory mode, Simulated mock provider (test-only reset of the AI settings)
}, 600_000);
afterAll(async () => {
  await closeApp();
  await closePools();
});

const linkVersion = async (id: string) => (await owner().query(`select version, status from evidence_link where id = $1`, [id])).rows[0] as { version: number; status: string };

async function cp(title: string) {
  const s = await ok(await j.p.pm.post(`${P(pid)}/signings`, { name: `${TAG} signing (synthetic)` }));
  const c = await ok(await j.p.pm.post(`${P(pid)}/closings`, { signingId: s.id, name: `${TAG} closing (synthetic)` }));
  return ok(await j.p.pm.post(`${P(pid)}/closing-conditions`, { closingId: c.id, title, ownerUserId: j.p.pm.userId, blocking: true }));
}

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-07 — every evidence status change applies the link authorization of its target', () => {
  it('incorporation evidence: Finance (no newco.incorporation.manage) cannot supersede it (403 evidence.target_permission); the link stays active', async () => {
    const ents = (await j.p.pm.get(`${P(pid)}/legal-entities`).expect(200)).body.items as { id: string }[];
    const link = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'legal_entity', targetId: ents[0]!.id, note: 'Registration extract (synthetic)' }));
    const r = await j.p.finance.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('evidence.target_permission');
    expect((await linkVersion(link.id)).status).toBe('active');
  });

  it('TSA evidence: Legal (no readiness.tsa.manage) cannot supersede it (403); the PM (TSA manager) can (201)', async () => {
    const t = await ok(await j.p.pm.post(`${P(pid)}/tsa-services`, { name: `${TAG} hosting TSA (synthetic)` }));
    const link = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'tsa_service', targetId: t.id, note: 'Replacement acceptance record (synthetic)' }));
    const r = await j.p.legal.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('evidence.target_permission');
    expect((await linkVersion(link.id)).status).toBe('active');
    const own = await ok(await j.p.pm.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: 1, note: 'Replaced by a newer record (synthetic)' }));
    expect(own.status).toBe('superseded');
  });

  it('gate-criterion evidence: a contributor (gates.evidence.attach, not the criterion owner role) can neither link nor supersede it (403); the project manager can', async () => {
    const g = await gateByKey(j.p.pm, pid, 'G1');
    const c = g.criteria.find((x) => !['project_manager', 'contributor', 'workstream_lead'].includes(x.ownerRole))!;
    expect(c, 'a criterion owned by a specialist role').toBeTruthy();
    const link = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'gate_criterion', targetId: c.id, note: 'Criterion evidence (synthetic)' }));
    expect((await j.p.contributor.post(`${P(pid)}/evidence`, { targetType: 'gate_criterion', targetId: c.id, note: 'probe' })).status).toBe(403);
    const r = await j.p.contributor.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: 1, note: 'probe (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect((await linkVersion(link.id)).status).toBe('active');
    expect((await ok(await j.p.pm.post(`${P(pid)}/evidence/${link.id}/supersede`, { expectedVersion: 1, note: 'Replaced (synthetic)' }))).status).toBe('superseded');
  });

  it('flag-conflict on transfer evidence: a contributor without carveout.transfer.manage is refused (403); both links stay active', async () => {
    const x = await ok(await j.p.pm.post(`${P(pid)}/perimeter-items`, { type: 'asset', name: `${TAG} rack (synthetic)`, disposition: 'included', classification: 'confidential' }));
    const a = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'transfer', targetId: x.id, note: 'Transfer record A (synthetic)' }));
    const b = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'transfer', targetId: x.id, note: 'Transfer record B (synthetic)' }));
    const r = await j.p.contributor.post(`${P(pid)}/evidence/${a.id}/flag-conflict`, { expectedVersion: 1, withLinkId: b.id, note: 'probe (synthetic)' });
    expect(r.status, JSON.stringify(r.body)).toBe(403);
    expect(r.body.code).toBe('evidence.target_permission');
    expect([(await linkVersion(a.id)).status, (await linkVersion(b.id)).status]).toEqual(['active', 'active']);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-03 — the uploader of a linked evidence version is "self" for the finance and governance verifications', () => {
  it('benefit realization: the Finance member who UPLOADED the evidence document the PM linked cannot verify it (403); an independent verifier can', async () => {
    const admin = await login('portfolio.admin');
    await ok(await admin.post(`${P(pid)}/members`, { userId: j.p.approver.userId, role: 'finance_restricted', reason: 'Second Finance verifier (synthetic test)' }));
    const b = await ok(await j.p.pm.post(`${P(pid)}/benefits`, { title: `${TAG} licence saving (synthetic)`, measurementDefinition: 'Licence cost vs baseline (synthetic definition)', ownerUserId: j.p.pm.userId }));
    const bpath = `${P(pid)}/benefits/${b.id}`;
    const ap = await ok(await j.p.finance.post(`${bpath}/approve`, { expectedVersion: 1 }));
    const tr = await ok(await j.p.pm.post(`${bpath}/start-tracking`, { expectedVersion: ap.version }));
    const rr = await ok(await j.p.pm.post(`${bpath}/record-realization`, { expectedVersion: tr.version, actualValue: 'Lower licence cost (synthetic)', realizedOn: today(), verificationSource: 'Licence invoice (synthetic)' }));
    const d = await doc(j.p.finance, pid, `${TAG} licence invoice uploaded by Finance (synthetic)`, { kind: 'report' });
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'benefit', targetId: b.id, documentId: d.id, note: 'Invoice linked by the PM (synthetic)' }));
    const self = await j.p.finance.post(`${bpath}/verify`, { expectedVersion: rr.version, note: 'Verified on the invoice I uploaded (test)' });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('finance.benefit.verify_self');
    const v = await ok(await j.p.approver.post(`${bpath}/verify`, { expectedVersion: rr.version, note: 'Checked against the invoice (synthetic)' }));
    expect(v.status).toBe('realized_verified');
  });

  it('action closure: the secretary who UPLOADED the evidence document the owner linked cannot verify the closure (403) and is not offered it in My Work; a second secretary can', async () => {
    const a = await ok(await j.p.secretary.post(`${P(pid)}/actions`, { title: `${TAG}-UPLOADER-ACT distribute the pack (synthetic)`, meetingId: j.gov.meetingId, ownerUserId: j.p.pm.userId, dueDate: plusDays(7) }));
    const d = await doc(j.p.secretary, pid, `${TAG} distribution list uploaded by the secretary (synthetic)`, { kind: 'report' });
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'action_item', targetId: a.id, documentId: d.id, note: 'Distribution list linked by the owner (synthetic)' }));
    const cur = (await j.p.pm.get(`${P(pid)}/actions/${a.id}`).expect(200)).body;
    await ok(await j.p.pm.post(`${P(pid)}/actions/${a.id}/report-done`, { expectedVersion: cur.version, closureEvidenceNote: 'Pack distributed (synthetic)' }));
    const done = (await j.p.pm.get(`${P(pid)}/actions/${a.id}`).expect(200)).body;
    const self = await j.p.secretary.post(`${P(pid)}/actions/${a.id}/verify-closure`, { expectedVersion: done.version });
    expect(self.status, JSON.stringify(self.body)).toBe(403);
    expect(self.body.code).toBe('governance.action.linker_verification');
    const mine = (await j.p.secretary.get('/api/v1/me/work').expect(200)).body.items as { type: string; entityId: string }[];
    expect(mine.some((i) => i.type === 'action_closure_verification' && i.entityId === a.id)).toBe(false);
    const cpmo2 = j.gov.secretary2 as unknown as DocClient; // a second secretariat member (ops.lead)
    await ok(await cpmo2.post(`${P(pid)}/actions/${a.id}/verify-closure`, { expectedVersion: done.version }));
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-09 — a CP with conflicting evidence is not verified (as readiness and NewCo verifications)', () => {
  it('CP verify while two of its evidence records conflict → 422 jv.cp.evidence_conflicting; the CP is unchanged', async () => {
    const c = await cp(`${TAG} conflicting evidence CP (synthetic)`);
    const a = await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Consent letter A (synthetic)' }));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Consent letter B contradicts A (synthetic)', conflictsWithLinkId: a.id, conflictNote: 'Different dates (synthetic)' }));
    await ok(await j.p.pm.post(`${P(pid)}/evidence`, { targetType: 'closing_condition', targetId: c.id, note: 'Board minute (synthetic)' }));
    const cur = (await j.p.pm.get(`${P(pid)}/closing-conditions/${c.id}`).expect(200)).body;
    const sub = await ok(await j.p.pm.post(`${P(pid)}/closing-conditions/${c.id}/submit-evidence`, { expectedVersion: cur.version }));
    const r = await j.p.approver.post(`${P(pid)}/closing-conditions/${c.id}/verify`, { expectedVersion: sub.version, outcome: 'verify' });
    expect(r.status, JSON.stringify(r.body)).toBe(422);
    expect(r.body.code).toBe('jv.cp.evidence_conflicting');
    expect((await owner().query(`select status from closing_condition where id = $1`, [c.id])).rows[0].status).toBe(sub.status);
  });
});

// ---------------------------------------------------------------------------------------------------------------------
describe('SEC-P34R-05 — AI proposals follow the visibility of what their run gave the model', () => {
  let proposalId: string;
  let draftId: string;
  let taskId: string;

  beforeAll(async () => {
    // A blocking CP without evidence: the PM's question about closing conditions carries it to the model (a closing-condition
    // detection; a question, not the briefing, so the context window is not filled by the project's other detections first).
    await cp(`${TAG}-CP-INPUT-CANARY merger clearance (synthetic)`);
    const { contexts, db, runtime, proposals, app } = await serviceHandles();
    const ctx = (await contexts.forUser(j.p.pm.userId, pid))!;
    const run = await db.run(ctx, () => runtime.ask(ctx, pid, { question: 'Which closing conditions are still open?', async: false }));
    expect(run.status).toBe('succeeded');
    // Owner pool (assertion of the setup): the run gave the model a closing condition.
    const snap = (await owner().query(`select evidence_snapshot from ai_run where id = $1`, [run.id])).rows[0].evidence_snapshot as { items: { type: string; sentToProvider: boolean }[]; delegate: { clearance: string } };
    expect(snap.items.some((i) => i.type === 'closing_condition' && i.sentToProvider)).toBe(true);
    expect(snap.delegate.clearance).toBe('confidential');
    const task = (await j.p.pm.get(`${P(pid)}/tasks?pageSize=1`).expect(200)).body.items[0] as { id: string };
    taskId = task.id;
    const s = await db.run(ctx, () => app.get(AiSettingsService).load(pid));
    const created = await db.run(ctx, () =>
      proposals.createFromTool(ctx, pid, { id: run.id, requestedBy: j.p.pm.userId }, aiToolByName('propose_internal_notification')!, {
        recipientUserId: j.p.legal.userId,
        targetType: 'task',
        targetId: task.id,
        title: `${TAG}-TASK-PROPOSAL reminder (synthetic)`,
        body: 'Please update the task (Simulated).',
      }, s),
    );
    expect('proposal' in created, JSON.stringify(created)).toBe(true);
    proposalId = (created as { proposal: { id: string } }).proposal.id;
    const draft = await db.run(ctx, () =>
      proposals.createFromTool(ctx, pid, { id: run.id, requestedBy: j.p.pm.userId }, aiToolByName('propose_decision_paper_draft')!, { title: `${TAG}-PM-DRAFT paper draft`, content: 'Synthetic draft (Simulated).' }, s),
    );
    expect('proposal' in draft, JSON.stringify(draft)).toBe(true);
    draftId = (draft as { proposal: { id: string } }).proposal.id;
  }, 300_000);

  it('a proposal about a task the secretary can read is still hidden from the secretary, whom the CP its run used is refused; Legal and the sponsor see it', async () => {
    // The target alone would not hide it: the secretary reads that task.
    await j.p.secretary.get(`${P(pid)}/tasks/${taskId}`).expect(200);
    const sec = (await j.p.secretary.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    expect(sec.items.map((x: { id: string }) => x.id)).not.toContain(proposalId);
    expect(JSON.stringify(sec)).not.toContain('TASK-PROPOSAL');
    for (const c of [j.p.legal, j.p.sponsor]) {
      const l = (await c.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
      expect(l.items.map((x: { id: string }) => x.id), c.persona).toContain(proposalId);
    }
  });

  it('a reader who may not see a proposal cannot act on it either: approve / reject answer 404 like an unknown id', async () => {
    const a = await j.p.secretary.post(`${P(pid)}/ai/proposals/${proposalId}/approve`, { expectedVersion: 1 });
    const u = await j.p.secretary.post(`${P(pid)}/ai/proposals/0192f0c0-0000-7000-8000-00000000fe11/approve`, { expectedVersion: 1 });
    expect(a.status).toBe(404);
    expect(u.status).toBe(404);
    expect(a.body.code).toBe(u.body.code);
    expect((await j.p.secretary.post(`${P(pid)}/ai/proposals/${proposalId}/reject`, { expectedVersion: 1, note: 'probe (synthetic)' })).status).toBe(404);
    expect((await owner().query(`select status from ai_proposal where id = $1`, [proposalId])).rows[0].status).toBe('proposed');
  });

  it('a free draft (no target) by the PM is shown to a reader cleared at least as high (the sponsor), not to one who cannot see its run inputs', async () => {
    const sp = (await j.p.sponsor.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    expect(sp.items.map((x: { id: string }) => x.id)).toContain(draftId);
    const sec = (await j.p.secretary.get(`${P(pid)}/ai/proposals?pageSize=100`).expect(200)).body;
    expect(sec.items.map((x: { id: string }) => x.id)).not.toContain(draftId);
  });
});
