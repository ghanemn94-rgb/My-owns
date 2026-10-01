import { Injectable } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  RAG_THRESHOLD_CHANGE_ACTION,
  RAG_THRESHOLD_MACHINE,
  assertRagThresholds,
  conflict,
  forbidden,
  notFound,
  ragStatusRules,
  ruleViolation,
  sameRagThresholds,
  templateRagThresholds,
  transition,
  type Classification,
  type RagThresholdState,
  type RagThresholds,
} from '@hub/domain';
import type { RouteInput, configRoutes } from '@hub/contracts';
import { assertVersion, updateVersioned, loadInProject } from '../../platform/helpers';
import type { RequestContext } from '../../platform/context';
import { newId, payloadHash } from '../../platform/ids';
import { ConfigSupport, iso } from './config.support';
import { RagThresholdsReader, type ApprovalRequestRow, type RagThresholdPayload } from './rag-thresholds.reader';

type R = typeof configRoutes;
const AR = schema.approvalRequest;
const APPROVE_PERMISSION = 'config.project_settings.approve';
const MANAGE_PERMISSION = 'config.project_settings.manage';
const LOCK = 'config.rag_thresholds';
const values = (t: RagThresholds): RagThresholds => ({ greenMaxSlipDays: t.greenMaxSlipDays, amberMaxSlipDays: t.amberMaxSlipDays, staleAfterDays: t.staleAfterDays });

/**
 * Configurable RAG thresholds per project (spec §9 measurement rule 4, REQ-PLN-019, review finding DOM-P2-08). A change is
 * an `approval_request` (action `config.rag_thresholds.change`, subject = the project, subject version = the threshold
 * version number) proposed by the project manager and decided by ANOTHER person holding `config.project_settings.approve`
 * (Portfolio Admin); the decision is an `approval_record` bound to the payload hash ("internal electronic approval").
 * Nothing changes before approval: the planning measurement reads only the latest APPROVED version (else the pinned
 * template version's proposed default) and every calculated RAG names the version it used.
 */
@Injectable()
export class RagThresholdsService {
  constructor(
    private readonly s: ConfigSupport,
    private readonly reader: RagThresholdsReader,
  ) {}

  private async requests(projectId: string): Promise<ApprovalRequestRow[]> {
    return this.s.db
      .tx()
      .select()
      .from(AR)
      .where(and(eq(AR.projectId, projectId), eq(AR.action, RAG_THRESHOLD_CHANGE_ACTION), eq(AR.subjectType, 'project'), eq(AR.subjectId, projectId)))
      .orderBy(desc(AR.subjectVersion), desc(AR.id));
  }

  /** The latest decision record of each request (approve / reject). */
  private async decisions(ids: string[]) {
    if (!ids.length) return new Map<string, typeof schema.approvalRecord.$inferSelect>();
    const rows = await this.s.db.tx().select().from(schema.approvalRecord).where(inArray(schema.approvalRecord.approvalRequestId, ids)).orderBy(desc(schema.approvalRecord.recordedAt));
    const m = new Map<string, typeof schema.approvalRecord.$inferSelect>();
    for (const r of rows) if (!m.has(r.approvalRequestId)) m.set(r.approvalRequestId, r);
    return m;
  }

  private stateOf(r: ApprovalRequestRow, inForceId: string | null): RagThresholdState {
    if (r.status === 'approved') return r.id === inForceId ? 'approved' : 'superseded';
    if (r.status === 'pending' || r.status === 'rejected' || r.status === 'withdrawn') return r.status;
    return 'rejected'; // expired / invalidated are never produced for this action; shown as not in force
  }

