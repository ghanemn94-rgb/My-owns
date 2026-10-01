import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { closeApp, closePools, loginAs, owner, projectIdByCode, Client, GEN } from '../helpers';
import { createProject, grant, riyadhToday, task, workstreams } from '../planning/fixtures';
import { approvedNonDemoMatrix } from '../governance/gov-fixtures';

/**
 * REQ-PLN-019 (spec §9 measurement rule 4, review finding DOM-P2-08): RAG thresholds are configurable per project with a
 * proposed default from the template; a change is in force only once ANOTHER person approves it, and every calculated RAG
 * names the threshold version it used. The fixture gives workstream WS01 a forecast slip of 5 working days against an
 * approved baseline, with a fresh accepted update: amber under the template default (amber ≤ 10), green under thresholds
 * with green ≤ 5. All data is synthetic.
 */
let admin: Client;
let pm: Client;
let sponsor: Client;
let contributor: Client;
let secretary: Client;
let pid: string;
let updateId: string;
const today = riyadhToday();
const base = () => `/api/v1/projects/${pid}`;

type Rag = { status: string; explanation: string; explanationI18n: { code: string; params: Record<string, unknown> }[]; slipDays: number | null };
const ws01 = async () => {
  const h = (await pm.get(`${base()}/progress`).expect(200)).body as { thresholds: Record<string, number>; thresholdsRef: Record<string, unknown>; workstreams: { code: string; rag: { calculated: Rag } }[] };
  return { h, rag: h.workstreams.find((w) => w.code === 'WS01')!.rag.calculated };
};
const thresholds = async (c: Client = pm) => (await c.get(`${base()}/rag-thresholds`).expect(200)).body;

beforeAll(async () => {
  admin = await loginAs('portfolio.admin');
  pm = await loginAs('pm');
  sponsor = await loginAs('sponsor');
  contributor = await loginAs('contributor');
  secretary = await loginAs('secretary');
  const legal = await loginAs('legal');
  pid = await createProject(admin, pm, 'RAGT-P');
  await grant(admin, pid, sponsor, 'sponsor');
  await grant(pm, pid, contributor, 'contributor');
  await grant(pm, pid, secretary, 'secretary_cpmo');
  await grant(admin, pid, legal, 'legal_restricted');
  await approvedNonDemoMatrix(pid, { secretary, sponsor, legal });
  const ws = await workstreams(pm, pid);
  const t = await task(pm, pid, ws.get('WS01')!.id, 'RAG threshold test task (synthetic)', { durationDays: 5, plannedStart: '2026-10-04', plannedFinish: '2026-10-08' });
  const b = await pm.post(`${base()}/baselines`, {}).expect(201);
  await sponsor.post(`${base()}/baselines/${b.body.id}/approve`, { expectedVersion: 1 }).expect(201);
  // Forecast finish one working week after the baselined finish (Thursday → Thursday, Sun–Thu calendar): slip 5.
  const tv = (await pm.get(`${base()}/tasks/${t}`).expect(200)).body.version;
  const pr = await pm.post(`${base()}/tasks/${t}/progress`, { expectedVersion: tv, reportedProgress: 20, forecastFinish: '2026-10-15' });
  expect(pr.status, JSON.stringify(pr.body)).toBe(201);
  const u = await contributor.post(`${base()}/status-updates`, { workstreamId: ws.get('WS01')!.id, periodEnd: today, summary: 'Slipping by a week (synthetic)', ragReported: 'amber' }).expect(201);
  updateId = u.body.id;
  await contributor.post(`${base()}/status-updates/${updateId}/submit`, { expectedVersion: 1 }).expect(201);
  await secretary.post(`${base()}/status-updates/${updateId}/accept`, { expectedVersion: 2 }).expect(201);
});
afterAll(async () => {
  await closeApp();
  await closePools();
});

