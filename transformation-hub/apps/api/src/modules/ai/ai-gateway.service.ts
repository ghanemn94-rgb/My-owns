import { Injectable } from '@nestjs/common';
import {
  AI_PROVIDER_MAX_CLASSIFICATION,
  circuitIsOpen,
  classificationWithinCeiling,
  estimateTokens,
  evaluateBudget,
  hostAllowed,
  redactSensitive,
  type Classification,
} from '@hub/domain';
import { DbService } from '../../platform/db.service';
import { AuditService } from '../../platform/audit.service';
import { AiConfig } from './ai-config';
import type { SettingsRow } from './ai-settings.service';
import { ContextItem, ModelProvider } from './providers/model-provider';

export interface GatewayBlock {
  status: 'failed' | 'budget_exceeded' | 'cancelled' | 'skipped';
  error: string;
}

/**
 * AI policy gateway (ADR-0009, C-19, C-22): every provider call passes here first.
 * Order: mode → kill switch → provider availability → destination allowlist (egress) → circuit breaker →
 * classification ceiling / room exclusion / redaction → budget (tokens, cost, per-run limit). Refusals are audited
 * with ids and codes only (no content — C-37). Exhaustion degrades AI only; project management keeps working (AT-21).
 */
@Injectable()
export class AiGatewayService {
  constructor(
    private readonly db: DbService,
    private readonly audit: AuditService,
    private readonly cfg: AiConfig,
  ) {}

  /** Checks that do not depend on the context. Returns a block (and audits it) or null. */
  async preflight(projectId: string, s: SettingsRow, provider: ModelProvider, now: Date): Promise<GatewayBlock | null> {
    if (s.mode === 'off' || s.provider === 'off') return { status: 'skipped', error: 'ai_off' };
    if (s.killSwitch) {
      await this.audit.record({ action: 'AI_KILLSWITCH_BLOCKED', entityType: 'ai_project_settings', projectId, outcome: 'denied', reason: 'emergency stop active' });
      return { status: 'cancelled', error: 'kill_switch' };
    }
    const st = provider.status(s.model);
    if (st === 'disabled_by_config') return { status: 'failed', error: 'provider_disabled_by_config' };
    if (st === 'not_configured') return { status: 'failed', error: 'provider_not_configured' };
    const dest = provider.destination();
    if (dest !== null && !hostAllowed(dest, this.cfg.egressAllowlist)) {
      await this.audit.record({ action: 'AI_EGRESS_BLOCKED', entityType: 'ai_project_settings', projectId, outcome: 'denied', reason: `provider ${s.provider}: destination not on the egress allowlist` });
      return { status: 'failed', error: 'egress_not_approved' };
    }
    if (circuitIsOpen(s.circuitOpenUntil, now)) return { status: 'failed', error: 'circuit_open' };
    return null;
  }

  /**
   * Source-metadata egress filter (primary control, AIT-30): items above the project ceiling or the provider's hard
   * maximum, and any partner-room / clean-team item, are withheld from the provider. DLP redaction is secondary.
   */
  filterContext(s: SettingsRow, items: ContextItem[]) {
    const hardMax = AI_PROVIDER_MAX_CLASSIFICATION[s.provider] ?? 'public';
    const ceiling = classificationWithinCeiling(s.maxClassificationToProvider as Classification, hardMax) ? (s.maxClassificationToProvider as Classification) : hardMax;
    const sent: ContextItem[] = [];
    let aboveCeiling = 0;
    let roomRestricted = 0;
    let redactions = 0;
    for (const it of items) {
      if (it.roomId) {
        roomRestricted++;
        continue;
      }
      const cls = it.classification ?? 'confidential';
      if (!classificationWithinCeiling(cls, ceiling)) {
        aboveCeiling++;
        continue;
      }
      const red = redactSensitive(it.text);
      const title = redactSensitive(it.title);
      redactions += red.redactions + title.redactions;
      sent.push({ ...it, text: red.text, title: title.text });
    }
    return { sent, withheld: { aboveCeiling, roomRestricted }, redactions, ceiling };
  }

  /** Trims the context to the per-run token limit (lowest-ranked items last) and estimates tokens. */
  fitToLimit(items: ContextItem[], question: string | null, perRunTokenLimit: number, maxOutput: number) {
    const budgetForInput = Math.max(0, perRunTokenLimit - maxOutput - 400);
    const kept: ContextItem[] = [];
    let used = estimateTokens(question ?? '') + 300;
    let dropped = 0;
    for (const it of items) {
      const t = estimateTokens(it.title) + estimateTokens(it.text) + 30;
      if (used + t > budgetForInput) {
        dropped++;
        continue;
      }
      kept.push(it);
      used += t;
    }
    return { kept, estimatedInputTokens: used, dropped };
  }

  async monthUsage(projectId: string, timezone: string, month: string) {
    const r = await this.db.query<{ tokens: number; cost: string; runs: number }>(
      `select coalesce(sum(input_tokens + output_tokens), 0)::int as tokens, coalesce(sum(cost_estimate), 0)::numeric(12,4)::text as cost, count(*)::int as runs
         from ai_run where project_id = $1 and to_char(created_at at time zone $2, 'YYYY-MM') = $3`,
      [projectId, timezone, month],
    );
    return r.rows[0] ?? { tokens: 0, cost: '0.0000', runs: 0 };
  }

  async checkBudget(projectId: string, s: SettingsRow, timezone: string, month: string, estimatedTokens: number, estimatedCost: string): Promise<GatewayBlock | null> {
    const usage = await this.monthUsage(projectId, timezone, month);
    const b = evaluateBudget({
      monthlyTokenBudget: s.monthlyTokenBudget,
      tokensUsedThisMonth: usage.tokens,
      estimatedTokens,
      perRunTokenLimit: s.perRunTokenLimit,
      monthlyCostBudget: s.monthlyCostBudget,
      costUsedThisMonth: usage.cost,
      estimatedCost,
    });
    if (b.ok) return null;
    await this.audit.record({ action: 'AI_BUDGET_EXHAUSTED', entityType: 'ai_project_settings', projectId, outcome: 'denied', reason: `budget: ${b.reason} (used ${usage.tokens} of ${s.monthlyTokenBudget} tokens this month)` });
    return { status: 'budget_exceeded', error: `budget_exceeded:${b.reason}` };
  }
}
