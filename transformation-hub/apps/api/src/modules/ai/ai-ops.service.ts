import { Injectable } from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import type { AiRunOutput, RouteInput, aiRoutes } from '@hub/contracts';
import { AI_ACTION_PERMISSION, AI_AUTOPILOT_ELIGIBLE, AI_MODES, AI_PROHIBITED_ACTIONS, AI_PROVIDERS, AI_TOOLS, aiFlagOf, circuitIsOpen, notFound, POLICY_VERSION, toolAllowedInMode, type AiProposableAction } from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { Clock } from '../../platform/clock';
import type { RequestContext } from '../../platform/context';
import { orderBySort } from '../../platform/sort';
import { AiSettingsService, AI_BRIEFING_JOB } from './ai-settings.service';
import { AiRuntimeService } from './ai-runtime.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiDetectionsService } from './ai-detections.service';
import { ProviderRegistry } from './providers/provider-registry';

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export const MANUAL_FALLBACK = {
  en: 'AI is optional. Every project, committee, gate, readiness and reporting function works without it. Use the rules-only Detections list, the task/milestone plan, the decision and action registers, gate and CP registers and the standard reports directly; nothing in project management waits for the AI.',
  ar: 'الذكاء الاصطناعي اختياري. تعمل جميع وظائف المشروع واللجان والبوابات والجاهزية والتقارير بدونه. استخدم قائمة الاكتشافات القائمة على القواعد وخطة المهام والمعالم وسجلات القرارات والإجراءات وسجلات البوابات والشروط والتقارير القياسية مباشرة؛ لا شيء في إدارة المشروع ينتظر الذكاء الاصطناعي.',
};

