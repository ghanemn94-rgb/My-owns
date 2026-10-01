import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { closeApp, closePools, DC, getApp, loginAs, owner, projectIdByCode, type Client } from '../helpers';
import { drainWorker } from '../documents/doc-helpers';
import { IntegrationsService } from '../../src/modules/integrations/integrations.service';
import type { EgressTransport } from '../../src/modules/integrations/egress.client';
import { INTEGRATION_ADAPTERS } from '@hub/domain';

const I = '/api/v1/integrations';
const SECRET = 'synthetic-webhook-signing-secret-for-tests-only';
let admin: Client;
let pm: Client;
let dc: string;
let svc: IntegrationsService;

beforeAll(async () => {
  process.env.HUB_EGRESS_ALLOWLIST = 'graph.microsoft.com,.sharepoint.com';
  process.env.HUB_INTEGRATION_SECRET_TEST_SENDER = SECRET;
  dc = await projectIdByCode(DC);
  admin = await loginAs('platform.admin');
  pm = await loginAs('pm');
  svc = (await getApp()).get(IntegrationsService);
});
afterAll(async () => {
  delete process.env.HUB_EGRESS_ALLOWLIST;
  delete process.env.HUB_INTEGRATION_SECRET_TEST_SENDER;
  await closeApp();
  await closePools();
});

/** A local test sender (never an external service): signs `<timestamp>.<delivery id>.<raw body>` with HMAC-SHA256. */
async function send(body: unknown, o: { id?: string; ts?: number; secret?: string; raw?: Buffer; signature?: string; adapter?: string } = {}) {
  const app = await getApp();
  const raw = o.raw ?? Buffer.from(JSON.stringify(body));
  const ts = String(o.ts ?? Math.floor(Date.now() / 1000));
  const id = o.id ?? `dlv-${randomUUID()}`;
  const sig = o.signature ?? `sha256=${createHmac('sha256', o.secret ?? SECRET).update(`${ts}.${id}.`).update(raw).digest('hex')}`;
  const r = await request(app.getHttpServer()).post(`/api/v1/webhooks/${o.adapter ?? 'inbound_webhook'}`).set('content-type', 'application/octet-stream').set('x-hub-timestamp', ts).set('x-hub-delivery-id', id).set('x-hub-signature', sig).send(raw);
  return { r, id };
}

async function adapter(key: string) {
  const r = await admin.get(I);
  expect(r.status).toBe(200);
  return r.body.items.find((a: { key: string }) => a.key === key);
}

describe('REQ-INT-014 / REQ-INT-008 / REQ-UX-020 honest connector status with manual alternatives', () => {
  it('UT: each unconfigured integration shows manual alternative — Microsoft 365 adapters defined but Not configured; future systems documented only', async () => {
    const r = await admin.get(I);
    expect(r.status).toBe(200);
    expect(r.body.items.map((a: { key: string }) => a.key)).toEqual(INTEGRATION_ADAPTERS.map((a) => a.key));
    for (const a of r.body.items) {
      expect(a.status, a.key).toBe('not_configured');
      expect(a.enabled).toBe(false);
      expect(a.manualAlternative).toMatch(/^(in_app_notifications|upload_documents|import_wizard|export_and_upload|manual_entry)$/);
    }
    const future = r.body.items.filter((a: { availability: string }) => a.availability === 'documented_only').map((a: { kind: string }) => a.kind);
    expect(future.sort()).toEqual(['dcim', 'erp', 'hr', 'itsm', 'vdr']);
    // Project roles read the same honest list (no configuration details); roles without the permission are refused.
    const p = await pm.get(`/api/v1/projects/${dc}/integrations`);
    expect(p.status).toBe(200);
    expect(p.body.items.every((a: { status: string; endpointHost: unknown }) => a.status === 'not_configured' && a.endpointHost === null)).toBe(true);
    const contributor = await loginAs('contributor');
    expect((await contributor.get(`/api/v1/projects/${dc}/integrations`)).status).toBe(403);
    expect((await pm.get(I)).status).toBe(403);
  });

  it('REVIEW-equivalent: a documented-only integration cannot be configured (no endpoint, data contract or approval)', async () => {
    const r = await admin.post(`${I}/erp_finance/configuration`, { endpointUrl: 'https://graph.microsoft.com/', scopes: [] });
    expect(r.status).toBe(422);
    expect(r.body.code).toBe('integrations.documented_only');
  });
});

