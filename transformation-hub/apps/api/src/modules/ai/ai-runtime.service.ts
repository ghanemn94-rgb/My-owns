import { Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { schema } from '@hub/db';
import type { AiRunOutput } from '@hub/contracts';
import {
  aiFlagOf,
  aiToolByName,
  AI_TOOLS,
  citationKey,
  isProhibitedToolRequest,
  nextCircuitState,
  POLICY_VERSION,
  ruleViolation,
  sanitizeAiText,
  toolAllowedInMode,
  ungroundedNumbers,
  validateClaims,
  type AiCitationRef,
  type AiClaim,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { PolicyService } from '../../platform/policy.service';
import { AuditService } from '../../platform/audit.service';
import { Clock } from '../../platform/clock';
import { JobQueue, ClaimedJob } from '../../platform/jobs/job-queue.service';
import { JobContextFactory } from '../../platform/jobs/job-context';
import type { RequestContext } from '../../platform/context';
import { newId } from '../../platform/ids';
import { AiConfig } from './ai-config';
import { AiSettingsService, type SettingsRow } from './ai-settings.service';
import { ProviderRegistry } from './providers/provider-registry';
import { ContextItem, MissingInput, ModelProvider, ModelRequest, ModelResponse, ProviderConfigError, ProviderUnavailableError } from './providers/model-provider';
import { AiGatewayService, GatewayBlock } from './ai-gateway.service';
import { AiToolsService, BRIEFING_TOOLS, KillSwitchActiveError, toolsForQuestion } from './ai-tools.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiDetectionsService, DetectionFull, Locale, tr } from './ai-detections.service';
import { AiProposalsService } from './ai-proposals.service';
import { AiArtifactsService } from './ai-artifacts.service';

export const AI_RUN_JOB = 'ai.run';
type RunRow = typeof schema.aiRun.$inferSelect;
type Task = 'answer' | 'briefing';

interface Prepared {
  runId: string;
  projectId: string;
  requestedBy: string | null;
  task: Task;
  locale: Locale;
  question: string | null;
  settings: SettingsRow;
  provider: ModelProvider;
  tz: string;
  today: string;
  block: GatewayBlock | null;
  items: ContextItem[];
  sent: ContextItem[];
  missing: MissingInput[];
  detections: DetectionFull[];
  withheld: { aboveCeiling: number; roomRestricted: number };
  warnings: string[];
  preparedRequests: { action: string; text: string }[];
  toolsUsed: string[];
  request: ModelRequest | null;
  timeoutMs: number;
}

type Outcome = { kind: 'ok'; response: ModelResponse } | { kind: 'error'; error: string; circuit: boolean } | { kind: 'blocked' };

/** A request to the assistant to perform a prohibited action (it may only prepare a request for a human — §12.3). */
const PROHIBITED_INTENT: RegExp[] = [
  /\b(approve|waive|verify|sign|declare|grant|disclose|release|delete|dispose|pay|make me|give)\b.{0,60}\b(gate|decision|cps?|cp-\d+|condition|closing|closed|transaction|waiver|access|admin|administrator|agreement|payment|evidence|room|folder|committee)\b/i,
  /\b(create|raise|request|issue)\b.{0,20}\bwaiver\b/i,
  /\bmark\b.{0,40}\bas\b.{0,12}\b(approved|satisfied|waived|verified|closed)\b/i,
  /(أعلن|اعلن).{0,30}(إغلاق|الإغلاق)/,
  /(أنشئ|انشئ|اطلب).{0,10}إعفاء/,
  /(ووافق|وافق على|اعتمد|مرّر|مرر).{0,60}(البوابة|القرار|الشرط|للشرط|اللجنة|عليه)/,
  /(سجّل|سجل).{0,40}(كمعتمد|مستوفى|كمُعفى|كمعفى)/,
  /(امنح|اجعلني).{0,60}(صلاحية|مسؤول)/,
  /(احذف|ادفع|وقّع على|وقع على)/,
];
export function isProhibitedRequest(q: string): boolean {
  return PROHIBITED_INTENT.some((r) => r.test(q));
}

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/**
 * The runtime AI project manager (spec §12). Retrieval-first: the runtime (not the model) calls typed read tools as
 * the delegating human with in-SQL ACL; the policy gateway filters the context; the provider returns claims (and may
 * request PROPOSE tools only); the output validator keeps only claims whose citations resolve to the evidence set, are
 * grounded (numbers) and still visible; tool calls for anything else are refused and audited. Runs in the request
 * (advisory, synchronous with timeout) or in the worker (async asks, scheduled briefings) with FRESH authorisation.
 */
@Injectable()
export class AiRuntimeService {
  private readonly log = new Logger('ai-runtime');
  constructor(
    private readonly db: DbService,
    private readonly policy: PolicyService,
    private readonly audit: AuditService,
    private readonly clock: Clock,
    private readonly queue: JobQueue,
    private readonly contexts: JobContextFactory,
    private readonly cfg: AiConfig,
    private readonly settings: AiSettingsService,
    private readonly providers: ProviderRegistry,
    private readonly gateway: AiGatewayService,
    private readonly tools: AiToolsService,
    private readonly knowledge: AiKnowledgeService,
    private readonly detections: AiDetectionsService,
    private readonly proposals: AiProposalsService,
    private readonly artifacts: AiArtifactsService,
  ) {}

  // =========================================================================================================
  // Entry points

  async ask(ctx: RequestContext, projectId: string, body: { question: string; locale?: 'en' | 'ar'; async: boolean }) {
    this.policy.assert(ctx, 'ai.assistant.use', { projectId });
    const s = await this.settings.load(projectId);
    if (s.mode === 'off' || s.provider === 'off') {
      throw ruleViolation('ai.disabled', 'AI is off for this project. Deterministic detections and all project features remain available (GET …/ai/detections).');
    }
    if (s.killSwitch) {
      await this.audit.recordDetached(ctx, { action: 'AI_KILLSWITCH_BLOCKED', entityType: 'ai_project_settings', projectId, outcome: 'denied', reason: 'ask refused: emergency stop active' });
      throw ruleViolation('ai.kill_switch', 'AI emergency stop is active');
    }
    const locale: Locale = body.locale ?? ctx.locale;
    const run = await this.createRun(ctx, projectId, { kind: 'question', trigger: 'user', triggerRef: null, question: body.question, locale, settings: s, status: body.async ? 'queued' : 'running', requestedBy: ctx.principal.userId });
    if (body.async) {
      await this.queue.enqueue({ kind: AI_RUN_JOB, orgId: ctx.principal.orgId, projectId, payload: { runId: run.id }, idempotencyKey: `ai-run:${run.id}`, requestedBy: ctx.principal.userId });
      return this.toDto(run);
    }
    const prep = await this.prepare(ctx, projectId, run, 'answer', body.question, locale, Math.min(s.perRunTimeoutMs, this.cfg.syncTimeoutCapMs));
    const outcome = await this.callProvider(prep);
    return this.toDto(await this.finalize(ctx, prep, outcome));
  }

  /** Synchronous briefing for the calling user (demo seed / manual trigger). No notification. */
  async runBriefingNow(ctx: RequestContext, projectId: string, briefingKind: 'daily' | 'weekly' = 'daily', trigger = 'user') {
    this.policy.assert(ctx, 'ai.briefing.subscribe', { projectId });
    const s = await this.settings.load(projectId);
    const locale: Locale = ctx.locale;
    const run = await this.createRun(ctx, projectId, { kind: briefingKind === 'weekly' ? 'weekly_summary' : 'briefing', trigger, triggerRef: null, question: null, locale, settings: s, status: 'running', requestedBy: ctx.principal.userId });
    const prep = await this.prepare(ctx, projectId, run, 'briefing', null, locale, Math.min(s.perRunTimeoutMs, this.cfg.syncTimeoutCapMs));
    const outcome = await this.callProvider(prep);
    return this.toDto(await this.finalize(ctx, prep, outcome));
  }

  /** Worker: queued ask. Re-resolves the human principal before AND after the provider call (AT-19). */
  async runAsyncJob(job: ClaimedJob): Promise<Record<string, unknown>> {
    const runId = typeof job.payload['runId'] === 'string' ? job.payload['runId'] : null;
    const projectId = job.project_id;
    if (!runId || !projectId) return { skipped: 'no run reference' };
    const svc = this.contexts.forService(job, 'svc-ai-pm', []);
    const run = await this.db.run(svc, async () => (await this.db.tx().select().from(schema.aiRun).where(and(eq(schema.aiRun.id, runId), eq(schema.aiRun.projectId, projectId))))[0]);
    if (!run || run.status !== 'queued') return { skipped: `run ${run?.status ?? 'missing'}` };
    const skip = (error: string) => this.db.run(svc, () => this.markSkipped(run.id, projectId, error));
    const userCtx = run.requestedBy ? await this.contexts.forUser(run.requestedBy, projectId, `job-${job.id}`) : null;
    if (!userCtx || !this.policy.canInProject(userCtx, 'ai.assistant.use', projectId)) {
      await skip('requester_access_revoked');
      return { status: 'skipped', reason: 'requester_access_revoked' };
    }
    const prep = await this.db.run(userCtx, async () => {
      const s = await this.settings.load(projectId);
      await this.db.tx().update(schema.aiRun).set({ status: 'running', startedAt: this.clock.now() }).where(eq(schema.aiRun.id, run.id));
      return this.prepare(userCtx, projectId, run, 'answer', run.question ?? '', (run.locale === 'ar' ? 'ar' : 'en') as Locale, s.perRunTimeoutMs);
    });
    await this.queue.extendLease(job, prep.timeoutMs + 60_000);
    const outcome = await this.callProvider(prep);
    const ctx2 = await this.contexts.forUser(run.requestedBy!, projectId, `job-${job.id}`);
    if (!ctx2 || !this.policy.canInProject(ctx2, 'ai.assistant.use', projectId)) {
      await skip('requester_access_revoked_during_run');
      return { status: 'skipped', reason: 'requester_access_revoked_during_run' };
    }
    const row = await this.db.run(ctx2, () => this.finalize(ctx2, prep, outcome));
    return { status: row.status, runId: row.id };
  }

  /**
   * Worker: scheduled briefing (`scheduled_job` kind ai.briefing → JobContextFactory.forUser(owner)). If the owner lost
   * access, the run is recorded as `skipped` with the reason and NOTHING is sent (AT-19). Delivered to the subscriber
   * only (AIT-13); idempotent per schedule slot (AT-20).
   */
  async runBriefingJob(job: ClaimedJob): Promise<Record<string, unknown>> {
    const projectId = job.project_id;
    const scheduleId = typeof job.payload['scheduledJobId'] === 'string' ? job.payload['scheduledJobId'] : null;
    const slot = typeof job.payload['slot'] === 'string' ? job.payload['slot'] : this.clock.now().toISOString();
    if (!projectId || !scheduleId) return { skipped: 'no schedule reference' };
    const svc = this.contexts.forService(job, 'svc-ai-pm', []);
    const triggerRef = `schedule:${scheduleId}:${slot}`;
    const pre = await this.db.run(svc, async () => {
      const sched = (await this.db.query<{ owner_user_id: string | null; enabled: boolean; kind: string; payload: Record<string, unknown> }>(`select owner_user_id, enabled, kind, payload from scheduled_job where id = $1 and project_id = $2`, [scheduleId, projectId])).rows[0];
      if (!sched || sched.kind !== 'ai.briefing') return { stop: 'schedule_missing' };
      const existing = await this.db.tx().select({ id: schema.aiRun.id, status: schema.aiRun.status }).from(schema.aiRun).where(and(eq(schema.aiRun.projectId, projectId), eq(schema.aiRun.triggerRef, triggerRef)));
      if (existing[0]) return { stop: 'already_ran', runId: existing[0].id };
      const s = await this.settings.load(projectId);
      return { sched, s };
    });
    if ('stop' in pre) return { status: pre.stop, ...(pre.runId ? { runId: pre.runId } : {}) };
    const { sched, s } = pre;
    const owner = sched.owner_user_id;
    const briefingKind = sched.payload['briefingKind'] === 'weekly' ? 'weekly' : 'daily';
    const kind = briefingKind === 'weekly' ? 'weekly_summary' : 'briefing';
    const userCtx = owner ? await this.contexts.forUser(owner, projectId, `job-${job.id}`) : null;
    const recordSkipped = async (error: string, status: 'skipped' | 'cancelled' = 'skipped') => {
      await this.db.run(svc, async () => {
        const run = await this.createRun(svc, projectId, { kind, trigger: 'scheduled', triggerRef, question: null, locale: 'en', settings: s, status, requestedBy: owner, error });
        await this.audit.record({ action: 'ai.briefing.skipped', entityType: 'ai_run', entityId: run.id, projectId, outcome: 'denied', reason: error });
      });
      return { status, reason: error };
    };
    if (!sched.enabled) return recordSkipped('schedule_disabled');
    if (!userCtx || !this.policy.canInProject(userCtx, 'ai.briefing.subscribe', projectId)) return recordSkipped('owner_access_revoked');
    if (s.mode === 'off' || s.provider === 'off') return recordSkipped('ai_off');
    if (s.killSwitch) return recordSkipped('kill_switch', 'cancelled');
    const locale: Locale = userCtx.locale;
    const prep = await this.db.run(userCtx, async () => {
      const run = await this.createRun(userCtx, projectId, { kind, trigger: 'scheduled', triggerRef, question: null, locale, settings: s, status: 'running', requestedBy: owner });
      return this.prepare(userCtx, projectId, run, 'briefing', null, locale, s.perRunTimeoutMs);
    });
    await this.queue.extendLease(job, prep.timeoutMs + 60_000);
    const outcome = await this.callProvider(prep);
    const ctx2 = await this.contexts.forUser(owner!, projectId, `job-${job.id}`);
    if (!ctx2 || !this.policy.canInProject(ctx2, 'ai.briefing.subscribe', projectId)) {
      await this.db.run(svc, () => this.markSkipped(prep.runId, projectId, 'owner_access_revoked_during_run'));
      return { status: 'skipped', reason: 'owner_access_revoked_during_run' };
    }
    const row = await this.db.run(ctx2, async () => {
      const r = await this.finalize(ctx2, prep, outcome);
      if (r.status !== 'cancelled' && r.status !== 'skipped') await this.deliverBriefing(ctx2, projectId, r, `ai-briefing:${scheduleId}:${slot}`);
      return r;
    });
    return { status: row.status, runId: row.id };
  }

  /** In-app notification to the subscriber only; dedupe key per schedule slot (no duplicate on retry). */
  private async deliverBriefing(ctx: RequestContext, projectId: string, run: RunRow, dedupeKey: string) {
    const out = run.output as AiRunOutput | null;
    const L = (en: string, ar: string) => tr(run.locale === 'ar' ? 'ar' : 'en', en, ar);
    const title = run.provider === 'mock' ? L('AI briefing (Simulated)', 'موجز المساعد الذكي (محاكاة)') : L('AI briefing', 'موجز المساعد الذكي');
    await this.db.query(
      `insert into notification (id, org_id, project_id, user_id, kind, title, body, link, channel, delivery_status, dedupe_key)
       values ($1, $2, $3, $4, 'ai_briefing', $5, $6, $7, 'in_app', 'sent', $8)
       on conflict do nothing`,
      [newId(), ctx.principal.orgId, projectId, ctx.principal.userId, title, (out?.headline ?? '').slice(0, 500), `/projects/${projectId}/ai/runs/${run.id}`, dedupeKey],
    );
  }

  // =========================================================================================================
  // Pipeline

  private async createRun(
    ctx: RequestContext,
    projectId: string,
    f: { kind: string; trigger: string; triggerRef: string | null; question: string | null; locale: string; settings: SettingsRow; status: RunRow['status']; requestedBy: string | null; error?: string },
  ): Promise<RunRow> {
    const now = this.clock.now();
    const done = f.status === 'skipped' || f.status === 'cancelled';
    const [row] = await this.db
      .tx()
      .insert(schema.aiRun)
      .values({
        id: newId(),
        orgId: ctx.principal.orgId,
        projectId,
        kind: f.kind,
        trigger: f.trigger,
        triggerRef: f.triggerRef,
        requestedBy: f.requestedBy,
        status: f.status,
        provider: f.settings.provider,
        model: f.settings.model,
        locale: f.locale,
        question: f.question,
        policyVersion: f.settings.policyVersion,
        startedAt: f.status === 'running' ? now : null,
        finishedAt: done ? now : null,
        error: f.error ?? null,
        output: done ? null : null,
      })
      .returning();
    return row!;
  }

  private async markSkipped(runId: string, projectId: string, error: string) {
    await this.db.tx().update(schema.aiRun).set({ status: 'skipped', error, finishedAt: this.clock.now() }).where(and(eq(schema.aiRun.id, runId), eq(schema.aiRun.projectId, projectId)));
    await this.audit.record({ action: 'ai.run.skipped', entityType: 'ai_run', entityId: runId, projectId, outcome: 'denied', reason: error });
  }

  private async prepare(ctx: RequestContext, projectId: string, run: RunRow, task: Task, question: string | null, locale: Locale, timeoutMs: number): Promise<Prepared> {
    const s = await this.settings.load(projectId);
    const provider = this.providers.get(s.provider);
    const tz = await this.settings.projectTimezone(projectId);
    const today = this.clock.today(tz);
    const project = await this.knowledge.project(projectId);
    const L = (en: string, ar: string) => tr(locale, en, ar);
    const prep: Prepared = {
      runId: run.id,
      projectId,
      requestedBy: run.requestedBy,
      task,
      locale,
      question,
      settings: s,
      provider,
      tz,
      today,
      block: await this.gateway.preflight(projectId, s, provider, this.clock.now()),
      items: [],
      sent: [],
      missing: [],
      detections: [],
      withheld: { aboveCeiling: 0, roomRestricted: 0 },
      warnings: [],
      preparedRequests: [],
      toolsUsed: [],
      request: null,
      timeoutMs,
    };
    // A request to perform a prohibited action → prepared request for a human only (never a tool) — AIT-22…25.
    if (question && isProhibitedRequest(question)) {
      await this.audit.record({ action: 'AI_PROHIBITED_ACTION_REQUESTED', entityType: 'ai_run', entityId: run.id, projectId, outcome: 'denied', reason: 'user asked the assistant to perform a prohibited action; a prepared request was offered instead' });
      prep.preparedRequests.push({
        action: 'prepare_approval_request',
        text: L(
          'The AI project manager cannot approve, waive, verify, sign, close, grant access, change permissions, pay or delete. This request must be performed by the accountable person through the normal workflow (e.g. the committee decision, gate decision or closing confirmation screens). The evidence and blockers relevant to it are listed below.',
          'لا يستطيع مساعد إدارة المشروع الاعتماد أو الإعفاء أو التحقق أو التوقيع أو الإغلاق أو منح الصلاحيات أو تغييرها أو الدفع أو الحذف. يجب أن ينفّذ هذا الطلب الشخصُ المسؤول عبر مسار العمل المعتاد (قرار اللجنة أو قرار البوابة أو تأكيد الإغلاق). الأدلة والعوائق ذات الصلة مدرجة أدناه.',
        ),
      });
    }
    if (prep.block && (prep.block.status === 'cancelled' || prep.block.status === 'skipped')) return prep;
    // Retrieval under the delegating user's ACL. For a blocked provider the briefing still carries rules-only detections.
    const names = task === 'briefing' ? BRIEFING_TOOLS : toolsForQuestion(question ?? '');
    if (prep.block && task === 'answer') return prep;
    const st = { projectId, mode: s.mode, today, locale, projectIsDemo: !!project?.isDemo, toolsUsed: prep.toolsUsed, killSwitch: async () => (await this.settings.load(projectId)).killSwitch };
    const byKey = new Map<string, ContextItem>();
    try {
      for (const name of names) {
        const r = await this.tools.run(ctx, name, { query: question ?? '' }, st);
        for (const it of r.items) {
          const ex = byKey.get(it.key);
          if (ex) ex.text = `${ex.text}\n${it.text}`.slice(0, 4000);
          else byKey.set(it.key, it);
        }
        for (const m of r.missing) if (!prep.missing.some((x) => x.key === m.key)) prep.missing.push(m);
        for (const d of r.detections) if (!prep.detections.some((x) => x.code === d.code && x.entityId === d.entityId)) prep.detections.push(d);
      }
    } catch (e) {
      if (e instanceof KillSwitchActiveError) {
        prep.block = { status: 'cancelled', error: 'kill_switch' };
        return prep;
      }
      throw e;
    }
    prep.items = [...byKey.values()].slice(0, this.cfg.maxContextItems);
    if (prep.items.length) prep.missing = prep.missing.filter((m) => m.key !== 'documents' || task === 'answer');
    if (prep.items.some((i) => i.suspicious)) {
      prep.warnings.push(L('Some sources contain instruction-like text addressed to the assistant. They were treated as quoted data; no action was taken and no policy changed.', 'تحتوي بعض المصادر على نص يشبه التعليمات موجّه إلى المساعد. عوملت كبيانات مقتبسة؛ لم يُتخذ أي إجراء ولم تتغير أي سياسة.'));
    }
    if (prep.block) return prep;

    // Policy gateway: ceiling / room exclusion / redaction, per-run limit, budget.
    const f = this.gateway.filterContext(s, prep.items);
    prep.withheld = f.withheld;
    if (f.withheld.aboveCeiling) prep.warnings.push(L(`${f.withheld.aboveCeiling} source(s) you can see are above the provider classification ceiling (${f.ceiling}) and were not sent to the AI provider.`, `${f.withheld.aboveCeiling} مصدرًا مما يمكنك رؤيته أعلى من سقف التصنيف المسموح للمزوّد (${f.ceiling}) ولم تُرسل إليه.`));
    if (f.withheld.roomRestricted) prep.warnings.push(L(`${f.withheld.roomRestricted} partner-room source(s) were not sent to the AI provider.`, `لم تُرسل ${f.withheld.roomRestricted} مصادر من غرف الشركاء إلى مزوّد الذكاء الاصطناعي.`));
    const fit = this.gateway.fitToLimit(f.sent, question, s.perRunTokenLimit, this.cfg.maxOutputTokens);
    if (fit.dropped) prep.warnings.push(L(`${fit.dropped} lower-ranked source(s) were left out to respect the per-run token limit.`, `استُبعد ${fit.dropped} مصدرًا أقل صلة للالتزام بحد الرموز لكل تشغيل.`));
    prep.sent = fit.kept;
    const maxOut = Math.min(this.cfg.maxOutputTokens, Math.max(200, s.perRunTokenLimit - fit.estimatedInputTokens));
    const estimated = fit.estimatedInputTokens + maxOut;
    prep.block = await this.gateway.checkBudget(projectId, s, tz, today.slice(0, 7), estimated, provider.estimateCost(fit.estimatedInputTokens, maxOut));
    if (prep.block) return prep;

    // Tools the MODEL may call: propose-only, allowed by mode, ai:propose AND held by the delegating user now.
    const modelTools = AI_TOOLS.filter((t) => t.kind === 'propose' && toolAllowedInMode(t, s.mode) && (t.permission === null || (aiFlagOf(t.permission) === 'propose' && this.policy.canInProject(ctx, t.permission, projectId)))).map((t) => ({ name: t.name, description: t.description }));
    prep.request = { task, locale, question, context: prep.sent, missing: prep.missing, tools: modelTools, maxOutputTokens: maxOut, model: s.model, hints: { projectIsDemo: !!project?.isDemo } };
    return prep;
  }

  private async callProvider(prep: Prepared): Promise<Outcome> {
    if (prep.block || !prep.request) return { kind: 'blocked' };
    const ac = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
      const response = await Promise.race([
        prep.provider.generate(prep.request, ac.signal),
        new Promise<never>((_, rej) => {
          timer = setTimeout(() => {
            ac.abort();
            rej(new ProviderUnavailableError('timeout'));
          }, prep.timeoutMs);
        }),
      ]);
      return { kind: 'ok', response };
    } catch (e) {
      if (e instanceof ProviderConfigError) return { kind: 'error', error: e.code, circuit: false };
      if (e instanceof ProviderUnavailableError) return { kind: 'error', error: `provider_unavailable: ${e.message}`.slice(0, 200), circuit: true };
      return { kind: 'error', error: `provider_error: ${(e as Error).name}`, circuit: true };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private async finalize(ctx: RequestContext, prep: Prepared, outcome: Outcome): Promise<RunRow> {
    const { projectId, locale } = prep;
    const L = (en: string, ar: string) => tr(locale, en, ar);
    const now = this.clock.now();
    const s = await this.settings.load(projectId);
    let status: RunRow['status'] = 'succeeded';
    let error: string | null = null;
    if (prep.block) {
      status = prep.block.status;
      error = prep.block.error;
    } else if (s.killSwitch) {
      // Emergency stop activated while the provider was working: discard the output, act on nothing (AIT-28).
      status = 'cancelled';
      error = 'kill_switch';
      await this.audit.record({ action: 'AI_KILLSWITCH_BLOCKED', entityType: 'ai_run', entityId: prep.runId, projectId, outcome: 'denied', reason: 'output discarded: emergency stop activated during the run' });
    } else if (outcome.kind === 'error') {
      status = 'failed';
      error = outcome.error;
    }
    // Circuit breaker bookkeeping.
    if (outcome.kind === 'ok' && (s.consecutiveFailures > 0 || s.circuitOpenUntil)) await this.settings.recordProviderOutcome(projectId, nextCircuitState(s, 'success', now));
    if (outcome.kind === 'error' && outcome.circuit) await this.settings.recordProviderOutcome(projectId, nextCircuitState(s, 'failure', now));

    let claims: AiClaim[] = [];
    let dropped = 0;
    const refused: { name: string; reason: string }[] = [];
    const proposals: { id: string; actionType: string; status: string }[] = [];
    const preparedRequests = [...prep.preparedRequests];
    const warnings = [...prep.warnings];
    const usage = outcome.kind === 'ok' && status === 'succeeded' ? outcome.response.usage : { inputTokens: 0, outputTokens: 0 };
    if (outcome.kind === 'ok' && status === 'succeeded') {
      const r = outcome.response;
      // ---- model tool calls: propose tools only; everything else refused + audited (C-20) ----
      const denied = new Map<string, { code: string; reason: string }>();
      const calls = r.toolCalls.slice(0, this.cfg.maxModelToolCalls);
      if (r.toolCalls.length > calls.length) refused.push({ name: '*', reason: `tool_call_limit: ${r.toolCalls.length - calls.length} call(s) ignored` });
      for (const call of calls) {
        const tool = aiToolByName(call.name);
        if (isProhibitedToolRequest(call.name)) {
          refused.push({ name: call.name, reason: 'prohibited_action_not_a_tool' });
          denied.set(`p:${call.name}`, { code: 'AI_PROHIBITED_ACTION_REQUESTED', reason: `model requested prohibited capability "${call.name}" — no such tool exists` });
        } else if (!tool) {
          refused.push({ name: call.name, reason: 'unknown_tool' });
          denied.set(`u:${call.name}`, { code: 'AI_TOOL_DENIED', reason: `model requested unknown tool "${call.name}"` });
        } else if (tool.kind === 'retrieve') {
          refused.push({ name: call.name, reason: 'retrieval_is_runtime_controlled' });
          denied.set(`r:${call.name}`, { code: 'AI_TOOL_DENIED', reason: `model-initiated retrieval "${call.name}" refused (scope is bound by the runtime)` });
        } else if (!toolAllowedInMode(tool, s.mode)) {
          refused.push({ name: call.name, reason: 'mode_forbids' });
        } else if (tool.action === 'prepare_approval_request') {
          const text = sanitizeAiText(String(call.args['text'] ?? '')).text.slice(0, 2000);
          if (text) preparedRequests.push({ action: String(call.args['requestedAction'] ?? 'request').slice(0, 64), text });
        } else {
          const res = await this.proposals.createFromTool(ctx, projectId, { id: prep.runId, requestedBy: prep.requestedBy }, tool, call.args, s);
          if ('refused' in res) refused.push({ name: call.name, reason: res.reason });
          else if (!proposals.some((p) => p.id === res.proposal.id)) proposals.push({ id: res.proposal.id, actionType: res.proposal.actionType, status: res.proposal.status });
        }
      }
      for (const d of denied.values()) await this.audit.record({ action: d.code, entityType: 'ai_run', entityId: prep.runId, projectId, outcome: 'denied', reason: d.reason });

      // ---- output validation (E4) ----
      const evidence = new Map<string, AiCitationRef>(prep.sent.map((i) => [i.key, i.ref]));
      const v = validateClaims(r.claims, evidence);
      dropped += v.dropped;
      if (v.invalidCitations.length) {
        await this.audit.record({ action: 'AI_CITATION_INVALID', entityType: 'ai_run', entityId: prep.runId, projectId, outcome: 'rejected', reason: `${v.invalidCitations.length} citation(s) outside the retrieved evidence set were removed` });
      }
      const itemByKey = new Map(prep.sent.map((i) => [i.key, i]));
      let sanitized = 0;
      let ungrounded = 0;
      const kept: AiClaim[] = [];
      for (const c of v.claims) {
        const san = sanitizeAiText(c.text);
        if (san.removed.length) sanitized++;
        if (!san.text) {
          dropped++;
          continue;
        }
        const sources = c.citations.map((ref) => {
          const it = itemByKey.get(citationKey(ref));
          return it ? `${it.title}\n${it.text}\n${JSON.stringify(it.facts ?? {})}\n${ref.location ?? ''}\n${ref.version ?? ''}` : '';
        });
        if (ungroundedNumbers(san.text, sources).length) {
          ungrounded++;
          dropped++;
          continue;
        }
        kept.push({ ...c, text: san.text });
      }
      if (sanitized) {
        warnings.push(L('External links, images or markup were removed from the AI output.', 'أُزيلت روابط أو صور أو تنسيقات خارجية من مخرجات الذكاء الاصطناعي.'));
        await this.audit.record({ action: 'AI_OUTPUT_SANITIZED', entityType: 'ai_run', entityId: prep.runId, projectId, outcome: 'rejected', reason: `${sanitized} claim(s) contained external links/images/markup` });
      }
      if (ungrounded) warnings.push(L(`${ungrounded} statement(s) with figures not present in the cited sources were removed (figures come only from the platform's deterministic engines).`, `أُزيلت ${ungrounded} عبارات تحتوي أرقامًا غير موجودة في المصادر المستشهد بها (الأرقام تأتي فقط من محركات المنصة الحتمية).`));
      // ---- before output: re-check the user can still see each cited item (§12.1) ----
      claims = await this.dropInvisible(ctx, projectId, kept);
      dropped += kept.length - claims.length;
      claims = claims.slice(0, 20);
    }
    if (status === 'budget_exceeded') warnings.push(L('The AI budget for this project is exhausted — no AI analysis was run. Deterministic detections and all project features remain available.', 'استُنفدت ميزانية الذكاء الاصطناعي لهذا المشروع — لم يُجرَ أي تحليل. تبقى الاكتشافات الحتمية وجميع وظائف المشروع متاحة.'));
    if (status === 'failed') warnings.push(L(`The AI provider is unavailable (${error}). Deterministic detections and all project features remain available.`, `مزوّد الذكاء الاصطناعي غير متاح (${error}). تبقى الاكتشافات الحتمية وجميع وظائف المشروع متاحة.`));
    if (status === 'cancelled') warnings.push(L('The AI emergency stop is active — nothing was run or sent.', 'إيقاف الطوارئ للذكاء الاصطناعي مفعّل — لم يُشغَّل أو يُرسل أي شيء.'));

    // ---- conflicts & freshness ----
    const citedDocs = [...new Set(claims.flatMap((c) => c.citations.filter((x) => x.type === 'document').map((x) => x.id)))];
    const docConflicts = await this.knowledge.conflictingEvidence(ctx, projectId, citedDocs.length ? citedDocs : prep.items.filter((i) => i.ref.type === 'document').map((i) => i.ref.id));
    const conflicts: AiRunOutput['conflicts'] = [];
    for (const c of docConflicts) {
      const item = prep.items.find((i) => i.ref.type === 'document' && i.ref.id === c.documentId);
      if (!item) continue;
      conflicts.push({ description: L(`Evidence from "${item.title}" is recorded as conflicting for a ${c.targetType}; reassessment is required before relying on it.`, `الدليل من «${item.title}» مسجّل كمتعارض بالنسبة إلى ${c.targetType}؛ يلزم إعادة التقييم قبل الاعتماد عليه.`), citations: [this.cleanRef(item.ref)] });
    }
    for (const i of prep.items.filter((x) => x.verificationStatus === 'conflicting')) conflicts.push({ description: L(`"${i.title}" has conflicting information recorded.`, `«${i.title}» مسجّل بمعلومات متعارضة.`), citations: [this.cleanRef(i.ref)] });
    const dated = (claims.length ? prep.items.filter((i) => claims.some((c) => c.citations.some((x) => citationKey(x) === i.key))) : prep.items).filter((i) => i.sourceUpdatedAt);
    const times = dated.map((i) => i.sourceUpdatedAt!).sort();
    const staleCut = now.getTime() - this.cfg.staleSourceDays * 86_400_000;
    const stale = dated.filter((i) => new Date(i.sourceUpdatedAt!).getTime() < staleCut);
    for (const i of stale.slice(0, 5)) warnings.push(L(`Source "${i.title}" was last updated on ${i.sourceUpdatedAt!.slice(0, 10)} (older than ${this.cfg.staleSourceDays} days) — check it is still current.`, `آخر تحديث للمصدر «${i.title}» كان في ${i.sourceUpdatedAt!.slice(0, 10)} (أقدم من ${this.cfg.staleSourceDays} يومًا) — تحقق من أنه ما زال ساريًا.`));

    const detections = prep.task === 'briefing' ? prep.detections.map((d) => AiDetectionsService.toDto(d)).slice(0, 100) : [];
    const insufficient = claims.length === 0 && status === 'succeeded';
    const headline =
      status !== 'succeeded'
        ? (warnings[warnings.length - 1] ?? error ?? status)
        : `${insufficient ? L('Insufficient evidence in sources you are authorized to see. ', 'لا توجد أدلة كافية في المصادر المصرح لك بالاطلاع عليها. ') : ''}${L(
            `${claims.length} sourced finding(s); ${prep.missing.length} missing input(s); ${conflicts.length} conflict(s)${prep.task === 'briefing' ? `; ${detections.length} rule-based detection(s)` : ''}.`,
            `${claims.length} نتيجة موثقة؛ ${prep.missing.length} مدخلات ناقصة؛ ${conflicts.length} تعارضات${prep.task === 'briefing' ? `؛ ${detections.length} اكتشافات قائمة على القواعد` : ''}.`,
          )}`;
    const simulated = prep.provider.simulated;
    const output: AiRunOutput = {
      simulated,
      providerLabel: prep.provider.label(),
      headline,
      claims: claims.map((c) => ({ text: c.text, kind: c.kind, citations: c.citations.map((x) => this.cleanRef(x)) })),
      missing: prep.missing.map((m) => ({ key: m.key, description: m.description, ownerRole: m.ownerRole })),
      conflicts,
      freshness: { asOf: now.toISOString(), oldestSource: times[0] ?? null, newestSource: times[times.length - 1] ?? null, staleSources: stale.length },
      warnings,
      detections,
      proposals,
      refusedToolCalls: refused,
      preparedRequests,
      withheldFromProvider: prep.withheld,
      droppedClaims: dropped,
      disclaimer: simulated
        ? L('AI-generated by the SIMULATED mock provider (no real model). Verify against the cited records; this is not a legal, accounting or approval determination and changed no record.', 'مُولَّد بواسطة مزوّد المحاكاة (لا يوجد نموذج حقيقي). تحقق من السجلات المستشهد بها؛ هذا ليس قرارًا قانونيًا أو محاسبيًا أو اعتمادًا ولم يغيّر أي سجل.')
        : L(`AI-generated (${prep.provider.label()}). Verify against the cited records; this is not a legal, accounting or approval determination and changed no record.`, `مُولَّد بالذكاء الاصطناعي (${prep.provider.label()}). تحقق من السجلات المستشهد بها؛ هذا ليس قرارًا قانونيًا أو محاسبيًا أو اعتمادًا ولم يغيّر أي سجل.`),
    };
    const evidenceSnapshot = {
      aclFingerprint: this.artifacts.fingerprint(ctx, projectId),
      policyMatrixVersion: POLICY_VERSION,
      tools: prep.toolsUsed,
      items: prep.items.map((i) => ({ type: i.ref.type, id: i.ref.id, version: i.ref.version ?? null, classification: i.classification, sentToProvider: prep.sent.some((x) => x.key === i.key), tool: i.tool })),
      cited: claims.flatMap((c) => c.citations.map((x) => ({ type: x.type, id: x.id, version: x.version ?? null }))),
      withheld: prep.withheld,
      modelToolCalls: outcome.kind === 'ok' ? outcome.response.toolCalls.map((t) => t.name).slice(0, 50) : [],
    };
    const cost = prep.provider.estimateCost(usage.inputTokens, usage.outputTokens);
    const [row] = await this.db
      .tx()
      .update(schema.aiRun)
      .set({
        status,
        error,
        output: output as unknown as Record<string, unknown>,
        evidenceSnapshot,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        costEstimate: cost,
        model: outcome.kind === 'ok' ? outcome.response.model : prep.settings.model,
        finishedAt: now,
      })
      .where(and(eq(schema.aiRun.id, prep.runId), eq(schema.aiRun.projectId, projectId)))
      .returning();
    await this.audit.record({ action: 'ai.run', entityType: 'ai_run', entityId: prep.runId, projectId, outcome: status === 'succeeded' ? 'success' : 'rejected', reason: error, after: { status, tokens: usage.inputTokens + usage.outputTokens, claims: claims.length, droppedClaims: dropped, proposals: proposals.length, refusedToolCalls: refused.length } });
    if (status === 'succeeded' && prep.task === 'briefing') {
      await this.artifacts.store(ctx, projectId, 'briefing_summary', evidenceSnapshot.cited.map((c) => ({ type: c.type, id: c.id, ...(c.version !== null ? { version: c.version } : {}) })), { runId: prep.runId, headline });
    }
    return row!;
  }

  private cleanRef(r: AiCitationRef): AiCitationRef {
    const out: AiCitationRef = { type: r.type, id: r.id };
    if (r.version !== undefined) out.version = r.version;
    if (r.location !== undefined) out.location = r.location;
    if (r.label !== undefined) out.label = r.label;
    if (r.isDemo !== undefined) out.isDemo = r.isDemo;
    return out;
  }

  /** Drops citations the principal can no longer see and claims left without any (before output / on read). */
  async dropInvisible<T extends { citations: { type: string; id: string }[] }>(ctx: RequestContext, projectId: string, claims: T[]): Promise<T[]> {
    const visible = await this.knowledge.visibleCitationKeys(ctx, projectId, claims.flatMap((c) => c.citations));
    return claims.map((c) => ({ ...c, citations: c.citations.filter((x) => visible.has(citationKey(x))) })).filter((c) => c.citations.length > 0);
  }

  toDto(r: RunRow) {
    return {
      id: r.id,
      kind: r.kind,
      trigger: r.trigger,
      status: r.status,
      provider: r.provider,
      model: r.model,
      simulated: r.provider === 'mock',
      locale: r.locale,
      question: r.question,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costEstimate: r.costEstimate,
      policyVersion: r.policyVersion,
      error: r.error,
      startedAt: iso(r.startedAt),
      finishedAt: iso(r.finishedAt),
      createdAt: r.createdAt.toISOString(),
      output: (r.output as AiRunOutput | null) ?? null,
    };
  }
}
