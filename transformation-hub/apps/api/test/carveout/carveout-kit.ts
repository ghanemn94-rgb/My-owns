import { expect } from 'vitest';
import { Client, loginAs, owner } from '../helpers';
import { setupProject, Personas } from '../gates/gate-test-kit';

/**
 * Carve-out / NewCo test kit. Each spec creates its OWN DC project through the portfolio API (gates kit), so tests never
 * depend on the demo data or on each other. Evidence goes through the documents API, change requests and baselines
 * through the planning API, decisions through the governance API. The owner pool is used only for assertions and for
 * register rows of modules that are not part of this worktree (e.g. a readiness check at a site).
 */
export { Personas };

export async function carveoutProject(code: string) {
  return setupProject(code);
}

export const base = (pid: string) => `/api/v1/projects/${pid}`;

export async function ok<T = Record<string, unknown>>(req: Promise<{ status: number; body: unknown }>, status = 201): Promise<T> {
  const r = await req;
  expect(r.status, JSON.stringify(r.body)).toBe(status);
  return r.body as T;
}

export async function workstreamId(c: Client, pid: string, code: string): Promise<string> {
  const r = await c.get(`${base(pid)}/workstreams`).expect(200);
  return (r.body.items as { id: string; code: string }[]).find((w) => w.code === code)!.id;
}

export async function grantWorkstreamLead(pid: string, persona: string, wsCode: string) {
  const admin = await loginAs('portfolio.admin');
  const user = await loginAs(persona);
  const ws = await workstreamId(admin, pid, wsCode);
  await admin.post(`${base(pid)}/members`, { userId: user.userId, role: 'workstream_lead', workstreamId: ws, reason: 'carve-out test' }).expect(201);
  return loginAs(persona);
}

export async function newcoId(c: Client, pid: string): Promise<string> {
  const r = await c.get(`${base(pid)}/legal-entities`).expect(200);
  return (r.body.items as { id: string; role: string }[]).find((e) => e.role === 'newco')!.id;
}

export async function item(c: Client, pid: string, id: string) {
  return (await c.get(`${base(pid)}/perimeter-items/${id}`).expect(200)).body;
}

export async function createItem(c: Client, pid: string, body: Record<string, unknown>) {
  return ok<{ id: string; code: string; version: number; disposition: string; applied: boolean; changeRequest: { id: string; code: string; status: string; rebaseline: boolean } | null; impactAssessmentId: string | null }>(
    c.post(`${base(pid)}/perimeter-items`, body),
  );
}

/** Evidence through the DOCUMENTS module (it owns evidence_link writes). */
export async function linkEvidence(c: Client, pid: string, targetType: string, targetId: string, note = 'Test evidence note (synthetic)') {
  return ok<{ id: string; status: string }>(c.post(`${base(pid)}/evidence`, { targetType, targetId, note }));
}

/** Planning baseline v1: PM proposes, sponsor approves (separation of duties). */
export async function approveBaseline(p: Personas, pid: string) {
  const b = await ok<{ id: string; version: number }>(p.pm.post(`${base(pid)}/baselines`, { note: 'carve-out test baseline' }));
  await ok(p.sponsor.post(`${base(pid)}/baselines/${b.id}/approve`, { expectedVersion: b.version, note: 'approved (test)' }));
  return b.id;
}

/**
 * Change request through planning: review by the PM, approval by the sponsor (not the requester). DOM-P2-03: the budget
 * impact is quantified first ("0" — synthetic test assessment) so the delegated limit can be checked at approval.
 */
export async function approveChangeRequest(p: Personas, pid: string, crId: string) {
  let cr = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body;
  if (cr.status === 'submitted') cr = await ok(p.pm.post(`${base(pid)}/change-requests/${crId}/start-review`, { expectedVersion: cr.version }));
  cr = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body;
  if (!cr.costImpact) {
    await ok(p.pm.post(`${base(pid)}/change-requests/${crId}/assess`, { expectedVersion: cr.version, impacts: {}, costImpact: { amount: '0.0000', currency: 'SAR', unitScale: 1 }, note: 'Synthetic test assessment: no budget amount' }));
  }
  const v = (await p.pm.get(`${base(pid)}/change-requests/${crId}`).expect(200)).body.version;
  return ok(p.sponsor.post(`${base(pid)}/change-requests/${crId}/approve`, { expectedVersion: v, note: 'approved (test)' }));
}

export async function auditRows(projectId: string, action: string, outcome?: string) {
  const r = await owner().query(`select action, outcome, actor_user_id, reason from audit_event where project_id = $1 and action = $2 ${outcome ? 'and outcome = $3' : ''} order by seq`, outcome ? [projectId, action, outcome] : [projectId, action]);
  return r.rows as { action: string; outcome: string; actor_user_id: string; reason: string | null }[];
}

export async function deniedCount(actorUserId: string, outcome: 'denied' | 'rejected', actionLike: string) {
  const r = await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = $2 and action like $3`, [actorUserId, outcome, actionLike]);
  return r.rows[0].n as number;
}
