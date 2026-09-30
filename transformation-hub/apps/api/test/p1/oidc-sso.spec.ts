import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from '../../src/bootstrap';
import { loadConfig } from '../../src/platform/config';
import { closePools, demoUserId, owner } from '../helpers';
import { demoEmail } from '../../src/cli/seed-demo';
import { FakeOidcIdp, type FakeIdpUser } from '../support/fake-oidc-idp';

/**
 * REQ-ARC-006 / ADR-0005 — enterprise SSO via OIDC Authorization Code + PKCE against an in-process test IdP.
 * The API's real openid-client code path performs discovery, PKCE, state and nonce checks and ID-token validation.
 * Users are never auto-provisioned: the identity must map to an active, pre-provisioned, non-demo user.
 */
const CLIENT_ID = 'hub-test-client';
const CLIENT_SECRET = 'test-secret-not-used-anywhere-else';
const REDIRECT = 'http://hub.test.invalid/api/v1/auth/oidc/callback';
const OIDC_ENV = ['HUB_OIDC_ISSUER', 'HUB_OIDC_CLIENT_ID', 'HUB_OIDC_CLIENT_SECRET', 'HUB_OIDC_REDIRECT_URI', 'HUB_COOKIE_SECRET', 'HUB_OIDC_LINK_BY_EMAIL'] as const;

const idp = new FakeOidcIdp(CLIENT_ID, CLIENT_SECRET);
let strictApp: INestApplication; // link by email OFF (default)
let linkApp: INestApplication; // link by email ON
let orgId: string;
const saved: Record<string, string | undefined> = {};

async function buildApp(linkByEmail: boolean) {
  process.env.HUB_OIDC_ISSUER = idp.issuer;
  process.env.HUB_OIDC_CLIENT_ID = CLIENT_ID;
  process.env.HUB_OIDC_CLIENT_SECRET = CLIENT_SECRET;
  process.env.HUB_OIDC_REDIRECT_URI = REDIRECT;
  process.env.HUB_COOKIE_SECRET = 'x'.repeat(48);
  process.env.HUB_OIDC_LINK_BY_EMAIL = linkByEmail ? 'true' : 'false';
  return (await createApp({ logger: false })).app;
}

async function provisionUser(email: string, opts: { subject?: string; active?: boolean } = {}) {
  const r = await owner().query<{ id: string }>(
    `insert into app_user (id, org_id, email, display_name, is_demo, is_active, oidc_issuer, oidc_subject)
     values (gen_random_uuid(), $1, $2, 'SSO test user (synthetic)', false, $3, $4, $5) returning id`,
    [orgId, email, opts.active ?? true, opts.subject ? idp.issuer : null, opts.subject ?? null],
  );
  return r.rows[0]!.id;
}

/** Runs the browser round trip: app login → IdP authorize (auto-consent) → app callback. */
async function ssoLogin(app: INestApplication, user: FakeIdpUser, tamper?: (callbackPath: string, agent: request.Agent) => Promise<request.Response>) {
  const agent = request.agent(app.getHttpServer());
  const start = await agent.get('/api/v1/auth/oidc/login').expect(302);
  expect(start.headers.location).toMatch(new RegExp(`^${idp.issuer}/authorize\\?`));
  const authz = new URL(start.headers.location as string);
  expect(authz.searchParams.get('code_challenge_method')).toBe('S256');
  expect(authz.searchParams.get('state')).toBeTruthy();
  expect(authz.searchParams.get('nonce')).toBeTruthy();
  idp.nextUser = user;
  const idpRes = await fetch(authz, { redirect: 'manual' });
  expect(idpRes.status).toBe(302);
  const back = new URL(idpRes.headers.get('location')!);
  const callbackPath = `${back.pathname}${back.search}`;
  const cb = tamper ? await tamper(callbackPath, agent) : await agent.get(callbackPath);
  return { agent, cb };
}

function sessionCookieSet(res: request.Response): boolean {
  const c = res.headers['set-cookie'] as unknown as string[] | undefined;
  return !!c?.some((x) => x.startsWith('hub_session=') && !x.startsWith('hub_session=;'));
}

