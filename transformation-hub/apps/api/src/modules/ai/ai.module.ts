import { Module } from '@nestjs/common';
import { AiController } from './ai.controller';
import { AiConfig } from './ai-config';
import { ProviderRegistry } from './providers/provider-registry';
import { AiSettingsService } from './ai-settings.service';
import { AiKnowledgeService } from './ai-knowledge.service';
import { AiDetectionsService } from './ai-detections.service';
import { AiToolsService } from './ai-tools.service';
import { AiGatewayService } from './ai-gateway.service';
import { AiArtifactsService } from './ai-artifacts.service';
import { AiProposalsService } from './ai-proposals.service';
import { AiRuntimeService } from './ai-runtime.service';
import { AiOpsService } from './ai-ops.service';

const providers = [
  AiConfig,
  ProviderRegistry,
  AiSettingsService,
  AiKnowledgeService,
  AiDetectionsService,
  AiToolsService,
  AiGatewayService,
  AiArtifactsService,
  AiProposalsService,
  AiRuntimeService,
  AiOpsService,
];

/** Runtime AI project manager (spec §12). Owner: ai-runtime-engineer (see docs/architecture/module-guide.md). */
@Module({ controllers: [AiController], providers, exports: providers })
export class AiModule {}
