import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { PlatformModule } from './platform/platform.module';
import { HealthController } from './platform/health.controller';
import { HubGuard } from './platform/hub.guard';
import { TxInterceptor } from './platform/tx.interceptor';
import { ProblemFilter } from './platform/errors';
import { IdentityModule } from './modules/identity/identity.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { GovernanceModule } from './modules/governance/governance.module';
import { PlanningModule } from './modules/planning/planning.module';
import { GatesModule } from './modules/gates/gates.module';
import { CarveoutModule } from './modules/carveout/carveout.module';
import { NewcoModule } from './modules/newco/newco.module';
import { ReadinessModule } from './modules/readiness/readiness.module';
import { FinanceModule } from './modules/finance/finance.module';
import { JvModule } from './modules/jv/jv.module';
import { AiModule } from './modules/ai/ai.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { ImportsModule } from './modules/imports/imports.module';
import { IntegrationsModule } from './modules/integrations/integrations.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ConfigModule } from './modules/config/config.module';

// Module registration: each domain module owns its folder under src/modules (see CLAUDE.md for ownership).
export const DOMAIN_MODULES = [
  IdentityModule,
  PortfolioModule,
  DocumentsModule,
  GovernanceModule,
  PlanningModule,
  GatesModule,
  CarveoutModule,
  NewcoModule,
  ReadinessModule,
  FinanceModule,
  JvModule,
  AiModule,
  ReportingModule,
  ImportsModule,
  IntegrationsModule,
  NotificationsModule,
  ConfigModule,
];

@Module({
  imports: [DiscoveryModule, PlatformModule, ...DOMAIN_MODULES],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: HubGuard },
    { provide: APP_INTERCEPTOR, useClass: TxInterceptor },
    { provide: APP_FILTER, useClass: ProblemFilter },
  ],
})
export class AppModule {}
