import { expect } from 'vitest';
import { getApp, loginAs, owner, demoUserId, Client } from '../helpers';
import { WorkerService } from '../../src/platform/jobs/worker.service';
import { JobRegistry } from '../../src/platform/jobs/job-registry';
import { registerGatesJobs } from '../../src/modules/gates/gates.jobs';

/**
 * Test kit for the gates acceptance tests. Each spec creates its OWN DC project through the portfolio API (isolated from
 * the demo data and other specs) and grants the demo personas their usual roles in it.
 *
 * NOTE: the governance and documents modules are not implemented in this worktree, so governance decisions and evidence
 * links are inserted with the OWNER pool (test-only), exactly as those modules would store them. Everything the gates
 * module does is exercised through its HTTP API.
 */

export interface Personas {
  pm: Client;
  sponsor: Client;
  chair: Client;
  secretary: Client;
  legal: Client;
  finance: Client;
  approver: Client;
  contributor: Client;
}

export interface GateView {
  id: string;
  key: string;
  assessment: { id: string; cycle: number; status: string; version: number; decisionId: string | null; decidedBy: string | null; decidedAt: string | null; reassessment: { needsReassessment: boolean; criteria: { key: string }[]; escalationId: string | null; upstreamGateKeys: string[] } };
  evaluation: { ready: boolean; hasWaivers: boolean; blockers: { kind: string; ref: string; message: string }[]; counts: Record<string, number> };
  blockers: { kind: string; ref: string; message: string }[];
  rag: string;
  history: { id: string; cycle: number; status: string }[];
  criteria: {
    id: string;
    key: string;
    mandatory: boolean;
    blocking: boolean;
    waivable: boolean;
    version: number;
    reviewerRole: string;
    evidence: { active: number; conflicting: number };
    assessment: { id: string; status: string; version: number; waiverId: string | null; notApplicable: { approved: boolean } };
  }[];
  cycles: { id: string; cycle: number; status: string; isCurrent: boolean; criteria: { key: string; status: string }[] }[];
  decisions: { id: string; status: string }[];
}

const ROLE_GRANTS: [keyof Personas, string[]][] = [
  ['sponsor', ['sponsor']],
  ['chair', ['committee_chair']],
  ['secretary', ['secretary_cpmo']],
  ['legal', ['legal_restricted', 'functional_approver']],
  ['finance', ['finance_restricted', 'functional_approver']],
  ['approver', ['functional_approver']],
  ['contributor', ['contributor']],
];

export async function setupProject(code: string, extraGrants: [string, string][] = []): Promise<{ projectId: string; orgId: string; p: Personas }> {
  const admin = await loginAs('portfolio.admin');
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  const dc = templates.find((t) => t.templateKey === 'dc-carveout')!;
  const pmId = await demoUserId('pm');
  const created = await admin
    .post('/api/v1/projects', {
      templateVersionId: dc.id,
      code,
      name: `${code} — gates test project`,
      projectManagerUserId: pmId,
      newco: { mode: 'new', name: `${code} NewCo (test entity)`, incorporationStatus: 'unconfirmed' },
    })
    .expect(201);
  const projectId = created.body.id as string;
  for (const [persona, roles] of ROLE_GRANTS) {
    const userId = await demoUserId(persona);
    for (const role of roles) await admin.post(`/api/v1/projects/${projectId}/members`, { userId, role, reason: 'gates test' }).expect(201);
  }
  for (const [persona, role] of extraGrants) {
    await admin.post(`/api/v1/projects/${projectId}/members`, { userId: await demoUserId(persona), role, reason: 'gates test (extra role)' }).expect(201);
  }
  const org = await owner().query<{ org_id: string }>('select org_id from project where id = $1', [projectId]);
  const p = {} as Personas;
  for (const k of ['pm', 'sponsor', 'chair', 'secretary', 'legal', 'finance', 'approver', 'contributor'] as const) p[k] = await loginAs(k);
  return { projectId, orgId: org.rows[0]!.org_id, p };
}

export async function gateByKey(c: Client, projectId: string, key: string): Promise<GateView> {
  const list = (await c.get(`/api/v1/projects/${projectId}/gates`).expect(200)).body.items as { id: string; key: string }[];
  const g = list.find((x) => x.key === key)!;
  return (await c.get(`/api/v1/projects/${projectId}/gates/${g.id}`).expect(200)).body as GateView;
}

export function crit(g: GateView, key: string) {
  const c = g.criteria.find((x) => x.key === key);
  if (!c) throw new Error(`criterion ${key} not found`);
  return c;
}

