import { expect } from 'vitest';
import { Client, demoUserId, getApp, loginAs, owner } from '../helpers';
import { Clock } from '../../src/platform/clock';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerJobHandlers } from '../../src/jobs';
import { setupGovernance, setupProject, Gov, Personas } from '../gates/gate-test-kit';
import { decisionVersion, plusDays, tabledDecision, today, vote, Actors } from '../governance/gov-fixtures';

/**
 * Test kit for the readiness / cutover / TSA module. Each spec creates its OWN DC project through the portfolio API
 * (gate-test-kit.setupProject) and real governance decisions through the governance API. The owner pool is used only for:
 *  - sites (no site API exists yet — portfolio-owned),
 *  - evidence on a cutover plan (`cutover_plan` is not yet an evidence target of the documents API — lead request),
 *  - the scheduled_job due time (infrastructure table) and assertions.
 */
export { setupProject, setupGovernance, plusDays, today };
export type { Personas, Gov };

export const P = (pid: string) => `/api/v1/projects/${pid}`;

export async function orgOf(projectId: string): Promise<string> {
  return (await owner().query<{ org_id: string }>('select org_id from project where id = $1', [projectId])).rows[0]!.org_id;
}

/** A synthetic site (owner pool — the portfolio module exposes no site API yet). */
export async function insertSite(projectId: string, code: string): Promise<string> {
  const orgId = await orgOf(projectId);
  const r = await owner().query<{ id: string }>(`insert into site (id, org_id, project_id, code, name, is_demo) values (gen_random_uuid(), $1, $2, $3, $4, true) returning id`, [
    orgId,
    projectId,
    code,
    `Test site ${code} (synthetic)`,
  ]);
  return r.rows[0]!.id;
}

export async function workstreamId(c: Client, projectId: string, code: string): Promise<string> {
  const items = (await c.get(`${P(projectId)}/workstreams`).expect(200)).body.items as { id: string; code: string }[];
  const w = items.find((x) => x.code === code);
  if (!w) throw new Error(`workstream ${code} not found`);
  return w.id;
}

