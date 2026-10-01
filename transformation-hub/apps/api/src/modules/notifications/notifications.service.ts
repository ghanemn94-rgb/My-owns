import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, isNull, or, gt, sql, type SQL } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  DECISION_OUTCOME_STATUSES,
  EVIDENCE_TARGET_READ_PERMISSION,
  POLICY_MATRIX,
  adapterDef,
  notFound,
  notificationDedupeKey,
  renderNotificationEn,
  sendRefusal,
  type Classification,
  type IntegrationStatus,
  type RoleKey,
  type SuppressionReason,
} from '@hub/domain';
import type { NotificationDtoT } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { DeliveryService } from '../../platform/delivery.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import type { ClaimedJob } from '../../platform/jobs/job-queue.service';
import type { RequestContext } from '../../platform/context';
import { RecordVisibility } from '../../platform/record-visibility';
import { newId } from '../../platform/ids';

/** Type-level read permission of a notification's source record (with the evidence-target map as fallback). */
const SOURCE_READ_PERMISSION: Record<string, string> = {
  committee: 'governance.committee.read',
  meeting: 'governance.meeting.read',
  agenda_item: 'governance.meeting.read',
  decision: 'governance.decision.read',
  action_item: 'governance.decision.read',
  escalation: 'governance.decision.read',
  change_request: 'planning.plan.read',
  baseline_version: 'planning.plan.read',
  task: 'planning.plan.read',
  milestone: 'planning.plan.read',
  deliverable: 'planning.plan.read',
  workstream: 'planning.plan.read',
  risk: 'planning.plan.read',
  issue: 'planning.plan.read',
  assumption: 'planning.plan.read',
  raid_dependency: 'planning.plan.read',
  status_update: 'planning.plan.read',
  gate_definition: 'gates.gate.read',
  gate_criterion: 'gates.gate.read',
  gate_assessment: 'gates.gate.read',
};
const readPermissionOf = (t: string) => SOURCE_READ_PERMISSION[t] ?? (EVIDENCE_TARGET_READ_PERMISSION as Record<string, string>)[t];

const rolesWith = (permission: string) => (Object.keys(POLICY_MATRIX.roles) as RoleKey[]).filter((r) => POLICY_MATRIX.roles[r].permissions.includes(permission));

interface Delivery {
  kind: string;
  code: string;
  params: Record<string, string | number>;
  link: string;
  projectId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  recipients: string[];
  /** Does the recipient (current access, re-resolved now) still see the source? Runs inside the recipient's context. */
  visible: (ctx: RequestContext) => Promise<boolean> | boolean;
}

/**
 * In-app notifications (REQ-PLT-008, REQ-INT-012, REQ-SEC-007, C-33) on the `notification` table shared with the AI
 * module (whose own writes — AI briefings and messages, with their dedupe keys — are untouched).
 *
 * Delivery: an outbox event → job (ids only) → for each recipient: the person is re-resolved NOW (`forUser`: inactive or
 * outside the project → suppressed), their access to the source record is re-checked inside their own RLS context
 * (→ suppressed), then ONE row is inserted with a dedupe key per event, kind and recipient (a retried job never notifies
 * twice). Suppressions are audited. The row carries a code + parameters and a deep link, never content.
 * Reading: only the reader's own rows, only for projects they are still in, and only when the source is still visible to
 * them — evaluated inside SQL, so counts and pages agree.
 */
