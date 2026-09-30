import { Injectable, Logger } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, SQL } from 'drizzle-orm';
import { z } from 'zod';
import { schema } from '@hub/db';
import {
  AI_ACTION_PERMISSION,
  AI_AUTOPILOT_ELIGIBLE,
  AI_MESSAGE_ACTIONS,
  aiFlagOf,
  assertActionExecutable,
  conflict,
  DomainError,
  forbidden,
  isApprovalStillValid,
  isWithinQuietHours,
  localHour,
  notFound,
  ruleViolation,
  sanitizeAiText,
  type AiProposableAction,
  type AiToolDef,
  type AutopilotPolicy,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { Clock } from '../../platform/clock';
import { JobQueue, ClaimedJob } from '../../platform/jobs/job-queue.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import { DeliveryService } from '../../platform/delivery.service';
import { isFullScope, RequestContext } from '../../platform/context';
import { loadInProject } from '../../platform/helpers';
import { orderBySort } from '../../platform/sort';
import type { RouteInput, aiRoutes } from '@hub/contracts';
import { newId, payloadHash } from '../../platform/ids';
import { AiConfig } from './ai-config';
import { AiSettingsService, autopilotStatus, type AutopilotPolicyStored, type SettingsRow } from './ai-settings.service';
import { AiKnowledgeService, PROPOSAL_TARGET_TYPES } from './ai-knowledge.service';
import { AiArtifactsService } from './ai-artifacts.service';

export const AI_EXECUTE_JOB = 'ai.execute_proposal';
type ProposalRow = typeof schema.aiProposal.$inferSelect;
type ApprovalRow = typeof schema.aiActionApproval.$inferSelect;

const Target = { targetType: z.enum(PROPOSAL_TARGET_TYPES).optional(), targetId: z.string().uuid().optional() };
const MessageArgs = z
  .object({ recipientUserId: z.string().uuid(), title: z.string().trim().min(1).max(200), body: z.string().trim().max(500).default(''), channel: z.enum(['in_app', 'email', 'teams', 'sms']).default('in_app'), ...Target })
  .strict();
const DraftArgs = z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(8000), ...Target }).strict();
const TaskArgs = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(), workstreamId: z.string().uuid().optional(), dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), ...Target }).strict();
const RiskArgs = z.object({ title: z.string().trim().min(1).max(200), description: z.string().trim().max(2000).optional(), workstreamId: z.string().uuid().optional(), probability: z.number().int().min(1).max(5).optional(), impact: z.number().int().min(1).max(5).optional(), ...Target }).strict();

const ARGS: Record<Exclude<AiProposableAction, 'prepare_approval_request'>, z.ZodTypeAny> = {
  create_internal_notification: MessageArgs,
  request_update_from_owner: MessageArgs,
  create_follow_up_task: TaskArgs,
  flag_risk: RiskArgs,
  draft_agenda: DraftArgs,
  draft_minutes: DraftArgs,
  draft_decision_paper: DraftArgs,
  draft_status_summary: DraftArgs,
};

/** Any e-mail address or external address field in model-supplied arguments → DESTINATION_NOT_APPROVED (AIT-01/04/07). */
function externalDestination(args: Record<string, unknown>): boolean {
  const json = JSON.stringify(args ?? {});
  return /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(json) || Object.keys(args ?? {}).some((k) => /email|address|^to$|recipients?$|phone|webhook|url/i.test(k));
}

export interface ProposalRefusal {
  refused: true;
  reason: string;
  audit: 'AI_TOOL_DENIED' | 'DESTINATION_NOT_APPROVED';
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * AI proposals and human approvals (spec §12.3–12.4, AT-18, AT-20, C-21).
 * - Proposals exist only for AI_PROPOSABLE_ACTIONS and only when the delegating user holds the underlying
 *   `ai: propose` permission. Prohibited actions are not tools at all.
 * - An approval binds payload hash + target version + approver + expiry; it is single-use. Any change invalidates it.
 * - Execution happens in the worker; it re-validates everything (mode, kill switch, approver and requester still
 *   authorised, recipients, payload hash, target version, expiry, autopilot allowlist/rate/quiet hours) and applies the
 *   effect + consumes the approval + marks the proposal executed in ONE transaction (no duplicate on retry — AT-20).
 * - The AI is never recorded as an approver: approvals are only created by an interactive human session.
 */
@Injectable()
export class AiProposalsService {
  private readonly log = new Logger('ai-proposals');
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    private readonly contexts: JobContextFactory,
    private readonly delivery: DeliveryService,
    private readonly cfg: AiConfig,
    private readonly settings: AiSettingsService,
    private readonly knowledge: AiKnowledgeService,
    private readonly artifacts: AiArtifactsService,
  ) {}

  // ---------------------------------------------------------------------------------------------------------
  // Creation (called by the runtime for a model tool call, in the delegating user's transaction)

