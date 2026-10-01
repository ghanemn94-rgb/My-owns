import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, loadConfig } from './config';
import { DbService } from './db.service';
import { Clock } from './clock';
import { AuditService } from './audit.service';
import { OutboxService } from './outbox.service';
import { PolicyService } from './policy.service';
import { SessionService } from './auth/session.service';
import { ScopeService } from './auth/scope.service';
import { OrgService } from './org.service';
import { JobQueue } from './jobs/job-queue.service';
import { JobRegistry } from './jobs/job-registry';
import { WorkerService } from './jobs/worker.service';
import { RecordVersionService } from './helpers';
import { JobContextFactory } from './jobs/job-context';
import { DeliveryService } from './delivery.service';
import { RateLimiter } from './rate-limiter';
import { AuditExportService } from './audit-export.service';
import { TelemetryService } from './telemetry.service';

const providers = [
  { provide: APP_CONFIG, useFactory: () => loadConfig() },
  DbService,
  Clock,
  AuditService,
  OutboxService,
  PolicyService,
  SessionService,
  ScopeService,
  OrgService,
  JobQueue,
  JobRegistry,
  WorkerService,
  RecordVersionService,
  JobContextFactory,
  DeliveryService,
  RateLimiter,
  AuditExportService,
  TelemetryService,
];

/** Cross-cutting platform services shared by all modules. */
@Global()
@Module({ providers, exports: providers })
export class PlatformModule {}
