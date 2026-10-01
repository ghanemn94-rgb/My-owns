import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { and, count, desc, eq, gt, inArray, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  INTEGRATION_ADAPTERS,
  SECRET_REF_PATTERN,
  WEBHOOK_DELIVERY_ID,
  WEBHOOK_EVENT_TYPE,
  WEBHOOK_MAX_BYTES,
  adapterDef,
  assertScopes,
  checkOutboundUrl,
  conflict,
  notFound,
  ruleViolation,
  sendRefusal,
  statusAfterCheck,
  statusAfterConfigure,
  webhookSigningPrefix,
  webhookTimestampIssue,
  type IntegrationAdapterDef,
  type IntegrationStatus,
} from '@hub/domain';
import type { IntegrationAdapterDtoT, RouteInput, integrationsRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { OutboxService } from '../../platform/outbox.service';
import { Clock } from '../../platform/clock';
import { APP_CONFIG, type AppConfig } from '../../platform/config';
import { JobQueue, type ClaimedJob } from '../../platform/jobs/job-queue.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { nextCronRun } from '../../platform/jobs/worker.service';
import type { RequestContext } from '../../platform/context';
import { assertVersion, offsetOf, pageOf } from '../../platform/helpers';
import { newId, sha256Hex } from '../../platform/ids';
import { EgressClient } from './egress.client';

type R = typeof integrationsRoutes;
type Conn = typeof schema.integrationConnection.$inferSelect;

export const PROCESS_WEBHOOK_JOB = 'integrations.webhook.process';
export const RECONCILE_WEBHOOKS_JOB = 'integrations.webhooks.reconcile';
/** Deliveries left in `received` this long without a live processing job are reconciled as failed. */
const STALE_DELIVERY_MINUTES = 5;
const PROCESS_MAX_ATTEMPTS = 4;

/**
 * Integrations (spec §17; REQ-INT-006..010/013/014, REQ-SEC-014). Connectors come from the adapter registry; a row of
 * `integration_connection` exists once an administrator configures one. Status is honest: saving a configuration gives
 * "configured — not verified"; only a real connectivity check (outbound) or a validly signed ping (inbound) verifies it.
 * Every operation and refusal is written to the connector's execution log (no secrets, no payload content).
 */
@Injectable()
export class IntegrationsService {
  private readonly log = new Logger('integrations');
  /** Outbound client (SSRF-guarded); tests may replace its transport with a local stub. */
  readonly egress = new EgressClient();

  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly outbox: OutboxService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    private readonly contexts: JobContextFactory,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Egress allowlist of the organisation (configuration HUB_EGRESS_ALLOWLIST). */
  allowlist(): string[] {
    const v = process.env.HUB_EGRESS_ALLOWLIST;
    return v === undefined ? this.config.egressAllowlist : v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  private def(key: string): IntegrationAdapterDef {
    const d = adapterDef(key);
    if (!d) throw notFound();
    return d;
  }

  private async conn(orgId: string, key: string): Promise<Conn | null> {
    const [c] = await this.db.tx().select().from(schema.integrationConnection).where(and(eq(schema.integrationConnection.orgId, orgId), eq(schema.integrationConnection.adapterKey, key)));
    return c ?? null;
  }

  /** Execution log entry in the current transaction (or a detached one for refusals whose transaction rolls back). */
  private async logOp(ctx: RequestContext, key: string, e: { operation: string; outcome: 'success' | 'refused' | 'failed'; code?: string | null; detail?: string | null }, detached = false) {
    const values = { id: newId(), orgId: ctx.principal.orgId, adapterKey: key, operation: e.operation, outcome: e.outcome, code: e.code ?? null, detail: e.detail ? e.detail.slice(0, 500) : null, actorUserId: ctx.principal.userId, correlationId: ctx.correlationId };
    if (detached) await this.db.runDetached(ctx, (tx) => tx.insert(schema.integrationExecutionLog).values(values)).catch((err: Error) => this.log.warn(`execution log write failed: ${err.message}`));
    else await this.db.tx().insert(schema.integrationExecutionLog).values(values);
  }

  /** Failed checks / deliveries in the last 24 hours per adapter (failure monitoring). */
  private async failures(orgId: string): Promise<Map<string, number>> {
    const since = new Date(this.clock.now().getTime() - 86_400_000);
    const rows = await this.db
      .tx()
      .select({ key: schema.integrationExecutionLog.adapterKey, n: count() })
      .from(schema.integrationExecutionLog)
      .where(and(eq(schema.integrationExecutionLog.orgId, orgId), eq(schema.integrationExecutionLog.outcome, 'failed'), gt(schema.integrationExecutionLog.createdAt, since)))
      .groupBy(schema.integrationExecutionLog.adapterKey);
    return new Map(rows.map((r) => [r.key, Number(r.n)]));
  }

  private dto(d: IntegrationAdapterDef, c: Conn | null, failures: number, detailed: boolean): IntegrationAdapterDtoT {
    const endpoint = (c?.config as { endpointUrl?: string } | undefined)?.endpointUrl;
    let host: string | null = null;
    try {
      host = endpoint ? new URL(endpoint).hostname : null;
    } catch {
      host = null;
    }
    const status: IntegrationStatus = d.availability === 'documented_only' ? 'not_configured' : ((c?.status as IntegrationStatus | undefined) ?? 'not_configured');
    return {
      key: d.key,
      kind: d.kind,
      direction: d.direction,
      availability: d.availability,
      provider: d.provider,
      scopes: [...d.scopes],
      check: d.check,
      manualAlternative: d.manualAlternative,
      prerequisites: [...d.prerequisites],
      status,
      enabled: !!c?.enabled,
      sendingAuthorized: !!c?.sendingAuthorized,
      endpointHost: detailed ? host : null,
      secretConfigured: !!c?.secretRef && SECRET_REF_PATTERN.test(c.secretRef) && !!process.env[c.secretRef],
      lastCheckedAt: c?.lastCheckedAt ? c.lastCheckedAt.toISOString() : null,
      lastCheckCode: c?.lastCheckCode ?? null,
      failures24h: failures,
      version: c?.version ?? 0,
    };
  }

  async list(ctx: RequestContext, detailed: boolean) {
    const rows = await this.db.tx().select().from(schema.integrationConnection).where(eq(schema.integrationConnection.orgId, ctx.principal.orgId));
    const f = await this.failures(ctx.principal.orgId);
    return INTEGRATION_ADAPTERS.map((d) => this.dto(d, rows.find((r) => r.adapterKey === d.key) ?? null, f.get(d.key) ?? 0, detailed));
  }

  private async one(ctx: RequestContext, key: string) {
    const d = this.def(key);
    const c = await this.conn(ctx.principal.orgId, key);
    const f = await this.failures(ctx.principal.orgId);
    return this.dto(d, c, f.get(key) ?? 0, true);
  }

  // ------------------------------------------------------------------------------------------------ commands
  /**
   * Save a configuration (REQ-INT-013): the endpoint passes the SSRF guard (allowlist, https, never internal); only a secret
   * REFERENCE is stored; scopes ⊆ the adapter's declared scopes. The status becomes "configured — not verified".
   */
  async configure(ctx: RequestContext, key: string, body: RouteInput<R['configureIntegration']>['body']) {
    const d = this.def(key);
    const refuse = async (code: string, message: string) => {
      await this.logOp(ctx, key, { operation: 'configure', outcome: 'refused', code }, true);
      return ruleViolation(code, message);
    };
    if (d.availability === 'documented_only') throw await refuse('integrations.documented_only', 'This integration is documented only: no endpoint, data contract or approval exists (REQ-INT-008)');
    if (d.check === 'outbound_endpoint') {
      if (!body.endpointUrl) throw await refuse('integrations.endpoint_required', 'An https endpoint is required');
      const chk = checkOutboundUrl(body.endpointUrl, this.allowlist());
      if (!chk.ok) throw await refuse(chk.code, chk.reason);
    } else if (body.endpointUrl) throw await refuse('integrations.endpoint_not_applicable', 'An inbound connector has no outbound endpoint');
    if (body.secretRef && !SECRET_REF_PATTERN.test(body.secretRef)) throw await refuse('integrations.secret_ref_invalid', 'A secret reference names a secret-store entry HUB_INTEGRATION_SECRET_<NAME> — never the secret itself');
    if (d.check === 'inbound_ping' && !body.secretRef) throw await refuse('integrations.secret_ref_required', 'A signed inbound connector needs the reference of its signing secret');
    assertScopes(d, body.scopes ?? []);
    const cur = await this.conn(ctx.principal.orgId, key);
    if (cur && body.expectedVersion !== undefined) assertVersion(cur, body.expectedVersion, 'connector');
    const config = { endpointUrl: body.endpointUrl ?? null, scopes: body.scopes ?? [] };
    const status = statusAfterConfigure((cur?.status as IntegrationStatus | undefined) ?? 'not_configured');
    const connId = cur?.id ?? newId();
    if (cur) {
      // A changed configuration is unverified again and disabled until it is checked and enabled.
      await this.db
        .tx()
        .update(schema.integrationConnection)
        .set({ config, secretRef: body.secretRef ?? null, status, enabled: false, lastCheckCode: null, updatedAt: new Date(), version: sql`${schema.integrationConnection.version} + 1` })
        .where(eq(schema.integrationConnection.id, cur.id));
    } else {
      await this.db.tx().insert(schema.integrationConnection).values({ id: connId, orgId: ctx.principal.orgId, adapterKey: key, kind: d.kind, name: d.provider, direction: d.direction, config, secretRef: body.secretRef ?? null, status, enabled: false, createdBy: ctx.principal.userId });
    }
    if (d.check === 'inbound_ping') await this.ensureReconcileSchedule(ctx.principal.orgId);
    await this.logOp(ctx, key, { operation: 'configure', outcome: 'success', code: status, detail: config.endpointUrl ? `endpoint host ${new URL(config.endpointUrl).hostname}` : null });
    await this.audit.record({ action: 'integrations.connection.manage', entityType: 'integration_connection', entityId: connId, after: { adapterKey: key, step: 'configure', status, scopes: config.scopes, endpointHost: config.endpointUrl ? new URL(config.endpointUrl).hostname : null, secretRefSet: !!body.secretRef } });
    return this.one(ctx, key);
  }

  /** Connectivity check (REQ-INT-013): verified only when the real check succeeds; a failure is logged and alerted. */
  async test(ctx: RequestContext, key: string, body: { expectedVersion: number }) {
    const d = this.def(key);
    const c = await this.conn(ctx.principal.orgId, key);
    if (!c || d.availability === 'documented_only') {
      await this.logOp(ctx, key, { operation: 'test', outcome: 'refused', code: 'integrations.not_configured' }, true);
      throw ruleViolation('integrations.not_configured', 'Configure the connector first');
    }
    assertVersion(c, body.expectedVersion, 'connector');
    if (d.check === 'inbound_ping') {
      await this.logOp(ctx, key, { operation: 'test', outcome: 'refused', code: 'integrations.inbound_check' }, true);
      throw ruleViolation('integrations.inbound_check', 'An inbound connector is verified when the sender’s signed "ping" event is received');
    }
    const endpoint = (c.config as { endpointUrl?: string }).endpointUrl ?? '';
    const r = await this.egress.probe(endpoint, this.allowlist());
    const status = statusAfterCheck(r.ok);
    await this.db
      .tx()
      .update(schema.integrationConnection)
      .set({ status, enabled: r.ok ? c.enabled : false, lastCheckedAt: this.clock.now(), lastCheckCode: r.ok ? 'ok' : r.code, lastCheckResult: r.ok ? `HTTP ${r.httpStatus}` : r.detail, updatedAt: new Date(), version: sql`${schema.integrationConnection.version} + 1` })
      .where(eq(schema.integrationConnection.id, c.id));
    await this.logOp(ctx, key, { operation: 'test', outcome: r.ok ? 'success' : 'failed', code: r.ok ? 'ok' : r.code, detail: r.ok ? `HTTP ${r.httpStatus}` : r.detail });
    await this.audit.record({ action: 'integrations.connection.manage', entityType: 'integration_connection', entityId: c.id, after: { adapterKey: key, step: 'test', status, code: r.ok ? 'ok' : r.code } });
    if (!r.ok) await this.outbox.emit({ type: 'integration.alert', projectId: null, aggregateType: 'integration_connection', aggregateId: c.id, payload: { adapterKey: key, problem: 'check_failed', code: r.code }, dedupeKey: `integration-alert:${c.id}:check:${c.version + 1}` });
    return this.one(ctx, key);
  }

  async enable(ctx: RequestContext, key: string, body: { expectedVersion: number }) {
    this.def(key);
    const c = await this.conn(ctx.principal.orgId, key);
    if (!c) throw ruleViolation('integrations.not_configured', 'Configure the connector first');
    assertVersion(c, body.expectedVersion, 'connector');
    if (c.status !== 'verified') {
      await this.logOp(ctx, key, { operation: 'enable', outcome: 'refused', code: 'integrations.not_verified' }, true);
      throw ruleViolation('integrations.not_verified', 'Only a verified connector can be enabled — run the connectivity check first');
    }
    await this.db.tx().update(schema.integrationConnection).set({ enabled: true, updatedAt: new Date(), version: sql`${schema.integrationConnection.version} + 1` }).where(eq(schema.integrationConnection.id, c.id));
    await this.logOp(ctx, key, { operation: 'enable', outcome: 'success' });
    await this.audit.record({ action: 'integrations.connection.manage', entityType: 'integration_connection', entityId: c.id, after: { adapterKey: key, step: 'enable' } });
    return this.one(ctx, key);
  }

  async disable(ctx: RequestContext, key: string, body: { expectedVersion: number; reason: string }) {
    this.def(key);
    const c = await this.conn(ctx.principal.orgId, key);
    if (!c) throw ruleViolation('integrations.not_configured', 'The connector is not configured');
    assertVersion(c, body.expectedVersion, 'connector');
    await this.db.tx().update(schema.integrationConnection).set({ status: 'disabled', enabled: false, updatedAt: new Date(), version: sql`${schema.integrationConnection.version} + 1` }).where(eq(schema.integrationConnection.id, c.id));
    await this.logOp(ctx, key, { operation: 'disable', outcome: 'success', detail: body.reason });
    await this.audit.record({ action: 'integrations.connection.disable', entityType: 'integration_connection', entityId: c.id, reason: body.reason, after: { adapterKey: key, status: 'disabled' } });
    return this.one(ctx, key);
  }

  async logs(ctx: RequestContext, key: string, q: { page: number; pageSize: number }) {
    this.def(key);
    const L = schema.integrationExecutionLog;
    const where = and(eq(L.orgId, ctx.principal.orgId), eq(L.adapterKey, key)) as SQL;
    const [{ n }] = (await this.db.tx().select({ n: count() }).from(L).where(where)) as [{ n: number }];
    const rows = await this.db
      .tx()
      .select({ l: L, name: schema.appUser.displayName })
      .from(L)
      .leftJoin(schema.appUser, eq(schema.appUser.id, L.actorUserId))
      .where(where)
      .orderBy(desc(L.createdAt), desc(L.id))
      .limit(q.pageSize)
      .offset(offsetOf(q));
    return pageOf(
      rows.map(({ l, name }) => ({ id: l.id, operation: l.operation, outcome: l.outcome as 'success' | 'refused' | 'failed', code: l.code, detail: l.detail, actorName: name ?? null, createdAt: l.createdAt.toISOString() })),
      Number(n),
      q,
    );
  }

  private deliveryDto(d: typeof schema.webhookDelivery.$inferSelect) {
    return {
      id: d.id,
      deliveryId: d.deliveryId,
      eventType: d.eventType,
      status: d.status as 'received' | 'processed' | 'ignored' | 'failed',
      attempts: d.attempts,
      duplicateCount: d.duplicateCount,
      lastError: d.lastError,
      receivedAt: d.receivedAt.toISOString(),
      processedAt: d.processedAt ? d.processedAt.toISOString() : null,
    };
  }

  async deliveries(ctx: RequestContext, key: string, q: RouteInput<R['integrationDeliveries']>['query']) {
    this.def(key);
    const W = schema.webhookDelivery;
    const where = and(eq(W.orgId, ctx.principal.orgId), eq(W.adapterKey, key), q.status ? eq(W.status, q.status) : undefined) as SQL;
    const [{ n }] = (await this.db.tx().select({ n: count() }).from(W).where(where)) as [{ n: number }];
    const rows = await this.db.tx().select().from(W).where(where).orderBy(desc(W.receivedAt), desc(W.id)).limit(q.pageSize).offset(offsetOf(q));
    return pageOf(rows.map((d) => this.deliveryDto(d)), Number(n), q);
  }

  /** Manual reconciliation of a FAILED delivery: processing is queued again; a processed delivery is never re-run. */
  async retry(ctx: RequestContext, key: string, deliveryRowId: string) {
    this.def(key);
    const W = schema.webhookDelivery;
    const [d] = await this.db.tx().select().from(W).where(and(eq(W.id, deliveryRowId), eq(W.orgId, ctx.principal.orgId), eq(W.adapterKey, key)));
    if (!d) throw notFound();
    if (d.status !== 'failed') throw conflict('webhooks.not_failed', `The delivery is ${d.status}; only failed deliveries are retried`);
    const [row] = await this.db.tx().update(W).set({ status: 'received', lastError: null }).where(eq(W.id, d.id)).returning();
    const n = Number((await this.db.query<{ n: number }>(`select count(*)::int n from job where idempotency_key like $1`, [`webhook:${d.id}%`])).rows[0]?.n ?? 0);
    await this.queue.enqueue({ kind: PROCESS_WEBHOOK_JOB, orgId: ctx.principal.orgId, projectId: null, payload: { deliveryRowId: d.id }, idempotencyKey: `webhook:${d.id}:retry:${n}`, maxAttempts: PROCESS_MAX_ATTEMPTS, requestedBy: ctx.principal.userId });
    await this.logOp(ctx, key, { operation: 'retry', outcome: 'success', code: d.deliveryId });
    await this.audit.record({ action: 'integrations.connection.manage', entityType: 'webhook_delivery', entityId: d.id, after: { adapterKey: key, step: 'retry', deliveryId: d.deliveryId } });
    return this.deliveryDto(row!);
  }

  // ------------------------------------------------------------------------------------------------ inbound webhooks
  /**
   * Signed inbound webhook (REQ-INT-009/010, C-39): connector configured and not disabled → size → timestamp window →
   * delivery-id format → HMAC-SHA256 over `<timestamp>.<delivery id>.<raw body>` (constant-time compare) → JSON → one row
   * per delivery id (replay / duplicate → acknowledged, never processed again) → processing job with retries.
   */
  async receive(ctx: RequestContext, key: string, raw: Buffer, headers: { timestamp?: string; deliveryId?: string; signature?: string }) {
    const d = adapterDef(key);
    if (!d || d.check !== 'inbound_ping') throw notFound();
    const c = await this.conn(ctx.principal.orgId, key);
    const deny = async (status: number, code: string, message: string) => {
      await this.logOp(ctx, key, { operation: 'receive', outcome: 'refused', code, detail: headers.deliveryId && WEBHOOK_DELIVERY_ID.test(headers.deliveryId) ? `delivery ${headers.deliveryId}` : null }, true);
      return new HttpException({ message, code }, status);
    };
    if (!c || c.status === 'disabled' || c.status === 'not_configured' || !c.secretRef) throw await deny(404, 'not_found', 'Resource not found');
    if (raw.length > WEBHOOK_MAX_BYTES) throw await deny(413, 'webhooks.too_large', 'The webhook body exceeds the size limit');
    const tsIssue = webhookTimestampIssue(headers.timestamp, Math.floor(this.clock.now().getTime() / 1000));
    if (tsIssue) throw await deny(401, tsIssue, 'The webhook timestamp is missing or outside the accepted window');
    if (!headers.deliveryId || !WEBHOOK_DELIVERY_ID.test(headers.deliveryId)) throw await deny(401, 'webhooks.delivery_id_invalid', 'The delivery id is missing or malformed');
    const secret = SECRET_REF_PATTERN.test(c.secretRef) ? process.env[c.secretRef] : undefined;
    if (!secret) throw await deny(401, 'webhooks.secret_unavailable', 'The signing secret is not available — the delivery cannot be verified');
    const expected = createHmac('sha256', secret).update(webhookSigningPrefix(headers.timestamp!, headers.deliveryId)).update(raw).digest();
    const given = /^sha256=([0-9a-f]{64})$/i.exec(headers.signature ?? '')?.[1];
    const ok = !!given && timingSafeEqual(Buffer.from(given, 'hex'), expected);
    if (!ok) throw await deny(401, 'webhooks.signature_invalid', 'The webhook signature is invalid');
    let body: { type?: unknown; data?: unknown };
    try {
      body = JSON.parse(raw.toString('utf8')) as { type?: unknown; data?: unknown };
    } catch {
      throw await deny(400, 'webhooks.payload_invalid', 'The webhook body is not JSON');
    }
    const type = typeof body?.type === 'string' ? body.type : '';
    if (!WEBHOOK_EVENT_TYPE.test(type)) throw await deny(400, 'webhooks.payload_invalid', 'The webhook body needs a "type"');
    const id = newId();
    const ins = await this.db.query<{ id: string; inserted: boolean }>(
      `insert into webhook_delivery (id, org_id, adapter_key, delivery_id, event_type, payload_hash, payload, sender_timestamp)
       values ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))
       on conflict (org_id, adapter_key, delivery_id) do update set duplicate_count = webhook_delivery.duplicate_count + 1
       returning id, (xmax = 0) as inserted`,
      [id, ctx.principal.orgId, key, headers.deliveryId, type, sha256Hex(raw), JSON.stringify(typeof body.data === 'object' && body.data !== null ? { data: body.data } : {}), Number(headers.timestamp)],
    );
    const r = ins.rows[0]!;
    if (!r.inserted) {
      await this.logOp(ctx, key, { operation: 'receive', outcome: 'refused', code: 'webhooks.duplicate', detail: `delivery ${headers.deliveryId} already received — not processed again` });
      return { status: 'duplicate' as const, deliveryId: headers.deliveryId };
    }
    await this.queue.enqueue({ kind: PROCESS_WEBHOOK_JOB, orgId: ctx.principal.orgId, projectId: null, payload: { deliveryRowId: r.id }, idempotencyKey: `webhook:${r.id}`, maxAttempts: PROCESS_MAX_ATTEMPTS });
    await this.logOp(ctx, key, { operation: 'receive', outcome: 'success', code: type, detail: `delivery ${headers.deliveryId}` });
    return { status: 'accepted' as const, deliveryId: headers.deliveryId };
  }

  /** Worker: process one delivery exactly once (status `received` only); diagnostic `test.fail` exercises retries. */
  async processJob(job: ClaimedJob) {
    const ctx = this.contexts.forService(job, 'svc-integrations', []);
    const id = String(job.payload['deliveryRowId'] ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { skipped: 'bad_payload' };
    const W = schema.webhookDelivery;
    const d = await this.db.run(ctx, async () => {
      const [row] = await this.db.tx().select().from(W).where(and(eq(W.id, id), eq(W.orgId, job.org_id)));
      if (!row || row.status !== 'received') return null;
      await this.db.tx().update(W).set({ attempts: sql`${W.attempts} + 1` }).where(eq(W.id, id));
      return row;
    });
    if (!d) return { skipped: 'not_pending' };
    if (d.eventType === 'test.fail') {
      await this.db.run(ctx, async () => {
        await this.db.tx().update(W).set({ lastError: `diagnostic failure (attempt ${d.attempts + 1})` }).where(eq(W.id, id));
        await this.logOp(ctx, d.adapterKey, { operation: 'process', outcome: 'failed', code: 'webhooks.processing_failed', detail: `delivery ${d.deliveryId} attempt ${d.attempts + 1}` });
      });
      throw new Error(`webhook ${d.deliveryId}: diagnostic failure (test.fail)`);
    }
    return this.db.run(ctx, async () => {
      const [cur] = await this.db.tx().select().from(W).where(and(eq(W.id, id), eq(W.status, 'received'))).for('update');
      if (!cur) return { skipped: 'not_pending' };
      let status: 'processed' | 'ignored' = 'processed';
      if (d.eventType === 'ping') {
        // A validly signed ping from the sender is the connectivity check of an inbound connector (REQ-INT-013).
        await this.db
          .tx()
          .update(schema.integrationConnection)
          .set({ status: statusAfterCheck(true), lastCheckedAt: this.clock.now(), lastCheckCode: 'ok', lastCheckResult: `signed ping ${d.deliveryId}`, updatedAt: new Date(), version: sql`${schema.integrationConnection.version} + 1` })
          .where(and(eq(schema.integrationConnection.orgId, job.org_id), eq(schema.integrationConnection.adapterKey, d.adapterKey), sql`${schema.integrationConnection.status} <> 'disabled'`));
      } else if (d.eventType !== 'test.event') status = 'ignored';
      await this.db.tx().update(W).set({ status, processedAt: this.clock.now(), lastError: null }).where(eq(W.id, id));
      await this.logOp(ctx, d.adapterKey, { operation: 'process', outcome: 'success', code: status, detail: `delivery ${d.deliveryId} (${d.eventType})` });
      return { status };
    });
  }

  /**
   * Reconciliation and failure monitoring (REQ-INT-010): deliveries whose processing died (dead-lettered job) or never got a
   * job are marked failed, logged and alerted to the platform administrators (outbox → in-app notification). Nothing is
   * re-processed automatically — an administrator retries explicitly.
   */
  async reconcile(orgId: string, ctx: RequestContext): Promise<{ failed: number }> {
    return this.db.run(ctx, async () => {
      const stale = await this.db.query<{ id: string; adapter_key: string; delivery_id: string; job_status: string | null }>(
        `select d.id, d.adapter_key, d.delivery_id,
                (select j.status from job j where j.idempotency_key like 'webhook:' || d.id || '%' order by j.created_at desc limit 1) as job_status
           from webhook_delivery d
          where d.org_id = $1 and d.status = 'received' and d.created_at < now() - ($2::int * interval '1 minute')
          for update of d skip locked`,
        [orgId, STALE_DELIVERY_MINUTES],
      );
      const dead = stale.rows.filter((r) => r.job_status === null || r.job_status === 'dead' || r.job_status === 'cancelled');
      if (!dead.length) return { failed: 0 };
      await this.db.tx().update(schema.webhookDelivery).set({ status: 'failed', lastError: 'processing did not complete (dead-lettered or no job) — reconcile before any retry' }).where(inArray(schema.webhookDelivery.id, dead.map((r) => r.id)));
      const byAdapter = new Map<string, number>();
      for (const r of dead) byAdapter.set(r.adapter_key, (byAdapter.get(r.adapter_key) ?? 0) + 1);
      for (const [key, n] of byAdapter) {
        await this.logOp(ctx, key, { operation: 'reconcile', outcome: 'failed', code: 'webhooks.delivery_failed', detail: `${n} delivery(ies) failed` });
        await this.outbox.emit({ type: 'integration.alert', projectId: null, aggregateType: 'webhook_delivery', aggregateId: dead.find((r) => r.adapter_key === key)!.id, payload: { adapterKey: key, problem: 'delivery_failed', count: n }, dedupeKey: `integration-alert:deliveries:${dead.filter((r) => r.adapter_key === key).map((r) => r.id).sort().join(',')}`.slice(0, 200) });
      }
      return { failed: dead.length };
    });
  }

  async reconcileJob(job: ClaimedJob) {
    const ctx = this.contexts.forService(job, 'svc-integrations', []);
    return this.reconcile(job.org_id, ctx);
  }

  /** The organisation's reconciliation schedule (every 10 minutes), created with its first inbound connector. */
  private async ensureReconcileSchedule(orgId: string) {
    await this.db.query(
      `insert into scheduled_job (id, org_id, project_id, kind, name, cron, timezone, payload, enabled, next_run_at)
       select $1::uuid, $2::uuid, null, $3::varchar, 'Reconcile inbound webhook deliveries', '*/10 * * * *', 'Asia/Riyadh', '{}'::jsonb, true, $4::timestamptz
        where not exists (select 1 from scheduled_job where org_id = $2::uuid and project_id is null and kind = $3::varchar)`,
      [newId(), orgId, RECONCILE_WEBHOOKS_JOB, nextCronRun('*/10 * * * *', 'Asia/Riyadh', this.clock.now())],
    );
  }

  /** Channel status for notifications: the connector behind e-mail / Teams (never "enabled" unless verified + enabled). */
  async channelStatus(orgId: string, key: string): Promise<IntegrationStatus> {
    const c = await this.conn(orgId, key);
    return (c?.status as IntegrationStatus | undefined) ?? 'not_configured';
  }

  /**
   * REQ-INT-007 / REQ-INT-012: the send gate every write/send operation must pass. Read-only connectors never send; a
   * write/send connector sends only when verified, enabled, with an approved sending authority and destination. In this
   * build no connector can pass it (nothing is verified) — the refusal is logged and nothing leaves the hub.
   */
  async sendGate(ctx: RequestContext, key: string, destinationApproved: boolean): Promise<{ allowed: true } | { allowed: false; code: string; reason: string }> {
    const d = this.def(key);
    const c = await this.conn(ctx.principal.orgId, key);
    const refusal = sendRefusal({ direction: d.direction, status: (c?.status as IntegrationStatus | undefined) ?? 'not_configured', enabled: !!c?.enabled, sendingAuthorized: !!c?.sendingAuthorized, destinationApproved });
    if (refusal) {
      await this.logOp(ctx, key, { operation: 'send', outcome: 'refused', code: refusal.code });
      return { allowed: false, ...refusal };
    }
    return { allowed: true };
  }
}