describe('REQ-SEC-014 SSRF prevention for every configured URL; REQ-INT-013 Connected only after a validated check', () => {
  it('internal, private, metadata, non-https and non-allowlisted endpoints are refused before any connection (refusals logged)', async () => {
    const before = (await owner().query(`select count(*)::int n from integration_execution_log where adapter_key = 'm365_sharepoint_read' and outcome = 'refused'`)).rows[0].n;
    for (const [url, code] of [
      ['https://169.254.169.254/latest/meta-data/', 'egress.internal_address'],
      ['https://[::ffff:169.254.169.254]/', 'egress.internal_address'],
      ['https://2852039166/', 'egress.internal_address'],
      ['https://localhost/', 'egress.internal_address'],
      ['https://10.0.0.5/sites', 'egress.internal_address'],
      ['http://contoso.sharepoint.com/', 'egress.scheme_not_allowed'],
      ['https://contoso.sharepoint.com:8443/', 'egress.port_not_allowed'],
      ['https://attacker.example/', 'egress.host_not_allowlisted'],
    ] as const) {
      const r = await admin.post(`${I}/m365_sharepoint_read/configuration`, { endpointUrl: url, scopes: ['Sites.Selected'] });
      expect(r.status, url).toBe(422);
      expect(r.body.code, url).toBe(code);
    }
    const after = (await owner().query(`select count(*)::int n from integration_execution_log where adapter_key = 'm365_sharepoint_read' and outcome = 'refused'`)).rows[0].n;
    expect(after - before).toBe(8);
    expect((await adapter('m365_sharepoint_read')).status).toBe('not_configured');
  });

  it('UT: saved credentials without successful test show Not verified; a real check (local stub transport) verifies; DNS rebinding and redirects fail the check', async () => {
    const r = await admin.post(`${I}/m365_outlook_mail_send/configuration`, { endpointUrl: 'https://graph.microsoft.com/v1.0/$metadata', secretRef: 'HUB_INTEGRATION_SECRET_MAIL', scopes: ['Mail.Send'] });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body).toMatchObject({ status: 'configured_unverified', enabled: false, endpointHost: 'graph.microsoft.com', secretConfigured: false });
    expect(JSON.stringify(r.body)).not.toContain('HUB_INTEGRATION_SECRET_MAIL');
    const en = await admin.post(`${I}/m365_outlook_mail_send/enable`, { expectedVersion: r.body.version });
    expect(en.status).toBe(422);
    expect(en.body.code).toBe('integrations.not_verified');
    const scopes = await admin.post(`${I}/m365_outlook_mail_send/configuration`, { endpointUrl: 'https://graph.microsoft.com/v1.0/', scopes: ['Mail.ReadWrite'] });
    expect(scopes.body.code).toBe('integrations.scope_not_declared');

    const original = svc.egress.transport;
    const calls: string[] = [];
    const stub = (addresses: string[], status: number): EgressTransport => ({
      resolve: async (h) => {
        calls.push(`resolve ${h}`);
        return addresses;
      },
      get: async (url, address) => {
        calls.push(`get ${address} ${url.hostname}`);
        return { status };
      },
    });
    try {
      // DNS rebinding: an allowlisted name that resolves to the metadata address is never contacted.
      svc.egress.transport = stub(['20.190.128.10', '169.254.169.254'], 200);
      let cur = await adapter('m365_outlook_mail_send');
      const rebind = await admin.post(`${I}/m365_outlook_mail_send/test`, { expectedVersion: cur.version });
      expect(rebind.body).toMatchObject({ status: 'failed', lastCheckCode: 'egress.internal_address' });
      expect(calls.filter((c) => c.startsWith('get'))).toEqual([]);
      // A redirect is a failure, never followed.
      svc.egress.transport = stub(['20.190.128.10'], 302);
      const redir = await admin.post(`${I}/m365_outlook_mail_send/test`, { expectedVersion: rebind.body.version });
      expect(redir.body).toMatchObject({ status: 'failed', lastCheckCode: 'egress.redirect_refused' });
      // A successful check against the checked address verifies the connector; only then can it be enabled.
      svc.egress.transport = stub(['20.190.128.10'], 200);
      const ok = await admin.post(`${I}/m365_outlook_mail_send/test`, { expectedVersion: redir.body.version });
      expect(ok.body).toMatchObject({ status: 'verified', lastCheckCode: 'ok' });
      expect(calls).toContain('get 20.190.128.10 graph.microsoft.com');
      const enabled = await admin.post(`${I}/m365_outlook_mail_send/enable`, { expectedVersion: ok.body.version });
      expect(enabled.body).toMatchObject({ status: 'verified', enabled: true });
      // Saving the configuration again makes it unverified and disabled until checked again.
      const re = await admin.post(`${I}/m365_outlook_mail_send/configuration`, { expectedVersion: enabled.body.version, endpointUrl: 'https://graph.microsoft.com/v1.0/', scopes: ['Mail.Send'] });
      expect(re.body).toMatchObject({ status: 'configured_unverified', enabled: false });
      cur = re.body;
      const off = await admin.post(`${I}/m365_outlook_mail_send/disable`, { expectedVersion: cur.version, reason: 'Synthetic containment' });
      expect(off.body).toMatchObject({ status: 'disabled', enabled: false });
    } finally {
      svc.egress.transport = original;
    }
    // A failed check raised an alert for the platform administrators (failure monitoring).
    await drainWorker();
    const adminId = admin.userId;
    const alerts = (await owner().query(`select message_params from notification where user_id = $1 and kind = 'integration.alert'`, [adminId])).rows.map((r) => r.message_params);
    expect(alerts).toEqual(expect.arrayContaining([{ adapter: 'm365_outlook_mail_send', problem: 'check_failed' }]));
  });

  it('UT: adapter declares scopes; execution logged (configure, refusals, checks, enable, disable — no secrets)', async () => {
    const r = await admin.get(`${I}/m365_outlook_mail_send/logs?pageSize=50`);
    expect(r.status).toBe(200);
    const ops = r.body.items.map((l: { operation: string; outcome: string }) => `${l.operation}:${l.outcome}`);
    expect(ops).toEqual(expect.arrayContaining(['configure:success', 'enable:refused', 'test:failed', 'test:success', 'enable:success', 'disable:success']));
    expect(JSON.stringify(r.body)).not.toContain(SECRET);
    expect((await adapter('m365_outlook_mail_send')).scopes).toEqual(['Mail.Send']);
  });

  it('UT: read connector cannot invoke send operation (REQ-INT-007); a send connector that is not verified + authorised sends nothing', async () => {
    const orgCtx = { principal: { orgId: (await owner().query(`select org_id from project where id = $1`, [dc])).rows[0].org_id, userId: admin.userId } };
    const db = (await getApp()).get((await import('../../src/platform/db.service')).DbService);
    const { withDbScope } = await import('../../src/platform/context');
    const ctx = withDbScope({ principal: { kind: 'service', userId: null, orgId: orgCtx.principal.orgId, displayName: 'test', email: null, clearance: 'internal', isDemo: false, orgRoles: new Set(), projects: new Map(), serviceIdentity: 'svc-test', servicePermissions: new Set() }, correlationId: 'test-send-gate', sessionId: null, ip: null, authMethod: 'service', projectIds: [], locale: 'en' } as never);
    const read = await db.run(ctx, () => svc.sendGate(ctx, 'm365_sharepoint_read', true));
    expect(read).toEqual({ allowed: false, code: 'integrations.read_only_connector', reason: 'A read-only connector cannot send or write' });
    const send = await db.run(ctx, () => svc.sendGate(ctx, 'm365_teams_message_send', true));
    expect(send).toMatchObject({ allowed: false, code: 'integrations.not_verified' });
  });
});

