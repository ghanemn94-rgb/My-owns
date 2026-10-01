import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * Integration connectors with honest status (spec §17): adapter registry (Microsoft 365 adapters defined, Not configured;
 * future enterprise systems documented only), SSRF-guarded connectivity checks, execution logs, signed inbound webhooks
 * with replay protection, processing with retries, reconciliation and failure alerts. Owner: integration-reporting-engineer.
 */
@Module({ controllers: [IntegrationsController], providers: [IntegrationsService], exports: [IntegrationsService] })
export class IntegrationsModule {}