beforeAll(async () => {
  for (const k of OIDC_ENV) saved[k] = process.env[k];
  await idp.start();
  orgId = (await owner().query(`select id from organization where slug = 'mobily'`)).rows[0].id;
  strictApp = await buildApp(false);
  linkApp = await buildApp(true);
});

afterAll(async () => {
  for (const k of OIDC_ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  await strictApp?.close();
  await linkApp?.close();
  await idp.stop();
  await closePools();
});

describe('REQ-ARC-006 — OIDC SSO (Authorization Code + PKCE)', () => {
  it('reports an honest status: configured_unverified until discovery succeeds, then verified', async () => {
    const before = await request(strictApp.getHttpServer()).get('/api/v1/auth/config').expect(200);
    expect(before.body.oidc.status).toBe('configured_unverified');
    await request(strictApp.getHttpServer()).get('/api/v1/auth/oidc/login').expect(302);
    const after = await request(strictApp.getHttpServer()).get('/api/v1/auth/config').expect(200);
    expect(after.body.oidc).toEqual({ status: 'verified', loginUrl: '/api/v1/auth/oidc/login' });
  });

  it('a pre-provisioned user bound to the IdP subject signs in and gets an OIDC session', async () => {
    const sub = `sub-${Date.now()}`;
    const email = `sso.bound.${Date.now()}@example.invalid`;
    const userId = await provisionUser(email, { subject: sub });
    const { agent, cb } = await ssoLogin(strictApp, { sub, email });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/');
    expect(sessionCookieSet(cb)).toBe(true);
    const me = await agent.get('/api/v1/me').expect(200);
    expect(me.body.user).toMatchObject({ id: userId, email, isDemo: false });
    expect(me.body.mode.authMethod).toBe('oidc');
    const audit = await owner().query(`select count(*)::int n from audit_event where action = 'identity.login' and actor_user_id = $1 and outcome = 'success'`, [userId]);
    expect(audit.rows[0].n).toBe(1);
  });

  it('an unknown identity is refused (no auto-provisioning) and the refusal is audited', async () => {
    const { cb } = await ssoLogin(strictApp, { sub: `stranger-${Date.now()}`, email: `stranger.${Date.now()}@example.invalid` });
    expect(cb.status).toBe(302);
    expect(cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');
    expect(sessionCookieSet(cb)).toBe(false);
    const audit = await owner().query(`select count(*)::int n from audit_event where action = 'identity.login' and outcome = 'denied' and reason like 'OIDC login failed: oidc.not_provisioned%'`);
    expect(audit.rows[0].n).toBeGreaterThanOrEqual(1);
  });

  it('matching email does NOT link an account unless HUB_OIDC_LINK_BY_EMAIL=true', async () => {
    const email = `sso.link.${Date.now()}@example.invalid`;
    const userId = await provisionUser(email);
    const sub = `link-${Date.now()}`;
    const refused = await ssoLogin(strictApp, { sub, email });
    expect(refused.cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');

    const linked = await ssoLogin(linkApp, { sub, email });
    expect(linked.cb.headers.location).toBe('/');
    const row = await owner().query(`select oidc_issuer, oidc_subject from app_user where id = $1`, [userId]);
    expect(row.rows[0]).toEqual({ oidc_issuer: idp.issuer, oidc_subject: sub });
    const bindAudit = await owner().query(`select count(*)::int n from audit_event where action = 'identity.oidc.link_subject' and entity_id = $1`, [userId]);
    expect(bindAudit.rows[0].n).toBe(1);
    // after binding, the subject alone is enough — even on the strict app
    const again = await ssoLogin(strictApp, { sub, email: 'changed@example.invalid' });
    expect(again.cb.headers.location).toBe('/');
  });

  it('SEC-P1-01: an account already bound to a subject cannot be taken over by another subject with the same email', async () => {
    const email = `sso.victim.${Date.now()}@example.invalid`;
    const victimSub = `victim-${Date.now()}`;
    const victimId = await provisionUser(email, { subject: victimSub });
    for (const attempt of [email, email.toUpperCase()]) {
      const att = await ssoLogin(linkApp, { sub: `attacker-${Math.random()}`, email: attempt });
      expect(att.cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');
      expect(sessionCookieSet(att.cb)).toBe(false);
    }
    const row = await owner().query(`select oidc_subject from app_user where id = $1`, [victimId]);
    expect(row.rows[0].oidc_subject).toBe(victimSub);
    const bogus = await owner().query(`select count(*)::int n from audit_event where action = 'identity.oidc.link_subject' and entity_id = $1`, [victimId]);
    expect(bogus.rows[0].n).toBe(0); // nothing was linked, nothing is claimed
  });

  it('SEC-P1-01: an unverified email is never used to link an account', async () => {
    const email = `sso.unverified.${Date.now()}@example.invalid`;
    const userId = await provisionUser(email);
    const r = await ssoLogin(linkApp, { sub: `unverified-${Date.now()}`, email, emailVerified: false });
    expect(r.cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');
    const row = await owner().query(`select oidc_subject from app_user where id = $1`, [userId]);
    expect(row.rows[0].oidc_subject).toBeNull();
  });

  it('demo users and deactivated users can never sign in through SSO', async () => {
    const demo = await ssoLogin(linkApp, { sub: `demo-${Date.now()}`, email: demoEmail('pm') });
    expect(demo.cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');
    const pmId = await demoUserId('pm');
    const pm = await owner().query(`select oidc_subject from app_user where id = $1`, [pmId]);
    expect(pm.rows[0].oidc_subject).toBeNull(); // not bound

    const sub = `inactive-${Date.now()}`;
    await provisionUser(`sso.inactive.${Date.now()}@example.invalid`, { subject: sub, active: false });
    const inactive = await ssoLogin(strictApp, { sub });
    expect(inactive.cb.headers.location).toBe('/login?sso_error=oidc.not_provisioned');
    expect(sessionCookieSet(inactive.cb)).toBe(false);
  });

  it('rejects a missing or tampered login-state cookie and a replayed/mismatched state', async () => {
    const sub = `state-${Date.now()}`;
    await provisionUser(`sso.state.${Date.now()}@example.invalid`, { subject: sub });

    // (a) no state cookie (e.g. callback opened in another browser)
    const missing = await ssoLogin(strictApp, { sub }, (path) => request(strictApp.getHttpServer()).get(path));
    expect(missing.cb.headers.location).toBe('/login?sso_error=oidc.missing_state');

    // (b) forged cookie value (HMAC mismatch)
    const forged = await ssoLogin(strictApp, { sub }, (path) =>
      request(strictApp.getHttpServer())
        .get(path)
        .set('Cookie', `hub_oidc=${Buffer.from(JSON.stringify({ state: 'x', verifier: 'y', nonce: 'z', exp: Date.now() + 60_000 })).toString('base64url')}.AAAA`),
    );
    expect(forged.cb.headers.location).toBe('/login?sso_error=oidc.bad_state');

    // (c) callback carrying a different state than the one sealed in this browser's cookie (login CSRF)
    const other = await ssoLogin(strictApp, { sub }, async (path, agent) => {
      const u = new URL(path, 'http://x');
      u.searchParams.set('state', 'attacker-state');
      return agent.get(`${u.pathname}${u.search}`);
    });
    expect(other.cb.headers.location).toMatch(/^\/login\?sso_error=/);
    expect(sessionCookieSet(other.cb)).toBe(false);
  });

  it('an authorization code cannot be redeemed twice', async () => {
    const sub = `replay-${Date.now()}`;
    await provisionUser(`sso.replay.${Date.now()}@example.invalid`, { subject: sub });
    let replayPath = '';
    const first = await ssoLogin(strictApp, { sub }, async (path, agent) => {
      replayPath = path;
      return agent.get(path);
    });
    expect(first.cb.headers.location).toBe('/');
    const rejectedBefore = idp.rejectedTokenRequests;
    // a second browser session starts a login (fresh state cookie) and injects the old code with its own state
    const second = await ssoLogin(strictApp, { sub }, async (path, agent) => {
      const fresh = new URL(path, 'http://x');
      const old = new URL(replayPath, 'http://x');
      fresh.searchParams.set('code', old.searchParams.get('code')!);
      return agent.get(`${fresh.pathname}${fresh.search}`);
    });
    expect(second.cb.headers.location).toMatch(/^\/login\?sso_error=/);
    expect(idp.rejectedTokenRequests).toBe(rejectedBefore + 1);
  });

  it.each(['nonce', 'audience', 'issuer', 'expired', 'signature'] as const)('an ID token with a bad %s is rejected (no session)', async (kind) => {
    const sub = `tamper-${kind}-${Date.now()}`;
    await provisionUser(`sso.tamper.${kind}.${Date.now()}@example.invalid`, { subject: sub });
    idp.tamperNextToken = kind;
    const { cb } = await ssoLogin(strictApp, { sub });
    expect(cb.headers.location).toMatch(/^\/login\?sso_error=/);
    expect(sessionCookieSet(cb)).toBe(false);
  });

  it('REQ-ARC-006: demo (development) login and unsafe settings are rejected in production configuration', () => {
    const prod = {
      NODE_ENV: 'production',
      HUB_MODE: 'standard',
      DATABASE_URL: 'postgres://hub_app:strong-secret@db:5432/hub',
      HUB_COOKIE_SECURE: 'true',
      HUB_STORAGE_DRIVER: 's3',
      HUB_S3_ENDPOINT: 'https://objects.example.invalid',
      HUB_S3_BUCKET: 'hub-objects',
      HUB_S3_ACCESS_KEY_ID: 'hub-app',
      HUB_S3_SECRET_ACCESS_KEY: 'from-a-kubernetes-secret',
      HUB_EGRESS_ALLOWLIST: 'objects.example.invalid',
      HUB_OIDC_ISSUER: 'https://idp.example.invalid',
      HUB_OIDC_CLIENT_ID: 'hub',
      HUB_OIDC_REDIRECT_URI: 'https://hub.example.invalid/api/v1/auth/oidc/callback',
      HUB_COOKIE_SECRET: 'q7Vd2LxP9rTb4NwZ8kHs3JmC6yFa1GeU5oRi0XpQ',
      HUB_AI_ALLOW_MOCK: 'false',
    };
    expect(() => loadConfig(prod)).not.toThrow();
    expect(() => loadConfig({ ...prod, HUB_MODE: 'demo' })).toThrow(/HUB_MODE=demo is not allowed in production/);
    expect(() => loadConfig({ ...prod, HUB_OIDC_ISSUER: undefined })).toThrow(/OIDC issuer must be configured/);
    expect(() => loadConfig({ ...prod, HUB_OIDC_ISSUER: 'http://idp.example.invalid' })).toThrow(/https in production/);
    expect(() => loadConfig({ ...prod, HUB_COOKIE_SECRET: undefined })).toThrow(/HUB_COOKIE_SECRET/);
    expect(() => loadConfig({ ...prod, DATABASE_URL: 'postgres://hub_owner:x@db:5432/hub' })).toThrow(/runtime role/);
    // SEC-P1-10: incomplete OIDC, plain-http redirect and weak secrets are refused
    expect(() => loadConfig({ ...prod, HUB_OIDC_CLIENT_ID: undefined })).toThrow(/HUB_OIDC_CLIENT_ID/);
    expect(() => loadConfig({ ...prod, HUB_OIDC_REDIRECT_URI: 'http://hub.example.invalid/api/v1/auth/oidc/callback' })).toThrow(/REDIRECT_URI must use https/);
    expect(() => loadConfig({ ...prod, HUB_COOKIE_SECRET: 'a'.repeat(40) })).toThrow(/too weak/);
    expect(() => loadConfig({ ...prod, HUB_COOKIE_SECRET: 'change-me-change-me-change-me-12345678' })).toThrow(/too weak/);
  });

  it('SSO is 404 when OIDC is not configured', async () => {
    for (const k of OIDC_ENV) delete process.env[k];
    const plain = (await createApp({ logger: false })).app;
    try {
      await request(plain.getHttpServer()).get('/api/v1/auth/oidc/login').expect(404);
      const cfg = await request(plain.getHttpServer()).get('/api/v1/auth/config').expect(200);
      expect(cfg.body.oidc).toEqual({ status: 'not_configured', loginUrl: null });
    } finally {
      await plain.close();
    }
  });
});
