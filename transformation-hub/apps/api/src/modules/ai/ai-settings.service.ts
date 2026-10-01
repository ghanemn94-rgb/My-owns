import { Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import {
  AI_PROVIDER_MAX_CLASSIFICATION,
  classificationWithinCeiling,
  conflict,
  forbidden,
  ruleViolation,
  validateAutopilotPolicy,
  type AiMode,
  type AiProvider,
  type Classification,
} from '@hub/domain';
import type { RouteInput } from '@hub/contracts';
import { aiRoutes } from '@hub/contracts';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { Clock } from '../../platform/clock';
import { JobQueue } from '../../platform/jobs/job-queue.service';
import { nextCronRun } from '../../platform/jobs/worker.service';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { AiConfig } from './ai-config';
import { ProviderRegistry } from './providers/provider-registry';
import { MOCK_MODELS } from './providers/mock.provider';
import { ProviderStatus } from './providers/model-provider';

export type SettingsRow = typeof schema.aiProjectSettings.$inferSelect;
export type AutopilotPolicyStored = NonNullable<SettingsRow['autopilotPolicy']> & { proposedBy?: string | null; approvedAt?: string | null };

/** Job kinds that perform AI work or actions — cancelled by the kill switch (maintenance jobs such as invalidation keep running). */
export const AI_ACTION_JOB_KINDS = ['ai.run', 'ai.briefing', 'ai.execute_proposal'];
export const AI_BRIEFING_JOB = 'ai.briefing';
export const DEFAULT_BRIEFING_CRON = { daily: '30 7 * * *', weekly: '0 8 * * 0' } as const;

/** Defaults for a project that has never configured AI: OFF (spec §12.3). */
export function defaultSettings(orgId: string, projectId: string): SettingsRow {
  return {
    id: '00000000-0000-0000-0000-000000000000',
    orgId,
    projectId,
    mode: 'off',
    provider: 'off',
    model: null,
    killSwitch: false,
    killSwitchBy: null,
    killSwitchAt: null,
    maxClassificationToProvider: 'internal',
    monthlyTokenBudget: 0,
    monthlyCostBudget: null,
    costCurrency: null,
    perRunTokenLimit: 20000,
    perRunTimeoutMs: 60000,
    quietHoursStart: null,
    quietHoursEnd: null,
    briefingCron: null,
    briefingTimezone: 'Asia/Riyadh',
    autopilotPolicy: null,
    policyVersion: 'ai-policy-1',
    circuitOpenUntil: null,
    consecutiveFailures: 0,
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    version: 0,
  };
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export function autopilotStatus(p: AutopilotPolicyStored | null, today: string): 'proposed' | 'approved' | 'revoked' | 'expired' | null {
  if (!p) return null;
  if (p.revoked) return 'revoked';
  if (p.expiresOn && p.expiresOn < today) return 'expired';
  return p.approvedBy ? 'approved' : 'proposed';
}

@Injectable()
export class AiSettingsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    private readonly cfg: AiConfig,
    private readonly providers: ProviderRegistry,
  ) {}

  /** Current settings (defaults when never configured). Runs in the current transaction (RLS applies). */
  async load(projectId: string): Promise<SettingsRow> {
    const rows = await this.db.tx().select().from(schema.aiProjectSettings).where(eq(schema.aiProjectSettings.projectId, projectId));
    if (rows[0]) return rows[0];
    const ctx = this.db.ctx();
    return defaultSettings(ctx.principal.orgId, projectId);
  }

  providerStatus(s: Pick<SettingsRow, 'provider' | 'model'>): ProviderStatus {
    return this.providers.get(s.provider).status(s.model);
  }

  async projectTimezone(projectId: string): Promise<string> {
    const r = await this.db.tx().select({ tz: schema.project.timezone }).from(schema.project).where(eq(schema.project.id, projectId));
    return r[0]?.tz ?? 'Asia/Riyadh';
  }

  toDto(s: SettingsRow, today: string) {
    const p = (s.autopilotPolicy ?? null) as AutopilotPolicyStored | null;
    return {
      projectId: s.projectId,
      mode: s.mode,
      provider: s.provider,
      providerStatus: this.providerStatus(s),
      model: s.model,
      killSwitch: s.killSwitch,
      killSwitchAt: iso(s.killSwitchAt),
      killSwitchBy: s.killSwitchBy,
      maxClassificationToProvider: s.maxClassificationToProvider as Classification,
      monthlyTokenBudget: s.monthlyTokenBudget,
      monthlyCostBudget: s.monthlyCostBudget,
      costCurrency: s.costCurrency,
      perRunTokenLimit: s.perRunTokenLimit,
      perRunTimeoutMs: s.perRunTimeoutMs,
      quietHoursStart: s.quietHoursStart,
      quietHoursEnd: s.quietHoursEnd,
      briefingCron: s.briefingCron,
      briefingTimezone: s.briefingTimezone,
      autopilotPolicy: p
        ? {
            allowlist: p.allowlist,
            maxActionsPerDay: p.maxActionsPerDay,
            expiresOn: p.expiresOn,
            revoked: p.revoked,
            status: autopilotStatus(p, today)!,
            proposedBy: p.proposedBy ?? null,
            approvedBy: p.approvedBy ?? null,
            approvedAt: p.approvedAt ?? null,
          }
        : null,
      policyVersion: s.policyVersion,
      version: s.version,
      updatedAt: s.version === 0 ? null : iso(s.updatedAt),
    };
  }

  async get(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'ai.settings.manage', { projectId });
    const s = await this.load(projectId);
    return this.toDto(s, this.clock.today(await this.projectTimezone(projectId)));
  }

  // -------------------------------------------------------------------------------------------------------
  async update(ctx: RequestContext, projectId: string, body: RouteInput<typeof aiRoutes.updateSettings>['body']) {
    this.policy.assert(ctx, 'ai.settings.manage', { projectId });
    const cur = await this.load(projectId);
    if (cur.version !== body.expectedVersion) {
      throw conflict('concurrency.version_mismatch', 'AI settings were changed by someone else — reload and review before retrying', {
        expectedVersion: body.expectedVersion,
        currentVersion: cur.version,
      });
    }
    const today = this.clock.today(await this.projectTimezone(projectId));
    const next: SettingsRow = { ...cur };
    const provider: AiProvider = body.provider ?? cur.provider;
    let mode: AiMode = body.mode ?? cur.mode;
    // Enabling a provider on a project whose AI is Off defaults to Advisory (spec §12.3).
    if (body.provider && body.provider !== 'off' && cur.mode === 'off' && body.mode === undefined) mode = 'advisory';
    if (provider === 'off' && body.mode === undefined) mode = 'off';
    next.provider = provider;
    next.mode = mode;
    if (body.model !== undefined) next.model = body.model;
    if (body.provider && body.provider !== cur.provider && body.model === undefined) next.model = null;
    for (const k of ['maxClassificationToProvider', 'monthlyTokenBudget', 'monthlyCostBudget', 'costCurrency', 'perRunTokenLimit', 'perRunTimeoutMs', 'quietHoursStart', 'quietHoursEnd', 'briefingCron', 'briefingTimezone'] as const) {
      if (body[k] !== undefined) (next as Record<string, unknown>)[k] = body[k];
    }

    // ---- validation (fail closed) ----
    if (mode !== 'off' && provider === 'off') throw ruleViolation('ai.provider_required', 'An AI mode other than Off requires a provider');
    if (provider === 'mock') {
      if (!this.cfg.allowMock) throw ruleViolation('ai.mock_disabled', 'The mock provider is disabled by configuration (HUB_AI_ALLOW_MOCK=false)');
      if (next.model && !(MOCK_MODELS as readonly string[]).includes(next.model)) throw ruleViolation('ai.invalid_model', `Mock models: ${MOCK_MODELS.join(', ')}`);
      if (next.model && next.model !== 'mock-benign' && !this.cfg.allowEvaluationScripts) throw ruleViolation('ai.invalid_model', 'Evaluation scripts are not allowed in production');
    }
    if (provider === 'openai_compatible' || provider === 'anthropic') {
      const st = this.providerStatus({ provider, model: next.model });
      if (st === 'not_configured') throw ruleViolation('ai.provider_not_configured', 'The provider endpoint is not configured on this deployment');
      if (st === 'egress_not_approved') throw ruleViolation('EGRESS_NOT_APPROVED', 'The provider destination is not on the approved egress allowlist');
    }
    const hardMax = AI_PROVIDER_MAX_CLASSIFICATION[provider];
    if (hardMax && !classificationWithinCeiling(next.maxClassificationToProvider as Classification, hardMax)) {
      throw ruleViolation('ai.ceiling_exceeds_provider_limit', `Provider "${provider}" may receive at most "${hardMax}" content`);
    }
    if (mode !== 'off' && next.monthlyTokenBudget <= 0) throw ruleViolation('ai.budget_required', 'Set a monthly token budget before enabling AI');
    if ((next.monthlyCostBudget === null) !== (next.costCurrency === null) && next.monthlyCostBudget !== null) {
      throw ruleViolation('ai.cost_currency_required', 'A cost budget needs a currency');
    }
    if (next.briefingCron) this.validateCron(next.briefingCron, next.briefingTimezone);
    else this.validateCron(DEFAULT_BRIEFING_CRON.daily, next.briefingTimezone);

    if (body.autopilotPolicy !== undefined) {
      if (body.autopilotPolicy === null) {
        if (mode === 'autopilot') throw ruleViolation('ai.autopilot_policy_required', 'Autopilot mode requires an approved autopilot policy');
        next.autopilotPolicy = null;
      } else {
        const errors = validateAutopilotPolicy(body.autopilotPolicy, today);
        if (errors.length) throw ruleViolation('ai.autopilot_policy_invalid', `Autopilot policy rejected: ${errors.join(', ')}`, { errors });
        // Proposed only — a different person holding ai.autopilot_policy.approve must approve it.
        next.autopilotPolicy = { ...body.autopilotPolicy, revoked: false, proposedBy: ctx.principal.userId, approvedBy: undefined, approvedAt: null } as AutopilotPolicyStored;
      }
    }
    if (mode === 'autopilot' && autopilotStatus(next.autopilotPolicy as AutopilotPolicyStored | null, today) !== 'approved') {
      throw ruleViolation('ai.autopilot_policy_required', 'Autopilot mode requires an approved, unexpired autopilot policy');
    }

    const saved = await this.save(ctx, projectId, cur, next);
    await this.audit.record({
      action: 'ai.settings.manage',
      entityType: 'ai_project_settings',
      entityId: saved.id,
      projectId,
      reason: body.reason ?? null,
      before: this.auditImage(cur),
      after: this.auditImage(saved),
    });
    // Briefing cron → the requesting user's own durable schedule (only if they may receive briefings).
    if (body.briefingCron !== undefined && body.briefingCron !== null && this.policy.canInProject(ctx, 'ai.briefing.subscribe', projectId)) {
      await this.upsertBriefing(ctx, projectId, { kind: 'daily', cron: body.briefingCron, timezone: saved.briefingTimezone, enabled: true });
    }
    return this.toDto(saved, today);
  }

  private auditImage(s: SettingsRow) {
    return {
      mode: s.mode,
      provider: s.provider,
      model: s.model,
      maxClassificationToProvider: s.maxClassificationToProvider,
      monthlyTokenBudget: s.monthlyTokenBudget,
      monthlyCostBudget: s.monthlyCostBudget,
      perRunTokenLimit: s.perRunTokenLimit,
      quietHours: [s.quietHoursStart, s.quietHoursEnd],
      briefingCron: s.briefingCron,
      briefingTimezone: s.briefingTimezone,
      autopilotPolicy: s.autopilotPolicy,
      killSwitch: s.killSwitch,
      version: s.version,
    };
  }

  private validateCron(cron: string, tz: string) {
    try {
      nextCronRun(cron, tz, this.clock.now());
    } catch {
      throw ruleViolation('ai.invalid_schedule', 'Invalid cron expression or timezone');
    }
  }

  /** Insert or version-checked update of the settings row. */
  private async save(ctx: RequestContext, projectId: string, cur: SettingsRow, next: SettingsRow): Promise<SettingsRow> {
    const tx = this.db.tx();
    const values = {
      mode: next.mode,
      provider: next.provider,
      model: next.model,
      killSwitch: next.killSwitch,
      killSwitchBy: next.killSwitchBy,
      killSwitchAt: next.killSwitchAt,
      maxClassificationToProvider: next.maxClassificationToProvider,
      monthlyTokenBudget: next.monthlyTokenBudget,
      monthlyCostBudget: next.monthlyCostBudget,
      costCurrency: next.costCurrency,
      perRunTokenLimit: next.perRunTokenLimit,
      perRunTimeoutMs: next.perRunTimeoutMs,
      quietHoursStart: next.quietHoursStart,
      quietHoursEnd: next.quietHoursEnd,
      briefingCron: next.briefingCron,
      briefingTimezone: next.briefingTimezone,
      autopilotPolicy: next.autopilotPolicy,
      updatedBy: ctx.principal.userId,
      updatedAt: this.clock.now(),
    };
    if (cur.version === 0) {
      const [row] = await tx
        .insert(schema.aiProjectSettings)
        .values({ id: newId(), orgId: ctx.principal.orgId, projectId, ...values, version: 1 })
        .onConflictDoNothing()
        .returning();
      if (!row) throw conflict('concurrency.version_mismatch', 'AI settings were created concurrently — reload and review before retrying');
      return row;
    }
    const [row] = await tx
      .update(schema.aiProjectSettings)
      .set({ ...values, version: sql`${schema.aiProjectSettings.version} + 1` })
      .where(and(eq(schema.aiProjectSettings.projectId, projectId), eq(schema.aiProjectSettings.version, cur.version)))
      .returning();
    if (!row) throw conflict('concurrency.version_mismatch', 'AI settings were changed by someone else — reload and review before retrying');
    return row;
  }

  // -------------------------------------------------------------------------------------------------------
  async approveAutopilot(ctx: RequestContext, projectId: string, body: { expectedVersion: number; note?: string }) {
    const cur = await this.load(projectId);
    const p = cur.autopilotPolicy as AutopilotPolicyStored | null;
    // not_self: the proposer of the policy may not approve it (access-matrix §5.1); a proposal without a known proposer
    // fails closed (I-R3). With no proposal at all only the role is checked and the command is refused below (422).
    if (p) this.policy.assert(ctx, 'ai.autopilot_policy.approve', { projectId, requesterUserId: p.proposedBy ?? null, withinAuthority: true });
    else this.policy.assertGranted(ctx, 'ai.autopilot_policy.approve', { projectId });
    if (cur.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'AI settings were changed by someone else — reload and review before retrying');
    const today = this.clock.today(await this.projectTimezone(projectId));
    if (!p || autopilotStatus(p, today) !== 'proposed') throw ruleViolation('ai.no_proposed_policy', 'There is no proposed autopilot policy to approve');
    const errors = validateAutopilotPolicy(p, today);
    if (errors.length) throw ruleViolation('ai.autopilot_policy_invalid', `Autopilot policy rejected: ${errors.join(', ')}`, { errors });
    const next = { ...cur, autopilotPolicy: { ...p, approvedBy: ctx.principal.userId!, approvedAt: this.clock.now().toISOString() } as AutopilotPolicyStored };
    const saved = await this.save(ctx, projectId, cur, next);
    await this.audit.record({ action: 'ai.autopilot_policy.approve', entityType: 'ai_project_settings', entityId: saved.id, projectId, reason: body.note ?? null, after: { autopilotPolicy: saved.autopilotPolicy } });
    return this.toDto(saved, today);
  }

  async revokeAutopilot(ctx: RequestContext, projectId: string, body: { expectedVersion: number; reason: string }) {
    this.policy.assert(ctx, 'ai.settings.manage', { projectId });
    const cur = await this.load(projectId);
    if (cur.version !== body.expectedVersion) throw conflict('concurrency.version_mismatch', 'AI settings were changed by someone else — reload and review before retrying');
    const p = cur.autopilotPolicy as AutopilotPolicyStored | null;
    if (!p) throw ruleViolation('ai.no_policy', 'No autopilot policy exists');
    const next = { ...cur, autopilotPolicy: { ...p, revoked: true } as AutopilotPolicyStored, mode: cur.mode === 'autopilot' ? ('assisted' as const) : cur.mode };
    const saved = await this.save(ctx, projectId, cur, next);
    await this.audit.record({ action: 'ai.autopilot_policy.revoke', entityType: 'ai_project_settings', entityId: saved.id, projectId, reason: body.reason, after: { mode: saved.mode } });
    return this.toDto(saved, this.clock.today(await this.projectTimezone(projectId)));
  }

  // -------------------------------------------------------------------------------------------------------
  /**
   * Emergency stop (spec §12.4, C-22): blocks new runs/actions, cancels queued AI jobs, invalidates pending approvals,
   * cancels unsent AI deliveries; all history is preserved (rows are marked, never deleted).
   */
  async activateKillSwitch(ctx: RequestContext, projectId: string, reason: string) {
    this.policy.assert(ctx, 'ai.killswitch.activate', { projectId });
    const tx = this.db.tx();
    const cur = await this.load(projectId);
    const now = this.clock.now();
    if (cur.version === 0) await this.save(ctx, projectId, cur, { ...cur, killSwitch: true, killSwitchBy: ctx.principal.userId, killSwitchAt: now });
    else
      await tx
        .update(schema.aiProjectSettings)
        .set({ killSwitch: true, killSwitchBy: ctx.principal.userId, killSwitchAt: now, updatedAt: now, updatedBy: ctx.principal.userId, version: sql`${schema.aiProjectSettings.version} + 1` })
        .where(eq(schema.aiProjectSettings.projectId, projectId));
    const jobs = await tx.execute(sql`update job set status = 'cancelled', finished_at = now(), updated_at = now(), last_error = 'cancelled_killswitch'
       where project_id = ${projectId} and kind in (${sql.join(AI_ACTION_JOB_KINDS.map((k) => sql`${k}`), sql`, `)}) and status = 'queued'`);
    // Proposals before their approvals: the lock order of every proposal writer, including an execution in flight (SEC-P5-02).
    // An execution that holds a proposal's lock commits first; this update then skips it (it is no longer pending).
    const proposals = await tx.execute(sql`update ai_proposal set status = 'cancelled', invalidated_reason = 'kill_switch', updated_at = now(), version = version + 1
       where project_id = ${projectId} and status in ('proposed', 'approved', 'executing')`);
    const approvals = await tx.execute(sql`update ai_action_approval set status = 'invalidated', invalidated_reason = 'kill_switch'
       where project_id = ${projectId} and status = 'valid'`);
    const deliveries = await tx.execute(sql`update delivery_record set status = 'cancelled', detail = 'cancelled_killswitch', updated_at = now()
       where project_id = ${projectId} and idempotency_key like 'ai:%' and status = 'queued'`);
    const result = {
      killSwitch: true as const,
      cancelledJobs: jobs.rowCount ?? 0,
      invalidatedApprovals: approvals.rowCount ?? 0,
      cancelledProposals: proposals.rowCount ?? 0,
      cancelledDeliveries: deliveries.rowCount ?? 0,
    };
    await this.audit.record({ action: 'ai.killswitch.activate', entityType: 'ai_project_settings', projectId, reason, after: result });
    // Stragglers enqueued concurrently are cancelled again right after commit.
    this.db.afterCommit(() => this.queue.cancelQueued(projectId, AI_ACTION_JOB_KINDS).then(() => undefined));
    return result;
  }

  async releaseKillSwitch(ctx: RequestContext, projectId: string, reason: string) {
    const cur = await this.load(projectId);
    // not_self: the activator may not release their own emergency stop (activator unknown → fail closed, I-R3).
    if (!cur.killSwitch) {
      this.policy.assertGranted(ctx, 'ai.killswitch.release', { projectId });
      throw ruleViolation('ai.kill_switch_not_active', 'The emergency stop is not active');
    }
    this.policy.assert(ctx, 'ai.killswitch.release', { projectId, requesterUserId: cur.killSwitchBy });
    const now = this.clock.now();
    await this.db
      .tx()
      .update(schema.aiProjectSettings)
      .set({ killSwitch: false, killSwitchBy: null, killSwitchAt: null, updatedAt: now, updatedBy: ctx.principal.userId, version: sql`${schema.aiProjectSettings.version} + 1` })
      .where(eq(schema.aiProjectSettings.projectId, projectId));
    await this.audit.record({ action: 'ai.killswitch.release', entityType: 'ai_project_settings', projectId, reason, before: { killSwitchBy: cur.killSwitchBy, killSwitchAt: iso(cur.killSwitchAt) } });
    return { killSwitch: false as const };
  }

  /** Circuit-breaker bookkeeping (operational fields — does not bump the settings version). */
  async recordProviderOutcome(projectId: string, state: { consecutiveFailures: number; circuitOpenUntil: Date | null }) {
    await this.db
      .tx()
      .update(schema.aiProjectSettings)
      .set({ consecutiveFailures: state.consecutiveFailures, circuitOpenUntil: state.circuitOpenUntil })
      .where(eq(schema.aiProjectSettings.projectId, projectId));
  }

  // -------------------------------------------------------------------------------------------------------
  // Briefing schedules (durable scheduled_job rows owned by the subscriber; delivered to the subscriber only — AIT-13)

  async listBriefings(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'ai.briefing.subscribe', { projectId });
    const rows = await this.db
      .tx()
      .select()
      .from(schema.scheduledJob)
      .where(and(eq(schema.scheduledJob.projectId, projectId), eq(schema.scheduledJob.kind, AI_BRIEFING_JOB), eq(schema.scheduledJob.ownerUserId, ctx.principal.userId!)));
    return { items: rows.map((r) => this.briefingDto(r)) };
  }

  async subscribeBriefing(ctx: RequestContext, projectId: string, body: { kind: 'daily' | 'weekly'; cron?: string; timezone?: string; enabled: boolean }) {
    this.policy.assert(ctx, 'ai.briefing.subscribe', { projectId });
    const s = await this.load(projectId);
    const cron = body.cron ?? (body.kind === 'daily' ? (s.briefingCron ?? DEFAULT_BRIEFING_CRON.daily) : DEFAULT_BRIEFING_CRON.weekly);
    const timezone = body.timezone ?? s.briefingTimezone ?? 'Asia/Riyadh';
    return this.upsertBriefing(ctx, projectId, { kind: body.kind, cron, timezone, enabled: body.enabled });
  }

  async upsertBriefing(ctx: RequestContext, projectId: string, b: { kind: 'daily' | 'weekly'; cron: string; timezone: string; enabled: boolean }) {
    this.validateCron(b.cron, b.timezone);
    const tx = this.db.tx();
    const userId = ctx.principal.userId!;
    const existing = await tx
      .select()
      .from(schema.scheduledJob)
      .where(
        and(
          eq(schema.scheduledJob.projectId, projectId),
          eq(schema.scheduledJob.kind, AI_BRIEFING_JOB),
          eq(schema.scheduledJob.ownerUserId, userId),
          sql`${schema.scheduledJob.payload}->>'briefingKind' = ${b.kind}`,
        ),
      );
    const nextRunAt = b.enabled ? new Date(nextCronRun(b.cron, b.timezone, this.clock.now())) : null;
    let row: typeof schema.scheduledJob.$inferSelect | undefined;
    if (existing[0]) {
      [row] = await tx
        .update(schema.scheduledJob)
        .set({ cron: b.cron, timezone: b.timezone, enabled: b.enabled, nextRunAt, updatedAt: this.clock.now(), version: sql`${schema.scheduledJob.version} + 1` })
        .where(eq(schema.scheduledJob.id, existing[0].id))
        .returning();
    } else {
      [row] = await tx
        .insert(schema.scheduledJob)
        .values({
          id: newId(),
          orgId: ctx.principal.orgId,
          projectId,
          kind: AI_BRIEFING_JOB,
          name: `AI ${b.kind} briefing`,
          cron: b.cron,
          timezone: b.timezone,
          payload: { projectId, briefingKind: b.kind },
          enabled: b.enabled,
          nextRunAt,
          ownerUserId: userId,
          createdBy: userId,
        })
        .returning();
    }
    await this.audit.record({ action: 'ai.briefing.subscribe', entityType: 'scheduled_job', entityId: row!.id, projectId, after: { kind: b.kind, cron: b.cron, timezone: b.timezone, enabled: b.enabled } });
    return this.briefingDto(row!);
  }

  briefingDto(r: typeof schema.scheduledJob.$inferSelect) {
    return {
      id: r.id,
      kind: ((r.payload as { briefingKind?: string }).briefingKind === 'weekly' ? 'weekly' : 'daily') as 'daily' | 'weekly',
      cron: r.cron,
      timezone: r.timezone,
      enabled: r.enabled,
      ownerUserId: r.ownerUserId,
      nextRunAt: iso(r.nextRunAt),
      lastRunAt: iso(r.lastRunAt),
      lastStatus: r.lastStatus,
      lastError: r.lastError,
      version: r.version,
    };
  }

  /** Separation-of-duty helper for callers that must reject self-actions with a clear 403. */
  static assertNotSelf(ctx: RequestContext, requesterUserId: string | null, message: string) {
    if (requesterUserId && ctx.principal.userId === requesterUserId) throw forbidden('ai.self_approval', message);
  }
}
