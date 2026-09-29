import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Pool } from 'pg';
import { createApp } from '../src/bootstrap';
import { DEMO_USERS, demoEmail } from '../src/cli/seed-demo';

let appPromise: Promise<INestApplication> | null = null;

/** One Nest app per test file (created lazily, closed in afterAll via closeApp). */
export async function getApp(): Promise<INestApplication> {
  appPromise ??= createApp({ logger: false }).then((r) => r.app);
  return appPromise;
}

export async function closeApp() {
  if (appPromise) {
    const app = await appPromise;
    await app.close();
    appPromise = null;
  }
}

export type PersonaKey = (typeof DEMO_USERS)[number]['key'];

export interface Client {
  persona: string;
  userId: string;
  get: (path: string) => request.Test;
  post: (path: string, body?: unknown) => request.Test;
  patch: (path: string, body?: unknown) => request.Test;
  /** Raw agent (cookies kept) for negative tests, e.g. no CSRF header. */
  agent: request.Agent;
}

export async function demoUserId(persona: string): Promise<string> {
  const app = await getApp();
  const res = await request(app.getHttpServer()).get('/api/v1/auth/demo-users').expect(200);
  const u = (res.body.items as { id: string; email: string }[]).find((x) => x.email === demoEmail(persona));
  if (!u) throw new Error(`persona ${persona} not found`);
  return u.id;
}

export async function loginAs(persona: string): Promise<Client> {
  const app = await getApp();
  const agent = request.agent(app.getHttpServer());
  const userId = await demoUserId(persona);
  const res = await agent.post('/api/v1/auth/demo-login').send({ userId }).expect(201);
  const csrf = res.body.csrfToken as string;
  return {
    persona,
    userId,
    agent,
    get: (path) => agent.get(path),
    post: (path, body = {}) => agent.post(path).set('x-csrf-token', csrf).send(body as object),
    patch: (path, body = {}) => agent.patch(path).set('x-csrf-token', csrf).send(body as object),
  };
}

export async function anonymous() {
  const app = await getApp();
  return request(app.getHttpServer());
}

/** Owner-role pool for assertions that need to bypass RLS (test-only). */
let ownerPool: Pool | null = null;
export function owner(): Pool {
  ownerPool ??= new Pool({ connectionString: process.env.DATABASE_MIGRATION_URL, max: 2 });
  return ownerPool;
}
/** Runtime-role pool (subject to RLS) for direct database isolation tests. */
let appPool: Pool | null = null;
export function runtimePool(): Pool {
  appPool ??= new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  return appPool;
}
export async function closePools() {
  await ownerPool?.end();
  await appPool?.end();
  ownerPool = null;
  appPool = null;
}

export async function projectIdByCode(code: string): Promise<string> {
  const r = await owner().query<{ id: string }>('select id from project where code = $1', [code]);
  if (!r.rows[0]) throw new Error(`project ${code} not found`);
  return r.rows[0].id;
}

export const DC = 'DEMO-DC';
export const GEN = 'DEMO-TRANSFORM';
