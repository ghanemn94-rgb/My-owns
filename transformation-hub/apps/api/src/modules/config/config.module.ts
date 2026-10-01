import { Module } from '@nestjs/common';
import { GatesModule } from '../gates/gates.module';
import { PortfolioModule } from '../portfolio/portfolio.module';
import { ConfigController } from './config.controller';
import { ConfigSupport } from './config.support';
import { RagThresholdsReader } from './rag-thresholds.reader';
import { RagThresholdsService } from './rag-thresholds.service';
import { TemplateUpgradesService } from './template-upgrades.service';
import { SetupService } from './setup.service';
import { ConfigAdminService } from './admin.service';

/**
 * Project configuration (REQ module project-config): RAG thresholds per project with approval (REQ-PLN-019), template
 * upgrades with preview and approval (REQ-ENT-009, AT-26), setup wizard steps 7–8 and the onboarding checklist
 * (REQ-SET-007, -015, -016), template administration and deployment settings (read-only, REQ-UX-020).
 * Exports RagThresholdsReader for the planning measurement (the thresholds in force and the version every RAG names).
 */
@Module({
  // PortfolioModule: the project factory adds the new elements of an approved template upgrade.
  // GatesModule: gate evaluation refresh (under the gate lock) and status-dimension recompute after an upgrade.
  imports: [PortfolioModule, GatesModule],
  controllers: [ConfigController],
  providers: [ConfigSupport, RagThresholdsReader, RagThresholdsService, TemplateUpgradesService, SetupService, ConfigAdminService],
  exports: [RagThresholdsReader],
})
export class ConfigModule {}