  async createFromTool(ctx: RequestContext, projectId: string, run: { id: string; requestedBy: string | null }, tool: AiToolDef, rawArgs: Record<string, unknown>, s: SettingsRow): Promise<{ proposal: ProposalRow } | ProposalRefusal> {
    const action = tool.action!;
    const refuse = async (reason: string, code: ProposalRefusal['audit'] = 'AI_TOOL_DENIED'): Promise<ProposalRefusal> => {
      await this.audit.record({ action: code, entityType: 'ai_run', entityId: run.id, projectId, outcome: 'denied', reason: `${tool.name}: ${reason}` });
      return { refused: true, reason, audit: code };
    };
    const perm = AI_ACTION_PERMISSION[action];
    if (!perm || aiFlagOf(perm) !== 'propose' || !this.policy.canInProject(ctx, perm, projectId)) return refuse(`delegating user lacks ${perm ?? 'a proposable permission'}`);
    if (externalDestination(rawArgs)) return refuse('external or unapproved destination', 'DESTINATION_NOT_APPROVED');
    const schemaFor = ARGS[action as keyof typeof ARGS];
    const parsed = schemaFor.safeParse(rawArgs ?? {});
    if (!parsed.success) return refuse(`invalid arguments (${parsed.error.issues.map((i) => i.path.join('.') || i.message).slice(0, 3).join(', ')})`);
    const v = await this.validatePayload(ctx, projectId, action, parsed.data as Record<string, unknown>);
    if ('error' in v) return refuse(v.error, v.code);
    const payload = v.payload;
    const idempotencyKey = `ai:${run.id}:${action}:${(payload.targetId as string | undefined) ?? '-'}:${(payload.recipientUserId as string | undefined) ?? '-'}`.slice(0, 200);
    const tx = this.db.tx();
    const [inserted] = await tx
      .insert(schema.aiProposal)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        runId: run.id,
        actionType: action,
        targetType: (payload.targetType as string | undefined) ?? null,
        targetId: (payload.targetId as string | undefined) ?? null,
        targetVersion: v.targetVersion,
        payload,
        payloadHash: payloadHash(payload),
        rationale: (payload.rationale as string | undefined) ?? null,
        citations: payload.targetType && payload.targetId ? [{ type: String(payload.targetType), id: String(payload.targetId) }] : [],
        policyVersion: s.policyVersion,
        idempotencyKey,
      })
      .onConflictDoNothing({ target: schema.aiProposal.idempotencyKey })
      .returning();
    const proposal = inserted ?? (await tx.select().from(schema.aiProposal).where(eq(schema.aiProposal.idempotencyKey, idempotencyKey)))[0]!;
    if (inserted) {
      await this.audit.record({ action: 'ai.proposal.create', entityType: 'ai_proposal', entityId: proposal.id, projectId, after: { actionType: action, targetType: proposal.targetType, targetId: proposal.targetId, targetVersion: proposal.targetVersion, payloadHash: proposal.payloadHash } });
      // Policy-limited autopilot: allowlisted actions are executed by the worker without a human approval, subject to
      // the approved policy, limits, expiry and quiet hours (re-checked at execution).
      const today = this.clock.today(await this.settings.projectTimezone(projectId));
      const p = s.autopilotPolicy as AutopilotPolicyStored | null;
      if (s.mode === 'autopilot' && autopilotStatus(p, today) === 'approved' && p!.allowlist.includes(action) && AI_AUTOPILOT_ELIGIBLE.includes(action)) {
        await this.queue.enqueue({ kind: AI_EXECUTE_JOB, orgId: ctx.principal.orgId, projectId, payload: { proposalId: proposal.id, autopilot: true }, idempotencyKey: `ai-exec:${proposal.id}:autopilot`, requestedBy: run.requestedBy });
      }
    }
    return { proposal };
  }

  /**
   * Validates a proposal payload for the delegating user: same-project target visible to the user; recipients are
   * active internal full project members who can see the target (AIT-07, AIT-26). Returns the canonical payload.
   */
  private async validatePayload(
    ctx: RequestContext,
    projectId: string,
    action: AiProposableAction,
    args: Record<string, unknown>,
  ): Promise<{ payload: Record<string, unknown>; targetVersion: number | null } | { error: string; code: ProposalRefusal['audit'] }> {
    const targetType = (args.targetType as string | undefined) ?? null;
    const targetId = (args.targetId as string | undefined) ?? null;
    if (!!targetType !== !!targetId) return { error: 'target type and id must be given together', code: 'AI_TOOL_DENIED' };
    let targetVersion: number | null = null;
    if (targetType && targetId) {
      const tv = await this.knowledge.targetVersion(projectId, targetType, targetId);
      const visible = await this.knowledge.visibleCitationKeys(ctx, projectId, [{ type: targetType, id: targetId }]);
      if (tv === 'missing' || !visible.has(`${targetType}:${targetId}`)) return { error: 'target not found', code: 'AI_TOOL_DENIED' };
      targetVersion = tv;
    }
    if (typeof args.workstreamId === 'string') {
      try {
        await loadInProject(this.db, schema.workstream, projectId, args.workstreamId);
      } catch {
        return { error: 'workstream not found', code: 'AI_TOOL_DENIED' };
      }
    }
    const clean = (t: unknown) => (typeof t === 'string' ? sanitizeAiText(t).text : t);
    const payload: Record<string, unknown> = { action };
    for (const [k, val] of Object.entries(args)) if (val !== undefined) payload[k] = typeof val === 'string' && k !== 'recipientUserId' && k !== 'targetId' && k !== 'workstreamId' ? clean(val) : val;
    if ((AI_MESSAGE_ACTIONS as string[]).includes(action)) {
      const recipientUserId = String(args.recipientUserId);
      const ok = await this.recipientAllowed(ctx.principal.orgId, projectId, recipientUserId, targetType, targetId);
      if (!ok) return { error: 'recipient is not an authorised internal project member for this content', code: 'DESTINATION_NOT_APPROVED' };
    }
    return { payload, targetVersion };
  }

  /** Recipient re-authorisation (creation, approval AND execution): active, internal, full project member who can see the target. */
  async recipientAllowed(orgId: string, projectId: string, userId: string, targetType: string | null, targetId: string | null): Promise<boolean> {
    const u = await this.db.query<{ is_active: boolean; is_service_account: boolean; org_id: string }>(`select is_active, is_service_account, org_id from hub_auth_user_by_id($1)`, [userId]);
    const row = u.rows[0];
    if (!row || !row.is_active || row.is_service_account || row.org_id !== orgId) return false;
    const rctx = await this.contexts.forUser(userId, projectId);
    const scope = rctx?.principal.projects.get(projectId);
    if (!rctx || !scope || !isFullScope(scope)) return false;
    if (!targetType || !targetId) return true;
    // Intersection of the current transaction's RLS scope and the recipient's ACL predicates.
    const visible = await this.knowledge.visibleCitationKeys(rctx, projectId, [{ type: targetType, id: targetId }]);
    return visible.has(`${targetType}:${targetId}`);
  }

  // ---------------------------------------------------------------------------------------------------------
  // Human review (interactive session)

  private async loadProposal(projectId: string, proposalId: string) {
    return (await loadInProject(this.db, schema.aiProposal, projectId, proposalId)) as ProposalRow;
  }

  private async requesterOf(p: ProposalRow): Promise<string | null> {
    if (!p.runId) return null;
    const [r] = await this.db.tx().select({ requestedBy: schema.aiRun.requestedBy }).from(schema.aiRun).where(and(eq(schema.aiRun.id, p.runId), eq(schema.aiRun.projectId, p.projectId)));
    return r?.requestedBy ?? null;
  }

  async approve(ctx: RequestContext, projectId: string, proposalId: string, body: { expectedVersion: number; note?: string }) {
    const p = await this.loadProposal(projectId, proposalId);
    const perm = AI_ACTION_PERMISSION[p.actionType as AiProposableAction];
    if (!perm) throw ruleViolation('ai.not_executable', 'This proposal type is a prepared request and cannot be executed');
    const requester = await this.requesterOf(p);
    // authority: the approver must independently hold the underlying action permission (access-matrix §5.2).
    const withinAuthority = this.policy.canInProject(ctx, perm, projectId);
    // Separation of duties first (specific error): the person on whose behalf the AI proposed may not approve it. The policy
    // matrix carries the same not_self condition (defence in depth).
    AiSettingsService.assertNotSelf(ctx, requester, 'Separation of duties: the requester of an AI proposal cannot approve it');
    this.policy.assert(ctx, 'ai.proposal.approve', { projectId, withinAuthority, requesterUserId: requester });
    if (p.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'The proposal was changed — reload and review before approving', { currentVersion: p.version });
    if (p.status !== 'proposed') throw conflict('ai.proposal_not_pending', `The proposal is ${p.status}`);
    const s = await this.settings.load(projectId);
    if (s.killSwitch) throw ruleViolation('ai.kill_switch', 'AI emergency stop is active');
    if (s.mode !== 'assisted' && s.mode !== 'autopilot') throw ruleViolation('ai.mode_forbids_execution', `AI mode "${s.mode}" does not allow executing proposals`);
    if (payloadHash(p.payload) !== p.payloadHash) {
      await this.invalidateDetached(ctx, p, 'payload_changed');
      throw conflict('ai.approval_invalidated', 'The proposal payload no longer matches its hash — a fresh proposal is required');
    }
    const tv = await this.knowledge.targetVersion(projectId, p.targetType, p.targetId);
    if (tv === 'missing' || tv !== p.targetVersion) {
      await this.invalidateDetached(ctx, p, 'target_version_changed');
      throw conflict('ai.approval_invalidated', 'The target record changed after the proposal was prepared — a fresh review is required');
    }
    const recipient = (p.payload as { recipientUserId?: string }).recipientUserId;
    if (recipient && !(await this.recipientAllowed(ctx.principal.orgId, projectId, recipient, p.targetType, p.targetId))) {
      throw ruleViolation('DESTINATION_NOT_APPROVED', 'The recipient is no longer an authorised project member for this content');
    }
    const now = this.clock.now();
    const approvalId = newId();
    await this.db
      .tx()
      .insert(schema.aiActionApproval)
      .values({ id: approvalId, orgId: ctx.principal.orgId, projectId, proposalId, approverUserId: ctx.principal.userId!, payloadHash: p.payloadHash, targetVersion: p.targetVersion, expiresAt: new Date(now.getTime() + this.cfg.approvalValidityHours * 3_600_000), status: 'valid' });
    const [updated] = await this.db
      .tx()
      .update(schema.aiProposal)
      .set({ status: 'approved', updatedAt: now, version: sql`${schema.aiProposal.version} + 1` })
      .where(and(eq(schema.aiProposal.id, proposalId), eq(schema.aiProposal.projectId, projectId), eq(schema.aiProposal.version, body.expectedVersion)))
      .returning();
    if (!updated) throw conflict('concurrency.version_mismatch', 'The proposal was changed — reload and review before approving');
    await this.audit.record({ action: 'ai.proposal.approve', entityType: 'ai_proposal', entityId: proposalId, projectId, reason: body.note ?? null, after: { approvalId, payloadHash: p.payloadHash, targetVersion: p.targetVersion, approver: ctx.principal.userId } });
    await this.queue.enqueue({ kind: AI_EXECUTE_JOB, orgId: ctx.principal.orgId, projectId, payload: { proposalId, approvalId }, idempotencyKey: `ai-exec:${proposalId}:${approvalId}`, requestedBy: ctx.principal.userId });
    return this.get(ctx, projectId, proposalId);
  }

  async reject(ctx: RequestContext, projectId: string, proposalId: string, body: { expectedVersion: number; note: string }) {
    const p = await this.loadProposal(projectId, proposalId);
    this.policy.assert(ctx, 'ai.proposal.reject', { projectId });
    if (p.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'The proposal was changed — reload and review');
    if (p.status !== 'proposed' && p.status !== 'approved') throw conflict('ai.proposal_not_pending', `The proposal is ${p.status}`);
    await this.db.tx().update(schema.aiActionApproval).set({ status: 'invalidated', invalidatedReason: 'proposal_rejected' }).where(and(eq(schema.aiActionApproval.proposalId, proposalId), eq(schema.aiActionApproval.projectId, projectId), eq(schema.aiActionApproval.status, 'valid')));
    await this.db
      .tx()
      .update(schema.aiProposal)
      .set({ status: 'rejected', invalidatedReason: `rejected: ${body.note}`.slice(0, 1000), updatedAt: this.clock.now(), version: sql`${schema.aiProposal.version} + 1` })
      .where(and(eq(schema.aiProposal.id, proposalId), eq(schema.aiProposal.projectId, projectId)));
    await this.audit.record({ action: 'ai.proposal.reject', entityType: 'ai_proposal', entityId: proposalId, projectId, reason: body.note });
    return this.get(ctx, projectId, proposalId);
  }

  /** Requester revises the payload → new hash, existing approvals invalidated, fresh review required (AT-18). */
  async revise(ctx: RequestContext, projectId: string, proposalId: string, body: { expectedVersion: number; payload: Record<string, unknown>; note?: string }) {
    const p = await this.loadProposal(projectId, proposalId);
    this.policy.assert(ctx, 'ai.assistant.use', { projectId });
    const requester = await this.requesterOf(p);
    if (!requester || requester !== ctx.principal.userId) throw forbidden('ai.not_requester', 'Only the person on whose behalf the proposal was prepared can revise it');
    if (p.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'The proposal was changed — reload and review');
    if (!['proposed', 'approved', 'invalidated'].includes(p.status)) throw conflict('ai.proposal_not_pending', `The proposal is ${p.status}`);
    const action = p.actionType as AiProposableAction;
    const schemaFor = ARGS[action as keyof typeof ARGS];
    if (!schemaFor) throw ruleViolation('ai.not_revisable', 'This proposal cannot be revised');
    const { action: _a, ...rest } = body.payload;
    void _a;
    if (externalDestination(rest)) throw ruleViolation('DESTINATION_NOT_APPROVED', 'External or unapproved destination');
    const parsed = schemaFor.safeParse(rest);
    if (!parsed.success) throw ruleViolation('ai.invalid_payload', 'Invalid proposal payload', { issues: parsed.error.issues.map((i) => i.path.join('.')) });
    const v = await this.validatePayload(ctx, projectId, action, parsed.data as Record<string, unknown>);
    if ('error' in v) throw ruleViolation(v.code, v.error);
    const n = await this.invalidateApprovals(proposalId, projectId, 'payload_changed');
    const [updated] = await this.db
      .tx()
      .update(schema.aiProposal)
      .set({
        payload: v.payload,
        payloadHash: payloadHash(v.payload),
        targetType: (v.payload.targetType as string | undefined) ?? null,
        targetId: (v.payload.targetId as string | undefined) ?? null,
        targetVersion: v.targetVersion,
        status: 'proposed',
        invalidatedReason: null,
        updatedAt: this.clock.now(),
        version: sql`${schema.aiProposal.version} + 1`,
      })
      .where(and(eq(schema.aiProposal.id, proposalId), eq(schema.aiProposal.projectId, projectId), eq(schema.aiProposal.version, body.expectedVersion)))
      .returning();
    if (!updated) throw conflict('concurrency.version_mismatch', 'The proposal was changed — reload and review');
    if (n > 0) await this.audit.record({ action: 'AI_APPROVAL_INVALIDATED', entityType: 'ai_proposal', entityId: proposalId, projectId, outcome: 'rejected', reason: 'payload_changed (revised by requester)' });
    await this.audit.record({ action: 'ai.proposal.revise', entityType: 'ai_proposal', entityId: proposalId, projectId, reason: body.note ?? null, before: { payloadHash: p.payloadHash }, after: { payloadHash: updated.payloadHash } });
    return this.get(ctx, projectId, proposalId);
  }

  private async invalidateApprovals(proposalId: string, projectId: string, reason: string): Promise<number> {
    const r = await this.db
      .tx()
      .update(schema.aiActionApproval)
      .set({ status: 'invalidated', invalidatedReason: reason })
      .where(and(eq(schema.aiActionApproval.proposalId, proposalId), eq(schema.aiActionApproval.projectId, projectId), eq(schema.aiActionApproval.status, 'valid')))
      .returning({ id: schema.aiActionApproval.id });
    return r.length;
  }

  /**
   * The same invalidation when the caller then REFUSES the request (409 ai.approval_invalidated): the refusal rolls the
   * request transaction back, so the invalidation and its AI_APPROVAL_INVALIDATED audit row are written in an autonomous
   * transaction (as the refused cutover GO, readiness module) — otherwise the proposal stayed "proposed" with nothing
   * recorded. Safe here: approve() has not written or locked the proposal or its approvals before this point.
   */
  private async invalidateDetached(ctx: RequestContext, p: ProposalRow, reason: string) {
    await this.db.runDetached(ctx, async (tx) => {
      await tx
        .update(schema.aiActionApproval)
        .set({ status: 'invalidated', invalidatedReason: reason })
        .where(and(eq(schema.aiActionApproval.proposalId, p.id), eq(schema.aiActionApproval.projectId, p.projectId), eq(schema.aiActionApproval.status, 'valid')));
      await tx
        .update(schema.aiProposal)
        .set({ status: 'invalidated', invalidatedReason: reason, updatedAt: this.clock.now(), version: sql`${schema.aiProposal.version} + 1` })
        .where(and(eq(schema.aiProposal.id, p.id), eq(schema.aiProposal.projectId, p.projectId), inArray(schema.aiProposal.status, ['proposed', 'approved', 'executing'])));
    });
    await this.audit.recordDetached(ctx, { action: 'AI_APPROVAL_INVALIDATED', entityType: 'ai_proposal', entityId: p.id, projectId: p.projectId, outcome: 'rejected', reason });
  }

  /** Marks the proposal (and its valid approvals) invalidated and audits AI_APPROVAL_INVALIDATED. Current transaction. */
  private async invalidate(p: ProposalRow, approval: ApprovalRow | null, reason: string) {
    await this.invalidateApprovals(p.id, p.projectId, reason);
    await this.db
      .tx()
      .update(schema.aiProposal)
      .set({ status: 'invalidated', invalidatedReason: reason, updatedAt: this.clock.now(), version: sql`${schema.aiProposal.version} + 1` })
      .where(and(eq(schema.aiProposal.id, p.id), eq(schema.aiProposal.projectId, p.projectId), inArray(schema.aiProposal.status, ['proposed', 'approved', 'executing'])));
    await this.audit.record({ action: 'AI_APPROVAL_INVALIDATED', entityType: 'ai_proposal', entityId: p.id, projectId: p.projectId, outcome: 'rejected', reason: `${reason}${approval ? ` (approval ${approval.id})` : ''}` });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Reads

  async get(ctx: RequestContext, projectId: string, proposalId: string) {
    const p = await this.loadProposal(projectId, proposalId);
    const [dto] = await this.toDtos(projectId, [p]);
    return dto!;
  }

  async list(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; status?: string; sort?: RouteInput<typeof aiRoutes.listProposals>['query']['sort'] }) {
    this.policy.assert(ctx, 'ai.proposal.read', { projectId });
    const conds: SQL[] = [eq(schema.aiProposal.projectId, projectId), this.targetVisibleSql(ctx, projectId)];
    if (q.status) conds.push(eq(schema.aiProposal.status, q.status as ProposalRow['status']));
    const where = and(...conds);
    const [{ n }] = (await this.db.tx().select({ n: sql<number>`count(*)::int` }).from(schema.aiProposal).where(where)) as [{ n: number }];
    const rows = await this.db
      .tx()
      .select()
      .from(schema.aiProposal)
      .where(where)
      .orderBy(
        ...orderBySort(
          q.sort,
          { createdAt: schema.aiProposal.createdAt, updatedAt: schema.aiProposal.updatedAt, status: schema.aiProposal.status, actionType: schema.aiProposal.actionType },
          schema.aiProposal.id,
          [desc(schema.aiProposal.createdAt), desc(schema.aiProposal.id)],
        ),
      )
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize);
    return { items: await this.toDtos(projectId, rows), page: q.page, pageSize: q.pageSize, total: n };
  }

  /** Proposals are listed only when their target is visible to the reader (classification / workstream reach in SQL). */
  private targetVisibleSql(ctx: RequestContext, projectId: string): SQL {
    const decVis = this.policy.visibilitySql(ctx, projectId, { classification: schema.decision.classification });
    const taskReach = this.policy.reachSql(ctx, 'planning.plan.read', projectId, schema.task.workstreamId);
    return sql`(${schema.aiProposal.targetType} is null
      or (${schema.aiProposal.targetType} = 'decision' and exists (select 1 from decision where decision.id = ${schema.aiProposal.targetId} and decision.project_id = ${projectId} and ${decVis}))
      or (${schema.aiProposal.targetType} = 'task' and exists (select 1 from task where task.id = ${schema.aiProposal.targetId} and task.project_id = ${projectId} and ${taskReach}))
      or ${schema.aiProposal.targetType} not in ('decision', 'task'))`;
  }

  private async toDtos(projectId: string, rows: ProposalRow[]) {
    if (!rows.length) return [];
    const ids = rows.map((r) => r.id);
    const approvals = await this.db.tx().select().from(schema.aiActionApproval).where(and(eq(schema.aiActionApproval.projectId, projectId), inArray(schema.aiActionApproval.proposalId, ids))).orderBy(asc(schema.aiActionApproval.createdAt));
    const runIds = [...new Set(rows.map((r) => r.runId).filter((x): x is string => !!x))];
    const runs = runIds.length ? await this.db.tx().select({ id: schema.aiRun.id, requestedBy: schema.aiRun.requestedBy, provider: schema.aiRun.provider }).from(schema.aiRun).where(and(eq(schema.aiRun.projectId, projectId), inArray(schema.aiRun.id, runIds))) : [];
    return rows.map((r) => {
      const run = runs.find((x) => x.id === r.runId);
      return {
        id: r.id,
        runId: r.runId,
        actionType: r.actionType,
        targetType: r.targetType,
        targetId: r.targetId,
        targetVersion: r.targetVersion,
        payload: r.payload,
        payloadHash: r.payloadHash,
        rationale: r.rationale,
        citations: r.citations.map((c) => ({ type: c.type, id: c.id, ...(c.label !== undefined ? { label: c.label } : {}), ...(c.location !== undefined ? { location: c.location } : {}) })),
        status: r.status,
        requestedBy: run?.requestedBy ?? null,
        policyVersion: r.policyVersion,
        invalidatedReason: r.invalidatedReason,
        executionResult: r.executionResult ?? null,
        executedAt: iso(r.executedAt),
        createdAt: r.createdAt.toISOString(),
        version: r.version,
        approvals: approvals
          .filter((a) => a.proposalId === r.id)
          .map((a) => ({ id: a.id, approverUserId: a.approverUserId, status: a.status, expiresAt: a.expiresAt.toISOString(), targetVersion: a.targetVersion, invalidatedReason: a.invalidatedReason, createdAt: a.createdAt.toISOString() })),
        simulated: run?.provider === 'mock',
      };
    });
  }

  // ---------------------------------------------------------------------------------------------------------
  // Execution (worker)

  async executeJob(job: ClaimedJob): Promise<Record<string, unknown>> {
    const projectId = job.project_id;
    const proposalId = typeof job.payload['proposalId'] === 'string' ? job.payload['proposalId'] : null;
    const approvalId = typeof job.payload['approvalId'] === 'string' ? job.payload['approvalId'] : null;
    const autopilot = job.payload['autopilot'] === true;
    if (!projectId || !proposalId) return { skipped: 'no proposal reference' };
    const svc = this.contexts.forService(job, 'svc-ai-pm', []);

    // Phase 1 (service principal, read + possible invalidation): everything that can make the approval invalid.
    const pre = await this.db.run(svc, async () => {
      const [p] = await this.db.tx().select().from(schema.aiProposal).where(and(eq(schema.aiProposal.id, proposalId), eq(schema.aiProposal.projectId, projectId)));
      if (!p) return { stop: { skipped: 'proposal not found' } };
      if (p.status === 'executed') return { stop: { status: 'already_executed' } };
      let approval: ApprovalRow | null = null;
      if (approvalId) {
        const [a] = await this.db.tx().select().from(schema.aiActionApproval).where(and(eq(schema.aiActionApproval.id, approvalId), eq(schema.aiActionApproval.projectId, projectId)));
        if (!a || a.proposalId !== proposalId) {
          await this.audit.record({ action: 'AI_APPROVAL_INVALIDATED', entityType: 'ai_proposal', entityId: proposalId, projectId, outcome: 'rejected', reason: 'APPROVAL_MISMATCH: approval does not belong to this proposal' });
          return { stop: { status: 'approval_mismatch' } };
        }
        if (a.status !== 'valid') return { stop: { status: a.status === 'consumed' ? 'approval_consumed' : 'approval_invalidated' } };
        approval = a;
      } else if (!autopilot) return { stop: { skipped: 'no approval' } };
      if (!['proposed', 'approved'].includes(p.status)) return { stop: { status: `proposal_${p.status}` } };
      const s = await this.settings.load(projectId);
      const tz = await this.settings.projectTimezone(projectId);
      const now = this.clock.now();
      const today = this.clock.today(tz);
      if (s.killSwitch) {
        await this.audit.record({ action: 'AI_KILLSWITCH_BLOCKED', entityType: 'ai_proposal', entityId: p.id, projectId, outcome: 'denied', reason: 'execution blocked by emergency stop' });
        await this.invalidateApprovals(p.id, projectId, 'kill_switch');
        await this.db.tx().update(schema.aiProposal).set({ status: 'cancelled', invalidatedReason: 'kill_switch', updatedAt: now, version: sql`${schema.aiProposal.version} + 1` }).where(eq(schema.aiProposal.id, p.id));
        return { stop: { status: 'cancelled_killswitch' } };
      }
      const [run] = p.runId ? await this.db.tx().select({ requestedBy: schema.aiRun.requestedBy }).from(schema.aiRun).where(eq(schema.aiRun.id, p.runId)) : [];
      const requester = run?.requestedBy ?? null;
      const perm = AI_ACTION_PERMISSION[p.actionType as AiProposableAction];
      const fail = async (reason: string) => {
        await this.invalidate(p, approval, reason);
        return { stop: { status: 'invalidated', reason } };
      };
      if (!perm) return fail('not_executable');
      // Mode / kill switch / autopilot allowlist, rate and expiry (domain rule).
      const actionsToday = await this.autopilotActionsToday(projectId, tz, today);
      const pol = s.autopilotPolicy as AutopilotPolicyStored | null;
      const autopilotPolicy: AutopilotPolicy | null = pol && pol.approvedBy ? { allowlist: pol.allowlist, maxActionsPerDay: pol.maxActionsPerDay, expiresOn: pol.expiresOn, revoked: pol.revoked } : null;
      try {
        assertActionExecutable({ mode: s.mode, killSwitch: s.killSwitch, action: p.actionType, approved: !!approval, autopilot: autopilotPolicy, actionsToday, today });
      } catch (e) {
        if (e instanceof DomainError) return fail(e.code);
        throw e;
      }
      // Delegating user and approver re-authorised with CURRENT assignments (AT-19, AIT-18).
      const requesterCtx = requester ? await this.contexts.forUser(requester, projectId) : null;
      if (!requesterCtx || !this.policy.canInProject(requesterCtx, perm, projectId) || !this.policy.canInProject(requesterCtx, 'ai.assistant.use', projectId)) return fail('requester_no_longer_authorized');
      let approverCtx: RequestContext | null = null;
      if (approval) {
        approverCtx = await this.contexts.forUser(approval.approverUserId, projectId);
        const approverOk = !!approverCtx && this.policy.canInProject(approverCtx, 'ai.proposal.approve', projectId) && this.policy.canInProject(approverCtx, perm, projectId) && approval.approverUserId !== requester;
        const tv = await this.knowledge.targetVersion(projectId, p.targetType, p.targetId);
        const validity = isApprovalStillValid({
          approvedPayloadHash: approval.payloadHash,
          currentPayloadHash: payloadHash(p.payload),
          approvedTargetVersion: approval.targetVersion,
          currentTargetVersion: tv === 'missing' ? -1 : tv,
          expiresAt: approval.expiresAt.toISOString(),
          now: now.toISOString(),
          approverStillAuthorized: approverOk,
        });
        if (!validity.valid) return fail(validity.reason!);
        if (approval.payloadHash !== p.payloadHash) return fail('payload_changed');
      } else {
        const tv = await this.knowledge.targetVersion(projectId, p.targetType, p.targetId);
        if (tv === 'missing' || tv !== p.targetVersion) return fail('target_version_changed');
      }
      const recipient = (p.payload as { recipientUserId?: string }).recipientUserId;
      if (recipient && !(await this.recipientAllowed(job.org_id, projectId, recipient, p.targetType, p.targetId))) return fail('recipient_no_longer_authorized');
      // Quiet hours: defer (not drop) message actions.
      if ((AI_MESSAGE_ACTIONS as string[]).includes(p.actionType)) {
        const h = localHour(now, tz);
        if (isWithinQuietHours(h, s.quietHoursStart, s.quietHoursEnd)) {
          const hours = ((s.quietHoursEnd! - h + 24) % 24) || 24;
          return { defer: new Date(now.getTime() + hours * 3_600_000 - now.getUTCMinutes() * 60_000), requesterId: requester };
        }
      }
      return { go: { p, approval, requesterCtx, approverCtx } };
    });
    if ('stop' in pre) return pre.stop as Record<string, unknown>;
    if ('defer' in pre) {
      const at = pre.defer as Date;
      await this.queue.enqueueDirect({ kind: AI_EXECUTE_JOB, orgId: job.org_id, projectId, payload: job.payload, idempotencyKey: `${job.idempotency_key}:deferred:${at.toISOString().slice(0, 13)}`, runAt: at, requestedBy: job.requested_by });
      return { status: 'deferred_quiet_hours', runAt: at.toISOString() };
    }
    const { p, approval, requesterCtx, approverCtx } = pre.go;
    // Phase 2 (ONE transaction as the accountable human — approver, or the delegating user under autopilot):
    // lock → re-check single use → effect → consume approval → mark executed → audit. Retry-safe (AT-20).
    const actorCtx = approverCtx ?? requesterCtx;
    return this.db.run(actorCtx, async () => {
      const tx = this.db.tx();
      const locked = await this.db.query<{ status: string; version: number }>(`select status, version from ai_proposal where id = $1 and project_id = $2 for update`, [p.id, projectId]);
      if (locked.rows[0]?.status === 'executed') return { status: 'already_executed' };
      if (approval) {
        const a = await this.db.query<{ status: string }>(`select status from ai_action_approval where id = $1 and project_id = $2 for update`, [approval.id, projectId]);
        if (a.rows[0]?.status !== 'valid') return { status: 'approval_consumed' };
      }
      const result: Record<string, unknown> = { mode: approval ? 'approved' : 'autopilot', approvalId: approval?.id ?? null };
      const payload = p.payload as Record<string, unknown>;
      if ((AI_MESSAGE_ACTIONS as string[]).includes(p.actionType)) {
        const recipient = String(payload.recipientUserId);
        const channel = String(payload.channel ?? 'in_app');
        // In-app notification with a dedupe key: a crashed/retried execution can never create a second one.
        // No RETURNING and no conflict target: the row belongs to the recipient and RLS only lets its owner read it back
        // (a targeted ON CONFLICT would apply the SELECT policy). The unique (user_id, dedupe_key) index still deduplicates.
        const notificationId = newId();
        const ins = await this.db.query(
          `insert into notification (id, org_id, project_id, user_id, kind, title, body, link, channel, delivery_status, dedupe_key, source_type, source_id, ai_proposal_id)
           values ($1, $2, $3, $4, 'ai_action', $5, $6, $7, 'in_app', 'sent', $8, $9, $10, $11)
           on conflict do nothing`,
          [notificationId, actorCtx.principal.orgId, projectId, recipient, String(payload.title), String(payload.body ?? ''), p.targetType && p.targetId ? `/projects/${projectId}/${p.targetType}/${p.targetId}` : `/projects/${projectId}`, `ai-proposal:${p.id}`, p.targetType, p.targetId, p.id],
        );
        result.notificationId = (ins.rowCount ?? 0) > 0 ? notificationId : null;
        result.deduplicated = (ins.rowCount ?? 0) === 0;
        if (channel !== 'in_app') {
          // Teams/Email/SMS stay disabled until authorised destinations and sending authority exist (spec §12.4).
          const d = await this.delivery.begin({ orgId: actorCtx.principal.orgId, projectId, idempotencyKey: `ai:${p.id}:${channel}`, channel: channel as 'email', recipientUserId: recipient, payload: { proposalId: p.id, title: payload.title } });
          if (d.proceed && d.id) await this.delivery.finish(d.id, { status: 'disabled', detail: `${channel} channel disabled: no authorised destination / sending authority configured` });
          result.externalChannel = { channel, status: 'disabled' };
        }
      } else {
        // The draft belongs to the delegating user (keyed by THEIR ACL fingerprint); nothing is written to the owning module.
        const artifactId = await this.artifacts.store(requesterCtx, projectId, `draft_${p.actionType}`, p.targetType && p.targetId ? [{ type: p.targetType, id: p.targetId }] : [], {
          ...payload,
          label: 'AI-generated draft — requires human review; creates no record in the owning module',
          proposalId: p.id,
        });
        result.artifactId = artifactId;
      }
      if (approval) await tx.update(schema.aiActionApproval).set({ status: 'consumed' }).where(eq(schema.aiActionApproval.id, approval.id));
      const now = this.clock.now();
      await tx
        .update(schema.aiProposal)
        .set({ status: 'executed', executedAt: now, executionResult: result, updatedAt: now, version: sql`${schema.aiProposal.version} + 1` })
        .where(and(eq(schema.aiProposal.id, p.id), eq(schema.aiProposal.projectId, projectId)));
      await this.audit.record({ action: 'ai.proposal.execute', entityType: 'ai_proposal', entityId: p.id, projectId, after: result });
      return { status: 'executed', ...result };
    });
  }

  private async autopilotActionsToday(projectId: string, tz: string, today: string): Promise<number> {
    const r = await this.db.query<{ n: number }>(
      `select count(*)::int as n from ai_proposal where project_id = $1 and status = 'executed' and execution_result->>'mode' = 'autopilot'
         and (executed_at at time zone $2)::date = $3::date`,
      [projectId, tz, today],
    );
    return r.rows[0]?.n ?? 0;
  }

  /** Test/ops helper: 404 when the proposal is not in the project. */
  async assertExists(projectId: string, proposalId: string) {
    const [p] = await this.db.tx().select({ id: schema.aiProposal.id }).from(schema.aiProposal).where(and(eq(schema.aiProposal.id, proposalId), eq(schema.aiProposal.projectId, projectId)));
    if (!p) throw notFound();
  }
}
