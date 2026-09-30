import { and, asc, eq, isNotNull, sql } from 'drizzle-orm';
import { schema } from '@hub/db';
import { aiToolByName } from '@hub/domain';
import type { ModuleSeed } from '../../cli/seed-modules';
import { DbService } from '../../platform/db.service';
import { AiSettingsService } from './ai-settings.service';
import { AiRuntimeService } from './ai-runtime.service';
import { AiProposalsService } from './ai-proposals.service';

/**
 * Demo sandbox scenario for the runtime AI PM (idempotent; runs through the real services so authorisation, audit and
 * validation apply). Everything AI-generated here comes from the MOCK provider and is labelled Simulated.
 *  - DEMO-DC: mode Advisory, provider mock (Simulated), monthly budget, ceiling confidential (set by the sponsor);
 *    a daily 07:30 Asia/Riyadh briefing schedule owned by `pm`; one completed briefing run with citations;
 *    one pending proposal (internal notification to a task owner — or, when no task has an owner yet, to the lead of
 *    the task's workstream, stated in the payload).
 *  - Project B: AI stays Off (default; no settings row).
 */
export const aiSeed: ModuleSeed = {
  name: 'ai',
  run: async ({ app, dcProjectId, asUser, log }) => {
    const settings = app.get(AiSettingsService);
    const runtime = app.get(AiRuntimeService);
    const proposals = app.get(AiProposalsService);
    const db = app.get(DbService);

    // 1. Enable Advisory + Simulated mock for DEMO-DC (sponsor holds ai.settings.manage).
    await asUser('sponsor', async (ctx) => {
      const s = await settings.get(ctx, dcProjectId);
      if (s.mode !== 'off') return;
      await settings.update(ctx, dcProjectId, {
        expectedVersion: s.version,
        provider: 'mock',
        model: 'mock-benign',
        mode: 'advisory',
        monthlyTokenBudget: 200_000,
        perRunTokenLimit: 20_000,
        maxClassificationToProvider: 'confidential',
        reason: 'Demo sandbox: AI PM in Advisory mode with the Simulated mock provider (no real model).',
      });
      log('ai: DEMO-DC set to Advisory with the Simulated mock provider');
    });

    // 2. pm's durable daily briefing at 07:30 Asia/Riyadh.
    // Idempotent: an existing subscription is left as is (re-subscribing would bump it and write another audit row).
    await asUser('pm', async (ctx) => {
      const existing = await settings.listBriefings(ctx, dcProjectId);
      if (existing.items.some((b) => b.kind === 'daily')) return;
      await settings.subscribeBriefing(ctx, dcProjectId, { kind: 'daily', cron: '30 7 * * *', timezone: 'Asia/Riyadh', enabled: true });
    });

    // 3. One completed briefing run (Simulated) with citations.
    const runId = await asUser('pm', async (ctx) => {
      const [existing] = await db
        .tx()
        .select({ id: schema.aiRun.id })
        .from(schema.aiRun)
        .where(and(eq(schema.aiRun.projectId, dcProjectId), eq(schema.aiRun.kind, 'briefing'), eq(schema.aiRun.requestedBy, ctx.principal.userId!), eq(schema.aiRun.status, 'succeeded')))
        .limit(1);
      if (existing) return existing.id;
      const r = await runtime.runBriefingNow(ctx, dcProjectId, 'daily', 'seed');
      log(`ai: briefing run ${r.status} with ${r.output?.claims.length ?? 0} cited finding(s) (Simulated)`);
      return r.id;
    });

    // 4. One pending proposal: internal notification to the owner of a task (validated like a model tool call).
    await asUser('pm', async (ctx) => {
      const [pending] = await db.tx().select({ id: schema.aiProposal.id }).from(schema.aiProposal).where(and(eq(schema.aiProposal.projectId, dcProjectId), eq(schema.aiProposal.runId, runId))).limit(1);
      if (pending) return;
      const tx = db.tx();
      const [owned] = await tx
        .select({ id: schema.task.id, code: schema.task.wbsCode, title: schema.task.title, owner: schema.task.accountableUserId })
        .from(schema.task)
        .where(and(eq(schema.task.projectId, dcProjectId), isNotNull(schema.task.accountableUserId)))
        .orderBy(asc(schema.task.sortOrder))
        .limit(1);
      let target = owned ? { id: owned.id, code: owned.code, title: owned.title, recipient: owned.owner!, role: 'task_owner' } : null;
      if (!target) {
        // No task has an accountable owner yet (template tasks start as proposals): address the lead of the task's workstream.
        const [lead] = await tx
          .select({ id: schema.task.id, code: schema.task.wbsCode, title: schema.task.title, recipient: schema.projectMembership.userId })
          .from(schema.task)
          .innerJoin(schema.projectMembership, and(eq(schema.projectMembership.projectId, schema.task.projectId), eq(schema.projectMembership.workstreamId, schema.task.workstreamId), eq(schema.projectMembership.role, 'workstream_lead'), sql`${schema.projectMembership.revokedAt} is null`))
          .where(eq(schema.task.projectId, dcProjectId))
          .orderBy(asc(schema.task.sortOrder))
          .limit(1);
        if (lead) target = { ...lead, role: 'workstream_lead (task owner TBD)' };
      }
      if (!target) {
        log('ai: no task owner or workstream lead found — pending proposal not created');
        return;
      }
      const s = await settings.load(dcProjectId);
      const res = await proposals.createFromTool(ctx, dcProjectId, { id: runId, requestedBy: ctx.principal.userId }, aiToolByName('propose_internal_notification')!, {
        recipientUserId: target.recipient,
        targetType: 'task',
        targetId: target.id,
        title: `Update requested: ${target.code} ${target.title}`.slice(0, 200),
        body: `Please confirm the plan, owner and forecast for ${target.code} (recipient role: ${target.role}). Suggested by the AI PM — Simulated demo.`,
      }, s);
      log('refused' in res ? `ai: demo proposal refused (${res.reason})` : `ai: pending proposal ${res.proposal.id} (internal notification, awaiting human approval)`);
    });
  },
};