/** Operations view of the AI runtime: my runs, status/health, costs, tool matrix, rules-only detections. */
@Injectable()
export class AiOpsService {
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly clock: Clock,
    private readonly settings: AiSettingsService,
    private readonly runtime: AiRuntimeService,
    private readonly gateway: AiGatewayService,
    private readonly detections: AiDetectionsService,
    private readonly providers: ProviderRegistry,
  ) {}

  /** Runs are per user and never shared (AIT-08): only runs requested by / scheduled for the caller. */
  async listRuns(ctx: RequestContext, projectId: string, q: { page: number; pageSize: number; sort?: RouteInput<typeof aiRoutes.listRuns>['query']['sort'] }) {
    this.policy.assert(ctx, 'ai.run.read', { projectId });
    const where = and(eq(schema.aiRun.projectId, projectId), eq(schema.aiRun.requestedBy, ctx.principal.userId!));
    const [{ n }] = (await this.db.tx().select({ n: sql<number>`count(*)::int` }).from(schema.aiRun).where(where)) as [{ n: number }];
    const rows = await this.db.tx().select().from(schema.aiRun).where(where).orderBy(...orderBySort(q.sort, { createdAt: schema.aiRun.createdAt, kind: schema.aiRun.kind, status: schema.aiRun.status }, schema.aiRun.id, [desc(schema.aiRun.createdAt), desc(schema.aiRun.id)])).limit(q.pageSize).offset((q.page - 1) * q.pageSize);
    return {
      items: rows.map((r) => {
        const { output: _o, toolsUsed: _t, ...summary } = this.runtime.toDto(r);
        void _o;
        void _t;
        return summary;
      }),
      page: q.page,
      pageSize: q.pageSize,
      total: n,
    };
  }

  /** One of MY runs; citations re-checked against my CURRENT access on every read (§12.1). Others → 404. */
  async getRun(ctx: RequestContext, projectId: string, runId: string) {
    this.policy.assert(ctx, 'ai.run.read', { projectId });
    const [r] = await this.db.tx().select().from(schema.aiRun).where(and(eq(schema.aiRun.id, runId), eq(schema.aiRun.projectId, projectId), eq(schema.aiRun.requestedBy, ctx.principal.userId!)));
    if (!r) throw notFound();
    const dto = this.runtime.toDto(r);
    const out = dto.output as AiRunOutput | null;
    if (out) {
      const claims = await this.runtime.dropInvisible(ctx, projectId, out.claims);
      const detections = await this.runtime.dropInvisible(ctx, projectId, out.detections);
      const conflicts = await this.runtime.dropInvisible(ctx, projectId, out.conflicts);
      dto.output = { ...out, claims, detections, conflicts, droppedClaims: out.droppedClaims + (out.claims.length - claims.length) };
    }
    return dto;
  }

  async status(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'ai.run.read', { projectId });
    const s = await this.settings.load(projectId);
    const provider = this.providers.get(s.provider);
    const providerStatus = provider.status(s.model);
    const tz = await this.settings.projectTimezone(projectId);
    const now = this.clock.now();
    const month = this.clock.today(tz).slice(0, 7);
    const usage = await this.gateway.monthUsage(projectId, tz, month);
    const [last] = await this.db.tx().select({ id: schema.aiRun.id, kind: schema.aiRun.kind, status: schema.aiRun.status, finishedAt: schema.aiRun.finishedAt, error: schema.aiRun.error }).from(schema.aiRun).where(eq(schema.aiRun.projectId, projectId)).orderBy(desc(schema.aiRun.createdAt)).limit(1);
    const next = await this.db.query<{ next: Date | null }>(`select min(next_run_at) as next from scheduled_job where project_id = $1 and kind = $2 and enabled`, [projectId, AI_BRIEFING_JOB]);
    const exhausted = s.monthlyTokenBudget > 0 && usage.tokens >= s.monthlyTokenBudget;
    const circuit = circuitIsOpen(s.circuitOpenUntil, now);
    const health =
      s.mode === 'off' ? 'off' : s.killSwitch ? 'kill_switch' : ['not_configured', 'egress_not_approved', 'disabled_by_config'].includes(providerStatus) ? 'not_configured' : circuit ? 'circuit_open' : exhausted ? 'budget_exhausted' : last && last.status === 'failed' ? 'degraded' : 'ok';
    const failureReason = health === 'ok' || health === 'off' ? null : health === 'kill_switch' ? 'Emergency stop active' : health === 'not_configured' ? `Provider ${s.provider}: ${providerStatus}` : health === 'circuit_open' ? `Circuit open after ${s.consecutiveFailures} consecutive provider failures` : health === 'budget_exhausted' ? 'Monthly token budget exhausted' : (last?.error ?? 'Last run failed');
    return {
      mode: s.mode,
      provider: s.provider,
      providerLabel: provider.label(),
      providerStatus,
      simulated: provider.simulated,
      killSwitch: s.killSwitch,
      health: health as 'off' | 'ok' | 'degraded' | 'circuit_open' | 'budget_exhausted' | 'kill_switch' | 'not_configured',
      failureReason,
      lastRun: last ? { id: last.id, kind: last.kind, status: last.status, finishedAt: iso(last.finishedAt), error: last.error } : null,
      nextRunAt: iso(next.rows[0]?.next ?? null),
      circuitOpenUntil: circuit ? iso(s.circuitOpenUntil) : null,
      budget: { month, tokensUsed: usage.tokens, monthlyTokenBudget: s.monthlyTokenBudget, costUsed: usage.cost, monthlyCostBudget: s.monthlyCostBudget, currency: s.costCurrency, exhausted },
      manualFallback: ctx.locale === 'ar' ? MANUAL_FALLBACK.ar : MANUAL_FALLBACK.en,
      deterministicFeatures: ['detections (rules only)', 'schedule / critical path (CPM engine)', 'gate evaluation', 'status dimensions', 'money aggregation', 'committee workflows', 'reports'],
      // Every provider type's deployment status (statuses only — no URL, host or secret), so a real endpoint that is not set
      // up reads "not_configured" rather than being assumed. The project's own provider is checked with its model.
      endpoints: AI_PROVIDERS.filter((p) => p !== 'off').map((p) => {
        const pr = this.providers.get(p);
        return { provider: p, status: pr.status(p === s.provider ? s.model : null), simulated: pr.simulated };
      }),
    };
  }

  async costs(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'ai.operations.read', { projectId });
    const s = await this.settings.load(projectId);
    const tz = await this.settings.projectTimezone(projectId);
    const r = await this.db.query<{ month: string; runs: number; input_tokens: number; output_tokens: number; cost: string }>(
      `select to_char(created_at at time zone $2, 'YYYY-MM') as month, count(*)::int as runs, coalesce(sum(input_tokens), 0)::int as input_tokens,
              coalesce(sum(output_tokens), 0)::int as output_tokens, coalesce(sum(cost_estimate), 0)::numeric(12,4)::text as cost
         from ai_run where project_id = $1 group by 1 order by 1 desc limit 12`,
      [projectId, tz],
    );
    return {
      items: r.rows.map((x) => ({ month: x.month, runs: x.runs, inputTokens: x.input_tokens, outputTokens: x.output_tokens, costEstimate: x.cost })),
      currency: s.costCurrency,
      note: 'Estimates only: token counts are reported by the provider (the Simulated mock estimates ≈4 characters per token and costs 0). Actual billing comes from the approved provider/gateway.',
    };
  }

  tools(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'ai.assistant.use', { projectId });
    return {
      items: AI_TOOLS.map((t) => ({
        name: t.name,
        kind: t.kind,
        permission: t.permission,
        aiFlag: t.permission ? aiFlagOf(t.permission) : ('none' as const),
        action: t.action ?? null,
        modes: AI_MODES.filter((m) => toolAllowedInMode(t, m)),
        executable:
          t.kind === 'retrieve'
            ? 'read-only; invoked by the runtime as the delegating user (never by the model)'
            : t.action === 'prepare_approval_request'
              ? 'never — text for a human only'
              : `assisted: after a bound human approval (${AI_ACTION_PERMISSION[t.action as AiProposableAction]} + ai.proposal.approve, not the requester); autopilot: only if allowlisted${AI_AUTOPILOT_ELIGIBLE.includes(t.action as AiProposableAction) ? '' : ' (not eligible)'}`,
        autopilotEligible: !!t.action && AI_AUTOPILOT_ELIGIBLE.includes(t.action),
        description: t.description,
      })),
      prohibitedActions: [...AI_PROHIBITED_ACTIONS],
      policyVersion: POLICY_VERSION,
    };
  }

  /** Rules-only detections for the caller (works with AI Off / over budget / provider down — AT-21). */
  async detectionsFor(ctx: RequestContext, projectId: string) {
    this.policy.assert(ctx, 'planning.plan.read', { projectId });
    const tz = await this.settings.projectTimezone(projectId);
    const today = this.clock.today(tz);
    const r = await this.detections.compute(ctx, projectId, today, ctx.locale);
    return { items: r.detections.map((d) => AiDetectionsService.toDto(d)), computedAt: this.clock.now().toISOString(), rulesOnly: true as const, today };
  }
}
