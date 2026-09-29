import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, DiscoveryModule } from '@nestjs/core';
import { PlatformModule } from './platform/platform.module';
import { HealthController } from './platform/health.controller';
import { HubGuard } from './platform/hub.guard';
import { TxInterceptor } from './platform/tx.interceptor';
import { ProblemFilter } from './platform/errors';
import { IdentityModule } from './modules/identity/identity.module';
import { PortfolioModule } from './modules/portfolio/portfolio.module';

// Module registration: each domain module owns its folder under src/modules (see CLAUDE.md for ownership).
export const DOMAIN_MODULES = [IdentityModule, PortfolioModule];

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