@Injectable()
export class NotificationsService {
  private readonly log = new Logger('notifications');
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly delivery: DeliveryService,
    private readonly contexts: JobContextFactory,
  ) {}

  // ------------------------------------------------------------------------------------------------ reading
  /** Visibility of the reader's notifications, in SQL (re-authorised at read time). */
  private visibleWhere(ctx: RequestContext): SQL {
    const N = schema.notification;
    const parts: SQL[] = [];
    if (this.policy.canOrg(ctx, 'integrations.connection.read')) parts.push(sql`(${N.projectId} is null and ${N.kind} = 'integration.alert')`);
    parts.push(sql`(${N.projectId} is null and ${N.kind} <> 'integration.alert')`);
    for (const projectId of ctx.principal.projects.keys()) {
      if (!this.policy.canInProject(ctx, 'notifications.inbox.read', projectId)) continue;
      const rv = new RecordVisibility(this.policy, ctx, projectId, { reach: true, readPermission: readPermissionOf });
      const importVisible = this.policy.canInProject(ctx, 'imports.batch.read', projectId)
        ? sql`exists (select 1 from import_batch ib where ib.project_id = ${projectId} and ib.id::text = ${N.messageParams}->>'batchId' and ${this.policy.visibilitySql(ctx, projectId, { classification: sql`ib.classification` as never })})`
        : sql`false`;
      parts.push(sql`(${N.projectId} = ${projectId} and (case when ${N.kind} like 'import.%' then ${importVisible} when ${N.sourceType} is null or ${N.sourceId} is null then true else ${rv.targetSql(N.sourceType, N.sourceId)} end))`);
    }
    return and(eq(N.userId, ctx.principal.userId!), eq(N.deliveryStatus, 'sent'), or(...parts))!;
  }

  private dto(n: typeof schema.notification.$inferSelect, projectCode: string | null): NotificationDtoT {
    return {
      id: n.id,
      kind: n.kind,
      projectId: n.projectId,
      projectCode,
      title: n.title,
      body: n.body,
      messageCode: n.messageCode,
      messageParams: n.messageParams ?? null,
      link: n.link,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt ? n.readAt.toISOString() : null,
    };
  }

  async list(ctx: RequestContext, q: { page: number; pageSize: number; unread?: 'true' | 'false' }) {
    if (!ctx.principal.userId) throw notFound();
    const N = schema.notification;
    const where = and(this.visibleWhere(ctx), q.unread === 'true' ? isNull(N.readAt) : undefined)!;
    const [{ n }] = (await this.db.tx().select({ n: sql<number>`count(*)::int` }).from(N).where(where)) as [{ n: number }];
    const rows = await this.db
      .tx()
      .select({ n: N, code: schema.project.code })
      .from(N)
      .leftJoin(schema.project, eq(schema.project.id, N.projectId))
      .where(where)
      .orderBy(sql`${N.createdAt} desc`, sql`${N.id} desc`)
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items: rows.map((r) => this.dto(r.n, r.code ?? null)), page: q.page, pageSize: q.pageSize, total: Number(n) };
  }

  async unreadCount(ctx: RequestContext) {
    if (!ctx.principal.userId) return { count: 0 };
    const N = schema.notification;
    const [{ n }] = (await this.db.tx().select({ n: sql<number>`count(*)::int` }).from(N).where(and(this.visibleWhere(ctx), isNull(N.readAt)))) as [{ n: number }];
    return { count: Number(n) };
  }

  async markRead(ctx: RequestContext, id: string) {
    const N = schema.notification;
    const [row] = await this.db.tx().select({ id: N.id, readAt: N.readAt }).from(N).where(and(eq(N.id, id), this.visibleWhere(ctx)));
    if (!row) throw notFound();
    const readAt = row.readAt ?? new Date();
    if (!row.readAt) await this.db.tx().update(N).set({ readAt }).where(and(eq(N.id, id), eq(N.userId, ctx.principal.userId!)));
    return { id, readAt: readAt.toISOString() };
  }

  async markAllRead(ctx: RequestContext) {
    const N = schema.notification;
    const ids = (await this.db.tx().select({ id: N.id }).from(N).where(and(this.visibleWhere(ctx), isNull(N.readAt)))).map((r) => r.id);
    if (!ids.length) return { updated: 0 };
    const r = await this.db.tx().update(N).set({ readAt: new Date() }).where(and(inArray(N.id, ids), eq(N.userId, ctx.principal.userId!))).returning({ id: N.id });
    return { updated: r.length };
  }

  /** Channels: in-app always on; e-mail / Teams follow their connector's honest status; SMS has no adapter. */
  async channels(ctx: RequestContext) {
    const rows = await this.db.tx().select({ key: schema.integrationConnection.adapterKey, status: schema.integrationConnection.status, enabled: schema.integrationConnection.enabled }).from(schema.integrationConnection).where(eq(schema.integrationConnection.orgId, ctx.principal.orgId));
    const st = (key: string): IntegrationStatus => (rows.find((r) => r.key === key)?.status as IntegrationStatus | undefined) ?? 'not_configured';
    return {
      items: [
        { channel: 'in_app' as const, status: 'enabled' as const, adapterKey: null },
        { channel: 'email' as const, status: st('m365_outlook_mail_send'), adapterKey: 'm365_outlook_mail_send' },
        { channel: 'teams' as const, status: st('m365_teams_message_send'), adapterKey: 'm365_teams_message_send' },
        { channel: 'sms' as const, status: 'not_configured' as const, adapterKey: null },
      ],
    };
  }

  // ------------------------------------------------------------------------------------------------ delivery (worker)
  private async suppress(svc: RequestContext, d: Delivery, userId: string, reason: SuppressionReason, eventId: string) {
    await this.db.run(svc, () =>
      this.audit.record({ action: 'notifications.delivery.suppressed', entityType: d.sourceType ?? 'notification', entityId: d.sourceId, projectId: d.projectId, outcome: 'denied', reason, after: { kind: d.kind, recipientUserId: userId, eventId } }),
    );
  }

  /**
   * Deliver to each recipient after re-checking them NOW (REQ-INT-012, AT-19): inactive / out-of-project → suppressed;
   * cannot read the source → suppressed; otherwise exactly one in-app row per event, kind and recipient.
   */
  async deliver(job: ClaimedJob, d: Delivery): Promise<{ delivered: number; suppressed: number; duplicates: number }> {
    const svc = this.contexts.forService(job, 'svc-notifications', []);
    const eventId = String(job.payload['eventId'] ?? job.id);
    let delivered = 0;
    let suppressed = 0;
    let duplicates = 0;
    for (const userId of [...new Set(d.recipients.filter(Boolean))]) {
      const ctx = await this.contexts.forUser(userId, d.projectId, `job-${job.id}`);
      if (!ctx || (d.projectId && !this.policy.canInProject(ctx, 'notifications.inbox.read', d.projectId))) {
        await this.suppress(svc, d, userId, 'recipient_inactive_or_out_of_project', eventId);
        suppressed++;
        continue;
      }
      const ok = await this.db.run(ctx, async () => {
        if (!(await d.visible(ctx))) return false;
        const ins = await this.db.query(
          `insert into notification (id, org_id, project_id, user_id, kind, title, link, channel, delivery_status, dedupe_key, source_type, source_id, message_code, message_params)
           values ($1, $2, $3, $4, $5, $6, $7, 'in_app', 'sent', $8, $9, $10, $11, $12)
           on conflict do nothing`,
          [newId(), ctx.principal.orgId, d.projectId, userId, d.kind, renderNotificationEn(d.code, d.params), d.link, notificationDedupeKey(eventId, d.kind, userId), d.sourceType, d.sourceId, d.code, JSON.stringify(d.params)],
        );
        if ((ins.rowCount ?? 0) === 0) duplicates++;
        return true;
      });
      if (!ok) {
        await this.suppress(svc, d, userId, 'recipient_cannot_read_source', eventId);
        suppressed++;
      } else delivered++;
    }
    return { delivered: delivered - duplicates, suppressed, duplicates };
  }

  /**
   * External channels (e-mail / Teams) — the send pipeline every external delivery must use (REQ-INT-012, REQ-INT-007):
   * the recipient and the source are re-checked at SEND time, then the connector's send gate (verified, enabled, sending
   * authority, approved destination). The ledger row (AT-20) records the outcome. In this build no connector can pass the
   * gate, so the outcome is `disabled` and nothing is sent — no network call exists on this path.
   */
  async sendExternal(job: ClaimedJob, input: { channel: 'email' | 'teams'; recipientUserId: string; projectId: string; payload: { code: string; params: Record<string, string | number> }; visible: (ctx: RequestContext) => Promise<boolean> | boolean }) {
    const key = input.channel === 'email' ? 'm365_outlook_mail_send' : 'm365_teams_message_send';
    const idem = `notify:${job.id}:${input.channel}:${input.recipientUserId}`;
    const ctx = await this.contexts.forUser(input.recipientUserId, input.projectId, `job-${job.id}`);
    const svc = this.contexts.forService(job, 'svc-notifications', []);
    const visible = ctx ? await this.db.run(ctx, async () => input.visible(ctx)) : false;
    const begin = await this.delivery.begin({ orgId: job.org_id, projectId: input.projectId, idempotencyKey: idem, channel: input.channel, recipientUserId: input.recipientUserId, payload: input.payload });
    if (!begin.proceed || !begin.id) return { status: begin.existingStatus ?? 'duplicate' };
    if (!ctx || !visible) {
      await this.delivery.finish(begin.id, { status: 'suppressed', detail: ctx ? 'recipient cannot read the source at send time' : 'recipient inactive or outside the project at send time' });
      return { status: 'suppressed' };
    }
    const def = adapterDef(key)!;
    const [c] = await this.db.run(svc, () => this.db.tx().select().from(schema.integrationConnection).where(and(eq(schema.integrationConnection.orgId, job.org_id), eq(schema.integrationConnection.adapterKey, key))));
    const refusal = sendRefusal({ direction: def.direction, status: (c?.status as IntegrationStatus | undefined) ?? 'not_configured', enabled: !!c?.enabled, sendingAuthorized: !!c?.sendingAuthorized, destinationApproved: false });
    if (refusal) {
      await this.delivery.finish(begin.id, { status: 'disabled', detail: `${input.channel}: ${refusal.code}` });
      return { status: 'disabled', code: refusal.code };
    }
    // Unreachable in this build (no verified connector, no approved destination): an adapter would send here.
    await this.delivery.finish(begin.id, { status: 'failed', detail: 'no adapter implementation is configured' });
    return { status: 'failed' };
  }

  // ------------------------------------------------------------------------------------------------ event handlers
  private async svcRead<T>(job: ClaimedJob, fn: () => Promise<T>): Promise<T> {
    return this.db.run(this.contexts.forService(job, 'svc-notifications', []), fn);
  }

  /** REQ-GOV-012: the requester of an agenda request learns the screening outcome (no reason text — it stays on the record). */
  async onAgendaScreened(job: ClaimedJob) {
    const p = job.payload;
    const projectId = job.project_id;
    const requester = typeof p['requesterUserId'] === 'string' ? p['requesterUserId'] : null;
    const committeeId = String(p['committeeId'] ?? '');
    if (!projectId || !requester || !/^[0-9a-f-]{36}$/i.test(committeeId)) return { skipped: 'no_recipient' };
    const c = await this.svcRead(job, async () => (await this.db.tx().select({ id: schema.committee.id, classification: schema.committee.classification }).from(schema.committee).where(and(eq(schema.committee.id, committeeId), eq(schema.committee.projectId, projectId))))[0]);
    if (!c) return { skipped: 'source_missing' };
    const meetingId = typeof p['meetingId'] === 'string' ? p['meetingId'] : null;
    return this.deliver(job, {
      kind: 'agenda_request.screened',
      code: 'notifications.agenda_request.screened',
      params: { outcome: String(p['outcome'] ?? p['screeningStatus'] ?? 'screened') },
      link: meetingId ? `/projects/${projectId}/committee/meetings/${meetingId}` : `/projects/${projectId}/committee`,
      projectId,
      sourceType: 'committee',
      sourceId: c.id,
      recipients: [requester],
      visible: (ctx) => this.policy.can(ctx, 'governance.meeting.read', { projectId, classification: c.classification as Classification }),
    });
  }

  async onChangeRequestDecided(job: ClaimedJob) {
    const projectId = job.project_id;
    const id = String(job.payload['aggregateId'] ?? '');
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(id)) return { skipped: 'bad_payload' };
    const cr = await this.svcRead(job, async () => (await this.db.tx().select().from(schema.changeRequest).where(and(eq(schema.changeRequest.id, id), eq(schema.changeRequest.projectId, projectId))))[0]);
    if (!cr?.requestedBy) return { skipped: 'no_recipient' };
    return this.deliver(job, {
      kind: 'change_request.decided',
      code: 'notifications.change_request.decided',
      params: { code: cr.code, status: cr.status },
      link: `/projects/${projectId}/raid/changes/${cr.id}`,
      projectId,
      sourceType: 'change_request',
      sourceId: cr.id,
      recipients: [cr.requestedBy],
      visible: (ctx) => this.recordVisible(ctx, projectId, 'change_request', cr.id, cr.subjectType, cr.subjectId),
    });
  }

  async onDecisionStatusChanged(job: ClaimedJob) {
    const projectId = job.project_id;
    const to = String(job.payload['to'] ?? '');
    const id = String(job.payload['decisionId'] ?? job.payload['aggregateId'] ?? '');
    if (!projectId || !(DECISION_OUTCOME_STATUSES as readonly string[]).includes(to) || !/^[0-9a-f-]{36}$/i.test(id)) return { skipped: 'not_an_outcome' };
    const d = await this.svcRead(job, async () => (await this.db.tx().select({ id: schema.decision.id, code: schema.decision.code, requester: schema.decision.requesterUserId, createdBy: schema.decision.createdBy }).from(schema.decision).where(and(eq(schema.decision.id, id), eq(schema.decision.projectId, projectId))))[0]);
    const recipient = d?.requester ?? d?.createdBy ?? null;
    if (!d || !recipient) return { skipped: 'no_recipient' };
    return this.deliver(job, {
      kind: 'decision.outcome',
      code: 'notifications.decision.outcome',
      params: { code: d.code, status: to },
      link: `/projects/${projectId}/committee/decisions/${d.id}`,
      projectId,
      sourceType: 'decision',
      sourceId: d.id,
      recipients: [recipient],
      visible: (ctx) => this.recordVisible(ctx, projectId, 'decision', d.id),
    });
  }

  /** An import batch awaiting approval: the project's approvers (not the uploader) who can see the batch. */
  async onApprovalPending(job: ClaimedJob) {
    if (job.payload['aggregateType'] !== 'import_batch') return { skipped: 'not_handled' };
    const projectId = job.project_id;
    const id = String(job.payload['aggregateId'] ?? '');
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(id)) return { skipped: 'bad_payload' };
    const roles = rolesWith('imports.batch.approve');
    const { b, members } = await this.svcRead(job, async () => {
      const [b] = await this.db.tx().select({ id: schema.importBatch.id, code: schema.importBatch.code, classification: schema.importBatch.classification, createdBy: schema.importBatch.createdBy }).from(schema.importBatch).where(and(eq(schema.importBatch.id, id), eq(schema.importBatch.projectId, projectId)));
      const members = await this.db
        .tx()
        .selectDistinct({ userId: schema.projectMembership.userId })
        .from(schema.projectMembership)
        .where(and(eq(schema.projectMembership.projectId, projectId), inArray(schema.projectMembership.role, roles), isNull(schema.projectMembership.revokedAt), or(isNull(schema.projectMembership.validTo), gt(schema.projectMembership.validTo, new Date()))));
      return { b, members };
    });
    if (!b) return { skipped: 'source_missing' };
    return this.deliver(job, {
      kind: 'import.awaiting_approval',
      code: 'notifications.import.awaiting_approval',
      params: { code: b.code, batchId: b.id },
      link: `/projects/${projectId}/reports/imports/${b.id}`,
      projectId,
      sourceType: null,
      sourceId: null,
      recipients: members.map((m) => m.userId).filter((u) => u !== b.createdBy),
      visible: (ctx) => this.policy.can(ctx, 'imports.batch.approve', { projectId, classification: b.classification as Classification, requesterUserId: b.createdBy }),
    });
  }

  async onImportDecided(job: ClaimedJob) {
    const projectId = job.project_id;
    const id = String(job.payload['importBatchId'] ?? job.payload['aggregateId'] ?? '');
    if (!projectId || !/^[0-9a-f-]{36}$/i.test(id)) return { skipped: 'bad_payload' };
    const b = await this.svcRead(job, async () => (await this.db.tx().select({ id: schema.importBatch.id, code: schema.importBatch.code, classification: schema.importBatch.classification, createdBy: schema.importBatch.createdBy }).from(schema.importBatch).where(and(eq(schema.importBatch.id, id), eq(schema.importBatch.projectId, projectId))))[0]);
    if (!b) return { skipped: 'source_missing' };
    return this.deliver(job, {
      kind: 'import.decided',
      code: 'notifications.import.decided',
      params: { code: b.code, outcome: String(job.payload['outcome'] ?? 'decided'), batchId: b.id },
      link: `/projects/${projectId}/reports/imports/${b.id}`,
      projectId,
      sourceType: null,
      sourceId: null,
      recipients: [b.createdBy],
      visible: (ctx) => this.policy.can(ctx, 'imports.batch.read', { projectId, classification: b.classification as Classification }),
    });
  }

  /** Failure monitoring (REQ-INT-010): connector alerts go to the platform administrators (organisation level). */
  async onIntegrationAlert(job: ClaimedJob) {
    const roles = rolesWith('integrations.connection.manage');
    const admins = await this.svcRead(job, async () =>
      this.db
        .tx()
        .selectDistinct({ userId: schema.orgRoleAssignment.userId })
        .from(schema.orgRoleAssignment)
        .where(and(eq(schema.orgRoleAssignment.orgId, job.org_id), inArray(schema.orgRoleAssignment.role, roles), isNull(schema.orgRoleAssignment.revokedAt), or(isNull(schema.orgRoleAssignment.validTo), gt(schema.orgRoleAssignment.validTo, new Date())))),
    );
    return this.deliver(job, {
      kind: 'integration.alert',
      code: 'notifications.integration.alert',
      params: { adapter: String(job.payload['adapterKey'] ?? ''), problem: String(job.payload['problem'] ?? 'failure') },
      link: '/admin?tab=integrations',
      projectId: null,
      sourceType: null,
      sourceId: null,
      recipients: admins.map((a) => a.userId),
      visible: (ctx) => this.policy.canOrg(ctx, 'integrations.connection.read'),
    });
  }

  /** The record (and the subject it refers to) is visible to `ctx` — the same rule as the inbox. */
  private async recordVisible(ctx: RequestContext, projectId: string, type: string, id: string, subjectType?: string | null, subjectId?: string | null): Promise<boolean> {
    const rv = new RecordVisibility(this.policy, ctx, projectId, { reach: true, readPermission: readPermissionOf });
    const subject = subjectType && subjectId ? rv.targetSql(sql`${subjectType}::text`, sql`${subjectId}::uuid`) : sql`true`;
    const r = await this.db.tx().execute<{ ok: boolean }>(sql`select (${rv.targetSql(sql`${type}::text`, sql`${id}::uuid`)} and ${subject}) as ok`);
    return !!r.rows[0]?.ok;
  }

}
