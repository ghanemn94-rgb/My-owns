import request from 'supertest';
import { getApp, owner, projectIdByCode, DC, type Client } from '../helpers';
import { registerJobHandlers } from '../../src/jobs';
import { WorkerService } from '../../src/platform/jobs/worker.service';

export const RP = (pid: string, path = '') => `/api/v1/projects/${pid}${path}`;

export async function orgOf(pid: string): Promise<string> {
  return (await owner().query<{ org_id: string }>('select org_id from project where id = $1', [pid])).rows[0]!.org_id;
}

/** Login as any active user id (fixture users created by these tests). */
export async function loginUserId(userId: string): Promise<Client> {
  const app = await getApp();
  const agent = request.agent(app.getHttpServer());
  const res = await agent.post('/api/v1/auth/demo-login').send({ userId }).expect(201);
  const csrf = res.body.csrfToken as string;
  return {
    persona: userId,
    userId,
    agent,
    get: (path) => agent.get(path),
    post: (path, body = {}) => agent.post(path).set('x-csrf-token', csrf).send(body as object),
    patch: (path, body = {}) => agent.patch(path).set('x-csrf-token', csrf).send(body as object),
  };
}

/**
 * A real synthetic (is_demo) user for reporting tests with the given memberships — so a test can revoke or change its
 * access without touching the shared demo personas. Idempotent per key.
 */
export async function reportUser(key: string, clearance: string, memberships: { role: string; workstreamCode?: string }[], projectCode = DC): Promise<string> {
  const pid = await projectIdByCode(projectCode);
  const orgId = await orgOf(pid);
  const email = `demo.rpt-${key}@demo.invalid`;
  let id = (await owner().query<{ id: string }>('select id from app_user where org_id = $1 and email = $2', [orgId, email])).rows[0]?.id;
  if (!id) {
    id = (await owner().query<{ id: string }>(`insert into app_user (org_id, email, display_name, title, clearance, is_demo, locale) values ($1,$2,$3,'Reporting test persona (synthetic)',$4,true,'en') returning id`, [orgId, email, `Demo report ${key}`, clearance])).rows[0]!.id;
    for (const m of memberships) {
      const ws = m.workstreamCode ? (await owner().query<{ id: string }>('select id from workstream where project_id = $1 and code = $2', [pid, m.workstreamCode])).rows[0]!.id : null;
      await owner().query(`insert into project_membership (org_id, project_id, user_id, role, workstream_id, reason) values ($1,$2,$3,$4,$5,'Reporting test fixture')`, [orgId, pid, id, m.role, ws]);
    }
  }
  return id;
}

/** Revoke every membership of a fixture user in a project (as the DB owner — the API route is tested elsewhere). */
export async function revokeMemberships(userId: string, pid: string) {
  await owner().query('update project_membership set revoked_at = now() where user_id = $1 and project_id = $2 and revoked_at is null', [userId, pid]);
}

/** Drive the worker deterministically (outbox dispatch + jobs) until idle. */
export async function drain(): Promise<number> {
  const app = await getApp();
  registerJobHandlers(app);
  const worker = app.get(WorkerService);
  let executed = 0;
  for (let i = 0; i < 30; i++) {
    const d = await worker.dispatchOutbox(500);
    const e = await worker.runJobs(20);
    executed += e;
    if (d === 0 && e === 0) break;
  }
  return executed;
}

export async function generate(c: Client, pid: string, body: Record<string, unknown>, status = 201) {
  const r = await c.post(RP(pid, '/report-snapshots'), body);
  if (r.status !== status) throw new Error(`generate ${JSON.stringify(body)} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