/** Grant a WORKSTREAM-scoped role (no project role) through the portfolio API. */
export async function grantWorkstreamRole(projectId: string, persona: string, role: string, wsId: string) {
  const admin = await loginAs('portfolio.admin');
  const r = await admin.post(`${P(projectId)}/members`, { userId: await demoUserId(persona), role, workstreamId: wsId, reason: 'readiness test (workstream role)' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
}

/**
 * Governance decision through the real governance API (DEMO matrix): draft → submit → review → votes → outcome. The paper
 * carries the synthetic default amount (100 000 SAR, below the DEMO TSA limit), so it ends `approved` within mandate;
 * with vote=false it stays `under_review`.
 */
export async function decisionOfType(projectId: string, p: Personas, gov: Gov, decisionTypeKey: 'day1_go_no_go' | 'tsa_approval_or_extension' | 'change_request_budget', opts: { vote?: boolean } = {}) {
  const a = p as unknown as Actors;
  const d = await tabledDecision(projectId, a, p.pm, gov.committeeId, gov.meetingId, { decisionTypeKey, requiredAuthority: 'Per the DEMO authority matrix (synthetic)' });
  if (opts.vote === false) return { id: d.id, code: d.code, status: 'under_review' };
  const v = await decisionVersion(p.chair, projectId, d.id);
  for (const k of ['chair', 'sponsor', 'finance', 'legal'] as const) {
    const r = await vote(projectId, p[k], d.id, 'approve', v);
    expect(r.status, JSON.stringify(r.body)).toBe(201);
  }
  const out = await p.secretary.post(`${P(projectId)}/decisions/${d.id}/record-outcome`, { expectedVersion: v });
  expect(out.status, JSON.stringify(out.body)).toBe(201);
  expect(out.body.status).toBe('approved');
  return { id: d.id, code: d.code, status: out.body.status as string };
}

/** Evidence through the DOCUMENTS module API (it owns evidence_link writes). */
export async function addEvidence(c: Client, projectId: string, targetType: 'readiness_check' | 'tsa_service', targetId: string, note = 'Synthetic acceptance evidence (test)') {
  const r = await c.post(`${P(projectId)}/evidence`, { targetType, targetId, note });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

/** Evidence on a cutover plan — owner pool, because `cutover_plan` is not an evidence target of the documents API yet. */
export async function addPlanEvidenceViaOwner(projectId: string, planId: string, addedBy: string) {
  const orgId = await orgOf(projectId);
  await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, added_by) values ($1, $2, 'cutover_plan', $3, 'Synthetic post-transition acceptance evidence (test)', $4)`, [orgId, projectId, planId, addedBy]);
}

export async function check(c: Client, projectId: string, id: string) {
  return (await c.get(`${P(projectId)}/readiness-checks/${id}`).expect(200)).body;
}
export async function plan(c: Client, projectId: string, id: string) {
  return (await c.get(`${P(projectId)}/cutover-plans/${id}`).expect(200)).body;
}
export async function tsa(c: Client, projectId: string, id: string) {
  return (await c.get(`${P(projectId)}/tsa-services/${id}`).expect(200)).body;
}

export async function createCheck(c: Client, projectId: string, body: Record<string, unknown>): Promise<string> {
  const r = await c.post(`${P(projectId)}/readiness-checks`, body);
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

/** A complete §7.4 plan (runbook, window, impact, owner, rollback + contingency, rehearsal, communications). */
export async function completePlan(c: Client, projectId: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await c.post(`${P(projectId)}/cutover-plans`, {
    title: 'Test transition (synthetic)',
    runbookSummary: 'Step-by-step runbook v1 (synthetic)',
    windowStart: `${plusDays(20)}T20:00:00Z`,
    windowEnd: `${plusDays(21)}T02:00:00Z`,
    serviceImpact: 'No customer impact expected (synthetic assessment)',
    contingencyPlan: 'Contingency runbook: keep the current NOC in service (synthetic)',
    rollbackPlan: 'Rollback: revert routing to the current NOC within 30 minutes (synthetic)',
    ...extra,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  const id = r.body.id as string;
  let v = r.body.version as number;
  const reh = await c.post(`${P(projectId)}/cutover-plans/${id}/rehearsal`, { expectedVersion: v, testingSummary: 'Rehearsal executed; timings within the window (synthetic)' });
  expect(reh.status, JSON.stringify(reh.body)).toBe(201);
  v = reh.body.version;
  const com = await c.post(`${P(projectId)}/cutover-plans/${id}/communications-approval`, { expectedVersion: v, approvalReference: 'COMMS-APPROVAL-TEST (synthetic)' });
  expect(com.status, JSON.stringify(com.body)).toBe(201);
  return id;
}

/** Record a passing test, link evidence and have a (different) specialist sign the check off. */
export async function clearCheck(p: Personas, projectId: string, checkId: string, specialist: Client = p.approver) {
  let c = await check(p.pm, projectId, checkId);
  const t = await p.pm.post(`${P(projectId)}/readiness-checks/${checkId}/test-runs`, { expectedVersion: c.version, result: 'passed', note: 'Re-test passed (synthetic)' });
  expect(t.status, JSON.stringify(t.body)).toBe(201);
  if (c.evidence.active === 0) await addEvidence(p.pm, projectId, 'readiness_check', checkId);
  c = await check(p.pm, projectId, checkId);
  const s = await specialist.post(`${P(projectId)}/readiness-checks/${checkId}/sign-off`, { expectedVersion: c.version, outcome: 'passed', note: 'Specialist sign-off on synthetic evidence' });
  expect(s.status, JSON.stringify(s.body)).toBe(201);
}

/** The app's injectable clock — tests move "today" to simulate time passing (always reset in finally/afterAll). */
export async function clock(): Promise<Clock> {
  return (await getApp()).get(Clock);
}

/** Make the project's TSA expiry schedule due and run the worker exactly as production does (schedule → job). */
export async function runExpirySchedule(projectId: string) {
  const app = await getApp();
  if (!app.get(JobRegistry).handler('readiness.tsa_expiry_scan')) registerJobHandlers(app);
  const s = await owner().query(`update scheduled_job set next_run_at = now() - interval '1 second' where project_id = $1 and kind = 'readiness.tsa_expiry_scan' returning id`, [projectId]);
  expect(s.rowCount, 'TSA expiry schedule exists for the project').toBe(1);
  const worker = app.get(WorkerService);
  expect(await worker.enqueueDueSchedules()).toBeGreaterThanOrEqual(1);
  for (let i = 0; i < 20; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    if (d === 0 && e === 0) break;
  }
  const job = await owner().query<{ status: string; result: Record<string, number>; last_error: string | null }>(
    `select status, result, last_error from job where project_id = $1 and kind = 'readiness.tsa_expiry_scan' order by created_at desc limit 1`,
    [projectId],
  );
  expect(job.rows[0]?.status, job.rows[0]?.last_error ?? '').toBe('succeeded');
  return job.rows[0]!.result;
}

export async function drainWorker() {
  const app = await getApp();
  if (!app.get(JobRegistry).handler('readiness.tsa_expiry_scan')) registerJobHandlers(app);
  const worker = app.get(WorkerService);
  for (let i = 0; i < 20; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(50);
    if (d === 0 && e === 0) break;
  }
}