/** Evidence link as the documents module would store it (owner pool — documents API not in this worktree). */
export async function addEvidence(orgId: string, projectId: string, criterionId: string, addedByUserId: string, status: 'active' | 'conflicting' = 'active'): Promise<string> {
  const r = await owner().query<{ id: string }>(
    `insert into evidence_link (id, org_id, project_id, target_type, target_id, note, status, added_by)
     values (gen_random_uuid(), $1, $2, 'gate_criterion', $3, 'Test evidence note (synthetic)', $4, $5) returning id`,
    [orgId, projectId, criterionId, status, addedByUserId],
  );
  return r.rows[0]!.id;
}

let committeeByProject = new Map<string, string>();
/** Governance decision row as the governance module would store it (owner pool — governance API not in this worktree). */
export async function insertDecision(
  orgId: string,
  projectId: string,
  d: { code: string; status: string; authorityOutcome: string; gateKey?: string | null; externalRef?: string | null },
): Promise<string> {
  let committeeId = committeeByProject.get(projectId);
  if (!committeeId) {
    const c = await owner().query<{ id: string }>(
      `insert into committee (id, org_id, project_id, kind, name) values (gen_random_uuid(), $1, $2, 'program_steering', 'Test steering committee (synthetic)') returning id`,
      [orgId, projectId],
    );
    committeeId = c.rows[0]!.id;
    committeeByProject.set(projectId, committeeId);
  }
  const r = await owner().query<{ id: string }>(
    `insert into decision (id, org_id, project_id, committee_id, code, title, status, authority_outcome, gate_key, external_authority_reference)
     values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [orgId, projectId, committeeId, d.code, `Test decision ${d.code} (synthetic)`, d.status, d.authorityOutcome, d.gateKey ?? null, d.externalRef ?? null],
  );
  return r.rows[0]!.id;
}
export function resetCommitteeCache() {
  committeeByProject = new Map();
}

export async function startGate(p: Personas, projectId: string, key: string) {
  const g = await gateByKey(p.pm, projectId, key);
  if (g.assessment.status === 'not_started' || g.assessment.status === 'reopened') {
    await p.pm.post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/start`, { expectedVersion: g.assessment.version }).expect(201);
  }
}

/** PM links evidence; Legal (a different person) reviews it as met. */
export async function meetCriterion(p: Personas, orgId: string, projectId: string, gateKey: string, critKey: string) {
  const g = await gateByKey(p.pm, projectId, gateKey);
  const c = crit(g, critKey);
  if (c.evidence.active === 0) await addEvidence(orgId, projectId, c.id, p.pm.userId);
  const res = await p.legal.post(`/api/v1/projects/${projectId}/gates/${g.id}/criteria/${c.id}/review`, { expectedVersion: c.assessment.version, outcome: 'met', note: 'test review' });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
}

export async function meetAllMandatory(p: Personas, orgId: string, projectId: string, gateKey: string, except: string[] = []) {
  const g = await gateByKey(p.pm, projectId, gateKey);
  for (const c of g.criteria) if (c.mandatory && !except.includes(c.key) && c.assessment.status !== 'met') await meetCriterion(p, orgId, projectId, gateKey, c.key);
}

export async function markReady(p: Personas, projectId: string, key: string) {
  const g = await gateByKey(p.pm, projectId, key);
  const r = await p.pm.post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/mark-ready`, { expectedVersion: g.assessment.version });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body;
}

/** Start, meet all mandatory criteria and mark ready. */
export async function makeReady(p: Personas, orgId: string, projectId: string, key: string) {
  await startGate(p, projectId, key);
  await meetAllMandatory(p, orgId, projectId, key);
  return markReady(p, projectId, key);
}

/** Approve a ready gate with a fresh approved-within-mandate decision (approver = sponsor for G0, chair otherwise). */
export async function approveGate(p: Personas, orgId: string, projectId: string, key: string, code: string) {
  const decisionId = await insertDecision(orgId, projectId, { code, status: 'approved', authorityOutcome: 'within_mandate', gateKey: key });
  const g = await gateByKey(p.pm, projectId, key);
  const approver = key === 'G0' ? p.sponsor : p.chair;
  const r = await approver.post(`/api/v1/projects/${projectId}/gates/${g.id}/assessment/decide`, { expectedVersion: g.assessment.version, outcome: 'approve', decisionId, note: 'test approval' });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return { decisionId, result: r.body };
}

let jobsRegistered = false;
/** Run the worker exactly as production does: outbox → subscribed jobs → handlers (gates handlers registered). */
export async function runWorker(rounds = 3) {
  const app = await getApp();
  if (!jobsRegistered && !app.get(JobRegistry).handler('gates.recompute_dimensions')) {
    registerGatesJobs(app);
  }
  jobsRegistered = true;
  const worker = app.get(WorkerService);
  for (let i = 0; i < rounds; i++) {
    const r = await worker.tick();
    if (r.dispatched === 0 && r.executed === 0) break;
  }
}
export function resetWorkerFlag() {
  jobsRegistered = false;
}
