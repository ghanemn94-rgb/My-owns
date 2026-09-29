import { expect } from 'vitest';
import { Client, owner } from '../helpers';

/** Planning test fixtures: isolated projects so tests never depend on each other's plan edits. */

export async function dcTemplateId(admin: Client): Promise<string> {
  const templates = (await admin.get('/api/v1/templates').expect(200)).body.items as { id: string; templateKey: string }[];
  return templates.find((t) => t.templateKey === 'dc-carveout')!.id;
}

/** Creates an internal-classification DC project whose PM is `pm`; planned start Sunday 2026-10-04. */
export async function createProject(admin: Client, pm: Client, code: string, plannedStart: string | null = '2026-10-04'): Promise<string> {
  const r = await admin
    .post('/api/v1/projects', {
      templateVersionId: await dcTemplateId(admin),
      code,
      name: `${code} planning test project`,
      classification: 'internal',
      ...(plannedStart ? { plannedStart } : {}),
      projectManagerUserId: pm.userId,
    })
    .expect(201);
  return r.body.id as string;
}

export async function grant(granter: Client, projectId: string, user: Client, role: string, workstreamId?: string) {
  await granter.post(`/api/v1/projects/${projectId}/members`, { userId: user.userId, role, reason: 'planning test fixture', ...(workstreamId ? { workstreamId } : {}) }).expect(201);
}

export async function workstreams(c: Client, projectId: string): Promise<Map<string, { id: string; version: number }>> {
  const r = await c.get(`/api/v1/projects/${projectId}/workstreams`).expect(200);
  return new Map((r.body.items as { code: string; id: string; version: number }[]).map((w) => [w.code, { id: w.id, version: w.version }]));
}

/** Creates a confirmed (Not started) task and returns its id. */
export async function task(pm: Client, projectId: string, workstreamId: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await pm.post(`/api/v1/projects/${projectId}/tasks`, { workstreamId, title, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

export async function milestone(pm: Client, projectId: string, workstreamId: string, title: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await pm.post(`/api/v1/projects/${projectId}/milestones`, { workstreamId, title, ...extra });
  expect(r.status, JSON.stringify(r.body)).toBe(201);
  return r.body.id as string;
}

export async function dep(pm: Client, projectId: string, pred: { id: string; type?: 'task' | 'milestone' }, succ: { id: string; type?: 'task' | 'milestone' }, extra: Record<string, unknown> = {}) {
  return pm.post(`/api/v1/projects/${projectId}/dependencies`, { predecessorType: pred.type ?? 'task', predecessorId: pred.id, successorType: succ.type ?? 'task', successorId: succ.id, ...extra });
}

export async function version(c: Client, path: string): Promise<number> {
  return (await c.get(path).expect(200)).body.version as number;
}

/**
 * Test-only: link active evidence to a record directly in the database (the documents module owns evidence writes;
 * planning only reads counts). The polymorphic trigger still enforces the same-project rule.
 */
export async function addEvidence(projectId: string, targetType: string, targetId: string, addedBy: string, status: 'active' | 'conflicting' = 'active') {
  const org = await owner().query('select org_id from project where id = $1', [projectId]);
  await owner().query(`insert into evidence_link (org_id, project_id, target_type, target_id, note, status, added_by) values ($1, $2, $3, $4, 'test evidence', $5, $6)`, [
    org.rows[0].org_id,
    projectId,
    targetType,
    targetId,
    status,
    addedBy,
  ]);
}

export async function auditCount(actorUserId: string, outcome: 'denied' | 'rejected', actionLike: string): Promise<number> {
  const r = await owner().query(`select count(*)::int n from audit_event where actor_user_id = $1 and outcome = $2 and action like $3`, [actorUserId, outcome, actionLike]);
  return r.rows[0].n as number;
}

/** "Today" in Asia/Riyadh as YYYY-MM-DD. */
export function riyadhToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export function addDays(d: string, n: number): string {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}
