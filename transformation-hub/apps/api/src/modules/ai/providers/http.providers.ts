import { hostAllowed } from '@hub/domain';
import {
  ModelProvider,
  ModelRequest,
  ModelResponse,
  ProviderConfigError,
  ProviderStatus,
  ProviderUnavailableError,
  PROVIDER_SYSTEM_PROMPT,
  parseProviderJson,
  providerUserContent,
} from './model-provider';

interface HttpProviderEnv {
  url: () => string | null;
  apiKey: () => string | null;
  allowlist: () => string[];
}

/** Common guard: refuse before any network call unless the endpoint is configured AND allowlisted (AT-22, AIT-29). */
function assertDestination(env: HttpProviderEnv): string {
  const url = env.url();
  if (!url) throw new ProviderConfigError('ai.provider_not_configured', 'Provider endpoint is not configured');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ProviderConfigError('ai.provider_not_configured', 'Provider endpoint URL is invalid');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new ProviderConfigError('ai.provider_not_configured', 'Unsupported protocol');
  if (!hostAllowed(url, env.allowlist())) throw new ProviderConfigError('EGRESS_NOT_APPROVED', `Destination host ${parsed.hostname} is not on the egress allowlist`);
  return url.replace(/\/+$/, '');
}

/**
 * The ONLY network call of the provider adapters (SEC-P5-04, AT-22, AIT-29). Every hop is checked against the egress
 * allowlist, and redirects are never followed (`redirect: 'manual'`): a 3xx from the approved endpoint — a
 * misconfiguration, a login page or a compromise — is refused as a configuration error, so neither the context nor the
 * credential header ever reaches a host that is not on `HUB_EGRESS_ALLOWLIST`.
 */
async function egressFetch(env: HttpProviderEnv, url: string, init: RequestInit, unreachable: string): Promise<Response> {
  if (!hostAllowed(url, env.allowlist())) throw new ProviderConfigError('EGRESS_NOT_APPROVED', 'Destination host is not on the egress allowlist');
  let res: Response;
  try {
    res = await fetch(url, { ...init, redirect: 'manual' });
  } catch (e) {
    throw new ProviderUnavailableError(`${unreachable}: ${(e as Error).name}`);
  }
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel().catch(() => undefined);
    throw new ProviderConfigError('EGRESS_REDIRECT_REFUSED', `The provider endpoint answered with a redirect (HTTP ${res.status}); redirects are never followed`);
  }
  return res;
}

function httpStatus(env: HttpProviderEnv): ProviderStatus {
  const url = env.url();
  if (!url) return 'not_configured';
  return hostAllowed(url, env.allowlist()) ? 'configured_unverified' : 'egress_not_approved';
}

/**
 * OpenAI-compatible chat-completions adapter for a LICENSED LOCAL / self-hosted model endpoint (spec §16 "Mobily
 * Private — Local AI"). Status in this build: **Not configured** — no endpoint exists here and it has never been
 * contacted. Results from a local model must be measured separately; no equivalence to any other model is claimed.
 */
export class OpenAiCompatibleProvider implements ModelProvider {
  readonly id = 'openai_compatible' as const;
  readonly simulated = false;
  constructor(private readonly env: HttpProviderEnv) {}

  destination() {
    return this.env.url();
  }
  status(): ProviderStatus {
    return httpStatus(this.env);
  }
  label() {
    const s = this.status();
    return s === 'configured_unverified' ? 'Local endpoint — configured, unverified' : s === 'egress_not_approved' ? 'Blocked — destination not approved' : 'Not configured';
  }
  estimateCost(): string {
    return '0.0000'; // local inference: cost is infrastructure, not per token (to be measured — spec §16)
  }

  async generate(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const base = assertDestination(this.env);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    const key = this.env.apiKey();
    if (key) headers.authorization = `Bearer ${key}`;
    const res = await egressFetch(
      this.env,
      `${base}/chat/completions`,
      {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model: req.model ?? 'default',
          max_tokens: req.maxOutputTokens,
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: PROVIDER_SYSTEM_PROMPT },
            { role: 'user', content: providerUserContent(req) },
          ],
        }),
      },
      'local endpoint unreachable',
    );
    if (!res.ok) throw new ProviderUnavailableError(`local endpoint returned HTTP ${res.status}`);
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number }; model?: string };
    const parsed = parseProviderJson(body.choices?.[0]?.message?.content ?? '');
    return {
      ...parsed,
      usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 },
      simulated: false,
      model: body.model ?? req.model ?? 'unknown',
    };
  }
}