  async get(ctx: RequestContext, projectId: string) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, 'portfolio.project.read', pin.p);
    const inForce = await this.reader.inForce(projectId);
    const rows = await this.requests(projectId);
    const recs = await this.decisions(rows.map((r) => r.id));
    const names = await this.s.userNames([...rows.map((r) => r.requestedBy), ...[...recs.values()].map((x) => x.approverUserId)]);
    const inForceId = inForce.approvedRequest?.id ?? null;
    const inForceRec = inForceId ? recs.get(inForceId) : undefined;
    return {
      inForce: {
        thresholds: values(inForce.thresholds),
        ref: inForce.ref,
        approvedAt: iso(inForceRec?.recordedAt),
        approvedByName: inForceRec ? (names.get(inForceRec.approverUserId) ?? null) : null,
      },
      templateDefault: { thresholds: templateRagThresholds(pin.def), templateKey: pin.templateKey, templateVersionNo: pin.versionNo },
      rules: ragStatusRules(inForce.thresholds),
      pendingId: rows.find((r) => r.status === 'pending')?.id ?? null,
      versions: rows.map((r) => {
        const pl = r.payload as unknown as RagThresholdPayload;
        const rec = recs.get(r.id);
        return {
          id: r.id,
          versionNo: pl.versionNo,
          state: this.stateOf(r, inForceId),
          thresholds: values(pl.thresholds),
          basedOn: { ref: pl.basedOn.ref, thresholds: values(pl.basedOn.thresholds) },
          reason: pl.reason,
          proposedBy: r.requestedBy,
          proposedByName: names.get(r.requestedBy) ?? null,
          proposedAt: r.createdAt.toISOString(),
          decidedBy: rec?.approverUserId ?? null,
          decidedByName: rec ? (names.get(rec.approverUserId) ?? null) : null,
          decidedAt: iso(rec?.recordedAt),
          decisionNote: rec?.comment ?? null,
          version: r.version,
        };
      }),
    };
  }

  async propose(ctx: RequestContext, projectId: string, body: RouteInput<R['proposeRagThresholds']>['body']) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, MANAGE_PERMISSION, pin.p);
    await this.s.lock(LOCK, projectId);
    const proposed = values(body);
    assertRagThresholds(proposed);
    const rows = await this.requests(projectId);
    const pending = rows.find((r) => r.status === 'pending');
    if (pending) throw conflict('config.rag_thresholds.proposal_pending', 'Another threshold change is awaiting a decision — it must be approved, rejected or withdrawn first', { pendingId: pending.id });
    const inForce = await this.reader.inForce(projectId);
    if (sameRagThresholds(inForce.thresholds, proposed)) throw ruleViolation('config.rag_thresholds.unchanged', 'The proposed thresholds equal the thresholds in force');
    const versionNo = Math.max(0, ...rows.map((r) => r.subjectVersion ?? 0)) + 1;
    const payload: RagThresholdPayload = { versionNo, thresholds: proposed, basedOn: { ref: inForce.ref, thresholds: values(inForce.thresholds) }, reason: body.reason };
    const id = newId();
    await this.s.db
      .tx()
      .insert(AR)
      .values({
        id,
        orgId: ctx.principal.orgId,
        projectId,
        subjectType: 'project',
        subjectId: projectId,
        subjectVersion: versionNo,
        action: RAG_THRESHOLD_CHANGE_ACTION,
        payload: payload as unknown as Record<string, unknown>,
        payloadHash: payloadHash(payload),
        requiredPermission: APPROVE_PERMISSION,
        requestedBy: ctx.principal.userId!,
        note: body.reason,
      });
    await this.s.audit.record({
      action: 'config.rag_thresholds.propose',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { thresholds: payload.basedOn.thresholds, ref: payload.basedOn.ref },
      after: { approvalRequestId: id, versionNo, thresholds: proposed, inForce: false },
      reason: body.reason,
    });
    await this.s.outbox.emit({ type: 'approval.pending', projectId, aggregateType: 'approval_request', aggregateId: id, payload: { approvalRequestId: id, kind: 'rag_thresholds', versionNo, requiredPermission: APPROVE_PERMISSION } });
    return { id, versionNo, state: 'pending' as const, version: 1 };
  }

  private async load(projectId: string, requestId: string): Promise<ApprovalRequestRow> {
    const r = await loadInProject(this.s.db, AR, projectId, requestId);
    if (r.action !== RAG_THRESHOLD_CHANGE_ACTION || r.subjectType !== 'project' || r.subjectId !== projectId) throw notFound();
    return r;
  }

  /** Role → state → separation of duties (the proposer never decides), then optimistic concurrency. */
  private async decide(ctx: RequestContext, projectId: string, requestId: string, expectedVersion: number, command: 'approve' | 'reject') {
    const pin = await this.s.pinned(projectId);
    await this.s.lock(LOCK, projectId);
    const r = await this.load(projectId, requestId);
    this.s.policy.assertApproval(ctx, APPROVE_PERMISSION, { projectId, classification: pin.p.classification as Classification, requesterUserId: r.requestedBy }, () =>
      transition('rag_thresholds', RAG_THRESHOLD_MACHINE, r.status as 'pending', command),
    );
    assertVersion(r, expectedVersion, 'threshold change');
    const payload = r.payload as unknown as RagThresholdPayload;
    if (payloadHash(payload) !== r.payloadHash) throw conflict('config.rag_thresholds.payload_changed', 'The proposal no longer matches what was submitted — it cannot be decided');
    return { pin, r, payload };
  }

  async approve(ctx: RequestContext, projectId: string, requestId: string, body: RouteInput<R['approveRagThresholds']>['body']) {
    const { r, payload } = await this.decide(ctx, projectId, requestId, body.expectedVersion, 'approve');
    // The approver decides on "from → to": if the thresholds in force changed since the proposal (e.g. a template upgrade
    // changed the template default), the proposal is stale and must be withdrawn and proposed again.
    const inForce = await this.reader.inForce(projectId);
    const basis = payload.basedOn;
    if (basis.ref.source !== inForce.ref.source || basis.ref.versionNo !== inForce.ref.versionNo || !sameRagThresholds(basis.thresholds, inForce.thresholds)) {
      throw conflict('config.rag_thresholds.basis_changed', 'The thresholds in force changed since this proposal — withdraw it and propose again', { basedOn: basis, inForce: { ref: inForce.ref, thresholds: inForce.thresholds } });
    }
    const row = await updateVersioned(this.s.db, AR, { id: requestId, projectId, expectedVersion: body.expectedVersion }, { status: 'approved' });
    await this.s.db
      .tx()
      .insert(schema.approvalRecord)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        approvalRequestId: requestId,
        approverUserId: ctx.principal.userId!,
        decision: 'approve',
        comment: body.note ?? null,
        authorityBasis: `${APPROVE_PERMISSION} (role grant; approver is not the proposer)`,
        payloadHash: r.payloadHash,
      });
    await this.s.versions.snapshot({ projectId, entityType: 'rag_thresholds', entityId: projectId, versionNo: payload.versionNo, snapshot: { thresholds: payload.thresholds, approvalRequestId: requestId, approvedBy: ctx.principal.userId }, reason: 'approved' });
    await this.s.audit.record({
      action: 'config.rag_thresholds.approve',
      entityType: 'project',
      entityId: projectId,
      projectId,
      before: { thresholds: inForce.thresholds, ref: inForce.ref },
      after: { approvalRequestId: requestId, versionNo: payload.versionNo, thresholds: payload.thresholds, inForce: true },
      reason: body.note ?? null,
    });
    return { id: requestId, versionNo: payload.versionNo, state: 'approved' as const, version: row['version'] as number };
  }

  async reject(ctx: RequestContext, projectId: string, requestId: string, body: RouteInput<R['rejectRagThresholds']>['body']) {
    const { r, payload } = await this.decide(ctx, projectId, requestId, body.expectedVersion, 'reject');
    const row = await updateVersioned(this.s.db, AR, { id: requestId, projectId, expectedVersion: body.expectedVersion }, { status: 'rejected' });
    await this.s.db
      .tx()
      .insert(schema.approvalRecord)
      .values({ id: newId(), orgId: ctx.principal.orgId, projectId, approvalRequestId: requestId, approverUserId: ctx.principal.userId!, decision: 'reject', comment: body.reason, authorityBasis: `${APPROVE_PERMISSION} (role grant)`, payloadHash: r.payloadHash });
    await this.s.audit.record({ action: 'config.rag_thresholds.reject', entityType: 'project', entityId: projectId, projectId, after: { approvalRequestId: requestId, versionNo: payload.versionNo, state: 'rejected' }, reason: body.reason });
    return { id: requestId, versionNo: payload.versionNo, state: 'rejected' as const, version: row['version'] as number };
  }

  async withdraw(ctx: RequestContext, projectId: string, requestId: string, body: RouteInput<R['withdrawRagThresholds']>['body']) {
    const pin = await this.s.pinned(projectId);
    this.s.assertProject(ctx, MANAGE_PERMISSION, pin.p);
    await this.s.lock(LOCK, projectId);
    const r = await this.load(projectId, requestId);
    transition('rag_thresholds', RAG_THRESHOLD_MACHINE, r.status as 'pending', 'withdraw');
    if (r.requestedBy !== ctx.principal.userId) throw forbidden('config.rag_thresholds.not_proposer', 'Only the person who proposed the change can withdraw it');
    assertVersion(r, body.expectedVersion, 'threshold change');
    const row = await updateVersioned(this.s.db, AR, { id: requestId, projectId, expectedVersion: body.expectedVersion }, { status: 'withdrawn' });
    const payload = r.payload as unknown as RagThresholdPayload;
    await this.s.audit.record({ action: 'config.rag_thresholds.withdraw', entityType: 'project', entityId: projectId, projectId, after: { approvalRequestId: requestId, versionNo: payload.versionNo, state: 'withdrawn' }, reason: body.note ?? null });
    return { id: requestId, versionNo: payload.versionNo, state: 'withdrawn' as const, version: row['version'] as number };
  }
}
