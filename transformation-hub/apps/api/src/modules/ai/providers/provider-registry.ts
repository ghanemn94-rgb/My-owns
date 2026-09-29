import { Injectable } from '@nestjs/common';
import type { AiProvider } from '@hub/domain';
import { AiConfig } from '../ai-config';
import { ModelProvider } from './model-provider';
import { MockProvider } from './mock.provider';
import { AnthropicGatewayProvider, OffProvider, OpenAiCompatibleProvider } from './http.providers';

/** Resolves the adapter for a project's provider setting (ADR-0009). No vendor is hard-wired into the runtime. */
@Injectable()
export class ProviderRegistry {
  private readonly providers: Record<AiProvider, ModelProvider>;

  constructor(cfg: AiConfig) {
    this.providers = {
      off: new OffProvider(),
      mock: new MockProvider({ allowMock: () => cfg.allowMock, allowEvaluationScripts: () => cfg.allowEvaluationScripts }),
      openai_compatible: new OpenAiCompatibleProvider({ url: () => cfg.openaiBaseUrl, apiKey: () => cfg.openaiApiKey, allowlist: () => cfg.egressAllowlist }),
      anthropic: new AnthropicGatewayProvider({ url: () => cfg.anthropicGatewayUrl, apiKey: () => cfg.anthropicApiKey, allowlist: () => cfg.egressAllowlist }),
    };
  }

  get(id: AiProvider): ModelProvider {
    return this.providers[id];
  }

  /** Test/evaluation hook: replace an adapter (e.g. a spy). Never used by production code paths. */
  override(id: AiProvider, provider: ModelProvider) {
    this.providers[id] = provider;
  }
}
