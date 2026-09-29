import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../../platform/config';

/**
 * AI runtime configuration. Provider endpoints are read from the environment at call time (not cached) so an operator
 * change — or an evaluation — takes effect without stale state. Secrets are never logged or returned by the API.
 *
 *   HUB_AI_ALLOW_MOCK            true|false   (platform config; production refuses `true`)
 *   HUB_AI_OPENAI_BASE_URL       base URL of a licensed local/self-hosted OpenAI-compatible endpoint (e.g. https://llm.internal/v1)
 *   HUB_AI_OPENAI_API_KEY        optional bearer token for that endpoint
 *   HUB_AI_ANTHROPIC_GATEWAY_URL URL of the APPROVED enterprise gateway in front of the Anthropic Messages API
 *   HUB_AI_ANTHROPIC_API_KEY     optional key when the gateway does not inject credentials itself
 *   HUB_EGRESS_ALLOWLIST         hosts the platform may call (platform config) — provider hosts must be listed
 */
@Injectable()
export class AiConfig {
  constructor(@Inject(APP_CONFIG) private readonly app: AppConfig) {}

  get nodeEnv() {
    return this.app.nodeEnv;
  }

  get allowMock(): boolean {
    const v = process.env.HUB_AI_ALLOW_MOCK;
    return v === undefined ? this.app.ai.allowMock : v === 'true';
  }

  get privateMode(): boolean {
    return this.app.privateMode;
  }

  get egressAllowlist(): string[] {
    const v = process.env.HUB_EGRESS_ALLOWLIST;
    return v === undefined ? this.app.egressAllowlist : v.split(',').map((s) => s.trim()).filter(Boolean);
  }

  get openaiBaseUrl(): string | null {
    return process.env.HUB_AI_OPENAI_BASE_URL?.trim() || null;
  }

  get openaiApiKey(): string | null {
    return process.env.HUB_AI_OPENAI_API_KEY?.trim() || null;
  }

  get anthropicGatewayUrl(): string | null {
    return process.env.HUB_AI_ANTHROPIC_GATEWAY_URL?.trim() || null;
  }

  get anthropicApiKey(): string | null {
    return process.env.HUB_AI_ANTHROPIC_API_KEY?.trim() || null;
  }

  /** Evaluation-only mock scripts (hostile / scripted outage) are refused in production. */
  get allowEvaluationScripts(): boolean {
    return this.app.nodeEnv !== 'production';
  }

  /** Synchronous asks run inside the request transaction: cap below the idle-in-transaction timeout. */
  readonly syncTimeoutCapMs = 25_000;
  readonly approvalValidityHours = 24;
  readonly staleUpdateDays = 14;
  readonly tsaWindowDays = 60;
  readonly staleSourceDays = 90;
  readonly bottleneckDays = 10;
  readonly approvalBottleneckDays = 5;
  readonly maxModelToolCalls = 12;
  readonly maxContextItems = 40;
  readonly maxOutputTokens = 2000;
}