describe('REQ-INT-009 / REQ-INT-010 signed inbound webhooks: signature, replay protection, idempotency, retries, reconciliation', () => {
  it('IT: unsigned or replayed webhook rejected — and a signed ping verifies the inbound connector', async () => {
    // Before configuration: unknown to the receiver.
    expect((await send({ type: 'ping' })).r.status).toBe(404);
    const c = await admin.post(`${I}/inbound_webhook/configuration`, { secretRef: 'HUB_INTEGRATION_SECRET_TEST_SENDER', scopes: [] });
    expect(c.status, JSON.stringify(c.body)).toBe(201);
    expect(c.body).toMatchObject({ status: 'configured_unverified', secretConfigured: true });
    const t = await admin.post(`${I}/inbound_webhook/test`, { expectedVersion: c.body.version });
    expect(t.body.code).toBe('integrations.inbound_check');

    const unsigned = await send({ type: 'ping' }, { signature: '' });
    expect(unsigned.r.status).toBe(401);
    expect(unsigned.r.body.code).toBe('webhooks.signature_invalid');
    const wrongKey = await send({ type: 'ping' }, { secret: 'another-secret' });
    expect(wrongKey.r.status).toBe(401);
    const stale = await send({ type: 'ping' }, { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect(stale.r.status).toBe(401);
    expect(stale.r.body.code).toBe('webhooks.timestamp_out_of_window');
    const badId = await send({ type: 'ping' }, { id: 'x' });
    expect(badId.r.body.code).toBe('webhooks.delivery_id_invalid');
    // Tampered body under a valid signature for the original body.
    const ts = Math.floor(Date.now() / 1000);
    const id = `dlv-${randomUUID()}`;
    const sig = `sha256=${createHmac('sha256', SECRET).update(`${ts}.${id}.`).update(Buffer.from('{"type":"ping"}')).digest('hex')}`;
    const tampered = await send({ type: 'test.event', data: { injected: true } }, { id, ts, signature: sig });
    expect(tampered.r.status).toBe(401);
    expect((await owner().query(`select count(*)::int n from webhook_delivery where delivery_id = any($1::text[])`, [[unsigned.id, wrongKey.id, stale.id, id]])).rows[0].n).toBe(0);

    const ping = await send({ type: 'ping' });
    expect(ping.r.status, JSON.stringify(ping.r.body)).toBe(201);
    expect(ping.r.body).toEqual({ status: 'accepted', deliveryId: ping.id });
    // Replay of the exact same signed request: acknowledged, never processed again.
    const replay = await send({ type: 'ping' }, { id: ping.id });
    expect(replay.r.body).toEqual({ status: 'duplicate', deliveryId: ping.id });
    await drainWorker();
    const a = await adapter('inbound_webhook');
    expect(a).toMatchObject({ status: 'verified', lastCheckCode: 'ok' });
    const d = (await owner().query(`select status, attempts, duplicate_count from webhook_delivery where delivery_id = $1`, [ping.id])).rows[0];
    expect(d).toEqual({ status: 'processed', attempts: 1, duplicate_count: 1 });
    const refused = (await admin.get(`${I}/inbound_webhook/logs?pageSize=100`)).body.items.filter((l: { outcome: string }) => l.outcome === 'refused').map((l: { code: string }) => l.code);
    expect(refused).toEqual(expect.arrayContaining(['webhooks.signature_invalid', 'webhooks.timestamp_out_of_window', 'webhooks.delivery_id_invalid', 'webhooks.duplicate']));
  });

  it('IT: duplicate delivery processed once; failure raises alert (retries with back-off, dead letter, reconciliation, manual retry)', async () => {
    const ev = await send({ type: 'test.event', data: { ref: 'synthetic' } });
    const dup = await send({ type: 'test.event', data: { ref: 'synthetic' } }, { id: ev.id });
    expect(dup.r.body.status).toBe('duplicate');
    await drainWorker();
    expect((await owner().query(`select status, attempts from webhook_delivery where delivery_id = $1`, [ev.id])).rows[0]).toEqual({ status: 'processed', attempts: 1 });
    expect((await owner().query(`select count(*)::int n from job where idempotency_key like 'webhook:%' and payload->>'deliveryRowId' = (select id::text from webhook_delivery where delivery_id = $1)`, [ev.id])).rows[0].n).toBe(1);

    const fail = await send({ type: 'test.fail' });
    const row = (await owner().query(`select id from webhook_delivery where delivery_id = $1`, [fail.id])).rows[0];
    // Each failed attempt is retried later with back-off; make every retry due now to drive the job to its dead letter.
    for (let i = 0; i < 6; i++) {
      await drainWorker();
      await owner().query(`update job set run_at = now() where idempotency_key = $1 and status = 'queued'`, [`webhook:${row.id}`]);
    }
    const job = (await owner().query(`select status, attempts from job where idempotency_key = $1`, [`webhook:${row.id}`])).rows[0];
    expect(job).toEqual({ status: 'dead', attempts: 4 });
    expect((await owner().query(`select status from webhook_delivery where id = $1`, [row.id])).rows[0].status).toBe('received');
    // Reconciliation (scheduled every 10 minutes): a delivery whose processing died is marked failed and alerted.
    await owner().query(`update webhook_delivery set created_at = now() - interval '11 minutes' where id = $1`, [row.id]);
    const orgId = (await owner().query(`select org_id from webhook_delivery where id = $1`, [row.id])).rows[0].org_id;
    expect((await owner().query(`select count(*)::int n from scheduled_job where org_id = $1 and kind = 'integrations.webhooks.reconcile'`, [orgId])).rows[0].n).toBe(1);
    const fake = { id: `reconcile-${Date.now()}`, org_id: orgId, project_id: null, kind: 'integrations.webhooks.reconcile', payload: {}, attempts: 1, max_attempts: 5, idempotency_key: 'x', requested_by: null, locked_by: 'test' };
    const rec = await svc.reconcileJob(fake as never);
    expect(rec).toEqual({ failed: 1 });
    await drainWorker();
    expect((await owner().query(`select status, last_error from webhook_delivery where id = $1`, [row.id])).rows[0].status).toBe('failed');
    const alerts = (await owner().query(`select message_params from notification where user_id = $1 and kind = 'integration.alert'`, [admin.userId])).rows.map((r) => r.message_params);
    expect(alerts).toEqual(expect.arrayContaining([{ adapter: 'inbound_webhook', problem: 'delivery_failed' }]));
    const list = await admin.get(`${I}/inbound_webhook/deliveries?status=failed`);
    expect(list.body.items.map((x: { deliveryId: string }) => x.deliveryId)).toContain(fail.id);
    expect((await adapter('inbound_webhook')).failures24h).toBeGreaterThan(0);
    // Manual reconciliation: a failed delivery is queued again; a processed one is never re-run.
    const retry = await admin.post(`${I}/inbound_webhook/deliveries/${row.id}/retry`);
    expect(retry.status).toBe(201);
    expect(retry.body.status).toBe('received');
    const processedRow = (await owner().query(`select id from webhook_delivery where delivery_id = $1`, [ev.id])).rows[0];
    const noRerun = await admin.post(`${I}/inbound_webhook/deliveries/${processedRow.id}/retry`);
    expect(noRerun.status).toBe(409);
  });

  it('a disabled inbound connector receives nothing', async () => {
    const a = await adapter('inbound_webhook');
    const off = await admin.post(`${I}/inbound_webhook/disable`, { expectedVersion: a.version, reason: 'Synthetic containment' });
    expect(off.status).toBe(201);
    expect((await send({ type: 'test.event' })).r.status).toBe(404);
  });
});