/** Default model when the project does not name one (skill guidance: current Opus). Only used via an approved gateway. */
export const ANTHROPIC_DEFAULT_MODEL = 'claude-opus-5-5';
/** Indicative list prices per million tokens (USD) for cost ESTIMATES only; actual billing is the gateway's. */
const ANTHROPIC_PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  'claude-opus-5-5': { in: 4, out: 20 },
  'claude-sonnet-5-5': { in: 2, out: 10 },
  'claude-haiku-4-5': { in: 1, out: 5 },
};

/**
 * Anthropic Messages API adapter — ONLY through an approved enterprise gateway (spec §16 "Approved AI Gateway").
 * Status in this build: **Not configured** — no gateway is approved, no key exists, and it has never been contacted.
 * Raw HTTP is used because adding the official SDK dependency is a lockfile change owned by the lead; switching to
 * `@anthropic-ai/sdk` with `baseURL` = gateway is recommended once approved (see docs/ai/model-provider-setup.md).
 */
export class AnthropicGatewayProvider implements ModelProvider {
  readonly id = 'anthropic' as const;
  readonly simulated = false;
  constructor(private readonly env: HttpProviderEnv) {}

  destination() {
    return this.env.url();
  }
  status(): ProviderStatus {
    return httpStatus(this.env);
  }
  label() {
    const s = this.status();
    return s === 'configured_unverified' ? 'Approved gateway — configured, unverified' : s === 'egress_not_approved' ? 'Blocked — destination not approved' : 'Not configured';
  }
  estimateCost(inputTokens: number, outputTokens: number, model?: string | null): string {
    const p = ANTHROPIC_PRICE_PER_MTOK[model ?? ANTHROPIC_DEFAULT_MODEL] ?? ANTHROPIC_PRICE_PER_MTOK[ANTHROPIC_DEFAULT_MODEL]!;
    return ((inputTokens * p.in + outputTokens * p.out) / 1_000_000).toFixed(4);
  }

  async generate(req: ModelRequest, signal: AbortSignal): Promise<ModelResponse> {
    const base = assertDestination(this.env);
    const model = req.model ?? ANTHROPIC_DEFAULT_MODEL;
    const headers: Record<string, string> = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    const key = this.env.apiKey();
    if (key) headers['x-api-key'] = key;
    const res = await egressFetch(
      this.env,
      `${base}/v1/messages`,
      {
        method: 'POST',
        headers,
        signal,
        body: JSON.stringify({
          model,
          max_tokens: req.maxOutputTokens,
          system: PROVIDER_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: providerUserContent(req) }],
        }),
      },
      'gateway unreachable',
    );
    if (!res.ok) throw new ProviderUnavailableError(`gateway returned HTTP ${res.status}`);
    const body = (await res.json()) as {
      content?: { type: string; text?: string }[];
      stop_reason?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const usage = { inputTokens: body.usage?.input_tokens ?? 0, outputTokens: body.usage?.output_tokens ?? 0 };
    // A refusal carries no usable content — report no claims (the platform then states missing evidence).
    if (body.stop_reason === 'refusal') return { claims: [], toolCalls: [], usage, simulated: false, model: body.model ?? model };
    const text = (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
    return { ...parseProviderJson(text), usage, simulated: false, model: body.model ?? model };
  }
}

/** AI Off: never generates. */
export class OffProvider implements ModelProvider {
  readonly id = 'off' as const;
  readonly simulated = false;
  destination() {
    return null;
  }
  status(): ProviderStatus {
    return 'off';
  }
  label() {
    return 'Off';
  }
  estimateCost() {
    return '0.0000';
  }
  async generate(): Promise<ModelResponse> {
    throw new ProviderConfigError('ai.disabled', 'AI is off for this project');
  }
}