describe('REQ-PLN-019 — RAG thresholds: proposed defaults, approved changes only, explanation names the version [DOM-P2-08]', () => {
  it('without an approved project version the template default is in force, with an explanation for each status; every calculated RAG names it', async () => {
    const t = await thresholds();
    expect(t.inForce).toMatchObject({ thresholds: { greenMaxSlipDays: 0, amberMaxSlipDays: 10, staleAfterDays: 14 }, ref: { source: 'template_default', versionNo: null, templateVersionNo: 2 }, approvedAt: null });
    expect(t.templateDefault).toMatchObject({ templateKey: 'dc-carveout', templateVersionNo: 2, thresholds: { greenMaxSlipDays: 0, amberMaxSlipDays: 10, staleAfterDays: 14 } });
    expect(t.rules.map((r: { status: string }) => r.status)).toEqual(['green', 'amber', 'red', 'stale', 'unknown', 'not_updated']);
    expect(t.rules[1].explanationI18n).toEqual([{ code: 'plan.rag.rule.amber', params: { green: 0, amber: 10 } }]);
    expect(t.versions).toEqual([]);
    const { h, rag } = await ws01();
    expect(rag).toMatchObject({ status: 'amber', slipDays: 5 });
    expect(rag.explanationI18n).toEqual([
      { code: 'plan.rag.amber', params: { slip: 5, limit: 10 } },
      { code: 'plan.rag.thresholds_template_default', params: { templateVersion: 2 } },
    ]);
    expect(rag.explanation).toContain('Thresholds: proposed default of template version 2');
    expect(h.thresholdsRef).toEqual({ source: 'template_default', versionNo: null, templateVersionNo: 2 });
  });

  it('a proposal changes nothing until it is approved; only the project manager proposes; one proposal at a time', async () => {
    const denied = await contributor.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 14, reason: 'Not mine to change' });
    expect(denied.status).toBe(403);
    const p = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 14, reason: 'Steering tolerance for a one-week slip (synthetic)' });
    expect(p.status, JSON.stringify(p.body)).toBe(201);
    expect(p.body).toMatchObject({ versionNo: 1, state: 'pending', version: 1 });
    const again = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 4, amberMaxSlipDays: 8, staleAfterDays: 14, reason: 'second' });
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('config.rag_thresholds.proposal_pending');
    // Nothing changed: still the template default, still amber.
    const { rag } = await ws01();
    expect(rag.status).toBe('amber');
    expect(rag.explanationI18n[1]).toEqual({ code: 'plan.rag.thresholds_template_default', params: { templateVersion: 2 } });
    const t = await thresholds();
    expect(t.inForce.ref.source).toBe('template_default');
    expect(t.pendingId).toBe(p.body.id);
    expect(t.versions[0]).toMatchObject({ id: p.body.id, versionNo: 1, state: 'pending', thresholds: { greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 14 }, basedOn: { ref: { source: 'template_default' } }, proposedBy: pm.userId, decidedBy: null });
    // The proposal is an approval request bound to its payload; the audit names the project.
    const ar = await owner().query(`select status::text, action, required_permission, subject_type, subject_version from approval_request where id = $1`, [p.body.id]);
    expect(ar.rows[0]).toEqual({ status: 'pending', action: 'config.rag_thresholds.change', required_permission: 'config.project_settings.approve', subject_type: 'project', subject_version: 1 });
    const au = await owner().query(`select count(*)::int n from audit_event where project_id = $1 and action = 'config.rag_thresholds.propose' and outcome = 'success'`, [pid]);
    expect(au.rows[0].n).toBe(1);
  });

  it('the project manager cannot approve; nobody approves their own proposal (separation of duties, audited)', async () => {
    const t = await thresholds();
    const own = await pm.post(`${base()}/rag-thresholds/${t.pendingId}/approve`, { expectedVersion: 1 });
    expect(own.status).toBe(403);
    // A portfolio admin who is also this project's manager proposes; they cannot approve that proposal themselves.
    const other = await createProject(admin, pm, 'RAGT-SOD');
    // Test-only fixture: nobody may grant themselves a role (not_self), and no other demo persona may grant a project
    // manager role to a portfolio admin — the membership is written directly (the database still checks the user).
    await owner().query(
      `insert into project_membership (id, org_id, project_id, user_id, role, granted_by, reason) select gen_random_uuid(), org_id, id, $2, 'project_manager', $3, 'SoD probe fixture (test)' from project where id = $1`,
      [other, admin.userId, pm.userId],
    );
    const mine = await admin.post(`/api/v1/projects/${other}/rag-thresholds`, { greenMaxSlipDays: 1, amberMaxSlipDays: 4, staleAfterDays: 7, reason: 'Self-approval probe (synthetic)' }).expect(201);
    const self = await admin.post(`/api/v1/projects/${other}/rag-thresholds/${mine.body.id}/approve`, { expectedVersion: 1 });
    expect(self.status).toBe(403);
    expect(self.body.detail).toMatch(/Separation of duties/);
    const audit = await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = 'denied' and action = 'config.approveRagThresholds'`, [admin.userId]);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
    const still = await owner().query(`select status::text from approval_request where id = $1`, [mine.body.id]);
    expect(still.rows[0].status).toBe('pending');
  });

  it('approval by another person puts the version in force: the calculated RAG changes and its explanation cites the approved version', async () => {
    const t = await thresholds();
    const ok = await admin.post(`${base()}/rag-thresholds/${t.pendingId}/approve`, { expectedVersion: 1, note: 'Agreed tolerance (synthetic)' });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    expect(ok.body).toMatchObject({ versionNo: 1, state: 'approved', version: 2 });
    const { h, rag } = await ws01();
    expect(rag).toMatchObject({ status: 'green', slipDays: 5 });
    expect(rag.explanationI18n).toEqual([
      { code: 'plan.rag.green', params: { slip: 5 } },
      { code: 'plan.rag.thresholds_approved', params: { version: 1 } },
    ]);
    expect(rag.explanation).toBe('Forecast within tolerance (slip 5 working days). Thresholds: project version 1 (approved).');
    expect(h.thresholds).toEqual({ greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 14 });
    expect(h.thresholdsRef).toEqual({ source: 'approved', versionNo: 1, templateVersionNo: 2 });
    const after = await thresholds();
    expect(after.inForce).toMatchObject({ ref: { source: 'approved', versionNo: 1 }, approvedByName: 'Demo Portfolio Admin' });
    expect(after.inForce.approvedAt).not.toBeNull();
    expect(after.rules[0].explanationI18n).toEqual([{ code: 'plan.rag.rule.green', params: { green: 5, stale: 14 } }]);
    expect(after.versions[0]).toMatchObject({ state: 'approved', decidedBy: admin.userId, decisionNote: 'Agreed tolerance (synthetic)' });
    // The decision is an internal electronic approval bound to the payload hash.
    const rec = await owner().query(`select r.decision, r.method, r.payload_hash = q.payload_hash as bound from approval_record r join approval_request q on q.id = r.approval_request_id where q.id = $1`, [t.pendingId]);
    expect(rec.rows).toEqual([{ decision: 'approve', method: 'internal_electronic', bound: true }]);
    // Published history is preserved: the update accepted under the template default keeps its frozen amber.
    const frozen = (await pm.get(`${base()}/status-updates/${updateId}`).expect(200)).body;
    expect(frozen.ragCalculated).toBe('amber');
    expect(frozen.frozenSnapshot.rag.calculated.status).toBe('amber');
  });

  it('a stale decision is a 409; a rejection needs a reason and leaves the approved version in force; only the proposer withdraws', async () => {
    const p2 = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 0, amberMaxSlipDays: 3, staleAfterDays: 14, reason: 'Tighter tolerance (synthetic)' }).expect(201);
    expect(p2.body.versionNo).toBe(2);
    expect((await admin.post(`${base()}/rag-thresholds/${p2.body.id}/approve`, { expectedVersion: 7 })).status).toBe(409);
    expect((await admin.post(`${base()}/rag-thresholds/${p2.body.id}/reject`, { expectedVersion: 1 })).status).toBe(400);
    const rj = await admin.post(`${base()}/rag-thresholds/${p2.body.id}/reject`, { expectedVersion: 1, reason: 'Too tight for the current plan (synthetic)' });
    expect(rj.status, JSON.stringify(rj.body)).toBe(201);
    expect(rj.body.state).toBe('rejected');
    expect((await ws01()).rag.status).toBe('green');
    expect((await admin.post(`${base()}/rag-thresholds/${p2.body.id}/approve`, { expectedVersion: 2 })).body.code).toBe('rag_thresholds.invalid_transition');
    const p3 = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 2, amberMaxSlipDays: 8, staleAfterDays: 14, reason: 'Another idea (synthetic)' }).expect(201);
    expect((await sponsor.post(`${base()}/rag-thresholds/${p3.body.id}/withdraw`, { expectedVersion: 1 })).status).toBe(403);
    const wd = await pm.post(`${base()}/rag-thresholds/${p3.body.id}/withdraw`, { expectedVersion: 1, note: 'Not needed' });
    expect(wd.status, JSON.stringify(wd.body)).toBe(201);
    const t = await thresholds();
    expect(t.versions.map((v: { versionNo: number; state: string }) => [v.versionNo, v.state])).toEqual([
      [3, 'withdrawn'],
      [2, 'rejected'],
      [1, 'approved'],
    ]);
    expect(t.inForce.ref).toMatchObject({ source: 'approved', versionNo: 1 });
  });

  it('a new approved version supersedes the previous one', async () => {
    const p4 = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 2, amberMaxSlipDays: 4, staleAfterDays: 21, reason: 'Revised tolerance (synthetic)' }).expect(201);
    await admin.post(`${base()}/rag-thresholds/${p4.body.id}/approve`, { expectedVersion: 1 }).expect(201);
    const { rag } = await ws01();
    expect(rag.status).toBe('red'); // slip 5 > amber 4
    expect(rag.explanationI18n).toEqual([
      { code: 'plan.rag.red', params: { slip: 5, limit: 4 } },
      { code: 'plan.rag.thresholds_approved', params: { version: 4 } },
    ]);
    const t = await thresholds();
    expect(t.versions.find((v: { versionNo: number }) => v.versionNo === 1).state).toBe('superseded');
    expect(t.versions.find((v: { versionNo: number }) => v.versionNo === 4).state).toBe('approved');
  });

  it('invalid threshold sets are refused (order, bounds, unchanged) and nothing is recorded', async () => {
    const order = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 6, amberMaxSlipDays: 5, staleAfterDays: 14, reason: 'x' });
    expect(order.status).toBe(422);
    expect(order.body.code).toBe('config.rag_thresholds.amber_below_green');
    expect((await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 0, amberMaxSlipDays: 5, staleAfterDays: 0, reason: 'x' })).status).toBe(400);
    expect((await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 0, amberMaxSlipDays: 5, staleAfterDays: 14 })).status).toBe(400); // reason required
    const same = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 2, amberMaxSlipDays: 4, staleAfterDays: 21, reason: 'same' });
    expect(same.status).toBe(422);
    expect(same.body.code).toBe('config.rag_thresholds.unchanged');
    expect((await thresholds()).pendingId).toBeNull();
  });

  it('isolation: another project’s manager gets 404; a request of another project is 404 under this project', async () => {
    const pmB = await loginAs('pm.b');
    expect((await pmB.get(`${base()}/rag-thresholds`)).status).toBe(404);
    expect((await pmB.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 1, amberMaxSlipDays: 2, staleAfterDays: 14, reason: 'probe' })).status).toBe(404);
    const gen = await projectIdByCode(GEN);
    const other = await thresholds();
    const id = other.versions[0].id;
    expect((await admin.post(`/api/v1/projects/${gen}/rag-thresholds/${id}/approve`, { expectedVersion: 1 })).status).toBe(404);
  });

  it('a freshness window change applies to the stale rule and its explanation', async () => {
    const p = await pm.post(`${base()}/rag-thresholds`, { greenMaxSlipDays: 5, amberMaxSlipDays: 8, staleAfterDays: 1, reason: 'Daily updates expected (synthetic)' }).expect(201);
    await admin.post(`${base()}/rag-thresholds/${p.body.id}/approve`, { expectedVersion: 1 }).expect(201);
    // The accepted update's period ended today: still fresh under a one-day window (green ≤ 5); the explanation names version 5.
    const { rag } = await ws01();
    expect(rag.status).toBe('green');
    expect(rag.explanationI18n.at(-1)).toEqual({ code: 'plan.rag.thresholds_approved', params: { version: 5 } });
    const t = await thresholds();
    expect(t.rules.find((r: { status: string }) => r.status === 'stale').explanationI18n).toEqual([{ code: 'plan.rag.rule.stale', params: { stale: 1 } }]);
  });
});
